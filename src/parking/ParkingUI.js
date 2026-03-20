// ── Interface utilisateur du mode parking ─────────────────────────────────────
// Timer (haut centre) + scores par joueur (bas centre) + sprites 3D au-dessus des voitures

import * as THREE from 'three';
import { camera } from '../scene.js';

let timerEl = null;
let scoreEl = null;

// ── Init / destroy ─────────────────────────────────────────────────────────────

export function initParkingUI() {
    // Minuterie (grand compte à rebours, centré en haut)
    timerEl = document.createElement('div');
    timerEl.id = 'parking-timer';
    timerEl.style.cssText = `
        position:absolute; top:18px; left:50%; transform:translateX(-50%);
        font-size:52px; font-weight:900; color:#fff;
        text-shadow: 0 0 20px rgba(0,0,0,0.8), 2px 2px 0 rgba(0,0,0,0.6);
        font-family: 'Segoe UI', sans-serif; letter-spacing:4px;
        pointer-events:none; z-index:100;
    `;
    document.body.appendChild(timerEl);

    // Panneau de scores (bas centre)
    scoreEl = document.createElement('div');
    scoreEl.id = 'parking-score';
    scoreEl.style.cssText = `
        position:absolute; bottom:20px; left:50%; transform:translateX(-50%);
        display:flex; gap:12px; flex-wrap:wrap; justify-content:center;
        pointer-events:none; z-index:100;
    `;
    document.body.appendChild(scoreEl);
}

export function hideParkingUI() {
    if (timerEl) { timerEl.remove(); timerEl = null; }
    if (scoreEl) { scoreEl.remove(); scoreEl = null; }
}

// ── Mises à jour chaque frame ──────────────────────────────────────────────────

export function updateParkingTimer(secondsLeft, phase) {
    if (!timerEl) return;
    const s = Math.ceil(secondsLeft);
    timerEl.textContent =
        phase === 'racing' ? `${s}s` :
        phase === 'go'     ? 'GO !'  :
        phase === 'ready'  ? 'PRÊTS ?' :
        '⏱ ' + s + 's';
    timerEl.style.color = (s <= 10 && phase === 'racing') ? '#ff4444' : '#ffffff';
}

export function updateParkingScores(players, scores) {
    if (!scoreEl) return;
    let html = '';
    for (const [id, p] of players) {
        if (!p.car) continue;
        const sc       = scores.get(id);
        const pts      = sc ? sc.total : '—';
        const spotType = sc && sc.spot
            ? (sc.spot.type === 'creneau' ? '↕ Créneau' : '↗ Bataille')
            : '—';
        html += `
            <div style="background:rgba(0,0,0,0.6);border-left:4px solid ${_esc(p.colorHex ?? '#ffffff')};
                border-radius:8px;padding:8px 14px;color:#fff;font-family:sans-serif;min-width:120px;backdrop-filter:blur(6px)">
                <div style="font-size:11px;opacity:0.7">${_esc(p.name ?? 'Joueur')}</div>
                <div style="font-size:26px;font-weight:900">${pts}</div>
                <div style="font-size:10px;opacity:0.6">${spotType}</div>
            </div>`;
    }
    scoreEl.innerHTML = html;
}

function _esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Sprites 3D (score flottant au-dessus des voitures) ────────────────────────

const _scoreSprites = new Map(); // playerId → sprite

export function updateScoreSprites(players, scores, scene) {
    for (const [id, p] of players) {
        if (!p.car) continue;
        const sc = scores.get(id);
        if (!sc || sc.total === 0) { _hideSprite(id, scene); continue; }

        let spr = _scoreSprites.get(id);
        if (!spr) {
            const canvas = document.createElement('canvas');
            canvas.width  = 192;
            canvas.height = 64;
            const tex = new THREE.CanvasTexture(canvas);
            const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false });
            spr              = new THREE.Sprite(mat);
            spr.scale.set(5, 1.7, 1);
            spr.renderOrder  = 998;
            spr._canvas      = canvas;
            scene.add(spr);
            _scoreSprites.set(id, spr);
        }

        // Redessiner le canvas du sprite
        const ctx = spr._canvas.getContext('2d');
        ctx.clearRect(0, 0, 192, 64);
        ctx.font          = 'bold 38px Arial';
        ctx.textAlign     = 'center';
        ctx.textBaseline  = 'middle';
        ctx.strokeStyle   = 'rgba(0,0,0,0.9)';
        ctx.lineWidth     = 6;
        ctx.strokeText(sc.total + ' pts', 96, 32);
        ctx.fillStyle     = '#ffdd00';
        ctx.fillText(sc.total + ' pts', 96, 32);
        spr.material.map.needsUpdate = true;

        // Positionner au-dessus de la voiture
        spr.position.set(
            p.car.position.x,
            p.car.position.y + 5.5,
            p.car.position.z,
        );
    }
}

function _hideSprite(id, scene) {
    const spr = _scoreSprites.get(id);
    if (spr) {
        scene.remove(spr);
        spr.material.map.dispose();
        spr.material.dispose();
        _scoreSprites.delete(id);
    }
}

export function disposeScoreSprites(scene) {
    for (const [id] of _scoreSprites) _hideSprite(id, scene);
}
