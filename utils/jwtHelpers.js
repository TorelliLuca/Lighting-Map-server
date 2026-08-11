const jwt = require('jsonwebtoken');

const DEFAULT_SESSION_EXPIRES_IN = '8h';
const DEFAULT_REMEMBER_EXPIRES_IN = '30d';
const DEFAULT_SESSION_REFRESH_WINDOW = '24h';
const DEFAULT_REMEMBER_REFRESH_WINDOW = '30d';

function parseDurationToSeconds(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?$/i);
    if (!match) return 0;
    const amount = parseFloat(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
    return Math.floor(amount * (multipliers[unit] || 1));
}

function resolveExpiresIn(rememberMe) {
    if (rememberMe) {
        return process.env.JWT_REMEMBER_EXPIRES_IN || process.env.JWT_EXPIRES_IN || DEFAULT_REMEMBER_EXPIRES_IN;
    }
    return process.env.JWT_SESSION_EXPIRES_IN || process.env.JWT_EXPIRES_IN || DEFAULT_SESSION_EXPIRES_IN;
}

function resolveRefreshWindow(rememberMe) {
    if (rememberMe) {
        return process.env.JWT_REMEMBER_REFRESH_WINDOW || DEFAULT_REMEMBER_REFRESH_WINDOW;
    }
    return process.env.JWT_SESSION_REFRESH_WINDOW || DEFAULT_SESSION_REFRESH_WINDOW;
}

function signAccessToken(user, rememberMe = false) {
    return jwt.sign(
        {
            id: user._id,
            email: user.email,
            name: user.name,
            surname: user.surname,
            rememberMe: Boolean(rememberMe),
        },
        process.env.JWT_SECRET,
        { expiresIn: resolveExpiresIn(rememberMe) }
    );
}

function getRefreshGraceSeconds(rememberMe) {
    return parseDurationToSeconds(resolveRefreshWindow(rememberMe));
}

module.exports = {
    DEFAULT_SESSION_EXPIRES_IN,
    DEFAULT_REMEMBER_EXPIRES_IN,
    parseDurationToSeconds,
    resolveExpiresIn,
    resolveRefreshWindow,
    signAccessToken,
    getRefreshGraceSeconds,
};
