const logAccess = require('../utils/accessLogger');

/**
 * Middleware per loggare accessi a risorse protette.
 * Da usare dopo l'autenticazione.
 */
module.exports = function accessLogger(actionName) {
  return async function (req, res, next) {
    // Salva i dati per il log
    const user = req.user ? req.user._id : null; // req.user deve essere settato dal middleware di autenticazione
    const resource = req.originalUrl;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    // Dopo la risposta, logga l'esito
    res.on('finish', async () => {
      const outcome = res.statusCode < 400 ? 'SUCCESS' : 'FAILURE';
      const user = req.user ? req.user.id : null; // <-- Ricalcola qui!

      await logAccess({
        user,
        action: actionName || req.method,
        resource,
        outcome,
        ipAddress,
        userAgent,
        details: null,
      });
    });

    next();
  };
}; 