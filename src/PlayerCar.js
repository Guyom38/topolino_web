import * as THREE from 'three';
import { scene, camera } from './scene.js';

export const COLLISION_RADIUS    = 1.8;   // rayon de collision (unités monde)
const       HIT_COOLDOWN         = 1200;  // ms min entre deux comptages de choc

export class PlayerCar {
    constructor(id, name, colorHex, isLocal = false) {
        this.id       = id;
        this.name     = name;
        this.colorHex = colorHex;
        this.colorInt = parseInt(colorHex.replace('#', ''), 16);
        this.isLocal  = isLocal;

        // ── Physique ──────────────────────────────────────────────────────────
        this.carSpeed        = 0;
        this.carAngle        = 0;
        this.steeringAngle   = 0;
        this.velocity        = new THREE.Vector3();
        this.verticalVelocity = 0;
        this.onGround        = true;
        this.suspY           = [0, 0, 0, 0];
        this.suspVel         = [0, 0, 0, 0];
        this._suspInit       = false;

        // ── Inputs ────────────────────────────────────────────────────────────
        this.keys = { up: false, down: false, left: false, right: false };

        // ── Three.js ─────────────────────────────────────────────────────────
        this.car         = null;           // Group racine (position physique)
        this.carVisual   = new THREE.Group(); // Group visuel (suspension, drift)
        this.wheelsFront = [];
        this.wheelsRear  = [];

        // ── Système de touches ────────────────────────────────────────────────
        this.hitCount        = 0;
        this.invincibleUntil = 0;

        // ── Label de nom ──────────────────────────────────────────────────────
        this._nameSprite = null;
        this._nameCanvas = null;

        // ── Systèmes traces / ombre / aura (injectés après chargement) ───────
        this.tracks = null;
        this.shadow = null;
        this.aura   = null;

        // ── Variante police ───────────────────────────────────────────────────
        this.isPolice  = false;
        this.aura   = null;
        this.brakeMeshes = []; // Meshes des phares stop

        // ── Mode voleur de bagage ─────────────────────────────────────────────
        this.hasLuggage        = false;
        this.luggageMeshes     = []; // Rempli lors du loadCarForPlayer
        this.luggageScore      = 0;  // secondes de possession accumulées
        this._luggageGotTime   = 0;  // performance.now() quand on a pris le bagage

        // ── Avatar & Expressions ─────────────────────────────────────────────
        // Grille 3×2 : [normal, colère, excité] / [surprise, dégoûté, sonné]
        // 0=normal 1=colère 2=excité 3=surprise 4=dégoûté 5=sonné
        this.avatar          = null; // nom fichier avatar (ex: 'Antonio')
        this.photos          = [];   // Array<string|null> (base64 JPEG, max 6)
        this.expressionIndex = 0;
        this._exprTimestamps = {};   // { hitOther, gotHit, luggage }
    }

    setLuggage(hasIt) {
        if (this.hasLuggage && !hasIt) {
            // Comptabiliser le temps de possession écoulé
            this.luggageScore += (performance.now() - this._luggageGotTime) / 1000;
        }
        this.hasLuggage = hasIt;
        this.luggageMeshes.forEach(m => { m.visible = hasIt; });

        // Aura UNIQUEMENT en mode poursuite (chase)
        const isChaseMode = new URLSearchParams(window.location.search).get('mode') === 'chase';
        if (this.aura) {
            this.aura.setVisible(hasIt && isChaseMode);
        }

        if (hasIt) {
            this._luggageGotTime = performance.now();
            this.invincibleUntil = performance.now() + HIT_COOLDOWN * 2;
        }
    }

    /** Score temps de possession (y compris session en cours) */
    getLuggageScore() {
        if (!this.hasLuggage) return this.luggageScore;
        return this.luggageScore + (performance.now() - this._luggageGotTime) / 1000;
    }

    // ── Invincibilité ─────────────────────────────────────────────────────────

    onHit() {
        const now = performance.now();
        if (now < this.invincibleUntil) return;
        this.hitCount++;
        this.invincibleUntil = now + HIT_COOLDOWN;
        this._exprTimestamps.gotHit = now;
    }

    onHitOther() {
        this._exprTimestamps.hitOther = performance.now();
    }

    setPhotos(photos) {
        this.photos = photos || [];
    }

    /** Met à jour l'expression en fonction des événements récents et du contexte
     *  Grille 3×2 : 0=normal 1=colère 2=excité 3=surprise 4=dégoûté 5=sonné
     *  Durée minimale d'une expression = 1s (sauf si une action prioritaire arrive)
     */
    updateExpression(isLeading, isLast = false) {
        const now = performance.now();
        const ts  = this._exprTimestamps;

        // Priorité : sonné (collision) > excité (premier) > dégoûté (dernier) > colère (touché autre) > surprise (bagage) > normal
        if (ts.gotHit   && now - ts.gotHit   < 2000) { this.expressionIndex = 5; return; } // sonné
        if (ts.hitOther && now - ts.hitOther < 2000)  { this.expressionIndex = 2; return; } // excité
        if (isLeading)                                { this.expressionIndex = 2; return; } // excité
        if (isLast)                                   { this.expressionIndex = 4; return; } // dégoûté
        if (this.hasLuggage)                          { this.expressionIndex = 3; return; } // surprise
        if (ts.gotHit && now - ts.gotHit < 4000)      { this.expressionIndex = 1; return; } // colère (après sonné)
        this.expressionIndex = 0; // normal
    }

    // ── Label de nom ─────────────────────────────────────────────────────────

    createNameLabel() {
        const canvas  = document.createElement('canvas');
        canvas.width  = 256;
        canvas.height = 64;
        this._nameCanvas = canvas;
        this._lastDrawnAngle = null;
        this._drawName();

        const tex    = new THREE.CanvasTexture(canvas);
        const mat    = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(4.8, 1.2, 1);
        sprite.renderOrder = 9999;
        this._nameSprite = sprite;
        scene.add(sprite);
    }

    _drawName() {
        const W = 256, H = 64;
        const ctx = this._nameCanvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        const cy = H / 2;
        const text = this.name;
        const angle = this._lastDrawnAngle ?? 0;
        const arrowR = 11; // rayon de la flèche
        const arrowSpace = arrowR * 2 + 8; // espace flèche + marge

        ctx.font = 'bold 28px Arial';
        const tw = ctx.measureText(text).width;
        const pw = tw + arrowSpace + 28, ph = 38;
        const r = ph / 2;
        const px = (W - pw) / 2; // x gauche du pill

        // Ombre portée
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        // Fond pill couleur véhicule
        ctx.beginPath();
        ctx.roundRect(px, cy - ph / 2, pw, ph, r);
        ctx.fillStyle = this.colorHex;
        ctx.fill();
        ctx.restore();

        // Bordure blanche
        ctx.beginPath();
        ctx.roundRect(px, cy - ph / 2, pw, ph, r);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // ── Flèche dans le pill (à gauche du texte) ──
        const arrowCx = px + r + 2;
        ctx.save();
        ctx.translate(arrowCx, cy);
        ctx.rotate(-angle + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -arrowR);
        ctx.lineTo(-arrowR * 0.65, arrowR * 0.5);
        ctx.lineTo(0, arrowR * 0.15);
        ctx.lineTo(arrowR * 0.65, arrowR * 0.5);
        ctx.closePath();
        // Contour sombre épais pour détacher du fond
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 4;
        ctx.stroke();
        // Remplissage blanc
        ctx.fillStyle = '#fff';
        ctx.fill();
        // Contour blanc fin par-dessus
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Texte blanc (décalé à droite de la flèche)
        const textCx = arrowCx + arrowR + 4 + tw / 2;
        ctx.font         = 'bold 28px Arial';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle  = 'rgba(0,0,0,0.7)';
        ctx.lineWidth    = 4;
        ctx.strokeText(text, textCx, cy);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, textCx, cy);
    }

    updateNameLabel() {
        if (!this._nameSprite || !this.car) return;
        this._nameSprite.position.set(
            this.car.position.x,
            this.car.position.y + (this.carVisual.position.y || 0) + 3.2,
            this.car.position.z
        );

        // Mettre à jour la flèche selon l'orientation relative à la caméra
        const camAngle = Math.atan2(
            camera.position.x - this.car.position.x,
            camera.position.z - this.car.position.z
        );
        const relAngle = this.carAngle - camAngle;
        if (this._lastDrawnAngle === null || Math.abs(relAngle - this._lastDrawnAngle) > 0.08) {
            this._lastDrawnAngle = relAngle;
            this._drawName();
            this._nameSprite.material.map.needsUpdate = true;
        }
    }

    setName(name) {
        this.name = name;
        if (this._nameCanvas) {
            this._drawName();
            this._nameSprite.material.map.needsUpdate = true;
        }
    }

    setColor(colorHex) {
        this.colorHex = colorHex;
        this.colorInt = parseInt(colorHex.replace('#', ''), 16);
        if (this._nameCanvas) {
            this._drawName();
            this._nameSprite.material.map.needsUpdate = true;
        }
        if (!this.car) return;
        this.car.traverse(c => {
            if (!c.isMesh) return;
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach(m => { if (m.userData.isBodyColor) m.color.set(this.colorInt); });
        });
    }

    respawn(x = 0, y = 20, z = 0) {
        if (!this.car) return;
        this.car.position.set(x, y, z);
        this.velocity.set(0, 0, 0);
        this.carSpeed = 0;
        this.verticalVelocity = 0;
    }

    setBrakeLights(active) {
        const intensity = active ? 5.0 : 0.05;
        this.brakeMeshes.forEach(m => {
            if (m.material && m.material.emissive) {
                m.material.emissiveIntensity = intensity;
            }
        });
    }

    // ── Nettoyage ─────────────────────────────────────────────────────────────

    dispose() {
        if (this.car)         scene.remove(this.car);
        if (this._nameSprite) {
            scene.remove(this._nameSprite);
            this._nameSprite.material.map.dispose();
            this._nameSprite.material.dispose();
        }
        if (this.shadow)    this.shadow.dispose();
        if (this.tracks)    this.tracks.dispose();
        if (this.aura)      this.aura.dispose();
        if (this.girophare) this.girophare.dispose();
    }
}
