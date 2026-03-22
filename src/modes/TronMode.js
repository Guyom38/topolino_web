// ── Mode Tron : Correction affichage traces ─────────────────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setTronCamera, setCameraFixed, setCameraFollow } from '../camera.js';
import { setPlayerScore } from '../ui.js';

const ARENA_SIZE     = 160;
const TRAIL_DIST     = 1.2;  // Segments plus courts
const TRAIL_W        = 1.2;
const TRAIL_H        = 3.0;
const HIT_DIST       = 1.5;

let _arena    = null;
let _trails   = new Map();   // playerId → { lastPos, meshes[], color, active }
let _scores   = new Map();
let _trailGroup = null;

function _createArena() {
    const group = new THREE.Group();
    // Sol
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE + 40, ARENA_SIZE + 40),
        new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    group.add(floor);

    // Grille
    const cv  = document.createElement('canvas'); cv.width = cv.height = 1024;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 4;
    for (let i = 0; i <= 32; i++) {
        const p = i / 32 * 1024;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 1024); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(1024, p); ctx.stroke();
    }
    const gridMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.6 })
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = 0.05;
    group.add(gridMesh);

    scene.add(group);
    return group;
}

function _resetPlayer(p) {
    const ang = Math.random() * Math.PI * 2;
    const r   = ARENA_SIZE * 0.35;
    p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    p.carAngle = ang + Math.PI;
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
    t.meshes.forEach(m => {
        _trailGroup.remove(m);
        m.geometry.dispose();
        m.material.dispose();
    });
    t.meshes = [];
}

export async function initTronMode(players) {
    scene.background = new THREE.Color(0x000000);
    _arena = _createArena();
    
    // Initialiser le groupe de traces
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
            active: false 
        });
        _scores.set(p.id, 0);
        _resetPlayer(p);
        setPlayerScore(p.id, "0 pts");
    });

    setTronCamera();
    setCameraFixed(0, 0, 0);
}

export function updateTronMode(players, now) {
    if (!_trailGroup) return;

    for (const [id, p] of players) {
        if (!p.car) continue;
        const t = _trails.get(id);
        if (!t) continue;

        // Trace active dès que la vitesse dépasse 0.05
        if (!t.active && Math.abs(p.carSpeed) > 0.05) {
            t.active = true;
            t.lastPos.copy(p.car.position);
        }

        if (t.active) {
            const dist = p.car.position.distanceTo(t.lastPos);
            if (dist > TRAIL_DIST) {
                const p1 = t.lastPos.clone();
                const p2 = p.car.position.clone();
                
                const dx = p2.x - p1.x, dz = p2.z - p1.z;
                const len = Math.sqrt(dx*dx + dz*dz);
                const angle = Math.atan2(dx, dz);

                const mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(TRAIL_W, TRAIL_H, len + 0.3),
                    new THREE.MeshBasicMaterial({ color: t.color }) // Matériau plein
                );
                
                mesh.position.set((p1.x + p2.x)/2, TRAIL_H/2, (p1.z + p2.z)/2);
                mesh.rotation.y = angle;
                mesh.userData.ownerId = id;
                
                _trailGroup.add(mesh);
                t.meshes.push(mesh);
                t.lastPos.copy(p2);
            }

            // --- COLLISIONS ---
            let dead = false;
            let killerId = null;

            if (Math.abs(p.car.position.x) > ARENA_SIZE/2 || Math.abs(p.car.position.z) > ARENA_SIZE/2) dead = true;

            for (const mesh of _trailGroup.children) {
                // Protection pour ne pas se tuer sur son propre cul
                if (mesh.userData.ownerId === id && t.meshes.slice(-4).includes(mesh)) continue;

                const dx = p.car.position.x - mesh.position.x;
                const dz = p.car.position.z - mesh.position.z;
                if (dx*dx + dz*dz < HIT_DIST * HIT_DIST) {
                    dead = true;
                    killerId = mesh.userData.ownerId;
                    _clearTrail(killerId);
                    break;
                }
            }

            if (dead) {
                if (killerId && killerId !== id) {
                    const s = (_scores.get(killerId) || 0) + 1;
                    _scores.set(killerId, s);
                    setPlayerScore(killerId, s + " pts");
                }
                _clearTrail(id);
                _resetPlayer(p);
            }
        }
    }
}

export function disposeTronMode() {
    if (_arena) { scene.remove(_arena); _arena = null; }
    if (_trailGroup) {
        _trailGroup.children.forEach(m => {
            m.geometry.dispose(); m.material.dispose();
        });
        scene.remove(_trailGroup);
        _trailGroup = null;
    }
    _trails.clear();
    setCameraFollow();
}

export function isTronActive() { return true; }
