# API — Town Halls (`/townHalls`, routes/townHalls.js)

Protette da JWT.

- POST `/townHalls/`
  - Crea un comune e (opzionale) carica i punti luce in batch (300/volta).
  - Body (estratto):
    - `name`, `region`, `province`, `coordinates: { lat, lng }`, `borders`
    - `light_points: [{ ...campi CSV... }]` — conversione campi gestita.
    - `userEmail` (per invio notifica di esito)
  - 200: creato (più email riepilogo successo)
  - 409: comune già esistente
  - 500: errore con invio email di dettaglio errore

- DELETE `/townHalls/:id`
  - Rimuove il comune, i punti luce associati e pulisce i riferimenti su utenti.
  - 200: conferma rimozione

- POST `/townHalls/update/`
  - Aggiorna massivamente i punti luce di un comune per nome.
  - Body: `{ name, light_points: [...] , userEmail }`
  - Normalizza i campi in ingresso, calcola differenze (eliminati/modificati/aggiunti), aggiorna in batch e invia email con Excel allegato (3 fogli: Eliminati, Modificati, Aggiunti).
  - 200: aggiornamento completato

- PATCH `/townHalls/lightPoints/update/:_id`
  - Body: JSON del punto luce da aggiornare (parziale o completo)
  - 200: documento aggiornato
  - 404: non trovato

- GET `/townHalls/`
  - Ritorna elenco dei comuni (collation it), con `light_points` = conteggio; nasconde array `punti_luce` completo.

- GET `/townHalls/:name`
  - Ritorna il comune popolando `punti_luce` e, ricorsivamente, le relazioni con `reports`, `operations`, `users`.

- GET `/townHalls/lightpoints/getActiveReports?name=...&numero_palo=...`
  - Restituisce le segnalazioni in corso per un numero palo specifico.

- GET `/townHalls/lightpoints/getPoint?name=...&numero_palo=...`
  - Restituisce il singolo punto luce del comune.

- GET `/townHalls/lightpoints/getPointGeoJSON?name=...&numero_palo=...`
  - Restituisce la feature GeoJSON del punto (geometry Point, properties = campi del punto luce senza lat/lng).

- GET `/townHalls/:name/geojson`
  - Restituisce una FeatureCollection GeoJSON con tutti i punti luce del comune.

- POST `/townHalls/api/downloadExcelTownHall`
  - Body: JSON del comune con `punti_luce` (array).
  - 200: file Excel generato (punti luce flat e ordinati per `numero_palo`).
