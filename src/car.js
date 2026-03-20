import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { config } from './config.js';
import { scene } from './scene.js';
import { getMaterialForMesh } from './materials.js';

// Cache : FBX chargé une seule fois, puis cloné pour chaque joueur
let fbxPromise = null;

function loadFBX() {
    if (!fbxPromise) {
        fbxPromise = new Promise(resolve => {
            new FBXLoader().load('Asssets/topolino_low49k.fbx', resolve);
        });
    }
    return fbxPromise;
}

// Index de spawn pour espacer les voitures
let spawnIndex = 0;
const SPAWN_COLS = 4;

export async function loadCarForPlayer(player) {
    const fbx   = await loadFBX();
    const clone = fbx.clone(true);

    clone.rotation.y = Math.PI * 1.5;
    clone.scale.set(0.015, 0.015, 0.015);

    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    clone.position.x = -center.x;
    clone.position.z = -center.z;
    clone.position.y = -box.min.y;

    player.luggageMeshes = [];

    clone.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;

        const n = child.name.toLowerCase();

        // Stocker les pièces de bagage pour pouvoir les cacher/afficher
        if (n.includes('bagage')) {
            player.luggageMeshes.push(child);
            // On peut optionnellement les cacher par défaut
            // child.visible = false; 
        }

        const mat = getMaterialForMesh(child.name);
        if (mat) {
            // Matériau spécial partagé (jantes, cuir, tissu…)
            child.material = mat;
        } else {
            // Carrosserie : couleur propre au joueur
            const bodyMat = new THREE.MeshStandardMaterial({
                color:     player.colorInt,
                roughness: 0.35,
                metalness: 0.10,
            });
            bodyMat.userData.isBodyColor = true;
            child.material = bodyMat;
        }

        // Détection des roues
        if (n.includes('roue')) {
            child.geometry.computeBoundingBox();
            const size = new THREE.Vector3();
            child.geometry.boundingBox.getSize(size);
            child._axis = (size.x <= size.y && size.x <= size.z) ? 'x'
                : (size.y <= size.x && size.y <= size.z ? 'y' : 'z');
            if (child.position.x > 0) player.wheelsFront.push(child);
            else                       player.wheelsRear.push(child);
        }
    });

    // Créer un pivot de braquage pour chaque roue avant
    // Le pivot porte la position du FBX ; le mesh reste à (0,0,0) dans le pivot
    // → steerPivot.rotation.y = braquage  (axe Y local du parent = vertical monde)
    player.wheelsFront.forEach(w => {
        const parent = w.parent;
        const steerPivot = new THREE.Group();
        steerPivot.position.copy(w.position);
        parent.remove(w);
        parent.add(steerPivot);
        w.position.set(0, 0, 0);
        steerPivot.add(w);
        w._steerPivot = steerPivot;
    });

    player.carVisual.add(clone);

    player.car = new THREE.Group();
    player.car.add(player.carVisual);

    // Position de spawn échelonnée
    const col = spawnIndex % SPAWN_COLS;
    const row = Math.floor(spawnIndex / SPAWN_COLS);
    player.car.position.set((col - (SPAWN_COLS - 1) / 2) * 6, 0, row * -8);
    spawnIndex++;

    scene.add(player.car);
}

// ── Voiture statique (obstacle, non contrôlable) ──────────────────────────────
// Clone le FBX mis en cache, applique une couleur unique, sans état physique
export async function loadStaticCar(x, z, angle, color = 0xfafafa) {
    const fbx   = await loadFBX();
    const clone = fbx.clone(true);

    clone.rotation.y = Math.PI * 1.5;
    clone.scale.set(0.015, 0.015, 0.015);

    const box    = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    clone.position.x = -center.x;
    clone.position.z = -center.z;
    clone.position.y = -box.min.y;

    clone.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mat = getMaterialForMesh(child.name);
        child.material = mat ?? new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.10 });
    });

    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = angle;
    root.add(clone);
    scene.add(root);
    return root;
}
