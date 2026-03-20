// ── Relief de montagne autour du parking (centre plat) ───────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';

// --- Bruit fBm (même formule que terrain.js) ---
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

const H_SCALE  = 1 / 90;
const M_SCALE  = 1 / 280;
const M_THRESH = 0.62;
const H_AMP    = 22;    // Amplitude verticale des montagnes
const FLAT_R   = 50;    // Rayon de la zone plate (couvre tout le parking + marge)
const FULL_R   = 75;    // Rayon où les montagnes sont à plein amplitude

function getParkingHeight(wx, wz) {
    const dist = Math.sqrt(wx * wx + wz * wz);
    const blend = Math.max(0, Math.min(1, (dist - FLAT_R) / (FULL_R - FLAT_R)));
    const blendEase = blend * blend; // ease-in pour transition douce

    if (blendEase === 0) return -0.05; // Centre plat sous le parking

    let v = 0, a = 1, f = H_SCALE;
    for (let i = 0; i < 4; i++) {
        v += a * smoothNoise(wx * f, wz * f);
        a *= 0.5; f *= 2;
    }
    const base = (v / 1.875 - 0.5) * H_AMP;

    // Masque montagne pour des pics isolés
    const mask = smoothNoise(wx * M_SCALE, wz * M_SCALE);
    const t    = Math.max(0, (mask - M_THRESH) / (1 - M_THRESH));
    const h    = base + t * t * base * 2.5;

    return -0.05 + h * blendEase;
}

const EPS = 0.5;

function getParkingNormal(wx, wz) {
    const hL = getParkingHeight(wx - EPS, wz);
    const hR = getParkingHeight(wx + EPS, wz);
    const hD = getParkingHeight(wx, wz - EPS);
    const hU = getParkingHeight(wx, wz + EPS);
    return new THREE.Vector3(hL - hR, 2.0 * EPS, hD - hU).normalize();
}

const SIZE = 400;
const SEG  = 64;

const GR = 0.28, GG = 0.52, GB = 0.15; // vert (herbe plate)
const BR = 0.42, BG = 0.28, BB = 0.12; // marron (pente)

let _mesh = null;

export function createParkingTerrain() {
    const geo  = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const vCnt = (SEG + 1) * (SEG + 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vCnt * 3), 3));

    const pos  = geo.attributes.position;
    const col  = geo.attributes.color;
    const norm = geo.attributes.normal;

    for (let iz = 0; iz <= SEG; iz++) {
        for (let ix = 0; ix <= SEG; ix++) {
            const idx = iz * (SEG + 1) + ix;
            const wx  = pos.getX(idx);
            const wz  = -pos.getY(idx); // après rotation.x=-PI/2, local Y → -world Z

            const h = getParkingHeight(wx, wz);
            pos.setZ(idx, h);

            const n = getParkingNormal(wx, wz);
            // Mapping world normal → local normal (même convention que terrain.js)
            norm.setXYZ(idx, n.x, n.z, n.y);

            const t = THREE.MathUtils.clamp((0.97 - n.y) / 0.12, 0, 1);
            col.setXYZ(idx, GR + (BR - GR) * t, GG + (BG - GG) * t, GB + (BB - GB) * t);
        }
    }

    pos.needsUpdate  = true;
    col.needsUpdate  = true;
    norm.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.90,
        metalness: 0.0,
    });

    _mesh = new THREE.Mesh(geo, mat);
    _mesh.rotation.x    = -Math.PI / 2;
    _mesh.position.set(0, 0, 0);
    _mesh.castShadow    = true;
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
