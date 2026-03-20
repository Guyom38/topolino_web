import * as THREE from 'three';
import { scene } from './scene.js';

const roadGroup = new THREE.Group();
scene.add(roadGroup);

const roadMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

function createSegment(z) {
    const segment = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 100), roadMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    segment.add(ground);
    for (let i = 0; i < 5; i++) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6), stripeMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(0, 0.03, (i * 20) - 40);
        segment.add(stripe);
    }
    segment.position.z = z;
    roadGroup.add(segment);
    return segment;
}

const segments = [createSegment(0), createSegment(-100), createSegment(-200)];

export function updateRoad(carZ) {
    segments.forEach(s => {
        if (s.position.z > carZ + 100) s.position.z -= 300;
        if (s.position.z < carZ - 200) s.position.z += 300;
    });
}
