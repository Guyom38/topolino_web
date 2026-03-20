// ── Calcul du score de stationnement ─────────────────────────────────────────
import * as THREE from 'three';
import { SPOTS, SPOT_HW, SPOT_HD } from './ParkingSpots.js';

/**
 * Retourne le meilleur score pour un joueur selon sa position finale.
 * @param {Object} player — PlayerCar
 * @returns {{ spot, positionScore, angleScore, total, details } | null}
 */
export function scorePlayer(player) {
    if (!player.car) return null;

    const px     = player.car.position.x;
    const pz     = player.car.position.z;
    const pAngle = player.carAngle;

    let best = null;

    for (const spot of SPOTS) {
        if (!spot.empty) continue;

        // Transformer la position de la voiture dans le repère local de la place
        const dx = px - spot.x;
        const dz = pz - spot.z;

        const cos    = Math.cos(-spot.angle);
        const sin    = Math.sin(-spot.angle);
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;

        // Si l'axe avant du spot est sur X (angle ≈ ±PI/2), localX = offset Z-monde
        // et localZ = offset X-monde → inverser HW/HD
        const fwdIsX = Math.abs(Math.sin(spot.angle)) > 0.5;
        const hw = fwdIsX ? SPOT_HD : SPOT_HW;
        const hd = fwdIsX ? SPOT_HW : SPOT_HD;

        // Vérifier que la voiture est dans les limites (tolérance 180%)
        const insideX = Math.abs(localX) < hw * 1.8;
        const insideZ = Math.abs(localZ) < hd * 1.8;
        if (!insideX || !insideZ) continue;

        // Précision de position (0 = centre parfait, 1 = bord)
        const posErr       = Math.sqrt((localX / hw) ** 2 + (localZ / hd) ** 2);
        const positionScore = Math.max(0, 1 - posErr) * 50;

        // Précision d'angle : comparaison avec l'angle de la place (marche arrière autorisée)
        let angleDiff = Math.abs(((pAngle - spot.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        // Autoriser un décalage de 180° (marche arrière)
        const angleDiff2 = Math.abs(angleDiff - Math.PI);
        const bestAngle  = Math.min(angleDiff, angleDiff2);
        const angleScore = Math.max(0, 1 - bestAngle / (Math.PI / 4)) * 30;

        const total = spot.baseScore + positionScore + angleScore;

        if (!best || total > best.total) {
            best = {
                spot,
                positionScore: Math.round(positionScore),
                angleScore:    Math.round(angleScore),
                total:         Math.round(total),
            };
        }
    }

    // Pénalités
    const dmgPenalty      = (player.hitCount       ?? 0) * 25;  // 25 pts / collision
    const wrongWayPenalty = (player._wrongWayPenalty ?? 0) * 15; // 15 pts / seconde de contresens
    if (best) best.total = Math.max(0, best.total - dmgPenalty - wrongWayPenalty);

    return best || { spot: null, positionScore: 0, angleScore: 0, total: 0 };
}
