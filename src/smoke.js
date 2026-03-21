import * as THREE from 'three';
import { scene } from './scene.js';

// ── Système de fumée capot — petits nuages qui montent et disparaissent ────────

const MAX_PARTICLES = 400;
const PARTICLE_LIFE = 2600;  // ms de vie d'une particule
const EMIT_DURATION = 4000;  // ms d'émission après déclenchement
const EMIT_RATE     = 80;    // une émission tous les N ms

const _particles = [];
const _emitters  = [];   // { player, untilMs, lastEmit }
let _geo = null, _mesh = null;
let _lastNow = 0;

// ── Texture nuage (dégradé radial doux) ─────────────────────────────────────
function _makeCloudTexture() {
    const S = 64, C = S / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const grd = ctx.createRadialGradient(C, C, 1, C, C, C);
    grd.addColorStop(0.00, 'rgba(230,230,230,1.0)');
    grd.addColorStop(0.25, 'rgba(210,210,210,0.85)');
    grd.addColorStop(0.55, 'rgba(180,180,180,0.45)');
    grd.addColorStop(0.80, 'rgba(150,150,150,0.15)');
    grd.addColorStop(1.00, 'rgba(120,120,120,0.0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(cv);
}

function _init() {
    if (_mesh) return;

    const ptPos  = new Float32Array(MAX_PARTICLES * 3);
    const ptAlpha = new Float32Array(MAX_PARTICLES);
    const ptSize = new Float32Array(MAX_PARTICLES);

    _geo = new THREE.BufferGeometry();
    _geo.setAttribute('position', new THREE.BufferAttribute(ptPos,   3));
    _geo.setAttribute('alpha',    new THREE.BufferAttribute(ptAlpha, 1));
    _geo.setAttribute('size',     new THREE.BufferAttribute(ptSize,  1));
    _geo.setDrawRange(0, 0);

    _mesh = new THREE.Points(_geo, new THREE.ShaderMaterial({
        uniforms: { map: { value: _makeCloudTexture() } },
        vertexShader: `
            precision highp float;
            attribute float size;
            attribute float alpha;
            varying float vAlpha;
            void main(){
                vAlpha = alpha;
                gl_PointSize = size;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            precision highp float;
            uniform sampler2D map;
            varying float vAlpha;
            void main(){
                vec4 t = texture2D(map, gl_PointCoord);
                if(t.a < 0.01) discard;
                gl_FragColor = vec4(0.88, 0.88, 0.88, t.a * vAlpha);
            }`,
        transparent: true,
        depthWrite:  false,
        blending:    THREE.NormalBlending,
    }));
    _mesh.frustumCulled = false;
    _mesh.renderOrder   = 14;
    scene.add(_mesh);
}

// ── Émet quelques particules depuis le capot de la voiture ────────────────────
function _emit(player, now) {
    if (!player.car) return;

    const COUNT = 3 + Math.floor(Math.random() * 3); // 3–5 nuages par salve
    const fwdX  = -Math.sin(player.carAngle);
    const fwdZ  = -Math.cos(player.carAngle);
    // Position capot = avant de la voiture, légèrement sur le dessus
    const hx = player.car.position.x + fwdX * 1.8;
    const hy = player.car.position.y + 0.55;
    const hz = player.car.position.z + fwdZ * 1.8;

    for (let i = 0; i < COUNT; i++) {
        if (_particles.length >= MAX_PARTICLES) break;
        _particles.push({
            x:  hx + (Math.random() - 0.5) * 0.6,
            y:  hy + Math.random() * 0.2,
            z:  hz + (Math.random() - 0.5) * 0.6,
            vx: (Math.random() - 0.5) * 0.022,
            vy: 0.025 + Math.random() * 0.030,  // montée lente
            vz: (Math.random() - 0.5) * 0.022,
            born: now,
            sizePx: 14 + Math.random() * 18,    // taille initiale
        });
    }
}

// ── Démarre l'émission de fumée depuis le capot d'un joueur ───────────────────
export function startHoodSmoke(player) {
    _init();
    const now = performance.now();
    // Éviter les doublons : supprimer un émetteur existant pour ce joueur
    const idx = _emitters.findIndex(e => e.player === player);
    if (idx !== -1) _emitters.splice(idx, 1);
    _emitters.push({ player, untilMs: now + EMIT_DURATION, lastEmit: 0 });
}

// ── Mise à jour chaque frame ──────────────────────────────────────────────────
export function updateSmoke(now) {
    if (!_geo) {
        if (_emitters.length === 0 && _particles.length === 0) return;
        _init();
    }

    const dt = Math.min((now - _lastNow) / 16.667, 3);
    _lastNow = now;

    // Émission continue depuis les émetteurs actifs
    for (let i = _emitters.length - 1; i >= 0; i--) {
        const em = _emitters[i];
        if (now > em.untilMs) { _emitters.splice(i, 1); continue; }
        if (now - em.lastEmit >= EMIT_RATE) {
            _emit(em.player, now);
            em.lastEmit = now;
        }
    }

    // Suppression des particules mortes
    for (let i = _particles.length - 1; i >= 0; i--) {
        if (now - _particles[i].born > PARTICLE_LIFE) _particles.splice(i, 1);
    }

    const ptPos   = _geo.attributes.position.array;
    const ptAlpha = _geo.attributes.alpha.array;
    const ptSize  = _geo.attributes.size.array;

    for (let i = 0; i < _particles.length; i++) {
        const p   = _particles[i];
        const age = (now - p.born) / PARTICLE_LIFE;  // 0 → 1

        // Physique : montée + léger ralentissement
        p.vy *= Math.pow(0.988, dt);
        p.vx *= Math.pow(0.975, dt);
        p.vz *= Math.pow(0.975, dt);
        p.x  += p.vx * dt;
        p.y  += p.vy * dt;
        p.z  += p.vz * dt;

        // Alpha : apparition rapide (0→0.2) opaque, puis fade out (0.2→1)
        const fade = age < 0.15
            ? age / 0.15
            : 1.0 - (age - 0.15) / 0.85;

        // Taille : grandit progressivement (nuage qui se dilate)
        const size = p.sizePx * (1.0 + age * 3.5);

        const b = i * 3;
        ptPos[b]     = p.x;
        ptPos[b + 1] = p.y;
        ptPos[b + 2] = p.z;

        ptAlpha[i] = Math.max(0, fade * 0.80);
        ptSize[i]  = size;
    }

    // Zéroiser les entrées inutilisées
    for (let i = _particles.length; i < MAX_PARTICLES; i++) {
        ptPos[i * 3] = ptPos[i * 3 + 1] = ptPos[i * 3 + 2] = 0;
        ptAlpha[i] = 0;
        ptSize[i]  = 0;
    }

    _geo.attributes.position.needsUpdate = true;
    _geo.attributes.alpha.needsUpdate    = true;
    _geo.attributes.size.needsUpdate     = true;
    _geo.setDrawRange(0, _particles.length);
}

export function disposeSmoke() {
    if (_mesh) {
        scene.remove(_mesh);
        _mesh.geometry.dispose();
        _mesh.material.dispose();
        _mesh = null;
    }
    _geo = null;
    _particles.length = 0;
    _emitters.length  = 0;
}
