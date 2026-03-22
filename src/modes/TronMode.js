// ── Mode Tron : arène lumineuse avec traces-murs ─────────────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setTronCamera, setCameraFixed, setCameraFollow } from '../camera.js';
import { setPlayerScore } from '../ui.js';

const ARENA_SIZE     = 160;
const TRAIL_DIST     = 1.0;   // distance entre segments de trace
const TRAIL_W        = 0.4;
const TRAIL_H        = 1.8;
const HIT_DIST       = 1.4;
const SAFE_SEGMENTS  = 6;     // segments récents ignorés (évite le suicide)
const MAX_SEGMENTS   = 120;   // longueur max visible (après ça → fondu)
const FADE_SEGMENTS  = 35;    // nombre de vieux segments qui disparaissent progressivement

let _arena      = null;
let _trails     = new Map();   // playerId → { lastPos, meshes[], color, active }
let _scores     = new Map();
let _trailGroup = null;

// ── Arène ────────────────────────────────────────────────────────────────────
function _createArena() {
    const group = new THREE.Group();

    // Sol noir
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE + 40, ARENA_SIZE + 40),
        new THREE.MeshStandardMaterial({ color: 0x020208, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    group.add(floor);

    // Grille néon
    const cv  = document.createElement('canvas'); cv.width = cv.height = 1024;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 2;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i <= 32; i++) {
        const p = i / 32 * 1024;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 1024); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(1024, p); ctx.stroke();
    }
    const gridMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true })
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = 0.05;
    group.add(gridMesh);

    // Murs lumineux sur les 4 bords
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.25 });
    const S = ARENA_SIZE / 2, WH = 6;
    const wallGeo = new THREE.PlaneGeometry(ARENA_SIZE, WH);
    const positions = [
        { x:  0, z: -S, ry: 0 },
        { x:  0, z:  S, ry: Math.PI },
        { x: -S, z:  0, ry:  Math.PI / 2 },
        { x:  S, z:  0, ry: -Math.PI / 2 },
    ];
    for (const w of positions) {
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(w.x, WH / 2, w.z);
        wall.rotation.y = w.ry;
        group.add(wall);
    }

    scene.add(group);
    return group;
}

function _resetPlayer(p) {
    const ang = Math.random() * Math.PI * 2;
    const r   = ARENA_SIZE * 0.46;  // au bord de l'arène
    p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    p.carAngle = ang + Math.PI;     // face au centre
    p.car.rotation.y = p.carAngle;
    p.carSpeed = 0;
    p.velocity.set(0, 0, 0);

    const t = _trails.get(p.id);
    if (t) {
        t.lastPos.copy(p.car.position);
        t.active = false;
    }
}

function _clearTrail(playerId) {
    const t = _trails.get(playerId);
    if (!t || !_trailGroup) return;
    for (const m of t.meshes) {
        _trailGroup.remove(m);
        m.geometry.dispose();
        m.material.dispose();
    }
    t.meshes = [];
}

// ── Init ─────────────────────────────────────────────────────────────────────
export async function initTronMode(players) {
    scene.background = new THREE.Color(0x000005);

    _arena = _createArena();

    if (_trailGroup) scene.remove(_trailGroup);
    _trailGroup = new THREE.Group();
    scene.add(_trailGroup);

    _trails.clear();
    _scores.clear();

    players.forEach(p => {
        if (!p.car) return;
        _trails.set(p.id, {
            lastPos: p.car.position.clone(),
            meshes: [],
            color: new THREE.Color(p.colorHex),
            active: false,
        });
        _scores.set(p.id, 0);
        _resetPlayer(p);
        setPlayerScore(p.id, '0 pts');
    });

    setTronCamera();
    setCameraFixed(0, 0, 0);
}

// ── Update ───────────────────────────────────────────────────────────────────
export function updateTronMode(players, now) {
    if (!_trailGroup) return;

    for (const [id, p] of players) {
        if (!p.car) continue;
        const t = _trails.get(id);
        if (!t) {
            // Joueur ajouté en cours de partie
            _trails.set(id, {
                lastPos: p.car.position.clone(),
                meshes: [],
                color: new THREE.Color(p.colorHex),
                active: false,
            });
            _scores.set(id, 0);
            _resetPlayer(p);
            setPlayerScore(id, '0 pts');
            continue;
        }

        // Trace active dès que la voiture bouge
        if (!t.active && Math.abs(p.carSpeed) > 0.04) {
            t.active = true;
            t.lastPos.copy(p.car.position);
        }

        if (!t.active) continue;

        // ── Ajouter un segment de trace ──────────────────────────────────
        const dist = p.car.position.distanceTo(t.lastPos);
        if (dist > TRAIL_DIST) {
            const p1 = t.lastPos.clone();
            const p2 = p.car.position.clone();

            const dx = p2.x - p1.x, dz = p2.z - p1.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            const angle = Math.atan2(dx, dz);

            // Matériau émissif lumineux (effet néon Tron)
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(TRAIL_W, TRAIL_H, len + 0.3),
                new THREE.MeshBasicMaterial({
                    color: t.color,
                    transparent: true,
                    opacity: 1.0,
                })
            );

            mesh.position.set((p1.x + p2.x) / 2, TRAIL_H / 2, (p1.z + p2.z) / 2);
            mesh.rotation.y = angle;
            mesh.userData.ownerId = id;

            _trailGroup.add(mesh);
            t.meshes.push(mesh);
            t.lastPos.copy(p2);
        }

        // ── Fondu progressif des vieux segments ─────────────────────────
        const total = t.meshes.length;
        if (total > MAX_SEGMENTS) {
            const fadeCount = Math.min(total - MAX_SEGMENTS + FADE_SEGMENTS, total);
            for (let si = 0; si < fadeCount; si++) {
                const m = t.meshes[si];
                if (!m) continue;
                // Opacité dégressive : 0 pour le plus vieux, ~0.85 pour le seuil
                const age = fadeCount - si;
                const op  = Math.max(0, 1 - age / FADE_SEGMENTS);
                m.material.opacity = op;
                if (op <= 0) {
                    _trailGroup.remove(m);
                    m.geometry.dispose();
                    m.material.dispose();
                    t.meshes[si] = null;
                }
            }
            // Purger les nulls en tête
            while (t.meshes.length > 0 && t.meshes[0] === null) t.meshes.shift();
        }

        // ── Collisions ───────────────────────────────────────────────────
        let dead = false;
        let killerId = null;
        let hitMesh  = null;

        // Mur de l'arène
        if (Math.abs(p.car.position.x) > ARENA_SIZE / 2 ||
            Math.abs(p.car.position.z) > ARENA_SIZE / 2) {
            dead = true;
        }

        // Collision avec les traces
        if (!dead) {
            for (const mesh of _trailGroup.children) {
                if (!mesh.visible) continue;
                // Ignorer ses propres segments récents
                if (mesh.userData.ownerId === id) {
                    const idx = t.meshes.indexOf(mesh);
                    if (idx >= 0 && idx >= t.meshes.length - SAFE_SEGMENTS) continue;
                }

                const dx = p.car.position.x - mesh.position.x;
                const dz = p.car.position.z - mesh.position.z;
                if (dx * dx + dz * dz < HIT_DIST * HIT_DIST) {
                    dead = true;
                    killerId = mesh.userData.ownerId;
                    hitMesh  = mesh;
                    break;
                }
            }
        }

        if (dead) {
            // Scorer le tueur
            if (killerId && killerId !== id) {
                const s = (_scores.get(killerId) || 0) + 1;
                _scores.set(killerId, s);
                setPlayerScore(killerId, s + ' pts');
            }
            // Supprimer le segment touché
            if (hitMesh) {
                _trailGroup.remove(hitMesh);
                hitMesh.geometry.dispose();
                hitMesh.material.dispose();
                // Retirer du tableau du propriétaire
                if (killerId) {
                    const ownerTrail = _trails.get(killerId);
                    if (ownerTrail) {
                        const hi = ownerTrail.meshes.indexOf(hitMesh);
                        if (hi >= 0) ownerTrail.meshes.splice(hi, 1);
                    }
                }
            }
            // Effacer la trace du mort et le respawn
            _clearTrail(id);
            _resetPlayer(p);
        }
    }
}

// ── Dispose ──────────────────────────────────────────────────────────────────
export function disposeTronMode() {
    if (_arena) { scene.remove(_arena); _arena = null; }
    if (_trailGroup) {
        _trailGroup.traverse(child => {
            if (child.isMesh) { child.geometry.dispose(); child.material.dispose(); }
        });
        scene.remove(_trailGroup);
        _trailGroup = null;
    }
    _trails.clear();
    _scores.clear();
    setCameraFollow();
}

export function isTronActive() { return true; }
