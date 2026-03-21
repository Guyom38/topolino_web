import * as THREE from 'three';

const texLoader = new THREE.TextureLoader();
const texLeather = texLoader.load('Asssets/leather.jpg');
const texFabric  = texLoader.load('Asssets/fabric2.jpg');

export const materials = {
    enjoliv:   new THREE.MeshStandardMaterial({ color: 0xD8D8D8, roughness: 0.25, metalness: 0.50 }),
    gris:      new THREE.MeshStandardMaterial({ color: 0x8A8A8A, roughness: 0.30, metalness: 0.65 }),
    grisFonce: new THREE.MeshStandardMaterial({ color: 0x3A3A3A, roughness: 0.40, metalness: 0.55 }),
    toit:      new THREE.MeshStandardMaterial({ color: 0x0F1520, roughness: 0.60, metalness: 0.10 }),
    rouge:     new THREE.MeshStandardMaterial({ color: 0xCC1111, roughness: 0.35, metalness: 0.10, emissive: new THREE.Color(0x220000) }),
    leather:   new THREE.MeshStandardMaterial({ map: texLeather, roughness: 0.80, metalness: 0.0 }),
    fabric:    new THREE.MeshStandardMaterial({ map: texFabric,  roughness: 0.95, metalness: 0.0 }),
    vitre:     new THREE.MeshStandardMaterial({ color: 0x99CCDD, roughness: 0.05, metalness: 0.10,
                                                transparent: true, opacity: 0.30, depthWrite: false }),
    blanc:     new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.35, metalness: 0.10 }),
    vert:      new THREE.MeshStandardMaterial({ color: 0x009246, roughness: 0.35, metalness: 0.10 }),
};

// --- Mapping exact nom de mesh → matériau ---

const enjolivMeshes = new Set([
    'z_roue_arriere_droite_jante_int', 'z_roue_arriere_gauche_jante_int',
    'z_roue_avant_droite_jante_int',   'z_roue_avant_gauche_jante_int',
    'lumineux_avant', 'lumineux_avant_001',
]);

const greyMeshes = new Set([
    'feux_avant', 'feux_avant_001', 'feux_avant_spot',
    'logo_avant_fiat', 'logo_arriere_fiat',
    'parchoque_arriere', 'parchoque_avant',
    'roue_avant_droite_axe',    'roue_avant_droite_enjoliver',
    'roue_avant_gauche_axes',   'roue_avant_gauche_enjoliver',
    'roue_arriere_gauche_axe',  'roue_arriere_gauche_enjoliver',
    'roue_arriere_droite_axe',  'roue_arriere_droite_enjoliver',
    'support_bagage',
    'phares_arriere_stop_001', 'phares_arriere_stop_002', 'phares_arrieres',
]);

const darkMeshes = new Set([
    'z_support_bagage_bloc', 'z_support_bagage_bloc_001',
    'bas_de_caisse', 'cache_moteur', 'essuie_glace', 'interieur_habitacle',
    'roue_arriere_droite_jante_ext', 'roue_arriere_droite_pneu',
    'roue_arriere_gauche_jante_ext', 'roue_arriere_gauche_pneu',
    'roue_avant_droite_jante_ext',   'roue_avant_droite_pneu',
    'roue_avant_gauche_jante_ext',   'roue_avant_gauche_pneu',
    'z_interieur',
]);

const toitMeshes = new Set([
    'y_carrosserie_arriere',     'y_carrosserie_arriere_001',
    'y_carrosserie_avant',       'y_carrosserie_avant_001',
    'y_carrosserie_laterales',   'y_carrosserie_portieres',
    'y_carrosserie_retros',
    'y_carrosserie_toit',        'y_carrosserie_toit_001',
]);

const rougeMeshes = new Set([
    'lumineux_arriere_parchoque', 'phares_arriere_stop',
    'italie_rouge', 'italie_rouge_001',
    'lumineux_plaque', 'lumineux_portiere_droite', 'lumineux_portiere_gauche',
]);

const vitreMeshes = new Set([
    'y_carrosserie_vitres_laterales', 'feux_avant_vitres',
    'vitre_arriere', 'vitre_avant', 'vitre_toit',
    'vitres_laterales', 'vitres_portieres',
]);

const blancMeshes = new Set([
    'italie_blanc', 'italie_blanc_001',
]);

const vertMeshes = new Set([
    'italie_vert', 'italie_vert_001',
]);

// ── Matériaux police ──────────────────────────────────────────────────────────
export const POLICE_COLOR = '#6BAABB';   // bleu cyan légèrement gris

export const policeMaterials = {
    stripeRed:  new THREE.MeshStandardMaterial({ color: 0xCC1111, roughness: 0.35, metalness: 0.10, emissive: new THREE.Color(0x220000) }),
    stripeBlue: new THREE.MeshStandardMaterial({ color: 0x1155DD, roughness: 0.35, metalness: 0.10, emissive: new THREE.Color(0x000022) }),
};

// Lazy-init : créés une seule fois au premier appel
let _policeDoorMat = null;
export function getPoliceDoorMaterial() {
    if (_policeDoorMat) return _policeDoorMat;
    const W = 512, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = POLICE_COLOR;
    ctx.fillRect(0, 0, W, H);
    // Ombre portée pour l'épaisseur
    ctx.font = 'bold 90px "Arial Black", Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,30,60,0.55)';
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.strokeText('POLICE', W / 2, H / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('POLICE', W / 2, H / 2);
    _policeDoorMat = new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(c), roughness: 0.35, metalness: 0.10,
    });
    return _policeDoorMat;
}

let _policeRoofMat = null;
export function getPoliceRoofMaterial() {
    if (_policeRoofMat) return _policeRoofMat;
    const W = 512, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    // Rectangle blanc central
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(108, 90, 296, 76);
    // Carré rouge gauche
    ctx.fillStyle = '#DD1111';
    ctx.fillRect(0, 68, 116, 120);
    // Carré bleu droit
    ctx.fillStyle = '#1155DD';
    ctx.fillRect(396, 68, 116, 120);
    _policeRoofMat = new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(c),
        roughness: 0.30, metalness: 0.05,
        transparent: true, depthWrite: false,
    });
    return _policeRoofMat;
}

export function getPoliceMaterialForMesh(name) {
    const n = name.toLowerCase();
    if (n === 'x_carrosserie_laterale_arriere') return policeMaterials.stripeRed;
    if (n === 'x_carrosserie_laterale_avant')   return policeMaterials.stripeBlue;
    // Portes et toit : gérés en décals 3D dans addGirophare (indépendants des UV)
    return null;
}

/**
 * Renvoie le matériau pour un mesh donné, ou null → appliquer carColor par défaut.
 * Retournent null (couleur joueur) : x_carrosserie_*, x_portiere_*, logo_*_topolino, serrure_*
 */
export function getMaterialForMesh(name) {
    const n = name.toLowerCase();
    if (n === 'bagage_001')                                             return materials.fabric;
    if (n === 'bagage' || n === 'bagage_sangles' || n === 'bagage_ceinture') return materials.leather;
    if (enjolivMeshes.has(n)) return materials.enjoliv;
    if (greyMeshes.has(n))    return materials.gris;
    if (darkMeshes.has(n))    return materials.grisFonce;
    if (toitMeshes.has(n))    return materials.toit;
    if (rougeMeshes.has(n))   return materials.rouge;
    if (vitreMeshes.has(n))   return materials.vitre;
    if (blancMeshes.has(n))   return materials.blanc;
    if (vertMeshes.has(n))    return materials.vert;
    return null;
}
