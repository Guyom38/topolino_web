// ── Relief de montagne autour du parking (centre plat) ───────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';

// Couleurs (herbe plate)
const GR = 0.28, GG = 0.52, GB = 0.15; // vert (herbe)

const TERRAIN_SIZE    = 500;
const SEG             = 2; // Plat, pas besoin de beaucoup de segments
const TERRAIN_CENTER_Z = 1;

let _mesh = null;

export function createParkingTerrain() {
    const geo  = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEG, SEG);
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(GR, GG, GB),
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
