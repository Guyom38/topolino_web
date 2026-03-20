// ── Mode Tron : traces infinies, respawn et grille géante ────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setTronCamera, setCameraFixed, setCameraFollow } from '../camera.js';

const ARENA_SIZE     = 160;  // Plus grand pour occuper tout l'écran
const TRAIL_SAMPLE   = 2;    // Plus fréquent pour la précision
const MAX_TRAIL      = 2000; // Traces très longues
const TRAIL_W        = 0.8;
const TRAIL_H        = 2.0;
const HIT_DIST       = 1.2;
const GRACE_POINTS   = 10;   // Zone autour de la voiture sans collision

let _arena    = null;
let _trails   = new Map();   // playerId → { points[], mesh, active }
let _frameCount = 0;

// ── Arène ────────────────────────────────────────────────────────────────────
function _createArena() {
    const group = new THREE.Group();

    // Sol sombre
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE + 20, ARENA_SIZE + 20),
        new THREE.MeshStandardMaterial({ color: 0x02050a, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.05;
    group.add(floor);

    // Grille Néon
    const cv  = document.createElement('canvas'); cv.width = cv.height = 1024;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = '#00f2ff';
    ctx.lineWidth = 2;
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
        const p = i / steps * 1024;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 1024); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(1024, p); ctx.stroke();
    }
    const gridTex = new THREE.CanvasTexture(cv);
    gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(1, 1);
    
    const gridMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
        new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.4, depthWrite: false })
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = 0.01;
    group.add(gridMesh);

    scene.add(group);
    return group;
}

function _resetPlayer(p, t) {
    const ang = Math.random() * Math.PI * 2;
    const r   = ARENA_SIZE * 0.4;
    p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    p.carAngle = ang + Math.PI;
    p.car.rotation.y = p.carAngle;
    p.carSpeed = 0;
    p.velocity.set(0, 0, 0);
    p.verticalVelocity = 0;
    p.onGround = true;

    // Vider la trace
    t.points = [];
    t.mesh.count = 0;
}

// ── Init ─────────────────────────────────────────────────────────────────────
export async function initTronMode(players) {
    scene.background = new THREE.Color(0x000205);
    scene.fog = null;

    _arena = _createArena();
    _trails.clear();
    _frameCount = 0;

    players.forEach(p => {
        if (!p.car) return;
        
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.colorHex), side: THREE.DoubleSide });
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(TRAIL_W, TRAIL_H, 1),
            mat,
            MAX_TRAIL
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        scene.add(mesh);

        const t = { points: [], mesh, active: false };
        _trails.set(p.id, t);
        _resetPlayer(p, t);
    });

    setTronCamera();
    setCameraFixed(0, 0, 0);
}

// ── Update ────────────────────────────────────────────────────────────────────
const _mat4 = new THREE.Matrix4();

export function updateTronMode(players, now) {
    _frameCount++;

    for (const [id, p] of players) {
        if (!p.car) continue;
        const t = _trails.get(id);
        if (!t) continue;

        // Activer la trace dès que la voiture bouge
        if (!t.active && (Math.abs(p.carSpeed) > 0.05)) {
            t.active = true;
        }

        if (t.active) {
            // Enregistrement des points
            if (_frameCount % TRAIL_SAMPLE === 0) {
                t.points.push({ x: p.car.position.x, z: p.car.position.z });
                if (t.points.length > MAX_TRAIL) t.points.shift();
            }

            // --- COLLISIONS ---
            let hit = false;

            // 1. Murs arène
            const half = ARENA_SIZE / 2;
            if (Math.abs(p.car.position.x) > half || Math.abs(p.car.position.z) > half) {
                hit = true;
            }

            // 2. Toutes les traces (soi-même et les autres)
            for (const [otherId, otherT] of _trails) {
                const pts = otherT.points;
                const isSelf = (otherId === id);
                // Si c'est notre propre trace, on ne teste pas les derniers points (grâce à GRACE_POINTS)
                const checkUpTo = isSelf ? Math.max(0, pts.length - GRACE_POINTS) : pts.length;
                
                for (let i = 0; i < checkUpTo; i++) {
                    const dx = p.car.position.x - pts[i].x;
                    const dz = p.car.position.z - pts[i].z;
                    if (dx * dx + dz * dz < HIT_DIST * HIT_DIST) {
                        hit = true;
                        // Optionnel : faire disparaître la trace touchée ? 
                        // "La bande disparait une fois que le joueur l'a touché"
                        otherT.points = [];
                        otherT.mesh.count = 0;
                        break;
                    }
                }
                if (hit) break;
            }

            if (hit) {
                _resetPlayer(p, t);
                t.active = false;
            }
        }

        // --- Rendu des traces ---
        const pts = t.points;
        t.mesh.count = Math.max(0, pts.length - 1);
        for (let i = 0; i < pts.length - 1; i++) {
            const ax = pts[i].x,   az = pts[i].z;
            const bx = pts[i+1].x, bz = pts[i+1].z;
            const mx = (ax + bx) / 2, mz = (az + bz) / 2;
            const dx = bx - ax, dz = bz - az;
            const len = Math.sqrt(dx*dx + dz*dz) || 0.01;
            const ang = Math.atan2(dx, dz);
            _mat4.makeRotationY(ang);
            _mat4.setPosition(mx, TRAIL_H / 2, mz);
            _mat4.multiply(new THREE.Matrix4().makeScale(1, 1, len + 0.1)); // Petit overlap pour boucher les trous
            t.mesh.setMatrixAt(i, _mat4);
        }
        if (t.points.length > 1) t.mesh.instanceMatrix.needsUpdate = true;
    }
}

export function disposeTronMode() {
    if (_arena) { scene.remove(_arena); _arena = null; }
    for (const t of _trails.values()) {
        scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
    }
    _trails.clear();
    setCameraFollow();
}

export function isTronActive() { return true; }
