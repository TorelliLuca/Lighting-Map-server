# API — Users (`/users`, routes/users.js)

Protette da JWT (serve header `Authorization: Bearer <token>`).

- POST `/users/validateUser`
  - Body: `{ user_type: 'DEFAULT_USER'|'MAINTAINER'|'ADMINISTRATOR'|'SUPER_ADMIN', userId: string }`
  - 200: utente validato e mail inviata all'utente
  - 400/404/500: errori vari

- POST `/users/removeUserByID/:id`
  - 200: utente eliminato

- POST `/users/removeUser`
  - Body: `{ email }`
  - 200: utente eliminato

- POST `/users/send-confirmation`
  - Body: `{ email }`
  - Rate limit 1/5min per email
  - 200: mail inviata

- POST `/users/update/modifyUser`
  - Body: `{ id, name?, surname?, user_type?, password? }`
  - 200: utente aggiornato

- POST `/users/addTownHalls`
  - Body: `{ email, townHall }`
  - 200: comune associato all'utente

- DELETE `/users/removeTownHalls`
  - Body: `{ email, townHall }`
  - 200: comune rimosso dall'utente

- GET `/users/`
  - 200: elenco utenti (ordinati per nome, collation it)

- GET `/users/getNotValidateUsers`
  - 200: elenco utenti non approvati

- GET `/users/:id`
  - 200: singolo utente

- GET `/users/getForEmail/:email`
  - 200: utente per email

- GET `/users/profile`
  - Loggato con `accessLogger('GET_PROFILE')`
  - 200: `{ user }` per `req.user.id`

- GET `/users/api/downloadCsv`
  - 200: download CSV con `;` e senza virgolette (usa `json2csv`)

- POST `/users/refresh-token`
  - 200: `{ token }` nuovo basato su `req.user`

- GET `/users/:id/lightPointsCount`
  - 200: `{ totalLightPoints, townhalls }`

- POST `/users/update-user-type`
  - Body: `{ userId, newUserType }`
  - 200: utente aggiornato
