import { config } from './config.js';
import { getHeightAt } from './terrain.js';

const HALF_WB   = config.wheelBase / 2;
const HALF_TW   = 1.1;
const REST_H    = 0.0;   // 0 = roues au sol ; le rebond se fait autour de cette valeur
const STIFFNESS = 0.22;
const DAMPING   = 0.32;

// Positions des 4 roues en espace local (fwd > 0 = avant, side > 0 = droite)
const CORNERS = [
    {  fwd: HALF_WB, side: -HALF_TW },   // AV-G
    {  fwd: HALF_WB, side:  HALF_TW },   // AV-D
    { fwd: -HALF_WB, side: -HALF_TW },   // AR-G
    { fwd: -HALF_WB, side:  HALF_TW },   // AR-D
];

export function updateSuspension(p, getY = getHeightAt) {
    const { car, carAngle, onGround } = p;
    const sa = Math.sin(carAngle), ca = Math.cos(carAngle);

    // Hauteur terrain sous chaque roue
    const wh = CORNERS.map(c => {
        const wx = car.position.x + (-sa) * c.fwd + ca * c.side;
        const wz = car.position.z + (-ca) * c.fwd + (-sa) * c.side;
        return getY(wx, wz);
    });

    // Initialisation à chaud (par joueur, pas module-level)
    if (!p._suspInit) {
        for (let i = 0; i < 4; i++) { p.suspY[i] = wh[i] + REST_H; p.suspVel[i] = 0; }
        p._suspInit = true;
    }

    // Ressort-amortisseur par roue — cible = terrain sous la roue, toujours
    // (ne pas annuler le pitch en vol sinon la voiture s'aplatit sur les crêtes)
    for (let i = 0; i < 4; i++) {
        const target      = wh[i] + REST_H;
        const springForce = STIFFNESS * (target - p.suspY[i]);
        const damperForce = DAMPING   * p.suspVel[i];
        p.suspVel[i]     += springForce - damperForce;
        p.suspY[i]       += p.suspVel[i];
    }

    const bodyY  = (p.suspY[0] + p.suspY[1] + p.suspY[2] + p.suspY[3]) * 0.25;
    const frontY = (p.suspY[0] + p.suspY[1]) * 0.5;
    const rearY  = (p.suspY[2] + p.suspY[3]) * 0.5;
    const leftY  = (p.suspY[0] + p.suspY[2]) * 0.5;
    const rightY = (p.suspY[1] + p.suspY[3]) * 0.5;

    const pitch    = Math.atan2(frontY - rearY,  HALF_WB * 2);
    const suspRoll = Math.atan2(rightY - leftY,  HALF_TW * 2);
    const slope    = (frontY - rearY) / (HALF_WB * 2);

    return { bodyY, pitch, suspRoll, slope };
}
