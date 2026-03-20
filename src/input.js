// Touches clavier pour le joueur local
export const localKeys = { up: false, down: false, left: false, right: false, handbrake: false };

const keyMap = {
    // Flèches
    'ArrowUp':    'up',
    'ArrowDown':  'down',
    'ArrowLeft':  'left',
    'ArrowRight': 'right',
    
    // ZQSD / WASD (Basé sur la position physique KeyW = Z sur AZERTY)
    'KeyW': 'up',
    'KeyS': 'down',
    'KeyA': 'left',
    'KeyD': 'right',
    
    // Pour AZERTY spécifique si KeyW/KeyA ne suffit pas selon le navigateur
    'KeyZ': 'up',
    'KeyQ': 'left',

    // Frein à main
    'Space': 'handbrake'
};

window.addEventListener('keydown', e => {
    const action = keyMap[e.code];
    if (action) {
        localKeys[action] = true;
        // Empêcher le défilement de la page avec les flèches/espace
        if (['up', 'down', 'left', 'right', 'handbrake'].includes(action)) e.preventDefault();
    }
});

window.addEventListener('keyup', e => {
    const action = keyMap[e.code];
    if (action) {
        localKeys[action] = false;
    }
});
