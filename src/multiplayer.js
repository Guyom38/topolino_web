import { PlayerCar } from './PlayerCar.js';
import { loadCarForPlayer } from './car.js';
import { createTrackSystem } from './tracks.js';
import { createShadow } from './shadow.js';
import { createAura } from './aura.js';
import { localKeys } from './input.js';

export const players = new Map();   // playerId → PlayerCar
const LOCAL_ID = 'local';
const AVATARS  = ['Antonio', 'Anais', 'Kitty', 'Sergio'];
let _avatarIdx = 0;

let localPlayer = null;

export function getLocalPlayer() { return localPlayer; }

// ── Gestion des Gamepads (Manettes USB) ──────────────────────────────────────
const SILLY_NAMES = ["Patate Douce", "Slip de Bain", "Grominet", "Yaourt Nature", "Pneu Crevé", "Cornichon", "Pastèque Galactique", "Radiateur", "Chaussette Sale", "Merguez Noire"];
const gamepadPlayers = new Map(); // gamepadIndex -> playerId

function _getRandomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
}

export function pollGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    
    for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) {
            // Déconnexion
            if (gamepadPlayers.has(i)) {
                _removePlayer(gamepadPlayers.get(i));
                gamepadPlayers.delete(i);
            }
            continue;
        }

        // Limitation à 8 manettes max
        if (gamepadPlayers.size >= 8 && !gamepadPlayers.has(i)) continue;

        // Nouveau joueur manette
        if (!gamepadPlayers.has(i)) {
            const id = 'pad_' + i;
            const name = SILLY_NAMES[Math.floor(Math.random() * SILLY_NAMES.length)];
            const color = _getRandomColor();
            _addRemote(id, name, color);
            gamepadPlayers.set(i, id);
            console.log(`[Gamepad] Manette détectée à l'index ${i}: ${name}`);
        }

        const p = players.get(gamepadPlayers.get(i));
        if (!p) continue;

        // Inputs : Analogique (axes 0 et 1) + Flèches (boutons 12, 13, 14, 15)
        const DZ = 0.15; // Deadzone
        const ax = gp.axes[0] || 0;
        const ay = gp.axes[1] || 0;

        p.keys.left  = ax < -DZ || gp.buttons[14]?.pressed;
        p.keys.right = ax >  DZ || gp.buttons[15]?.pressed;
        p.keys.up    = ay < -DZ || gp.buttons[12]?.pressed || gp.buttons[0]?.pressed || gp.buttons[7]?.pressed; // A, Croix ou R2
        p.keys.down  = ay >  DZ || gp.buttons[13]?.pressed || gp.buttons[1]?.pressed || gp.buttons[6]?.pressed; // B, Rond ou L2
        p.keys.handbrake = gp.buttons[2]?.pressed || gp.buttons[3]?.pressed || gp.buttons[5]?.pressed; // X, Y ou R1
        
        // Stocker la valeur analogique brute pour le braquage fluide
        p.keys.jx = ax; 
    }
}

// ── Initialisation ───────────────────────────────────────────────────────────

// Charge et fait apparaître la voiture du joueur clavier (déclenché au 1er appui)
let _localCarSpawned = false;
let _onFirstKeyRef   = null;

async function _spawnLocalCar() {
    if (_localCarSpawned) return;
    _localCarSpawned = true;
    await loadCarForPlayer(localPlayer);
    localPlayer.respawn(0, 30, 0);
    localPlayer.tracks = createTrackSystem();
    localPlayer.shadow = createShadow();
    localPlayer.aura   = createAura();
    localPlayer.setLuggage(true);
}

const MOVEMENT_KEYS = new Set([
    'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
    'KeyW','KeyS','KeyA','KeyD','KeyZ','KeyQ','Space'
]);

export async function initMultiplayer() {
    // Supprimer l'ancien listener de spawn différé s'il n'a pas encore tiré
    if (_onFirstKeyRef) {
        document.removeEventListener('keydown', _onFirstKeyRef);
        _onFirstKeyRef = null;
    }

    // Nettoyer tous les joueurs de l'ancienne session (évite les doublons de voitures)
    for (const p of players.values()) p.dispose();
    players.clear();
    gamepadPlayers.clear();

    _localCarSpawned = false;
    _avatarIdx = 0;

    // Joueur local (clavier) — la voiture n'apparaît qu'au premier appui sur une touche
    localPlayer = new PlayerCar(LOCAL_ID, 'Joueur 1', '#B7D1C4', true);
    localPlayer.avatar = AVATARS[_avatarIdx++ % AVATARS.length];
    localPlayer.keys = localKeys;   // référence directe aux touches clavier
    players.set(LOCAL_ID, localPlayer);

    // Spawn différé : premier appui clavier déclenche le chargement de la voiture
    _onFirstKeyRef = (e) => {
        if (!MOVEMENT_KEYS.has(e.code)) return;
        document.removeEventListener('keydown', _onFirstKeyRef);
        _onFirstKeyRef = null;
        _spawnLocalCar();
    };
    document.addEventListener('keydown', _onFirstKeyRef);

    _connectToServer();
    return localPlayer;
}

// ── Connexion WebSocket ──────────────────────────────────────────────────────

let _socket = null;

function _connectToServer() {
    // Ne créer la connexion qu'une seule fois (évite les doublons d'écouteurs)
    if (_socket) return;

    const tryConnect = () => {
        if (typeof io === 'undefined') { setTimeout(tryConnect, 100); return; }

        const sock = io(window.location.origin);
        _socket = sock;

        sock.on('connect', () => {
            sock.emit('register_display');
            console.log('[MP] Connecté au serveur');
        });

        sock.on('player_list', list => {
            list.forEach(d => _addRemote(d.player_id, d.name, d.color));
        });

        sock.on('player_joined', d => {
            if (!players.has(d.player_id)) _addRemote(d.player_id, d.name, d.color);
        });

        sock.on('player_left', d => _removePlayer(d.player_id));

        sock.on('player_input', d => {
            const p   = players.get(d.player_id);
            if (!p) return;
            const inp = d.inputs;
            const DZ  = 0.12;
            p.keys.left      = inp.jx <  -DZ;
            p.keys.right     = inp.jx >   DZ;
            p.keys.up        = inp.jy < -DZ;
            p.keys.down      = inp.jy >  DZ;
            p.keys.jx        = inp.jx;
            p.keys.handbrake = !!inp.brake;
        });

        sock.on('player_config', d => {
            const p = players.get(d.player_id);
            if (!p) return;
            if (d.name)  p.setName(d.name);
            if (d.color) p.setColor(d.color);
        });

        sock.on('player_photos', d => {
            const p = players.get(d.player_id);
            if (p) p.setPhotos(d.photos);
        });

        sock.on('change_mode', d => {
            const mode = d.mode;
            if (mode && /^[a-z]+$/.test(mode)) {
                window.location.href = '?mode=' + mode;
            }
        });

        sock.on('disconnect', () => console.log('[MP] Déconnecté du serveur'));
    };
    tryConnect();
}

// ── Gestion des joueurs distants ─────────────────────────────────────────────

async function _addRemote(id, name, color) {
    const p = new PlayerCar(id, name, color, false);
    p.avatar = AVATARS[_avatarIdx++ % AVATARS.length];
    players.set(id, p);

    await loadCarForPlayer(p);
    p.respawn((Math.random()-0.5)*10, 30, (Math.random()-0.5)*10);
    p.setLuggage(false); // Cacher le bagage par défaut
    p.tracks = createTrackSystem();
    p.shadow = createShadow();
    p.aura   = createAura();
    p.createNameLabel();
}

function _removePlayer(id) {
    if (id === LOCAL_ID) return;
    const p = players.get(id);
    if (p) { 
        if (p.hasLuggage && localPlayer) localPlayer.setLuggage(true);
        p.dispose(); 
        players.delete(id); 
    }
}
