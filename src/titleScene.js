import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { getMaterialForMesh, getPoliceMaterialForMesh, POLICE_COLOR } from './materials.js';
import { addGirophare } from './car.js';
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

// ── Contrôle joueurs sur la page de titre ────────────────────────────────────
const _titlePlayerCars = new Map(); // id → { c, sprite, keys }
const _TITLE_MOVE_KEYS = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS']);
const _titleKbState    = { left: false, right: false, up: false, down: false };
let   _kbClaimed       = false;
let   _titleOnKeyDown  = null;
let   _titleOnKeyUp    = null;
let   _titleSock       = null;
const _gpClaimed       = new Set();
const _TITLE_COLORS    = ['#B7D1C4','#ff6b1c','#4499ff','#cc44ff','#ffcc00','#ff3344','#44dd88','#ffaa44'];

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

// ── Helpers joueurs titre ─────────────────────────────────────────────────────

function _nextPlayerColor() {
    return _TITLE_COLORS[_titlePlayerCars.size % _TITLE_COLORS.length];
}

function _getFreeCar() {
    const claimed = new Set([..._titlePlayerCars.values()].map(v => v.c));
    return _cars.find(c => !claimed.has(c)) ?? null;
}

function _createNameSprite(text, color) {
    const W = 256, H = 64;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(4, 4, W - 8, H - 8);
    ctx.font = 'bold 34px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text.slice(0, 14), W / 2, H / 2 + 2);
    const tex    = new THREE.CanvasTexture(cv);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(4.0, 1.0, 1.0);
    if (_scene) _scene.add(sprite);
    return sprite;
}

function _claimCar(id, name, color, keys) {
    if (_titlePlayerCars.has(id) || !_scene) return;
    const c = _getFreeCar();
    if (!c) return;
    c.root.scale.setScalar(2.0);
    const sprite = _createNameSprite(name, color);
    _titlePlayerCars.set(id, { c, sprite, keys });
}

function _getPlayerEntry(c) {
    for (const v of _titlePlayerCars.values()) {
        if (v.c === c) return v;
    }
    return null;
}

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

function _buildCar(fbxTemplate, color, isPolice = false) {
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
        const policeMat = isPolice ? getPoliceMaterialForMesh(child.name) : null;
        const mat = policeMat ?? getMaterialForMesh(child.name);
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

// _buildGirophare délègue à addGirophare de car.js (même code, même rendu)
// Le root du titre joue le rôle de carVisual
function _buildGirophare(parent) {
    return addGirophare(parent);
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

    const policeColor = parseInt(POLICE_COLOR.replace('#', ''), 16);

    for (let i = 0; i < CAR_COUNT; i++) {
        // ~1 voiture sur 7 est une voiture de police
        const isPolice = (i % 7 === 0);
        const color    = isPolice ? policeColor : BODY_COLORS[i % BODY_COLORS.length];
        const root     = new THREE.Group();
        root.add(_buildCar(fbxTemplate, color, isPolice));
        if (DEBUG_OBB) _addDebugOBB(root, color);
        _scene.add(root);

        let girophare = null;
        if (isPolice) girophare = _buildGirophare(root);

        const c = { root, x: 0, z: 0, vx: 0, vz: 0, angle: 0, baseSpeed: 0.05, girophare };
        _cars.push(c);
        _respawn(c, true);
    }

    // ── Clavier ──────────────────────────────────────────────────────────────
    _titleOnKeyDown = (e) => {
        if (!_TITLE_MOVE_KEYS.has(e.code)) return;
        if (!_kbClaimed) {
            _kbClaimed = true;
            _claimCar('kb', 'Joueur 1', _nextPlayerColor(), _titleKbState);
        }
        if (e.code === 'ArrowLeft'  || e.code === 'KeyA') _titleKbState.left  = true;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') _titleKbState.right = true;
        if (e.code === 'ArrowUp'    || e.code === 'KeyW') _titleKbState.up    = true;
        if (e.code === 'ArrowDown'  || e.code === 'KeyS') _titleKbState.down  = true;
    };
    _titleOnKeyUp = (e) => {
        if (e.code === 'ArrowLeft'  || e.code === 'KeyA') _titleKbState.left  = false;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') _titleKbState.right = false;
        if (e.code === 'ArrowUp'    || e.code === 'KeyW') _titleKbState.up    = false;
        if (e.code === 'ArrowDown'  || e.code === 'KeyS') _titleKbState.down  = false;
    };
    document.addEventListener('keydown', _titleOnKeyDown);
    document.addEventListener('keyup',   _titleOnKeyUp);

    // ── Smartphone via socket.io ──────────────────────────────────────────────
    if (typeof io !== 'undefined') {
        _titleSock = io(window.location.origin);
        _titleSock.on('player_joined', (data) => {
            if (_titlePlayerCars.has(data.id)) return;
            const keys = { left: false, right: false, up: false, down: false };
            _claimCar(data.id, data.name || `Joueur ${_titlePlayerCars.size + 1}`,
                      data.color || _nextPlayerColor(), keys);
        });
        _titleSock.on('player_input', (data) => {
            const entry = _titlePlayerCars.get(data.id);
            if (entry) Object.assign(entry.keys, data);
        });
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

    // ── Sondage manettes ─────────────────────────────────────────────────────
    if (navigator.getGamepads) {
        for (const gp of navigator.getGamepads()) {
            if (!gp) continue;
            const idx = gp.index;
            if (!_gpClaimed.has(idx) && gp.buttons.some(b => b.pressed)) {
                _gpClaimed.add(idx);
                const col    = _nextPlayerColor();
                const gpKeys = { left: false, right: false, up: false, down: false };
                _claimCar(`gp_${idx}`, `Joueur ${_titlePlayerCars.size + 1}`, col, gpKeys);
            }
            const entry = _titlePlayerCars.get(`gp_${idx}`);
            if (entry) {
                const ax0 = gp.axes[0] ?? 0;
                entry.keys.left  = ax0 < -0.3;
                entry.keys.right = ax0 >  0.3;
                entry.keys.up    = (gp.buttons[7]?.value ?? 0) > 0.1 || (gp.axes[3] ?? 0) < -0.3;
                entry.keys.down  = (gp.buttons[6]?.value ?? 0) > 0.1;
            }
        }
    }

    for (const c of _cars) {
        const pe = _getPlayerEntry(c);

        if (pe) {
            // ── Conduite joueur ───────────────────────────────────────────
            if (pe.keys.left)  c.angle += 0.055;
            if (pe.keys.right) c.angle -= 0.055;
            if (pe.keys.up) {
                c.vx += Math.cos(c.angle) * 0.0045;
                c.vz += -Math.sin(c.angle) * 0.0045;
            }
            if (pe.keys.down) { c.vx *= 0.86; c.vz *= 0.86; }
        } else {
            // ── IA : poussée vers la vitesse cible ────────────────────────
            const sp = Math.hypot(c.vx, c.vz);
            if (sp < c.baseSpeed) {
                c.vx += Math.cos(c.angle) * THRUST;
                c.vz += -Math.sin(c.angle) * THRUST;
            }
        }

        // ── Frottement sol ───────────────────────────────────────────────
        c.vx *= DRAG;
        c.vz *= DRAG;

        // ── Déplacement ──────────────────────────────────────────────────
        c.x += c.vx;
        c.z += c.vz;

        if (!pe) {
            // ── Braquage progressif IA ────────────────────────────────────
            const sp2 = Math.hypot(c.vx, c.vz);
            if (sp2 > MIN_SPEED * 0.4) {
                const target = Math.atan2(-c.vz, c.vx);
                let da = target - c.angle;
                while (da >  Math.PI) da -= 2 * Math.PI;
                while (da < -Math.PI) da += 2 * Math.PI;
                c.angle += da * STEER_RATE;
            }
        }

        // ── Sync 3D ──────────────────────────────────────────────────────
        c.root.position.x = c.x;
        c.root.position.z = c.z;
        c.root.rotation.y = c.angle;

        // ── Sortie d'arène (IA seulement) ────────────────────────────────
        if (!pe && Math.hypot(c.x, c.z) > ARENA_R) _respawn(c, false);
    }

    // ── Collisions OBB ───────────────────────────────────────────────────
    _resolveAll();
    // Re-sync positions après séparation SAT
    const now = performance.now();
    for (const c of _cars) {
        c.root.position.x = c.x;
        c.root.position.z = c.z;
        if (c.girophare) c.girophare.update(now);
    }

    // ── Mise à jour sprites pseudo joueurs ───────────────────────────────────
    for (const { c, sprite } of _titlePlayerCars.values()) {
        sprite.position.set(c.x, 3.8, c.z);
    }

    renderer.render(_scene, _camera);
}

export function disposeTitleScene() {
    _running = false;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    window.removeEventListener('resize', _onResize);

    // Nettoyer écouteurs clavier
    if (_titleOnKeyDown) { document.removeEventListener('keydown', _titleOnKeyDown); _titleOnKeyDown = null; }
    if (_titleOnKeyUp)   { document.removeEventListener('keyup',   _titleOnKeyUp);   _titleOnKeyUp   = null; }

    // Nettoyer sprites joueurs
    for (const { sprite } of _titlePlayerCars.values()) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
    }
    _titlePlayerCars.clear();
    _kbClaimed = false;
    _gpClaimed.clear();
    Object.assign(_titleKbState, { left: false, right: false, up: false, down: false });

    // Déconnexion socket smartphone
    if (_titleSock) { _titleSock.disconnect(); _titleSock = null; }

    // Ne pas disposer le renderer — il est partagé avec le jeu
    renderer.domElement.style.display = 'none'; // caché jusqu'au démarrage du jeu
    _scene = _camera = null;
    _cars  = [];
}
