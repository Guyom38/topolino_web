import { scene, camera, renderer, sun } from './scene.js';
import { updatePhysics } from './physics.js';
import { updateCamera } from './camera.js';
import { updateTerrain, getHeightAt } from './terrain.js';
import { updateCollisions } from './collisions.js';
import { players, initMultiplayer, getLocalPlayer } from './multiplayer.js';
import { initUI, updateUI } from './ui.js';

// ── Détection du mode ─────────────────────────────────────────────────────────
const MODE = new URLSearchParams(window.location.search).get('mode') ?? 'drive';

// ── Mode normal (conduite libre) ──────────────────────────────────────────────
async function startDriveMode() {
    initUI();
    await initMultiplayer();

    function animate() {
        requestAnimationFrame(animate);

        for (const p of players.values()) {
            if (!p.car) continue;
            updatePhysics(p, getHeightAt(p.car.position.x, p.car.position.z));
        }

        updateCollisions(players);

        for (const p of players.values()) {
            if (!p.car) continue;
            const terrainY = getHeightAt(p.car.position.x, p.car.position.z);
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, terrainY);
            if (p.tracks) p.tracks.update(p);
            p.updateNameLabel();
        }

        updateCamera(players);

        const lp = getLocalPlayer();
        if (lp && lp.car) {
            const lx = lp.car.position.x;
            const lz = lp.car.position.z;

            updateTerrain(lz);

            sun.position.set(lx + 90, 45, lz + 30);
            sun.target.position.set(lx, 0, lz);
            sun.target.updateMatrixWorld();
        }

        updateUI(players);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Mode parking ──────────────────────────────────────────────────────────────
async function startParkingMode() {
    const { initParkingMode, updateParkingMode, getParkingTerrainY, isParkingActive } =
        await import('./parking/ParkingMode.js');

    await initMultiplayer();
    await initParkingMode(players);

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();

        // Physique sur terrain plat
        const active = isParkingActive();
        for (const p of players.values()) {
            if (!p.car) continue;
            if (active) updatePhysics(p, getParkingTerrainY(), () => 0);
            // Les voitures sont figées quand la partie est terminée
        }

        if (active) updateCollisions(players);

        for (const p of players.values()) {
            if (!p.car) continue;
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, 0);
            if (p.tracks) p.tracks.update(p);
            p.updateNameLabel();
        }

        updateCamera(players);
        updateParkingMode(players, now);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Lancement ─────────────────────────────────────────────────────────────────
if (MODE === 'parking') {
    startParkingMode();
} else {
    startDriveMode();
}
