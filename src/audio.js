// ── Système Audio : Musique du titre et Radio aléatoire ──────────────────────

const RADIO_MUSICS = [
    'Asssets/musics/radio_audiogreen-phonk-167055.mp3',
    'Asssets/musics/radio_lemonmusicstudio-beach-volleyball-116179.mp3',
    'Asssets/musics/radio_moodmode-studio-dark-slaphouse-176903.mp3',
    'Asssets/musics/radio_qubesounds-racing_fast-day-125862.mp3',
    'Asssets/musics/radio_qubesounds-sport-electro-beat_chainbreaker-127378.mp3',
    'Asssets/musics/radio_qubesounds-sport-rock-trailer_emergence-95431.mp3'
];

const TITLE_MUSIC = 'Asssets/musics/title_xxxdolm-inspiring-motivation-music-456122.mp3';

let _bgm = null;
let _currentTrack = '';

/**
 * Démarre la musique du titre
 * Note: Nécessite une interaction utilisateur préalable (clic/touche)
 */
export function startTitleMusic() {
    if (_currentTrack === TITLE_MUSIC) return;
    _play(TITLE_MUSIC, true);
}

/**
 * Démarre la radio aléatoire pour le jeu
 */
export function startRandomRadio() {
    const track = RADIO_MUSICS[Math.floor(Math.random() * RADIO_MUSICS.length)];
    _play(track, false);
    
    // Quand la musique s'arrête, on en lance une autre
    if (_bgm) {
        _bgm.onended = () => {
            if (_currentTrack !== TITLE_MUSIC) startRandomRadio();
        };
    }
}

/**
 * Arrête toute musique en cours
 */
export function stopMusic() {
    if (_bgm) {
        _bgm.pause();
        _bgm = null;
        _currentTrack = '';
    }
}

function _play(src, loop) {
    if (_bgm) _bgm.pause();
    
    _bgm = new Audio(src);
    _bgm.loop = loop;
    _bgm.volume = 0.5;
    _currentTrack = src;
    
    _bgm.play().catch(e => {
        console.warn("[Audio] Lecture bloquée par le navigateur. Attente d'interaction.", e);
        // On réessaye au premier clic sur le document
        const retry = () => {
            _bgm.play();
            window.removeEventListener('click', retry);
            window.removeEventListener('keydown', retry);
        };
        window.addEventListener('click', retry);
        window.addEventListener('keydown', retry);
    });
}
