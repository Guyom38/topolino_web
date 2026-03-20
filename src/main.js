import { scene, camera, renderer, sun } from './scene.js';
import { updatePhysics } from './physics.js';
import { updateCamera } from './camera.js';
import { updateTerrain, getHeightAt } from './terrain.js';
import { updateCollisions } from './collisions.js';
import { players, initMultiplayer, getLocalPlayer } from './multiplayer.js';
import { initUI, updateUI, setPlayerScore } from './ui.js';

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
    const { initParkingMode, updateParkingMode, getParkingTerrainY, isParkingActive, getStaticCars } =
        await import('./parking/ParkingMode.js');

    initUI();
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

        if (active) updateCollisions(players, getStaticCars());

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

// ── Mode poursuite (bagage) ───────────────────────────────────────────────────
async function startChaseMode() {
    initUI();
    await initMultiplayer();

    // Le joueur local démarre avec le bagage (déjà fait dans initMultiplayer)

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
            // Afficher le score de possession (secondes, 1 décimale)
            setPlayerScore(p.id, Math.floor(p.getLuggageScore()) + 's');
        }

        updateCamera(players);

        const lp = getLocalPlayer();
        if (lp && lp.car) {
            updateTerrain(lp.car.position.z);
            sun.position.set(lp.car.position.x + 90, 45, lp.car.position.z + 30);
            sun.target.position.set(lp.car.position.x, 0, lp.car.position.z);
            sun.target.updateMatrixWorld();
        }

        updateUI(players);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Mode Tron ─────────────────────────────────────────────────────────────────
async function startTronMode() {
    const { initTronMode, updateTronMode, disposeTronMode } =
        await import('./modes/TronMode.js');

    initUI();
    await initMultiplayer();
    await initTronMode(players);

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();

        for (const p of players.values()) {
            if (!p.car) continue;
            updatePhysics(p, 0, () => 0);
        }

        // Pas de collisions inter-joueurs en Tron (les traces font office de murs)
        updateTronMode(players, now);

        for (const p of players.values()) {
            if (!p.car) continue;
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, 0);
            p.updateNameLabel();
        }

        updateCamera(players);
        updateUI(players);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Mode Derby ─────────────────────────────────────────────────────────────────
async function startDerbyMode() {
    const { initDerbyMode, updateDerbyMode, isDerbyActive } =
        await import('./modes/DerbyMode.js');

    initUI();
    await initMultiplayer();
    await initDerbyMode(players);

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();

        if (isDerbyActive()) {
            for (const p of players.values()) {
                if (!p.car) continue;
                updatePhysics(p, 0, () => 0);
            }
            updateCollisions(players, [], 2.5);
        }

        updateDerbyMode(players, now);

        for (const p of players.values()) {
            if (!p.car) continue;
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, 0);
            p.updateNameLabel();
        }

        updateCamera(players);
        updateUI(players);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Mode Battle ────────────────────────────────────────────────────────────────
async function startBattleMode() {
    const { initBattleMode, updateBattleMode, isBattleActive } =
        await import('./modes/BattleMode.js');

    initUI();
    await initMultiplayer();
    await initBattleMode(players);

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();

        for (const p of players.values()) {
            if (!p.car) continue;
            updatePhysics(p, getHeightAt(p.car.position.x, p.car.position.z));
        }

        if (isBattleActive()) updateCollisions(players);

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
            updateTerrain(lp.car.position.z);
            sun.position.set(lp.car.position.x + 90, 45, lp.car.position.z + 30);
            sun.target.position.set(lp.car.position.x, 0, lp.car.position.z);
            sun.target.updateMatrixWorld();
        }

        updateBattleMode(players, now);
        updateUI(players);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Mode Football ──────────────────────────────────────────────────────────────
async function startFootMode() {
    const { initFootMode, updateFootMode } =
        await import('./modes/FootMode.js');

    initUI();
    await initMultiplayer();
    await initFootMode(players);

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();

        for (const p of players.values()) {
            if (!p.car) continue;
            updatePhysics(p, 0, () => 0);
        }

        updateCollisions(players);
        updateFootMode(players, now);

        for (const p of players.values()) {
            if (!p.car) continue;
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, 0);
            p.updateNameLabel();
        }

        updateCamera(players);
        updateUI(players);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Lancement ─────────────────────────────────────────────────────────────────
if      (MODE === 'parking') startParkingMode();
else if (MODE === 'chase')   startChaseMode();
else if (MODE === 'tron')    startTronMode();
else if (MODE === 'derby')   startDerbyMode();
else if (MODE === 'battle')  startBattleMode();
else if (MODE === 'foot')    startFootMode();
else                         startDriveMode();
