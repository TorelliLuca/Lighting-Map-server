const jwt = require('jsonwebtoken');
const users = require('../schemas/users');
const { ACCESS_TOKEN_PURPOSE } = require('../utils/jwtHelpers');

function isSessionInvalidatedByPasswordChange(decoded, passwordChangedAt) {
    if (!passwordChangedAt || typeof decoded?.iat !== 'number') {
        return false;
    }
    const changedAtSeconds = Math.floor(new Date(passwordChangedAt).getTime() / 1000);
    // Scarta token emessi prima o nello stesso secondo del cambio password
    return decoded.iat <= changedAtSeconds;
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).send('Accesso negato');

    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).send('Token scaduto');
            }
            return res.status(403).send('Token non valido');
        }
        // Rifiuta JWT non di sessione (es. conferma email)
        if (user?.purpose && user.purpose !== ACCESS_TOKEN_PURPOSE) {
            return res.status(403).send('Token non valido');
        }
        try {
            const dbUser = await users.findById(user.id).select('passwordChangedAt').lean();
            if (!dbUser) {
                return res.status(401).send('Accesso negato');
            }
            if (isSessionInvalidatedByPasswordChange(user, dbUser.passwordChangedAt)) {
                return res.status(401).send('Sessione non più valida. Effettua di nuovo il login.');
            }
            req.user = user;
            next();
        } catch (e) {
            console.error(e);
            return res.status(500).send('Errore del server');
        }
    });
};

module.exports = authenticateToken;
module.exports.isSessionInvalidatedByPasswordChange = isSessionInvalidatedByPasswordChange;
