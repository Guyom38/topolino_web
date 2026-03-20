// ── Mode Tron : traces qui bloquent, vue du dessus ────────────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { setTronCamera, setCameraFixed, setCameraFollow } from '../camera.js';
import { initUI, updateUI } from '../ui.js';

const ARENA_SIZE     = 88;   // côté de l'arène
const WALL_H         = 4;
const TRAIL_SAMPLE   = 5;    // frames entre deux points
const MAX_TRAIL      = 280;  // points max par joueur
const TRAIL_W        = 0.7;  // largeur visuelle
const TRAIL_H        = 1.2;  // hauteur visuelle
const HIT_DIST       = 1.4;  // distance de collision avec une trace
const GRACE_POINTS   = 18;   // ne pas collider les derniers N points (zone autour de la voiture)

let _arena    = null;
let _wallMesh = null;
let _trails   = new Map();   // playerId → { points[], mesh, alive, frameCount }
let _phase    = 'racing';    // 'racing' | 'ended'
let _timerEl  = null;
let _frameCount = 0;

// ── Arène ────────────────────────────────────────────────────────────────────
function _createArena() {
    const group = new THREE.Group();

    // Sol sombre (style Tron)
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
        new THREE.MeshStandardMaterial({ color: 0x050a14, roughness: 0.9, metalness: 0 })
    );
    floor.rotation.x   = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // Grille (canvas texture)
    const cv  = document.createElement('canvas'); cv.width = cv.height = 512;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#0a2040';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 32; i++) {
        const p = i / 32 * 512;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(512, p); ctx.stroke();
    }
    const gridTex = new THREE.CanvasTexture(cv);
    gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(4, 4);
    const gridMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
        new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.7, depthWrite: false })
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y  = 0.01;
    group.add(gridMesh);

    // Murs invisibles (pour le DOM – collision gérée manuellement)
    const wallMat  = new THREE.MeshStandardMaterial({ color: 0x0055ff, emissive: 0x0033aa, emissiveIntensity: 1.2, transparent: true, opacity: 0.55 });
    const half = ARENA_SIZE / 2;
    [
        { x: 0,    z: -half, rx: 0 },
        { x: 0,    z:  half, rx: 0 },
        { x: -half, z: 0,   rx: Math.PI / 2 },
        { x:  half, z: 0,   rx: Math.PI / 2 },
    ].forEach(w => {
        const wall = new THREE.Mesh(
            new THREE.PlaneGeometry(ARENA_SIZE, WALL_H),
            wallMat
        );
        wall.position.set(w.x, WALL_H / 2, w.z);
        wall.rotation.y = w.rx;
        group.add(wall);
    });

    scene.add(group);
    return group;
}

// ── Init ─────────────────────────────────────────────────────────────────────
export async function initTronMode(players) {
    scene.background = new THREE.Color(0x01050f);
    scene.fog = new THREE.FogExp2(0x010814, 0.007);

    _arena = _createArena();
    _trails.clear();
    _phase = 'racing';
    _frameCount = 0;

    // Placer les joueurs sur les bords de l'arène
    const startAngles = Array.from(players.values())
        .filter(p => p.car)
        .map((_, i, arr) => (i / arr.length) * Math.PI * 2);

    let idx = 0;
    for (const [, p] of players) {
        if (!p.car) continue;
        const ang = startAngles[idx++];
        const r   = ARENA_SIZE * 0.35;
        p.car.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
        p.carAngle = ang + Math.PI; // regarde vers le centre
        p.car.rotation.y = p.carAngle;
        p.carSpeed = 0;
        p.velocity.set(0, 0, 0);

        // Trail data
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3 * 2), 3));
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.colorHex), side: THREE.DoubleSide });
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(TRAIL_W, TRAIL_H, 1),
            mat,
            MAX_TRAIL
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        scene.add(mesh);

        _trails.set(p.id, { points: [], mesh, alive: true, frameCount: 0 });
    }

    setTronCamera();
    setCameraFixed(0, 0, 0);

    // HUD timer
    _timerEl = document.createElement('div');
    _timerEl.id = 'tron-status';
    Object.assign(_timerEl.style, {
        position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '36px', fontWeight: '900', color: '#0af',
        fontFamily: 'monospace', letterSpacing: '4px',
        textShadow: '0 0 20px #0af, 0 0 40px #0af',
        pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(_timerEl);
}

// ── Update ────────────────────────────────────────────────────────────────────
const _mat4 = new THREE.Matrix4();

export function updateTronMode(players, now) {
    if (_phase !== 'racing') {
        _updateStatus(players);
        return;
    }

    _frameCount++;

    const aliveList = [];
    for (const [id, p] of players) {
        if (!p.car) continue;
        const t = _trails.get(id);
        if (!t || !t.alive) continue;
        aliveList.push({ id, p, t });
    }

    // Fin de partie : 0 ou 1 survivant
    if (aliveList.length <= 1) {
        _phase = 'ended';
        _updateStatus(players);
        return;
    }

    for (const { id, p, t } of aliveList) {
        // Enregistrer un point de trace tous les TRAIL_SAMPLE frames
        if (_frameCount % TRAIL_SAMPLE === 0) {
            t.points.push({ x: p.car.position.x, z: p.car.position.z });
            if (t.points.length > MAX_TRAIL) t.points.shift();
        }

        // Vérifier collision avec les traces des AUTRES joueurs
        for (const { id: otherId, t: other } of aliveList) {
            if (otherId === id) continue;
            const pts = other.points;
            const checkUpTo = Math.max(0, pts.length - GRACE_POINTS);
            for (let i = 0; i < checkUpTo; i++) {
                const dx = p.car.position.x - pts[i].x;
                const dz = p.car.position.z - pts[i].z;
                if (dx * dx + dz * dz < HIT_DIST * HIT_DIST) {
                    t.alive = false;
                    p.carSpeed = 0;
                    p.velocity.set(0, 0, 0);
                    // Flash d'élimination
                    t.mesh.material.color.setHex(0xff2200);
                    break;
                }
            }
            if (!t.alive) break;
        }

        // Murs de l'arène
        const half = ARENA_SIZE / 2 - 1;
        if (Math.abs(p.car.position.x) > half || Math.abs(p.car.position.z) > half) {
            t.alive = false;
            p.carSpeed = 0;
            p.velocity.set(0, 0, 0);
            p.car.position.x = THREE.MathUtils.clamp(p.car.position.x, -half, half);
            p.car.position.z = THREE.MathUtils.clamp(p.car.position.z, -half, half);
        }

        // Mettre à jour les instances de la trace
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
            // Scale Z = longueur du segment
            const s = new THREE.Matrix4().makeScale(1, 1, len);
            _mat4.multiply(s);
            t.mesh.setMatrixAt(i, _mat4);
        }
        if (t.points.length > 1) t.mesh.instanceMatrix.needsUpdate = true;
    }

    _updateStatus(players);
}

function _updateStatus(players) {
    if (!_timerEl) return;
    const alive = Array.from(_trails.values()).filter(t => t.alive).length;
    if (_phase === 'ended') {
        let winner = null;
        for (const [id, p] of players) {
            const t = _trails.get(id);
            if (t?.alive) winner = p;
        }
        _timerEl.textContent = winner ? `🏆 ${winner.name} gagne !` : '💀 Égalité !';
        _timerEl.style.color = '#ffdd00';
    } else {
        _timerEl.textContent = `${alive} joueur${alive > 1 ? 's' : ''} en vie`;
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
    _timerEl?.remove(); _timerEl = null;
    setCameraFollow();
    scene.fog = null;
}

export function isTronActive() { return _phase === 'racing'; }
