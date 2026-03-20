// ── Mode Battle : 3 ballons par voiture, items au sol ─────────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setCameraFollow } from '../camera.js';
import { getHeightAt } from '../terrain.js';

const BALLOON_COUNT  = 3;
const BALLOON_R      = 0.55;    // rayon de collision ballon↔voiture
const BALLOON_ORBIT  = 1.8;     // rayon orbite autour de la voiture
const BALLOON_SPEED  = 0.025;   // rad/frame orbite
const HIT_R          = 2.2;     // distance voiture-à-voiture pour toucher un ballon adverse
const ITEM_COUNT     = 8;       // items à faire apparaître sur le terrain
const ITEM_R         = 2.5;     // rayon de collecte item
const ITEM_RESPAWN   = 8000;    // ms avant réapparition

const BALLOON_COLORS = [0xff2020, 0x20aaff, 0x30ff60, 0xffdd00, 0xff60ff, 0x60ffee];

let _balloons   = new Map();   // playerId → [{mesh, angle, alive}]
let _items      = [];          // [{mesh, type, active, respawnAt}]
let _phase      = 'racing';
let _statusEl   = null;
let _balloonEls = new Map();   // playerId → DOM span

const ITEM_TYPES = ['boost', 'shield', 'pop'];

// ── Arène : terrain normal mais avec zone de jeu délimitée ────────────────────
// (on réutilise le terrain procédural existant — pas d'arène fermée)

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initBattleMode(players) {
    _balloons.clear();
    _balloonEls.clear();
    _items = [];
    _phase = 'racing';

    const pArr = Array.from(players.values()).filter(p => p.car);

    for (const p of pArr) {
        const color = BALLOON_COLORS[pArr.indexOf(p) % BALLOON_COLORS.length];
        const bList = [];
        for (let i = 0; i < BALLOON_COUNT; i++) {
            const geo = new THREE.SphereGeometry(BALLOON_R, 10, 10);
            const mat = new THREE.MeshStandardMaterial({
                color, roughness: 0.3, metalness: 0.0,
                emissive: new THREE.Color(color), emissiveIntensity: 0.25,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            scene.add(mesh);
            bList.push({ mesh, angle: (i / BALLOON_COUNT) * Math.PI * 2, alive: true });
        }
        _balloons.set(p.id, bList);
    }

    // Items au sol (spawn aléatoire autour du centre)
    for (let i = 0; i < ITEM_COUNT; i++) {
        _spawnItem(i);
    }

    // HUD
    _statusEl = document.createElement('div');
    _statusEl.id = 'battle-status';
    Object.assign(_statusEl.style, {
        position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '28px', fontWeight: '900', color: '#fff',
        fontFamily: 'monospace', letterSpacing: '2px',
        textShadow: '0 0 12px #000',
        pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(_statusEl);

    // Barre de ballons HUD
    const balloonBar = document.createElement('div');
    balloonBar.id = 'battle-balloon-bar';
    Object.assign(balloonBar.style, {
        position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '20px', pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(balloonBar);

    for (const p of pArr) {
        const card = document.createElement('div');
        Object.assign(card.style, {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        });
        const nameEl = document.createElement('div');
        nameEl.textContent = p.name;
        Object.assign(nameEl.style, {
            color: '#' + (BALLOON_COLORS[pArr.indexOf(p) % BALLOON_COLORS.length]).toString(16).padStart(6, '0'),
            fontSize: '13px', fontWeight: '700', fontFamily: 'monospace',
        });
        const balEl = document.createElement('span');
        balEl.textContent = '🎈'.repeat(BALLOON_COUNT);
        balEl.style.fontSize = '16px';
        card.appendChild(nameEl);
        card.appendChild(balEl);
        balloonBar.appendChild(card);
        _balloonEls.set(p.id, balEl);
    }
}

function _spawnItem(idx) {
    const type = ITEM_TYPES[idx % ITEM_TYPES.length];
    const ang  = Math.random() * Math.PI * 2;
    const r    = 15 + Math.random() * 30;
    const x    = Math.cos(ang) * r;
    const z    = Math.sin(ang) * r;
    const y    = getHeightAt(x, z) + 0.8;

    const geo  = new THREE.OctahedronGeometry(0.9);
    const colors = { boost: 0xffdd00, shield: 0x00aaff, pop: 0xff2040 };
    const mat  = new THREE.MeshStandardMaterial({
        color: colors[type], emissive: colors[type], emissiveIntensity: 0.6,
        roughness: 0.2, metalness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    scene.add(mesh);

    _items.push({ mesh, type, active: true, respawnAt: 0, x, z });
}

// ── Update ────────────────────────────────────────────────────────────────────
export function updateBattleMode(players, now) {
    if (_phase !== 'racing') {
        _updateStatus(players);
        return;
    }

    // Rotation des items
    for (const item of _items) {
        if (item.active) item.mesh.rotation.y += 0.04;
        else if (now > item.respawnAt) {
            item.active = true;
            item.mesh.visible = true;
        }
    }

    const pArr = Array.from(players.values()).filter(p => p.car);

    // Vérifier s'il reste au plus 1 joueur avec des ballons
    const withBalloons = pArr.filter(p => {
        const bList = _balloons.get(p.id);
        return bList && bList.some(b => b.alive);
    });
    if (withBalloons.length <= 1 && pArr.length > 1) {
        _phase = 'ended';
        _updateStatus(players);
        return;
    }

    for (const p of pArr) {
        const bList = _balloons.get(p.id);
        if (!bList) continue;
        const hasAny = bList.some(b => b.alive);

        // Orbite des ballons autour de la voiture
        bList.forEach((b, i) => {
            if (!b.alive) { b.mesh.visible = false; return; }
            b.angle += BALLOON_SPEED;
            b.mesh.position.set(
                p.car.position.x + Math.cos(b.angle) * BALLOON_ORBIT,
                p.car.position.y + 1.2,
                p.car.position.z + Math.sin(b.angle) * BALLOON_ORBIT
            );
            b.mesh.visible = true;
        });

        if (!hasAny) continue;

        // Collecte des items
        for (const item of _items) {
            if (!item.active) continue;
            const dx = p.car.position.x - item.mesh.position.x;
            const dz = p.car.position.z - item.mesh.position.z;
            if (dx*dx + dz*dz < ITEM_R * ITEM_R) {
                _applyItem(p, item.type, players);
                item.active = false;
                item.mesh.visible = false;
                item.respawnAt = now + ITEM_RESPAWN;
            }
        }

        // Collision voiture-à-voiture → éclater un ballon adverse
        for (const other of pArr) {
            if (other.id === p.id) continue;
            const oBalloons = _balloons.get(other.id);
            if (!oBalloons) continue;

            const dx = p.car.position.x - other.car.position.x;
            const dz = p.car.position.z - other.car.position.z;
            const dist2 = dx*dx + dz*dz;
            if (dist2 < HIT_R * HIT_R) {
                // Éclater le premier ballon vivant de l'adversaire
                const victim = oBalloons.find(b => b.alive);
                if (victim) {
                    victim.alive = false;
                    _flashPop(victim.mesh.position.clone());
                    _updateBalloonHUD(other.id, oBalloons);
                }
            }
        }
    }

    _updateStatus(players);
}

function _applyItem(p, type, players) {
    if (type === 'boost') {
        p.carSpeed = Math.max(p.carSpeed, 0.45);
    } else if (type === 'shield') {
        // Invincibilité courte
        p.invincibleUntil = performance.now() + 4000;
    } else if (type === 'pop') {
        // Éclater un ballon de l'adversaire le plus proche
        let closest = null, minD = Infinity;
        for (const [id, other] of players) {
            if (id === p.id || !other.car) continue;
            const dx = p.car.position.x - other.car.position.x;
            const dz = p.car.position.z - other.car.position.z;
            const d = dx*dx + dz*dz;
            if (d < minD) { minD = d; closest = other; }
        }
        if (closest) {
            const bList = _balloons.get(closest.id);
            const victim = bList?.find(b => b.alive);
            if (victim) {
                victim.alive = false;
                _flashPop(victim.mesh.position.clone());
                _updateBalloonHUD(closest.id, bList);
            }
        }
    }
}

function _flashPop(pos) {
    // Petite sphère flash orange qui disparaît
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.9 })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    let t = 0;
    const fade = () => {
        t++;
        mesh.material.opacity -= 0.07;
        mesh.scale.setScalar(1 + t * 0.12);
        if (mesh.material.opacity > 0) requestAnimationFrame(fade);
        else scene.remove(mesh);
    };
    requestAnimationFrame(fade);
}

function _updateBalloonHUD(playerId, bList) {
    const el = _balloonEls.get(playerId);
    if (!el) return;
    const alive = bList.filter(b => b.alive).length;
    const dead  = BALLOON_COUNT - alive;
    el.textContent = '🎈'.repeat(alive) + '💨'.repeat(dead);
}

function _updateStatus(players) {
    if (!_statusEl) return;
    if (_phase === 'ended') {
        let winner = null;
        for (const [id, p] of players) {
            if (!p.car) continue;
            const bList = _balloons.get(id);
            if (bList?.some(b => b.alive)) winner = p;
        }
        _statusEl.textContent = winner ? `🏆 ${winner.name} gagne !` : '💀 Égalité !';
        _statusEl.style.color = '#ffdd00';
    } else {
        const count = Array.from(_balloons.values()).flat().filter(b => b.alive).length;
        _statusEl.textContent = `🎈 ${count} ballon${count > 1 ? 's' : ''} restant${count > 1 ? 's' : ''}`;
    }
}

export function disposeBattleMode() {
    for (const bList of _balloons.values()) {
        for (const b of bList) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    }
    _balloons.clear();
    for (const item of _items) { scene.remove(item.mesh); item.mesh.geometry.dispose(); item.mesh.material.dispose(); }
    _items = [];
    _statusEl?.remove(); _statusEl = null;
    document.getElementById('battle-balloon-bar')?.remove();
    _balloonEls.clear();
}

export function isBattleActive() { return _phase === 'racing'; }
