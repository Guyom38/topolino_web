// ── HUD principal : visages joueurs + QR code + debug caméra ─────────────────

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

    // Petit QR en haut à droite
    const el = document.getElementById('qr-canvas');
    if (el) new QRCode(el, { text: url, width: 80, height: 80,
        colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
    const lbl = document.getElementById('qr-label');
    if (lbl) lbl.textContent = url.replace(/^https?:\/\//, '');

    // Grand QR dans l'overlay d'attente
    const big = document.getElementById('waiting-qr');
    if (big) new QRCode(big, { text: url, width: 240, height: 240,
        colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
    const wu = document.getElementById('waiting-url');
    if (wu) wu.textContent = url.replace(/^https?:\/\//, '');
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
    const now = performance.now();
    _updateFPS();
    _updatePlayerCards(players);
    _updateWaiting(players);
    for (const p of players.values()) {
        if (p.girophare) p.girophare.update(now);
    }
}

function _updateWaiting(players) {
    const overlay = document.getElementById('waiting-screen');
    if (!overlay) return;
    const hasAnyCar = Array.from(players.values()).some(p => p.car);
    overlay.classList.toggle('hidden', hasAnyCar);
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
const _cardEls    = new Map(); // playerId → { card, face, nameEl, scoreEl }
const _imgCache   = new Map(); // playerId → HTMLImageElement[]
const _avatarImgs = new Map(); // avatarName → HTMLImageElement

function _ensureAvatarImg(avatarName) {
    if (!avatarName || _avatarImgs.has(avatarName)) return;
    const img = new Image();
    img.src = `Asssets/avatars/${avatarName}.png`;
    _avatarImgs.set(avatarName, img);
}

function _ensureImages(p) {
    if (_imgCache.has(p.id)) {
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

const FACE_W = 90, FACE_H = 112;

function _getCard(p, hud) {
    if (_cardEls.has(p.id)) return _cardEls.get(p.id);

    const card = document.createElement('div');
    Object.assign(card.style, {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: 'rgba(0,0,0,0.55)', borderRadius: '12px',
        padding: '6px 6px 5px',
        backdropFilter: 'blur(6px)',
        minWidth: (FACE_W + 12) + 'px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        overflow: 'hidden',
    });

    // Canvas visage (rectangle buste)
    const face = document.createElement('canvas');
    face.width  = FACE_W;
    face.height = FACE_H;
    Object.assign(face.style, {
        width: FACE_W + 'px', height: FACE_H + 'px',
        borderRadius: '8px',
        display: 'block',
    });

    // Trait coloré
    const line = document.createElement('div');
    Object.assign(line.style, {
        width: '100%', height: '3px', margin: '4px 0 3px',
        background: p.colorHex, borderRadius: '2px',
    });

    const nameEl = document.createElement('div');
    Object.assign(nameEl.style, {
        color: '#fff', fontSize: '13px', fontWeight: '800',
        maxWidth: (FACE_W + 8) + 'px', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textAlign: 'center', letterSpacing: '0.5px',
    });
    nameEl.textContent = p.name;

    const scoreEl = document.createElement('div');
    Object.assign(scoreEl.style, {
        color: '#ffcc00', fontSize: '17px', fontWeight: '900',
        textAlign: 'center', lineHeight: '1', minHeight: '20px',
    });
    scoreEl.textContent = '0';

    card.append(face, line, nameEl, scoreEl);
    hud.appendChild(card);

    const el = { card, face, line, nameEl, scoreEl };
    _cardEls.set(p.id, el);
    return el;
}

function _drawFace(canvas, p) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // 1) Avatar sprite sheet (grille 3×2)
    const avatarImg = p.avatar ? _avatarImgs.get(p.avatar) : null;
    if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
        const col = p.expressionIndex % 3;
        const row = Math.floor(p.expressionIndex / 3);
        const cellW = avatarImg.naturalWidth  / 3;
        const cellH = avatarImg.naturalHeight / 2;
        // Petit inset pour éviter le bleed entre cellules
        const inset = 2;
        const sx = col * cellW + inset;
        const sy = row * cellH + inset;
        const sw = cellW - inset * 2;
        const sh = cellH - inset * 2;
        ctx.drawImage(avatarImg, sx, sy, sw, sh, 0, 0, w, h);
    }
    // 2) Photos mobile (ancien système)
    else {
        const imgs = _imgCache.get(p.id);
        const img  = imgs && imgs[p.expressionIndex];
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, w, h);
        } else {
            // Fallback : fond couleur + initiale
            ctx.fillStyle = p.colorHex;
            ctx.fillRect(0, 0, w, h);
            ctx.font         = 'bold 40px Arial';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle    = 'rgba(255,255,255,0.9)';
            ctx.fillText((p.name[0] || '?').toUpperCase(), w / 2, h / 2);
        }
    }

    // Couronne si bagage
    if (p.hasLuggage) {
        ctx.font      = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('👑', w / 2, 16);
    }
}

function _updatePlayerCards(players) {
    const hud = _getHud();

    // Déterminer le leader et le dernier
    let maxHits = -1, minHits = Infinity;
    let carCount = 0;
    for (const p of players.values()) {
        if (!p.car) continue;
        carCount++;
        const h = p.hitCount ?? 0;
        if (h > maxHits) maxHits = h;
        if (h < minHits) minHits = h;
    }

    for (const [id, p] of players) {
        if (!p.car) continue;

        if (p.avatar) _ensureAvatarImg(p.avatar);
        if (p.photos.length > 0) _ensureImages(p);

        const el = _getCard(p, hud);

        // Expression
        const hits = p.hitCount ?? 0;
        const isLeading = hits >= maxHits && maxHits > 0;
        const isLast    = carCount > 1 && hits <= minHits && maxHits > minHits;
        p.updateExpression(isLeading, isLast);

        // Visage
        _drawFace(el.face, p);

        // Méta
        el.nameEl.textContent       = p.name;
        el.line.style.background    = p.colorHex;
        el.scoreEl.textContent      = hits;
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

