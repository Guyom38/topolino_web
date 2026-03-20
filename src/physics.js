import * as THREE from 'three';
import { config } from './config.js';
import { getSlopeGrip } from './terrain.js';
import { updateSuspension } from './suspension.js';

// ── Mode véhicule futur ───────────────────────────────────────────────────────
// true  → composition quaternion qSteer×qSpin (roues alignées monde, cf. README)
// false → rotation.y simple (correct pour le FBX Topolino avec parents intermédiaires)
const VEHICULE_FUTUR = false;

// Pré-alloués (utilisés uniquement si VEHICULE_FUTUR = true)
const _AX = new THREE.Vector3(1, 0, 0);
const _AY = new THREE.Vector3(0, 1, 0);
const _AZ = new THREE.Vector3(0, 0, 1);
const _qSteer = new THREE.Quaternion();
const _qSpin  = new THREE.Quaternion();

export function updatePhysics(p, terrainY, getY = undefined) {
    const { keys } = p;

    // --- Braquage ---
    const speedFactor = Math.max(0.4, 1 - (Math.abs(p.carSpeed) / config.maxSpeed) * 0.7);
    // Analogique (joystick mobile) ou binaire (clavier)
    const targetSteer = (keys.jx !== undefined)
        ? -THREE.MathUtils.clamp(keys.jx, -1, 1)
        : (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    p.steeringAngle = THREE.MathUtils.lerp(
        p.steeringAngle,
        targetSteer * config.steeringLimit * speedFactor,
        config.steeringSpeed
    );
    // (braquage composé avec le spin plus bas — pas d'assignation Euler ici)

    // --- Suspension (avant physique car on a besoin de slope) ---
    const { bodyY, pitch, suspRoll, slope } = updateSuspension(p, getY);

    // --- Vitesse + pente ---
    if (keys.up)        p.carSpeed += config.acceleration;
    else if (keys.down) p.carSpeed -= config.braking;
    else                p.carSpeed *= config.deceleration;

    p.carSpeed -= slope * config.slopeStrength;
    p.carSpeed  = THREE.MathUtils.clamp(p.carSpeed, -config.maxSpeed / 2, config.maxSpeed);

    // --- Modèle bicycle ---
    if (Math.abs(p.carSpeed) > 0.01) {
        p.carAngle += (p.carSpeed * p.steeringAngle * (p.carSpeed > 0 ? 1 : -1)) / config.wheelBase;
    }

    // --- Frein à main ---
    if (keys.handbrake) {
        p.carSpeed *= 0.82; // friction forte
    }

    // --- Drift / grip ---
    const fwdX         = -Math.sin(p.carAngle);
    const fwdZ         = -Math.cos(p.carAngle);
    const slopeGrip    = p.onGround ? getSlopeGrip(p.car.position.x, p.car.position.z) : 1.0;
    const targetVel    = new THREE.Vector3(fwdX * p.carSpeed, 0, fwdZ * p.carSpeed);
    const speedRatio   = Math.abs(p.carSpeed) / config.maxSpeed;
    const cornerFactor = Math.abs(p.steeringAngle) * speedRatio * speedRatio;
    const handbrakeMod = keys.handbrake ? 0.25 : 1.0; // perte d'adhérence = drift
    const actualGrip   = THREE.MathUtils.clamp(
        (config.grip - Math.abs(p.carSpeed) * 0.10 - cornerFactor * 0.38) * slopeGrip * handbrakeMod,
        keys.handbrake ? 0.08 : 0.55, 1.0
    );
    p.velocity.lerp(targetVel, actualGrip);

    // --- Déplacement horizontal ---
    p.car.position.x += p.velocity.x;
    p.car.position.z += p.velocity.z;
    p.car.rotation.y  = p.carAngle;

    // --- Physique verticale ---
    p.verticalVelocity -= config.gravity;
    p.car.position.y   += p.verticalVelocity;

    if (p.car.position.y <= terrainY) {
        p.car.position.y   = terrainY;
        p.verticalVelocity = 0;
        p.onGround         = true;
    } else {
        p.onGround = false;
    }

    // --- Roulement des roues ---
    const spinDelta = p.carSpeed * 50;

    if (VEHICULE_FUTUR) {
        // Composition quaternion qSteer × qSpin (cf. README — véhicule futur)
        const steerAngle = p.steeringAngle * 1.8;
        p.wheelsRear.forEach(w => {
            w._spin = (w._spin || 0) + spinDelta;
            const ax = w._axis === 'x' ? _AX : w._axis === 'y' ? _AY : _AZ;
            w.quaternion.setFromAxisAngle(ax, w._spin);
        });
        _qSteer.setFromAxisAngle(_AY, steerAngle);
        p.wheelsFront.forEach(w => {
            w._spin = (w._spin || 0) + spinDelta;
            const ax = w._axis === 'x' ? _AX : w._axis === 'y' ? _AY : _AZ;
            _qSpin.setFromAxisAngle(ax, w._spin);
            w.quaternion.multiplyQuaternions(_qSteer, _qSpin);
        });
    } else {
        // Mode Topolino FBX
        // On part TOUJOURS de _initQuat (orientation baked FBX) pour ne pas aplatir la roue,
        // puis on compose le spin par-dessus, et le braquage en pré-multiplication (espace parent)
        p.wheelsRear.forEach(w => {
            if (!w._initQuat) w._initQuat = w.quaternion.clone();
            w._spin = (w._spin || 0) + spinDelta;
            const ax = w._axis === 'x' ? _AX : w._axis === 'y' ? _AY : _AZ;
            _qSpin.setFromAxisAngle(ax, w._spin);
            w.quaternion.multiplyQuaternions(w._initQuat, _qSpin);
        });

        p.wheelsFront.forEach(w => {
            if (!w._initQuat) w._initQuat = w.quaternion.clone();
            w._spin = (w._spin || 0) + spinDelta;
            const ax = w._axis === 'x' ? _AX : w._axis === 'y' ? _AY : _AZ;
            _qSpin.setFromAxisAngle(ax, w._spin);
            // Spin sur le mesh (initQuat préserve l'orientation FBX baked)
            w.quaternion.multiplyQuaternions(w._initQuat, _qSpin);
            // Braquage sur le pivot créé au chargement (rotation.y = vertical monde)
            if (w._steerPivot) w._steerPivot.rotation.y = p.steeringAngle * 1.5;
        });
    }

    // --- Corps visuel : suspension + déport vitesse + drift ---
    const rgtX       = Math.cos(p.carAngle), rgtZ = -Math.sin(p.carAngle);
    const lateralVel = p.velocity.x * rgtX + p.velocity.z * rgtZ;
    const driftRoll  = THREE.MathUtils.clamp(-lateralVel * 5.5, -0.22, 0.22);
    // Déport centrifuge : inclinaison dans le virage proportionnelle à vitesse²
    const speedDeport = -p.steeringAngle * speedRatio * speedRatio * 0.40;

    p.carVisual.position.y = bodyY - p.car.position.y;
    p.carVisual.rotation.x = THREE.MathUtils.lerp(p.carVisual.rotation.x, pitch,    0.35);
    p.carVisual.rotation.z = THREE.MathUtils.lerp(p.carVisual.rotation.z,
        THREE.MathUtils.clamp(driftRoll + speedDeport + suspRoll, -0.55, 0.55), 0.25);

    return { speedRatio };
}
