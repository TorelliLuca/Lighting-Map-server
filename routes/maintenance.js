// routes/maintenance.js
const express = require('express');
const router = express.Router();
const townHalls = require('../schemas/townHalls');
const lightPoints = require('../schemas/lightPoints');

// User e password da variabili d'ambiente per sicurezza
const ADMIN_USER = process.env.CLEANUP_USER;
const ADMIN_PASS = process.env.CLEANUP_PASSWORD;

// Middleware Basic Auth
function basicAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="Maintenance"');
        return res.status(401).send('Autenticazione richiesta');
    }
    const base64 = auth.split(' ')[1];
    const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');

    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Maintenance"');
    return res.status(401).send('Credenziali non valide');
}

router.post('/clean-orphan-lightpoints', basicAuth, async (req, res) => {
    let totalOrphans = 0;
    let totalUpdated = 0;
    const townHallsList = await townHalls.find({});
    for (const th of townHallsList) {
        if (!th.punti_luce || th.punti_luce.length === 0) continue;
        const validLightPoints = await lightPoints.find({ _id: { $in: th.punti_luce } }, { _id: 1 });
        const validIds = validLightPoints.map(lp => lp._id.toString());
        const orphans = th.punti_luce.filter(id => !validIds.includes(id.toString()));
        if (orphans.length > 0) {
            th.punti_luce = th.punti_luce.filter(id => validIds.includes(id.toString()));
            await th.save();
            totalOrphans += orphans.length;
            totalUpdated++;
        }
    }
    res.json({ comuni_aggiornati: totalUpdated, id_orfani_rimossi: totalOrphans });
});

module.exports = router;