import * as THREE from 'three';
import { scene } from './scene.js';
import { settings } from './settings.js';

/**
 * Crée un cylindre d'aura très simple pour déboguer les erreurs de shader
 */
export function createAura(colorHex = '#ffff00') {
    const height = 10.0;
    const radius = 2.5;
    const geometry = new THREE.CylinderGeometry(radius * 0.8, radius, height, 32, 1, true);
    geometry.translate(0, height / 2, 0);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            color: { value: new THREE.Color(colorHex) },
        },
        vertexShader: `
            varying float vY;
            void main() {
                vY = position.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform vec3 color;
            varying float vY;
            void main() {
                float alpha = (1.0 - vY / 10.0) * 0.5;
                gl_FragColor = vec4(color, alpha);
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
            if (!settings.auras) { mesh.visible = false; return; }
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
