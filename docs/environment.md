# Variabili d'Ambiente

Definisci le variabili in `.env.development` o `.env.production`.

- JWT
  - `JWT_SECRET` (obbligatorio): chiave segreta per firmare i token.
  - `JWT_EXPIRES_IN` (opzionale): es. `7d`, `1h`.

- Database
  - `PASSWORD_DB` (obbligatorio)
  - `NAME_DB` (obbligatorio)

- Email (SMTP)
  - `PASSWORD_MAIL` (obbligatorio)
  - `ADMIN_EMAIL` (obbligatorio): usato come mittente/contatto amministratore.

- CORS
  - `CORS_ORIGIN` (solo produzione): lista di origini separate da virgola.

- Google Maps
  - `GOOGLE_MAPS_APY_KEY` (attenzione al nome variabile nel codice `routes/maps.js`).

- Web Push (VAPID)
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`

- Maintenance (Basic Auth)
  - `CLEANUP_USER`
  - `CLEANUP_PASSWORD`

- Frontend
  - `FRONTEND_URL` (opzionale): usata nei link per conferma email e reset password.

- Server
  - `PORT` (opzionale)
  - `NODE_ENV` = `development` | `production`
