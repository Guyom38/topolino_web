import { COLLISION_RADIUS } from './PlayerCar.js';

const DIAM        = COLLISION_RADIUS * 2;
const RESTITUTION = 0.92;   // rebond très nerveux
const SPIN_FACTOR = 4.5;    // spin angulaire fort sur impact latéral

export function updateCollisions(players) {
    const list = Array.from(players.values()).filter(p => p.car);

    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];

            const dx   = b.car.position.x - a.car.position.x;
            const dz   = b.car.position.z - a.car.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist >= DIAM || dist < 0.01) continue;

            // ── Normale de collision (A → B) ─────────────────────────────────
            const nx      = dx / dist, nz = dz / dist;

            // ── Dépénétration ────────────────────────────────────────────────
            const overlap = (DIAM - dist) * 0.5;
            a.car.position.x -= nx * overlap;
            a.car.position.z -= nz * overlap;
            b.car.position.x += nx * overlap;
            b.car.position.z += nz * overlap;

            // ── Échange de vitesse (impulsion normale) ───────────────────────
            const aVn  = a.velocity.x * nx + a.velocity.z * nz;
            const bVn  = b.velocity.x * nx + b.velocity.z * nz;
            const relV = aVn - bVn;

            if (relV > 0) {
                const imp = relV * RESTITUTION;
                a.velocity.x -= imp * nx;  a.velocity.z -= imp * nz;
                b.velocity.x += imp * nx;  b.velocity.z += imp * nz;

                // ── Spin angulaire selon la composante latérale de l'impact ──
                // Si la collision touche le flanc plutôt que le nez, la voiture tourne
                const aLat = nx *  Math.cos(a.carAngle) - nz * Math.sin(a.carAngle);
                const bLat = nx *  Math.cos(b.carAngle) - nz * Math.sin(b.carAngle);
                a.carAngle -= aLat * imp * SPIN_FACTOR;
                b.carAngle += bLat * imp * SPIN_FACTOR;
            }

            // ── Secousse verticale (la voiture encaisse) ─────────────────────
            const jolt = relV * 0.08;
            a.verticalVelocity += jolt;
            b.verticalVelocity += jolt;

            // ── Resynchronisation carSpeed ← nouvelle vélocité ───────────────
            // Sans ça, le modèle physique re-cible la vitesse d'avant la collision
            // et annule l'impulsion au frame suivant
            const afwdX = -Math.sin(a.carAngle), afwdZ = -Math.cos(a.carAngle);
            const bfwdX = -Math.sin(b.carAngle), bfwdZ = -Math.cos(b.carAngle);
            a.carSpeed = a.velocity.x * afwdX + a.velocity.z * afwdZ;
            b.carSpeed = b.velocity.x * bfwdX + b.velocity.z * bfwdZ;

            // ── Comptage du choc ─────────────────────────────────────────────
            a.onHit();
            b.onHit();
        }
    }
}
