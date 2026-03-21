// ── HUD principal : visages joueurs + QR code + debug caméra ─────────────────
import { getCameraDebug } from './camera.js';

let qrGenerated = false;

export function initUI() {
    fetch('/api/info')
        .then(r => r.json())
        .then(data => _generateQR(data.server_url + '/mobile'))
        .catch(() => _generateQR(window.location.origin + '/mobile'));
}

function _generateQR(url) {
    if (qrGenerated || typeof QRCode === 'undefined') return;
    qrGenerated = true;
    const el = document.getElementById('qr-canvas');
    if (!el) return;
    new QRCode(el, { text: url, width: 80, height: 80,
        colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
    const lbl = document.getElementById('qr-label');
    if (lbl) lbl.textContent = url.replace(/^https?:\/\//, '');
}

// ── FPS counter global ────────────────────────────────────────────────────────
let _fpsFrames = 0, _fpsLast = performance.now(), _fpsEl = null;
function _updateFPS() {
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLast >= 1000) {
        if (!_fpsEl) _fpsEl = document.getElementById('fps-counter');
        if (_fpsEl) _fpsEl.textContent = 'FPS: ' + Math.round(_fpsFrames * 1000 / (now - _fpsLast));
        _fpsLast   = now;
        _fpsFrames = 0;
    }
}

// ── Mise à jour HUD ──────────────────────────────────────────────────────────
export function updateUI(players) {
    _updateFPS();
    _updatePlayerCards(players);
    _updateCamDebug();
}

// ── Visages + scores ──────────────────────────────────────────────────────────
let _hudEl = null;

function _getHud() {
    if (_hudEl) return _hudEl;
    _hudEl = document.getElementById('players-hud');
    if (!_hudEl) {
        _hudEl = document.createElement('div');
        _hudEl.id = 'players-hud';
        Object.assign(_hudEl.style, {
            display: 'flex', flexDirection: 'column', gap: '8px',
            alignItems: 'center', marginTop: '8px',
            pointerEvents: 'none',
        });
        // Insérer sous le QR code si disponible, sinon fallback
        const qrWrap = document.getElementById('qr-wrap');
        if (qrWrap) qrWrap.appendChild(_hudEl);
        else document.body.appendChild(_hudEl);
    }
    return _hudEl;
}

// Cache des éléments DOM et images par joueur
const _cardEls  = new Map(); // playerId → { card, face, nameEl, scoreEl }
const _imgCache = new Map(); // playerId → HTMLImageElement[]

function _ensureImages(p) {
    if (_imgCache.has(p.id)) {
        // Rafraîchir si de nouvelles photos ont été reçues
        const cached = _imgCache.get(p.id);
        if (cached.length === p.photos.length) return;
    }
    const imgs = p.photos.map(src => {
        if (!src) return null;
        const img = new Image();
        img.src = src;
        return img;
    });
    _imgCache.set(p.id, imgs);
}

function _getCard(p, hud) {
    if (_cardEls.has(p.id)) return _cardEls.get(p.id);

    const card = document.createElement('div');
    Object.assign(card.style, {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        background: 'rgba(0,0,0,0.55)', borderRadius: '14px',
        padding: '8px 10px 7px',
        backdropFilter: 'blur(6px)',
        minWidth: '84px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    });

    // Canvas visage (cercle)
    const face = document.createElement('canvas');
    face.width  = 76;
    face.height = 76;
    Object.assign(face.style, {
        width: '76px', height: '76px', borderRadius: '50%',
        border: `5px solid ${p.colorHex}`, display: 'block',
        boxShadow: `0 0 0 2px rgba(0,0,0,0.5), 0 4px 14px rgba(0,0,0,0.6)`,
    });

    const nameEl = document.createElement('div');
    Object.assign(nameEl.style, {
        color: '#fff', fontSize: '12px', fontWeight: '700',
        maxWidth: '84px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textAlign: 'center',
    });
    nameEl.textContent = p.name;

    const scoreEl = document.createElement('div');
    Object.assign(scoreEl.style, {
        color: '#ffcc00', fontSize: '17px', fontWeight: '900',
        textAlign: 'center', lineHeight: '1', minHeight: '20px',
    });
    scoreEl.textContent = '0';

    card.append(face, nameEl, scoreEl);
    hud.appendChild(card);

    const el = { card, face, nameEl, scoreEl };
    _cardEls.set(p.id, el);
    return el;
}

function _drawFace(canvas, p) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 76, 76);

    ctx.save();
    ctx.beginPath();
    ctx.arc(38, 38, 38, 0, Math.PI * 2);
    ctx.clip();

    const imgs = _imgCache.get(p.id);
    const img  = imgs && imgs[p.expressionIndex];

    if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, 76, 76);
    } else {
        // Fallback : fond couleur + initiale
        ctx.fillStyle = p.colorHex;
        ctx.fillRect(0, 0, 76, 76);
        ctx.font         = 'bold 36px Arial';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle    = 'rgba(255,255,255,0.9)';
        ctx.fillText((p.name[0] || '?').toUpperCase(), 38, 38);
    }
    ctx.restore();

    // Couronne si bagage
    if (p.hasLuggage) {
        ctx.font      = '18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('👑', 38, 14);
    }
}

function _updatePlayerCards(players) {
    const hud = _getHud();

    // Déterminer le leader
    let maxHits = -1;
    for (const p of players.values()) if (p.car) maxHits = Math.max(maxHits, p.hitCount ?? 0);

    for (const [id, p] of players) {
        if (!p.car) continue;

        if (p.photos.length > 0) _ensureImages(p);

        const el = _getCard(p, hud);

        // Expression
        const isLeading = (p.hitCount ?? 0) >= maxHits && maxHits > 0;
        p.updateExpression(isLeading);

        // Visage
        _drawFace(el.face, p);

        // Méta
        el.nameEl.textContent     = p.name;
        el.face.style.borderColor = p.colorHex;
        el.scoreEl.textContent    = p.hitCount ?? 0;
    }

    // Supprimer les cartes des joueurs partis
    for (const [id] of _cardEls) {
        if (!players.has(id)) {
            _cardEls.get(id).card.remove();
            _cardEls.delete(id);
            _imgCache.delete(id);
        }
    }
}

/** Permet aux modes de jeu de surcharger le score affiché */
export function setPlayerScore(playerId, value) {
    const el = _cardEls.get(playerId);
    if (el) el.scoreEl.textContent = value;
}

// ── Debug caméra ─────────────────────────────────────────────────────────────
function _updateCamDebug() {
    const dbg = document.getElementById('cam-debug');
    if (!dbg) return;
    const c = getCameraDebug();
    dbg.textContent = `PHI ${c.phi}°  THETA ${c.theta}°  R ${c.radius}`;
}
