# Utilità (utils/)

- `utils/utility.js`
  - `toCsvItalianStyle(data: Array<Object>): string`
    - Converte un array di oggetti in CSV con separatore `;` e senza virgolette.
  - `normalizeKeysToLowerCase(obj: Object): Object`
    - Rende tutte le chiavi dell'oggetto in minuscolo.
  - `isEmptyLightPoint(lp: Object): boolean`
    - Ritorna true se tutti i campi (tranne `_id`) sono vuoti/null/undefined.
  - `compareNumeroPalo(a, b): number`
    - Ordina con numeri prima delle stringhe; confronto alfabetico locale `it`.

- `utils/geometry.js`
  - `getPolygonCentroid(coordinates: Array<Array<number[]>>): { lat: number, lng: number }`
    - Calcola centroide approssimato di un poligono GeoJSON (media dei vertici).

- `utils/lightPointHelpers.js`
  - `getPuntoLuceById(id: ObjectId): Promise<LightPoint|null>`
  - `getAllPuntiLuce(ids: ObjectId[]): Promise<LightPoint[]>`

- `utils/emailHelpers.js`
  - Generazione HTML per email (conferma account, report, operazioni, reset password, validazione utente) e invio mail di conferma/reset.
  - Funzioni principali:
    - `returnHtmlEmail(username)`
    - `returnHtmlEmailAdmin(username, surname, date)`
    - `returnHtmlEmailAfterReport(user, date, townhallName, lightPoint, report)`
    - `returnHtmlEmailAfterOperation(user, date, townhallName, lightPoint, operation)`
    - `returnHtmlEmailUploadSuccess(nomeComune, batchStatus)` / `returnHtmlEmailUploadError(nomeComune, errore)`
    - `returnHtmlUserValidated(user, user_type)`
    - `sendConfirmationEmail(user)` (rate limit in-memory: 1/5min/email)
    - `sendResetPasswordEmail(user, resetUrl)`

- `utils/accessLogger.js`
  - `logAccess({ user, action, resource, outcome, ipAddress, userAgent, details })`
    - Persiste un record su `AccessLog`.
