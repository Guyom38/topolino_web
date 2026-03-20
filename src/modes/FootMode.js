// ── Mode Football : balle + buts + terrain ────────────────────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setFootCamera, setCameraFollow, setCameraFixed } from '../camera.js';

const FIELD_W   = 90;   // largeur du terrain
const FIELD_D   = 60;   // profondeur (axe Z)
const GOAL_W    = 12;   // largeur du but
const GOAL_H    = 4;    // hauteur des poteaux
const BALL_R    = 0.8;  // rayon de la balle
const BALL_MASS = 0.6;  // plus légère qu'une voiture
const FRICTION  = 0.985;
const CAR_PUSH  = 0.32; // force de poussée voiture → balle

let _field      = null;
let _goals      = [];   // [{teamA: mesh, teamB: mesh}]
let _ball       = null;
let _ballVel    = new THREE.Vector3();
let _scores     = { A: 0, B: 0 };
let _teamMap    = new Map(); // playerId → 'A' | 'B'
let _phase      = 'playing';
let _statusEl   = null;
let _scoreEl    = null;
let _goalFlash  = 0;   // frames de flash après but

// ── Terrain ───────────────────────────────────────────────────────────────────
function _createField() {
    const group = new THREE.Group();

    // Gazon vert
    const grass = new THREE.Mesh(
        new THREE.PlaneGeometry(FIELD_W, FIELD_D),
        new THREE.MeshStandardMaterial({ color: 0x2d7a2d, roughness: 0.9 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    group.add(grass);

    // Lignes blanches (canvas texture)
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = Math.round(1024 * FIELD_D / FIELD_W);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 8;
    // Bordure
    ctx.strokeRect(16, 16, cv.width - 32, cv.height - 32);
    // Ligne médiane
    ctx.beginPath(); ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height); ctx.stroke();
    // Cercle central
    ctx.beginPath(); ctx.arc(cv.width / 2, cv.height / 2, cv.height * 0.18, 0, Math.PI * 2); ctx.stroke();
    // Point central
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(cv.width / 2, cv.height / 2, 10, 0, Math.PI * 2); ctx.fill();

    const lineTex = new THREE.CanvasTexture(cv);
    const lines = new THREE.Mesh(
        new THREE.PlaneGeometry(FIELD_W, FIELD_D),
        new THREE.MeshBasicMaterial({ map: lineTex, transparent: true, depthWrite: false })
    );
    lines.rotation.x = -Math.PI / 2;
    lines.position.y = 0.01;
    group.add(lines);

    scene.add(group);
    return group;
}

function _createGoals() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 });
    const goals = [];

    [-1, 1].forEach((side, si) => {
        const gx = side * (FIELD_W / 2);
        const gGroup = new THREE.Group();
        gGroup.position.set(gx, 0, 0);

        // Poteaux (2 verticaux + 1 barre horizontale)
        const postGeo = new THREE.CylinderGeometry(0.18, 0.18, GOAL_H, 8);
        const crossGeo = new THREE.CylinderGeometry(0.18, 0.18, GOAL_W, 8);

        const postL = new THREE.Mesh(postGeo, mat);
        postL.position.set(0, GOAL_H / 2, -GOAL_W / 2);
        gGroup.add(postL);

        const postR = new THREE.Mesh(postGeo, mat);
        postR.position.set(0, GOAL_H / 2, GOAL_W / 2);
        gGroup.add(postR);

        const cross = new THREE.Mesh(crossGeo, mat);
        cross.rotation.z = Math.PI / 2;
        cross.position.set(0, GOAL_H, 0);
        gGroup.add(cross);

        // Filet (mesh semi-transparent)
        const netGeo = new THREE.BoxGeometry(3, GOAL_H, GOAL_W);
        const netMat = new THREE.MeshBasicMaterial({
            color: si === 0 ? 0xff4444 : 0x4488ff,
            transparent: true, opacity: 0.18, side: THREE.DoubleSide
        });
        const net = new THREE.Mesh(netGeo, netMat);
        net.position.set(side * 1.4, GOAL_H / 2, 0);
        gGroup.add(net);

        gGroup.rotation.y = si === 0 ? 0 : Math.PI;
        scene.add(gGroup);
        goals.push({ group: gGroup, side, teamScore: si === 0 ? 'B' : 'A' }); // but côté A → point pour B
    });

    return goals;
}

function _createBall() {
    const geo = new THREE.SphereGeometry(BALL_R, 16, 16);
    // Ballon noir et blanc (pentagones) via canvas
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#111';
    // Pentagones simplifiés
    [[128, 0], [0, 80], [256, 80], [50, 210], [206, 210]].forEach(([cx, cy]) => {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = (i * 72 - 90) * Math.PI / 180;
            const x = cx + 28 * Math.cos(a), y = cy + 28 * Math.sin(a);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
    });
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(0, BALL_R, 0);
    scene.add(mesh);
    return mesh;
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initFootMode(players) {
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = null;

    _field  = _createField();
    _goals  = _createGoals();
    _ball   = _createBall();
    _ballVel.set(0, 0, 0);
    _scores = { A: 0, B: 0 };
    _teamMap.clear();
    _phase  = 'playing';
    _goalFlash = 0;

    // Assigner les équipes : alternance A/B
    const pArr = Array.from(players.values()).filter(p => p.car);
    pArr.forEach((p, i) => {
        const team = i % 2 === 0 ? 'A' : 'B';
        _teamMap.set(p.id, team);
        // Placement selon équipe
        const side = team === 'A' ? -1 : 1;
        p.car.position.set(side * 20 + (Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 16);
        p.carAngle = team === 'A' ? 0 : Math.PI;
        p.car.rotation.y = p.carAngle;
        p.carSpeed = 0;
        p.velocity.set(0, 0, 0);
    });

    setFootCamera();
    setCameraFixed(0, 0, 0);

    // HUD score
    _scoreEl = document.createElement('div');
    _scoreEl.id = 'foot-score';
    Object.assign(_scoreEl.style, {
        position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '42px', fontWeight: '900', color: '#fff',
        fontFamily: 'monospace', letterSpacing: '8px',
        textShadow: '0 0 16px rgba(0,0,0,0.8)',
        pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(_scoreEl);

    // HUD status
    _statusEl = document.createElement('div');
    _statusEl.id = 'foot-status';
    Object.assign(_statusEl.style, {
        position: 'absolute', top: '72px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '24px', fontWeight: '800', color: '#ffdd00',
        fontFamily: 'monospace',
        textShadow: '0 0 12px rgba(0,0,0,0.9)',
        pointerEvents: 'none', zIndex: '100', display: 'none',
    });
    document.body.appendChild(_statusEl);

    _updateScoreHUD();
}

// ── Update ────────────────────────────────────────────────────────────────────
export function updateFootMode(players, now) {
    if (!_ball) return;

    // Rotation visuelle de la balle selon sa vélocité
    const speed = _ballVel.length();
    if (speed > 0.001) {
        const axis = new THREE.Vector3(-_ballVel.z, 0, _ballVel.x).normalize();
        _ball.rotateOnWorldAxis(axis, speed / BALL_R);
    }

    // Friction
    _ballVel.x *= FRICTION;
    _ballVel.z *= FRICTION;

    // Gravité / rebond sur sol
    _ball.position.y += _ballVel.y;
    _ballVel.y -= 0.018;
    if (_ball.position.y <= BALL_R) {
        _ball.position.y = BALL_R;
        _ballVel.y = Math.abs(_ballVel.y) * 0.45;
        if (Math.abs(_ballVel.y) < 0.02) _ballVel.y = 0;
    }

    // Déplacement horizontal
    _ball.position.x += _ballVel.x;
    _ball.position.z += _ballVel.z;

    // Rebond sur les bords du terrain (sauf zones de but)
    const halfW = FIELD_W / 2;
    const halfD = FIELD_D / 2;
    const inGoalZ = Math.abs(_ball.position.z) < GOAL_W / 2;

    if (Math.abs(_ball.position.z) > halfD) {
        _ball.position.z = Math.sign(_ball.position.z) * halfD;
        _ballVel.z *= -0.6;
    }
    if (Math.abs(_ball.position.x) > halfW && !inGoalZ) {
        _ball.position.x = Math.sign(_ball.position.x) * halfW;
        _ballVel.x *= -0.6;
    }

    // Voitures → poussée de la balle
    for (const p of players.values()) {
        if (!p.car) continue;
        const dx = _ball.position.x - p.car.position.x;
        const dz = _ball.position.z - p.car.position.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        const touchR = BALL_R + 1.3;
        if (dist < touchR && dist > 0.01) {
            const nx = dx / dist, nz = dz / dist;
            // Dépénétration
            const overlap = touchR - dist;
            _ball.position.x += nx * overlap;
            _ball.position.z += nz * overlap;
            // Impulsion proportionnelle à la vitesse de la voiture
            const carSpeedProj = p.velocity.x * nx + p.velocity.z * nz;
            const imp = Math.max(carSpeedProj, 0) * CAR_PUSH + 0.06;
            _ballVel.x += nx * imp;
            _ballVel.z += nz * imp;
            _ballVel.y += 0.04;
        }
    }

    // Détection de but
    for (const goal of _goals) {
        const gx = goal.side * (FIELD_W / 2);
        const inGoalX = goal.side === -1
            ? _ball.position.x < gx + 3
            : _ball.position.x > gx - 3;
        if (inGoalX && Math.abs(_ball.position.z) < GOAL_W / 2 && _ball.position.y < GOAL_H) {
            _scores[goal.teamScore]++;
            _goalFlash = 120;
            _ball.position.set(0, BALL_R, 0);
            _ballVel.set(0, 0, 0);
            _updateScoreHUD();
            if (_statusEl) {
                _statusEl.textContent = `⚽ BUT de l'équipe ${goal.teamScore} !`;
                _statusEl.style.display = 'block';
                setTimeout(() => { if (_statusEl) _statusEl.style.display = 'none'; }, 2500);
            }
        }
    }

    // Flash de but
    if (_goalFlash > 0) {
        _goalFlash--;
        scene.background = new THREE.Color(_goalFlash % 8 < 4 ? 0xffffaa : 0x87ceeb);
    }
}

function _updateScoreHUD() {
    if (!_scoreEl) return;
    _scoreEl.innerHTML =
        `<span style="color:#ff8888">🔴 ${_scores.A}</span>` +
        ` &ndash; ` +
        `<span style="color:#88aaff">${_scores.B} 🔵</span>`;
}

export function disposeFootMode() {
    if (_field) { scene.remove(_field); _field = null; }
    for (const g of _goals) scene.remove(g.group);
    _goals = [];
    if (_ball) { scene.remove(_ball); _ball.geometry.dispose(); _ball.material.dispose(); _ball = null; }
    _scoreEl?.remove(); _scoreEl = null;
    _statusEl?.remove(); _statusEl = null;
    _teamMap.clear();
    setCameraFollow();
    scene.background = new THREE.Color(0x87ceeb);
}

export function isFootActive() { return _phase === 'playing'; }
