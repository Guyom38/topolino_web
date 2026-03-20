import * as THREE from 'three';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 200, 500);

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lumière ambiante (ciel diffus) — faible pour que les ombres contrastent
scene.add(new THREE.AmbientLight(0xd0e8ff, 0.18));

// Soleil — angle bas pour des ombres longues et un relief marqué
export const sun = new THREE.DirectionalLight(0xfff5e0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.width  = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 1;
sun.shadow.camera.far  = 320;
sun.shadow.camera.left   = -65;
sun.shadow.camera.right  =  65;
sun.shadow.camera.top    =  65;
sun.shadow.camera.bottom = -65;
sun.shadow.bias = -0.001;
// Position initiale (sera mise à jour chaque frame depuis main.js)
sun.position.set(50, 80, 40);
sun.target.position.set(0, 0, 0);
scene.add(sun);
scene.add(sun.target);

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
