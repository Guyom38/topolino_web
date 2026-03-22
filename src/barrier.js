// ── Barrière carrée — mode conduite libre ─────────────────────────────────────
import * as THREE from 'three';
import { scene } from './scene.js';

export const BARRIER_HALF = 80;  // demi-côté du carré (unités)

const WALL_H   = 3.5;            // hauteur du mur
const WALL_L   = BARRIER_HALF * 2; // longueur d'un côté = 160
const BOUNCE   = 0.30;

let _hazardTex = null;

// ── Texture rayures chevrons rouge/noir ───────────────────────────────────────
function _makeHazardTex() {
    const cv  = document.createElement('canvas');
    cv.width  = 512; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#cc2200';
    const sw = 40;
    for (let x = -80; x < 600; x += sw * 2) {
        ctx.beginPath();
        ctx.moveTo(x,           0);
        ctx.lineTo(x + sw,      0);
        ctx.lineTo(x + sw - 64, 64);
        ctx.lineTo(x - 64,      64);
        ctx.closePath();
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS  = THREE.RepeatWrapping;
    tex.wrapT  = THREE.ClampToEdgeWrapping;
    tex.repeat.set(WALL_L / 8, 1);
    return tex;
}

// ── Création d'un pan de mur ──────────────────────────────────────────────────
function _makeWall(wallMat, rimMat, baseMat, px, pz, rotY) {
    // Corps du mur
    const wallGeo = new THREE.PlaneGeometry(WALL_L, WALL_H);
    const wall    = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(px, WALL_H / 2, pz);
    wall.rotation.y = rotY;
    scene.add(wall);

    // Barre lumineuse au sommet
    const rimGeo = new THREE.BoxGeometry(WALL_L, 0.30, 0.30);
    const rim    = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(px, WALL_H + 0.15, pz);
    rim.rotation.y = rotY;
    scene.add(rim);

    // Socle béton
    const baseGeo = new THREE.BoxGeometry(WALL_L, 0.60, 0.60);
    const base    = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(px, 0.30, pz);
    base.rotation.y = rotY;
    scene.add(base);
}

// ── Création visuelle ─────────────────────────────────────────────────────────
export function initBarrier() {
    _hazardTex = _makeHazardTex();

    const wallMat = new THREE.MeshStandardMaterial({
        map:       _hazardTex,
        roughness: 0.75,
        metalness: 0.05,
        side:      THREE.DoubleSide,
    });
    const rimMat = new THREE.MeshStandardMaterial({
        color:             0xff4400,
        emissive:          0xff2200,
        emissiveIntensity: 1.4,
        roughness:         0.35,
        metalness:         0.25,
    });
    const baseMat = new THREE.MeshStandardMaterial({
        color:     0x505050,
        roughness: 0.9,
        metalness: 0.05,
    });

    const H = BARRIER_HALF;
    // 4 murs : +Z, -Z, +X, -X
    _makeWall(wallMat, rimMat, baseMat,  0,  H, Math.PI);       // mur avant
    _makeWall(wallMat, rimMat, baseMat,  0, -H, 0);             // mur arrière
    _makeWall(wallMat, rimMat, baseMat,  H,  0, Math.PI / 2);   // mur droit
    _makeWall(wallMat, rimMat, baseMat, -H,  0, -Math.PI / 2);  // mur gauche

    // Poteaux de coin
    const postGeo = new THREE.BoxGeometry(0.8, WALL_H + 0.5, 0.8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(sx * H, (WALL_H + 0.5) / 2, sz * H);
            scene.add(post);
        }
    }
}

// ── Animation — appeler chaque frame ──────────────────────────────────────────
export function updateBarrier() {
    if (_hazardTex) _hazardTex.offset.x += 0.003;
}

// ── Collision AABB — appeler après updatePhysics pour chaque joueur ───────────
export function applyBarrier(p) {
    if (!p.car) return;
    const inner = BARRIER_HALF - 1.0;

    // Axe X
    if (p.car.position.x > inner) {
        p.car.position.x = inner;
        if (p.velocity.x > 0) {
            p.velocity.x  = -p.velocity.x * BOUNCE;
            p.velocity.z *= (1 - BOUNCE * 0.3);
            p.carSpeed     = Math.abs(p.carSpeed) * (1 - BOUNCE * 0.5);
        }
    } else if (p.car.position.x < -inner) {
        p.car.position.x = -inner;
        if (p.velocity.x < 0) {
            p.velocity.x  = -p.velocity.x * BOUNCE;
            p.velocity.z *= (1 - BOUNCE * 0.3);
            p.carSpeed     = Math.abs(p.carSpeed) * (1 - BOUNCE * 0.5);
        }
    }

    // Axe Z
    if (p.car.position.z > inner) {
        p.car.position.z = inner;
        if (p.velocity.z > 0) {
            p.velocity.z  = -p.velocity.z * BOUNCE;
            p.velocity.x *= (1 - BOUNCE * 0.3);
            p.carSpeed     = Math.abs(p.carSpeed) * (1 - BOUNCE * 0.5);
        }
    } else if (p.car.position.z < -inner) {
        p.car.position.z = -inner;
        if (p.velocity.z < 0) {
            p.velocity.z  = -p.velocity.z * BOUNCE;
            p.velocity.x *= (1 - BOUNCE * 0.3);
            p.carSpeed     = Math.abs(p.carSpeed) * (1 - BOUNCE * 0.5);
        }
    }
}
