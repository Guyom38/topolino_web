// ── Mode Destruction Derby : arène circulaire avec trou mobile ────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setDerbyCamera, setCameraFixed, setCameraFollow } from '../camera.js';
import { loadCarForPlayer } from '../car.js';
import { createTrackSystem } from '../tracks.js';
import { createShadow } from '../shadow.js';
import { createAura } from '../aura.js';

const ARENA_R      = 45;    // rayon de la plateforme
const FALL_R       = 48;    // distance de chute (bord extérieur)
const MAX_LIVES    = 3;
const RESPAWN_TIME = 1200;  // ms avant respawn (rapide pour le trou)
const FALL_SPEED   = 0.22;
const HOLE_R       = 9.0;   // rayon du trou (agrandi)
const HOLE_DEPTH   = 4.0;   // profondeur du trou
const HOLE_SPEED   = 0.12;  // vitesse de déplacement du trou

let _platform   = null;
let _lives      = new Map();   // playerId → { lives, falling, fallTime }
let _phase      = 'waiting';   // waiting → racing → ended
let _statusEl   = null;
let _livesEls   = new Map();
let _holeGroup  = null;        // groupe visuel du trou (mobile)
let _holePos    = { x: 0, z: 0, vx: HOLE_SPEED, vz: HOLE_SPEED * 0.73 };
let _hazardRing = null;        // { mesh, tex }
let _holeHazardRing = null;    // { mesh, tex }
let _waitStart  = 0;

// ── Arène (plateforme pleine, le trou est un objet mobile par-dessus) ───────
function _createArena() {
    const group = new THREE.Group();

    // Plateforme circulaire (terre battue) — stencil: ne s'affiche pas où le trou marque
    const platGeo = new THREE.CylinderGeometry(ARENA_R, ARENA_R, 0.6, 64);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85, metalness: 0.05 });
    platMat.stencilWrite = false;
    platMat.stencilFunc  = THREE.NotEqualStencilFunc;
    platMat.stencilRef   = 1;
    const platform = new THREE.Mesh(platGeo, platMat);
    platform.receiveShadow = true;
    platform.position.y = -0.3;
    platform.renderOrder = 2;
    group.add(platform);

    // Bordure lumineuse (anneau)
    const rimGeo = new THREE.TorusGeometry(ARENA_R, 0.4, 8, 80);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 1.5 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    group.add(rim);

    // Sol texturé (grille)
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
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    const gridMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false });
    gridMat.stencilWrite = false;
    gridMat.stencilFunc  = THREE.NotEqualStencilFunc;
    gridMat.stencilRef   = 1;
    const gridMesh = new THREE.Mesh(
        new THREE.CircleGeometry(ARENA_R - 0.5, 64),
        gridMat
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = 0.02;
    gridMesh.renderOrder = 3;
    group.add(gridMesh);

    scene.add(group);
    return group;
}

// ── Barrière de danger animée (rayures rouges/noires) ────────────────────────
function _createHazardRing() {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a0000';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#dd1100';
    const sw = 40;
    for (let x = -80; x < 600; x += sw * 2) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + sw, 0);
        ctx.lineTo(x + sw - 64, 64);
        ctx.lineTo(x - 64, 64);
        ctx.closePath();
        ctx.fill();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 1);

    const geo = new THREE.CylinderGeometry(ARENA_R + 0.8, ARENA_R + 0.8, 3.5, 80, 1, true);
    const mat = new THREE.MeshBasicMaterial({
        map: tex, side: THREE.DoubleSide,
        transparent: true, opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 1.75;
    scene.add(mesh);
    _hazardRing = { mesh, tex };
}

// ── Trou mobile (groupe visuel qui se déplace) ───────────────────────────────
function _createHole() {
    const group = new THREE.Group();

    // Disque masque stencil (invisible, marque le stencil pour découper la plateforme)
    const coverMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    coverMat.stencilWrite   = true;
    coverMat.stencilRef     = 1;
    coverMat.stencilFunc    = THREE.AlwaysStencilFunc;
    coverMat.stencilZPass   = THREE.ReplaceStencilOp;
    coverMat.stencilFail    = THREE.KeepStencilOp;
    coverMat.stencilZFail   = THREE.KeepStencilOp;
    const cover = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R, 48), coverMat);
    cover.rotation.x = -Math.PI / 2;
    cover.position.y = 0.04;
    cover.renderOrder = 1;  // rendu AVANT la plateforme
    group.add(cover);

    // Parois verticales du trou (cylindre ouvert)
    const wallGeo = new THREE.CylinderGeometry(HOLE_R, HOLE_R, HOLE_DEPTH, 48, 1, true);
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x3a2518, roughness: 0.95, side: THREE.DoubleSide,
    });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = -HOLE_DEPTH / 2;
    group.add(walls);

    // Fond du trou : disque très sombre
    const botMat = new THREE.MeshBasicMaterial({ color: 0x040100 });
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R, 48), botMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -HOLE_DEPTH + 0.02;
    group.add(bottom);

    // Anneau de danger autour du trou (rayures rouges/noires animées)
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a0000';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#dd1100';
    const sw = 40;
    for (let x = -80; x < 600; x += sw * 2) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + sw, 0);
        ctx.lineTo(x + sw - 64, 64);
        ctx.lineTo(x - 64, 64);
        ctx.closePath();
        ctx.fill();
    }
    const hTex = new THREE.CanvasTexture(cv);
    hTex.wrapS = THREE.RepeatWrapping;
    hTex.wrapT = THREE.RepeatWrapping;
    hTex.repeat.set(8, 1);
    const ringGeo = new THREE.CylinderGeometry(HOLE_R + 0.4, HOLE_R + 0.4, 2.5, 48, 1, true);
    const ringMat = new THREE.MeshBasicMaterial({
        map: hTex, side: THREE.DoubleSide,
        transparent: true, opacity: 0.9,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = -HOLE_DEPTH / 2 + 0.5;
    group.add(ringMesh);
    _holeHazardRing = { mesh: ringMesh, tex: hTex };

    // Position initiale aléatoire (pas trop au bord)
    const startAng = Math.random() * Math.PI * 2;
    const startR   = 15 + Math.random() * 10;
    _holePos.x  = Math.cos(startAng) * startR;
    _holePos.z  = Math.sin(startAng) * startR;
    // Direction initiale aléatoire
    const dirAng = Math.random() * Math.PI * 2;
    _holePos.vx = Math.cos(dirAng) * HOLE_SPEED;
    _holePos.vz = Math.sin(dirAng) * HOLE_SPEED;

    group.position.set(_holePos.x, 0, _holePos.z);
    scene.add(group);
    _holeGroup = group;
}

/** Hauteur du terrain au point (x, z) — trou mobile */
export function getDuneHeight(x, z) {
    const dx = x - _holePos.x;
    const dz = z - _holePos.z;
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d < HOLE_R) return -HOLE_DEPTH;
    return 0;
}

// ── Placement joueurs en cercle ──────────────────────────────────────────────
function _placePlayer(p, index, total) {
    const ang = (index / total) * Math.PI * 2;
    const r   = ARENA_R - 4;
    p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    p.carAngle = ang + Math.PI / 2;
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
    _createHole();
    _createHazardRing();
    _lives.clear();
    _livesEls.clear();
    _phase = 'waiting';
    _waitStart = performance.now();

    // Force-loader toutes les voitures
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
            color: p.colorHex,
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
    if (_phase === 'waiting') {
        const ready = Array.from(players.values()).filter(p => p.car).length;
        if (ready >= 1 && now - _waitStart > 1500) {
            _phase = 'racing';
        }
        if (_statusEl) _statusEl.textContent = '🏁 Prêt…';
        // Bouger le trou même pendant l'attente
        _moveHole();
        return;
    }

    if (_phase === 'ended') {
        _moveHole();
        _updateStatus(players);
        return;
    }

    // ── Déplacer le trou (bille qui rebondit) ─────────────────────────────────
    _moveHole();

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

        // ── Trou mobile : chute si dans le trou ─────────────────────────
        if (!li.falling) {
            const dx = p.car.position.x - _holePos.x;
            const dz = p.car.position.z - _holePos.z;
            const distToHole = Math.sqrt(dx * dx + dz * dz);
            if (distToHole < HOLE_R - 1) {
                li.falling  = true;
                li.fallTime = now;
                p.carSpeed  = 0;
                p.velocity.set(0, 0, 0);
            }
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

                // Respawn en bordure de l'arène
                const ang = Math.random() * Math.PI * 2;
                const r   = ARENA_R - 5;
                p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
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

    // Animer les rayures de danger
    if (_hazardRing) _hazardRing.tex.offset.x += 0.003;
    if (_holeHazardRing) _holeHazardRing.tex.offset.x -= 0.005;

    _updateStatus(players);
}

// ── Déplacement du trou (bille qui rebondit dans l'arène) ────────────────────
function _moveHole() {
    _holePos.x += _holePos.vx;
    _holePos.z += _holePos.vz;

    // Rebondir si le trou touche le bord de l'arène
    const maxR = ARENA_R - HOLE_R - 2;
    const dist = Math.sqrt(_holePos.x * _holePos.x + _holePos.z * _holePos.z);
    if (dist > maxR) {
        // Réflexion par rapport à la normale (direction centre → trou)
        const nx = _holePos.x / dist;
        const nz = _holePos.z / dist;
        const dot = _holePos.vx * nx + _holePos.vz * nz;
        _holePos.vx -= 2 * dot * nx;
        _holePos.vz -= 2 * dot * nz;
        // Remettre dans les limites
        _holePos.x = nx * maxR;
        _holePos.z = nz * maxR;
    }

    // Mettre à jour la position du groupe visuel
    if (_holeGroup) {
        _holeGroup.position.x = _holePos.x;
        _holeGroup.position.z = _holePos.z;
    }
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
    if (_holeGroup) {
        _holeGroup.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                child.material.map?.dispose();
                child.material.dispose();
            }
        });
        scene.remove(_holeGroup);
        _holeGroup = null;
    }
    if (_hazardRing) {
        scene.remove(_hazardRing.mesh);
        _hazardRing.mesh.geometry.dispose();
        _hazardRing.tex.dispose();
        _hazardRing.mesh.material.dispose();
        _hazardRing = null;
    }
    _holeHazardRing = null; // déjà nettoyé avec _holeGroup
    _statusEl?.remove(); _statusEl = null;
    document.getElementById('derby-lives-bar')?.remove();
    _lives.clear();
    _livesEls.clear();
    _holePos = { x: 0, z: 0, vx: HOLE_SPEED, vz: HOLE_SPEED * 0.73 };
    setCameraFollow();
    scene.fog = null;
}

export function isDerbyActive() { return _phase === 'racing'; }
