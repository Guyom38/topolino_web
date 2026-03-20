// ── Géométrie 3D du parking ───────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { SPOTS, SPOT_HW, SPOT_HD } from './ParkingSpots.js';

// Dimensions du plan de texture
const TEX_W = 1024;
const TEX_H = 1024;

// Étendue monde couverte par le plan principal
// PlaneGeometry(44, 60) centré en (0, 0.01, 4) → X=[-22,22], Z=[-26,34]
const WORLD_X_MIN = -22, WORLD_X_MAX = 22; // largeur 44
const WORLD_Z_MIN = -26, WORLD_Z_MAX = 34; // hauteur 60
const WORLD_W = WORLD_X_MAX - WORLD_X_MIN;
const WORLD_H = WORLD_Z_MAX - WORLD_Z_MIN;

// Coordonnées canvas depuis coordonnées monde
function cx(wx) { return (wx - WORLD_X_MIN) / WORLD_W * TEX_W; }
function cy(wz) { return (WORLD_Z_MAX - wz) / WORLD_H * TEX_H; }

// Dessine le rectangle d'une place de parking
function drawSpotRect(ctx, spot, strokeStyle, lineWidth) {
    const hw = SPOT_HW, hd = SPOT_HD;
    const fwdX = -Math.sin(spot.angle), fwdZ = -Math.cos(spot.angle);
    const rgtX = fwdZ, rgtZ = -fwdX;
    const corners = [
        [spot.x + fwdX * hd + rgtX * hw, spot.z + fwdZ * hd + rgtZ * hw],
        [spot.x + fwdX * hd - rgtX * hw, spot.z + fwdZ * hd - rgtZ * hw],
        [spot.x - fwdX * hd - rgtX * hw, spot.z - fwdZ * hd - rgtZ * hw],
        [spot.x - fwdX * hd + rgtX * hw, spot.z - fwdZ * hd + rgtZ * hw],
    ];
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(cx(corners[0][0]), cy(corners[0][1]));
    for (let i = 1; i < 4; i++) ctx.lineTo(cx(corners[i][0]), cy(corners[i][1]));
    ctx.closePath();
    ctx.stroke();
}

// Crée une texture canvas avec tous les marquages au sol
function buildAsphaltTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const ctx = canvas.getContext('2d');

    // 1. Asphalte de base
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // 2. Bande de départ (Z=28 à 34) — plus sombre
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(cx(-22), cy(34), cx(22) - cx(-22), cy(28) - cy(34));

    // 3. Allée A (Z=7 à 19) — légèrement plus clair
    ctx.fillStyle = '#404040';
    ctx.fillRect(cx(-22), cy(19), cx(22) - cx(-22), cy(7) - cy(19));

    // 4. Séparateur herbe (Z=-1 à 1) — vert
    ctx.fillStyle = '#4a7c3a';
    ctx.fillRect(cx(-22), cy(1), cx(22) - cx(-22), cy(-1) - cy(1));

    // 5. Allée B (Z=-13 à -20) — légèrement plus clair
    ctx.fillStyle = '#404040';
    ctx.fillRect(cx(-22), cy(-13), cx(22) - cx(-22), cy(-20) - cy(-13));

    // 6. Zone terminale (Z=-26 à -30) — plus sombre
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(cx(-22), cy(-26), cx(22) - cx(-22), cy(-30) - cy(-26));

    // 7. Bandes trottoir (X=[-22,-20] et [20,22])
    ctx.fillStyle = '#b0a898';
    ctx.fillRect(cx(-22), 0, cx(-20) - cx(-22), TEX_H);
    ctx.fillRect(cx(20), 0, cx(22) - cx(20), TEX_H);

    // 8. Lignes blanches de toutes les places
    ctx.save();
    for (const spot of SPOTS) {
        drawSpotRect(ctx, spot, 'rgba(220,220,220,0.9)', 3);
    }
    ctx.restore();

    // 9. Contours jaunes des places vides (par-dessus les blanches)
    ctx.save();
    for (const spot of SPOTS) {
        if (!spot.empty) continue;
        drawSpotRect(ctx, spot, '#f7c900', 5);
    }
    ctx.restore();

    // 10. Damier de ligne de départ à Z=30
    {
        const sqW = 4 / WORLD_W * TEX_W; // 4 unités monde → pixels
        const sqH = sqW;
        const startY = cy(30);
        const endY   = cy(28);
        const numCols = Math.ceil(TEX_W / sqW);
        for (let col = 0; col < numCols; col++) {
            // Alterner noir/blanc
            ctx.fillStyle = col % 2 === 0 ? '#ffffff' : '#000000';
            ctx.fillRect(col * sqW, Math.min(startY, endY), sqW, Math.abs(endY - startY));
        }
    }

    // 11. Flèches de couloir
    ctx.fillStyle = '#666666';
    // Allée A : Z=13, flèche pointant sud
    {
        const ax = cx(0), ay = cy(13);
        const arrowH = 30, arrowW = 14;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.beginPath();
        ctx.moveTo(0, arrowH / 2);
        ctx.lineTo(-arrowW / 2, -arrowH / 2);
        ctx.lineTo(arrowW / 2, -arrowH / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
    // Allée B : Z=-16.5, deux flèches (nord et sud)
    {
        const bx = cx(-8), by = cy(-16.5);
        const arrowH = 28, arrowW = 13;
        // Flèche nord (pointe vers le haut du canvas = vers Z+)
        ctx.save();
        ctx.translate(bx, by);
        ctx.beginPath();
        ctx.moveTo(0, -arrowH / 2);
        ctx.lineTo(-arrowW / 2, arrowH / 2);
        ctx.lineTo(arrowW / 2, arrowH / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Flèche sud
        const bx2 = cx(8);
        ctx.save();
        ctx.translate(bx2, by);
        ctx.beginPath();
        ctx.moveTo(0, arrowH / 2);
        ctx.lineTo(-arrowW / 2, -arrowH / 2);
        ctx.lineTo(arrowW / 2, -arrowH / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // 12. Lignes de bordure du lot (X=±18)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx(-18), cy(34));
    ctx.lineTo(cx(-18), cy(-26));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx(18), cy(34));
    ctx.lineTo(cx(18), cy(-26));
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

export function createParkingLot() {
    const meshes = [];

    // ── A. Plan asphalte principal ────────────────────────────────────────────
    const asphaltTex = buildAsphaltTexture();
    const asphaltGeo = new THREE.PlaneGeometry(44, 60);
    const asphaltMat = new THREE.MeshStandardMaterial({
        map:       asphaltTex,
        roughness: 0.9,
        metalness: 0.0,
    });
    const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
    asphaltMesh.rotation.x = -Math.PI / 2;
    asphaltMesh.position.set(0, 0.01, 4); // centré sur X=[-22,22], Z=[-26,34]
    asphaltMesh.receiveShadow = true;
    scene.add(asphaltMesh);
    meshes.push(asphaltMesh);

    // ── B. Zone de départ (Z=34 à 40) ────────────────────────────────────────
    const startGeo = new THREE.PlaneGeometry(44, 6);
    const startMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.0 });
    const startMesh = new THREE.Mesh(startGeo, startMat);
    startMesh.rotation.x = -Math.PI / 2;
    startMesh.position.set(0, 0.01, 37);
    startMesh.receiveShadow = true;
    scene.add(startMesh);
    meshes.push(startMesh);

    // ── C. Bordures herbe ─────────────────────────────────────────────────────
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4a7c3a, roughness: 1.0, metalness: 0.0 });

    const grassDefs = [
        // [largeur, profondeur, cx, cz]
        { w: 4,  d: 70, x: -24, z: 5  },  // gauche  X=[-26,-22]
        { w: 4,  d: 70, x:  24, z: 5  },  // droite  X=[22,26]
        { w: 52, d: 5,  x:   0, z: 39.5 }, // nord   Z=[37,42]
        { w: 52, d: 4,  x:   0, z: -28 }, // sud    Z=[-30,-26]
    ];
    for (const g of grassDefs) {
        const geo = new THREE.PlaneGeometry(g.w, g.d);
        const m   = new THREE.Mesh(geo, grassMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(g.x, 0, g.z);
        m.receiveShadow = true;
        scene.add(m);
        meshes.push(m);
    }

    // ── D. Bordures basses / trottoirs ────────────────────────────────────────
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8, metalness: 0.0 });

    const curbDefs = [
        // Limite nord (Z=27.5)
        { w: 44, h: 0.3, d: 0.3, x: 0, y: 0.15, z: 27.5 },
        // Limite sud (Z=-26)
        { w: 44, h: 0.3, d: 0.3, x: 0, y: 0.15, z: -26 },
        // Limite ouest (X=-22)
        { w: 0.3, h: 0.3, d: 66, x: -22, y: 0.15, z: 4 },
        // Limite est (X=22)
        { w: 0.3, h: 0.3, d: 66, x:  22, y: 0.15, z: 4 },
    ];
    for (const c of curbDefs) {
        const geo = new THREE.BoxGeometry(c.w, c.h, c.d);
        const m   = new THREE.Mesh(geo, curbMat);
        m.position.set(c.x, c.y, c.z);
        m.castShadow    = true;
        m.receiveShadow = true;
        scene.add(m);
        meshes.push(m);
    }

    return {
        dispose() {
            meshes.forEach(m => {
                scene.remove(m);
                m.geometry.dispose();
                if (m.material.map) m.material.map.dispose();
                m.material.dispose();
            });
        },
    };
}
