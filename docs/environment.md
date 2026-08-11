# Variabili d'Ambiente

Definisci le variabili in `.env.development` o `.env.production`.

- JWT
  - `JWT_SECRET` (obbligatorio): chiave segreta per firmare i token.
  - `JWT_EXPIRES_IN` (opzionale, fallback): es. `7d`, `1h`.
  - `JWT_SESSION_EXPIRES_IN` (opzionale): durata sessione senza "resta connesso" (default `8h`).
  - `JWT_REMEMBER_EXPIRES_IN` (opzionale): durata con "resta connesso" (default `30d`).
  - `JWT_SESSION_REFRESH_WINDOW` (opzionale): finestra refresh dopo scadenza sessione (default `24h`).
  - `JWT_REMEMBER_REFRESH_WINDOW` (opzionale): finestra refresh con "resta connesso" (default `30d`).

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

- Email assets (immagini newsletter / template)
  - `SERVER_PUBLIC_URL` (opzionale): base URL del backend se gli asset restano su disco locale (`/email-assets/...`).
  - Cloudflare R2 (consigliato in produzione; se tutte le variabili sotto sono presenti l'upload va su R2):
    - `R2_ACCOUNT_ID`
    - `R2_ACCESS_KEY_ID`
    - `R2_SECRET_ACCESS_KEY`
    - `R2_BUCKET_NAME` (es. `lighting-map-email-assets`)
    - `R2_PUBLIC_URL` (URL pubblico del bucket: `https://pub-….r2.dev` o dominio custom)

- Server
  - `PORT` (opzionale)
  - `NODE_ENV` = `development` | `production`
