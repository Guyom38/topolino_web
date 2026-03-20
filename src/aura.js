import * as THREE from 'three';
import { scene } from './scene.js';

/**
 * Crée un cylindre d'aura "Dragon Ball Z"
 */
export function createAura(colorHex = '#ffff00') {
    const height = 10.0; // Environ 5-6 fois la hauteur de la voiture
    const radius = 2.5;
    const geometry = new THREE.CylinderGeometry(radius * 0.8, radius, height, 32, 1, true);
    
    // Pivot à la base
    geometry.translate(0, height / 2, 0);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            color: { value: new THREE.Color(colorHex) },
        },
        vertexShader: `
            varying vec2 vUv;
            varying float vHeight;
            uniform float time;
            void main() {
                vUv = uv;
                vHeight = position.y;
                // Distortion DBZ (vagues de chaleur)
                float wave = sin(position.y * 1.5 - time * 10.0) * 0.2;
                vec3 pos = position;
                pos.x += wave * (position.x / 2.5);
                pos.z += wave * (position.z / 2.5);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform vec3 color;
            varying vec2 vUv;
            varying float vHeight;

            void main() {
                // Scintillement rapide (flicker)
                float flicker = 0.7 + 0.3 * sin(time * 50.0);
                
                // Effet de balayage vertical (ora)
                float ora = pow(sin(vHeight * 0.4 - time * 20.0) * 0.5 + 0.5, 2.0);
                
                // Transparence DBZ : plus fort en bas, s'évapore en haut
                float fade = pow(1.0 - (vHeight / 10.0), 1.2);
                
                // Bordures du cylindre plus brillantes
                float edge = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 0.8);
                
                float alpha = (0.2 + ora * 0.8) * fade * flicker * edge * 0.7;
                
                // Couleur jaune DBZ coeur blanc
                vec3 finalColor = mix(color, vec3(1.0, 1.0, 0.7), ora * 0.6);
                
                gl_FragColor = vec4(finalColor, alpha);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);

    return {
        mesh,
        update(position, time) {
            mesh.position.copy(position);
            material.uniforms.time.value = time * 0.001;
        },
        setVisible(v) {
            mesh.visible = v;
        },
        dispose() {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
        }
    };
}
