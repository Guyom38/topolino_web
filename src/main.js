import { scene, camera, renderer, sun } from './scene.js';
import { updatePhysics } from './physics.js';
import { updateCamera, updateChaseCamera } from './camera.js';
import { updateTerrain, getHeightAt, refreshTerrain } from './terrain.js';
import { updateCollisions, updateEnvironmentCollisions } from './collisions.js';
import { players, initMultiplayer, getLocalPlayer, pollGamepads } from './multiplayer.js';
import { initUI, updateUI, setPlayerScore } from './ui.js';
import { initChaseRocks, collidables, bushes } from './rocks.js';
import { updateSparks } from './sparks.js';
import { updateSmoke }  from './smoke.js';
import { startMusic }   from './music.js';
import { updateOffscreenArrows, disposeOffscreenArrows } from './offscreen.js';
import { initTitleScene, disposeTitleScene } from './titleScene.js';

// ── Détection du mode ─────────────────────────────────────────────────────────
const MODE = new URLSearchParams(window.location.search).get('mode');

// ── Mode normal (conduite libre) ──────────────────────────────────────────────
async function startDriveMode() {
    initUI();
    startMusic();
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

        updateOffscreenArrows(players);
        updateSparks(now);
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
    startMusic();
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
        updateSparks(now);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Mode poursuite (bagage) ───────────────────────────────────────────────────
async function startChaseMode() {
    initUI();
    startMusic();
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

        updateSparks(now);
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
    startMusic();
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
    startMusic();
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
        updateSparks(now);
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
    startMusic();
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
        updateSparks(now);
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
    startMusic();
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
        updateSparks(now);
        updateUI(players);
        renderer.render(scene, camera);
    }
    animate();
}

// ── Mode Circuit (Micro Machines) ─────────────────────────────────────────────
async function startCircuitMode() {
    const { initCircuitMode, updateCircuitMode, updateCircuitCamera, isCircuitActive } =
        await import('./modes/CircuitMode.js');

    initUI();
    startMusic();
    await initMultiplayer();
    await initCircuitMode(players);

    let lastNow = performance.now();

    function animate() {
        requestAnimationFrame(animate);
        const now  = performance.now();
        const dt   = now - lastNow;
        lastNow    = now;
        pollGamepads();

        for (const p of players.values()) {
            if (!p.car) continue;
            if (isCircuitActive()) updatePhysics(p, 0, () => 0);
        }

        if (isCircuitActive()) updateCollisions(players);

        for (const p of players.values()) {
            if (!p.car) continue;
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, 0);
            if (p.tracks) p.tracks.update(p);
            p.updateNameLabel();
        }

        updateCircuitMode(players, now, dt);
        updateCircuitCamera(players);
        updateSparks(now);
        updateSmoke(now);
        updateUI(players);
        renderer.render(scene, camera);
    }
    animate();
}

// ── Lancement ─────────────────────────────────────────────────────────────────
const LABELS_MAP = {
    drive:'🏔 Conduite Libre', circuit:'🏁 Circuit',
    chase:'🧳 Poursuite',      parking:'🅿 Parking',
    tron:'🌀 Tron',            derby:'💥 Derby',
    battle:'🎈 Battle',        foot:'⚽ Football',
};

function _launchMode(mode) {
    if (mode === 'parking')      startParkingMode();
    else if (mode === 'chase')   startChaseMode();
    else if (mode === 'tron')    startTronMode();
    else if (mode === 'derby')   startDerbyMode();
    else if (mode === 'battle')  startBattleMode();
    else if (mode === 'foot')    startFootMode();
    else if (mode === 'circuit') startCircuitMode();
    else if (mode === 'drive')   startDriveMode();
}

// Exposé pour démarrage depuis le menu SANS rechargement de page
// (conserve le geste utilisateur → autoplay audio garanti)
window._startGameMode = function(mode) {
    disposeTitleScene(); // arrêter l'animation du titre
    // Attacher le canvas du renderer si on démarre depuis le menu (pas de ?mode au chargement)
    if (!document.body.contains(renderer.domElement)) {
        document.body.appendChild(renderer.domElement);
    }
    const lbl = document.getElementById('mode-label');
    if (lbl) lbl.textContent = LABELS_MAP[mode] || mode;
    document.getElementById('game-ui')?.classList.remove('hidden');
    _launchMode(mode);
};

// Démarrage direct (F5 / lien avec ?mode=xxx)
if (MODE) {
    document.getElementById('game-ui')?.classList.remove('hidden');
    _launchMode(MODE);
} else {
    // Page de titre → lancer les Topolino 3D en arrière-plan
    initTitleScene();
}
