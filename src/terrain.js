import * as THREE from 'three';
import { scene } from './scene.js';

// --- Bruit de valeur fBm ---
function hash(ix, iz) {
    const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

function smoothNoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uz = fz * fz * (3.0 - 2.0 * fz);
    const a = hash(ix,     iz    );
    const b = hash(ix + 1, iz    );
    const c = hash(ix,     iz + 1);
    const d = hash(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

const H_AMPLITUDE = 18.0;  // amplitude de base ±9 unités
const H_SCALE     = 1 / 90;
const M_SCALE     = 1 / 280; // fréquence du masque montagne (zones isolées)
const M_THRESHOLD = 0.62;    // seuil au-dessus duquel une montagne se forme

export function getHeightAt(x, z) {
    const search = new URLSearchParams(window.location.search);
    const isChase = search.get('mode') === 'chase';
    const isFoot = search.get('mode') === 'foot';
    
    // Zone du terrain de foot : enfoncer le terrain pour laisser place à la pelouse du stade
    if (isFoot) {
        if (Math.abs(x) < 85 && Math.abs(z) < 45) return -2.0;
    }

    if (isChase) {
        const limit = 75.0; // Augmenté de 70 à 75 pour supporter le muret
        const distEdge = Math.max(Math.abs(x), Math.abs(z));
        // Au-delà de l'île, on reste au niveau 0 pour boucher les trous
        if (distEdge > limit) return 0.0;
    }

    const ampMult = isChase ? 2.5 : 1.0;
    const dist = Math.sqrt(x*x + z*z);
    const sizeMult = isChase ? Math.max(0, 1.0 - (dist / 120.0)) : 1.0;

    let v = 0.0, a = 1.0, f = H_SCALE;
    for (let i = 0; i < 4; i++) {
        v += a * smoothNoise(x * f, z * f);
        a *= 0.5;
        f *= 2.0;
    }
    const base = (v / 1.875 - 0.5) * H_AMPLITUDE * ampMult * sizeMult;

    const mask = smoothNoise(x * M_SCALE, z * M_SCALE);
    const t    = Math.max(0, (mask - M_THRESHOLD) / (1 - M_THRESHOLD));
    const h    = base + t * t * base * 2.5;

    // En mode poursuite, on surélève tout de 20m pour éviter que les vallées
    // ne descendent sous le seuil de respawn (-15m)
    return isChase ? h + 20.0 : h;
}

const EPS = 0.5;

export function getNormalAt(x, z) {
    const hL = getHeightAt(x - EPS, z);
    const hR = getHeightAt(x + EPS, z);
    const hD = getHeightAt(x, z - EPS);
    const hU = getHeightAt(x, z + EPS);
    return new THREE.Vector3(hL - hR, 2.0 * EPS, hD - hU).normalize();
}

/** Vrai si le sol est pentu (zone marron → traces de pneus visibles) */
export function isOnDirt(x, z) {
    return getNormalAt(x, z).y < 0.97;
}

/** Multiplicateur de grip : plat = glissant, pentu = adhérence normale */
export function getSlopeGrip(x, z) {
    const ny = getNormalAt(x, z).y;
    return THREE.MathUtils.lerp(1.0, 0.82, THREE.MathUtils.clamp((ny - 0.90) / 0.10, 0, 1));
}

// --- Patches de terrain (3 recyclés) ---
const PATCH_W = 400, PATCH_D = 300;
const SEG_W   = 32,  SEG_D   = 40;

const GR = 0.28, GG = 0.52, GB = 0.15; // vert (plat)
const BR = 0.42, BG = 0.28, BB = 0.12; // marron (pentu)

const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.90,
    metalness: 0.0,
});

function recomputePatch(mesh) {
    const cz  = mesh.position.z;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const norm = geo.attributes.normal;

    for (let iz = 0; iz <= SEG_D; iz++) {
        for (let ix = 0; ix <= SEG_W; ix++) {
            const idx = iz * (SEG_W + 1) + ix;
            const wx = pos.getX(idx);
            const wz = -pos.getY(idx) + cz;
            const h  = getHeightAt(wx, wz);
            pos.setZ(idx, h);

            // Calcul de la normale précise via getNormalAt
            const n = getNormalAt(wx, wz);
            // On mappe les axes pour la rotation du plan (X=-PI/2)
            norm.setXYZ(idx, n.x, n.z, n.y);

            const t = THREE.MathUtils.clamp((0.97 - n.y) / 0.12, 0, 1);
            col.setXYZ(idx, GR + (BR - GR) * t, GG + (BG - GG) * t, GB + (BB - GB) * t);
        }
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    norm.needsUpdate = true;
}

function createPatch(centerZ) {
    const geo  = new THREE.PlaneGeometry(PATCH_W, PATCH_D, SEG_W, SEG_D);
    const vCnt = (SEG_W + 1) * (SEG_D + 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vCnt * 3), 3));

    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.rotation.x    = -Math.PI / 2;
    mesh.position.z    = centerZ;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    recomputePatch(mesh);
    return mesh;
}

const patches = [
    createPatch(0),
    createPatch(-PATCH_D),
    createPatch(-2 * PATCH_D),
];

export function refreshTerrain() {
    for (const p of patches) recomputePatch(p);
}

export function updateTerrain(carZ) {
    const isChase = new URLSearchParams(window.location.search).get('mode') === 'chase';
    if (isChase) return; // Pas de défilement en mode poursuite
    
    for (const p of patches) {
        const cz = p.position.z;
        if (cz > carZ + PATCH_D) {
            p.position.z -= 3 * PATCH_D;
            recomputePatch(p);
        } else if (cz < carZ - 2 * PATCH_D) {
            p.position.z += 3 * PATCH_D;
            recomputePatch(p);
        }
    }
}
