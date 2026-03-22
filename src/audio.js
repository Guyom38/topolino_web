// ── Système Audio : Musique du titre et Radio aléatoire ──────────────────────

import { settings } from './settings.js';

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
let _autoplayFn = null;  // référence au listener autoplay courant

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
        _bgm.onended = null;
        _bgm = null;
        _currentTrack = '';
    }
    // Retirer les listeners de secours autoplay qui pourraient relancer
    // une ancienne piste après un stopMusic()
    _clearAutoplayListeners();
}

export function setMusicVolume(v) {
    if (_bgm) _bgm.volume = v;
}

function _play(src, loop) {
    if (_bgm) {
        _bgm.pause();
        _bgm.src = src;
    } else {
        _bgm = new Audio(src);
    }
    
    _bgm.loop = loop;
    _bgm.volume = settings.musicVolume;
    _currentTrack = src;
    
    // Retirer l'ancien listener avant d'en créer un nouveau
    _clearAutoplayListeners();

    const attemptPlay = () => {
        if (_bgm && _bgm.src.endsWith(src.split('/').pop())) {
            _bgm.play().then(() => {
                _clearAutoplayListeners();
            }).catch(() => {
                console.log("[Audio] Attente interaction utilisateur...");
            });
        } else {
            // La piste a changé, retirer ce listener obsolète
            _clearAutoplayListeners();
        }
    };

    _autoplayFn = attemptPlay;
    attemptPlay();

    // Au cas où, on s'attache aux événements d'interaction
    window.addEventListener('click', attemptPlay);
    window.addEventListener('keydown', attemptPlay);
    window.addEventListener('touchstart', attemptPlay);
}

function _clearAutoplayListeners() {
    if (_autoplayFn) {
        window.removeEventListener('click', _autoplayFn);
        window.removeEventListener('keydown', _autoplayFn);
        window.removeEventListener('touchstart', _autoplayFn);
        _autoplayFn = null;
    }
}
