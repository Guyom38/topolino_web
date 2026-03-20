// ── Orchestrateur du mode parking ────────────────────────────────────────────
import * as THREE from 'three';
import { scene, sun } from '../scene.js';
import { loadStaticCar } from '../car.js';
import { SPOTS, STARTING_POSITIONS } from './ParkingSpots.js';
import { createParkingLot } from './ParkingLot.js';
import { scorePlayer } from './ParkingScorer.js';
import { getLocalPlayer } from '../multiplayer.js';
import {
    initParkingUI, updateParkingTimer, updateParkingScores,
    hideParkingUI, updateScoreSprites, disposeScoreSprites,
    showWrongWay, hideWrongWay,
} from './ParkingUI.js';
import { setParkingCamera, setCameraFixed } from '../camera.js';
import { createParkingTerrain, disposeParkingTerrain } from './ParkingTerrain.js';

export const RACE_DURATION = 60; // secondes

let _lot        = null;
let _staticCars = [];
let _startTime  = null;
let _phase      = 'countdown';
let _scores     = new Map();

// ── Détection contresens ──────────────────────────────────────────────────────
// Circuit antihoraire :
//   droite du bas  Z=[+11,+18]  → sens +X (est)
//   droite droite  X=[+30,+37]  → sens -Z (nord)
//   droite du haut Z=[-11,-18]  → sens -X (ouest)
//   droite gauche  X=[-37,-30]  → sens +Z (sud)
function isWrongWay(p) {
    if (!p.car || Math.abs(p.carSpeed) < 0.02) return false;
    const x  = p.car.position.x;
    const z  = p.car.position.z;
    const fx = -Math.sin(p.carAngle);   // composante X de la direction
    const fz = -Math.cos(p.carAngle);   // composante Z de la direction

    if (z > 11 && z < 18 && Math.abs(x) < 36) return fx < -0.4;   // bas → doit aller est
    if (x > 30 && x < 37 && Math.abs(z) < 16)  return fz >  0.4;  // droite → doit aller nord
    if (z < -11 && z > -18 && Math.abs(x) < 36) return fx >  0.4; // haut → doit aller ouest
    if (x < -30 && x > -37 && Math.abs(z) < 16) return fz < -0.4; // gauche → doit aller sud
    return false;
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initParkingMode(players) {
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.006);

    sun.position.set(-50, 70, 30);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    sun.intensity = 2.2;

    _lot = createParkingLot();
    createParkingTerrain();

    // Voitures statiques sur les places occupées avec un léger décalage (mauvais conducteurs)
    _staticCars = [];
    for (const spot of SPOTS) {
        if (!spot.empty) {
            // Décalage aléatoire pour plus de réalisme
            const offsetX = (Math.random() - 0.5) * 0.8;
            const offsetZ = (Math.random() - 0.5) * 0.8;
            const offsetA = (Math.random() - 0.5) * 0.15; // légère rotation
            
            const sx = spot.x + offsetX;
            const sz = spot.z + offsetZ;
            const sa = spot.angle + offsetA;

            const m = await loadStaticCar(sx, sz, sa);
            if (m) _staticCars.push(m);
        }
    }

    // Grille de départ F1 pour chaque joueur
    let idx = 0;
    for (const [, p] of players) {
        if (!p.car) continue;
        const pos = STARTING_POSITIONS[idx % STARTING_POSITIONS.length];
        p.car.position.set(pos.x, 0, pos.z);
        p.car.rotation.y   = pos.angle;
        p.carAngle          = pos.angle;
        p.carSpeed          = 0;
        p.velocity.set(0, 0, 0);
        p.verticalVelocity  = 0;
        p._wrongWayFrames   = 0;
        p._wrongWayPenalty  = 0;
        p._suspInit         = false; // forcer réinitialisation suspension sur terrain plat
        idx++;
    }

    setParkingCamera();
    setCameraFixed(0, 0, 0);
    initParkingUI();
    _phase     = 'racing';
    _startTime = performance.now();
    _scores    = new Map();
}

// ── Update ────────────────────────────────────────────────────────────────────
export function updateParkingMode(players, now) {
    if (!_startTime) return;

    const elapsed   = (now - _startTime) / 1000;
    const remaining = RACE_DURATION - elapsed;

    if (_phase === 'racing') {
        // ── Contresens ────────────────────────────────────────────────────────
        for (const [id, p] of players) {
            if (!p.car) continue;
            if (isWrongWay(p)) {
                p._wrongWayFrames  = (p._wrongWayFrames  || 0) + 1;
                // Force de décélération progressive
                p.carSpeed        *= 0.94;
                if (p._wrongWayFrames > 90) {
                    // 1.5 s de contresens → pénalité accumulée
                    p._wrongWayPenalty = (p._wrongWayPenalty || 0) + 1;
                    p._wrongWayFrames  = 0;
                }
                showWrongWay(id);
            } else {
                p._wrongWayFrames = 0;
                hideWrongWay(id);
            }
        }

        if (remaining <= 0) {
            _phase = 'ended';
            for (const [, p] of players) {
                p.keys = { up: false, down: false, left: false, right: false, jx: 0, jy: 0 };
            }
        }
        updateParkingTimer(remaining, 'racing');

    } else if (_phase === 'ended') {
        updateParkingTimer(0, 'ended');
        for (const [, p] of players) {
            p.keys = { up: false, down: false, left: false, right: false, jx: 0, jy: 0 };
        }
    }

    // Toujours mettre à jour les scores pour le feedback dynamique
    for (const [id, p] of players) {
        _scores.set(id, scorePlayer(p));
    }

    updateParkingScores(players, _scores);
    updateScoreSprites(players, _scores, scene);

    // ── Update Feedback visuel des places ─────────────────────────────────────
    if (_phase === 'racing' || _phase === 'ended') {
        const lp = getLocalPlayer();
        const sc = _scores.get(lp?.id);
        
        // Réinitialiser tous les feedbacks
        for (const spot of SPOTS) {
            if (!spot._feedbackMesh) continue;
            spot._feedbackMesh.material.uniforms.uOpacity.value = 0.0;
        }

        // Si le joueur est sur une place, on l'allume
        if (sc && sc.spot && sc.spot._feedbackMesh) {
            const mesh = sc.spot._feedbackMesh;
            mesh.material.uniforms.uOpacity.value = 0.5;
            
            // Score maximum de position/angle ≈ 80.
            const perf = sc.total - sc.spot.baseScore; // entre 0 et ~80
            
            // Rouge si mauvais, orange si moyen, vert si parfait
            if (perf > 65) {
                mesh.material.uniforms.uColor.value.setHex(0x00ff00); // Vert
            } else if (perf > 40) {
                mesh.material.uniforms.uColor.value.setHex(0xffaa00); // Orange
            } else {
                mesh.material.uniforms.uColor.value.setHex(0xff0000); // Rouge
            }
        }
    }
}

export function getParkingTerrainY() { return 0; }
export function isParkingActive()    { return _phase === 'racing'; }
export function getStaticCars()      { return _staticCars; }

// ── Dispose ───────────────────────────────────────────────────────────────────
export function disposeParkingMode() {
    if (_lot) { _lot.dispose(); _lot = null; }
    _staticCars.forEach(m => {
        scene.remove(m);
        m.traverse(c => {
            if (!c.isMesh) return;
            c.geometry.dispose();
            (Array.isArray(c.material) ? c.material : [c.material]).forEach(mat => mat.dispose());
        });
    });
    _staticCars = [];
    hideParkingUI();
    disposeScoreSprites(scene);
    disposeParkingTerrain();
    _startTime = null;
    _phase     = 'countdown';
    _scores    = new Map();
}
