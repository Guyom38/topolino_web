import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { getMaterialForMesh } from './materials.js';
import { renderer } from './scene.js';

// ── Couleurs carrosserie ──────────────────────────────────────────────────────
const BODY_COLORS = [
    0xff6b1c, 0xffcc00, 0xB7D1C4, 0xff3344,
    0x4499ff, 0xcc44ff, 0x44dd88, 0xff4422,
    0x88ccff, 0xffaa44, 0x66ee44, 0xdd4488,
    0xffffff, 0x222222,
];

// ── Debug ─────────────────────────────────────────────────────────────────────
const DEBUG_OBB = false;

// ── Paramètres scène ──────────────────────────────────────────────────────────
const CAR_COUNT  = 60;
const ARENA_R    = 30;
const SPAWN_R    = 28;

// ── Physique OBB ──────────────────────────────────────────────────────────────
const CAR_HL      = 1.90;   // demi-longueur (axe avant/arrière)
const CAR_HW      = 0.88;   // demi-largeur
const DRAG        = 0.980;  // frottement sol (décélération passive)
const THRUST      = 0.0030; // poussée vers la vitesse cible chaque frame
const STEER_RATE  = 0.07;   // vitesse de braquage après collision (0=rigide, 1=instant)
const RESTITUTION = 0.06;   // rebond normal (quasi-nul → glissement pur)
const FRICTION    = 0.28;   // frottement tangentiel lors du contact
const MIN_SPEED   = 0.018;
const MAX_SPEED   = 0.110;

let _scene    = null;
let _camera   = null;
let _cars     = [];
let _running  = false;
let _animId   = null;

// ═══════════════════════════════════════════════════════════════════════════════
//  SAT – Séparation d'axe pour deux OBB 2D (plan XZ)
// ═══════════════════════════════════════════════════════════════════════════════

/** Projette un OBB sur un axe unitaire (ax, az) – retourne [min, max] */
function _projectOBB(cx, cz, angle, ax, az) {
    // Axes locaux de la boîte
    const fx = Math.cos(angle), fz = -Math.sin(angle); // avant
    const rx = Math.sin(angle), rz =  Math.cos(angle); // côté droit
    // Rayon de projection des demi-dimensions
    const r = Math.abs(CAR_HL * (fx * ax + fz * az))
            + Math.abs(CAR_HW * (rx * ax + rz * az));
    const c = cx * ax + cz * az;
    return [c - r, c + r];
}

/** Teste un axe – retourne le chevauchement ou null si axe séparateur */
function _testAxis(ax, az, a, b) {
    const [minA, maxA] = _projectOBB(a.x, a.z, a.angle, ax, az);
    const [minB, maxB] = _projectOBB(b.x, b.z, b.angle, ax, az);
    const ov = Math.min(maxA, maxB) - Math.max(minA, minB);
    return ov > 0 ? ov : null;
}

/** SAT complet entre deux voitures – résout la collision si elle existe */
function _resolveOBB(a, b) {
    // 4 axes : 2 par boîte (avant & côté de chaque)
    const axes = [
        [Math.cos(a.angle), -Math.sin(a.angle)],
        [Math.sin(a.angle),  Math.cos(a.angle)],
        [Math.cos(b.angle), -Math.sin(b.angle)],
        [Math.sin(b.angle),  Math.cos(b.angle)],
    ];

    let minOv = Infinity, bestAx = 0, bestAz = 0;
    for (const [ax, az] of axes) {
        const ov = _testAxis(ax, az, a, b);
        if (ov === null) return;          // axe séparateur → pas de collision
        if (ov < minOv) { minOv = ov; bestAx = ax; bestAz = az; }
    }

    // MTV (vecteur de translation minimum) orienté de B vers A
    const dx = a.x - b.x, dz = a.z - b.z;
    if (dx * bestAx + dz * bestAz < 0) { bestAx = -bestAx; bestAz = -bestAz; }

    // ── Séparation (push-out) ──────────────────────────────────────────────
    const sep = minOv * 0.5;
    a.x += bestAx * sep;  a.z += bestAz * sep;
    b.x -= bestAx * sep;  b.z -= bestAz * sep;

    // ── Impulsion normale ─────────────────────────────────────────────────
    const rvx = a.vx - b.vx, rvz = a.vz - b.vz;
    const vn  = rvx * bestAx + rvz * bestAz; // < 0 → rapprochement
    if (vn >= 0) return;                      // déjà en train de se séparer

    const jn = -(1 + RESTITUTION) * vn * 0.5; // masse égale : diviser par 2
    a.vx += jn * bestAx;  a.vz += jn * bestAz;
    b.vx -= jn * bestAx;  b.vz -= jn * bestAz;

    // ── Friction tangentielle (glissement) ───────────────────────────────
    // Recalcul après l'impulsion normale
    const rvx2 = a.vx - b.vx, rvz2 = a.vz - b.vz;
    const vn2  = rvx2 * bestAx + rvz2 * bestAz;
    const tvx  = rvx2 - vn2 * bestAx;
    const tvz  = rvz2 - vn2 * bestAz;
    const tLen = Math.hypot(tvx, tvz);
    if (tLen > 1e-4) {
        const tnx = tvx / tLen, tnz = tvz / tLen;
        const jt  = Math.min(FRICTION * jn, tLen * 0.5); // coulomb clamp
        a.vx -= jt * tnx;  a.vz -= jt * tnz;
        b.vx += jt * tnx;  b.vz += jt * tnz;
    }

    // ── Clamp vitesses post-collision ────────────────────────────────────
    for (const c of [a, b]) {
        const sp = Math.hypot(c.vx, c.vz);
        if (sp > MAX_SPEED) { c.vx = c.vx / sp * MAX_SPEED; c.vz = c.vz / sp * MAX_SPEED; }
    }
}

/** Résout toutes les paires O(n²) – 60 voitures = 1770 tests, très léger */
function _resolveAll() {
    const n = _cars.length;
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
            _resolveOBB(_cars[i], _cars[j]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Gestion des voitures
// ═══════════════════════════════════════════════════════════════════════════════

function _respawn(c, initial) {
    const ea = Math.random() * Math.PI * 2;
    const r  = initial ? Math.random() * SPAWN_R : SPAWN_R;
    c.x = Math.cos(ea) * r;
    c.z = Math.sin(ea) * r;
    c.root.position.x = c.x;
    c.root.position.z = c.z;

    // Pointer vers le centre ± 40°
    const toward = Math.atan2(-c.z, -c.x) + (Math.random() - 0.5) * 1.4;
    c.angle            = toward;
    c.root.rotation.y  = toward;
    c.baseSpeed        = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    c.vx = Math.cos(toward) * c.baseSpeed;
    c.vz = -Math.sin(toward) * c.baseSpeed;
}

function _buildCar(fbxTemplate, color) {
    const clone = fbxTemplate.clone(true);
    clone.rotation.y = Math.PI;
    clone.scale.setScalar(0.015);

    const box = new THREE.Box3().setFromObject(clone);
    const ctr = new THREE.Vector3();
    box.getCenter(ctr);
    clone.position.x = -ctr.x;
    clone.position.z = -ctr.z;
    clone.position.y = -box.min.y;

    clone.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = child.receiveShadow = false;
        const mat = getMaterialForMesh(child.name);
        // En mode debug : cloner le matériau pour rendre la voiture transparente
        if (DEBUG_OBB) {
            const base = mat ?? new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.12 });
            child.material = base.clone();
            child.material.transparent = true;
            child.material.opacity     = 0.40;
        } else {
            child.material = mat ?? new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.12 });
        }
        if (child.name.toLowerCase().includes('bagage')) child.visible = false;
    });

    return clone;
}

/** Ajoute un quad OBB coloré + contour au groupe de la voiture (debug uniquement) */
function _addDebugOBB(root, color) {
    // Quad plat (XZ) aux dimensions exactes de la hitbox
    const geo  = new THREE.PlaneGeometry(CAR_HL * 2, CAR_HW * 2);
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide, depthTest: false,
    }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.04;
    root.add(fill);

    // Contour blanc pour délimiter la boîte nettement
    const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.y = 0.05;
    root.add(outline);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Init / Loop / Dispose
// ═══════════════════════════════════════════════════════════════════════════════

export async function initTitleScene() {
    const W = window.innerWidth, H = window.innerHeight;

    // Renderer partagé avec le jeu — pas de second contexte WebGL
    renderer.domElement.style.display = 'block';

    // Rendre le fond du titre transparent pour laisser le canvas Three.js visible à travers
    const titleEl = document.getElementById('title-screen');
    if (titleEl) titleEl.style.background = 'transparent';

    _scene  = new THREE.Scene();
    _scene.background = new THREE.Color(0x04091a); // fond sombre proche du CSS titre
    _camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);
    _camera.position.set(0, 12, 10);
    _camera.lookAt(0, 0, 0);

    _scene.add(new THREE.AmbientLight(0x7799cc, 0.8));
    const sun = new THREE.DirectionalLight(0xfff0cc, 1.9);
    sun.position.set(30, 50, 20);  _scene.add(sun);
    const fill = new THREE.DirectionalLight(0x334488, 0.4);
    fill.position.set(-20, 8, -15); _scene.add(fill);

    let fbxTemplate;
    try {
        fbxTemplate = await new Promise((res, rej) =>
            new FBXLoader().load('Asssets/topolino_low49k.fbx', res, null, rej)
        );
    } catch (e) { console.warn('[TitleScene] FBX non chargé:', e); return; }

    for (let i = 0; i < CAR_COUNT; i++) {
        const color = BODY_COLORS[i % BODY_COLORS.length];
        const root  = new THREE.Group();
        root.add(_buildCar(fbxTemplate, color));
        if (DEBUG_OBB) _addDebugOBB(root, color);
        _scene.add(root);
        const c = { root, x: 0, z: 0, vx: 0, vz: 0, angle: 0, baseSpeed: 0.05 };
        _cars.push(c);
        _respawn(c, true);
    }

    _running = true;
    window.addEventListener('resize', _onResize);
    _loop();
}

function _onResize() {
    if (!_camera) return;
    _camera.aspect = window.innerWidth / window.innerHeight;
    _camera.updateProjectionMatrix();
}

function _loop() {
    if (!_running) return;
    _animId = requestAnimationFrame(_loop);

    for (const c of _cars) {
        // ── Poussée vers la vitesse cible ────────────────────────────────
        const sp = Math.hypot(c.vx, c.vz);
        if (sp < c.baseSpeed) {
            c.vx += Math.cos(c.angle) * THRUST;
            c.vz += -Math.sin(c.angle) * THRUST;
        }

        // ── Frottement sol ───────────────────────────────────────────────
        c.vx *= DRAG;
        c.vz *= DRAG;

        // ── Déplacement ──────────────────────────────────────────────────
        c.x += c.vx;
        c.z += c.vz;

        // ── Braquage progressif : l'angle suit la vélocité ───────────────
        const sp2 = Math.hypot(c.vx, c.vz);
        if (sp2 > MIN_SPEED * 0.4) {
            const target = Math.atan2(-c.vz, c.vx);
            let da = target - c.angle;
            while (da >  Math.PI) da -= 2 * Math.PI;
            while (da < -Math.PI) da += 2 * Math.PI;
            c.angle += da * STEER_RATE;
        }

        // ── Sync 3D ──────────────────────────────────────────────────────
        c.root.position.x = c.x;
        c.root.position.z = c.z;
        c.root.rotation.y = c.angle;

        // ── Sortie d'arène ───────────────────────────────────────────────
        if (Math.hypot(c.x, c.z) > ARENA_R) _respawn(c, false);
    }

    // ── Collisions OBB ───────────────────────────────────────────────────
    _resolveAll();
    // Re-sync positions après séparation SAT
    for (const c of _cars) {
        c.root.position.x = c.x;
        c.root.position.z = c.z;
    }

    renderer.render(_scene, _camera);
}

export function disposeTitleScene() {
    _running = false;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    window.removeEventListener('resize', _onResize);
    // Ne pas disposer le renderer — il est partagé avec le jeu
    renderer.domElement.style.display = 'none'; // caché jusqu'au démarrage du jeu
    _scene = _camera = null;
    _cars  = [];
}
