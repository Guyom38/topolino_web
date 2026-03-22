// ── Mode Circuit — inspiré de Micro Machines V3 ───────────────────────────────
import * as THREE from 'three';
import { scene, camera } from '../scene.js';
import { startHoodSmoke } from '../smoke.js';
import { settings } from '../settings.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const ROAD_W         = 16;     // Largeur de route (unités monde)
const KERB_W         = 2.5;    // Largeur des bandes de kerb
const WIN_POINTS     = 5;      // Points pour gagner
const OFFSCREEN_MS   = 2000;   // ms hors-écran avant élimination (2s)
const FREEZE_MS      = 3200;   // durée du gel après élimination
const WORLD_HALF     = 145;    // demi-taille du terrain (±145 en X et Z)

// ── Physique des obstacles ────────────────────────────────────────────────────
const CAR_RADIUS = 1.8;        // rayon collision voiture (= COLLISION_RADIUS)
const CAR_MASS   = 5.0;
const OBS_PROPS  = {
    barrel:  { mass: 1.4,  radius: 0.90, friction: 0.86, restitution: 0.55, halfH: 0.80 },
    cone:    { mass: 0.28, radius: 0.60, friction: 0.78, restitution: 0.42, halfH: 0.70 },
    haybale: { mass: 4.5,  radius: 1.30, friction: 0.72, restitution: 0.28, halfH: 0.75 },
    wall:    { mass: 14.0, radius: 1.55, friction: 0.60, restitution: 0.12, halfH: 0.60 },
};

// ── Circuit (points de contrôle fermés) ──────────────────────────────────────
const CTRL_PTS = [
    new THREE.Vector3(  0, 0, -65),   // 0  Départ/Arrivée
    new THREE.Vector3( 38, 0, -58),   // 1
    new THREE.Vector3( 72, 0, -32),   // 2  Virage droit
    new THREE.Vector3( 85, 0,   0),   // 3  Apex droit
    new THREE.Vector3( 72, 0,  32),   // 4
    new THREE.Vector3( 38, 0,  52),   // 5
    new THREE.Vector3(  6, 0,  58),   // 6  Chicane haut-droite
    new THREE.Vector3( -6, 0,  46),   // 7  Chicane haut-gauche
    new THREE.Vector3(-40, 0,  52),   // 8
    new THREE.Vector3(-72, 0,  32),   // 9  Virage gauche
    new THREE.Vector3(-85, 0,   0),   // 10 Apex gauche
    new THREE.Vector3(-72, 0, -32),   // 11
    new THREE.Vector3(-38, 0, -58),   // 12
    new THREE.Vector3(-12, 0, -68),   // 13 Retour départ
];

const trackCurve = new THREE.CatmullRomCurve3(CTRL_PTS, true, 'catmullrom', 0.5);
const N_SAMPLES  = 400;
const trackPts   = trackCurve.getPoints(N_SAMPLES);

// ── État du mode ──────────────────────────────────────────────────────────────
let _phase        = 'idle';   // idle | lights | racing | freeze | finished
let _phaseT       = 0;
let _lightStep    = -1;        // -1=off  0..2=rouge  3=vert  4=éteint
let _scores       = new Map();
let _outMs        = new Map(); // playerId → ms hors-écran cumulés
let _leaderId     = null;
let _freezeLeader = null;      // leader capturé au moment du gel
let _winner       = null;

const BEEP_SRC = 'Asssets/musics/transcendedlifting-race-start-beeps-125125.mp3';
let _beepAudio = null;

let _floor         = null;
let _obstacles     = [];       // meshes seulement (pour dispose)
let _physObstacles = [];       // objets physiques complets
let _lightsEl      = null;
let _hudEl         = null;
let _goEl          = null;
let _arrowsEl           = null;     // conteneur des flèches hors-écran
let _arrows             = new Map(); // playerId → élément DOM flèche
let _initializedPlayers = new Set(); // IDs des joueurs déjà placés
let _winScreenEl        = null;     // splashscreen victoire Street Fighter

// ── Taches d'huile ────────────────────────────────────────────────────────────
const OIL_STEER_MS  = 500;          // blocage braquage (0.5s)
const OIL_TRACK_MS  = 1000;         // traces noires de pneus (1s)
const OFFROAD_MS    = 2000;         // ms hors-piste avant panne
const OFFROAD_DIST  = ROAD_W / 2 + KERB_W + 1.0;  // distance maxi avant sanction (11.5u)
let _oilSlicks      = [];           // { x, z, r, mesh }
let _oilSlickMat    = null;         // matériau partagé pour les flaques
let _offRoadMs      = new Map();    // playerId → ms hors-piste
let _offRoadEls     = new Map();    // playerId → DOM warning element
let _offRoadContainer = null;       // conteneur DOM des warnings hors-piste

// ── Projection sur la courbe ──────────────────────────────────────────────────
function _getTrackT(x, z) {
    let bestT = 0, bestD = Infinity;
    for (let i = 0; i <= N_SAMPLES; i++) {
        const p  = trackPts[i];
        const d  = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (d < bestD) { bestD = d; bestT = i / N_SAMPLES; }
    }
    return bestT;
}

// ── Distance monde → centre de la piste ──────────────────────────────────────
function _getDistFromTrack(x, z) {
    let bestD = Infinity;
    for (let i = 0; i <= N_SAMPLES; i++) {
        const p = trackPts[i];
        const d = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (d < bestD) bestD = d;
    }
    return Math.sqrt(bestD);
}

// ── Canvas texture du circuit ─────────────────────────────────────────────────
function _buildTexture() {
    const S   = 2048;
    const WLD = WORLD_HALF * 2;
    const sc  = S / WLD;

    const cv  = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');

    // ── Bruit déterministe (pas de Math.random → texture stable) ─────────────
    const _h = (ix, iy) => { const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453; return s - Math.floor(s); };
    const _n = (x, y)   => {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x-ix, fy = y-iy;
        const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
        return _h(ix,iy)+(_h(ix+1,iy)-_h(ix,iy))*ux+(_h(ix,iy+1)-_h(ix,iy))*uy+(_h(ix,iy)-_h(ix+1,iy)-_h(ix,iy+1)+_h(ix+1,iy+1))*ux*uy;
    };

    // ── 1. Herbe fBm — bruit multi-octave + stries de tonte ─────────────────
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const nx = x * 0.013, ny = y * 0.013;
            const v  =  _n(nx,      ny)      * 0.44
                      + _n(nx*2.5,  ny*2.5)  * 0.27
                      + _n(nx*6,    ny*6)    * 0.16
                      + _n(nx*14,   ny*14)   * 0.08
                      + _n(nx*35,   ny*35)   * 0.05;
            const mow = Math.sin((x * 0.9 + y * 0.35) * 0.22) * 0.055;
            const t   = Math.max(0, Math.min(1, 0.42 + v + mow));
            const i4  = (y * S + x) * 4;
            d[i4]   = (20 + t * 32)  | 0;
            d[i4+1] = (78 + t * 80)  | 0;
            d[i4+2] = (10 + t * 20)  | 0;
            d[i4+3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);

    const wx = x => (x + WORLD_HALF) * sc;
    const wz = z => (z + WORLD_HALF) * sc;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const dPts = trackCurve.getPoints(1000);
    const N    = dPts.length;

    // Chemin centré réutilisable
    const centerPath = () => {
        ctx.beginPath();
        dPts.forEach((p, i) => i === 0 ? ctx.moveTo(wx(p.x), wz(p.z)) : ctx.lineTo(wx(p.x), wz(p.z)));
        ctx.closePath();
    };

    // Normales au centre (pour les offsets)
    const normals = dPts.map((p, i) => {
        const prev = dPts[(i - 1 + N) % N], next = dPts[(i + 1) % N];
        const dx = next.x - prev.x, dz = next.z - prev.z;
        const len = Math.sqrt(dx*dx + dz*dz) || 0.001;
        return { nx: -dz / len, nz: dx / len };
    });

    // Chemin offset (±dist unités monde)
    const offsetPath = (dist) => {
        ctx.beginPath();
        dPts.forEach((p, i) => {
            const { nx, nz } = normals[i];
            const x = wx(p.x + nx * dist), z = wz(p.z + nz * dist);
            i === 0 ? ctx.moveTo(x, z) : ctx.lineTo(x, z);
        });
        ctx.closePath();
    };

    // ── 2. Zone run-off (herbe courte, vert légèrement différent) ────────────
    ctx.lineWidth   = (ROAD_W + KERB_W * 2 + 9) * sc;
    ctx.strokeStyle = '#3d7d38';
    centerPath(); ctx.stroke();

    // ── 3. Kerbs rouge/blanc (alternés toutes les 2 sections) ────────────────
    for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < N - 1; i++) {
            const p0 = dPts[i], p1 = dPts[i + 1];
            const dx = p1.x - p0.x, dz = p1.z - p0.z;
            const len = Math.sqrt(dx*dx + dz*dz) || 0.001;
            const nx = (-dz/len)*side, nz = (dx/len)*side;
            const ox = nx*(ROAD_W/2 + KERB_W/2), oz = nz*(ROAD_W/2 + KERB_W/2);
            ctx.beginPath();
            ctx.moveTo(wx(p0.x+ox), wz(p0.z+oz));
            ctx.lineTo(wx(p1.x+ox), wz(p1.z+oz));
            ctx.strokeStyle = Math.floor(i / 2) % 2 === 0 ? '#cc1111' : '#f0f0f0';
            ctx.lineWidth   = KERB_W * sc;
            ctx.stroke();
        }
    }

    // ── 4. Bordure blanche de route (crée les lignes de bord) ───────────────
    ctx.lineWidth   = (ROAD_W + 3.0) * sc;
    ctx.strokeStyle = '#dcdcdc';
    centerPath(); ctx.stroke();

    // ── 5. Asphalt sombre ────────────────────────────────────────────────────
    ctx.lineWidth   = ROAD_W * sc;
    ctx.strokeStyle = '#252528';
    centerPath(); ctx.stroke();

    // Grain asphalte (tirets aléatoires déterministes semi-transparents)
    ctx.globalAlpha = 0.055;
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth   = 1.2;
    for (let i = 0; i < N - 1; i += 2) {
        const p  = dPts[i];
        const { nx, nz } = normals[i];
        const perpX = nz, perpZ = -nx; // tangente
        const hR = ROAD_W / 2 * 0.82;
        const ox  = ((_h(i, 0) - 0.5) * 2) * hR;
        const oz  = ((_h(i, 1) - 0.5) * 2) * hR;
        const len2 = 1.5 + _h(i, 2) * 2.5;
        ctx.beginPath();
        ctx.moveTo(wx(p.x + nx*ox + perpX*0.2), wz(p.z + nz*ox + perpZ*0.2));
        ctx.lineTo(wx(p.x + nx*ox + perpX*(0.2+len2)), wz(p.z + nz*ox + perpZ*(0.2+len2)));
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // ── 6. Double ligne de bord blanche (à l'intérieur de la route) ──────────
    for (const side of [-1, 1]) {
        ctx.lineWidth   = 1.4 * sc;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.setLineDash([]);
        offsetPath(side * (ROAD_W / 2 - 2));
        ctx.stroke();
    }

    // ── 7. Ligne centrale jaune pointillée ───────────────────────────────────
    ctx.setLineDash([12 * sc, 10 * sc]);
    ctx.lineWidth   = 1.5 * sc;
    ctx.strokeStyle = '#f5c800';
    centerPath(); ctx.stroke();
    ctx.setLineDash([]);

    // ── 8. Ligne de départ — grand damier noir/blanc ──────────────────────────
    const sp  = trackCurve.getPoint(0);
    const st  = trackCurve.getTangent(0);
    const ang = Math.atan2(st.x, st.z);
    const hw  = (ROAD_W / 2) * sc;
    ctx.save();
    ctx.translate(wx(sp.x), wz(sp.z));
    ctx.rotate(ang);
    const cols = 8, rows = 3, sqW = hw * 2 / cols, sqH = 9;
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            ctx.fillStyle = (c + r) % 2 === 0 ? '#ffffff' : '#111111';
            ctx.fillRect(-hw + c * sqW, -sqH / 2 + r * (sqH / rows), sqW, sqH / rows);
        }
    }
    // Trait blanc fin avant la ligne
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(-hw, sqH / 2 + 3); ctx.lineTo(hw, sqH / 2 + 3); ctx.stroke();
    ctx.restore();

    // ── 9. Cases de grille de départ (rectangles blancs sur la route) ────────
    for (let i = 0; i < 8; i++) {
        const tOff = 0.014 + i * 0.022;
        const gp   = trackCurve.getPoint(tOff);
        const gt   = trackCurve.getTangent(tOff);
        const gAng = Math.atan2(gt.x, gt.z);
        const side = i % 2 === 0 ? 1 : -1;
        ctx.save();
        ctx.translate(wx(gp.x), wz(gp.z));
        ctx.rotate(gAng);
        const bw = (ROAD_W / 2 - 1.5) * sc, bh = 5 * sc;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 1;
        ctx.strokeRect(side > 0 ? 1 : -bw - 1, -bh / 2, bw, bh);
        ctx.restore();
    }

    return new THREE.CanvasTexture(cv);
}

function _createFloor() {
    const SIZE = WORLD_HALF * 2;
    const tex  = _buildTexture();
    const mat  = new THREE.MeshLambertMaterial({ map: tex });
    _floor     = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
    _floor.rotation.x    = -Math.PI / 2;
    _floor.position.y    = -0.01;
    _floor.receiveShadow = true;
    scene.add(_floor);
}

function _createObstacles() {
    _physObstacles = [];

    const mats = {
        barrel:  new THREE.MeshLambertMaterial({ color: 0xff7700 }),
        cone:    new THREE.MeshLambertMaterial({ color: 0xff2200 }),
        haybale: new THREE.MeshLambertMaterial({ color: 0xc8960a }),
        wall:    new THREE.MeshLambertMaterial({ color: 0x888888 }),
    };

    const configs = [
        // Chicane (sur la route)
        { x:  0,  z:  52, type: 'barrel' },
        { x:  7,  z:  49, type: 'cone'   },
        { x: -7,  z:  49, type: 'cone'   },
        { x: 55,  z:  10, type: 'barrel' },
        { x: -55, z:  10, type: 'barrel' },
        { x: 30,  z: -50, type: 'cone'   },
        { x: -30, z: -50, type: 'cone'   },
        // Obstacles extérieurs
        ...Array.from({ length: 20 }, (_, i) => {
            const a = (i / 20) * Math.PI * 2;
            const r = 98 + Math.sin(i * 1.7) * 6;
            return { x: Math.cos(a) * r, z: Math.sin(a) * r,
                     type: ['barrel', 'haybale', 'barrel', 'cone'][i % 4] };
        }),
        // Bacs en béton
        { x:  92, z:  0,  type: 'wall' }, { x: -92, z:  0,  type: 'wall' },
        { x:   0, z: 70,  type: 'wall' }, { x:   0, z: -72, type: 'wall' },
    ];

    configs.forEach(o => {
        const t = OBS_PROPS[o.type] || OBS_PROPS.barrel;

        let geo;
        if      (o.type === 'barrel')  geo = new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10);
        else if (o.type === 'cone')    geo = new THREE.ConeGeometry(0.65, 1.4, 8);
        else if (o.type === 'haybale') geo = new THREE.BoxGeometry(2.2, 1.5, 2.2);
        else                           geo = new THREE.BoxGeometry(3.2, 1.2, 1.2);

        const mesh = new THREE.Mesh(geo, mats[o.type]);
        mesh.position.set(o.x, t.halfH, o.z);
        mesh.castShadow = true;
        scene.add(mesh);
        _obstacles.push(mesh);

        _physObstacles.push({
            mesh,
            x: o.x,  z: o.z,      // position monde
            vx: 0,   vz: 0,        // vélocité horizontale
            y: t.halfH, vy: 0,     // position / vélocité verticale
            spinY: 0, angVelY: 0,  // rotation Y
            roll: 0,               // angle de roulement (cylindres/cônes)
            mass: t.mass,
            radius: t.radius,
            friction: t.friction,
            restitution: t.restitution,
            halfH: t.halfH,
            type: o.type,
        });
    });
}

// ── Mise à jour physique des obstacles ────────────────────────────────────────
function _updatePhysObstacles(players, dt) {
    const dtF = dt / 16.667; // facteur normalisé à 60fps

    // 1. Intégration par obstacle ──────────────────────────────────────────────
    for (const o of _physObstacles) {
        const spd = Math.sqrt(o.vx * o.vx + o.vz * o.vz);
        const active = spd > 0.003 || Math.abs(o.vy) > 0.003 || Math.abs(o.angVelY) > 0.003;
        if (!active) continue;

        // Friction
        const fr = Math.pow(o.friction, dtF);
        o.vx    *= fr;
        o.vz    *= fr;
        o.angVelY *= Math.pow(0.91, dtF);

        // Gravité
        o.vy -= 0.016 * dtF;
        o.y  += o.vy  * dtF;

        // Rebond au sol
        if (o.y <= o.halfH) {
            o.y = o.halfH;
            if (o.vy < -0.08) {
                o.vy *= -0.28;
            } else {
                o.vy = 0;
            }
        }

        // Déplacement
        o.x += o.vx * dtF;
        o.z += o.vz * dtF;

        // Rotation Y
        o.spinY += o.angVelY * dtF;

        // Roulement visuel
        o.roll += spd * 0.20 * dtF;

        // Mise à jour mesh
        o.mesh.position.set(o.x, o.y, o.z);

        if (o.type === 'barrel') {
            // Le tonneau roule dans la direction de son mouvement
            const moveAng = Math.atan2(o.vx, o.vz);
            o.mesh.rotation.set(
                 o.roll * Math.cos(moveAng),
                 o.spinY,
                -o.roll * Math.sin(moveAng)
            );
        } else if (o.type === 'cone') {
            // Le cône se couche et tourne
            o.mesh.rotation.y = o.spinY;
            o.mesh.rotation.x = Math.sin(o.roll * 0.6) * Math.min(0.8, spd * 0.8);
        } else {
            o.mesh.rotation.y = o.spinY;
        }
    }

    // 2. Voiture → obstacle ────────────────────────────────────────────────────
    for (const p of players.values()) {
        if (!p.car) continue;
        const cx = p.car.position.x, cz = p.car.position.z;

        for (const o of _physObstacles) {
            const dx = o.x - cx, dz = o.z - cz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const minD = o.radius + CAR_RADIUS;
            if (dist >= minD || dist < 0.01) continue;

            const nx = dx / dist, nz = dz / dist;
            const overlap = minD - dist;
            const total = CAR_MASS + o.mass;

            // Dépénétration proportionnelle aux masses
            p.car.position.x -= nx * overlap * (o.mass   / total);
            p.car.position.z -= nz * overlap * (o.mass   / total);
            o.x              += nx * overlap * (CAR_MASS / total);
            o.z              += nz * overlap * (CAR_MASS / total);

            // Vitesse relative sur la normale de collision
            const relVn = (p.velocity.x - o.vx) * nx + (p.velocity.z - o.vz) * nz;
            if (relVn <= 0) continue;

            // Impulsion physique
            const imp = relVn * (1 + o.restitution) / (1 / CAR_MASS + 1 / o.mass);

            o.vx += (imp / o.mass) * nx;
            o.vz += (imp / o.mass) * nz;
            p.velocity.x -= (imp / CAR_MASS) * nx;
            p.velocity.z -= (imp / CAR_MASS) * nz;

            // Spin angulaire selon l'impact latéral
            const latImpact = Math.abs((-nz) * p.velocity.x + nx * p.velocity.z);
            o.angVelY += (Math.random() - 0.5) * latImpact * 2.2 / o.mass;

            // Les objets légers s'envolent
            if      (o.mass < 0.5)  o.vy += relVn * 0.28;
            else if (o.mass < 2.0)  o.vy += relVn * 0.12;
            else if (o.mass < 5.0)  o.vy += relVn * 0.03;

            // Légère secousse verticale à la voiture
            p.verticalVelocity += relVn * 0.025 * (o.mass / total);

            // Resync carSpeed
            const fwdX = -Math.sin(p.carAngle), fwdZ = -Math.cos(p.carAngle);
            p.carSpeed = p.velocity.x * fwdX + p.velocity.z * fwdZ;
            p.onHit?.();
        }
    }

    // 3. Obstacle en mouvement → voiture (réaction en chaîne !) ───────────────
    for (const o of _physObstacles) {
        const obsSpd = Math.sqrt(o.vx * o.vx + o.vz * o.vz);
        if (obsSpd < 0.25) continue;

        for (const p of players.values()) {
            if (!p.car) continue;
            const cx = p.car.position.x, cz = p.car.position.z;
            const dx = cx - o.x, dz = cz - o.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const minD = o.radius + CAR_RADIUS;
            if (dist >= minD || dist < 0.01) continue;

            const nx = dx / dist, nz = dz / dist;
            const relVn = (o.vx - p.velocity.x) * nx + (o.vz - p.velocity.z) * nz;
            if (relVn <= 0) continue;

            const imp = relVn * (1 + o.restitution * 0.5) / (1 / o.mass + 1 / CAR_MASS);

            p.velocity.x += (imp / CAR_MASS) * nx;
            p.velocity.z += (imp / CAR_MASS) * nz;
            o.vx         -= (imp / o.mass)   * nx;
            o.vz         -= (imp / o.mass)   * nz;

            p.verticalVelocity += relVn * 0.04;
            const fwdX = -Math.sin(p.carAngle), fwdZ = -Math.cos(p.carAngle);
            p.carSpeed = p.velocity.x * fwdX + p.velocity.z * fwdZ;
            p.onHit?.();
        }
    }

    // 4. Obstacle → obstacle (cascades !) ─────────────────────────────────────
    for (let i = 0; i < _physObstacles.length; i++) {
        const a = _physObstacles[i];
        if (Math.sqrt(a.vx * a.vx + a.vz * a.vz) < 0.1) continue;

        for (let j = i + 1; j < _physObstacles.length; j++) {
            const b  = _physObstacles[j];
            const dx = b.x - a.x, dz = b.z - a.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const minD = a.radius + b.radius;
            if (dist >= minD || dist < 0.01) continue;

            const nx = dx / dist, nz = dz / dist;
            const overlap = (minD - dist) * 0.5;
            const total   = a.mass + b.mass;

            a.x -= nx * overlap * (b.mass / total);
            a.z -= nz * overlap * (b.mass / total);
            b.x += nx * overlap * (a.mass / total);
            b.z += nz * overlap * (a.mass / total);

            const relVn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
            if (relVn <= 0) continue;

            const rest = (a.restitution + b.restitution) * 0.5;
            const imp  = relVn * (1 + rest) / (1 / a.mass + 1 / b.mass);

            a.vx -= (imp / a.mass) * nx;  a.vz -= (imp / a.mass) * nz;
            b.vx += (imp / b.mass) * nx;  b.vz += (imp / b.mass) * nz;

            a.angVelY += (Math.random() - 0.5) * relVn * 0.6 / a.mass;
            b.angVelY += (Math.random() - 0.5) * relVn * 0.6 / b.mass;
            if (b.mass < 2.0) b.vy += relVn * 0.10;
            if (a.mass < 2.0) a.vy += relVn * 0.10;
        }
    }
}

// ── Taches d'huile ────────────────────────────────────────────────────────────
function _createOilSlicks() {
    _oilSlicks = [];

    _oilSlickMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv;
            void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; varying vec2 vUv;
            void main(){
                vec2 uv = vUv - 0.5;
                float d = length(uv);
                float edge = smoothstep(0.50, 0.28, d);
                if(edge < 0.01) discard;
                float angle = atan(uv.y, uv.x);
                float wave = sin(angle * 5.0 + uTime * 1.8 + d * 22.0);
                float wave2 = sin(angle * 3.0 - uTime * 1.2 + d * 14.0);
                vec3 c1 = vec3(0.75, 0.12, 0.95); // violet
                vec3 c2 = vec3(0.05, 0.75, 1.00); // cyan
                vec3 c3 = vec3(1.00, 0.55, 0.05); // orange
                vec3 c4 = vec3(0.10, 0.90, 0.40); // vert
                vec3 irid = mix(c1, c2, clamp(wave * 0.5 + 0.5, 0.0, 1.0));
                irid = mix(irid, c3, clamp(wave2 * 0.5 + 0.5, 0.0, 1.0) * 0.5);
                irid = mix(irid, c4, clamp(sin(d * 18.0 - uTime) * 0.5 + 0.5, 0.0, 1.0) * 0.3);
                // Assombrissement au centre (flaque d'huile sombre avec reflets)
                float dark = mix(0.22, 0.75, pow(d * 2.0, 0.6));
                gl_FragColor = vec4(irid * dark, edge * 0.85);
            }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    _oilSlickMat.renderOrder = 1;

    // Placer les flaques sur la route à des fractions du circuit
    const POSITIONS = [0.08, 0.18, 0.32, 0.47, 0.61, 0.75, 0.90];
    POSITIONS.forEach(t => {
        const pt  = trackCurve.getPoint(t);
        const tan = trackCurve.getTangent(t);
        const nor = new THREE.Vector3(-tan.z, 0, tan.x);

        // Décalage aléatoire dans la largeur de la route
        const side   = (Math.random() - 0.5) * (ROAD_W * 0.55);
        const x      = pt.x + nor.x * side;
        const z      = pt.z + nor.z * side;
        const r      = 2.2 + Math.random() * 1.4;

        // Ellipse irrégulière (ScaledCircle via scale)
        const geo  = new THREE.CircleGeometry(r, 14);
        const mesh = new THREE.Mesh(geo, _oilSlickMat);
        mesh.rotation.x    = -Math.PI / 2;
        mesh.position.set(x, 0.018, z);
        mesh.scale.set(1, 1, 0.55 + Math.random() * 0.5); // étirer en ellipse
        scene.add(mesh);

        _oilSlicks.push({ x, z, r, mesh });
    });
}

// ── HUD DOM ───────────────────────────────────────────────────────────────────
function _buildHUD() {
    // Feux de départ
    // ── Panneau de feux Mario Kart ─────────────────────────────────────────────
    _lightsEl = document.createElement('div');
    Object.assign(_lightsEl.style, {
        position: 'absolute', top: '18px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '10px', alignItems: 'center',
        zIndex: '200', pointerEvents: 'none',
        background: 'linear-gradient(180deg,#2a2a2a 0%,#111 100%)',
        padding: '14px 24px', borderRadius: '12px',
        border: '3px solid #555',
        boxShadow: '0 6px 30px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.08)',
    });
    for (let i = 0; i < 5; i++) {
        const housing = document.createElement('div');
        Object.assign(housing.style, {
            width: '52px', height: '52px', borderRadius: '50%',
            background: '#1a1a1a',
            border: '4px solid #333',
            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
        });
        const bulb = document.createElement('div');
        Object.assign(bulb.style, {
            width: '36px', height: '36px', borderRadius: '50%',
            background: '#0d0d0d',
            transition: 'background 0.08s, box-shadow 0.08s',
        });
        housing.appendChild(bulb);
        _lightsEl.appendChild(housing);
    }
    document.body.appendChild(_lightsEl);

    // ── GO ! ──────────────────────────────────────────────────────────────────
    _goEl = document.createElement('div');
    Object.assign(_goEl.style, {
        position: 'fixed', inset: '0',
        display: 'none', alignItems: 'center', justifyContent: 'center',
        zIndex: '300', pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, rgba(0,255,80,0.18) 0%, transparent 70%)',
    });
    const goText = document.createElement('div');
    Object.assign(goText.style, {
        fontSize: 'clamp(72px, 16vw, 160px)', fontWeight: '900',
        fontFamily: '"Arial Black", "Impact", sans-serif',
        color: '#ffdd00',
        textShadow: '0 0 40px #ff8800, 0 0 80px #ff4400, 4px 4px 0 #8b3a00',
        letterSpacing: '0.1em',
        animation: 'mkGoAnim 0.55s ease-out forwards',
    });
    goText.textContent = 'GO!';
    if (!document.getElementById('_mkGoStyle')) {
        const s = document.createElement('style');
        s.id = '_mkGoStyle';
        s.textContent = `@keyframes mkGoAnim{0%{transform:scale(2.2);opacity:0}40%{transform:scale(0.92);opacity:1}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}`;
        document.head.appendChild(s);
    }
    _goEl.appendChild(goText);
    document.body.appendChild(_goEl);

    // Classement
    _hudEl = document.createElement('div');
    _hudEl.id = 'circuit-hud';
    Object.assign(_hudEl.style, {
        position: 'absolute', top: '10px', left: '10px',
        background: 'rgba(0,0,0,0.72)', borderRadius: '14px',
        padding: '12px 18px', color: '#fff', fontFamily: "'Segoe UI', monospace",
        fontSize: '13px', fontWeight: 'bold', zIndex: '100',
        pointerEvents: 'none', lineHeight: '2', minWidth: '200px',
        border: '1px solid rgba(255,255,255,0.1)',
    });
    document.body.appendChild(_hudEl);

    // Conteneur des flèches hors-écran
    _arrowsEl = document.createElement('div');
    Object.assign(_arrowsEl.style, {
        position: 'fixed', inset: '0',
        pointerEvents: 'none', zIndex: '150', overflow: 'hidden',
    });
    document.body.appendChild(_arrowsEl);

    // Conteneur des warnings hors-piste
    _offRoadContainer = document.createElement('div');
    Object.assign(_offRoadContainer.style, {
        position: 'fixed', bottom: '80px', left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        pointerEvents: 'none', zIndex: '160',
    });
    document.body.appendChild(_offRoadContainer);
}

// ── Warnings hors-piste ───────────────────────────────────────────────────────
function _showOffRoadWarning(id, player, secsLeft) {
    if (!_offRoadContainer) return;
    let el = _offRoadEls.get(id);
    if (!el) {
        el = document.createElement('div');
        Object.assign(el.style, {
            background: 'rgba(0,0,0,0.78)',
            border: `2px solid ${player.colorHex}`,
            borderRadius: '8px',
            padding: '7px 18px',
            fontFamily: '"Arial Black", Impact, sans-serif',
            fontWeight: '900',
            fontSize: 'clamp(13px, 2.5vw, 20px)',
            color: player.colorHex,
            textShadow: `0 0 12px ${player.colorHex}`,
            whiteSpace: 'nowrap',
            boxShadow: `0 0 16px ${player.colorHex}66`,
        });
        _offRoadContainer.appendChild(el);
        _offRoadEls.set(id, el);
    }
    el.style.display = 'block';
    el.textContent   = `⚠ ${player.name} HORS-PISTE ! ${secsLeft}s`;
}

function _hideOffRoadWarning(id) {
    const el = _offRoadEls.get(id);
    if (el) el.style.display = 'none';
}

function _hideAllOffRoadWarnings() {
    for (const el of _offRoadEls.values()) el.style.display = 'none';
}

function _setLights(state) {
    if (!_lightsEl) return;
    _lightStep = state;

    if (state === 7) {
        // Masquer le panneau
        _lightsEl.style.opacity = '0';
        return;
    }
    _lightsEl.style.opacity = '1';

    const RED_BG   = '#cc0000';
    const RED_SHD  = '0 0 22px #ff2200, 0 0 8px #ff6600, inset 0 0 12px rgba(255,60,0,0.35)';
    const GRN_BG   = '#00cc44';
    const GRN_SHD  = '0 0 28px #00ff55, 0 0 10px #44ff88, inset 0 0 14px rgba(0,255,80,0.40)';
    const OFF_BG   = '#0d0d0d';
    const OFF_SHD  = 'none';

    const isGreen = state === 6;

    for (let i = 0; i < 5; i++) {
        const bulb = _lightsEl.children[i]?.children[0];
        if (!bulb) continue;
        if (isGreen) {
            bulb.style.background = GRN_BG;
            bulb.style.boxShadow  = GRN_SHD;
        } else {
            // state = nombre de feux rouges allumés (0=aucun … 5=tous)
            const on = i < state;
            bulb.style.background = on ? RED_BG : OFF_BG;
            bulb.style.boxShadow  = on ? RED_SHD : OFF_SHD;
        }
    }
}

function _updateHUD(players) {
    if (!_hudEl) return;
    const alive  = Array.from(players.values()).filter(p => p.car);
    const sorted = [...alive].sort((a, b) => (_scores.get(b.id) || 0) - (_scores.get(a.id) || 0));

    let html = `<div style="font-size:10px;opacity:0.55;letter-spacing:0.15em;margin-bottom:2px">CLASSEMENT</div>`;
    sorted.forEach((p, i) => {
        const sc    = _scores.get(p.id) || 0;
        const stars = '★'.repeat(sc) + '☆'.repeat(Math.max(0, WIN_POINTS - sc));
        const crown = p.id === _leaderId ? ' 👑' : '';
        html += `<div style="color:${p.colorHex};white-space:nowrap">
            <span style="opacity:0.5">${i + 1}.</span> ${p.name}${crown} <span style="font-size:11px">${stars}</span>
        </div>`;
    });

    if (_winner) {
        html += `<div style="margin-top:8px;font-size:18px;color:#ffd700;text-align:center">
            🏆 ${_winner.name}<br><span style="font-size:12px;opacity:0.7">VICTOIRE !</span>
        </div>`;
    }
    _hudEl.innerHTML = html;
}

// ── Utilitaire : place un joueur à un slot F1 par rapport à un point de ref ───
function _placeAtSlot(p, refT, slot, lap = 0) {
    const sp  = trackCurve.getPoint(refT);
    const tan = trackCurve.getTangent(refT);
    const nor = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const ang = Math.atan2(-tan.x, -tan.z);

    // F1 authentique : une voiture par rangée, alternance D/G, 8 unités entre rangées
    // slot 0 = pole (droite), slot 1 = P2 (gauche), slot 2 = P3 (droite)...
    const side = slot % 2 === 0 ? 1 : -1;
    const row  = slot; // une rangée par position (pas deux par rangée)

    p.car.position.set(
        sp.x + nor.x * side * 3.2 - tan.x * row * 8.0,
        0.1,
        sp.z + nor.z * side * 3.2 - tan.z * row * 8.0
    );
    p.carAngle         = ang;
    p.car.rotation.y   = ang;
    p.carSpeed         = 0;
    p.velocity.set(0, 0, 0);
    p.verticalVelocity = 0;
    p.onGround         = true;
    p._circuitT        = refT;
    p._circuitLap      = lap;
    p._circuitDist     = lap + refT;
    if (p.carVisual) { p.carVisual.rotation.set(0, 0, 0); p.carVisual.position.y = 0; }
}

// ── Placement initial sur la grille de départ ─────────────────────────────────
function _placeOnGrid(players) {
    let slot = 0;
    for (const [, p] of players) {
        if (!p.car) continue;
        _placeAtSlot(p, 0, slot, 0);
        slot++;
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initCircuitMode(players) {
    scene.background = new THREE.Color(0x70bde0);
    scene.fog        = new THREE.FogExp2(0x70bde0, 0.0025);

    _phase        = 'idle';
    _phaseT       = performance.now();
    _scores.clear(); _outMs.clear();
    _initializedPlayers.clear();
    _leaderId = null; _freezeLeader = null; _winner = null;
    _obstacles.length = 0;

    for (const [id, p] of players) {
        _scores.set(id, 0); _initializedPlayers.add(id);
        p._getTrackY = () => 0; // sol plat du circuit
    }

    _createFloor();
    _createObstacles();
    _createOilSlicks();
    _placeOnGrid(players);
    _buildHUD();
    _setLights(7); // masquer le panneau au départ
}

// ── Frustum pour détection hors-écran ─────────────────────────────────────────
const _frustum  = new THREE.Frustum();
const _projMat  = new THREE.Matrix4();
const _testPt   = new THREE.Vector3();

export function updateCircuitMode(players, now, deltaMs) {
    const dt = Math.min(deltaMs, 50); // cap à 50ms

    // ── Détection nouveaux joueurs arrivés en cours de partie ─────────────────
    for (const [id, p] of players) {
        if (!p.car || _initializedPlayers.has(id)) continue;
        _initializedPlayers.add(id);
        _scores.set(id, 0);
        _outMs.set(id, 0);
        p._getTrackY = () => 0;
        // Place le nouveau à la fin, derrière tous les autres
        const lastSlot = _initializedPlayers.size - 1;
        const refT = _leaderId && players.get(_leaderId)?.car
            ? ((players.get(_leaderId)._circuitT || 0) - 0.08 + 1) % 1
            : 0;
        const lap = _leaderId && players.get(_leaderId)?.car
            ? (players.get(_leaderId)._circuitLap || 0)
            : 0;
        _placeAtSlot(p, refT, lastSlot, lap);
    }

    // ── PHASE : idle (courte pause avant les feux) ───────────────────────────
    if (_phase === 'idle') {
        if (now - _phaseT > 800) {
            _phase = 'lights'; _phaseT = now; _lightStep = -1; _setLights(0);
            // Jouer le son de départ synchronisé avec les feux
            if (_beepAudio) { _beepAudio.pause(); _beepAudio.currentTime = 0; }
            _beepAudio = new Audio(BEEP_SRC);
            _beepAudio.volume = settings.sfxVolume;
            _beepAudio.play().catch(() => {});
        }
        for (const p of players.values()) { if (p.car) { p.carSpeed = 0; p.velocity.set(0,0,0); } }
        _updateHUD(players);
        return;
    }

    // ── PHASE : feux Mario Kart (5 rouges × 600ms → vert → GO) ─────────────────
    if (_phase === 'lights') {
        const e = now - _phaseT;
        // 1 rouge toutes les 600ms, puis vert à 3000ms, puis GO à 3400ms
        const newStep = e < 600  ? 1
                      : e < 1200 ? 2
                      : e < 1800 ? 3
                      : e < 2400 ? 4
                      : e < 3000 ? 5   // tous rouges
                      : e < 3400 ? 6   // tous verts (flash)
                      : 8;             // GO (sentinel)

        if (newStep !== _lightStep && newStep <= 6) _setLights(newStep);

        if (newStep < 6) {
            // Bloquer les voitures (anti-faux-départ)
            for (const p of players.values()) { if (p.car) { p.carSpeed = 0; p.velocity.set(0,0,0); } }
        } else if (newStep === 8 && _lightStep !== 8) {
            // GO ! — masquer le panneau + flash GO
            _setLights(7);
            if (_goEl) { _goEl.style.display = 'flex'; setTimeout(() => { if (_goEl) _goEl.style.display = 'none'; }, 1200); }
            _lightStep = 8;
        }

        if (e > 4200) { _phase = 'racing'; }
        _updateHUD(players);
        return;
    }

    // ── PHASE : freeze (gel après élimination) ───────────────────────────────
    if (_phase === 'freeze') {
        // Tout le monde immobile
        for (const p of players.values()) {
            if (p.car) { p.carSpeed = 0; p.velocity.set(0, 0, 0); }
        }
        _hideAllArrows();
        _hideAllOffRoadWarnings();
        _updateHUD(players);

        if (now - _phaseT >= FREEZE_MS) {
            // Respawn grille derrière le leader capturé
            _respawnGrid(players, _freezeLeader);
            _outMs.clear();
            _offRoadMs.clear();
            _hideAllOffRoadWarnings();
            // Retour via idle pour afficher le VS screen
            _phase = 'idle'; _phaseT = now;
        }
        return;
    }

    // ── PHASE : finished — animation victoire Micro Machines ─────────────────
    if (_phase === 'finished') {
        _hideAllArrows();
        _hideAllOffRoadWarnings();
        if (_winner?.car && _winner.carVisual) {
            const t = now * 0.001;
            // Rebond vertical : parabole rapide (comme MM V3)
            const bounce = Math.abs(Math.sin(t * Math.PI * 2.4)) * 1.6;
            const sway   = Math.sin(t * Math.PI * 1.6) * 0.30;
            const pitch  = Math.cos(t * Math.PI * 4.8) * 0.08;
            // Inclinaison fixe de ~35° pour voir le flanc de la voiture + légère oscillation
            const yaw    = _winner.carAngle + 0.62 + Math.sin(t * Math.PI * 0.8) * 0.12;

            _winner.carVisual.position.y = bounce;
            _winner.carVisual.rotation.z = sway;
            _winner.carVisual.rotation.x = pitch;
            _winner.car.rotation.y       = yaw;
        }
        _updateHUD(players);
        return;
    }

    // ── PHASE : racing ────────────────────────────────────────────────────────

    // 1. Progression sur le circuit + déterminer le leader
    let leaderDist = -1;
    let leader     = null;

    for (const [, p] of players) {
        if (!p.car) continue;
        const t = _getTrackT(p.car.position.x, p.car.position.z);
        if (p._circuitT !== undefined && p._circuitT > 0.85 && t < 0.15) p._circuitLap = (p._circuitLap || 0) + 1;
        p._circuitT = t;
        const dist = (p._circuitLap || 0) + t;
        p._circuitDist = dist;
        if (dist > leaderDist) { leaderDist = dist; leader = p; }
    }
    if (leader) _leaderId = leader.id;

    // 2. Détection hors-écran (frustum) + flèches + compte à rebours
    _projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projMat);

    for (const [id, p] of players) {
        if (!p.car) continue;
        if (id === _leaderId) { _outMs.set(id, 0); _hideArrow(id); continue; }

        _testPt.set(p.car.position.x, p.car.position.y + 1, p.car.position.z);
        if (!_frustum.containsPoint(_testPt)) {
            const elapsed = (_outMs.get(id) || 0) + dt;
            _outMs.set(id, elapsed);
            const secsLeft = Math.ceil((OFFSCREEN_MS - elapsed) / 1000);
            _showArrow(id, p, secsLeft);
            if (elapsed >= OFFSCREEN_MS) {
                _startFreeze(leader, players);
                break; // traiter un seul à la fois
            }
        } else {
            _outMs.set(id, Math.max(0, (_outMs.get(id) || 0) - dt * 2));
            _hideArrow(id);
        }
    }

    // 3. Taches d'huile : reflets irisés + collision + blocage braquage
    if (_oilSlickMat?.uniforms) _oilSlickMat.uniforms.uTime.value = now * 0.001;

    for (const [, p] of players) {
        if (!p.car) continue;
        const cx = p.car.position.x, cz = p.car.position.z;

        // Détecter entrée dans une flaque
        if (now >= (p._oilTrackUntil || 0)) {
            for (const oil of _oilSlicks) {
                const dx = cx - oil.x, dz = cz - oil.z;
                if (dx * dx + dz * dz < oil.r * oil.r) {
                    p._oilSteerUntil = now + OIL_STEER_MS; // 0.5s : braquage bloqué
                    p._oilTrackUntil = now + OIL_TRACK_MS; // 2s : traces noires
                    break;
                }
            }
        }

        // Braquage bloqué pendant 0.5s
        if (now < (p._oilSteerUntil || 0)) {
            p.steeringAngle *= 0.04;
        }

        // Flag pour tracks.js : traces noires pendant 2s
        p._onOil = now < (p._oilTrackUntil || 0);
    }

    // 4. Détection hors-piste : 2s pour revenir, sinon panne = perd la manche
    for (const [id, p] of players) {
        if (!p.car) continue;
        const trackDist = _getDistFromTrack(p.car.position.x, p.car.position.z);

        if (trackDist > OFFROAD_DIST) {
            const elapsed = (_offRoadMs.get(id) || 0) + dt;
            _offRoadMs.set(id, elapsed);
            const secsLeft = Math.ceil((OFFROAD_MS - elapsed) / 1000);
            _showOffRoadWarning(id, p, secsLeft);
            if (elapsed >= OFFROAD_MS) {
                _offRoadMs.set(id, 0);
                _hideOffRoadWarning(id);
                // Fumée du capot : la voiture tombe en panne
                startHoodSmoke(p);
                // Trouver le meilleur autre joueur → il marque le point
                let winner = null, bestDist = -1;
                for (const [oid, op] of players) {
                    if (!op.car || oid === id) continue;
                    const d = op._circuitDist || 0;
                    if (d > bestDist) { bestDist = d; winner = op; }
                }
                _startFreeze(winner || leader, players);
                break;
            }
        } else {
            _offRoadMs.set(id, Math.max(0, (_offRoadMs.get(id) || 0) - dt * 2));
            _hideOffRoadWarning(id);
        }
    }

    // 5. Physique des obstacles
    _updatePhysObstacles(players, dt);

    _updateHUD(players);
}

// ── Bandeau "Bravo [Nom] !" centré — victoire de manche ──────────────────────
let _roundScreenEl = null;

function _showRoundBanner(winner) {
    if (_roundScreenEl) { _roundScreenEl.remove(); _roundScreenEl = null; }

    if (!document.getElementById('_bannerStyle')) {
        const s = document.createElement('style');
        s.id = '_bannerStyle';
        s.textContent = [
            `@keyframes bannerIn{from{opacity:0;transform:translate(-50%,-50%) scale(0.7)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`,
            `@keyframes bannerOut{from{opacity:1}to{opacity:0;transform:translate(-50%,-50%) translateY(-30px)}}`,
        ].join('');
        document.head.appendChild(s);
    }

    const col = winner.colorHex || '#ffffff';
    const pts = _scores.get(winner.id) || 0;

    _roundScreenEl = document.createElement('div');
    Object.assign(_roundScreenEl.style, {
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        zIndex: '800', pointerEvents: 'none',
        textAlign: 'center',
        animation: 'bannerIn 0.3s cubic-bezier(0.22,1,0.36,1) forwards',
    });

    const bravoEl = document.createElement('div');
    Object.assign(bravoEl.style, {
        fontSize: 'clamp(28px, 5.5vw, 72px)',
        fontFamily: '"Arial Black", Impact, sans-serif',
        fontWeight: '900',
        color: col,
        textTransform: 'uppercase',
        lineHeight: '1',
        textShadow: `0 0 50px ${col}, 4px 4px 0 #000, -2px -2px 0 #000`,
        whiteSpace: 'nowrap',
    });
    bravoEl.textContent = `BRAVO ${winner.name} !`;

    const starsEl = document.createElement('div');
    Object.assign(starsEl.style, {
        fontSize: 'clamp(24px, 5vw, 60px)',
        marginTop: '8px',
        color: '#ffd700',
        textShadow: '0 0 15px #ff8800',
        letterSpacing: '0.08em',
    });
    starsEl.textContent = '★'.repeat(pts) + '☆'.repeat(Math.max(0, WIN_POINTS - pts));

    _roundScreenEl.appendChild(bravoEl);
    _roundScreenEl.appendChild(starsEl);
    document.body.appendChild(_roundScreenEl);

    // Disparaît avant la fin du freeze
    setTimeout(() => {
        if (_roundScreenEl) {
            _roundScreenEl.style.animation = 'bannerOut 0.4s ease-in forwards';
            setTimeout(() => { if (_roundScreenEl) { _roundScreenEl.remove(); _roundScreenEl = null; } }, 420);
        }
    }, FREEZE_MS - 700);
}

// ── Trophée champion final ────────────────────────────────────────────────────
function _showTrophyScreen(winner) {
    if (_winScreenEl) _winScreenEl.remove();

    if (!document.getElementById('_trophyStyle')) {
        const s = document.createElement('style');
        s.id = '_trophyStyle';
        s.textContent = [
            `@keyframes trophyIn{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}`,
            `@keyframes trophyFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-18px)}}`,
            `@keyframes trophyGlow{0%,100%{text-shadow:0 0 40px #ffd700}50%{text-shadow:0 0 80px #ffaa00, 0 0 120px #ff8800}}`,
        ].join('');
        document.head.appendChild(s);
    }

    const col = winner.colorHex || '#ffd700';

    _winScreenEl = document.createElement('div');
    Object.assign(_winScreenEl.style, {
        position: 'fixed', inset: '0', zIndex: '900',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 40%, #1a1200 0%, #000 100%)',
        animation: 'trophyIn 0.5s ease-out',
        pointerEvents: 'none',
    });

    // Trophée en gros emoji
    const cupEl = document.createElement('div');
    Object.assign(cupEl.style, {
        fontSize: 'clamp(80px, 18vw, 220px)',
        lineHeight: '1',
        animation: 'trophyFloat 2s ease-in-out infinite, trophyGlow 2s ease-in-out infinite',
        filter: 'drop-shadow(0 0 30px #ffd700)',
    });
    cupEl.textContent = '🏆';

    // Nom du champion
    const nameEl = document.createElement('div');
    Object.assign(nameEl.style, {
        fontSize: 'clamp(36px, 8vw, 100px)',
        fontFamily: '"Arial Black", Impact, sans-serif',
        fontWeight: '900',
        color: col,
        textTransform: 'uppercase',
        textShadow: `0 0 40px ${col}, 3px 3px 0 #000`,
        marginTop: '12px',
        lineHeight: '1',
    });
    nameEl.textContent = winner.name;

    // "CHAMPION !"
    const champEl = document.createElement('div');
    Object.assign(champEl.style, {
        fontSize: 'clamp(20px, 4vw, 52px)',
        fontFamily: '"Arial Black", Impact, sans-serif',
        color: '#ffd700',
        textTransform: 'uppercase',
        letterSpacing: '0.2em',
        textShadow: '0 0 20px #ff8800',
        marginTop: '8px',
    });
    champEl.textContent = 'CHAMPION !';

    // Invite rejouer (apparaît après 3s)
    const replayEl = document.createElement('div');
    Object.assign(replayEl.style, {
        fontSize: 'clamp(11px, 2vw, 20px)',
        fontFamily: 'Arial, sans-serif',
        color: 'rgba(255,255,255,0.45)',
        letterSpacing: '0.2em',
        marginTop: '36px',
        opacity: '0',
        transition: 'opacity 1s',
    });
    replayEl.textContent = 'APPUYER POUR REJOUER';
    setTimeout(() => { if (replayEl.parentNode) replayEl.style.opacity = '1'; }, 3000);

    _winScreenEl.appendChild(cupEl);
    _winScreenEl.appendChild(nameEl);
    _winScreenEl.appendChild(champEl);
    _winScreenEl.appendChild(replayEl);
    document.body.appendChild(_winScreenEl);

    const goMenu = () => { window.location.href = window.location.pathname; };
    setTimeout(() => {
        document.addEventListener('keydown',     goMenu, { once: true });
        document.addEventListener('pointerdown', goMenu, { once: true });
    }, 3000);
    setTimeout(goMenu, 9000);
}

// ── Flash rouge d'élimination ─────────────────────────────────────────────────
function _showEliminationFlash() {
    if (!document.getElementById('_elimStyle')) {
        const s = document.createElement('style');
        s.id = '_elimStyle';
        s.textContent = `@keyframes elimFlash{0%{opacity:1}100%{opacity:0}}`;
        document.head.appendChild(s);
    }
    const el = document.createElement('div');
    Object.assign(el.style, {
        position: 'fixed', inset: '0', zIndex: '750',
        background: 'rgba(200,0,0,0.5)',
        pointerEvents: 'none',
        animation: 'elimFlash 0.7s ease-out forwards',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 750);
}

// ── Gel du jeu après élimination ──────────────────────────────────────────────
function _startFreeze(leader, players) {
    if (_phase === 'freeze') return; // déjà en freeze

    // Flash rouge immédiat
    _showEliminationFlash();

    // Le leader marque un point
    if (leader) {
        const pts = (_scores.get(leader.id) || 0) + 1;
        _scores.set(leader.id, pts);
        if (pts >= WIN_POINTS) {
            _phase  = 'finished';
            _winner = leader;
            _hideAllArrows();
            _showTrophyScreen(leader);
            return;
        }
        // Bandeau centré "Bravo [Nom] !"
        setTimeout(() => _showRoundBanner(leader), 300);
    }

    // Capturer le leader actuel pour le respawn
    _freezeLeader = leader;

    // Geler tout le monde
    for (const p of players.values()) {
        if (p.car) { p.carSpeed = 0; p.velocity.set(0, 0, 0); p.verticalVelocity = 0; }
    }

    _phase  = 'freeze';
    _phaseT = performance.now();
}

// ── Respawn en grille F1 derrière le leader ───────────────────────────────────
function _respawnGrid(players, leader) {
    // Référence : position du leader sur le circuit
    const refT = leader ? (leader._circuitT || 0) : 0;
    const lap  = leader ? (leader._circuitLap || 0) : 0;

    // Le leader reste sur place, figé
    if (leader?.car) {
        leader.carSpeed = 0; leader.velocity.set(0, 0, 0);
        leader.verticalVelocity = 0; leader.onGround = true;
    }

    // Les autres se placent juste derrière en grille F1
    // slot 0 = directement derrière le leader
    let slot = 0;
    for (const [, p] of players) {
        if (!p.car || (leader && p.id === leader.id)) continue;
        // +1 slot décalé pour laisser de l'espace devant le leader
        _placeAtSlot(p, refT, slot + 1, lap);
        slot++;
    }
}

// ── Flèches hors-écran ────────────────────────────────────────────────────────
function _worldToScreen(worldPos) {
    const v = worldPos.clone().project(camera);
    return {
        x:      (v.x  + 1) / 2 * window.innerWidth,
        y:      (-v.y + 1) / 2 * window.innerHeight,
        behind: v.z >= 1,
    };
}

function _arrowEdgePos(sx, sy, behind) {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    let dx = sx - cx, dy = sy - cy;
    if (behind) { dx = -dx; dy = -dy; }
    const margin = 58;
    const maxX   = cx - margin, maxY = cy - margin;
    const scale  = Math.min(Math.abs(maxX / (dx || 0.001)), Math.abs(maxY / (dy || 0.001)));
    return {
        x:     cx + dx * scale,
        y:     cy + dy * scale,
        angle: Math.atan2(dy, dx) * 180 / Math.PI + 90,
    };
}

function _showArrow(id, player, secsLeft) {
    if (!_arrowsEl || !player.car) return;

    let el = _arrows.get(id);
    if (!el) {
        el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute', pointerEvents: 'none',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
        });
        // Triangle
        const tri = document.createElement('div');
        tri.className = 'circuit-arrow-tri';
        Object.assign(tri.style, {
            width: '0', height: '0',
            borderLeft:  '11px solid transparent',
            borderRight: '11px solid transparent',
            borderBottom: `22px solid ${player.colorHex}`,
            filter: 'drop-shadow(0 0 5px rgba(0,0,0,0.9))',
        });
        // Compteur
        const lbl = document.createElement('div');
        lbl.className = 'circuit-arrow-lbl';
        Object.assign(lbl.style, {
            color: player.colorHex,
            fontSize: '15px', fontWeight: '900', fontFamily: 'Arial Black, sans-serif',
            textShadow: '1px 1px 4px black, -1px -1px 4px black',
            lineHeight: '1',
        });
        el.appendChild(tri);
        el.appendChild(lbl);
        _arrowsEl.appendChild(el);
        _arrows.set(id, el);
    }

    // Mise à jour position et compteur
    const sp   = _worldToScreen(player.car.position.clone().add(new THREE.Vector3(0, 1, 0)));
    const edge = _arrowEdgePos(sp.x, sp.y, sp.behind);

    el.style.left      = `${edge.x}px`;
    el.style.top       = `${edge.y}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${edge.angle}deg)`;
    el.style.display   = 'flex';

    const lbl = el.querySelector('.circuit-arrow-lbl');
    if (lbl) lbl.textContent = secsLeft + 's';
}

function _hideArrow(id) {
    const el = _arrows.get(id);
    if (el) el.style.display = 'none';
}

function _hideAllArrows() {
    for (const el of _arrows.values()) el.style.display = 'none';
}

// ── Camera circuit : légèrement inclinée, centrée sur le leader ───────────────
export function updateCircuitCamera(players) {
    const now    = performance.now();
    const leader = _leaderId ? players.get(_leaderId) : null;

    // ── Caméra intro (idle + lights) : vue 3D orbitante sur la grille ─────────
    if (_phase === 'idle' || _phase === 'lights') {
        // Centroïde de tous les joueurs sur la grille
        let cx = 0, cz = 0, cnt = 0;
        for (const p of players.values()) {
            if (!p.car) continue;
            cx += p.car.position.x; cz += p.car.position.z; cnt++;
        }
        if (cnt > 0) { cx /= cnt; cz /= cnt; }

        // Orbite lente pour effet dramatique
        const orbitAng = now * 0.00035;
        const PHI      = 0.55;          // 3D — ni top-down ni rasant
        const radius   = Math.max(30, cnt * 7 + 18); // proche, s'adapte au nb de joueurs

        if (!_camTarget) _camTarget = new THREE.Vector3(cx, 0, cz);
        _camTarget.lerp(new THREE.Vector3(cx, 0, cz), 0.04);
        if (!_camRadius) _camRadius = radius;
        _camRadius += (radius - _camRadius) * 0.03;

        camera.position.set(
            _camTarget.x + _camRadius * Math.sin(PHI) * Math.sin(orbitAng),
            _camRadius * Math.cos(PHI),
            _camTarget.z + _camRadius * Math.sin(PHI) * Math.cos(orbitAng)
        );
        camera.lookAt(_camTarget);
        camera.updateProjectionMatrix();
        return;
    }

    // ── Caméra victoire : orbite proche autour du gagnant ─────────────────────
    if (_phase === 'finished' && _winner?.car) {
        const wx  = _winner.car.position.x;
        const wz  = _winner.car.position.z;
        const t   = now * 0.00045;
        const PHI = 0.42;    // angle demi-haut pour voir le rebond
        const R   = 16;

        if (!_camTarget) _camTarget = new THREE.Vector3(wx, 0, wz);
        _camTarget.lerp(new THREE.Vector3(wx, 0.8, wz), 0.05);

        camera.position.set(
            _camTarget.x + R * Math.sin(PHI) * Math.sin(t),
            _camTarget.y + R * Math.cos(PHI),
            _camTarget.z + R * Math.sin(PHI) * Math.cos(t)
        );
        camera.lookAt(new THREE.Vector3(wx, 1.2, wz));
        camera.updateProjectionMatrix();
        return;
    }

    if (!leader || !leader.car) return;

    const lx = leader.car.position.x;
    const lz = leader.car.position.z;

    // Caméra centrée uniquement sur le leader, rayon fixe
    const TARGET_RADIUS = 35;
    const leaderAng = leader.carAngle || 0;
    const PHI   = 0.30;  // angle vertical
    const THETA = leaderAng;

    if (!_camTarget) _camTarget = new THREE.Vector3(lx, 0, lz);
    if (!_camRadius) _camRadius = TARGET_RADIUS;
    _camTarget.lerp(new THREE.Vector3(lx, 0, lz), 0.07);
    _camRadius += (TARGET_RADIUS - _camRadius) * 0.04;

    camera.position.set(
        _camTarget.x + _camRadius * Math.sin(PHI) * Math.sin(THETA),
        _camTarget.y + _camRadius * Math.cos(PHI),
        _camTarget.z + _camRadius * Math.sin(PHI) * Math.cos(THETA)
    );
    camera.lookAt(_camTarget);
    camera.updateProjectionMatrix();
}

let _camTarget = null;
let _camRadius = null;

// ── Dispose ───────────────────────────────────────────────────────────────────
export function disposeCircuitMode() {
    if (_floor) { scene.remove(_floor); _floor.geometry.dispose(); _floor.material.map?.dispose(); _floor.material.dispose(); _floor = null; }
    _obstacles.forEach(m => { scene.remove(m); m.geometry.dispose(); m.material?.dispose(); });
    _obstacles.length     = 0;
    _physObstacles.length = 0;
    _oilSlicks.forEach(o => { scene.remove(o.mesh); o.mesh.geometry.dispose(); });
    _oilSlicks.length = 0;
    _oilSlickMat?.dispose(); _oilSlickMat = null;
    if (_lightsEl)    { _lightsEl.remove();    _lightsEl    = null; }
    if (_goEl)        { _goEl.remove();        _goEl        = null; }
    if (_hudEl)       { _hudEl.remove();       _hudEl       = null; }
    if (_beepAudio) { _beepAudio.pause(); _beepAudio = null; }
    if (_arrowsEl)         { _arrowsEl.remove();         _arrowsEl         = null; }
    if (_offRoadContainer) { _offRoadContainer.remove(); _offRoadContainer  = null; }
    if (_winScreenEl)      { _winScreenEl.remove();      _winScreenEl       = null; }
    if (_roundScreenEl)    { _roundScreenEl.remove();    _roundScreenEl     = null; }
    _arrows.clear(); _outMs.clear(); _offRoadMs.clear(); _offRoadEls.clear();
    _scores.clear(); _initializedPlayers.clear();
    _camTarget = null; _camRadius = null;
}

export function isCircuitActive()  { return _phase === 'racing'; }
export function getCircuitWinner() { return _winner; }
