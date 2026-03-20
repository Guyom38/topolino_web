// ── Géométrie 3D du parking — disposition paysage ────────────────────────────
import * as THREE from 'three';
import { scene } from '../scene.js';
import { SPOTS, SPOT_HW, SPOT_HD, STARTING_POSITIONS } from './ParkingSpots.js';

// ── Coordonnées monde couvertes par la texture ────────────────────────────────
// PlaneGeometry(80, 48) centré en (0, 0.01, 2) → X=[-40,40], Z=[-22,26]
const WX0 = -40, WX1 = 40, WW = 80;
const WZ0 =  26, WZ1 = -22, WH = 48;  // Z décroit (nord)
const TW  = 2048, TH = 1024;

function cx(wx) { return (wx - WX0) / WW * TW; }
function cy(wz) { return (WZ0 - wz) / WH * TH; }

// ── Dessin du rectangle d'une place ──────────────────────────────────────────
function drawSpotRect(ctx, spot, color, lw) {
    const fwdX = -Math.sin(spot.angle), fwdZ = -Math.cos(spot.angle);
    const rX = fwdZ, rZ = -fwdX;
    const hw = SPOT_HW, hd = SPOT_HD;
    const C = [
        [spot.x + fwdX*hd + rX*hw, spot.z + fwdZ*hd + rZ*hw],
        [spot.x + fwdX*hd - rX*hw, spot.z + fwdZ*hd - rZ*hw],
        [spot.x - fwdX*hd - rX*hw, spot.z - fwdZ*hd - rZ*hw],
        [spot.x - fwdX*hd + rX*hw, spot.z - fwdZ*hd + rZ*hw],
    ];
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    ctx.moveTo(cx(C[0][0]), cy(C[0][1]));
    for (let i = 1; i < 4; i++) ctx.lineTo(cx(C[i][0]), cy(C[i][1]));
    ctx.closePath();
    ctx.stroke();
}

// ── Flèche directionnelle ─────────────────────────────────────────────────────
function drawArrow(ctx, wx, wz, angleDeg, size = 18) {
    ctx.save();
    ctx.translate(cx(wx), cy(wz));
    ctx.rotate(angleDeg * Math.PI / 180);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.55, size * 0.45);
    ctx.lineTo(0, 0);
    ctx.lineTo(-size * 0.55, size * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// ── Tirets de l'axe médian ────────────────────────────────────────────────────
function drawDashes(ctx, x1, z1, x2, z2, dashLen = 4, gap = 3) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const nx = dx / len, nz = dz / len;
    const total = dashLen + gap;
    ctx.strokeStyle = 'rgba(255,255,100,0.5)';
    ctx.lineWidth = 2;
    for (let d = 0; d < len; d += total) {
        const t0 = d / len, t1 = Math.min((d + dashLen) / len, 1);
        ctx.beginPath();
        ctx.moveTo(cx(x1 + dx * t0), cy(z1 + dz * t0));
        ctx.lineTo(cx(x1 + dx * t1), cy(z1 + dz * t1));
        ctx.stroke();
    }
}

// ── Texture canvas principale ─────────────────────────────────────────────────
function buildTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = TW; canvas.height = TH;
    const ctx = canvas.getContext('2d');

    // 1. Asphalte de base (route périphérique + zone intérieure)
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, TW, TH);

    // 2. Zone intérieure de parking (légèrement plus claire)
    ctx.fillStyle = '#464646';
    ctx.fillRect(cx(-30), cy(11), cx(30) - cx(-30), cy(-11) - cy(11));

    // 3. Trottoirs (bandes claires entre zone intérieure et route)
    ctx.fillStyle = '#8a8a8a';
    // Haut
    ctx.fillRect(cx(-30), cy(12), cx(30) - cx(-30), cy(11) - cy(12));
    // Bas
    ctx.fillRect(cx(-30), cy(-11), cx(30) - cx(-30), cy(-12) - cy(-11));

    // 4. Herbe extérieure (au-delà de X=±37, Z=±18) — remplie en vert
    ctx.fillStyle = '#4a7c3a';
    // Bords gauche/droit
    ctx.fillRect(0,        0, cx(-37),             TH);
    ctx.fillRect(cx(37),   0, TW - cx(37),          TH);
    // Bords haut/bas
    ctx.fillRect(cx(-37), 0,         cx(37) - cx(-37), cy(18));
    ctx.fillRect(cx(-37), cy(-18),   cx(37) - cx(-37), TH - cy(-18));

    // 5. Zone de départ F1 (prolongement à droite de la droite du bas)
    // Asphalte foncé Z=+11 à +18, X=-37 à +37
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(cx(-37), cy(18), cx(37) - cx(-37), cy(11) - cy(18));

    // 6. Tirets axe médian sur chaque tronçon
    const MID_R = 33.5, MID_L = -33.5, MID_B = 14.5, MID_T = -14.5;
    // Bas (→ est, z=14.5)
    drawDashes(ctx, -36, MID_B,  36, MID_B);
    // Haut (← ouest, z=-14.5)
    drawDashes(ctx,  36, MID_T, -36, MID_T);
    // Droite (↑ nord, x=33.5)
    drawDashes(ctx, MID_R,  17, MID_R, -17);
    // Gauche (↓ sud, x=-33.5)
    drawDashes(ctx, MID_L, -17, MID_L,  17);

    // 7. Flèches de sens de circulation
    // Bas → est (angle 90° = pointe droite)
    for (let x = -24; x <= 24; x += 16) drawArrow(ctx, x, MID_B, 90);
    // Haut → ouest (angle -90°)
    for (let x = 24; x >= -24; x -= 16) drawArrow(ctx, x, MID_T, -90);
    // Droite → nord (angle 0° = pointe haut)
    for (let z = 12; z >= -12; z -= 8) drawArrow(ctx, MID_R, z, 0);
    // Gauche → sud (angle 180°)
    for (let z = -12; z <= 12; z += 8) drawArrow(ctx, MID_L, z, 180);

    // 8. Lignes blanches des places (toutes)
    for (const s of SPOTS) drawSpotRect(ctx, s, 'rgba(210,210,210,0.85)', 3);

    // 9. Contours jaunes des places vides
    for (const s of SPOTS) {
        if (!s.empty) continue;
        drawSpotRect(ctx, s, '#f7c900', 5);
        // "P" au centre de la place
        ctx.save();
        ctx.fillStyle = 'rgba(247,201,0,0.6)';
        ctx.font = `bold ${Math.round(cy(0)-cy(3))}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('P', cx(s.x), cy(s.z));
        ctx.restore();
    }

    // 10. Ligne de départ (damier) à x=-27, traversant la droite du bas
    {
        const sqH = cy(11) - cy(18); // hauteur en pixels du tronçon
        const sqW = sqH;             // carré
        const startX = cx(-27);
        const numRows = Math.ceil((cy(-11) - cy(-18)) / sqH) + 1;
        const colZ0   = cy(18);      // haut du tronçon bas
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col <= 1; col++) {
                ctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#000000';
                ctx.fillRect(startX + col * sqW, colZ0 + row * sqH, sqW, sqH);
            }
        }
    }

    // 11. Boxes de grille F1 (rectangles tracés sur la droite du bas)
    ctx.strokeStyle = 'rgba(255,255,0,0.6)';
    ctx.lineWidth = 2;
    for (const pos of STARTING_POSITIONS) {
        ctx.strokeRect(cx(pos.x - 2), cy(pos.z + 2.5), cx(pos.x + 2) - cx(pos.x - 2), cy(pos.z - 2.5) - cy(pos.z + 2.5));
        // Numéro de position
        ctx.fillStyle = 'rgba(255,255,0,0.5)';
        ctx.font = `bold ${Math.round(cy(0) - cy(2))}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
    }

    // 12. Panneau "PARKING" dans la zone intérieure (décoratif)
    ctx.fillStyle = 'rgba(70,70,70,0.0)'; // invisible, juste pour la lisibilité du code

    // 13. Lignes de délimitation de la route intérieure
    ctx.strokeStyle = 'rgba(180,180,180,0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(cx(-30), cy(11), cx(30) - cx(-30), cy(-11) - cy(11));
    ctx.setLineDash([]);

    return new THREE.CanvasTexture(canvas);
}

// ── Export principal ──────────────────────────────────────────────────────────
export function createParkingLot() {
    const meshes = [];

    // A. Plan asphalte principal (2048×1024, 80×48 unités monde)
    const tex = buildTexture();
    const geo = new THREE.PlaneGeometry(80, 48);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.01, 2); // centre en Z=(26-22)/2=2
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);

    // B. Herbe extérieure (4 panneaux verts au-delà de X=±37 et Z=±18)
    const gMat = new THREE.MeshStandardMaterial({ color: 0x4a7c3a, roughness: 1 });
    [
        { w: 12, d: 80, x: -43, z: 2   },   // gauche
        { w: 12, d: 80, x:  43, z: 2   },   // droite
        { w: 94, d: 10, x:   0, z: -23 },   // nord
        { w: 94, d: 10, x:   0, z:  31 },   // sud
    ].forEach(g => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(g.w, g.d), gMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(g.x, 0, g.z);
        m.receiveShadow = true;
        scene.add(m);
        meshes.push(m);
    });

    // C. Bordures basses (trottoirs / îlots)
    const cMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 });
    [
        // Pourtour extérieur de la route
        { w: 74, h: 0.3, d: 0.4, x:  0,   y: 0.15, z:  18.2  },
        { w: 74, h: 0.3, d: 0.4, x:  0,   y: 0.15, z: -18.2  },
        { w: 0.4,h: 0.3, d: 36,  x:  37.2,y: 0.15, z:  0     },
        { w: 0.4,h: 0.3, d: 36,  x: -37.2,y: 0.15, z:  0     },
        // Délimitation intérieure (séparation route / parking)
        { w: 60, h: 0.2, d: 0.3, x:  0,   y: 0.1,  z:  11.15 },
        { w: 60, h: 0.2, d: 0.3, x:  0,   y: 0.1,  z: -11.15 },
        { w: 0.3,h: 0.2, d: 22,  x:  30.15,y: 0.1, z:  0     },
        { w: 0.3,h: 0.2, d: 22,  x: -30.15,y: 0.1, z:  0     },
    ].forEach(c => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), cMat);
        m.position.set(c.x, c.y, c.z);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
        meshes.push(m);
    });

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
