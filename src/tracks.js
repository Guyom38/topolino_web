import * as THREE from 'three';
import { config } from './config.js';
import { scene } from './scene.js';
import { isOnDirt, getHeightAt, getNormalAt } from './terrain.js';
import { settings } from './settings.js';

const VERT = `varying vec2 vUv;
    void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const FRAG = `precision mediump float;
    uniform float uOpacity;uniform float uSeed;varying vec2 vUv;
    float rand(vec2 p){return fract(sin(dot(p+uSeed,vec2(127.1,311.7)))*43758.5453);}
    void main(){
        float edge=smoothstep(0.0,0.18,vUv.x)*smoothstep(1.0,0.82,vUv.x);
        float noise=rand(vUv*65.0)*0.50+rand(vUv*23.0)*0.33+0.17;
        gl_FragColor=vec4(0.04,0.04,0.04,edge*noise*uOpacity);
    }`;

const LIFE_MS   = 10000;
const EMIT_EVERY = 4;

export function createTrackSystem() {
    const trackGroup = new THREE.Group();
    scene.add(trackGroup);

    const stamps = [];
    let frame = 0;

    function emit(p) {
        if (!settings.particles) return;
        const { car, carSpeed, carAngle } = p;
        if (!car || Math.abs(carSpeed) < 0.03) return;
        if (!p.onGround) return;
        // Émettre si : huile | mode terrain (herbe ou terre) | pente marron
        // p._getTrackY est défini dans les modes plats (circuit/parking) → pas de traces
        const onTerrain = !p._getTrackY;
        if (!p._onOil && !onTerrain && !isOnDirt(car.position.x, car.position.z)) return;

        const sa = Math.sin(carAngle), ca = Math.cos(carAngle);
        const HWB = config.wheelBase / 2;
        const HTW = 1.05;
        const segLen = Math.max(Math.abs(carSpeed) * EMIT_EVERY * 1.15, 0.22);
        const bx = sa * segLen * 0.5;
        const bz = ca * segLen * 0.5;

        const offsets = [
            { x: -sa * HWB - ca * HTW + bx, z: -ca * HWB + sa * HTW + bz },
            { x: -sa * HWB + ca * HTW + bx, z: -ca * HWB - sa * HTW + bz },
            { x:  sa * HWB - ca * HTW + bx, z:  ca * HWB + sa * HTW + bz },
            { x:  sa * HWB + ca * HTW + bx, z:  ca * HWB - sa * HTW + bz },
        ];

        const mat = new THREE.ShaderMaterial({
            uniforms: { uOpacity: { value: p._onOil ? 1.0 : isOnDirt(car.position.x, car.position.z) ? 0.85 : 0.55 }, uSeed: { value: Math.random() * 100 } },
            vertexShader: VERT, fragmentShader: FRAG,
            transparent: true, depthWrite: false,
        });

        const fwdV = new THREE.Vector3(-Math.sin(carAngle), 0, -Math.cos(carAngle));
        const meshes = offsets.map(o => {
            const wx = car.position.x + o.x;
            const wz = car.position.z + o.z;

            // Quaternion aligné sur la normale du terrain à cet endroit précis
            // PlaneGeometry est dans le plan XY (normale = +Z) ; on veut :
            //   X = droite de la voiture dans le plan terrain
            //   Y = avant de la voiture dans le plan terrain
            //   Z (normale du stamp) = normale du terrain
            const N     = getNormalAt(wx, wz);
            const right = new THREE.Vector3().crossVectors(fwdV, N).normalize();
            const fwdT  = new THREE.Vector3().crossVectors(N, right).normalize();
            const m4    = new THREE.Matrix4().makeBasis(right, fwdT, N);

            const m = new THREE.Mesh(new THREE.PlaneGeometry(config.trackWidth, segLen), mat);
            m.quaternion.setFromRotationMatrix(m4);
            const groundY = p._getTrackY ? p._getTrackY(wx, wz) : getHeightAt(wx, wz);
            m.position.set(wx, groundY + 0.04, wz);
            trackGroup.add(m);
            return m;
        });

        stamps.push({ mat, meshes, createdAt: performance.now(), stampZ: car.position.z });
    }

    return {
        update(p) {
            if (!p.car) return;
            if (++frame % EMIT_EVERY === 0) emit(p);

            const now = performance.now();
            for (let i = stamps.length - 1; i >= 0; i--) {
                const s = stamps[i];
                const age    = now - s.createdAt;
                const behind = s.stampZ - p.car.position.z;

                if (age > LIFE_MS || behind > 220) {
                    s.meshes.forEach(m => { trackGroup.remove(m); m.geometry.dispose(); });
                    s.mat.dispose();
                    stamps.splice(i, 1);
                } else {
                    const t     = age / LIFE_MS;
                    const tFade = t < 0.6 ? 1.0 : 1.0 - (t - 0.6) / 0.4;
                    const dFade = Math.max(0, 1 - behind / 220);
                    s.mat.uniforms.uOpacity.value = 0.85 * Math.min(tFade, dFade);
                }
            }
        },

        dispose() {
            stamps.forEach(s => {
                s.meshes.forEach(m => { trackGroup.remove(m); m.geometry.dispose(); });
                s.mat.dispose();
            });
            stamps.length = 0;
            scene.remove(trackGroup);
        },
    };
}
