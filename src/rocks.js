import * as THREE from 'three';
import { scene } from './scene.js';
import { getHeightAt } from './terrain.js';

const rockGroup = new THREE.Group();
scene.add(rockGroup);

export const bushes = [];
export const collidables = [];

function createBush(x, z, scale = 1.0) {
    const detail = 1;
    const geometry = new THREE.DodecahedronGeometry(scale, detail);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, 
            pos.getX(i) + (Math.random()-0.5)*0.3, 
            pos.getY(i) + (Math.random()-0.5)*0.3, 
            pos.getZ(i) + (Math.random()-0.5)*0.3
        );
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x228B22, 
        roughness: 0.9, 
        transparent: true, 
        opacity: 0.85 
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, getHeightAt(x, z) - 0.1, z);
    mesh.rotation.set(0, Math.random() * Math.PI, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.radius = scale * 1.1; 
    bushes.push(mesh);
    rockGroup.add(mesh);
    return mesh;
}

/**
 * Crée un bloc de pierre (Cube)
 */
function createBlock(x, z, size = 1.0, height = 4.0) {
    const geometry = new THREE.BoxGeometry(size, height, size);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x333333, 
        roughness: 0.6,
        metalness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    
    // On enfonce le bloc de 2m pour être sûr qu'il n'y ait pas de jour
    mesh.position.set(x, getHeightAt(x, z) + height/2 - 2.0, z);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    mesh.userData.radius = size * 0.48; 
    collidables.push(mesh);
    rockGroup.add(mesh);
    return mesh;
}

export function initChaseRocks() {
    if (!rockGroup.parent) scene.add(rockGroup);
    bushes.length = 0;
    collidables.length = 0;
    while(rockGroup.children.length > 0) {
        const r = rockGroup.children[0];
        r.geometry.dispose();
        r.material.dispose();
        rockGroup.remove(r);
    }

    const LIMIT = 70; 
    const STEP  = 3.5; // Plus serrés
    
    // Muret périmètre : blocs plus hauts (6m) et bien enfoncés
    for (let i = -LIMIT; i <= LIMIT; i += STEP) {
        createBlock(i, -LIMIT, 4.5, 6.0); // Nord
        createBlock(i,  LIMIT, 4.5, 6.0); // Sud
        createBlock(-LIMIT, i, 4.5, 6.0); // Ouest
        createBlock( LIMIT, i, 4.5, 6.0); // Est
    }

    const SPAWN_ZONE = LIMIT - 10;
    for (let i = 0; i < 20; i++) {
        const rx = (Math.random() - 0.5) * SPAWN_ZONE * 2;
        const rz = (Math.random() - 0.5) * SPAWN_ZONE * 2;
        createBlock(rx, rz, 3.0 + Math.random() * 2.0, 4.0);
    }
    for (let i = 0; i < 25; i++) {
        const rx = (Math.random() - 0.5) * SPAWN_ZONE * 2;
        const rz = (Math.random() - 0.5) * SPAWN_ZONE * 2;
        createBush(rx, rz, 2.0 + Math.random() * 2.0);
    }
}
