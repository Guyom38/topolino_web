import { loadSettings, applyAllSettings, settings, scheduleFrame } from './settings.js';
import { initSettingsUI } from './settingsUI.js';
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
import { startTitleMusic, startRandomRadio, stopMusic } from './audio.js';
import { updateOffscreenArrows, disposeOffscreenArrows } from './offscreen.js';
import { initTitleScene, disposeTitleScene } from './titleScene.js';

// ── Settings ──────────────────────────────────────────────────────────────────
loadSettings();
applyAllSettings();
initSettingsUI();

// ── Détection du mode ─────────────────────────────────────────────────────────
const MODE = new URLSearchParams(window.location.search).get('mode');

// Vrai dès qu'au moins une voiture est présente dans la partie
function _anyCarReady() {
    return Array.from(players.values()).some(p => p.car);
}

// ── FPS counter global ──────────────────────────────────────────────────────
const _fpsDiv = document.getElementById('fps-counter');
let _fpsTime = 0, _fpsFrames = 0;
function _updateFps() {
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsTime > 1000) {
        if (_fpsDiv) _fpsDiv.textContent = 'FPS: ' + Math.round(_fpsFrames * 1000 / (now - _fpsTime));
        _fpsTime = now;
        _fpsFrames = 0;
    }
}

// ── Frame limiter — délégué à settings.js (scheduleFrame) ───────────────────
const _scheduleFrame = scheduleFrame;

// ── Mode normal (conduite libre) ──────────────────────────────────────────────
async function startDriveMode(shouldRun) {
    initUI();
    startRandomRadio();
    await initMultiplayer();
    updateTerrain(0); // initialiser les patches dès le départ (spawn différé)

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now = performance.now();
        _updateFps();
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
async function startParkingMode(shouldRun) {
    const { initParkingMode, updateParkingMode, getParkingTerrainY, isParkingActive, getStaticCars } =
        await import('./parking/ParkingMode.js');

    initUI();
    startRandomRadio();
    await initMultiplayer();
    await initParkingMode(players);

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now = performance.now();
        _updateFps();
        pollGamepads();

        // Physique sur terrain plat
        const active = isParkingActive();
        for (const p of players.values()) {
            if (!p.car) continue;
            if (active) {
                updatePhysics(p, getParkingTerrainY(), () => 0);
                p.carSpeed *= 0.90;                           // inertie réduite en parking
                if (p.carSpeed >  0.26) p.carSpeed =  0.26;  // marche avant max parking
                if (p.carSpeed < -0.12) p.carSpeed = -0.12;  // marche arrière max parking
            }
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
        if (_anyCarReady()) updateParkingMode(players, now);
        updateSparks(now);
        updateUI(players);
        renderer.render(scene, camera);
    }

    animate();
}

// ── Mode poursuite (bagage) ───────────────────────────────────────────────────
async function startChaseMode(shouldRun) {
    initUI();
    startRandomRadio();
    await initMultiplayer();
    
    refreshTerrain();
    initChaseRocks();

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now = performance.now();
        _updateFps();
        pollGamepads();

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
            sun.position.set(lx + 150, 200, lz + 100);
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
async function startTronMode(shouldRun) {
    const { initTronMode, updateTronMode, disposeTronMode } =
        await import('./modes/TronMode.js');
    const { loadCarForPlayer: loadCar } = await import('./car.js');
    const { createTrackSystem: mkTracks } = await import('./tracks.js');
    const { createShadow: mkShadow } = await import('./shadow.js');
    const { createAura: mkAura } = await import('./aura.js');

    initUI();
    startRandomRadio();
    await initMultiplayer();

    // Force-loader les voitures (le spawn différé ne marche pas en arène)
    for (const p of players.values()) {
        if (!p.car) {
            await loadCar(p);
            p.respawn(0, 0, 0);
            p.tracks = mkTracks();
            p.shadow = mkShadow();
            p.aura   = mkAura();
            p.createNameLabel();
        }
    }

    await initTronMode(players);

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now = performance.now();
        _updateFps();
        pollGamepads();

        for (const p of players.values()) {
            if (!p.car) continue;
            updatePhysics(p, 0, () => 0);
        }

        // Pas de collisions inter-joueurs en Tron (les traces font office de murs)
        if (_anyCarReady()) updateTronMode(players, now);

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
async function startDerbyMode(shouldRun) {
    const { initDerbyMode, updateDerbyMode, isDerbyActive, getDuneHeight } =
        await import('./modes/DerbyMode.js');

    initUI();
    startRandomRadio();
    await initMultiplayer();
    await initDerbyMode(players);

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now = performance.now();
        _updateFps();
        pollGamepads();

        if (isDerbyActive()) {
            for (const p of players.values()) {
                if (!p.car) continue;
                const duneY = getDuneHeight(p.car.position.x, p.car.position.z);
                updatePhysics(p, duneY, () => 0);
            }
            updateCollisions(players, [], 2.5);
        }

        if (_anyCarReady()) updateDerbyMode(players, now);

        for (const p of players.values()) {
            if (!p.car) continue;
            const duneY = getDuneHeight(p.car.position.x, p.car.position.z);
            if (p.shadow) p.shadow.update(p.car.position, p.carAngle, duneY);
            if (p.tracks) p.tracks.update(p);
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
async function startBattleMode(shouldRun) {
    const { initBattleMode, updateBattleMode, isBattleActive } =
        await import('./modes/BattleMode.js');

    initUI();
    startRandomRadio();
    await initMultiplayer();
    await initBattleMode(players);
    updateTerrain(0); // initialiser les patches dès le départ (spawn différé)

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now = performance.now();
        _updateFps();
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
            sun.position.set(lx + 150, 200, lz + 100);
            sun.target.position.set(lx, 0, lz);
            sun.target.updateMatrixWorld();
        }

        if (_anyCarReady()) updateBattleMode(players, now);
        updateSparks(now);
        updateUI(players);
        renderer.render(scene, camera);
    }
    animate();
}

// ── Mode Football ──────────────────────────────────────────────────────────────
async function startFootMode(shouldRun) {
    const { initFootMode, updateFootMode } =
        await import('./modes/FootMode.js');

    initUI();
    startRandomRadio();
    await initMultiplayer();
    await initFootMode(players);

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now = performance.now();
        _updateFps();
        pollGamepads();

        for (const p of players.values()) {
            if (!p.car) continue;
            updatePhysics(p, 0, () => 0);
        }

        updateCollisions(players);
        if (_anyCarReady()) updateFootMode(players, now);

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
async function startCircuitMode(shouldRun) {
    const { initCircuitMode, updateCircuitMode, updateCircuitCamera, isCircuitActive } =
        await import('./modes/CircuitMode.js');

    initUI();
    startRandomRadio();
    await initMultiplayer();
    await initCircuitMode(players);

    let lastNow = performance.now();

    function animate() {
        if (shouldRun && !shouldRun()) return;
        _scheduleFrame(animate);
        const now  = performance.now();
        _updateFps();
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

        if (_anyCarReady()) updateCircuitMode(players, now, dt);
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

let _currentLoopId = 0;

function _launchMode(mode) {
    stopMusic(); // Arrêter la musique précédente
    _currentLoopId++;
    const loopId = _currentLoopId;

    // Fonction pour vérifier si on doit continuer la boucle
    const shouldRun = () => loopId === _currentLoopId;

    if (mode === 'parking')      startParkingMode(shouldRun);
    else if (mode === 'chase')   startChaseMode(shouldRun);
    else if (mode === 'tron')    startTronMode(shouldRun);
    else if (mode === 'derby')   startDerbyMode(shouldRun);
    else if (mode === 'battle')  startBattleMode(shouldRun);
    else if (mode === 'foot')    startFootMode(shouldRun);
    else if (mode === 'circuit') startCircuitMode(shouldRun);
    else                         startDriveMode(shouldRun);
}

// Exposé pour démarrage depuis le menu SANS rechargement de page
// (conserve le geste utilisateur → autoplay audio garanti)
window._startGameMode = function(mode) {
    disposeTitleScene();
    renderer.domElement.style.display = 'block';
    const lbl = document.getElementById('mode-label');
    if (lbl) lbl.textContent = LABELS_MAP[mode] || mode;
    const _gui = document.getElementById('game-ui');
    if (_gui) { _gui.classList.remove('hidden'); _gui.style.display = 'block'; }
    _launchMode(mode);
};

// Démarrage direct (F5 / lien avec ?mode=xxx)
if (MODE) {
    // Cacher le loading overlay (géré normalement par titleScene.js)
    const _loadOv = document.getElementById('loading-overlay');
    if (_loadOv) { _loadOv.classList.add('done'); setTimeout(() => _loadOv.remove(), 600); }

    renderer.domElement.style.display = 'block';
    const _gui = document.getElementById('game-ui');
    if (_gui) { _gui.classList.remove('hidden'); _gui.style.display = 'block'; }
    _launchMode(MODE);
} else {
    // Page de titre → lancer les Topolino 3D en arrière-plan
    initTitleScene();
    startTitleMusic();
}
