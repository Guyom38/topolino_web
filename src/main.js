import { scene, camera, renderer, sun } from './scene.js';
import { updatePhysics } from './physics.js';
import { updateCamera } from './camera.js';
import { updateTerrain, getHeightAt } from './terrain.js';
import { updateCollisions } from './collisions.js';
import { players, initMultiplayer, getLocalPlayer } from './multiplayer.js';
import { initUI, updateUI } from './ui.js';

initUI();
initMultiplayer();

function animate() {
    requestAnimationFrame(animate);

    // ── Physique de tous les joueurs ──────────────────────────────────────────
    for (const p of players.values()) {
        if (!p.car) continue;
        updatePhysics(p, getHeightAt(p.car.position.x, p.car.position.z));
    }

    // ── Collisions (avant le blink pour qu'il soit actif dès ce frame) ───────
    updateCollisions(players);

    // ── Visuels post-collision ────────────────────────────────────────────────
    for (const p of players.values()) {
        if (!p.car) continue;
        const terrainY = getHeightAt(p.car.position.x, p.car.position.z);
        if (p.shadow) p.shadow.update(p.car.position, p.carAngle, terrainY);
        if (p.tracks) p.tracks.update(p);
        p.updateNameLabel();
    }

    // ── Caméra (suit l'ensemble des joueurs) ─────────────────────────────────
    updateCamera(players);

    // ── Terrain + soleil (centrés sur le joueur local) ───────────────────────
    const lp = getLocalPlayer();
    if (lp && lp.car) {
        const lx = lp.car.position.x;
        const lz = lp.car.position.z;

        updateTerrain(lz);

        sun.position.set(lx + 90, 45, lz + 30);
        sun.target.position.set(lx, 0, lz);
        sun.target.updateMatrixWorld();
    }

    // ── UI scoreboard ─────────────────────────────────────────────────────────
    updateUI(players);

    renderer.render(scene, camera);
}

animate();
