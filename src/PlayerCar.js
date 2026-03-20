import * as THREE from 'three';
import { scene } from './scene.js';

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

        // ── Mode voleur de bagage ─────────────────────────────────────────────
        this.hasLuggage        = false;
        this.luggageMeshes     = []; // Rempli lors du loadCarForPlayer
        this.luggageScore      = 0;  // secondes de possession accumulées
        this._luggageGotTime   = 0;  // performance.now() quand on a pris le bagage

        // ── Expressions (photos capturées sur mobile) ─────────────────────────
        // 0=neutre 1=souriant 2=excité 3=en_colère 4=concentré 5=victoire
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

    /** Met à jour l'expression en fonction des événements récents et du contexte */
    updateExpression(isLeading) {
        const now   = performance.now();
        const ts    = this._exprTimestamps;
        const speed = Math.abs(this.carSpeed);

        // Priorité : victoire > excité (vol de bagage) > en colère > souriant > concentré > neutre
        if (isLeading)                                 { this.expressionIndex = 5; return; } // victoire
        if (ts.hitOther && now - ts.hitOther < 2500)   { this.expressionIndex = 2; return; } // excité
        if (ts.gotHit   && now - ts.gotHit   < 2500)   { this.expressionIndex = 3; return; } // en colère
        if (this.hasLuggage)                           { this.expressionIndex = 1; return; } // souriant
        if (speed > 0.18)                              { this.expressionIndex = 4; return; } // concentré
        this.expressionIndex = 0; // neutre
    }

    // ── Label de nom ─────────────────────────────────────────────────────────

    createNameLabel() {
        const canvas  = document.createElement('canvas');
        canvas.width  = 256;
        canvas.height = 64;
        this._nameCanvas = canvas;
        this._drawName();

        const tex    = new THREE.CanvasTexture(canvas);
        const mat    = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(4.5, 1.1, 1);
        sprite.renderOrder = 999;
        this._nameSprite = sprite;
        scene.add(sprite);
    }

    _drawName() {
        const ctx = this._nameCanvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 64);
        ctx.font         = 'bold 30px Arial';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle  = 'rgba(0,0,0,0.9)';
        ctx.lineWidth    = 6;
        ctx.strokeText(this.name, 128, 32);
        ctx.fillStyle = 'white';
        ctx.fillText(this.name, 128, 32);
    }

    updateNameLabel() {
        if (!this._nameSprite || !this.car) return;
        this._nameSprite.position.set(
            this.car.position.x,
            this.car.position.y + (this.carVisual.position.y || 0) + 3.8,
            this.car.position.z
        );
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

    // ── Nettoyage ─────────────────────────────────────────────────────────────

    dispose() {
        if (this.car)         scene.remove(this.car);
        if (this._nameSprite) {
            scene.remove(this._nameSprite);
            this._nameSprite.material.map.dispose();
            this._nameSprite.material.dispose();
        }
        if (this.shadow) this.shadow.dispose();
        if (this.tracks) this.tracks.dispose();
        if (this.aura)   this.aura.dispose();
    }
}
