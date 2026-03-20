import * as THREE from 'three';
import { camera } from './scene.js';

// ── Paramètres de vue (modifiables à chaud via la souris) ─────────────────────
let PHI    = 0.92;           // angle vertical depuis le zénith (rad)
let THETA  = Math.PI * 0.80; // angle horizontal (rad)
let RADIUS = 55;             // distance caméra–cible

const RADIUS_MIN  = 10;
const RADIUS_MAX  = 200;
const TARGET_LERP = 0.10;

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
    RADIUS = THREE.MathUtils.clamp(RADIUS + e.deltaY * 0.05, RADIUS_MIN, RADIUS_MAX);
}, { passive: true });

// ── État interne ──────────────────────────────────────────────────────────────
const currentTarget = new THREE.Vector3();
let   initialized   = false;
const _centroid     = new THREE.Vector3();

// ── Debug (lu par ui.js) ──────────────────────────────────────────────────────
export function getCameraDebug() {
    return {
        phi:    (PHI   * 180 / Math.PI).toFixed(1),
        theta:  (THETA * 180 / Math.PI).toFixed(1),
        radius: RADIUS.toFixed(1),
    };
}

// ── Mode parking : vue paysage TV (lot 80×44 unités, 16:9) ───────────────────
export function setParkingCamera() {
    PHI    = 0.38;  // ~22° depuis le zénith — vue large
    THETA  = 0;     // caméra au sud (+Z), regarde vers le nord (-Z)
    RADIUS = 80;    // recul suffisant pour FOV 75° sur 80 unités de large
}

/**
 * Mise à jour chaque frame.
 * @param {Map} players — Map<id, PlayerCar>
 */
export function updateCamera(players) {
    const active = Array.from(players.values()).filter(p => p.car);
    if (active.length === 0) return;

    _centroid.set(0, 0, 0);
    for (const p of active) _centroid.add(p.car.position);
    _centroid.divideScalar(active.length);

    if (!initialized) {
        currentTarget.copy(_centroid);
        initialized = true;
    }

    currentTarget.lerp(_centroid, TARGET_LERP);

    camera.position.set(
        currentTarget.x + RADIUS * Math.sin(PHI) * Math.sin(THETA),
        currentTarget.y + RADIUS * Math.cos(PHI),
        currentTarget.z + RADIUS * Math.sin(PHI) * Math.cos(THETA)
    );
    camera.lookAt(currentTarget);
    camera.updateProjectionMatrix();
}
