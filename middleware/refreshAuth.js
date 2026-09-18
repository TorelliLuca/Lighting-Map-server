const jwt = require('jsonwebtoken');
const users = require('../schemas/users');
const { getRefreshGraceSeconds, ACCESS_TOKEN_PURPOSE } = require('../utils/jwtHelpers');
const { isSessionInvalidatedByPasswordChange } = require('./auth');

const authenticateForRefresh = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).send('Accesso negato');
    }

    jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true }, async (err, user) => {
        if (err) {
            return res.status(403).send('Token non valido');
        }

        if (user?.purpose && user.purpose !== ACCESS_TOKEN_PURPOSE) {
            return res.status(403).send('Token non valido');
        }

        const now = Math.floor(Date.now() / 1000);
        const graceSeconds = getRefreshGraceSeconds(Boolean(user.rememberMe));

        if (typeof user.exp === 'number' && user.exp + graceSeconds < now) {
            return res.status(401).send('Sessione scaduta');
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

module.exports = authenticateForRefresh;
