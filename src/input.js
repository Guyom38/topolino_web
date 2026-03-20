// Touches clavier pour le joueur local
export const localKeys = { up: false, down: false, left: false, right: false };

window.addEventListener('keydown', e => {
    const key = e.code.replace('Arrow', '').toLowerCase();
    if (key in localKeys) localKeys[key] = true;
});
window.addEventListener('keyup', e => {
    const key = e.code.replace('Arrow', '').toLowerCase();
    if (key in localKeys) localKeys[key] = false;
});
