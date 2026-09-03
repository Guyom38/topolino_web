const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = 8090;

// Augmenter la limite pour les images en Base64
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Créer le dossier uploads s'il n'existe pas
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Endpoint pour recevoir les photos
app.post('/upload', (req, res) => {
    const { playerId, photos, pseudo, color } = req.body;
    
    if (!playerId || !photos) {
        return res.status(400).send('Données manquantes');
    }

    const playerFolder = path.join(uploadDir, playerId);
    if (!fs.existsSync(playerFolder)) {
        fs.mkdirSync(playerFolder);
    }

    // Sauvegarder chaque photo
    Object.keys(photos).forEach(expr => {
        const base64Data = photos[expr].replace(/^data:image\/jpeg;base64,/, "");
        fs.writeFileSync(path.join(playerFolder, `${expr}.jpg`), base64Data, 'base64');
    });

    // Sauvegarder les infos du joueur
    fs.writeFileSync(path.join(playerFolder, `info.json`), JSON.stringify({ pseudo, color }));

    console.log(`[OK] Photos enregistrées pour ${pseudo} (${playerId})`);
    res.send({ status: 'success', message: 'Photos enregistrées' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`--- SERVEUR TOPOLINO LANCÉ ---`);
    console.log(`Local : http://localhost:${PORT}`);
    console.log(`Mobile : http://VOTRE_IP_LOCALE:${PORT}/controller.html`);
});
