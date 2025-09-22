# API — Light Points (`/townHalls/lightPoints`, routes/lightPoints.js)

Protette da JWT.

- POST `/townHalls/lightPoints/update/:_id`
  - Autorizzazione: richiede `user_type === 'SUPER_ADMIN'` nel body.
  - Body: `{ user_type, light_point }` dove `light_point` è il documento (parziale o completo) da aggiornare.
  - 200: ritorna il punto luce aggiornato
  - 403: accesso negato
  - 404: punto luce non trovato

- POST `/townHalls/lightPoints/create`
  - Body: `{ light_point, town_hall, return_object? }`
  - Transazione Mongo:
    - crea `lightPoints`
    - pusha l'ID nel `townHalls.punti_luce`
  - 201: se `return_object === true` ritorna JSON del nuovo punto luce, altrimenti stringa di conferma

- DELETE `/townHalls/lightPoints/delete/:_id`
  - 200: punto luce eliminato e rimosso dal comune correlato
  - 404: non trovato

- GET `/townHalls/lightPoints/:_id`
  - 200: JSON del punto luce
  - 404: non trovato
