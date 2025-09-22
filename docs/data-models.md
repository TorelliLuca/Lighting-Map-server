# Modelli Dati (Mongoose)

## users (`schemas/users.js`)
- `name: String`
- `surname: String`
- `email: String`
- `password: String` (hashed via `bcrypt`, pre-save)
- `date: Date` (default now)
- `user_type: 'DEFAULT_USER' | 'MAINTAINER' | 'ADMINISTRATOR' | 'SUPER_ADMIN'`
- `town_halls_list: ObjectId[] (ref: townHalls)`
- `is_approved: Boolean`
- `emailVerified: Boolean`
- `resetPasswordToken: String|null`
- `resetPasswordExpires: Date|null`
- `id_organization: ObjectId|null (ref: organizations)`

Metodi:
- `comparePassword(plain: string): Promise<boolean>`

## townHalls (`schemas/townHalls.js`)
- `name: String (required)`
- `region: String`
- `province: String`
- `borders: ObjectId (ref: borders)`
- `coordinates: { lat: Number, lng: Number, type: 'Point' }`
- `punti_luce: ObjectId[] (ref: lightPoints)`
- `created_at: Date`
- `updated_at: Date` (auto-aggiornato in pre-save)
- `organization_admin: ObjectId (ref: organizations)`
- `organizations_maintainers: ObjectId[] (ref: organizations)`

## lightPoints (`schemas/lightPoints.js`)
Campi descrittivi del punto luce, tutti `String` (default "") salvo:
- `segnalazioni_in_corso: ObjectId[] (ref: reports)`
- `segnalazioni_risolte: ObjectId[] (ref: reports)`
- `operazioni_effettuate: ObjectId[] (ref: operations)`
- `data_creazione: Date`

Hook post-delete:
- alla cancellazione, rimuove l'ID da `townHalls.punti_luce`.

## reports (`schemas/reports.js`)
- `operation_point_id: ObjectId (ref: lightPoints)`
- `user_creator_id: ObjectId (ref: users)`
- `user_responsible_id: ObjectId|null (ref: users)`
- `report_date: Date`
- `report_time: String` (HH:MM)
- `report_type: enum` ("LIGHT_POINT_OFF", "PLANT_OFF", "DAMAGED_COMPLEX", "DAMAGED_SUPPORT", "BROKEN_TERMINAL_BLOCK", "BROKEN_PANEL", "OTHER")
- `description: String`
- `is_solved: Boolean`

## operations (`schemas/operations.js`)
- `operation_point_id: ObjectId (ref: lightPoints)`
- `operation_date: Date`
- `operation_responsible: ObjectId (ref: users)`
- `operation_type: enum` ("MADE_SAFE_BUT_SYSTEM_NEEDS_RESTORING", "FAULT_ELIMINATED_AND_SYSTEM_RESTORED", "OTHER")
- `note: String`
- `report_to_solve: ObjectId (ref: reports)`
- `is_solved: Boolean`
- `maintenance_type: enum` ("ORDINARY", "EXTRAORDINARY")

## organizations (`schemas/organizations.js`)
- `name: String (required)`
- `description: String`
- `created_at: Date`
- `updated_at: Date`
- `logo: String`
- `members: ObjectId[] (ref: users)`
- `type: enum ('TOWNHALL' | 'ENTERPRISE')`
- `location: { type: 'Point', coordinates: [lng, lat] }`
- `address: { street, city, province, postal_code, state }`
- `responsible: ObjectId (ref: users)`
- `townhallId: ObjectId (ref: townHalls)`
- `contracts: [{ townhall_associated: ObjectId (ref: townHalls), start_date, end_date, details, price }]`

## borders (`schemas/borders.js`)
- Feature GeoJSON con `properties` (nome comune, codici ISTAT, ecc.) e `geometry` (Polygon), con indice geospaziale `2dsphere`.

## subscription (`schemas/subscription.js`)
- `endpoint: String (unique)`
- `keys: { p256dh: String, auth: String }`
- `userId: ObjectId (ref: users)`
- `browser: String`
- `isActive: Boolean`
- `createdAt: Date`
- `updatedAt: Date`
