# API — Reports (`/`, routes/reports.js)

Protette da JWT.

- POST `/addReport`
  - Body: `{ name, numero_palo, report_type, description, date, user_creator_id }`
  - Flusso:
    - Trova il comune per `name`
    - Carica tutti i punti luce del comune
    - Cerca il punto con `numero_palo`
    - Crea un `report` e lo inserisce in `segnalazioni_in_corso` del punto luce
    - Aggiorna DB (light_points e townHalls)
    - Log accessi con `utils/accessLogger.js`
  - 200: conferma
  - 404: comune o punto luce non trovato

- POST `/api/downloadExcelReport`
  - Body: `{ segnalazioni_in_corso: [], segnalazioni_risolte: [], operazioni_effettuate: [] }`
  - 200: restituisce file Excel con tre fogli (titoli come i campi)
