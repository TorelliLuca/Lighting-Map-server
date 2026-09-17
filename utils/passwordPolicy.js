/**
 * Policy password allineata al frontend (SignIn / ResetPassword).
 * @param {unknown} password
 * @returns {string|null} messaggio di errore oppure null se valida
 */
function validatePasswordStrength(password) {
    if (typeof password !== 'string' || password.length < 8) {
        return 'La password deve essere di almeno 8 caratteri';
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
        return 'La password deve contenere almeno una lettera maiuscola, una minuscola e un numero';
    }
    return null;
}

/**
 * Normalizza email per lookup case-insensitive.
 * @param {unknown} email
 * @returns {string}
 */
function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

module.exports = {
    validatePasswordStrength,
    normalizeEmail,
};
