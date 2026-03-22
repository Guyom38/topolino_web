// ── Mode Destruction Derby : arène circulaire avec dune centrale ──────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setDerbyCamera, setCameraFixed, setCameraFollow } from '../camera.js';
import { loadCarForPlayer } from '../car.js';
import { createTrackSystem } from '../tracks.js';
import { createShadow } from '../shadow.js';
import { createAura } from '../aura.js';

const ARENA_R      = 45;    // rayon de la plateforme
const FALL_R       = 48;    // distance de chute
const MAX_LIVES    = 3;
const RESPAWN_TIME = 2500;  // ms avant respawn
const FALL_SPEED   = 0.18;
const DUNE_R       = 16;    // rayon de la butte
const DUNE_H       = 4.5;   // hauteur max de la butte
const HOLE_R       = 5.0;   // rayon du trou au centre
const HOLE_DEPTH   = 3.5;   // profondeur du trou

let _platform   = null;
let _lives      = new Map();   // playerId → { lives, falling, fallTime }
let _phase      = 'waiting';   // waiting → racing → ended
let _statusEl   = null;
let _livesEls   = new Map();
let _duneMesh   = null;
let _holeMesh   = null;
let _waitStart  = 0;

// ── Arène ────────────────────────────────────────────────────────────────────
function _createArena() {
    const group = new THREE.Group();

    // Plateforme circulaire (terre battue)
    const platGeo = new THREE.CylinderGeometry(ARENA_R, ARENA_R, 0.6, 64);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85, metalness: 0.05 });
    const platform = new THREE.Mesh(platGeo, platMat);
    platform.receiveShadow = true;
    platform.position.y = -0.3;
    group.add(platform);

    // Bordure lumineuse (anneau)
    const rimGeo = new THREE.TorusGeometry(ARENA_R, 0.4, 8, 80);
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
    ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 2;
    for (let i = 0; i <= 20; i++) {
        const p = i / 20 * 512;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(512, p); ctx.stroke();
    }
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

// ── Butte centrale (LatheGeometry = profil de révolution propre) ─────────────
function _createDune() {
    // Profil de révolution : du centre (r=0) vers l'extérieur (r=DUNE_R)
    // Avec un creux au centre (trou) puis une montée puis une descente douce
    const pts = [];
    const STEPS = 40;
    for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;           // 0 → 1 (centre → bord)
        const r = t * DUNE_R;
        let y;
        const holeT = HOLE_R / DUNE_R; // fraction du rayon occupée par le trou
        if (t < holeT) {
            // Dans le trou : fond plat qui remonte doucement
            const ht = t / holeT;      // 0→1 dans le trou
            y = -HOLE_DEPTH * (1 - ht * ht);
        } else {
            // Butte : montée puis descente en cloche
            const bt = (t - holeT) / (1 - holeT); // 0→1 après le trou
            y = DUNE_H * Math.sin(bt * Math.PI) * (1 - bt * 0.3);
        }
        pts.push(new THREE.Vector2(r, y));
    }

    const geo = new THREE.LatheGeometry(pts, 48);
    geo.computeVertexNormals();

    // Même couleur que la plateforme (terre battue cohérente)
    const mat = new THREE.MeshStandardMaterial({
        color: 0x8a6a4a, roughness: 0.9, metalness: 0.05,
    });
    _duneMesh = new THREE.Mesh(geo, mat);
    _duneMesh.receiveShadow = true;
    _duneMesh.castShadow    = true;
    _duneMesh.position.y    = 0;
    scene.add(_duneMesh);

    // Fond du trou : disque sombre
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x1a0a00, roughness: 1.0 });
    _holeMesh = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R * 0.95, 32), holeMat);
    _holeMesh.rotation.x = -Math.PI / 2;
    _holeMesh.position.y = -HOLE_DEPTH + 0.05;
    scene.add(_holeMesh);
}

/** Hauteur du terrain au point (x, z) — butte + trou */
export function getDuneHeight(x, z) {
    const d = Math.sqrt(x * x + z * z);
    if (d >= DUNE_R) return 0;

    const t     = d / DUNE_R;
    const holeT = HOLE_R / DUNE_R;

    if (t < holeT) {
        // Trou
        const ht = t / holeT;
        return -HOLE_DEPTH * (1 - ht * ht);
    }
    // Butte
    const bt = (t - holeT) / (1 - holeT);
    return DUNE_H * Math.sin(bt * Math.PI) * (1 - bt * 0.3);
}

// ── Placement joueurs en cercle ──────────────────────────────────────────────
function _placePlayer(p, index, total) {
    const ang = (index / total) * Math.PI * 2;
    const r   = ARENA_R * 0.90;  // au bord du cercle
    p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    p.carAngle = ang + Math.PI;   // face au centre, prêt à foncer
    p.car.rotation.y = p.carAngle;
    p.carSpeed = 0;
    p.velocity.set(0, 0, 0);
    p.car.visible = true;
}

// ── Init ─────────────────────────────────────────────────────────────────────
export async function initDerbyMode(players) {
    scene.background = new THREE.Color(0x1a0a00);
    scene.fog = new THREE.FogExp2(0x0d0500, 0.012);

    _platform = _createArena();
    _createDune();
    _lives.clear();
    _livesEls.clear();
    _phase = 'waiting';
    _waitStart = performance.now();

    // Force-loader toutes les voitures (le spawn différé ne marche pas pour les arènes)
    for (const p of players.values()) {
        if (!p.car) {
            await loadCarForPlayer(p);
            p.respawn(0, 0, 0);
            p.tracks = createTrackSystem();
            p.shadow = createShadow();
            p.aura   = createAura();
            p.createNameLabel();
        }
    }

    // Placer tout le monde en cercle autour de l'arène
    const pArr = Array.from(players.values()).filter(p => p.car);
    pArr.forEach((p, i) => {
        _placePlayer(p, i, pArr.length);
        _lives.set(p.id, { lives: MAX_LIVES, falling: false, fallTime: 0 });
    });

    setDerbyCamera();
    setCameraFixed(0, 0, 0);

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

    // HUD vies
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
            color: p.colorHex,    // déjà un string '#rrggbb'
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

// ── Update ───────────────────────────────────────────────────────────────────
export function updateDerbyMode(players, now) {
    // Phase d'attente initiale (le temps que les voitures chargent)
    if (_phase === 'waiting') {
        const ready = Array.from(players.values()).filter(p => p.car).length;
        if (ready >= 1 && now - _waitStart > 1500) {
            _phase = 'racing';
        }
        if (_statusEl) _statusEl.textContent = '🏁 Prêt…';
        return;
    }

    if (_phase === 'ended') {
        _updateStatus(players);
        return;
    }

    // ── Phase racing ─────────────────────────────────────────────────────────
    const aliveList = Array.from(players.values())
        .filter(p => p.car && _lives.get(p.id)?.lives > 0 && !_lives.get(p.id)?.falling);

    if (aliveList.length <= 1 && Array.from(_lives.values()).some(l => l.lives <= 0)) {
        _phase = 'ended';
        _updateStatus(players);
        return;
    }

    for (const [id, p] of players) {
        if (!p.car) continue;
        const li = _lives.get(id);
        if (!li) continue;

        // ── Dune : appliquer la hauteur ──────────────────────────────────
        const duneY = getDuneHeight(p.car.position.x, p.car.position.z);
        if (duneY > 0.1) {
            p.car.position.y = Math.max(p.car.position.y, duneY);
        }

        // ── Chute ────────────────────────────────────────────────────────
        if (li.falling) {
            p.car.position.y -= FALL_SPEED;
            p.carSpeed = 0;
            p.velocity.set(0, 0, 0);

            if (now - li.fallTime > RESPAWN_TIME) {
                li.lives--;
                li.falling = false;

                const heartsEl = _livesEls.get(id);
                if (heartsEl) {
                    const rem = Math.max(0, li.lives);
                    heartsEl.textContent = '❤️'.repeat(rem) + '🖤'.repeat(MAX_LIVES - rem);
                }

                if (li.lives <= 0) {
                    p.car.visible = false;
                    continue;
                }

                // Respawn au bord de l'arène
                const ang = Math.random() * Math.PI * 2;
                p.car.position.set(Math.cos(ang) * 20, 0, Math.sin(ang) * 20);
                p.car.visible = true;
                p.carAngle = ang + Math.PI;
                p.car.rotation.y = p.carAngle;
                p.carSpeed = 0;
                p.velocity.set(0, 0, 0);
            }
            continue;
        }

        // ── Vérifier chute hors plateforme ───────────────────────────────
        const dist2D = Math.sqrt(p.car.position.x ** 2 + p.car.position.z ** 2);
        if (dist2D > FALL_R) {
            li.falling  = true;
            li.fallTime = now;
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

// ── Dispose ──────────────────────────────────────────────────────────────────
export function disposeDerbyMode() {
    if (_platform) { scene.remove(_platform); _platform = null; }
    if (_duneMesh) {
        scene.remove(_duneMesh);
        _duneMesh.geometry.dispose();
        _duneMesh.material.map?.dispose();
        _duneMesh.material.dispose();
        _duneMesh = null;
    }
    if (_holeMesh) {
        scene.remove(_holeMesh);
        _holeMesh.geometry.dispose();
        _holeMesh.material.dispose();
        _holeMesh = null;
    }
    _statusEl?.remove(); _statusEl = null;
    document.getElementById('derby-lives-bar')?.remove();
    _lives.clear();
    _livesEls.clear();
    setCameraFollow();
    scene.fog = null;
}

export function isDerbyActive() { return _phase === 'racing'; }
