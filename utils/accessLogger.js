const AccessLog = require('../schemas/accessLog');

/**
 * Scrive un log di accesso.
 * @param {Object} params
 * @param {ObjectId|null} params.user - ID utente (può essere null)
 * @param {string} params.action - Azione eseguita (es: LOGIN, LOGOUT, ACCESS_RESOURCE)
 * @param {string} params.resource - Risorsa coinvolta
 * @param {string} params.outcome - SUCCESS o FAILURE
 * @param {string} [params.ipAddress] - IP dell'utente
 * @param {string} [params.userAgent] - User agent
 * @param {string} [params.details] - Dettagli aggiuntivi
 */
async function logAccess({ user, action, resource, outcome, ipAddress, userAgent, details }) {
  try {
    await AccessLog.create({
      user,
      action,
      resource,
      outcome,
      ipAddress,
      userAgent,
      details,
    });
  } catch (err) {
    console.error('Errore nel salvataggio del log di accesso:', err);
  }
}

module.exports = logAccess; 