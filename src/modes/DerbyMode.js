// ── Mode Destruction Derby : arène circulaire, chute dans le vide ─────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setDerbyCamera, setCameraFollow } from '../camera.js';

const ARENA_R      = 45;   // rayon de la plateforme
const FALL_R       = 48;   // distance à partir de laquelle on "tombe"
const MAX_LIVES    = 3;
const RESPAWN_TIME = 2500; // ms avant respawn
const FALL_SPEED   = 0.18; // vitesse de chute visuelle

let _platform   = null;
let _rimMesh    = null;
let _lives      = new Map();   // playerId → { lives, falling, fallTime, lastPos }
let _phase      = 'racing';
let _statusEl   = null;
let _livesEls   = new Map();   // playerId → DOM div

// ── Arène ─────────────────────────────────────────────────────────────────────
function _createArena() {
    const group = new THREE.Group();

    // Plateforme circulaire
    const geo = new THREE.CylinderGeometry(ARENA_R, ARENA_R, 0.6, 64);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85, metalness: 0.05 });
    const platform = new THREE.Mesh(geo, mat);
    platform.receiveShadow = true;
    platform.position.y = -0.3;
    group.add(platform);

    // Bordure lumineuse (anneau)
    const rimGeo = new THREE.TorusGeometry(ARENA_R, 0.35, 8, 80);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 1.5 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    group.add(rim);

    // Sol texturé (grille de combat)
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#6b5035';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#4a3520';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 20; i++) {
        const p = i / 20 * 512;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(512, p); ctx.stroke();
    }
    // Cercles concentriques
    ctx.strokeStyle = '#3a2510';
    [128, 256, 384].forEach(r => {
        ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke();
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    const gridMesh = new THREE.Mesh(
        new THREE.CircleGeometry(ARENA_R - 0.5, 64),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false })
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = 0.02;
    group.add(gridMesh);

    scene.add(group);
    return group;
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initDerbyMode(players) {
    scene.background = new THREE.Color(0x1a0a00);
    scene.fog = new THREE.FogExp2(0x0d0500, 0.012);

    _platform = _createArena();
    _lives.clear();
    _livesEls.clear();
    _phase = 'racing';

    // Placer les joueurs en cercle sur la plateforme
    const pArr = Array.from(players.values()).filter(p => p.car);
    pArr.forEach((p, i) => {
        const ang = (i / pArr.length) * Math.PI * 2;
        const r   = ARENA_R * 0.55;
        p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
        p.carAngle = ang + Math.PI;
        p.car.rotation.y = p.carAngle;
        p.carSpeed = 0;
        p.velocity.set(0, 0, 0);

        _lives.set(p.id, { lives: MAX_LIVES, falling: false, fallTime: 0, lastPos: p.car.position.clone() });
    });

    setDerbyCamera();

    // HUD status
    _statusEl = document.createElement('div');
    _statusEl.id = 'derby-status';
    Object.assign(_statusEl.style, {
        position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '30px', fontWeight: '900', color: '#ff6600',
        fontFamily: 'monospace', letterSpacing: '3px',
        textShadow: '0 0 16px #ff4400, 0 0 32px #ff2200',
        pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(_statusEl);

    // HUD vies (icônes cœur par joueur)
    const livesBar = document.createElement('div');
    livesBar.id = 'derby-lives-bar';
    Object.assign(livesBar.style, {
        position: 'absolute', top: '64px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '18px', pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(livesBar);

    for (const p of pArr) {
        const card = document.createElement('div');
        Object.assign(card.style, {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
        });
        const nameEl = document.createElement('div');
        nameEl.textContent = p.name;
        Object.assign(nameEl.style, {
            color: p.colorHex ? '#' + p.colorHex.toString(16).padStart(6, '0') : '#fff',
            fontSize: '13px', fontWeight: '700', fontFamily: 'monospace',
            textShadow: '0 0 6px rgba(0,0,0,0.8)',
        });
        const heartsEl = document.createElement('div');
        heartsEl.textContent = '❤️'.repeat(MAX_LIVES);
        heartsEl.style.fontSize = '18px';
        card.appendChild(nameEl);
        card.appendChild(heartsEl);
        livesBar.appendChild(card);
        _livesEls.set(p.id, heartsEl);
    }
}

// ── Update ─────────────────────────────────────────────────────────────────────
export function updateDerbyMode(players, now) {
    if (_phase !== 'racing') {
        _updateStatus(players);
        return;
    }

    const aliveList = Array.from(players.values())
        .filter(p => p.car && _lives.get(p.id)?.lives > 0 && !_lives.get(p.id)?.falling);

    if (aliveList.length <= 1) {
        _phase = 'ended';
        _updateStatus(players);
        return;
    }

    for (const [id, p] of players) {
        if (!p.car) continue;
        const li = _lives.get(id);
        if (!li) continue;

        if (li.falling) {
            // Animation de chute
            p.car.position.y -= FALL_SPEED;
            p.carSpeed = 0;
            p.velocity.set(0, 0, 0);

            if (now - li.fallTime > RESPAWN_TIME) {
                li.lives--;
                li.falling = false;

                // Mettre à jour les cœurs HUD
                const heartsEl = _livesEls.get(id);
                if (heartsEl) {
                    const remaining = Math.max(0, li.lives);
                    heartsEl.textContent = '❤️'.repeat(remaining) + '🖤'.repeat(MAX_LIVES - remaining);
                }

                if (li.lives <= 0) {
                    // Eliminer — cacher la voiture
                    p.car.visible = false;
                    continue;
                }

                // Respawn au centre de la plateforme
                const ang = Math.random() * Math.PI * 2;
                p.car.position.set(Math.cos(ang) * 12, 0, Math.sin(ang) * 12);
                p.car.visible = true;
                p.carSpeed = 0;
                p.velocity.set(0, 0, 0);
            }
            continue;
        }

        // Vérifier chute hors de la plateforme
        const dist2D = Math.sqrt(p.car.position.x ** 2 + p.car.position.z ** 2);
        if (dist2D > FALL_R) {
            li.falling = true;
            li.fallTime = now;
            li.lastPos  = p.car.position.clone();
            p.carSpeed  = 0;
            p.velocity.set(0, 0, 0);
        }
    }

    _updateStatus(players);
}

function _updateStatus(players) {
    if (!_statusEl) return;

    const aliveCount = Array.from(players.values())
        .filter(p => p.car && (_lives.get(p.id)?.lives ?? 0) > 0).length;

    if (_phase === 'ended') {
        let winner = null;
        for (const [id, p] of players) {
            if (_lives.get(id)?.lives > 0) winner = p;
        }
        _statusEl.textContent = winner ? `🏆 ${winner.name} gagne !` : '💀 Égalité !';
        _statusEl.style.color = '#ffdd00';
    } else {
        _statusEl.textContent = `💥 ${aliveCount} survivor${aliveCount > 1 ? 's' : ''}`;
    }
}

export function disposeDerbyMode() {
    if (_platform) { scene.remove(_platform); _platform = null; }
    _statusEl?.remove(); _statusEl = null;
    document.getElementById('derby-lives-bar')?.remove();
    _lives.clear();
    _livesEls.clear();
    setCameraFollow();
    scene.fog = null;
}

export function isDerbyActive() { return _phase === 'racing'; }
