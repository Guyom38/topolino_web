// ── Orchestrateur du mode parking ────────────────────────────────────────────
import * as THREE from 'three';
import { scene, sun } from '../scene.js';
import { loadStaticCar } from '../car.js';
import { SPOTS, STARTING_POSITIONS } from './ParkingSpots.js';
import { createParkingLot } from './ParkingLot.js';
import { scorePlayer } from './ParkingScorer.js';
import {
    initParkingUI,
    updateParkingTimer,
    updateParkingScores,
    hideParkingUI,
    updateScoreSprites,
    disposeScoreSprites,
} from './ParkingUI.js';
import { setParkingCamera } from '../camera.js';

const RACE_DURATION = 60; // secondes

let _lot       = null;
let _staticCars = [];
let _startTime = null;
let _phase     = 'countdown'; // 'countdown' | 'racing' | 'ended'
let _scores    = new Map();
let _frozenAt  = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initParkingMode(players) {
    // Ciel et brouillard
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

    // Soleil positionné pour le parking
    sun.position.set(40, 60, 20);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    sun.intensity = 2.0;

    // Construire la géométrie du parking
    _lot = createParkingLot();

    // Charger les voitures statiques sur les places occupées
    _staticCars = [];
    for (const spot of SPOTS) {
        if (!spot.empty) {
            const mesh = await loadStaticCar(spot.x, spot.z, spot.angle);
            if (mesh) _staticCars.push(mesh);
        }
    }

    // Positionner les voitures des joueurs à la ligne de départ
    let idx = 0;
    for (const [, p] of players) {
        if (!p.car) continue;
        const pos = STARTING_POSITIONS[idx % STARTING_POSITIONS.length];
        p.car.position.set(pos.x, 0, pos.z);
        p.car.rotation.y  = 0; // face au sud (vers -Z = vers le parking)
        p.carAngle        = 0;
        p.carSpeed        = 0;
        p.velocity.set(0, 0, 0);
        p.verticalVelocity = 0;
        idx++;
    }

    // Configurer la caméra
    setParkingCamera();

    // Initialiser l'interface
    initParkingUI();
    _phase     = 'racing';
    _startTime = performance.now();
    _scores    = new Map();
}

// ── Update (appelé chaque frame) ──────────────────────────────────────────────

export function updateParkingMode(players, now) {
    if (!_startTime) return;

    const elapsed   = (now - _startTime) / 1000;
    const remaining = RACE_DURATION - elapsed;

    if (_phase === 'racing') {
        if (remaining <= 0) {
            _phase    = 'ended';
            _frozenAt = now;

            // Calculer le score de chaque joueur
            for (const [id, p] of players) {
                _scores.set(id, scorePlayer(p));
            }

            // Immobiliser les voitures
            for (const [, p] of players) {
                p.keys = { up: false, down: false, left: false, right: false, jx: 0, jy: 0 };
            }
        }
        updateParkingTimer(remaining, 'racing');
    } else if (_phase === 'ended') {
        updateParkingTimer(0, 'ended');

        // Continuer à immobiliser les voitures
        for (const [, p] of players) {
            p.keys = { up: false, down: false, left: false, right: false, jx: 0, jy: 0 };
        }
    }

    // Mettre à jour l'affichage des scores et les sprites 3D
    updateParkingScores(players, _scores);
    updateScoreSprites(players, _scores, scene);
}

// Hauteur de terrain (le parking est plat)
export function getParkingTerrainY() { return 0; }

// Le jeu est-il encore en cours ?
export function isParkingActive() { return _phase === 'racing'; }

// ── Dispose ───────────────────────────────────────────────────────────────────

export function disposeParkingMode() {
    if (_lot) { _lot.dispose(); _lot = null; }

    _staticCars.forEach(m => {
        scene.remove(m);
        m.traverse(c => {
            if (c.isMesh) {
                c.geometry.dispose();
                if (Array.isArray(c.material)) {
                    c.material.forEach(mat => mat.dispose());
                } else {
                    c.material.dispose();
                }
            }
        });
    });
    _staticCars = [];

    hideParkingUI();
    disposeScoreSprites(scene);

    _startTime = null;
    _phase     = 'countdown';
    _scores    = new Map();
}
