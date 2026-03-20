import { scene, camera, renderer, sun } from './scene.js';
import { updatePhysics } from './physics.js';
import { updateCamera, updateChaseCamera } from './camera.js';
import { updateTerrain, getHeightAt, refreshTerrain } from './terrain.js';
import { updateCollisions, updateEnvironmentCollisions } from './collisions.js';
import { players, initMultiplayer, getLocalPlayer, pollGamepads } from './multiplayer.js';
import { initUI, updateUI, setPlayerScore } from './ui.js';
import { initChaseRocks, collidables, bushes } from './rocks.js';

// ── Détection du mode ─────────────────────────────────────────────────────────
const MODE = new URLSearchParams(window.location.search).get('mode') ?? 'drive';

// ── Mode normal (conduite libre) ──────────────────────────────────────────────
async function startDriveMode() {
    initUI();
    await initMultiplayer();

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();
        pollGamepads();

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
            if (p.aura)   p.aura.update(p.car.position, now);
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
        pollGamepads();

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
            if (p.aura)   p.aura.update(p.car.position, now);
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
    
    refreshTerrain();
    initChaseRocks();

    const fpsDiv = document.getElementById('fps-counter');
    let lastTime = performance.now();
    let frames   = 0;

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();
        pollGamepads();
        
        // --- FPS ---
        frames++;
        if (now > lastTime + 1000) {
            const timeDiff = now - lastTime;
            if (fpsDiv) fpsDiv.innerText = 'FPS: ' + Math.round((frames * 1000) / timeDiff);
            lastTime = now;
            frames = 0;
        }

        for (const p of players.values()) {
            if (!p.car) continue;

            // --- Ralentissement Buissons ---
            let inBush = false;
            // Uniquement si on est au sol
            if (p.onGround) {
                for (const b of bushes) {
                    const dx = p.car.position.x - b.position.x;
                    const dz = p.car.position.z - b.position.z;
                    if (dx*dx + dz*dz < b.userData.radius * b.userData.radius) { inBush = true; break; }
                }
            }

            const terrainY = getHeightAt(p.car.position.x, p.car.position.z);
            updatePhysics(p, terrainY);
            if (inBush) p.carSpeed *= 0.93; // Freinage légèrement plus fort
        }

        updateCollisions(players);
        updateEnvironmentCollisions(players, collidables);

        for (const p of players.values()) {
            if (!p.car) continue;
            const terrainY = getHeightAt(p.car.position.x, p.car.position.z);
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, terrainY);
            if (p.tracks) p.tracks.update(p);
            if (p.aura)   p.aura.update(p.car.position, now);
            p.updateNameLabel();
            // Afficher le score de possession (secondes, 1 décimale)
            setPlayerScore(p.id, Math.floor(p.getLuggageScore()) + 's');
        }

        updateChaseCamera(players);

        const lp = getLocalPlayer();
        if (lp && lp.car) {
            const lx = lp.car.position.x;
            const lz = lp.car.position.z;
            updateTerrain(lz);
            sun.position.set(lx + 120, 80, lz + 60);
            sun.target.position.set(lx, 0, lz);
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
        pollGamepads();

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
        pollGamepads();

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
        pollGamepads();

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
            if (p.aura)   p.aura.update(p.car.position, now);
            p.updateNameLabel();
        }

        updateCamera(players);

        const lp = getLocalPlayer();
        if (lp && lp.car) {
            const lx = lp.car.position.x;
            const lz = lp.car.position.z;
            updateTerrain(lz);
            sun.position.set(lx + 120, 80, lz + 60);
            sun.target.position.set(lx, 0, lz);
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
        pollGamepads();

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
