# Architettura

Questo backend è un server Node.js basato su `express` con MongoDB/Mongoose.

## Flusso di avvio
- **Caricamento env**: `index.js` seleziona `.env.production` oppure `.env.development` in base a `NODE_ENV`.
- **Connessione DB**: `config/database.js` connette a MongoDB usando `PASSWORD_DB` e `NAME_DB`.
- **Middleware globali**:
  - `bodyParser.json({ limit: "50mb" })`
  - `express-rate-limit` (finestra 1 minuto, max 500 req)
  - CORS: aperto in dev; in prod filtra su `CORS_ORIGIN`.
  - `webpush.setVapidDetails()` con chiavi VAPID.
- **Routing**:
  - Rotte pubbliche montate prima dell'autenticazione JWT
    - `/` → `routes/auth.js`
    - `/api/maintenance` → `routes/maintenance.js` (Basic Auth)
  - Autenticazione JWT applicata con `middleware/auth.js`
  - Rotte protette montate dopo JWT:
    - `/users` → `routes/users.js`
    - `/townHalls` → `routes/townHalls.js`
    - `/townHalls/lightPoints` → `routes/lightPoints.js`
    - `/` → `routes/reports.js`, `routes/operations.js`, `routes/email.js`
    - `/maps` → `routes/maps.js`
    - `/api/access-logs` → `routes/accessLogs.js`
    - `/api/push` → `routes/push.js`
    - `/organizations` → `routes/organizations.js`
    - `/borders` → `routes/borders.js`

## Sicurezza
- **JWT**: `middleware/auth.js` legge `Authorization: Bearer <token>`, verifica con `JWT_SECRET` e popola `req.user`.
- **Rate limiting**: globale in `index.js`; inoltre endpoint con limiti dedicati in `routes/auth.js` (reset password) e `routes/users.js` (invio conferma email).
- **Basic Auth**: per `POST /api/maintenance/clean-orphan-lightpoints` con `CLEANUP_USER`/`CLEANUP_PASSWORD`.
- **CORS**: configurazione per ambiente; intestazioni consentite `Authorization`, `Content-Type`.

## Logging accessi
- Middleware opzionale `middleware/accessLogger.js` e utility `utils/accessLogger.js` persistono i log su modello `schemas/accessLog` (non incluso qui, ma referenziato).

## Dati e relazioni principali
- `users` ↔ `townHalls` (array `town_halls_list`).
- `townHalls` ↔ `lightPoints` (array `punti_luce`).
- `lightPoints` ↔ `reports`/`operations` (riferimenti alle attività).
- `organizations` legate a `users` e `townHalls` (admin/maintainers, contratti).
- `borders` contiene feature GeoJSON dei confini comunali.
- `subscription` per Web Push notifiche.

## Notifiche ed Email
- Email via `nodemailer` configurato in `config/email.js`.
- Template HTML in `email/` richiamati da `utils/emailHelpers.js`.
- Web Push via `web-push`, chiavi VAPID richieste.
