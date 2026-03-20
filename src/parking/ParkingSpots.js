// ── Définition de toutes les places de parking ────────────────────────────────
// Chaque place : { id, x, z, angle, type, empty, baseScore }

// Demi-dimensions d'une place (en unités monde)
export const SPOT_HW = 2.25; // demi-largeur
export const SPOT_HD = 3.5;  // demi-profondeur

// Positions X communes à toutes les rangées (espacement 4.5)
const X_POSITIONS = [-15.75, -11.25, -6.75, -2.25, 2.25, 6.75, 11.25, 15.75];

// Positions de départ (ligne de départ à Z=34)
export const STARTING_POSITIONS = [
    { x: -17.5, z: 34 },
    { x: -12.5, z: 34 },
    { x:  -7.5, z: 34 },
    { x:  -2.5, z: 34 },
    { x:   2.5, z: 34 },
    { x:   7.5, z: 34 },
    { x:  12.5, z: 34 },
    { x:  17.5, z: 34 },
];

const SPOTS = [];
let _id = 0;

// ── Rangée A : créneau, nord (Z=23, angle=0, face au sud / -Z) ───────────────
// Vides : indices 2 (x=-6.75) et 5 (x=6.75)
const ROW_A_EMPTY = new Set([2, 5]);
for (let i = 0; i < 8; i++) {
    SPOTS.push({
        id:        _id++,
        x:         X_POSITIONS[i],
        z:         23,
        angle:     0,
        type:      'creneau',
        empty:     ROW_A_EMPTY.has(i),
        baseScore: 150,
    });
}

// ── Rangée B : créneau, sud (Z=3, angle=Math.PI, face au nord / +Z) ──────────
// Vides : indices 1 (x=-11.25) et 6 (x=11.25)
const ROW_B_EMPTY = new Set([1, 6]);
for (let i = 0; i < 8; i++) {
    SPOTS.push({
        id:        _id++,
        x:         X_POSITIONS[i],
        z:         3,
        angle:     Math.PI,
        type:      'creneau',
        empty:     ROW_B_EMPTY.has(i),
        baseScore: 150,
    });
}

// ── Rangée C : bataille (Z=-10, angle=Math.PI/4, face SW) ────────────────────
// Vides : indices 0 (x=-15.75), 3 (x=-2.25), 7 (x=15.75)
const ROW_C_EMPTY = new Set([0, 3, 7]);
for (let i = 0; i < 8; i++) {
    SPOTS.push({
        id:        _id++,
        x:         X_POSITIONS[i],
        z:         -10,
        angle:     Math.PI / 4,
        type:      'bataille',
        empty:     ROW_C_EMPTY.has(i),
        baseScore: 100,
    });
}

// ── Rangée D : bataille (Z=-23, angle=-Math.PI/4, face SE) ───────────────────
// Vides : indices 1 (x=-11.25), 4 (x=2.25), 6 (x=11.25)
const ROW_D_EMPTY = new Set([1, 4, 6]);
for (let i = 0; i < 8; i++) {
    SPOTS.push({
        id:        _id++,
        x:         X_POSITIONS[i],
        z:         -23,
        angle:     -Math.PI / 4,
        type:      'bataille',
        empty:     ROW_D_EMPTY.has(i),
        baseScore: 100,
    });
}

export { SPOTS };
