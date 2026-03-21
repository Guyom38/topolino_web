import * as THREE from 'three';
import { config } from './config.js';
import { getSlopeGrip } from './terrain.js';
import { updateSuspension } from './suspension.js';

const VEHICULE_FUTUR = false;

const _AX = new THREE.Vector3(1, 0, 0);
const _AY = new THREE.Vector3(0, 1, 0);
const _AZ = new THREE.Vector3(0, 0, 1);
const _qSteer = new THREE.Quaternion();
const _qSpin  = new THREE.Quaternion();

export function updatePhysics(p, terrainY, getY = undefined) {
    const { keys } = p;

    // --- Braquage ---
    const speedFactor = Math.max(0.4, 1 - (Math.abs(p.carSpeed) / config.maxSpeed) * 0.7);
    const targetSteer = (keys.jx !== undefined)
        ? -THREE.MathUtils.clamp(keys.jx, -1, 1)
        : (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    p.steeringAngle = THREE.MathUtils.lerp(
        p.steeringAngle,
        targetSteer * config.steeringLimit * speedFactor,
        config.steeringSpeed
    );

    // --- Suspension ---
    const { bodyY, pitch, suspRoll, slope } = updateSuspension(p, getY);

    // --- Vitesse + pente ---
    if (keys.up)        p.carSpeed += config.acceleration;
    else if (keys.down) p.carSpeed -= config.braking;
    else                p.carSpeed *= config.deceleration;

    p.carSpeed -= slope * config.slopeStrength;
    p.carSpeed  = THREE.MathUtils.clamp(p.carSpeed, -config.maxSpeed / 2, config.maxSpeed);

    // --- Ratio vitesse (utilisé pour drift & steering) ---
    const speedRatio     = Math.abs(p.carSpeed) / config.maxSpeed;
    // Dérapage naturel à haute vitesse (la perte de grip augmente avec v²)
    const speedDrift     = speedRatio * speedRatio * 0.32;
    // Facteur virage : moins d'adhérence dans les virages pris vite
    const cornerFactor   = Math.abs(p.steeringAngle) * speedRatio * speedRatio;
    // Frein à main : quasi zéro grip, d'autant moins que la vitesse est élevée
    const handbrakeMod   = keys.handbrake ? Math.max(0.04, 0.18 - speedRatio * 0.12) : 1.0;
    const slopeGrip      = p.onGround ? getSlopeGrip(p.car.position.x, p.car.position.z) : 1.0;

    const actualGrip = THREE.MathUtils.clamp(
        (config.grip - speedDrift - cornerFactor * 0.42) * slopeGrip * handbrakeMod,
        keys.handbrake ? 0.04 : 0.42, 1.0
    );

    // --- Frein à main : conserve la vitesse, la voiture glisse ---
    if (keys.handbrake) {
        p.carSpeed *= 0.94; // freinage doux → glisse
    }

    // --- Modèle bicycle + contre-braquage bonus en dérapage ---
    if (Math.abs(p.carSpeed) > 0.01) {
        // Plus on dérape, plus le volant est efficace (contre-braquage naturel)
        const driftBoost = (1.0 - actualGrip) * 0.55;
        p.carAngle += (p.carSpeed * p.steeringAngle * (1.0 + driftBoost)) / config.wheelBase;
    }

    // --- Drift : interpolation de la vélocité vers la direction du nez ---
    const fwdX      = -Math.sin(p.carAngle);
    const fwdZ      = -Math.cos(p.carAngle);
    const targetVel = new THREE.Vector3(fwdX * p.carSpeed, 0, fwdZ * p.carSpeed);
    p.velocity.lerp(targetVel, actualGrip);

    // --- Déplacement horizontal ---
    p.car.position.x += p.velocity.x;
    p.car.position.z += p.velocity.z;
    p.car.rotation.y  = p.carAngle;

    // --- Physique verticale ---
    // Mesurer la montée réelle du terrain depuis la frame précédente
    const prevTerrainY = p._prevTerrainY ?? terrainY;
    const terrainRise  = terrainY - prevTerrainY;  // > 0 = montée, < 0 = descente
    p._prevTerrainY    = terrainY;

    p.verticalVelocity -= config.gravity;
    p.car.position.y   += p.verticalVelocity;

    const isChase  = new URLSearchParams(window.location.search).get('mode') === 'chase';
    const limit    = 50.0;
    const isInside = !isChase || (Math.abs(p.car.position.x) <= limit && Math.abs(p.car.position.z) <= limit);

    if (isInside && p.car.position.y <= terrainY) {
        p.car.position.y = terrainY;
        if (terrainRise > 0) {
            // Montée : injecter la vitesse verticale réelle de la pente
            // La voiture prend de l'élan et décolle naturellement au sommet
            p.verticalVelocity = terrainRise;
        } else {
            p.verticalVelocity = 0;
        }
        p.onGround = true;
    } else {
        p.onGround = false;
    }

    // --- Roulement des roues ---
    const spinDelta = p.carSpeed * 50;

    if (VEHICULE_FUTUR) {
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
            w.quaternion.multiplyQuaternions(w._initQuat, _qSpin);
            if (w._steerPivot) w._steerPivot.rotation.y = p.steeringAngle * 1.5;
        });
    }

    // --- Corps visuel : suspension + déport vitesse + drift ---
    const rgtX        = Math.cos(p.carAngle), rgtZ = -Math.sin(p.carAngle);
    const lateralVel  = p.velocity.x * rgtX + p.velocity.z * rgtZ;
    // Roulis plus prononcé quand on dérape
    const driftRoll   = THREE.MathUtils.clamp(-lateralVel * 7.0, -0.30, 0.30);
    const speedDeport = -p.steeringAngle * speedRatio * speedRatio * 0.40;

    p.carVisual.position.y = bodyY - p.car.position.y;
    p.carVisual.rotation.x = THREE.MathUtils.lerp(p.carVisual.rotation.x, pitch, 0.35);
    p.carVisual.rotation.z = THREE.MathUtils.lerp(p.carVisual.rotation.z,
        THREE.MathUtils.clamp(driftRoll + speedDeport + suspRoll, -0.60, 0.60), 0.22);

    return { speedRatio };
}
