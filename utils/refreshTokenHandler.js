const jwt = require('jsonwebtoken');
const { signAccessToken } = require('../utils/jwtHelpers');

function handleRefreshToken(req, res) {
    const rememberMe = Boolean(req.user?.rememberMe);
    const token = signAccessToken(
        {
            _id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            surname: req.user.surname,
        },
        rememberMe
    );

    res.json({ token });
}

module.exports = { handleRefreshToken };
