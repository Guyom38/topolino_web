import * as THREE from 'three';

export const state = {
    car: null,
    carVisual: new THREE.Group(),
    carSpeed: 0,
    carAngle: 0,
    steeringAngle: 0,
    velocity: new THREE.Vector3(),
    wheelsFront: [],
    wheelsRear: [],
    keys: { up: false, down: false, left: false, right: false },
    verticalVelocity: 0,
    onGround: true,
    suspY:   [0, 0, 0, 0],   // position ressort par roue (AV-G, AV-D, AR-G, AR-D)
    suspVel: [0, 0, 0, 0],   // vitesse ressort par roue
};
