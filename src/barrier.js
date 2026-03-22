// ── Barrière circulaire — mode conduite libre ─────────────────────────────────
import * as THREE from 'three';
import { scene } from './scene.js';

export const BARRIER_R = 150;   // rayon du mur (unités)

const WALL_H   = 3.0;           // hauteur du mur
const BOUNCE   = 0.30;          // coefficient de rebond (0 = mou, 1 = élastique)
const SEGMENTS = 160;           // finesse du cylindre

let _hazardTex = null;          // texture de rayures (animée)

// ── Création visuelle ─────────────────────────────────────────────────────────
export function initBarrier() {

    // Texture rayures chevrons rouge/noir (identique au trou du derby)
    const cv  = document.createElement('canvas');
    cv.width  = 512;
    cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#cc2200';
    const sw = 40;
    for (let x = -80; x < 600; x += sw * 2) {
        ctx.beginPath();
        ctx.moveTo(x,          0);
        ctx.lineTo(x + sw,     0);
        ctx.lineTo(x + sw - 64, 64);
        ctx.lineTo(x - 64,    64);
        ctx.closePath();
        ctx.fill();
    }
    _hazardTex = new THREE.CanvasTexture(cv);
    _hazardTex.wrapS    = THREE.RepeatWrapping;
    _hazardTex.wrapT    = THREE.ClampToEdgeWrapping;
    _hazardTex.repeat.set(SEGMENTS / 8, 1);

    // Mur cylindrique — face intérieure (BackSide)
    const wallGeo = new THREE.CylinderGeometry(
        BARRIER_R, BARRIER_R, WALL_H, SEGMENTS, 1, true
    );
    const wallMat = new THREE.MeshStandardMaterial({
        map:       _hazardTex,
        roughness: 0.75,
        metalness: 0.05,
        side:      THREE.DoubleSide,   // BackSide cause VALIDATE_STATUS false sur certains GPU
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = WALL_H / 2;
    scene.add(wall);

    // Tore lumineux au sommet
    const rimGeo = new THREE.TorusGeometry(BARRIER_R, 0.20, 8, SEGMENTS);
    const rimMat = new THREE.MeshStandardMaterial({
        color:             0xff4400,
        emissive:          0xff2200,
        emissiveIntensity: 1.4,
        roughness:         0.35,
        metalness:         0.25,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = WALL_H;
    scene.add(rim);

    // Socle béton (bas du mur)
    const baseGeo = new THREE.TorusGeometry(BARRIER_R, 0.40, 8, SEGMENTS);
    const baseMat = new THREE.MeshStandardMaterial({
        color:     0x505050,
        roughness: 0.9,
        metalness: 0.05,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.rotation.x = Math.PI / 2;
    base.position.y = 0.40;
    scene.add(base);
}

// ── Animation — appeler chaque frame ──────────────────────────────────────────
export function updateBarrier() {
    if (_hazardTex) _hazardTex.offset.x += 0.003;
}

// ── Collision — appeler après updatePhysics pour chaque joueur ────────────────
export function applyBarrier(p) {
    if (!p.car) return;

    const x    = p.car.position.x;
    const z    = p.car.position.z;
    const dist = Math.sqrt(x * x + z * z);

    // Aucune interaction loin de la barrière
    if (dist < BARRIER_R - 1.0) return;

    // Normale vers l'intérieur (du mur vers le centre)
    const nx = x / dist;   // direction radiale vers l'extérieur
    const nz = z / dist;

    // Reclamper la position à l'intérieur du mur
    const inner = BARRIER_R - 1.0;
    p.car.position.x = nx * inner;
    p.car.position.z = nz * inner;

    // Composante de vitesse sortante (vers le mur)
    const vOut = p.velocity.x * nx + p.velocity.z * nz;
    if (vOut > 0) {
        // Réfléchir la composante radiale avec amortissement
        p.velocity.x -= (1 + BOUNCE) * vOut * nx;
        p.velocity.z -= (1 + BOUNCE) * vOut * nz;
        p.carSpeed    = Math.abs(p.carSpeed) * (1 - BOUNCE * 0.5);
    }
}
