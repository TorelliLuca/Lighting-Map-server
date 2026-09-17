const crypto = require('crypto');

const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000; // 1 ora

/**
 * Genera un token opaco (in chiaro per l'email) e il relativo hash da salvare in DB.
 */
function createResetPasswordToken() {
    const rawToken = crypto.randomBytes(32).toString('hex');
    return {
        rawToken,
        hashedToken: hashResetPasswordToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_PASSWORD_TTL_MS),
    };
}

function hashResetPasswordToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function getFrontendBaseUrl() {
    const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
    return String(raw).replace(/\/$/, '');
}

module.exports = {
    RESET_PASSWORD_TTL_MS,
    createResetPasswordToken,
    hashResetPasswordToken,
    getFrontendBaseUrl,
};
