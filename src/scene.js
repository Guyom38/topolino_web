import * as THREE from 'three';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 200, 500);

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

export const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Canvas toujours présent dans le DOM, caché au menu puis visible en jeu
Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '1', display: 'none' });
document.body.appendChild(renderer.domElement);

// Lumière ambiante
scene.add(new THREE.AmbientLight(0xd0e8ff, 0.18));

// Soleil
export const sun = new THREE.DirectionalLight(0xfff5e0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.width  = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 1;
sun.shadow.camera.far  = 1000;
sun.shadow.camera.left   = -250;
sun.shadow.camera.right  =  250;
sun.shadow.camera.top    =  250;
sun.shadow.camera.bottom = -250;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.05; 
sun.position.set(150, 200, 100);
sun.target.position.set(0, 0, 0);
scene.add(sun);
scene.add(sun.target);

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
