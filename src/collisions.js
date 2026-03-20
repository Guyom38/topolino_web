import { COLLISION_RADIUS } from './PlayerCar.js';

const DIAM        = COLLISION_RADIUS * 2;
const RESTITUTION = 0.92;   // rebond très nerveux
const SPIN_FACTOR = 4.5;    // spin angulaire fort sur impact latéral

export function updateCollisions(players, staticCars = [], restitutionMult = 1.0) {
    const list = Array.from(players.values()).filter(p => p.car);

    // 1. Collisions entre joueurs
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
                const imp = relV * RESTITUTION * restitutionMult;
                a.velocity.x -= imp * nx;  a.velocity.z -= imp * nz;
                b.velocity.x += imp * nx;  b.velocity.z += imp * nz;

                // ── Spin angulaire selon la composante latérale de l'impact ──
                const aLat = nx *  Math.cos(a.carAngle) - nz * Math.sin(a.carAngle);
                const bLat = nx *  Math.cos(b.carAngle) - nz * Math.sin(b.carAngle);
                a.carAngle -= aLat * imp * SPIN_FACTOR;
                b.carAngle += bLat * imp * SPIN_FACTOR;
            }

            // ── Secousse verticale ─────────────────────
            const jolt = relV * 0.08;
            a.verticalVelocity += jolt;
            b.verticalVelocity += jolt;

            // ── Resynchronisation carSpeed ← nouvelle vélocité ───────────────
            const afwdX = -Math.sin(a.carAngle), afwdZ = -Math.cos(a.carAngle);
            const bfwdX = -Math.sin(b.carAngle), bfwdZ = -Math.cos(b.carAngle);
            a.carSpeed = a.velocity.x * afwdX + a.velocity.z * afwdZ;
            b.carSpeed = b.velocity.x * bfwdX + b.velocity.z * bfwdZ;

            // ── Vol de bagage (Police / Voleur) ───────────────────────────────
            const now = performance.now();
            if (a.hasLuggage && !b.hasLuggage && now > b.invincibleUntil && now > a.invincibleUntil) {
                a.setLuggage(false);
                b.setLuggage(true);
                b.onHitOther();
            } else if (b.hasLuggage && !a.hasLuggage && now > a.invincibleUntil && now > b.invincibleUntil) {
                b.setLuggage(false);
                a.setLuggage(true);
                a.onHitOther();
            } else if (relV > 0) {
                // Pas de vol de bagage — le plus rapide "attaque"
                a.onHitOther();
            }

            // ── Comptage du choc ─────────────────────────────────────────────
            a.onHit();
            b.onHit();
        }
    }

    // 2. Collisions avec les voitures statiques (obstacle infini)
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = 0; j < staticCars.length; j++) {
            const sc = staticCars[j];

            const dx = sc.position.x - a.car.position.x;
            const dz = sc.position.z - a.car.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist >= DIAM || dist < 0.01) continue;

            // ── Normale de collision (A → SC) ─────────────────────────────────
            const nx = dx / dist, nz = dz / dist;

            // ── Dépénétration totale (seul le joueur bouge) ───────────────────
            const overlap = DIAM - dist;
            a.car.position.x -= nx * overlap;
            a.car.position.z -= nz * overlap;

            // ── Échange de vitesse (sc a V=0) ───────────────────────
            const aVn = a.velocity.x * nx + a.velocity.z * nz;
            
            if (aVn > 0) {
                const imp = aVn * (1 + RESTITUTION); // impulsion rebond fixe
                a.velocity.x -= imp * nx;
                a.velocity.z -= imp * nz;

                const aLat = nx * Math.cos(a.carAngle) - nz * Math.sin(a.carAngle);
                a.carAngle -= aLat * imp * SPIN_FACTOR * 0.5;
            }

            const jolt = aVn * 0.08;
            a.verticalVelocity += jolt;

            const afwdX = -Math.sin(a.carAngle), afwdZ = -Math.cos(a.carAngle);
            a.carSpeed = a.velocity.x * afwdX + a.velocity.z * afwdZ;

            a.onHit();
        }
    }
}
