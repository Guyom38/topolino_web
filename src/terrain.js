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
    let   h    = base + t * t * base * 2.5;

    // Buttes de saut (conduite libre uniquement — ni chase, ni foot)
    if (!isChase && !isFoot) h += _jumpBumpAt(x, z);

    // Fondu progressif vers 0 à l'approche de la barrière (conduite libre)
    // Permet à la caméra de voir le joueur sans que les collines masquent la vue
    if (!isChase && !isFoot) {
        const FADE_START = 35;    // début du fondu
        const FADE_END   = 60;    // terrain plat avant le mur à r=80
        if (dist > FADE_START) {
            const t = Math.min(1.0, (dist - FADE_START) / (FADE_END - FADE_START));
            h *= 1.0 - t * t * (3.0 - 2.0 * t); // smoothstep
        }
    }

    // En mode poursuite, on surélève tout de 20m pour éviter que les vallées
    // ne descendent sous le seuil de respawn (-15m)
    return isChase ? h + 20.0 : h;
}

// ── Buttes de saut procédurales (conduite libre uniquement) ───────────────────
const BUMP_CELL = 70; // une butte possible par cellule de 70×70 unités

function _jumpBumpAt(x, z) {
    let result = 0;
    const cx0 = Math.floor(x / BUMP_CELL);
    const cz0 = Math.floor(z / BUMP_CELL);

    for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcz = -1; dcz <= 1; dcz++) {
            const cx = cx0 + dcx;
            const cz = cz0 + dcz;

            // ~28% des cellules ont une butte (hash > 0.72)
            if (hash(cx * 3 + 1, cz * 3 + 2) < 0.72) continue;

            // Centre de la butte, décentré aléatoirement dans la cellule
            const bx = (cx + hash(cx,      cz     ) * 0.65 + 0.17) * BUMP_CELL;
            const bz = (cz + hash(cx + 17, cz +  5) * 0.65 + 0.17) * BUMP_CELL;

            const dx = x - bx, dz_ = z - bz;
            const d  = Math.sqrt(dx * dx + dz_ * dz_);
            const r  = 9  + hash(cx * 7, cz * 7) * 5;    // rayon 9–14
            if (d >= r * 2.2) continue;

            const bh = 5.0 + hash(cx * 5, cz * 9) * 3.5; // hauteur 5–8.5
            const nt = Math.max(0, 1.0 - d / (r * 2.2));
            result  += bh * nt * nt * (3.0 - 2.0 * nt);  // smoothstep
        }
    }
    return result;
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

// --- Patches de terrain ---
// Mode conduite libre (arène) : 1 patch carré couvrant le cercle r=80
const ARENA_SIZE = 175;  const ARENA_SEG = 56;
// Mode infini (route) : 3 patches rectangulaires recyclés
const PATCH_W = 400, PATCH_D = 300;
const SEG_W   = 64,  SEG_D   = 80;

const GR = 0.28, GG = 0.52, GB = 0.15; // vert (plat)
const BR = 0.42, BG = 0.28, BB = 0.12; // marron (pentu)

// ── Texture procédurale de bruit pour l'herbe ─────────────────────────────────
function _buildGrassMap() {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');

    // Hash déterministe rapide
    const h = (x, y) => {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return s - Math.floor(s);
    };
    // Bruit lissé bilinéaire
    const sn = (x, y) => {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        return h(ix,iy) + (h(ix+1,iy)-h(ix,iy))*ux
             + (h(ix,iy+1)-h(ix,iy))*uy
             + (h(ix,iy)-h(ix+1,iy)-h(ix,iy+1)+h(ix+1,iy+1))*ux*uy;
    };

    // 1. Fond bruit de base pixel par pixel
    const img = ctx.createImageData(S, S);
    const d   = img.data;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const n =  sn(x*0.018, y*0.018) * 0.40
                     + sn(x*0.07,  y*0.07 ) * 0.28
                     + sn(x*0.30,  y*0.30 ) * 0.20
                     + sn(x*1.2,   y*1.2  ) * 0.12;
            const mow = Math.sin((x + y) * 0.18) * 0.035; // stries tonte
            const v   = Math.min(1, Math.max(0, 0.50 + n * 0.70 + mow));
            const c   = Math.floor(v * 255);
            const i   = (y * S + x) * 4;
            d[i] = d[i+1] = d[i+2] = c;
            d[i+3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);

    // 2. Brins d'herbe dessinés par-dessus (traits courts inclinés)
    // Utiliser un générateur pseudo-aléatoire déterministe pour les positions
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    const BLADE_COUNT = 4500;
    ctx.lineCap = 'round';

    for (let i = 0; i < BLADE_COUNT; i++) {
        const bx  = rng() * S;
        const by  = rng() * S;
        const len = 3 + rng() * 5;             // longueur 3–8px
        const ang = -Math.PI * 0.5 + (rng() - 0.5) * 1.1; // quasi vertical ± 35°
        const tx  = bx + Math.cos(ang) * len;
        const ty  = by + Math.sin(ang) * len;

        // Couleur : vert foncé → vert clair selon hauteur du brin
        const bright = 0.30 + rng() * 0.45;
        const r = Math.floor(20  + bright * 35);
        const g = Math.floor(100 + bright * 90);
        const b = Math.floor(15  + bright * 30);
        const alpha = 0.55 + rng() * 0.35;

        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth   = 0.9 + rng() * 0.8;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(tx, ty);
        ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

const _grassTex = _buildGrassMap();

// TILE_SIZE = 5 → divise exactement PATCH_W/2=200 et PATCH_D/2=150
// → aucune couture visible entre les patches grâce au RepeatWrapping
const TILE = 5.0;

const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.0,
});

// Injection du bruit herbe dans le shader via onBeforeCompile
terrainMat.onBeforeCompile = shader => {
    shader.uniforms.uGrass = { value: _grassTex };

    shader.vertexShader = 'varying vec2 vGrassUV;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vGrassUV = vec2(position.x, -position.y) * ${(1.0/TILE).toFixed(6)};`
    );

    shader.fragmentShader = 'varying vec2 vGrassUV;\nuniform sampler2D uGrass;\n'
        + shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float gn = texture2D(uGrass, vGrassUV).r;
         diffuseColor.rgb *= (0.65 + gn * 0.70);`
    );
};

function recomputePatch(mesh) {
    const cz   = mesh.position.z;
    const geo  = mesh.geometry;
    const pos  = geo.attributes.position;
    const col  = geo.attributes.color;
    const norm = geo.attributes.normal;
    const sw   = mesh.userData.segW;
    const sd   = mesh.userData.segD;

    for (let iz = 0; iz <= sd; iz++) {
        for (let ix = 0; ix <= sw; ix++) {
            const idx = iz * (sw + 1) + ix;
            const wx = pos.getX(idx);
            const wz = -pos.getY(idx) + cz;
            const h  = getHeightAt(wx, wz);
            pos.setZ(idx, h);

            const n = getNormalAt(wx, wz);
            norm.setXYZ(idx, n.x, -n.z, n.y);

            const t = THREE.MathUtils.clamp((0.97 - n.y) / 0.12, 0, 1);
            col.setXYZ(idx, GR + (BR - GR) * t, GG + (BG - GG) * t, GB + (BB - GB) * t);
        }
    }

    pos.needsUpdate  = true;
    col.needsUpdate  = true;
    norm.needsUpdate = true;
}

function createPatch(centerZ, w, d, sw, sd) {
    const geo  = new THREE.PlaneGeometry(w, d, sw, sd);
    const vCnt = (sw + 1) * (sd + 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vCnt * 3), 3));

    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.rotation.x    = -Math.PI / 2;
    mesh.position.z    = centerZ;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.segW = sw;
    mesh.userData.segD = sd;
    scene.add(mesh);
    recomputePatch(mesh);
    return mesh;
}

let patches = null;

function _ensurePatches() {
    if (patches) return;
    const search = new URLSearchParams(window.location.search);
    const mode   = search.get('mode');
    const isArena = !mode || (mode !== 'chase' && mode !== 'foot');

    if (isArena) {
        // Mode conduite libre : patch unique carré centré sur l'arène (r=80)
        patches = [ createPatch(0, ARENA_SIZE, ARENA_SIZE, ARENA_SEG, ARENA_SEG) ];
    } else {
        // Autres modes : 3 patches rectangulaires recyclés
        patches = [
            createPatch(0,             PATCH_W, PATCH_D, SEG_W, SEG_D),
            createPatch(-PATCH_D,      PATCH_W, PATCH_D, SEG_W, SEG_D),
            createPatch(-2 * PATCH_D,  PATCH_W, PATCH_D, SEG_W, SEG_D),
        ];
    }
}

export function refreshTerrain() {
    _ensurePatches();
    for (const p of patches) recomputePatch(p);
}

export function updateTerrain(carZ) {
    _ensurePatches();
    const search  = new URLSearchParams(window.location.search);
    const mode    = search.get('mode');
    // Arène (conduite libre) et poursuite : pas de défilement
    if (!mode || mode === 'chase') return;

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
