# API — Operations (`/`, routes/operations.js)

Protette da JWT.

- POST `/addOperation`
  - Body: `{ name, numero_palo, email, id_segnalazione|null, operation_type, note, is_solved, date, maintenance_type }`
  - Flusso:
    - Trova comune per `name`
    - Carica punti luce e trova quello con `numero_palo`
    - Trova `users` per `email`
    - Se `id_segnalazione` presente, collega l'operazione al report e, se `is_solved`, sposta il report da "in corso" a "risolte"
    - Salva `operations` e aggiorna `light_points` e `townHalls`
    - Log accessi `ADD_OPERATION`
  - 200: conferma
  - 404: comune/punto/utente/segnalazione non trovati

- GET `/api/avg-time-report-operation/:comune`
  - Calcola tempo medio (ms/ore) tra `report_date` e prima `operation.is_solved` per i report risolti nel comune.
  - 200: `{ avgTimeMs, avgTimeHours, count }`
  - 404: comune o punti luce non trovati
