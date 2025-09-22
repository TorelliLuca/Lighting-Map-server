# Middleware

- `middleware/auth.js` — Autenticazione JWT
  - Legge l'header `Authorization: Bearer <token>`.
  - Verifica `JWT_SECRET` via `jwt.verify`.
  - In caso di successo imposta `req.user` e chiama `next()`.
  - Errori:
    - 401 se il token è mancante
    - 403 se il token non è valido

- `middleware/accessLogger.js` — Access Logger (opzionale)
  - Uso: `router.get('/route', accessLogger('AZIONE'), handler)`.
  - Registra, al termine della risposta (`res.on('finish')`), un documento su `AccessLog` con:
    - `user` (da `req.user.id` se presente)
    - `action` (parametro passato o metodo HTTP)
    - `resource`, `outcome`, `ipAddress`, `userAgent`, `details`
  - Dipende da `utils/accessLogger.js`.
