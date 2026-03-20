import { PlayerCar } from './PlayerCar.js';
import { loadCarForPlayer } from './car.js';
import { createTrackSystem } from './tracks.js';
import { createShadow } from './shadow.js';
import { localKeys } from './input.js';

export const players = new Map();   // playerId → PlayerCar
const LOCAL_ID = 'local';

let localPlayer = null;

export function getLocalPlayer() { return localPlayer; }

// ── Initialisation ───────────────────────────────────────────────────────────

export async function initMultiplayer() {
    // Joueur local (clavier)
    localPlayer = new PlayerCar(LOCAL_ID, 'Joueur 1', '#B7D1C4', true);
    localPlayer.keys = localKeys;   // référence directe aux touches clavier
    players.set(LOCAL_ID, localPlayer);

    await loadCarForPlayer(localPlayer);
    localPlayer.tracks = createTrackSystem();
    localPlayer.shadow = createShadow();
    // Pas de label de nom pour le joueur local (caméra le suit)

    _connectToServer();
    return localPlayer;
}

// ── Connexion WebSocket ──────────────────────────────────────────────────────

function _connectToServer() {
    const tryConnect = () => {
        if (typeof io === 'undefined') { setTimeout(tryConnect, 100); return; }

        const sock = io(window.location.origin, { transports: ['websocket'] });

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
            p.keys.left     = inp.jx <  -DZ;
            p.keys.right    = inp.jx >   DZ;
            p.keys.up       = inp.jy < -DZ;
            p.keys.down     = inp.jy >  DZ;
            p.keys.jx       = inp.jx;   // analogique pour direction précise
        });

        sock.on('player_config', d => {
            const p = players.get(d.player_id);
            if (!p) return;
            if (d.name)  p.setName(d.name);
            if (d.color) p.setColor(d.color);
        });

        sock.on('disconnect', () => console.log('[MP] Déconnecté du serveur'));
    };
    tryConnect();
}

// ── Gestion des joueurs distants ─────────────────────────────────────────────

async function _addRemote(id, name, color) {
    const p = new PlayerCar(id, name, color, false);
    players.set(id, p);

    await loadCarForPlayer(p);
    p.tracks = createTrackSystem();
    p.shadow = createShadow();
    p.createNameLabel();
}

function _removePlayer(id) {
    if (id === LOCAL_ID) return;
    const p = players.get(id);
    if (p) { p.dispose(); players.delete(id); }
}
