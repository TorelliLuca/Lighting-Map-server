# API — Auth (`routes/auth.js`)

Tutte le rotte di questo file sono PUBBLICHE (montate prima del middleware JWT), salvo ove indicato.

- POST `/forgot-password`
  - Rate limit: 1 richiesta / 30s per email.
  - Body: `{ email: string }`
  - 200: risposta generica (per privacy) anche se l'email non esiste.
  - Effetto: genera token (1h) e invia email reset con link `FRONTEND_URL/reset-password?token=...`.

- POST `/reset-password`
  - Body: `{ token: string, password: string }`
  - 200: password aggiornata.
  - 400: token non valido/scaduto.

- POST `/login`
  - Body: `{ email: string, password: string }`
  - 200: `{ user, token }` con JWT (scadenza `JWT_EXPIRES_IN`).
  - 400: credenziali non valide, utente non approvato, o email non verificata (invia link di conferma).

- POST `/adminLogin`
  - Body: `{ email: string, password: string }`
  - 200: `{ user }` se `user_type === 'SUPER_ADMIN'`.
  - 400: permessi insufficienti o altre condizioni di validazione.

- POST `/addPendingUser`
  - Body: `{ name, surname, email, password }`
  - 201: utente creato in stato in attesa (non approvato, non verificato). Invia mail di conferma.
  - 400: email già in uso o body incompleto.

- GET `/confirm-email?token=...`
  - 200: email verificata.
  - 400/404: token mancante, non valido o utente non trovato.

- POST `/send-email-to-user/userNeedValidation`
  - Body: `{ user: { name, surname, date } }`
  - 200: email inviata all'ADMIN.

Note:
- Logging accessi su `/login` con `utils/accessLogger.js`.
- L'helper `sendConfirmationEmail(user)` impone rate limit in-memory 1/5 min per email.
