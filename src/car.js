import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { config } from './config.js';
import { scene } from './scene.js';
import { getMaterialForMesh, getPoliceMaterialForMesh } from './materials.js';

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

        const mat = (player.isPolice ? getPoliceMaterialForMesh(child.name) : null)
                 ?? getMaterialForMesh(child.name);
        if (mat) {
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

    if (player.isPolice) {
        player.girophare = addGirophare(player.carVisual);
    }

    player.car = new THREE.Group();
    player.car.add(player.carVisual);

    // Position de spawn échelonnée
    const col = spawnIndex % SPAWN_COLS;
    const row = Math.floor(spawnIndex / SPAWN_COLS);
    player.car.position.set((col - (SPAWN_COLS - 1) / 2) * 6, 0, row * -8);
    spawnIndex++;

    scene.add(player.car);
}

// ── Girophare de police ───────────────────────────────────────────────────────
// ── Textures partagées entre toutes les voitures de police ───────────────────
let _roofTex = null;
function _getRoofTexture() {
    if (_roofTex) return _roofTex;
    const W = 512, H = 256;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    // Rectangle blanc central
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(110, 88, 292, 80);
    // Carré rouge gauche
    ctx.fillStyle = '#DD1111';
    ctx.fillRect(0, 68, 118, 120);
    // Carré bleu droit
    ctx.fillStyle = '#1155DD';
    ctx.fillRect(394, 68, 118, 120);
    _roofTex = new THREE.CanvasTexture(c);
    return _roofTex;
}

let _doorTex = null;
function _getDoorTexture() {
    if (_doorTex) return _doorTex;
    const W = 512, H = 192;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 116px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,10,30,0.85)'; ctx.lineWidth = 28; ctx.lineJoin = 'round';
    ctx.strokeText('POLICE', W / 2, H / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('POLICE', W / 2, H / 2);
    _doorTex = new THREE.CanvasTexture(c);
    return _doorTex;
}

export function addGirophare(parent) {
    // ── Barre de toit 3 cellules : [BLEU | GRIS | ROUGE] ────────────────────────
    const barGeo = new THREE.BoxGeometry(0.72, 0.12, 0.18);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.8 });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set(0, 2.32, 0.0);
    bar.rotation.y = Math.PI / 2;  // long axe en Z = gauche-droite de la voiture
    bar.scale.setScalar(1.6);

    const cellGeo = new THREE.BoxGeometry(0.20, 0.10, 0.13);
    const matB = new THREE.MeshStandardMaterial({
        color: 0x2255FF, emissive: new THREE.Color(0x0033FF), emissiveIntensity: 4.0,
        roughness: 0.1, metalness: 0.0,
    });
    const matMid = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.6 });
    const matR = new THREE.MeshStandardMaterial({
        color: 0xFF2020, emissive: new THREE.Color(0xFF0000), emissiveIntensity: 4.0,
        roughness: 0.1, metalness: 0.0,
    });

    const cellBlue = new THREE.Mesh(cellGeo, matB);
    cellBlue.position.set(-0.24, 0.015, 0);
    bar.add(cellBlue);

    const cellMid = new THREE.Mesh(cellGeo, matMid);
    cellMid.position.set(0, 0.015, 0);
    bar.add(cellMid);

    const cellRed = new THREE.Mesh(cellGeo, matR);
    cellRed.position.set(0.24, 0.015, 0);
    bar.add(cellRed);

    parent.add(bar);

    // ── Halos sur le toit ─────────────────────────────────────────────────────
    const haloGeo = new THREE.CircleGeometry(0.35, 12);
    const haloMatR = new THREE.MeshBasicMaterial({
        color: 0xFF2020, transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const haloMatB = new THREE.MeshBasicMaterial({
        color: 0x0033FF, transparent: true, opacity: 0.15,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const haloR = new THREE.Mesh(haloGeo, haloMatR);
    haloR.rotation.x = -Math.PI / 2;
    haloR.position.set(0, 2.27, 0.38);   // sous cellule rouge (Z+)
    parent.add(haloR);
    const haloB = new THREE.Mesh(haloGeo, haloMatB);
    haloB.rotation.x = -Math.PI / 2;
    haloB.position.set(0, 2.27, -0.38);  // sous cellule bleue (Z–)
    parent.add(haloB);

    // ── Décal marquage toit (plan plaqué sur la surface, 90° orienté) ─────────
    const roofGroup = new THREE.Group();
    roofGroup.position.set(0, 2.27, 0.0);
    roofGroup.rotation.x = -Math.PI / 2;           // allongé à plat
    const roofMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.80, 1.31),
        new THREE.MeshBasicMaterial({
            map: _getRoofTexture(), transparent: true, depthWrite: false,
        })
    );
    roofMesh.rotation.z = Math.PI / 2;              // 90° → axe long suit la longueur du toit
    roofGroup.add(roofMesh);
    parent.add(roofGroup);

    // ── Décals portes (plans flottants juste au-dessus des portes) ────────────
    const doorMatR = new THREE.MeshBasicMaterial({
        map: _getDoorTexture(), transparent: true, depthWrite: false,
    });
    const doorMatL = new THREE.MeshBasicMaterial({
        map: _getDoorTexture(), transparent: true, depthWrite: false,
    });
    const doorGeo = new THREE.PlaneGeometry(1.44, 0.58);

    const doorR = new THREE.Mesh(doorGeo, doorMatR);
    doorR.rotation.y = 0;                           // face droite (+Z)
    doorR.position.set(0, 0.95, 1.1);
    parent.add(doorR);

    const doorL = new THREE.Mesh(doorGeo, doorMatL);
    doorL.rotation.y = Math.PI;                     // face gauche (-Z)
    doorL.scale.x = -1;                             // miroir pour lecture correcte
    doorL.position.set(0, 0.95, -1.1);
    parent.add(doorL);

    return {
        update(time) {
            const t = Math.floor(time / 140) % 2;
            matB.emissiveIntensity = t === 0 ? 5.0 : 0.1;
            matR.emissiveIntensity = t === 1 ? 5.0 : 0.1;
            haloMatB.opacity = t === 0 ? 0.70 : 0.05;
            haloMatR.opacity = t === 1 ? 0.70 : 0.05;
        },
        dispose() {
            parent.remove(bar); parent.remove(haloR); parent.remove(haloB);
            parent.remove(roofGroup); parent.remove(doorR); parent.remove(doorL);
            barGeo.dispose(); barMat.dispose(); cellGeo.dispose();
            matB.dispose(); matMid.dispose(); matR.dispose(); haloGeo.dispose();
            haloMatR.dispose(); haloMatB.dispose();
            doorGeo.dispose(); doorMatR.dispose(); doorMatL.dispose();
        },
    };
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
