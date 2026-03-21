const TRACKS = [
    'Asssets/musics/audiogreen-phonk-167055.mp3',
    'Asssets/musics/lemonmusicstudio-beach-volleyball-116179.mp3',
    'Asssets/musics/moodmode-studio-dark-slaphouse-176903.mp3',
    'Asssets/musics/qubesounds-racing_fast-day-125862.mp3',
    'Asssets/musics/qubesounds-sport-electro-beat_chainbreaker-127378.mp3',
    'Asssets/musics/qubesounds-sport-rock-trailer_emergence-95431.mp3',
];

let _audio = null;

export function startMusic(volume = 0.55) {
    if (_audio) return; // déjà lancée
    const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    _audio = new Audio(track);
    _audio.loop   = true;
    _audio.volume = volume;
    _audio.play().catch(() => {
        // Fallback F5 / lien direct : le premier geste (touche ou clic) débloque
        const resume = () => {
            _audio.play().catch(() => {});
            document.removeEventListener('pointerdown', resume);
            document.removeEventListener('keydown',     resume);
        };
        document.addEventListener('pointerdown', resume, { passive: true, once: true });
        document.addEventListener('keydown',     resume, { once: true });
    });
}
