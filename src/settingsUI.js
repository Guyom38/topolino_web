// ── Settings UI — Modal avec glass-morphism ──────────────────────────────────

import { settings, setSetting, saveSettings, resetSettings, DEFAULTS,
         applyResolution, applyShadows, applyVolumes, applyFps, applyAllSettings } from './settings.js';

let _overlay = null;
let _btn     = null;

// ── Initialisation ──────────────────────────────────────────────────────────
export function initSettingsUI() {
    _injectCSS();
    _createGearButton();
}

// ── CSS ─────────────────────────────────────────────────────────────────────
function _injectCSS() {
    const style = document.createElement('style');
    style.textContent = `
/* ═══ SETTINGS GEAR ═══ */
#settings-gear {
    position: fixed; bottom: 16px; right: 16px; z-index: 600;
    width: 44px; height: 44px; border-radius: 50%;
    background: rgba(0,0,0,0.62); border: 1px solid rgba(255,255,255,0.14);
    backdrop-filter: blur(8px); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .2s, border-color .2s, transform .2s;
    font-size: 20px; color: rgba(255,255,255,0.65);
}
#settings-gear:hover {
    background: rgba(255,200,0,0.15); border-color: rgba(255,200,0,0.4);
    color: #ffcc00; transform: rotate(45deg);
}

/* ═══ SETTINGS OVERLAY ═══ */
#settings-overlay {
    position: fixed; inset: 0; z-index: 700;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none;
    transition: opacity .25s;
}
#settings-overlay.open { opacity: 1; pointer-events: all; }

/* ═══ SETTINGS MODAL ═══ */
#settings-modal {
    background: rgba(4,8,20,0.88); backdrop-filter: blur(14px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 18px;
    padding: 28px 32px 22px; width: min(480px, 90vw); max-height: 85vh;
    overflow-y: auto; color: #fff;
    box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,200,0,0.08);
    transform: translateY(20px); transition: transform .25s;
}
#settings-overlay.open #settings-modal { transform: translateY(0); }

.stg-title {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 28px; letter-spacing: 0.08em; margin-bottom: 20px;
    background: linear-gradient(135deg, #ffcc00, #ff8800);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
}
.stg-close {
    position: absolute; top: 16px; right: 18px;
    background: none; border: none; color: rgba(255,255,255,0.4);
    font-size: 22px; cursor: pointer; transition: color .15s;
}
.stg-close:hover { color: #fff; }

/* ═══ SECTIONS ═══ */
.stg-section { margin-bottom: 18px; }
.stg-section-title {
    font-size: 11px; font-weight: 700; letter-spacing: 0.2em;
    text-transform: uppercase; color: rgba(255,255,255,0.35);
    margin-bottom: 10px; padding-bottom: 5px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
}

/* ═══ ROW ═══ */
.stg-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 0; gap: 12px;
}
.stg-label { font-size: 13px; color: rgba(255,255,255,0.75); flex: 1; }

/* ═══ SLIDER ═══ */
.stg-slider {
    -webkit-appearance: none; appearance: none;
    width: 140px; height: 5px; border-radius: 3px;
    background: rgba(255,255,255,0.1); outline: none;
    cursor: pointer;
}
.stg-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 16px; height: 16px; border-radius: 50%;
    background: linear-gradient(135deg, #ffcc00, #ff8800);
    border: 2px solid rgba(0,0,0,0.4); cursor: pointer;
    box-shadow: 0 0 8px rgba(255,170,0,0.4);
}
.stg-slider::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%;
    background: linear-gradient(135deg, #ffcc00, #ff8800);
    border: 2px solid rgba(0,0,0,0.4); cursor: pointer;
}
.stg-slider-val {
    font-size: 12px; color: rgba(255,255,255,0.45);
    min-width: 32px; text-align: right; font-family: monospace;
}

/* ═══ TOGGLE ═══ */
.stg-toggle {
    position: relative; width: 40px; height: 22px;
    background: rgba(255,255,255,0.12); border-radius: 11px;
    cursor: pointer; transition: background .2s; flex-shrink: 0;
}
.stg-toggle.on { background: linear-gradient(135deg, #ffcc00, #ff8800); }
.stg-toggle::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #fff; transition: transform .2s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.stg-toggle.on::after { transform: translateX(18px); }

/* ═══ SEGMENTED ═══ */
.stg-seg {
    display: flex; gap: 0; border-radius: 8px; overflow: hidden;
    border: 1px solid rgba(255,255,255,0.1);
}
.stg-seg-btn {
    padding: 5px 10px; font-size: 11px; font-weight: 600;
    background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5);
    border: none; cursor: pointer; transition: all .15s;
    letter-spacing: 0.04em;
}
.stg-seg-btn:not(:last-child) { border-right: 1px solid rgba(255,255,255,0.06); }
.stg-seg-btn.active {
    background: linear-gradient(135deg, rgba(255,200,0,0.25), rgba(255,120,0,0.2));
    color: #ffcc00;
}
.stg-seg-btn:hover:not(.active) {
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);
}

/* ═══ RESET BUTTON ═══ */
.stg-reset {
    display: block; margin: 16px auto 0; padding: 8px 24px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px; color: rgba(255,255,255,0.5);
    font-size: 12px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; cursor: pointer; transition: all .15s;
}
.stg-reset:hover {
    background: rgba(255,80,80,0.15); border-color: rgba(255,80,80,0.3);
    color: #ff6b6b;
}

/* Scrollbar du modal */
#settings-modal::-webkit-scrollbar { width: 4px; }
#settings-modal::-webkit-scrollbar-track { background: transparent; }
#settings-modal::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
`;
    document.head.appendChild(style);
}

// ── Bouton engrenage ────────────────────────────────────────────────────────
function _createGearButton() {
    _btn = document.createElement('div');
    _btn.id = 'settings-gear';
    _btn.innerHTML = '&#9881;'; // ⚙
    _btn.title = 'Paramètres';
    _btn.addEventListener('click', _toggleModal);
    document.body.appendChild(_btn);
}

// ── Toggle modal ────────────────────────────────────────────────────────────
function _toggleModal() {
    if (_overlay) {
        _close();
    } else {
        _open();
    }
}

function _open() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'settings-overlay';
    _overlay.innerHTML = _buildModalHTML();
    document.body.appendChild(_overlay);

    // Fermer en cliquant sur l'overlay (pas le modal)
    _overlay.addEventListener('click', e => {
        if (e.target === _overlay) _close();
    });

    // Fermer avec Echap
    _overlay._onKey = e => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', _overlay._onKey);

    // Bind les contrôles
    requestAnimationFrame(() => {
        _overlay.classList.add('open');
        _bindControls();
    });
}

function _close() {
    if (!_overlay) return;
    document.removeEventListener('keydown', _overlay._onKey);
    _overlay.classList.remove('open');
    setTimeout(() => {
        _overlay.remove();
        _overlay = null;
    }, 260);
}

// ── Construction du HTML ────────────────────────────────────────────────────
function _buildModalHTML() {
    return `
<div id="settings-modal" style="position:relative">
    <button class="stg-close" id="stg-close">&times;</button>
    <div class="stg-title">Paramètres</div>

    <!-- AUDIO -->
    <div class="stg-section">
        <div class="stg-section-title">Audio</div>
        ${_slider('musicVolume', 'Musique', 0, 1, 0.01)}
        ${_slider('sfxVolume', 'Effets sonores', 0, 1, 0.01)}
    </div>

    <!-- AFFICHAGE -->
    <div class="stg-section">
        <div class="stg-section-title">Affichage</div>
        ${_segmented('resolution', 'Résolution', [
            { val: 'native', label: 'Natif' },
            { val: '4k',     label: '4K' },
            { val: 'fullhd', label: '1080p' },
            { val: 'hd',     label: '720p' },
        ])}
        ${_toggleHTML('shadows', 'Ombres')}
        ${_segmented('shadowQuality', 'Qualité ombres', [
            { val: 'high',   label: 'Haute' },
            { val: 'medium', label: 'Moyenne' },
            { val: 'low',    label: 'Basse' },
        ])}
    </div>

    <!-- EFFETS -->
    <div class="stg-section">
        <div class="stg-section-title">Effets</div>
        ${_toggleHTML('particles', 'Particules (traces, étincelles, fumée)')}
        ${_toggleHTML('auras', 'Auras')}
    </div>

    <!-- GAMEPLAY -->
    <div class="stg-section">
        <div class="stg-section-title">Gameplay</div>
        ${_slider('dayCycleDuration', 'Cycle jour/nuit (s)', 30, 180, 5)}
        ${_toggleHTML('showFps', 'Afficher FPS')}
        ${_toggleHTML('limitFps', 'Limiter à 60 FPS <small style="color:rgba(255,255,255,.3);font-size:10px">(utile sur écran 120Hz+)</small>')}
    </div>

    <button class="stg-reset" id="stg-reset">Réinitialiser</button>
</div>`;
}

// ── Helpers HTML ─────────────────────────────────────────────────────────────
function _slider(key, label, min, max, step) {
    const val = settings[key];
    const display = max <= 1 ? Math.round(val * 100) + '%' : val;
    return `<div class="stg-row">
        <span class="stg-label">${label}</span>
        <input type="range" class="stg-slider" data-key="${key}"
               min="${min}" max="${max}" step="${step}" value="${val}">
        <span class="stg-slider-val" data-valfor="${key}">${display}</span>
    </div>`;
}

function _toggleHTML(key, label) {
    return `<div class="stg-row">
        <span class="stg-label">${label}</span>
        <div class="stg-toggle${settings[key] ? ' on' : ''}" data-key="${key}"></div>
    </div>`;
}

function _segmented(key, label, options) {
    const btns = options.map(o =>
        `<button class="stg-seg-btn${settings[key] === o.val ? ' active' : ''}"
                 data-key="${key}" data-val="${o.val}">${o.label}</button>`
    ).join('');
    return `<div class="stg-row">
        <span class="stg-label">${label}</span>
        <div class="stg-seg">${btns}</div>
    </div>`;
}

// ── Bind des événements ─────────────────────────────────────────────────────
function _bindControls() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // Fermer
    document.getElementById('stg-close').addEventListener('click', _close);

    // Sliders
    modal.querySelectorAll('.stg-slider').forEach(sl => {
        sl.addEventListener('input', () => {
            const key = sl.dataset.key;
            const val = parseFloat(sl.value);
            setSetting(key, val);
            const display = parseFloat(sl.max) <= 1 ? Math.round(val * 100) + '%' : val;
            modal.querySelector(`[data-valfor="${key}"]`).textContent = display;
            _applyForKey(key);
        });
    });

    // Toggles
    modal.querySelectorAll('.stg-toggle').forEach(tg => {
        tg.addEventListener('click', () => {
            const key = tg.dataset.key;
            const newVal = !settings[key];
            setSetting(key, newVal);
            tg.classList.toggle('on', newVal);
            _applyForKey(key);
        });
    });

    // Boutons segmentés
    modal.querySelectorAll('.stg-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const val = btn.dataset.val;
            setSetting(key, val);
            // Mettre à jour l'état actif
            btn.closest('.stg-seg').querySelectorAll('.stg-seg-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.val === val);
            });
            _applyForKey(key);
        });
    });

    // Reset
    document.getElementById('stg-reset').addEventListener('click', () => {
        resetSettings();
        applyAllSettings();
        // Reconstruire le modal pour refléter les defaults
        _close();
        setTimeout(_open, 300);
    });
}

// ── Application ciblée par clé ──────────────────────────────────────────────
function _applyForKey(key) {
    switch (key) {
        case 'musicVolume':
        case 'sfxVolume':
            applyVolumes();
            break;
        case 'resolution':
            applyResolution();
            break;
        case 'shadows':
        case 'shadowQuality':
            applyShadows();
            break;
        case 'showFps':
            applyFps();
            break;
        // particles, auras, dayCycleDuration : lecture directe dans les modules
    }
}
