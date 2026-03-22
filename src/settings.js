// ── Système de Settings — données, persistance, application ──────────────────

import { renderer, sun } from './scene.js';

// ── Valeurs par défaut ──────────────────────────────────────────────────────
const DEFAULTS = {
    musicVolume:      0.5,       // 0..1
    sfxVolume:        0.75,      // 0..1
    resolution:       'native',  // 'native'|'4k'|'fullhd'|'hd'
    shadows:          true,
    shadowQuality:    'high',    // 'high'(2048)|'medium'(1024)|'low'(512)
    particles:        true,      // traces, sparks, smoke
    auras:            true,
    dayCycleDuration: 60,        // 30..180s
    showFps:          true,
    limitFps:         true,      // true = cap 60fps, false = illimité
};

const LS_KEY = 'topolino_settings';

// ── État courant (mutable, importable) ──────────────────────────────────────
export const settings = { ...DEFAULTS };

// ── Persistance ─────────────────────────────────────────────────────────────
export function loadSettings() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const saved = JSON.parse(raw);
            for (const k of Object.keys(DEFAULTS)) {
                if (k in saved) settings[k] = saved[k];
            }
        }
    } catch (e) {
        console.warn('[Settings] Impossible de charger :', e);
    }
}

export function saveSettings() {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('[Settings] Impossible de sauvegarder :', e);
    }
}

export function resetSettings() {
    Object.assign(settings, DEFAULTS);
    saveSettings();
}

// ── Setter unitaire + sauvegarde ────────────────────────────────────────────
export function setSetting(key, val) {
    if (!(key in DEFAULTS)) return;
    settings[key] = val;
    saveSettings();
}

// ── Présets résolution ──────────────────────────────────────────────────────
const RES_MAP = {
    '4k':     3840,
    'fullhd': 1920,
    'hd':     1280,
};

export function getPixelRatio() {
    if (settings.resolution === 'native') return window.devicePixelRatio || 1;
    const target = RES_MAP[settings.resolution] || 1920;
    return Math.min(target / window.innerWidth, window.devicePixelRatio || 1);
}

// ── Shadow map size ─────────────────────────────────────────────────────────
const SHADOW_MAP = { high: 2048, medium: 1024, low: 512 };

function _getShadowSize() {
    return SHADOW_MAP[settings.shadowQuality] || 2048;
}

// ── Application globale ─────────────────────────────────────────────────────
let _rendererReady = false;

export function applyAllSettings() {
    applyVolumes();
    applyFps();
    window._sfxVolume = settings.sfxVolume;

    // Résolution et ombres doivent attendre que le renderer ait fait
    // au moins un tour d'event-loop (sinon shader validation failure).
    if (_rendererReady) {
        applyResolution();
        applyShadows();
    } else {
        requestAnimationFrame(() => {
            _rendererReady = true;
            applyResolution();
            applyShadows();
        });
    }
}

// ── Résolution ──────────────────────────────────────────────────────────────
export function applyResolution() {
    const pr = getPixelRatio();
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ── Ombres ──────────────────────────────────────────────────────────────────
export function applyShadows() {
    renderer.shadowMap.enabled = settings.shadows;

    const size = _getShadowSize();
    if (sun.shadow.mapSize.width !== size) {
        sun.shadow.mapSize.width  = size;
        sun.shadow.mapSize.height = size;
        // Forcer la re-création de la shadow map
        if (sun.shadow.map) {
            sun.shadow.map.dispose();
            sun.shadow.map = null;
        }
    }
}

// ── Volumes ─────────────────────────────────────────────────────────────────
export function applyVolumes() {
    window._sfxVolume = settings.sfxVolume;

    // audio.js (musique titre / radio)
    try {
        import('./audio.js').then(m => {
            if (m.setMusicVolume) m.setMusicVolume(settings.musicVolume);
        });
    } catch (e) {}

    // music.js (musique circuit)
    try {
        import('./music.js').then(m => {
            if (m.setGameMusicVolume) m.setGameMusicVolume(settings.musicVolume);
        });
    } catch (e) {}
}

// ── FPS ─────────────────────────────────────────────────────────────────────
export function applyFps() {
    const show = settings.showFps;
    const el1 = document.getElementById('fps-counter');
    const el2 = document.getElementById('title-fps');
    if (el1) el1.style.display = show ? '' : 'none';
    if (el2) el2.style.display = show ? '' : 'none';
}

// ── Frame limiter (60 FPS cap optionnel) ────────────────────────────────────
const _FRAME_MS  = 1000 / 60;          // ~16.67ms
const _FRAME_THR = _FRAME_MS - 1;      // ~15.67ms — tolérance anti-flottant
let _lastFrameTime = 0;

export function scheduleFrame(callback) {
    requestAnimationFrame(ts => {
        if (settings.limitFps) {
            if (ts - _lastFrameTime < _FRAME_THR) {
                scheduleFrame(callback);
                return;
            }
            // Drift correction : avancer de _FRAME_MS exact plutôt que ts brut
            _lastFrameTime = _lastFrameTime === 0 ? ts : _lastFrameTime + _FRAME_MS;
        }
        callback();
    });
}

// ── Export des defaults pour le reset ───────────────────────────────────────
export { DEFAULTS };
