// ── Chaîne de montagnes — anneau étroit derrière la barrière ──────────────────
import * as THREE from 'three';
import { scene } from './scene.js';
import { BARRIER_HALF } from './barrier.js';

const M_SIZE = 420;
const M_SEG  = 80;

function _hash(ix, iz) {
    const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
    return s - Math.floor(s);
}
function _sn(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx*fx*(3-2*fx), uz = fz*fz*(3-2*fz);
    const a = _hash(ix,iz), b = _hash(ix+1,iz);
    const c = _hash(ix,iz+1), d = _hash(ix+1,iz+1);
    return a + (b-a)*ux + (c-a)*uz + (a-b-c+d)*ux*uz;
}

function _mountainH(x, z) {
    const sqDist = Math.max(Math.abs(x), Math.abs(z));

    // Intérieur : enterré sous le terrain jouable
    if (sqDist < BARRIER_HALF - 4) return -4;

    const outward = sqDist - BARRIER_HALF;

    // Chaîne : bande de 20 à 70 unités après la barrière
    // En dehors : redescend vite vers 0 (fond de décor plat)
    const CHAIN_PEAK = 35;  // centre de la chaîne (unités depuis barrière)
    const CHAIN_W    = 40;  // demi-largeur de la chaîne
    const envelope   = Math.max(0, 1.0 - Math.abs(outward - CHAIN_PEAK) / CHAIN_W);
    const envelopeS  = envelope * envelope * (3 - 2 * envelope); // smoothstep

    if (envelopeS < 0.001) return Math.max(-4, -outward * 0.1);

    // Bruit pour les crêtes irrégulières
    let v = 0, a = 1, f = 1 / 40;
    for (let i = 0; i < 4; i++) { v += a * _sn(x*f, z*f); a *= 0.5; f *= 2.2; }
    const noise = (v / 1.875); // 0..1

    // Hauteur max ~25 unités
    return envelopeS * (8 + noise * 17);
}

function _mountainColor(h, maxH, x, z) {
    if (h <= 0) return [0.28, 0.18, 0.10];

    const t = Math.max(0, Math.min(1, h / maxH));

    // ── Bruit multi-fréquence pour la texture rocheuse ────────────────────────
    // Strates grossières (plaques de roche)
    const strata   = _sn(x * 0.08,  z * 0.08)  * 0.40
                   + _sn(x * 0.22,  z * 0.22)  * 0.25;
    // Grain fin (aspérités)
    const grain    = _sn(x * 0.70,  z * 0.70)  * 0.20
                   + _sn(x * 1.80,  z * 1.80)  * 0.10
                   + _sn(x * 4.50,  z * 4.50)  * 0.05;
    // Craquelures (bruit très fin contrasté)
    const crack    = Math.pow(_sn(x * 3.0, z * 3.0), 2.2) * 0.15;

    const noise    = strata + grain - crack; // -0.2 … +0.9

    // ── Couleur de base selon hauteur ─────────────────────────────────────────
    let r, g, b;
    if (t < 0.40) {
        const s = t / 0.40;
        r = 0.30 + s * 0.22;
        g = 0.18 + s * 0.16;
        b = 0.09 + s * 0.10;
    } else if (t < 0.72) {
        const s = (t - 0.40) / 0.32;
        r = 0.52 + s * 0.18;
        g = 0.34 + s * 0.22;
        b = 0.19 + s * 0.22;
    } else {
        const s   = Math.min(1, (t - 0.72) / 0.28);
        const snow = s * s;
        r = 0.70 + snow * 0.22;
        g = 0.56 + snow * 0.34;
        b = 0.41 + snow * 0.47;
    }

    // ── Appliquer le bruit : module luminosité + légère teinte ───────────────
    const lum = 0.72 + noise * 0.55;          // 0.5 … 1.2 — contraste élevé
    const tint = noise * 0.08;                // légère variation de teinte
    return [
        Math.min(1, Math.max(0, r * lum + tint)),
        Math.min(1, Math.max(0, g * lum)),
        Math.min(1, Math.max(0, b * lum - tint * 0.5)),
    ];
}

export function initMountains() {
    const geo  = new THREE.PlaneGeometry(M_SIZE, M_SIZE, M_SEG, M_SEG);
    const vCnt = (M_SEG + 1) * (M_SEG + 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vCnt * 3), 3));

    const pos  = geo.attributes.position;
    const col  = geo.attributes.color;
    const norm = geo.attributes.normal;

    const hs = new Float32Array(vCnt);
    let maxH = 1;
    for (let i = 0; i < vCnt; i++) {
        const h = _mountainH(pos.getX(i), -pos.getY(i));
        hs[i] = h;
        if (h > maxH) maxH = h;
    }

    for (let i = 0; i < vCnt; i++) {
        pos.setZ(i, hs[i]);
        const wx = pos.getX(i), wz = -pos.getY(i);
        const [r, g, b] = _mountainColor(hs[i], maxH, wx, wz);
        col.setXYZ(i, r, g, b);
    }

    // Normales par différences finies
    const step = M_SIZE / M_SEG;
    for (let iz = 0; iz <= M_SEG; iz++) {
        for (let ix = 0; ix <= M_SEG; ix++) {
            const i  = iz * (M_SEG + 1) + ix;
            const iL = iz * (M_SEG + 1) + Math.max(0, ix - 1);
            const iR = iz * (M_SEG + 1) + Math.min(M_SEG, ix + 1);
            const iD = Math.max(0, iz - 1) * (M_SEG + 1) + ix;
            const iU = Math.min(M_SEG, iz + 1) * (M_SEG + 1) + ix;
            const nx = (hs[iL] - hs[iR]) / (2 * step);
            const nz = (hs[iD] - hs[iU]) / (2 * step);
            const len = Math.sqrt(nx*nx + 1 + nz*nz);
            norm.setXYZ(i, nx/len, 1/len, nz/len);
        }
    }

    pos.needsUpdate = col.needsUpdate = norm.needsUpdate = true;

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.0,
    }));
    mesh.rotation.x    = -Math.PI / 2;
    mesh.receiveShadow = true;
    scene.add(mesh);
}
