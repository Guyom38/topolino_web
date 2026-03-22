import * as THREE from 'three';
import { camera } from './scene.js';

// ── Paramètres orbitaux ───────────────────────────────────────────────────────
let PHI    = 0.80;           // angle vertical depuis le zénith (rad)
let THETA  = Math.PI * 0.80; // angle horizontal (rad)
let RADIUS = 36;             // distance caméra–cible (auto-gérée en mode conduite)

const RADIUS_MIN  = 10;
const RADIUS_MAX  = 200;
const TARGET_LERP = 0.07;

// ── Auto-zoom : activé par défaut (mode conduite libre) ───────────────────────
// Désactivé par les presets des modes arène (derby, tron, etc.)
let _autoZoom  = true;
let _userZoom  = 0;   // offset ajouté par la molette

// ── Contrôles souris ──────────────────────────────────────────────────────────
let _dragging = false, _panning = false, _mx = 0, _my = 0;

document.addEventListener('mousedown', e => {
    if (e.button === 0) { _dragging = true; _mx = e.clientX; _my = e.clientY; }
    if (e.button === 2) { _panning  = true; _mx = e.clientX; _my = e.clientY; }
});
document.addEventListener('mouseup',   e => {
    if (e.button === 0) _dragging = false;
    if (e.button === 2) _panning  = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
    const dx = e.clientX - _mx;
    const dy = e.clientY - _my;
    _mx = e.clientX; _my = e.clientY;

    if (_dragging) {
        THETA -= dx * 0.005;
        PHI    = THREE.MathUtils.clamp(PHI + dy * 0.005, 0.05, Math.PI * 0.48);
    }
    if (_panning && !_autoZoom) {
        // Pan uniquement en mode fixe (arène) — désactivé en auto-suivi joueurs
        const speed = RADIUS * 0.0015;
        const cosT  = Math.cos(THETA), sinT = Math.sin(THETA);
        currentTarget.x += (-dx * cosT + dy * Math.cos(PHI) * sinT) * speed;
        currentTarget.z += ( dx * sinT + dy * Math.cos(PHI) * cosT) * speed;
    }
});
document.addEventListener('wheel', e => {
    _userZoom = THREE.MathUtils.clamp(_userZoom + e.deltaY * 0.05, -30, 60);
}, { passive: true });

// ── Debug console (toutes les secondes) ───────────────────────────────────────
let _lastLog = 0;
export function tickCameraDebug(now) {
    if (now - _lastLog < 1000) return;
    _lastLog = now;
    console.log(`[Caméra] PHI=${(PHI * 180 / Math.PI).toFixed(1)}°  THETA=${(THETA * 180 / Math.PI).toFixed(1)}°  RADIUS=${RADIUS.toFixed(1)}  target=(${currentTarget.x.toFixed(1)}, ${currentTarget.y.toFixed(1)}, ${currentTarget.z.toFixed(1)})`);
}

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
    if (active.length === 0) {
        // Aucune voiture encore spawnée → position d'attente aérienne
        if (_fixedTarget) {
            _applyCamera(_fixedTarget);
        } else {
            camera.position.set(0, 22, 18);
            camera.lookAt(0, 0, 0);
        }
        return;
    }

    // Centroïde de tous les joueurs actifs
    let cx = 0, cy = 0, cz = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of active) {
        cx += p.car.position.x;
        cy += p.car.position.y;
        cz += p.car.position.z;
        minX = Math.min(minX, p.car.position.x);
        maxX = Math.max(maxX, p.car.position.x);
        minZ = Math.min(minZ, p.car.position.z);
        maxZ = Math.max(maxZ, p.car.position.z);
    }
    cx /= active.length;
    cy /= active.length;
    cz /= active.length;
    // Suivre la hauteur réelle du joueur (vallées, collines)
    // Clamp pour éviter les extrêmes (grands sauts, chutes)
    _centroid.set(cx, THREE.MathUtils.clamp(cy, -9, 16), cz);

    // Cible = centroïde exact de tous les joueurs (ou cible fixe en mode arène)
    const dest = _fixedTarget ?? _centroid;
    if (!initialized) { currentTarget.copy(dest); initialized = true; }
    currentTarget.lerp(dest, TARGET_LERP);

    // Auto-zoom + auto-PHI dynamiques (mode conduite uniquement)
    if (_autoZoom) {
        const span = Math.max(maxX - minX, maxZ - minZ);

        // Rayon : couvre tout l'écartement + ~10 unités de marge de chaque côté
        const autoRadius   = THREE.MathUtils.clamp(span * 0.9 + 18, 18, 115);
        const targetRadius = THREE.MathUtils.clamp(autoRadius + _userZoom, RADIUS_MIN, RADIUS_MAX);
        RADIUS += (targetRadius - RADIUS) * 0.04;

        // PHI : 60° si joueurs proches → 0° si joueurs éloignés (vue du dessus)
        const PHI_CLOSE  = Math.PI / 3;   // 60°
        const PHI_FAR    = 0.05;          // quasi top-down
        const spanNorm   = THREE.MathUtils.clamp((span - 5) / 60, 0, 1);
        const targetPHI  = THREE.MathUtils.lerp(PHI_CLOSE, PHI_FAR, spanNorm);
        PHI += (targetPHI - PHI) * 0.03;
    }

    _applyCamera(currentTarget);
}
