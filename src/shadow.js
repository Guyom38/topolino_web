import * as THREE from 'three';
import { scene } from './scene.js';

const VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

const FRAG = `
    uniform vec3  uColor;
    uniform float uOpacity;
    varying vec2  vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
        float d    = distance(vUv, vec2(0.5));
        float mask = smoothstep(0.5, 0.1, d);
        float grain = rnd(vUv * 150.0) * 0.15;
        gl_FragColor = vec4(uColor, (mask * uOpacity) - grain);
    }`;

export function createShadow() {
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor:   { value: new THREE.Color(0x000000) },
            uOpacity: { value: 0.6 },
        },
        vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 5), mat);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);

    return {
        update(carPos, carAngle, terrainY) {
            mesh.position.x       = carPos.x;
            mesh.position.y       = terrainY + 0.01;
            mesh.position.z       = carPos.z;
            mesh.rotation.z       = -carAngle;
        },
        dispose() {
            scene.remove(mesh);
            mesh.geometry.dispose();
            mat.dispose();
        },
    };
}
