const TRACKS = [
    'Asssets/musics/audiogreen-phonk-167055.mp3',
    'Asssets/musics/lemonmusicstudio-beach-volleyball-116179.mp3',
    'Asssets/musics/moodmode-studio-dark-slaphouse-176903.mp3',
    'Asssets/musics/qubesounds-racing_fast-day-125862.mp3',
    'Asssets/musics/qubesounds-sport-electro-beat_chainbreaker-127378.mp3',
    'Asssets/musics/qubesounds-sport-rock-trailer_emergence-95431.mp3',
];

import { settings } from './settings.js';

let _audio = null;

export function startMusic(volume) {
    if (volume === undefined) volume = settings.musicVolume;
    // Déjà en cours de lecture → rien à faire
    if (_audio && !_audio.paused) return;

    // Créer l'objet Audio une seule fois
    if (!_audio) {
        const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
        _audio = new Audio(track);
        _audio.loop   = true;
        _audio.volume = volume;
    }

    _audio.volume = volume;

    _audio.play().catch(() => {
        // Autoplay bloqué : relancer au premier geste utilisateur
        const resume = () => {
            _audio.play().catch(() => {});
            document.removeEventListener('pointerdown', resume);
            document.removeEventListener('keydown',     resume);
        };
        document.addEventListener('pointerdown', resume, { passive: true, once: true });
        document.addEventListener('keydown',     resume, { once: true });
    });
}

export function setGameMusicVolume(v) {
    if (_audio) _audio.volume = v;
}
