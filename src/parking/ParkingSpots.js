// ── Places de parking — disposition paysage (TV 16:9) ────────────────────────
// Lot intérieur : X=[-30,30] × Z=[-11,11]  (60 de large, 22 de haut)
// Route périphérique : +7 unités de chaque côté → X=[-37,37] × Z=[-18,18]
// Sens de circulation antihoraire : bas→est, droite→nord, haut→ouest, gauche→sud

export const SPOT_HW = 2.5;  // demi-largeur (espacement 5 unités)
export const SPOT_HD = 3.5;  // demi-profondeur

// Angle de départ F1 : voitures face à l'est (+X) = angle -PI/2
export const STARTING_ANGLE = -Math.PI / 2;

// 12 positions X réparties sur la largeur de la zone intérieure
const X_POS = [-27.5,-22.5,-17.5,-12.5,-7.5,-2.5, 2.5, 7.5,12.5,17.5,22.5,27.5];

// Grille de départ F1 (droite du bas, z=+11 à +18, face est)
// Deux colonnes décalées, la plus avancée à gauche (x minimal = pointe à gauche = arrive en tête)
export const STARTING_POSITIONS = [
    { x: -25, z: +13, angle: STARTING_ANGLE }, // P1 colonne intérieure
    { x: -21, z: +16, angle: STARTING_ANGLE }, // P2 colonne extérieure
    { x: -17, z: +13, angle: STARTING_ANGLE }, // P3
    { x: -13, z: +16, angle: STARTING_ANGLE }, // P4
    { x:  -9, z: +13, angle: STARTING_ANGLE }, // P5
    { x:  -5, z: +16, angle: STARTING_ANGLE }, // P6
    { x:  -1, z: +13, angle: STARTING_ANGLE }, // P7
    { x:  +3, z: +16, angle: STARTING_ANGLE }, // P8
];

const SPOTS = [];
let _id = 0;

// ── Rangée A : créneau nord (Z=+7.5, angle=0, nez vers le couloir central) ───
// Places vides : indices 1, 4, 7, 10
const EMPTY_A = new Set([1, 4, 7, 10]);
for (let i = 0; i < 12; i++) {
    SPOTS.push({ id: _id++, x: X_POS[i], z: +7.5, angle: 0,        type: 'creneau',  empty: EMPTY_A.has(i), baseScore: 150 });
}

// ── Rangée B : créneau sud (Z=-7.5, angle=PI, nez vers le couloir central) ───
// Places vides : indices 2, 5, 8, 11
const EMPTY_B = new Set([2, 5, 8, 11]);
for (let i = 0; i < 12; i++) {
    SPOTS.push({ id: _id++, x: X_POS[i], z: -7.5, angle: Math.PI, type: 'creneau',  empty: EMPTY_B.has(i), baseScore: 150 });
}

export { SPOTS };
