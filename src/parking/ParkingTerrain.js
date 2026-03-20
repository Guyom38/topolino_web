// ── Relief de montagne autour du parking (centre plat) ───────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { getHeightAt } from '../terrain.js';

// Zone plate (parking + route périphérique + marge)
const FLAT_X     = 44;   // |x| < FLAT_X → plat
const FLAT_Z_MIN = -24;  // z > FLAT_Z_MIN → plat
const FLAT_Z_MAX =  28;  // z < FLAT_Z_MAX → plat
const BLEND      =  20;  // unités de transition douce

const TERRAIN_SIZE    = 500;
const SEG             = 80;
const TERRAIN_CENTER_Z = 1; // centre du mesh en world Z (≈ centre du parking)

const EPS = 1.0;

// Hauteur effective : 0 dans la zone plate, montagnes autour
function parkingHeight(x, z) {
    const dx   = Math.max(0, Math.abs(x) - FLAT_X);
    const dzN  = Math.max(0, FLAT_Z_MIN - z);
    const dzP  = Math.max(0, z - FLAT_Z_MAX);
    const dist = Math.max(dx, dzN, dzP);
    if (dist <= 0) return 0;

    const t  = Math.min(1, dist / BLEND);
    const ts = t * t * (3 - 2 * t); // smoothstep

    const raw = getHeightAt(x, z);
    // Toujours positif, amplifié avec la distance
    const h = Math.abs(raw) * (1 + ts * 2.5);
    return ts * Math.max(0, h);
}

// Couleurs
const GR = 0.28, GG = 0.52, GB = 0.15; // vert (herbe)
const BR = 0.42, BG = 0.28, BB = 0.12; // marron (roche)
const SR = 0.82, SG = 0.82, SB = 0.86; // gris-blanc (neige)

let _mesh = null;

export function createParkingTerrain() {
    const geo  = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEG, SEG);
    const vCnt = (SEG + 1) * (SEG + 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vCnt * 3), 3));

    const pos = geo.attributes.position;
    const col = geo.attributes.color;

    for (let i = 0; i < vCnt; i++) {
        // Coordonnées monde (avant rotation.x = -π/2 : worldX=posX, worldZ=TERRAIN_CENTER_Z-posY)
        const wx = pos.getX(i);
        const wz = TERRAIN_CENTER_Z - pos.getY(i);
        const h  = parkingHeight(wx, wz);
        pos.setZ(i, h);

        // Pente locale pour la couleur
        const hL = parkingHeight(wx - EPS, wz);
        const hR = parkingHeight(wx + EPS, wz);
        const hD = parkingHeight(wx, wz - EPS);
        const hU = parkingHeight(wx, wz + EPS);
        const nx = hL - hR, ny = 2 * EPS, nz = hD - hU;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const nyN = len > 0 ? ny / len : 1;

        const tSlope = THREE.MathUtils.clamp((0.97 - nyN) / 0.12, 0, 1);
        const tSnow  = THREE.MathUtils.clamp((h - 22) / 10,       0, 1);

        let r = GR + (BR - GR) * tSlope;
        let g = GG + (BG - GG) * tSlope;
        let b = GB + (BB - GB) * tSlope;
        r = r + (SR - r) * tSnow;
        g = g + (SG - g) * tSnow;
        b = b + (SB - b) * tSnow;
        col.setXYZ(i, r, g, b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.0,
    });

    _mesh = new THREE.Mesh(geo, mat);
    _mesh.rotation.x    = -Math.PI / 2;
    _mesh.position.set(0, -0.05, TERRAIN_CENTER_Z);
    _mesh.receiveShadow = true;
    scene.add(_mesh);
    return _mesh;
}

export function disposeParkingTerrain() {
    if (!_mesh) return;
    scene.remove(_mesh);
    _mesh.geometry.dispose();
    _mesh.material.dispose();
    _mesh = null;
}
