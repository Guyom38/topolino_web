// QR code (top-right) + scoreboard (top-left) + debug caméra

import { getCameraDebug } from './camera.js';

let qrGenerated = false;

export function initUI() {
    // Récupère l'IP réelle du serveur pour le QR code
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

    new QRCode(el, {
        text:       url,
        width:      96,
        height:     96,
        colorDark:  '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
    });

    const lbl = document.getElementById('qr-label');
    if (lbl) lbl.textContent = url.replace(/^https?:\/\//, '');
}

export function updateUI(players) {
    const el = document.getElementById('scoreboard');
    if (el) {
        let html = '';
        for (const [, p] of players) {
            if (!p.car) continue;
            const dot   = `<span class="sb-dot" style="background:${p.colorHex}"></span>`;
            const name  = `<span class="sb-name">${_esc(p.name)}</span>`;
            const hits  = `<span class="sb-hits">${p.hitCount} ✕</span>`;
            html += `<div class="sb-row">${dot}${name}${hits}</div>`;
        }
        el.innerHTML = html;
    }

    const dbg = document.getElementById('cam-debug');
    if (dbg) {
        const c = getCameraDebug();
        dbg.textContent = `PHI ${c.phi}°  THETA ${c.theta}°  R ${c.radius}`;
    }
}

function _esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
