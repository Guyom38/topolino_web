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
const CAR_COUNT    = 22;
const CARS_TOP     = 7;    // voitures sur la route du haut
const CARS_BOT     = 15;   // voitures sur la route du bas

// ── Routes ────────────────────────────────────────────────────────────────────
const ROAD_TOP_Z    = -9;    // Z centre route du haut
const ROAD_BOT_Z    = 5.5;   // Z centre route du bas
const LANE_OFFSET   = 2.2;   // décalage voie depuis le centre de la route
const ROAD_HALF_LEN = 70;    // wrap-around X

// ── Physique OBB ──────────────────────────────────────────────────────────────
const CAR_HL      = 1.90;   // demi-longueur (axe avant/arrière)
const CAR_HW      = 0.88;   // demi-largeur
const DRAG        = 0.985;  // frottement sol (décélération passive)
const THRUST      = 0.0045; // poussée vers la vitesse cible chaque frame
const STEER_RATE  = 0.07;   // vitesse de braquage après collision (0=rigide, 1=instant)
const RESTITUTION = 0.06;   // rebond normal (quasi-nul → glissement pur)
const FRICTION    = 0.28;   // frottement tangentiel lors du contact
const MIN_SPEED   = 0.035;
const MAX_SPEED   = 0.18;
const POLICE_SPEED_MULT = 1.6; // police roule 1.6× plus vite

// ── Parking route du bas ─────────────────────────────────────────────────────
// Y2 = voie intérieure (côté terre-plein) → places de parking
// Y3 = voie extérieure → circulation lente ←
const BOT_LANE = 1.54;                        // voies 30% plus étroites
const BOT_Y2 = ROAD_BOT_Z - BOT_LANE;        // parking (côté herbe)
const BOT_Y3 = ROAD_BOT_Z + BOT_LANE;        // circulation
const PARK_SPOTS = (function() {
    const spots = [];
    for (let x = -60; x <= 60; x += 11) spots.push({ x, z: BOT_Y2 });
    return spots;
})();
const PARK_DURATION_MIN = 10000; // 10s minimum
const PARK_DURATION_MAX = 30000; // 30s maximum
const PARK_APPROACH = 15;    // distance pour repérer une place
const PARK_SNAP     = 1.5;   // distance de snap pour se garer

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

/** Résout toutes les paires O(n²) – 22 voitures = 231 tests, très léger */
function _resolveAll() {
    const n = _cars.length;
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
            // Ignorer les collisions avec les voitures garées ou en train de se ranger
            const pi = _cars[i].parkState, pj = _cars[j].parkState;
            if (pi === 'parked' || pi === 'entering' || pj === 'parked' || pj === 'entering') continue;
            _resolveOBB(_cars[i], _cars[j]);
        }
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

/** Place une voiture IA sur sa route avec un espacement régulier */
function _spawnOnRoad(c, index, total) {
    const spread = ROAD_HALF_LEN * 1.8;
    c.x = -ROAD_HALF_LEN + (index / total) * spread + (Math.random() - 0.5) * 3;
    c.baseSpeed  = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    if (c.isPolice && c.road === 0) c.baseSpeed *= POLICE_SPEED_MULT;

    // Police voie rapide en haut seulement, tout le monde sur mainZ en bas
    c.targetZ    = (c.isPolice && c.road === 0) ? c.overtakeZ : c.mainZ;
    c.z          = c.targetZ + (Math.random() - 0.5) * 0.5;
    c.overtaking = false;
    c.angle      = c.dir > 0 ? 0 : Math.PI;
    c.vx         = c.dir * c.baseSpeed;
    c.vz         = 0;
    c.root.position.set(c.x, 0, c.z);
    c.root.rotation.y = c.angle;
}

/** Bascule une voiture d'une route à l'autre (boucle haut→bas / bas→haut) */
function _switchRoad(c, newRoad) {
    c.road      = newRoad;
    c.dir       = newRoad === 0 ? 1 : -1;
    c.mainZ     = newRoad === 0 ? ROAD_TOP_Z + LANE_OFFSET : BOT_Y3;
    c.overtakeZ = newRoad === 0 ? ROAD_TOP_Z - LANE_OFFSET : BOT_Y2;
    // Police sur voie rapide en haut seulement, tout le monde sur Y3 en bas
    c.targetZ    = (c.isPolice && newRoad === 0) ? c.overtakeZ : c.mainZ;
    c.overtaking = false;
    // Reset parking
    c.parkState = null;
    c.parkSpot  = null;
    c.x     = c.dir > 0 ? -ROAD_HALF_LEN : ROAD_HALF_LEN;
    c.z     = c.targetZ;
    c.angle = c.dir > 0 ? 0 : Math.PI;
    c.vx    = c.dir * Math.abs(c.vx);
    c.vz    = 0;
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
        child.castShadow    = true;
        child.receiveShadow = false;
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
//  Routes à double sens (texture procédurale)
// ═══════════════════════════════════════════════════════════════════════════════

let _roadMeshes = [];
let _grassMesh  = null;

// ── Herbe procédurale ─────────────────────────────────────────────────────────

function _createGrassTexture() {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');

    // Base terrain vert foncé avec bruit multi-octaves
    const img = ctx.createImageData(S, S);
    for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
            const i = (py * S + px) * 4;
            const n1 = _smoothNoise(px, py, 6)  * 0.15;
            const n2 = _smoothNoise(px, py, 20) * 0.08;
            const n3 = _smoothNoise(px, py, 50) * 0.05;
            const v  = n1 + n2 + n3;
            img.data[i]     = 20 + v * 35;   // R
            img.data[i + 1] = 48 + v * 65;   // G
            img.data[i + 2] = 10 + v * 22;   // B
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);

    // Brins d'herbe (traits fins)
    for (let i = 0; i < 2000; i++) {
        const x    = Math.random() * S;
        const y    = Math.random() * S;
        const h    = 3 + Math.random() * 7;
        const lean = (Math.random() - 0.5) * 4;
        const shade = 30 + Math.random() * 60;
        ctx.strokeStyle = `rgba(${Math.floor(shade * 0.4)},${Math.floor(shade)},${Math.floor(shade * 0.25)},0.55)`;
        ctx.lineWidth   = 0.6 + Math.random() * 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + lean, y - h);
        ctx.stroke();
    }

    return cv;
}

function _createGrass() {
    const cv  = _createGrassTexture();
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(30, 30);

    const geo = new THREE.PlaneGeometry(250, 250);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.0 });
    _grassMesh = new THREE.Mesh(geo, mat);
    _grassMesh.rotation.x = -Math.PI / 2;
    _grassMesh.position.y = -0.04;
    _grassMesh.receiveShadow = true;
    _scene.add(_grassMesh);
}

/** Bruit lissé 2D pour texture asphalte / trottoir */
function _hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
}
function _smoothNoise(px, py, scale) {
    const sx = px / scale, sy = py / scale;
    const ix = Math.floor(sx), iy = Math.floor(sy);
    const fx = sx - ix, fy = sy - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = _hash(ix, iy),     b = _hash(ix + 1, iy);
    const c = _hash(ix, iy + 1), d = _hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function _createRoadTexture(seed, withParking = false) {
    const W = 2048, H = 512;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    const SIDEWALK = Math.floor(H * 0.14); // trottoir chaque côté
    const CURB     = 6;                     // bordure

    // ── Pixels : asphalte + trottoir avec bruit ───────────────────────────
    const img = ctx.createImageData(W, H);
    for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
            const i = (py * W + px) * 4;
            const sx = px + seed * 500; // décaler le bruit par route
            let r, g, b;

            if (py < SIDEWALK || py >= H - SIDEWALK) {
                // Trottoir — gris clair chaud
                const n = _smoothNoise(sx, py, 10) * 0.12
                        + _smoothNoise(sx, py, 28) * 0.06;
                const base = 135 + n * 55;
                r = base + 8; g = base + 2; b = base - 6;

                // Dalles de trottoir (grille subtile)
                const tileX = px % 64, tileY = (py < SIDEWALK ? py : py - (H - SIDEWALK)) % 40;
                if (tileX < 1 || tileY < 1) { r -= 18; g -= 18; b -= 16; }
            } else {
                // Asphalte — gris foncé granuleux
                const n1 = _smoothNoise(sx, py, 5)  * 0.14;
                const n2 = _smoothNoise(sx, py, 16) * 0.09;
                const n3 = _smoothNoise(sx, py, 40) * 0.04;
                const base = 38 + (n1 + n2 + n3) * 90;
                r = base; g = base; b = base + 3;
            }

            img.data[i]     = Math.max(0, Math.min(255, r));
            img.data[i + 1] = Math.max(0, Math.min(255, g));
            img.data[i + 2] = Math.max(0, Math.min(255, b));
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);

    // ── Bordures trottoir (rebord sombre) ─────────────────────────────────
    ctx.fillStyle = 'rgba(90,88,82,0.85)';
    ctx.fillRect(0, SIDEWALK - CURB, W, CURB);
    ctx.fillRect(0, H - SIDEWALK, W, CURB);

    // ── Lignes blanches de rive ───────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, SIDEWALK + 1, W, 4);
    ctx.fillRect(0, H - SIDEWALK - 5, W, 4);

    // ── Ligne centrale ────────────────────────────────────────────────────
    const centerY = Math.floor(H / 2) - 2;
    if (withParking) {
        // ═══ Route du bas : Y2 (parking) en haut, Y3 (circulation) en bas ═══
        // La texture est mappée : haut = côté terre-plein (Z petit), bas = extérieur (Z grand)
        // Ligne continue séparant Y2 et Y3
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(0, centerY, W, 4);

        // ── Marquages places de parking côté Y2 (moitié haute, places en LARGEUR) ──
        const ROAD_LEN = 140;
        const parkTop  = SIDEWALK + 6;          // bord haut de la zone parking
        const parkBot  = centerY - 6;           // bord bas (avant ligne centrale)
        const spotLen  = 130;                   // largeur d'une baie en pixels
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth   = 3;
        for (const sp of PARK_SPOTS) {
            const px = Math.round((sp.x + ROAD_LEN / 2) / ROAD_LEN * W);
            // Rectangle complet de la baie
            ctx.strokeRect(px - spotLen / 2, parkTop, spotLen, parkBot - parkTop);
            // Lettre P tournée 90° vers la gauche
            ctx.save();
            ctx.translate(px, (parkTop + parkBot) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = 'bold 58px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('P', 0, 0);
            ctx.restore();
        }
    } else {
        // ═══ Route du haut : 2 voies, ligne pointillée classique ═════════
        ctx.fillStyle = '#ffffff';
        const dash = 55, gap = 35;
        for (let x = 0; x < W; x += dash + gap) {
            ctx.fillRect(x, centerY, dash, 4);
        }
    }

    return cv;
}

function _createRoads() {
    const ROAD_LEN    = 140;
    const ROAD_W_TOP  = 12;
    const ROAD_W_BOT  = 8.4;   // 30% plus étroite

    // Route du haut (au-dessus du titre)
    const geo1 = new THREE.PlaneGeometry(ROAD_LEN, ROAD_W_TOP);
    const tex1 = new THREE.CanvasTexture(_createRoadTexture(0));
    const mat1 = new THREE.MeshStandardMaterial({ map: tex1, roughness: 0.92, metalness: 0.05 });
    const road1 = new THREE.Mesh(geo1, mat1);
    road1.rotation.x = -Math.PI / 2;
    road1.position.set(0, -0.02, ROAD_TOP_Z);
    road1.receiveShadow = true;
    _scene.add(road1);
    _roadMeshes.push(road1);

    // Route du bas — plus étroite, avec places de parking
    const geo2 = new THREE.PlaneGeometry(ROAD_LEN, ROAD_W_BOT);
    const tex2 = new THREE.CanvasTexture(_createRoadTexture(1, true));
    const mat2 = new THREE.MeshStandardMaterial({ map: tex2, roughness: 0.92, metalness: 0.05 });
    const road2 = new THREE.Mesh(geo2, mat2);
    road2.rotation.x = -Math.PI / 2;
    road2.position.set(0, -0.02, ROAD_BOT_Z);
    road2.receiveShadow = true;
    _scene.add(road2);
    _roadMeshes.push(road2);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Init / Loop / Dispose
// ═══════════════════════════════════════════════════════════════════════════════

export async function initTitleScene() {
    const W = window.innerWidth, H = window.innerHeight;

    // Renderer partagé avec le jeu — pas de second contexte WebGL
    renderer.domElement.style.display = 'block';
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // Rendre le fond du titre transparent pour laisser le canvas Three.js visible à travers
    const titleEl = document.getElementById('title-screen');
    if (titleEl) titleEl.style.background = 'transparent';

    _scene  = new THREE.Scene();
    _scene.background = new THREE.Color(0x04091a); // fond sombre proche du CSS titre
    _camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);
    _camera.position.set(0, 12, 10);
    _camera.lookAt(0, 0, 0);

    _scene.add(new THREE.AmbientLight(0x7799cc, 0.6));

    // Soleil venant d'en bas (Z+, faible hauteur) → ombres vers le haut de l'écran
    const sun = new THREE.DirectionalLight(0xfff0cc, 1.9);
    sun.position.set(10, 28, 40);   // vient du bas de l'écran, légèrement à droite
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 120;
    sun.shadow.camera.left   = -80;
    sun.shadow.camera.right  =  80;
    sun.shadow.camera.top    =  40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.bias = -0.001;
    _scene.add(sun);

    const fill = new THREE.DirectionalLight(0x334488, 0.35);
    fill.position.set(-20, 8, -15); _scene.add(fill);

    _createGrass();
    _createRoads();

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

        // Répartition : CARS_TOP en haut, CARS_BOT en bas
        const road      = i < CARS_TOP ? 0 : 1;
        const dir       = road === 0 ? 1 : -1;     // haut → droite, bas → gauche
        const mainZ     = road === 0 ? ROAD_TOP_Z + LANE_OFFSET : BOT_Y3;  // Y3 pour le bas
        const overtakeZ = road === 0 ? ROAD_TOP_Z - LANE_OFFSET : BOT_Y2; // Y2 (parking) pour le bas

        // Pré-garer 3 voitures civiles du bas sur des spots répartis (0, 4, 8)
        const botIdx    = road === 1 ? i - CARS_TOP : -1;
        const PRE_SPOTS = [0, 4, 8];
        const preSpotIdx = PRE_SPOTS.indexOf(botIdx);
        const preParked  = road === 1 && !isPolice && preSpotIdx !== -1;

        const c = {
            root, x: 0, z: 0, vx: 0, vz: 0, angle: 0, baseSpeed: 0.05, girophare,
            isPolice, road, dir, mainZ, overtakeZ,
            targetZ: mainZ, overtaking: false, _overtakeX: 0,
            // Parking (route du bas uniquement)
            parkState: null,   // null | 'braking' | 'entering' | 'parked' | 'leaving'
            parkSpot: null,    // index dans PARK_SPOTS
            parkTimer: 0,
            parkDuration: 0,
        };
        _cars.push(c);
        const idx   = road === 0 ? i : i - CARS_TOP;
        const total = road === 0 ? CARS_TOP : CARS_BOT;
        _spawnOnRoad(c, idx, total);

        // Placer directement sur la place de parking avec un timer aléatoire déjà entamé
        if (preParked) {
            const sp = PARK_SPOTS[PRE_SPOTS[preSpotIdx]];
            c.x         = sp.x;
            c.z         = sp.z;
            c.vx        = 0; c.vz = 0;
            c.parkState    = 'parked';
            c.parkSpot     = PRE_SPOTS[preSpotIdx];
            c.parkDuration = PARK_DURATION_MIN + Math.random() * (PARK_DURATION_MAX - PARK_DURATION_MIN);
            c.parkTimer    = performance.now() - Math.random() * c.parkDuration; // timer déjà en cours
            c.angle        = Math.PI; // face à gauche
            c.root.position.set(c.x, 0, c.z);
            c.root.rotation.y = c.angle;
        }
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
            // ── IA routière ───────────────────────────────────────────────
            const SAFE_GAP   = CAR_HL * 3;   // marge 1/2 voiture entre véhicules
            const LOOK_AHEAD = 14;            // distance de détection
            const BRAKE_DIST = 7;             // début de freinage

            // 1) Accélération vers la vitesse cible
            if (Math.abs(c.vx) < c.baseSpeed) {
                c.vx += c.dir * THRUST;
            }

            // 2) Braquage latéral vers la voie cible
            const dz = c.targetZ - c.z;
            c.vz += dz * 0.008;
            c.vz *= 0.88;

            // 3) Scanner la voiture la plus proche devant (même voie)
            let closestDist = Infinity;
            let closestCar  = null;
            for (const other of _cars) {
                if (other === c || other.road !== c.road) continue;
                if (_getPlayerEntry(other)) continue;
                const ahead = c.dir * (other.x - c.x);
                if (ahead > 0 && ahead < LOOK_AHEAD && Math.abs(other.z - c.z) < 2.5) {
                    if (ahead < closestDist) { closestDist = ahead; closestCar = other; }
                }
            }

            // 4) Freinage si danger
            if (closestCar && closestDist < BRAKE_DIST) {
                const otherSp = Math.abs(closestCar.vx);
                if (Math.abs(c.vx) > otherSp) {
                    c.vx *= closestDist < SAFE_GAP ? 0.88 : 0.95;
                }
            }

            if (c.isPolice && c.road === 0) {
                // ── Police sur route du haut : voie rapide ──────────────
                c.targetZ = c.overtakeZ;

            } else if (c.road === 1) {
                // ══ Route du bas : Y3 circulation + Y2 parking ══════════
                // Pas de dépassement sur cette route
                c.overtaking = false;

                const now = performance.now();

                if (c.parkState === 'braking') {
                    // ── Phase 1 : freiner sur Y3 (bloque le trafic derrière) ──
                    c.targetZ = c.mainZ;   // reste sur Y3
                    c.vx *= 0.93;          // freinage progressif
                    // Quasi arrêtée → se ranger vers Y2
                    if (Math.abs(c.vx) < MIN_SPEED * 0.8) {
                        c.parkState = 'entering';
                    }
                } else if (c.parkState === 'entering') {
                    // ── Phase 2 : se ranger de Y3 vers Y2 ────────────────────
                    const spot = PARK_SPOTS[c.parkSpot];
                    c.targetZ = spot.z;    // viser Y2
                    // Avancer doucement vers la place
                    const dx  = spot.x - c.x;
                    const dxA = Math.abs(dx);
                    if (dxA > PARK_SNAP) {
                        c.vx = c.dir * MIN_SPEED * 0.4; // rouler doucement
                    }
                    // Snap quand assez proche
                    if (dxA < PARK_SNAP && Math.abs(c.z - spot.z) < PARK_SNAP) {
                        c.x = spot.x;
                        c.z = spot.z;
                        c.vx = 0; c.vz = 0;
                        c.parkState    = 'parked';
                        c.parkDuration = PARK_DURATION_MIN + Math.random() * (PARK_DURATION_MAX - PARK_DURATION_MIN);
                        c.parkTimer    = now;
                        c.angle = c.dir > 0 ? 0 : Math.PI;
                    }
                } else if (c.parkState === 'parked') {
                    // ── Phase 3 : garée, attendre 10s ────────────────────────
                    c.vx = 0; c.vz = 0;
                    if (now - c.parkTimer > c.parkDuration) {
                        c.parkState = 'leaving';
                    }
                } else if (c.parkState === 'leaving') {
                    // ── Phase 4 : quitter Y2, revenir sur Y3 ────────────────
                    c.targetZ = c.mainZ;
                    if (Math.abs(c.vx) < c.baseSpeed * 0.5) {
                        c.vx += c.dir * THRUST * 0.5;
                    }
                    if (Math.abs(c.z - c.mainZ) < 0.5) {
                        c.parkState = null;
                        c.parkSpot  = null;
                    }
                } else {
                    // ── Circulation normale sur Y3 ───────────────────────────
                    c.targetZ = c.mainZ;
                    // Chercher une place libre devant (probabilité)
                    if (Math.random() < 0.003) {
                        for (let si = 0; si < PARK_SPOTS.length; si++) {
                            const spot  = PARK_SPOTS[si];
                            const ahead = c.dir * (spot.x - c.x);
                            if (ahead > 2 && ahead < PARK_APPROACH) {
                                let occupied = false;
                                for (const other of _cars) {
                                    if (other === c) continue;
                                    if (other.parkSpot === si && other.parkState) {
                                        occupied = true; break;
                                    }
                                }
                                if (!occupied) {
                                    c.parkState = 'braking';
                                    c.parkSpot  = si;
                                    break;
                                }
                            }
                        }
                    }
                }

            } else {
                // ══ Route du haut : dépassement classique ════════════════
                // Civil : se rabattre si police arrive par derrière sur la voie de dépassement
                if (c.overtaking) {
                    let policeApproaching = false;
                    for (const other of _cars) {
                        if (!other.isPolice || other.road !== c.road) continue;
                        const behind = c.dir * (other.x - c.x);
                        if (behind > -LOOK_AHEAD && behind < SAFE_GAP + 4 && Math.abs(other.z - c.overtakeZ) < 2.5) {
                            policeApproaching = true; break;
                        }
                    }
                    if (policeApproaching) {
                        c.targetZ = c.mainZ;
                        c.overtaking = false;
                    }
                }

                // 5) Dépassement (monter sur la voie de gauche = la plus haute)
                if (!c.overtaking && closestCar && closestDist < LOOK_AHEAD) {
                    if (Math.abs(c.vx) > Math.abs(closestCar.vx) * 1.1) {
                        let overtakeFree = true;
                        for (const other of _cars) {
                            if (other === c || other.road !== c.road) continue;
                            const dx = c.dir * (other.x - c.x);
                            if (dx > -SAFE_GAP && dx < LOOK_AHEAD && Math.abs(other.z - c.overtakeZ) < 2.5) {
                                overtakeFree = false; break;
                            }
                        }
                        if (overtakeFree) {
                            c.targetZ    = c.overtakeZ;
                            c.overtaking = true;
                            c._overtakeX = closestCar.x;
                        }
                    }
                }

                // 6) Retour voie principale après dépassement
                if (c.overtaking) {
                    if (c.dir * (c.x - c._overtakeX) > SAFE_GAP + 2) {
                        let clear = true;
                        for (const other of _cars) {
                            if (other === c || other.road !== c.road) continue;
                            if (Math.abs(other.x - c.x) < SAFE_GAP && Math.abs(other.z - c.mainZ) < 2.5) {
                                clear = false; break;
                            }
                        }
                        if (clear) { c.targetZ = c.mainZ; c.overtaking = false; }
                    }
                }
            }

            // 7) Boucle : haut sort à droite → bas entre à droite ; bas sort à gauche → haut entre à gauche
            //    Ne pas boucler si la voiture est garée ou en approche
            if (!c.parkState) {
                if (c.road === 0 && c.x > ROAD_HALF_LEN)       _switchRoad(c, 1);
                else if (c.road === 1 && c.x < -ROAD_HALF_LEN) _switchRoad(c, 0);
            }
        }

        // ── Frottement sol ───────────────────────────────────────────────
        c.vx *= DRAG;
        c.vz *= DRAG;

        // ── Déplacement ──────────────────────────────────────────────────
        c.x += c.vx;
        c.z += c.vz;

        // ── Orientation (face la direction du mouvement) ─────────────────
        if (!pe) {
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

    // Nettoyer herbe
    if (_grassMesh) {
        _grassMesh.geometry.dispose();
        _grassMesh.material.map?.dispose();
        _grassMesh.material.dispose();
        _grassMesh = null;
    }

    // Nettoyer routes
    for (const r of _roadMeshes) {
        r.geometry.dispose();
        r.material.map?.dispose();
        r.material.dispose();
    }
    _roadMeshes = [];

    // Ne pas disposer le renderer — il est partagé avec le jeu
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.display = 'none'; // caché jusqu'au démarrage du jeu
    _scene = _camera = null;
    _cars  = [];
}
