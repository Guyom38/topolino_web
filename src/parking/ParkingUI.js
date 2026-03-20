// ── Interface du mode parking ─────────────────────────────────────────────────
import * as THREE from 'three';

let _timerEl  = null;
let _scoreEl  = null;
const _wrongWayEls  = new Map(); // playerId → élément DOM
const _scoreSprites = new Map(); // playerId → Sprite

// ── Init / Hide ───────────────────────────────────────────────────────────────
export function initParkingUI() {
    // Chrono (grand, centré en haut)
    _timerEl = document.createElement('div');
    _timerEl.id = 'parking-timer';
    Object.assign(_timerEl.style, {
        position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '58px', fontWeight: '900', color: '#fff', letterSpacing: '4px',
        fontFamily: "'Segoe UI', sans-serif",
        textShadow: '0 0 24px rgba(0,0,0,0.9), 2px 3px 0 rgba(0,0,0,0.6)',
        pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(_timerEl);

    // Scores (bas, centré)
    _scoreEl = document.createElement('div');
    _scoreEl.id = 'parking-score';
    Object.assign(_scoreEl.style, {
        position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center',
        pointerEvents: 'none', zIndex: '100',
    });
    document.body.appendChild(_scoreEl);
}

export function hideParkingUI() {
    _timerEl?.remove();  _timerEl = null;
    _scoreEl?.remove();  _scoreEl = null;
    _wrongWayEls.forEach(el => el.remove());
    _wrongWayEls.clear();
}

// ── Chrono ────────────────────────────────────────────────────────────────────
export function updateParkingTimer(secondsLeft, phase) {
    if (!_timerEl) return;
    const s = Math.ceil(Math.max(0, secondsLeft));
    if (phase === 'ended') {
        _timerEl.textContent = '⏱ Terminé !';
        _timerEl.style.color = '#ffdd00';
    } else {
        _timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
        _timerEl.style.color = s <= 10 ? '#ff4444' : '#ffffff';
    }
}

// ── Scores ────────────────────────────────────────────────────────────────────
export function updateParkingScores(players, scores) {
    if (!_scoreEl) return;
    let html = '';
    for (const [id, p] of players) {
        if (!p.car) continue;
        const sc = scores.get(id);
        const pts      = sc?.total ?? '—';
        const spotType = sc?.spot ? (sc.spot.type === 'creneau' ? '↕ Créneau' : '↗ Bataille') : '—';
        html += `
        <div style="background:rgba(0,0,0,0.6);border-left:4px solid ${p.colorHex};
            border-radius:8px;padding:8px 14px;color:#fff;font-family:sans-serif;
            min-width:110px;text-align:center;backdrop-filter:blur(6px)">
            <div style="font-size:11px;opacity:0.7">${_esc(p.name)}</div>
            <div style="font-size:28px;font-weight:900">${pts}</div>
            <div style="font-size:10px;opacity:0.6">${spotType}</div>
        </div>`;
    }
    _scoreEl.innerHTML = html;
}

// ── Avertissement contresens ──────────────────────────────────────────────────
export function showWrongWay(playerId) {
    if (_wrongWayEls.has(playerId)) return;
    const el = document.createElement('div');
    Object.assign(el.style, {
        position: 'absolute', top: '90px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '32px', fontWeight: '900', color: '#ff2222', letterSpacing: '2px',
        fontFamily: "'Segoe UI', sans-serif",
        background: 'rgba(0,0,0,0.55)', borderRadius: '10px', padding: '6px 22px',
        textShadow: '0 0 12px rgba(255,0,0,0.8)',
        pointerEvents: 'none', zIndex: '200',
        animation: 'parkingBlink 0.5s step-end infinite',
    });
    el.textContent = '⚠ CONTRESENS !';
    document.body.appendChild(el);
    _wrongWayEls.set(playerId, el);
}

export function hideWrongWay(playerId) {
    const el = _wrongWayEls.get(playerId);
    if (el) { el.remove(); _wrongWayEls.delete(playerId); }
}

// ── Sprites 3D score (flottent au-dessus de chaque voiture) ──────────────────
export function updateScoreSprites(players, scores, scene) {
    for (const [id, p] of players) {
        if (!p.car) continue;
        const sc = scores.get(id);
        if (!sc || sc.total === 0) { _hideSprite(id, scene); continue; }

        let spr = _scoreSprites.get(id);
        if (!spr) {
            const cv = document.createElement('canvas');
            cv.width = 192; cv.height = 64;
            const tex = new THREE.CanvasTexture(cv);
            const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false });
            spr = new THREE.Sprite(mat);
            spr.scale.set(5.5, 1.8, 1);
            spr.renderOrder = 998;
            spr._canvas = cv;
            scene.add(spr);
            _scoreSprites.set(id, spr);
        }

        const ctx = spr._canvas.getContext('2d');
        ctx.clearRect(0, 0, 192, 64);
        ctx.font = 'bold 38px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 6;
        ctx.strokeText(sc.total + ' pts', 96, 32);
        ctx.fillStyle = '#ffdd00';
        ctx.fillText(sc.total + ' pts', 96, 32);
        spr.material.map.needsUpdate = true;
        spr.position.set(p.car.position.x, p.car.position.y + 5.5, p.car.position.z);
    }
}

export function disposeScoreSprites(scene) {
    for (const [id] of _scoreSprites) _hideSprite(id, scene);
}

function _hideSprite(id, scene) {
    const spr = _scoreSprites.get(id);
    if (!spr) return;
    scene.remove(spr);
    spr.material.map.dispose();
    spr.material.dispose();
    _scoreSprites.delete(id);
}

function _esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
