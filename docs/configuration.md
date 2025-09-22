# Configurazioni

- `config/database.js`
  - Esporta `connectDB()`: connette a MongoDB tramite Mongoose.
  - URI costruita con `PASSWORD_DB` e `NAME_DB`.
  - In caso di errore, log con `debug('lighting-map:DB')` e `process.exit(1)`.

- `config/email.js`
  - Configura `nodemailer` su SMTP Aruba (porta 465) con utente `sicurezza@torellistudio.com` e `PASSWORD_MAIL`.
  - Esporta: `transporter`, `emailLighting`, `debugMail`.

- VAPID Web Push
  - In `index.js`: `webpush.setVapidDetails(mailto:ADMIN_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)`
  - Richiesto per invio notifiche push in `routes/push.js`.
