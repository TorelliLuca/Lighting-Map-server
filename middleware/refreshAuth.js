const jwt = require('jsonwebtoken');
const { getRefreshGraceSeconds } = require('../utils/jwtHelpers');

const authenticateForRefresh = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).send('Accesso negato');
    }

    jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true }, (err, user) => {
        if (err) {
            return res.status(403).send('Token non valido');
        }

        const now = Math.floor(Date.now() / 1000);
        const graceSeconds = getRefreshGraceSeconds(Boolean(user.rememberMe));

        if (typeof user.exp === 'number' && user.exp + graceSeconds < now) {
            return res.status(401).send('Sessione scaduta');
        }

        req.user = user;
        next();
    });
};

module.exports = authenticateForRefresh;
