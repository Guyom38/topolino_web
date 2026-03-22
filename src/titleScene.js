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
const DEBUG_OBB = true;

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
    // spotLen=78px sur texture 2048px pour route 140u → 78*140/2048 ≈ 5.3u par place
    // espacement = largeur spot + 0.6u de marge = 5.9u
    for (let x = -60; x <= 60; x += 5.9) spots.push({ x, z: BOT_Y2 });
    return spots;
})();
const PARK_DURATION_MIN = 10000; // 10s minimum
const PARK_DURATION_MAX = 40000; // 40s maximum
const PARK_APPROACH = 15;    // distance pour repérer une place
const PARK_SNAP     = 1.5;   // distance de snap pour se garer

let _scene       = null;
let _camera      = null;
let _cars        = [];
let _running     = false;
let _animId      = null;
let _fbxTemplate = null;  // référence au template FBX pour les mini-voitures
let _qrMesh      = null;
let _smokeTex    = null;

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

// ── Mini-voitures manette (trottoir du bas) ───────────────────────────────────
const _miniCars      = new Map(); // gpIndex → { root, x, z, vx, vz, angle, sprite, keys }
const MINI_SCALE     = 0.20;      // 20% de la taille normale
const MINI_Z         = -0.9;      // Z pelouse centrale (entre les deux routes)
const MINI_THRUST    = 0.007;
const MINI_MAX_SPD   = 0.22;
const MINI_DRAG      = 0.93;

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

/** Collision cercle entre mini-voitures et voitures IA */
function _resolveMiniCollisions() {
    const CONTACT = CAR_HL * (1 + MINI_SCALE); // ~2.28 : somme des rayons approx
    for (const mc of _miniCars.values()) {
        for (const c of _cars) {
            if (c.parkState === 'parked') continue;
            const dx = mc.x - c.x, dz = mc.z - c.z;
            const dist = Math.hypot(dx, dz);
            if (dist > CONTACT || dist < 0.001) continue;
            const nx = dx / dist, nz = dz / dist;
            const overlap = CONTACT - dist;
            // Mini car expulsée, IA car légèrement repoussée
            mc.x += nx * overlap * 0.85;
            mc.z += nz * overlap * 0.85;
            c.x  -= nx * overlap * 0.15;
            c.z  -= nz * overlap * 0.15;
            // Rebond mini car + légère perturbation IA
            const vn = (mc.vx - c.vx) * nx + (mc.vz - c.vz) * nz;
            if (vn < 0) {
                mc.vx -= vn * 1.4 * nx;
                mc.vz -= vn * 1.4 * nz;
                c.vx  += vn * 0.15 * nx;
                c.vz  += vn * 0.15 * nz;
            }
        }
    }
}

/** Résout toutes les paires O(n²) – 22 voitures = 231 tests, très léger */
function _resolveAll() {
    const n = _cars.length;
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
            // Ignorer les collisions avec les voitures garées ou en train de se ranger
            const pi = _cars[i].parkState, pj = _cars[j].parkState;
            if (pi === 'parked' || pi === 'reversing' || pi === 'leaving' ||
                pj === 'parked' || pj === 'reversing' || pj === 'leaving') continue;
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

function _spawnMiniCar(gpIndex) {
    if (_miniCars.has(gpIndex) || !_scene || !_fbxTemplate) return;
    const color    = _TITLE_COLORS[_miniCars.size % _TITLE_COLORS.length];
    const colorInt = parseInt(color.replace('#', ''), 16);
    const root = new THREE.Group();
    const { group: carGroup } = _buildCar(_fbxTemplate, colorInt);
    root.add(carGroup);
    root.scale.setScalar(MINI_SCALE);
    const startX = (Math.random() - 0.5) * 40;
    root.position.set(startX, 0, MINI_Z);
    _scene.add(root);
    const sprite = _createNameSprite(`P${gpIndex + 1}`, color);
    _miniCars.set(gpIndex, {
        root, x: startX, z: MINI_Z,
        vx: 0, vz: 0, angle: Math.PI, // face à gauche comme les voitures du bas
        sprite, keys: { left: false, right: false, up: false, down: false },
    });
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

    const brakeMeshes   = []; // feux stop rouges
    const reverseMeshes = []; // feux de recul blancs

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

        // ── Collecte des feux arrière (clone impératif pour ne pas partager le matériau) ──
        const n = child.name.toLowerCase();
        const isBrake   = n.includes('phares_arriere_stop') || n.includes('lumineux_arriere_parchoque');
        const isReverse = n === 'phares_arrieres';
        if (isBrake || isReverse) {
            child.material = child.material.clone();
            child.material.emissive          = new THREE.Color(isBrake ? 0x550000 : 0x111111);
            child.material.emissiveIntensity = 0.05;
            if (isBrake) brakeMeshes.push(child);
            else         reverseMeshes.push(child);
        }
    });

    return { group: clone, brakeMeshes, reverseMeshes };
}

function _setBrakeLights(c, on) {
    for (const m of c.brakeMeshes) {
        m.material.emissive.setHex(on ? 0xff1100 : 0x550000);
        m.material.emissiveIntensity = on ? 9.0 : 0.05;
    }
}
function _setReverseLights(c, on) {
    for (const m of c.reverseMeshes) {
        m.material.emissive.setHex(on ? 0xffffff : 0x111111);
        m.material.emissiveIntensity = on ? 6.0 : 0.05;
    }
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

function _createRoadTexture(seed, withParking = false, withCrossing = false) {
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
        const spotLen  = 78;                    // largeur d'une baie en pixels (-40%)
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
            ctx.font = 'bold 28px Arial';
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

    // ── Passage piéton ────────────────────────────────────────────────────
    if (withCrossing) {
        const crossPx  = Math.round(W * 0.36);   // côté gauche visible (X ≈ -20)
        const stripeH  = 18;                      // hauteur d'une bande
        const stripeG  = 13;                      // espace entre bandes
        const zoneW    = 90;                      // largeur de la zone passage en X
        const cx0      = crossPx - zoneW / 2;
        const roadH    = H - 2 * SIDEWALK;
        const nStripes = Math.floor(roadH / (stripeH + stripeG)) + 1;
        // Bandes de trottoir à trottoir (toute la hauteur des deux voies)
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        for (let s = 0; s < nStripes; s++) {
            const sy = SIDEWALK + s * (stripeH + stripeG);
            if (sy + stripeH > H - SIDEWALK) break;
            ctx.fillRect(cx0, sy, zoneW, stripeH);
        }
    }

    return cv;
}

// ── Fumée de capot (voitures garées > 30s) ───────────────────────────────────

function _getSmokeTex() {
    if (_smokeTex) return _smokeTex;
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
    g.addColorStop(0,    'rgba(255,255,255,1.0)');
    g.addColorStop(0.45, 'rgba(245,245,248,0.75)');
    g.addColorStop(1,    'rgba(220,220,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    _smokeTex = new THREE.CanvasTexture(cv);
    return _smokeTex;
}

class SmokeSystem {
    constructor(c) {
        this._c    = c;
        this._pts  = [];
        this._next = 0;
    }

    update(now) {
        if (now >= this._next) {
            this._emit();
            this._next = now + 160 + Math.random() * 260;
        }
        for (let i = this._pts.length - 1; i >= 0; i--) {
            const p = this._pts[i];
            const t = (now - p.born) / p.life;
            if (t >= 1) {
                _scene?.remove(p.sp);
                p.sp.material.dispose();
                this._pts.splice(i, 1);
                continue;
            }
            p.sp.position.y += p.vy;
            p.sp.position.x += p.vx;
            p.sp.position.z += p.vz;
            p.sp.scale.setScalar(p.s0 + (p.s1 - p.s0) * t);
            p.sp.material.opacity = p.op * (1 - t * t);
        }
    }

    _emit() {
        if (!_scene) return;
        const c  = this._c;
        const hx = c.x + Math.cos(c.angle) * CAR_HL * 0.55 + (Math.random() - 0.5) * 0.18;
        const hz = c.z - Math.sin(c.angle) * CAR_HL * 0.55 + (Math.random() - 0.5) * 0.18;
        const hy = 0.5 + Math.random() * 0.12;
        const mat = new THREE.SpriteMaterial({
            map: _getSmokeTex(), transparent: true,
            opacity: 0.65, depthWrite: false,
        });
        const sp = new THREE.Sprite(mat);
        sp.position.set(hx, hy, hz);
        const s0 = 0.07 + Math.random() * 0.06;
        sp.scale.setScalar(s0);
        _scene.add(sp);
        this._pts.push({
            sp, born: performance.now(),
            life: 1500 + Math.random() * 1100,
            vx: (Math.random() - 0.5) * 0.004,
            vy: 0.013 + Math.random() * 0.009,
            vz: (Math.random() - 0.5) * 0.004,
            s0, s1: 0.55 + Math.random() * 0.35,
            op: 0.5 + Math.random() * 0.25,
        });
    }

    dispose() {
        for (const p of this._pts) {
            _scene?.remove(p.sp);
            p.sp.material.dispose();
        }
        this._pts = [];
    }
}

function _createQRSign(url) {
    if (typeof QRCode === 'undefined') return;
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
    document.body.appendChild(div);
    new QRCode(div, {
        text: url, width: 240, height: 240,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
    });
    setTimeout(() => {
        document.body.removeChild(div);
        if (!_scene) return;
        const SIZE = 256;
        const cv  = document.createElement('canvas');
        cv.width  = SIZE; cv.height = SIZE;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, SIZE, SIZE);
        const src = div.querySelector('canvas') || div.querySelector('img');
        if (src) ctx.drawImage(src, 8, 8, 240, 240);
        const tex = new THREE.CanvasTexture(cv);
        const geo = new THREE.PlaneGeometry(4.0, 4.0);
        const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
        _qrMesh = new THREE.Mesh(geo, mat);
        _qrMesh.rotation.x = -Math.PI / 2;
        _qrMesh.position.set(11, 0.07, -0.74);
        _scene.add(_qrMesh);
    }, 400);
}

function _createRoads() {
    const ROAD_LEN    = 140;
    const ROAD_W_TOP  = 12;
    const ROAD_W_BOT  = 8.4;   // 30% plus étroite

    // Route du haut (au-dessus du titre) — avec passage piéton
    const geo1 = new THREE.PlaneGeometry(ROAD_LEN, ROAD_W_TOP);
    const tex1 = new THREE.CanvasTexture(_createRoadTexture(0, false, true));
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

    // QR code à plat sur l'herbe (côté droit)
    fetch('/api/info')
        .then(r => r.json())
        .then(d => _createQRSign(d.server_url + '/mobile'))
        .catch(() => _createQRSign(window.location.origin + '/mobile'));

    let fbxTemplate;
    try {
        fbxTemplate = await new Promise((res, rej) =>
            new FBXLoader().load('Asssets/topolino_low49k.fbx', res, null, rej)
        );
    } catch (e) { console.warn('[TitleScene] FBX non chargé:', e); return; }
    _fbxTemplate = fbxTemplate; // conservé pour les mini-voitures manette

    const policeColor = parseInt(POLICE_COLOR.replace('#', ''), 16);

    for (let i = 0; i < CAR_COUNT; i++) {
        // ~1 voiture sur 7 est une voiture de police
        const isPolice = (i % 7 === 0);
        const color    = isPolice ? policeColor : BODY_COLORS[i % BODY_COLORS.length];
        const root     = new THREE.Group();
        const { group: carGroup, brakeMeshes, reverseMeshes } = _buildCar(fbxTemplate, color, isPolice);
        root.add(carGroup);
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
            parkState: null,   // null | 'approaching' | 'reversing' | 'parked' | 'leaving'
            parkSpot: null,    // index dans PARK_SPOTS
            parkTimer: 0,
            parkDuration: 0,
            _revT: 0, _revStartX: 0, _revStartZ: 0, // créneau marche arrière bezier
            _leaveT: 0,                              // sortie bezier
            _leavingReverse: false,                  // true pendant la marche arrière de sortie
            _wantsLeave: false,                      // en attente de sortir du parking
            brakeMeshes, reverseMeshes,              // feux stop / recul
            smoke: null,                             // SmokeSystem si garé > 30s
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
            c.angle        = Math.PI; // parallèle à la circulation
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
                _spawnMiniCar(idx); // mini-voiture sur le trottoir du bas
            }
            const mc = _miniCars.get(idx);
            if (mc) {
                const ax0 = gp.axes[0] ?? 0;
                mc.keys.left  = ax0 < -0.15 || gp.buttons[14]?.pressed;
                mc.keys.right = ax0 >  0.15 || gp.buttons[15]?.pressed;
                mc.keys.up    = (gp.buttons[7]?.value ?? 0) > 0.1
                              || (gp.axes[3] ?? 0) < -0.3
                              || gp.buttons[0]?.pressed;
                mc.keys.down  = (gp.buttons[6]?.value ?? 0) > 0.1
                              || gp.buttons[1]?.pressed;
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

            // 1) Accélération vers la vitesse cible (pas pendant manœuvre parking)
            const isManeuver = c.parkState === 'reversing' || c.parkState === 'parked' || c.parkState === 'leaving';
            if (!isManeuver && Math.abs(c.vx) < c.baseSpeed) {
                c.vx += c.dir * THRUST;
            }

            // 2) Braquage latéral (désactivé pendant manœuvre parking)
            if (!isManeuver) {
                const dz = c.targetZ - c.z;
                c.vz += dz * 0.008;
                c.vz *= 0.88;
            }

            // 3) Scanner la voiture la plus proche devant (même route)
            let closestDist = Infinity;
            let closestCar  = null;
            for (const other of _cars) {
                if (other === c || other.road !== c.road) continue;
                if (_getPlayerEntry(other)) continue;
                const ahead = c.dir * (other.x - c.x);
                if (ahead <= 0) continue;
                // Zone Z très élargie pour manœuvres parking (la voiture traverse Y3→Y2)
                const isParking = other.parkState === 'approaching' || other.parkState === 'reversing';
                const wantsOut  = other._wantsLeave || other.parkState === 'leaving';
                const zThresh   = (isParking || wantsOut) ? 7.0 : 2.5;
                const lookDist  = isParking ? LOOK_AHEAD + 12 : LOOK_AHEAD + 4;
                if (ahead < lookDist && Math.abs(other.z - c.z) < zThresh) {
                    if (ahead < closestDist) { closestDist = ahead; closestCar = other; }
                }
            }

            // Scanner aussi les mini-voitures comme obstacles
            for (const mc of _miniCars.values()) {
                const ahead = c.dir * (mc.x - c.x);
                if (ahead > 0 && ahead < LOOK_AHEAD && Math.abs(mc.z - c.z) < 2.5) {
                    if (ahead < closestDist) {
                        closestDist = ahead;
                        closestCar  = { vx: mc.vx, vz: 0, parkState: null, _wantsLeave: false };
                    }
                }
            }

            // 4) Freinage et distance de sécurité
            let _didBrake = false;
            if (closestCar) {
                const isParking = closestCar.parkState === 'approaching' || closestCar.parkState === 'reversing';
                const wantsOut  = closestCar._wantsLeave || closestCar.parkState === 'leaving';
                const otherSp   = Math.abs(closestCar.vx);

                // Distances selon le contexte : manœuvre → grand gap, normal → petit
                const stopGap  = isParking ? CAR_HL * 5 : wantsOut ? CAR_HL * 4 : SAFE_GAP;
                const brakeDist = isParking ? stopGap + 8 : wantsOut ? stopGap + 6 : BRAKE_DIST;

                if (closestDist < brakeDist) {
                    if (closestDist < CAR_HL * 1.8) {
                        // Urgence : arrêt quasi immédiat
                        c.vx = c.dir * Math.min(Math.abs(c.vx) * 0.4, otherSp);
                    } else if (closestDist < stopGap) {
                        // Dans la zone d'arrêt : freinage fort → vitesse quasi nulle
                        if (isParking || wantsOut) {
                            c.vx *= 0.82;
                            // Arrêter complètement si très lent
                            if (Math.abs(c.vx) < MIN_SPEED * 0.5) c.vx = 0;
                        } else {
                            c.vx *= 0.88;
                        }
                    } else {
                        // Approche : ralentir progressivement
                        const ratio = (closestDist - stopGap) / (brakeDist - stopGap);
                        const brk = 0.85 + ratio * 0.12; // 0.85 à 0.97
                        c.vx *= brk;
                    }
                    _didBrake = true;
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

                if (c.parkState === 'approaching') {
                    // ── Phase 1 : rouler normalement jusqu'à dépasser la place d'½ longueur ──
                    const spot = PARK_SPOTS[c.parkSpot];
                    const distPast = c.dir * (c.x - spot.x);
                    // Continuer à vitesse normale (pas de freinage)
                    if (Math.abs(c.vx) < c.baseSpeed) c.vx += c.dir * THRUST;
                    // Dès qu'on dépasse d'½ place (~2.9u), on s'arrête et on recule
                    if (distPast > 2.9) {
                        c.vx = 0; c.vz = 0;
                        c.parkState    = 'reversing';
                        c._revT        = 0;
                        c._revStartX   = c.x;
                        c._revStartZ   = c.z;
                    }
                } else if (c.parkState === 'reversing') {
                    // ── Phase 2 : marche arrière en créneau (bezier) vers la place Y2 ──
                    const spot = PARK_SPOTS[c.parkSpot];
                    const P0x = c._revStartX, P0z = c._revStartZ;
                    const P3x = spot.x,       P3z = spot.z;
                    // Tangentes : recule droit au départ, arrive droit dans la place
                    const backLen = Math.abs(P0x - P3x) * 0.55;
                    const P1x = P0x - c.dir * backLen, P1z = P0z;       // recule le long de la route
                    const P2x = P3x + c.dir * backLen * 0.3, P2z = P3z; // rejoint la place parallèle

                    c._revT = Math.min(c._revT + 0.009, 1.0);
                    const t = c._revT, mt = 1 - t;
                    c.x = mt*mt*mt*P0x + 3*mt*mt*t*P1x + 3*mt*t*t*P2x + t*t*t*P3x;
                    c.z = mt*mt*mt*P0z + 3*mt*mt*t*P1z + 3*mt*t*t*P2z + t*t*t*P3z;
                    c.vx = 0; c.vz = 0;
                    // Tangente → orientation (+ PI car marche arrière)
                    const dBx = 3*(mt*mt*(P1x-P0x) + 2*mt*t*(P2x-P1x) + t*t*(P3x-P2x));
                    const dBz = 3*(mt*mt*(P1z-P0z) + 2*mt*t*(P2z-P1z) + t*t*(P3z-P2z));
                    if (Math.hypot(dBx, dBz) > 0.001) c.angle = Math.atan2(-dBz, dBx) + Math.PI;
                    if (t >= 1.0) {
                        c.x = P3x; c.z = P3z;
                        c.vx = 0; c.vz = 0;
                        c.parkState    = 'parked';
                        c.parkDuration = PARK_DURATION_MIN + Math.random() * (PARK_DURATION_MAX - PARK_DURATION_MIN);
                        c.parkTimer    = now;
                        c.angle        = Math.PI;
                    }
                } else if (c.parkState === 'parked') {
                    // ── Phase 3 : garée, puis attendre un créneau pour partir ──
                    c.vx = 0; c.vz = 0;
                    if (now - c.parkTimer > c.parkDuration) {
                        c._wantsLeave = true; // signal feux stop, signal aux approchants
                    }
                    if (c._wantsLeave) {
                        // Vérifier si la voie Y3 est dégagée pour la sortie
                        const spot     = PARK_SPOTS[c.parkSpot];
                        const exitDist = CAR_HL * 5;
                        let pathClear = true;
                        let yielded   = false;
                        for (const other of _cars) {
                            if (other === c || other.road !== c.road || other.parkState === 'parked') continue;
                            const inZone = Math.abs(other.x - spot.x) < exitDist + CAR_HL * 2
                                        && Math.abs(other.z - c.mainZ) < 3.5;
                            if (inZone) {
                                pathClear = false;
                                // Voiture approchant depuis derrière (trafic venant de droite pour dir=-1)
                                // qui s'est arrêtée pour céder le passage
                                const fromBehind = c.dir * (other.x - spot.x) < -CAR_HL;
                                if (fromBehind && Math.abs(other.vx) < MIN_SPEED * 0.8) {
                                    yielded = true;
                                }
                            }
                        }
                        if (pathClear || yielded) {
                            c.parkState   = 'leaving';
                            c._leaveT     = 0;
                            c._wantsLeave = false;
                        }
                    }
                } else if (c.parkState === 'leaving') {
                    // ── Phase 4 : 2 sous-phases réalistes ───────────────────
                    // A) Marche arrière en braquant (nez tourne vers la route)
                    // B) Marche avant : rejoint Y3 en courbe
                    const spot   = PARK_SPOTS[c.parkSpot];
                    const dzRoad = c.mainZ - spot.z;  // écart latéral Y2→Y3

                    // Points clés
                    const revEndX = spot.x - c.dir * 1.4;         // recule ~1.4u
                    const revEndZ = spot.z;                       // reste sur Y2
                    const fwdEndX = spot.x + c.dir * 6;           // avance 6u
                    const fwdEndZ = c.mainZ;                      // sur Y3

                    c._leaveT = Math.min(c._leaveT + 0.005, 1.0);
                    const t = c._leaveT;
                    c.vx = 0; c.vz = 0;

                    if (t < 0.38) {
                        // ── A) Marche arrière droite ─────────────────────────
                        const st = t / 0.38;
                        const ease = st * st * (3 - 2 * st); // smoothstep
                        // Recule droit le long de Y2, pas de mouvement latéral
                        c.x = spot.x - c.dir * 1.4 * ease;
                        c.z = spot.z;
                        // Angle fixe (parallèle à la route), léger braquage en fin
                        c.angle = (c.dir > 0 ? 0 : Math.PI) - c.dir * 0.25 * Math.max(0, (st - 0.7) / 0.3);
                        c._leavingReverse = true;
                    } else {
                        // ── B) Marche avant en courbe vers Y3 (bezier) ──────
                        const st = (t - 0.38) / 0.62;
                        // Bezier cubique
                        const P0x = revEndX,                P0z = revEndZ;
                        const P1x = revEndX + c.dir * 1.5,  P1z = revEndZ;   // avance tangent
                        const P2x = fwdEndX - c.dir * 2.5,  P2z = fwdEndZ;   // approche Y3
                        const P3x = fwdEndX,                P3z = fwdEndZ;
                        const mt = 1 - st;
                        c.x = mt*mt*mt*P0x + 3*mt*mt*st*P1x + 3*mt*st*st*P2x + st*st*st*P3x;
                        c.z = mt*mt*mt*P0z + 3*mt*mt*st*P1z + 3*mt*st*st*P2z + st*st*st*P3z;
                        // Tangente → angle
                        const dBx = 3*(mt*mt*(P1x-P0x) + 2*mt*st*(P2x-P1x) + st*st*(P3x-P2x));
                        const dBz = 3*(mt*mt*(P1z-P0z) + 2*mt*st*(P2z-P1z) + st*st*(P3z-P2z));
                        if (Math.hypot(dBx, dBz) > 0.001) c.angle = Math.atan2(-dBz, dBx);
                        c._leavingReverse = false;
                    }

                    if (t >= 1.0) {
                        c.x = fwdEndX; c.z = fwdEndZ;
                        c.parkState = null;
                        c.parkSpot  = null;
                        c._leaveT   = 0;
                        c._leavingReverse = false;
                        c.angle = c.dir > 0 ? 0 : Math.PI;
                        c.vx = c.dir * c.baseSpeed * 0.5;
                    }
                } else {
                    // ── Circulation normale sur Y3 ───────────────────────────
                    c.targetZ = c.mainZ;
                    // Probabilité augmentée si moins de 2 voitures garées
                    const parkedCount = _cars.filter(o => o.parkState === 'parked').length;
                    const parkProb = parkedCount < 2 ? 0.015 : 0.003;
                    if (Math.random() < parkProb) {
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
                                    c.parkState = 'approaching';
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

            // Feux stop / recul
            _setBrakeLights(c, c.parkState === 'reversing' || c._wantsLeave || c._leavingReverse || _didBrake);
            _setReverseLights(c, c.parkState === 'reversing' || c._leavingReverse);

            // Fumée de capot si garé > 30s
            if (c.parkState === 'parked') {
                if (performance.now() - c.parkTimer > 30000 && !c.smoke) c.smoke = new SmokeSystem(c);
                if (c.smoke) c.smoke.update(performance.now());
            } else if (c.smoke) {
                c.smoke.dispose(); c.smoke = null;
            }

            // 7) Boucle : haut sort à droite → bas entre à droite ; bas sort à gauche → haut entre à gauche
            //    Ne pas boucler si la voiture est garée ou en approche
            if (!c.parkState) {
                if (c.road === 0 && c.x > ROAD_HALF_LEN) {
                    // Garder au moins 5 voitures sur le haut
                    const topCount = _cars.filter(o => o.road === 0).length;
                    if (topCount <= 5) _switchRoad(c, 0); // reboucle sur la route du haut
                    else               _switchRoad(c, 1);
                } else if (c.road === 1 && c.x < -ROAD_HALF_LEN) {
                    _switchRoad(c, 0);
                }
            }
        }

        // ── Frottement sol ───────────────────────────────────────────────
        c.vx *= DRAG;
        c.vz *= DRAG;

        // ── Déplacement ──────────────────────────────────────────────────
        c.x += c.vx;
        c.z += c.vz;

        // ── Orientation (face la direction du mouvement, figée pendant parking) ──
        if (!pe) {
            const sp2 = Math.hypot(c.vx, c.vz);
            const lockAngle = c.parkState === 'reversing' || c.parkState === 'parked' || c.parkState === 'leaving';
            if (!lockAngle && sp2 > MIN_SPEED * 0.4) {
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

    // ── Mini-voitures manette (trottoir du bas) ───────────────────────────────
    for (const mc of _miniCars.values()) {
        if (mc.keys.left)  mc.angle += 0.07;
        if (mc.keys.right) mc.angle -= 0.07;
        if (mc.keys.up) {
            mc.vx += Math.cos(mc.angle) * MINI_THRUST;
            mc.vz -= Math.sin(mc.angle) * MINI_THRUST;
        }
        if (mc.keys.down) { mc.vx *= 0.80; mc.vz *= 0.80; }
        mc.vx *= MINI_DRAG;
        mc.vz *= MINI_DRAG;
        const sp = Math.hypot(mc.vx, mc.vz);
        if (sp > MINI_MAX_SPD) { mc.vx = mc.vx / sp * MINI_MAX_SPD; mc.vz = mc.vz / sp * MINI_MAX_SPD; }
        mc.x += mc.vx;
        mc.z += mc.vz;
        // Bornes perspective-correctes : frustum trapézoïdal (large en haut, étroit en bas)
        const _xLim = Math.max(2, (9.22 + 0.64 * (10 - mc.z)) * 0.82);
        if (mc.x >  _xLim) { mc.x =  _xLim; mc.vx *= -0.5; }
        if (mc.x < -_xLim) { mc.x = -_xLim; mc.vx *= -0.5; }
        if (mc.z >   6.5)  { mc.z =   6.5;  mc.vz *= -0.5; }
        if (mc.z < -16.0)  { mc.z = -16.0;  mc.vz *= -0.5; }

        mc.root.position.set(mc.x, 0, mc.z);
        mc.root.rotation.y = mc.angle;
        mc.sprite.position.set(mc.x, 1.6, mc.z);
    }

    // ── Collisions OBB + mini-voitures ───────────────────────────────────
    _resolveAll();
    _resolveMiniCollisions();
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

    // Nettoyer mini-voitures manette
    for (const mc of _miniCars.values()) {
        if (_scene) _scene.remove(mc.root);
        if (mc.sprite) {
            if (_scene) _scene.remove(mc.sprite);
            mc.sprite.material.map?.dispose();
            mc.sprite.material.dispose();
        }
    }
    _miniCars.clear();
    _fbxTemplate = null;
    Object.assign(_titleKbState, { left: false, right: false, up: false, down: false });

    // Déconnexion socket smartphone
    if (_titleSock) { _titleSock.disconnect(); _titleSock = null; }

    // Nettoyer QR code
    if (_qrMesh) {
        _scene?.remove(_qrMesh);
        _qrMesh.material?.map?.dispose();
        _qrMesh.material?.dispose();
        _qrMesh.geometry?.dispose();
        _qrMesh = null;
    }

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
    // Nettoyer fumée
    for (const c of _cars) { if (c.smoke) { c.smoke.dispose(); c.smoke = null; } }
    if (_smokeTex) { _smokeTex.dispose(); _smokeTex = null; }
    _cars  = [];
}
