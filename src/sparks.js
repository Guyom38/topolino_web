import * as THREE from 'three';
import { scene } from './scene.js';

// ── Système d'étincelles — grosses étoiles jaunes avec traîne de vitesse ──────
// Couche 1 : Points (sprites étoile, grand, billboard)
// Couche 2 : LineSegments (traîne proportionnelle à la vitesse)

const MAX    = 350;
const LIFE   = 480;    // ms — court : densité max près de l'impact
const GRAV   = 0.003;  // gravité très faible — étincelles restent au sol
const TRAIL  = 2.8;    // traîne longue — trainée visible en frottement

const _sparks = [];
let _ptGeo = null, _ptMesh  = null;   // couche Points
let _lnGeo = null, _lnMesh  = null;   // couche LineSegments
let _lastNow = 0;

// ── Texture étoile glow (canvas 64×64) ────────────────────────────────────────
function _makeStarTexture() {
    const S  = 64, C = S / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');

    // Halo radial (glow)
    const grd = ctx.createRadialGradient(C, C, 1, C, C, C);
    grd.addColorStop(0.00, 'rgba(255,255,200,1.0)');
    grd.addColorStop(0.18, 'rgba(255,220, 50,0.95)');
    grd.addColorStop(0.45, 'rgba(255,140,  0,0.55)');
    grd.addColorStop(1.00, 'rgba(255, 80,  0,0.0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, S, S);

    // Rayons de l'étoile (4 branches)
    ctx.save();
    ctx.translate(C, C);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 4);
        const rg = ctx.createLinearGradient(0, -C, 0, C);
        rg.addColorStop(0,   'rgba(255,255,255,0)');
        rg.addColorStop(0.5, 'rgba(255,255,220,0.9)');
        rg.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(-2, -C, 4, S);
    }
    ctx.restore();

    return new THREE.CanvasTexture(cv);
}

function _init() {
    if (_ptMesh) return;

    const tex = _makeStarTexture();

    // ── Points (têtes) ───────────────────────────────────────────────────────
    const ptPos  = new Float32Array(MAX * 3);
    const ptCol  = new Float32Array(MAX * 3);  // non utilisé en rendu mais requis par geometry
    const ptSize = new Float32Array(MAX);

    _ptGeo = new THREE.BufferGeometry();
    _ptGeo.setAttribute('position',  new THREE.BufferAttribute(ptPos,  3));
    _ptGeo.setAttribute('color',     new THREE.BufferAttribute(ptCol,  3));
    _ptGeo.setAttribute('size',      new THREE.BufferAttribute(ptSize, 1));
    _ptGeo.setDrawRange(0, 0);

    // ShaderMaterial pour pouvoir faire varier la taille par vertex
    _ptMesh = new THREE.Points(_ptGeo, new THREE.ShaderMaterial({
        uniforms:       { map: { value: tex } },
        vertexShader:   `precision highp float;
                         attribute float size; attribute vec3 color; varying vec3 vCol; varying float vSize;
                         void main(){ vCol=color; vSize=size;
                           gl_PointSize=size;
                           gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `precision highp float;
                         uniform sampler2D map; varying vec3 vCol; varying float vSize;
                         void main(){
                           vec4 t=texture2D(map,gl_PointCoord);
                           if(t.a<0.01) discard;
                           gl_FragColor=vec4(vCol*t.rgb, t.a); }`,
        transparent:  true,
        depthWrite:   false,
        blending:     THREE.AdditiveBlending,
        vertexColors: true,
    }));
    _ptMesh.frustumCulled = false;
    _ptMesh.renderOrder   = 11;
    scene.add(_ptMesh);

    // ── LineSegments (traînes) ───────────────────────────────────────────────
    const lnPos = new Float32Array(MAX * 6);
    const lnCol = new Float32Array(MAX * 6);
    const idx   = [];
    for (let i = 0; i < MAX; i++) idx.push(i * 2, i * 2 + 1);

    _lnGeo = new THREE.BufferGeometry();
    _lnGeo.setAttribute('position', new THREE.BufferAttribute(lnPos, 3));
    _lnGeo.setAttribute('color',    new THREE.BufferAttribute(lnCol, 3));
    _lnGeo.setIndex(idx);
    _lnGeo.setDrawRange(0, 0);

    _lnMesh = new THREE.LineSegments(_lnGeo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent:  true,
        depthWrite:   false,
        blending:     THREE.AdditiveBlending,
    }));
    _lnMesh.frustumCulled = false;
    _lnMesh.renderOrder   = 10;
    scene.add(_lnMesh);
}

// ── Émet des étincelles ───────────────────────────────────────────────────────
export function spawnSparks(cx, cy, cz, nx, nz, relV, count = 10) {
    _init();
    if (relV < 0.05) return;

    for (let i = 0; i < count; i++) {
        if (_sparks.length >= MAX) break;
        // Cône étroit autour de la normale de collision → traîne directionnelle
        const spread = (Math.random() - 0.5) * Math.PI * 0.55;
        const cos = Math.cos(spread), sin = Math.sin(spread);
        const s   = relV * 1.1 * (0.5 + Math.random() * 0.6);
        _sparks.push({
            x:  cx + (Math.random() - 0.5) * 0.3,
            y:  cy + 0.04 + Math.random() * 0.07,   // au ras du sol
            z:  cz + (Math.random() - 0.5) * 0.3,
            vx: (nx * cos - nz * sin) * s,
            vy: 0.003 + Math.random() * 0.007,       // quasi horizontal
            vz: (nx * sin + nz * cos) * s,
            born: performance.now(),
        });
    }
}

// ── Mise à jour chaque frame ──────────────────────────────────────────────────
export function updateSparks(now) {
    _init();
    const dt = Math.min((now - _lastNow) / 16.667, 3);
    _lastNow = now;

    for (let i = _sparks.length - 1; i >= 0; i--) {
        if (now - _sparks[i].born > LIFE) _sparks.splice(i, 1);
    }

    const ptPos  = _ptGeo.attributes.position.array;
    const ptCol  = _ptGeo.attributes.color.array;
    const ptSize = _ptGeo.attributes.size.array;
    const lnPos  = _lnGeo.attributes.position.array;
    const lnCol  = _lnGeo.attributes.color.array;

    for (let i = 0; i < _sparks.length; i++) {
        const s   = _sparks[i];
        const age = (now - s.born) / LIFE;   // 0 → 1
        const fade = Math.pow(1.0 - age, 1.2);

        // Physique
        s.vy -= GRAV * dt;
        s.vx *= Math.pow(0.90, dt);
        s.vz *= Math.pow(0.90, dt);
        s.x  += s.vx * dt;
        s.y  += s.vy * dt;
        s.z  += s.vz * dt;
        if (s.y < 0.04) { s.y = 0.04; s.vy = 0; }  // colle au sol

        // ── Points ──────────────────────────────────────────────────────────
        const pb = i * 3;
        ptPos[pb]     = s.x;
        ptPos[pb + 1] = s.y;
        ptPos[pb + 2] = s.z;

        // Couleur jaune → orange avec fade
        ptCol[pb]     = fade;
        ptCol[pb + 1] = fade * Math.max(0, 0.92 - age * 0.8);
        ptCol[pb + 2] = fade * Math.max(0, 0.3  - age * 1.5);

        // ~30% de la taille du véhicule à l'écran (~80px au pic)
        ptSize[i] = Math.max(3, 80 * fade);

        // ── LineSegments (traîne) ────────────────────────────────────────────
        const spd = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
        const tf  = TRAIL * (1.0 + spd * 2.0);   // plus rapide = traîne plus longue
        const lb  = i * 6;

        // Queue (extrémité sombre)
        lnPos[lb]     = s.x - s.vx * tf;
        lnPos[lb + 1] = s.y - s.vy * tf;
        lnPos[lb + 2] = s.z - s.vz * tf;
        // Tête (point vif)
        lnPos[lb + 3] = s.x;
        lnPos[lb + 4] = s.y;
        lnPos[lb + 5] = s.z;

        // Queue : rouge-orange soutenu — Tête : blanc-jaune éclatant
        lnCol[lb]     = fade * 0.8;  lnCol[lb + 1] = fade * 0.25; lnCol[lb + 2] = 0;
        lnCol[lb + 3] = fade;        lnCol[lb + 4] = fade * 0.95; lnCol[lb + 5] = fade * 0.4;
    }

    // Zéroiser les entrées inutilisées
    for (let i = _sparks.length; i < MAX; i++) {
        ptPos[i * 3] = ptPos[i * 3 + 1] = ptPos[i * 3 + 2] = 0;
        ptSize[i] = 0;
        const lb = i * 6;
        for (let k = 0; k < 6; k++) lnPos[lb + k] = 0;
    }

    _ptGeo.attributes.position.needsUpdate = true;
    _ptGeo.attributes.color.needsUpdate    = true;
    _ptGeo.attributes.size.needsUpdate     = true;
    _ptGeo.setDrawRange(0, _sparks.length);

    _lnGeo.attributes.position.needsUpdate = true;
    _lnGeo.attributes.color.needsUpdate    = true;
    _lnGeo.setDrawRange(0, _sparks.length * 2);
}

export function disposeSparks() {
    [_ptMesh, _lnMesh].forEach(m => {
        if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    });
    _ptMesh = null; _ptGeo = null;
    _lnMesh = null; _lnGeo = null;
    _sparks.length = 0;
}
