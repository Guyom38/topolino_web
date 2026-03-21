import * as THREE from 'three';
import { camera } from './scene.js';

// ── Flèches hors-écran : affiche une flèche + nom en bord d'écran ─────────────

const _frustum  = new THREE.Frustum();
const _projMat  = new THREE.Matrix4();
const _testPt   = new THREE.Vector3();

let _container  = null;           // div racine
const _arrows   = new Map();      // playerId → élément DOM

function _ensureContainer() {
    if (_container) return;
    _container = document.createElement('div');
    Object.assign(_container.style, {
        position: 'fixed', inset: '0',
        pointerEvents: 'none', zIndex: '150', overflow: 'hidden',
    });
    document.body.appendChild(_container);
}

function _worldToScreen(pos) {
    const v = pos.clone().project(camera);
    return {
        x:      (v.x  + 1) / 2 * window.innerWidth,
        y:      (-v.y + 1) / 2 * window.innerHeight,
        behind: v.z >= 1,
    };
}

function _edgePos(sx, sy, behind) {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    let dx = sx - cx, dy = sy - cy;
    if (behind) { dx = -dx; dy = -dy; }
    const margin = 62;
    const maxX = cx - margin, maxY = cy - margin;
    const scale = Math.min(
        Math.abs(maxX / (dx || 0.001)),
        Math.abs(maxY / (dy || 0.001))
    );
    return {
        x:     cx + dx * scale,
        y:     cy + dy * scale,
        angle: Math.atan2(dy, dx) * 180 / Math.PI + 90,
    };
}

function _showArrow(p) {
    _ensureContainer();

    let el = _arrows.get(p.id);
    if (!el) {
        el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute',
            display:  'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
            pointerEvents: 'none',
        });

        // Triangle
        const tri = document.createElement('div');
        Object.assign(tri.style, {
            width: '0', height: '0',
            borderLeft:   '10px solid transparent',
            borderRight:  '10px solid transparent',
            borderBottom: `20px solid ${p.colorHex}`,
            filter: `drop-shadow(0 0 6px ${p.colorHex})`,
            flexShrink: '0',
        });

        // Nom
        const lbl = document.createElement('div');
        Object.assign(lbl.style, {
            color:      p.colorHex,
            fontSize:   '13px',
            fontWeight: '900',
            fontFamily: '"Arial Black", Arial, sans-serif',
            textShadow: '1px 1px 4px #000, -1px -1px 4px #000',
            lineHeight: '1',
            whiteSpace: 'nowrap',
        });
        lbl.textContent = p.name;

        el.appendChild(tri);
        el.appendChild(lbl);
        _container.appendChild(el);
        _arrows.set(p.id, el);
    }

    // Position sur le bord de l'écran
    const sp   = _worldToScreen(_testPt.clone());
    const edge = _edgePos(sp.x, sp.y, sp.behind);

    el.style.left      = `${edge.x}px`;
    el.style.top       = `${edge.y}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${edge.angle}deg)`;
    el.style.display   = 'flex';
}

function _hide(id) {
    const el = _arrows.get(id);
    if (el) el.style.display = 'none';
}

// ── Appeler chaque frame dans les modes qui en ont besoin ─────────────────────
export function updateOffscreenArrows(players) {
    _projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projMat);

    for (const [id, p] of players) {
        if (!p.car) { _hide(id); continue; }

        _testPt.set(p.car.position.x, p.car.position.y + 1, p.car.position.z);

        if (_frustum.containsPoint(_testPt)) {
            _hide(id);
        } else {
            _showArrow(p);
        }
    }

    // Nettoyer les joueurs déconnectés
    for (const [id] of _arrows) {
        if (!players.has(id)) {
            _arrows.get(id).remove();
            _arrows.delete(id);
        }
    }
}

export function disposeOffscreenArrows() {
    if (_container) { _container.remove(); _container = null; }
    _arrows.clear();
}
