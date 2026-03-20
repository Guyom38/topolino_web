# Topolino — Notes techniques

## Mode véhicule futur (vol / hover)

Quand `VEHICULE_FUTUR = true` dans `physics.js`, les roues avant utilisent
une composition quaternion correcte **qSteer × qSpin** au lieu de l'assignation
Euler simple. Cette orientation donne un effet "rotor" réaliste pour un véhicule
volant : les roues s'orientent librement dans les 3 axes sans conflit Euler/quaternion.

### Principe

```js
// Pré-alloués (module level)
const _AX = new THREE.Vector3(1, 0, 0);
const _AY = new THREE.Vector3(0, 1, 0);
const _AZ = new THREE.Vector3(0, 0, 1);
const _qSteer = new THREE.Quaternion();
const _qSpin  = new THREE.Quaternion();

// Roues arrière — spin pur
w._spin = (w._spin || 0) + spinDelta;
const ax = w._axis === 'x' ? _AX : w._axis === 'y' ? _AY : _AZ;
w.quaternion.setFromAxisAngle(ax, w._spin);

// Roues avant — braquage composé avec spin
_qSteer.setFromAxisAngle(_AY, steerAngle);   // orientation
_qSpin.setFromAxisAngle(ax, w._spin);         // rotation propre
w.quaternion.multiplyQuaternions(_qSteer, _qSpin);
```

### Pourquoi ce n'est pas l'axe correct pour la Topolino

Dans le FBX topolino_low49k.fbx, les roues ont des parents intermédiaires
avec des rotations propres (rotation exportée par le modeleur). L'axe Y local
du mesh roue n'est pas l'axe vertical du monde — donc `setFromAxisAngle(_AY, steer)`
ne produit pas un braquage visuel correct sur ce modèle spécifique.

Pour un véhicule futur créé nativement pour ce système (roues alignées monde),
cette approche est la bonne.

### Activation

Dans `src/physics.js`, passer `VEHICULE_FUTUR = true` pour basculer.
