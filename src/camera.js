import * as THREE from 'three';
import { camera } from './scene.js';

// ── Paramètres orbitaux ───────────────────────────────────────────────────────
let PHI    = 0.92;           // angle vertical depuis le zénith (rad)
let THETA  = Math.PI * 0.80; // angle horizontal (rad)
let RADIUS = 55;             // distance caméra–cible (auto-gérée en mode conduite)

const RADIUS_MIN  = 10;
const RADIUS_MAX  = 200;
const TARGET_LERP = 0.07;

// ── Auto-zoom : activé par défaut (mode conduite libre) ───────────────────────
// Désactivé par les presets des modes arène (derby, tron, etc.)
let _autoZoom  = true;
let _userZoom  = 0;   // offset ajouté par la molette

// ── Contrôles souris ──────────────────────────────────────────────────────────
let _dragging = false, _mx = 0, _my = 0;

document.addEventListener('mousedown', e => {
    if (e.button === 0) { _dragging = true; _mx = e.clientX; _my = e.clientY; }
});
document.addEventListener('mouseup',   () => { _dragging = false; });
document.addEventListener('mousemove', e => {
    if (!_dragging) return;
    THETA -= (e.clientX - _mx) * 0.005;
    PHI    = THREE.MathUtils.clamp(PHI + (e.clientY - _my) * 0.005, 0.05, Math.PI * 0.48);
    _mx = e.clientX; _my = e.clientY;
});
document.addEventListener('wheel', e => {
    // La molette ajuste un offset sur le rayon auto ; il ne se réinitialise pas.
    _userZoom = THREE.MathUtils.clamp(_userZoom + e.deltaY * 0.05, -30, 60);
}, { passive: true });

// ── État interne ──────────────────────────────────────────────────────────────
const currentTarget = new THREE.Vector3();
let   initialized   = false;
const _centroid     = new THREE.Vector3();

// ── Debug ─────────────────────────────────────────────────────────────────────
export function getCameraDebug() {
    return {
        phi:    (PHI   * 180 / Math.PI).toFixed(1),
        theta:  (THETA * 180 / Math.PI).toFixed(1),
        radius: RADIUS.toFixed(1),
    };
}

// ── Cible fixe optionnelle (modes arène) ──────────────────────────────────────
let _fixedTarget = null;

export function setCameraFixed(x, y, z) {
    _fixedTarget = new THREE.Vector3(x, y, z);
    initialized  = false;
}
export function setCameraFollow() {
    _fixedTarget = null;
    _autoZoom    = true;
    _userZoom    = 0;
    initialized  = false;
}

// ── Presets par mode (désactivent l'auto-zoom) ───────────────────────────────
export function setParkingCamera() {
    PHI = 0.38; THETA = 0; RADIUS = 50; _userZoom = 0; _autoZoom = false;
}
export function setTronCamera() {
    PHI = 0.08; THETA = 0; RADIUS = 110; _userZoom = 0; _autoZoom = false;
}
export function setDerbyCamera() {
    PHI = 0.55; THETA = Math.PI * 0.8; RADIUS = 65; _userZoom = 0; _autoZoom = false;
}
export function setFootCamera() {
    PHI = 0.45; THETA = 0; RADIUS = 60; _userZoom = 0; _autoZoom = false;
}

// ── Helpers internes ─────────────────────────────────────────────────────────
function _applyCamera(target) {
    camera.position.set(
        target.x + RADIUS * Math.sin(PHI) * Math.sin(THETA),
        target.y + RADIUS * Math.cos(PHI),
        target.z + RADIUS * Math.sin(PHI) * Math.cos(THETA)
    );
    camera.lookAt(target);
    camera.updateProjectionMatrix();
}

// ── Caméra poursuite (mode chase — île) ──────────────────────────────────────
export function updateChaseCamera(players) {
    const allPlayers = Array.from(players.values()).filter(p => p.car);
    const active = allPlayers.filter(p => p.car.position.y > -50);

    let targetRadius = 60;

    if (active.length === 0) {
        _centroid.set(0, 0, 0);
    } else {
        _centroid.set(0, 0, 0);
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of active) {
            const px = THREE.MathUtils.clamp(p.car.position.x, -80, 80);
            const pz = THREE.MathUtils.clamp(p.car.position.z, -80, 80);
            _centroid.x += px; _centroid.z += pz;
            minX = Math.min(minX, px); maxX = Math.max(maxX, px);
            minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
        }
        _centroid.x /= active.length;
        _centroid.z /= active.length;
        _centroid.y  = 0;
        const maxSpan  = Math.max(maxX - minX, maxZ - minZ);
        targetRadius   = THREE.MathUtils.clamp(maxSpan * 1.5 + 45, 55, 150);
    }

    RADIUS += (targetRadius - RADIUS) * 0.04;

    if (!initialized) { currentTarget.copy(_centroid); initialized = true; }
    currentTarget.lerp(_centroid, TARGET_LERP);
    _applyCamera(currentTarget);
}

// ── Caméra principale (mode conduite + modes arène) ──────────────────────────
export function updateCamera(players) {
    const active = Array.from(players.values()).filter(p => p.car);
    if (active.length === 0) return;

    // Centroïde de tous les joueurs actifs
    let cx = 0, cz = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of active) {
        cx += p.car.position.x;
        cz += p.car.position.z;
        minX = Math.min(minX, p.car.position.x);
        maxX = Math.max(maxX, p.car.position.x);
        minZ = Math.min(minZ, p.car.position.z);
        maxZ = Math.max(maxZ, p.car.position.z);
    }
    cx /= active.length;
    cz /= active.length;
    _centroid.set(cx, 0, cz);

    // Mise à jour de la cible interpolée
    if (_fixedTarget) {
        if (!initialized) { currentTarget.copy(_fixedTarget); initialized = true; }
        currentTarget.lerp(_fixedTarget, TARGET_LERP);
    } else {
        if (!initialized) { currentTarget.copy(_centroid); initialized = true; }
        currentTarget.lerp(_centroid, TARGET_LERP);
    }

    // Auto-zoom dynamique (mode conduite uniquement)
    if (_autoZoom) {
        const span        = Math.max(maxX - minX, maxZ - minZ);
        // Rayon auto : base 42 + 1.2× l'écartement max des joueurs
        const autoRadius  = THREE.MathUtils.clamp(span * 1.2 + 42, 38, 160);
        const targetRadius = THREE.MathUtils.clamp(autoRadius + _userZoom, RADIUS_MIN, RADIUS_MAX);
        // Interpolation fluide pour éviter les sauts
        RADIUS += (targetRadius - RADIUS) * 0.045;
    }

    _applyCamera(currentTarget);
}
