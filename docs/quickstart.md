# Quickstart

- Prerequisiti
  - Node.js >= 16
  - Variabili d'ambiente in `.env.development` o `.env.production`

- Installazione
```bash
npm install
```

- Avvio in sviluppo
```bash
npm start
```
Il server parte su `http://localhost:3000` (oppure sulla porta indicata da `PORT`).

- Variabili essenziali
Vedi `docs/environment.md` per l'elenco completo. Minimo richieste:
- `JWT_SECRET`
- `PASSWORD_DB`, `NAME_DB`
- `PASSWORD_MAIL`
- `ADMIN_EMAIL`

- Rotte pubbliche principali
- `POST /login`
- `POST /addPendingUser`
- `GET /confirm-email?token=...`
- `POST /api/maintenance/clean-orphan-lightpoints` (Basic Auth)

- Rotte protette
Tutte le altre dopo `authenticateToken` in `index.js`.
Aggiungere header: `Authorization: Bearer <JWT>`.

- Strumenti utili
- Rate limiting globale: `express-rate-limit` in `index.js`
- CORS: configurato dinamicamente per dev/prod
- Email: `config/email.js`
- DB: `config/database.js`
