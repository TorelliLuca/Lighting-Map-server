const crypto = require('crypto');

const EMAIL_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000; // 1 giorno

/**
 * Genera un token opaco (in chiaro per l'email) e il relativo hash da salvare in DB.
 */
function createEmailConfirmToken() {
    const rawToken = crypto.randomBytes(32).toString('hex');
    return {
        rawToken,
        hashedToken: hashEmailConfirmToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_CONFIRM_TTL_MS),
    };
}

function hashEmailConfirmToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

module.exports = {
    EMAIL_CONFIRM_TTL_MS,
    createEmailConfirmToken,
    hashEmailConfirmToken,
};
