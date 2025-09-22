# API — Email (`/`, routes/email.js)

Protette da JWT.

- POST `/send-email-to-user/isApproved`
  - Body: `{ to: string, user: { name } }`
  - Invia email di approvazione account all'utente (template `emailBodies`).
  - 200: inviata

- POST `/send-email-to-user/lightPointReported`
  - Body: `{ name, user, date, light_point, report }`
  - Trova `townHalls` per `name`, individua destinatari (utenti `ADMINISTRATOR` e `SUPER_ADMIN` associati al comune), invia email notifica segnalazione aperta.
  - 200: inviata

- POST `/send-email-to-user/reportSolved`
  - Body: `{ name, user, date, light_point, operation }`
  - Come sopra, notifica un'operazione effettuata.
  - 200: inviata
