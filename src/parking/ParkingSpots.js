// ── Places de parking — disposition paysage (TV 16:9) ────────────────────────
// Lot intérieur : X=[-30,30] × Z=[-11,11]  (60 de large, 22 de haut)
// Route périphérique : +7 unités de chaque côté → X=[-37,37] × Z=[-18,18]

export const SPOT_HW = 1.6;  // demi-largeur
export const SPOT_HD = 2.8;  // demi-profondeur

// Angle de départ F1 : voitures face à l'est (+X) = angle -PI/2
export const STARTING_ANGLE = -Math.PI / 2;

// Grille de départ F1 (droite du bas, z=+11 à +18, face est)
export const STARTING_POSITIONS = [
    { x: -28, z: +14.5, angle: STARTING_ANGLE },
    { x: -24, z: +14.5, angle: STARTING_ANGLE },
    { x: -20, z: +14.5, angle: STARTING_ANGLE },
    { x: -16, z: +14.5, angle: STARTING_ANGLE },
    { x: -12, z: +14.5, angle: STARTING_ANGLE },
    { x:  -8, z: +14.5, angle: STARTING_ANGLE },
    { x:  -4, z: +14.5, angle: STARTING_ANGLE },
    { x:   0, z: +14.5, angle: STARTING_ANGLE },
];

const SPOTS = [];
let _id = 0;

// ── Créneaux (Parallèle à la route) au nord (Z = 8.5)
const X_CRENEAUX = [-24, -16, -8, 0, 8, 16, 24];
const EMPTY_CRENEAUX = new Set([1, 4, 6]);
for (let i = 0; i < X_CRENEAUX.length; i++) {
    // Un créneau a besoin d'être un peu plus grand visuellement, mais le score utilise HW/HD.
    // On met l'angle à 0 (le nez pointe vers +Z, mais on se gare de côté, on tourne le spot de PI/2)
    // En fait, angle = -PI/2 (face est) comme la route.
    SPOTS.push({ 
        id: _id++, x: X_CRENEAUX[i], z: 8.5, angle: -Math.PI/2, 
        type: 'creneau', empty: EMPTY_CRENEAUX.has(i), baseScore: 250 
    });
}

// ── Bataille (Perpendiculaire) au sud (Z = -6.5)
// Plus dense, nez vers le nord (angle = 0)
const X_BATAILLE = [];
for (let x = -26; x <= 26; x += 3.6) X_BATAILLE.push(x);
const EMPTY_BATAILLE = new Set([2, 5, 8, 12, 14]);
for (let i = 0; i < X_BATAILLE.length; i++) {
    SPOTS.push({
        id: _id++, x: X_BATAILLE[i], z: -6.5, angle: Math.PI / 2,
        type: 'bataille', empty: EMPTY_BATAILLE.has(i), baseScore: 150
    });
}

// ── Quelques places mal garées pour les voitures fixes (décalage)
// On ajoute un offset aux voitures statiques dans `ParkingMode.js`, pas ici.

export { SPOTS };
