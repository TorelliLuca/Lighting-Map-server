# Lighting Map Server

Server Node.js per la gestione di punti luce e segnalazioni per comuni.

## Struttura del Progetto

Il progetto è stato riorganizzato in una struttura modulare per una migliore manutenibilità e separazione delle responsabilità:

```
Lighting-Map-server-main/
├── config/                 # Configurazioni
│   ├── database.js        # Configurazione connessione MongoDB
│   └── email.js           # Configurazione email transporter
├── middleware/            # Middleware personalizzati
│   └── auth.js           # Middleware autenticazione JWT
├── routes/               # Route handlers
│   ├── auth.js          # Route autenticazione (login, registrazione)
│   ├── users.js         # Route gestione utenti
│   ├── townHalls.js     # Route gestione comuni
│   ├── lightPoints.js   # Route gestione punti luce
│   ├── reports.js       # Route gestione segnalazioni
│   ├── operations.js    # Route gestione operazioni
│   ├── email.js         # Route invio email
│   └── maps.js          # Route API mappe
├── utils/               # Utility functions
│   ├── emailHelpers.js  # Helper per template email
│   └── lightPointHelpers.js # Helper per punti luce
├── schemas/             # Modelli Mongoose
├── email/              # Template email
├── index.js            # File principale (entry point)
└── package.json
```

## Moduli Principali

### Config (`config/`)
- **database.js**: Gestisce la connessione a MongoDB
- **email.js**: Configura il transporter per l'invio di email

### Middleware (`middleware/`)
- **auth.js**: Middleware per l'autenticazione JWT

### Routes (`routes/`)
- **auth.js**: Gestisce login, admin login, registrazione utenti
- **users.js**: CRUD operazioni per utenti e gestione comuni associati
- **townHalls.js**: Gestione comuni e relativi punti luce
- **lightPoints.js**: Operazioni sui singoli punti luce
- **reports.js**: Gestione segnalazioni e download Excel
- **operations.js**: Gestione operazioni di manutenzione
- **email.js**: Invio email per notifiche
- **maps.js**: Integrazione con Google Maps API

### Utils (`utils/`)
- **emailHelpers.js**: Funzioni per la generazione di template email
- **lightPointHelpers.js**: Utility per la gestione dei punti luce

## Vantaggi della Ristrutturazione

1. **Separazione delle Responsabilità**: Ogni modulo ha una responsabilità specifica
2. **Manutenibilità**: Codice più facile da mantenere e debuggare
3. **Riusabilità**: I moduli possono essere riutilizzati in altri progetti
4. **Testabilità**: Ogni modulo può essere testato indipendentemente
5. **Scalabilità**: Facile aggiungere nuove funzionalità senza modificare il core

## Avvio del Server

```bash
npm install
npm start
```

Il server si avvia sulla porta 3000 (o quella specificata in `process.env.PORT`).

## Variabili d'Ambiente

Assicurati di avere configurato le seguenti variabili d'ambiente:
- `JWT_SECRET`: Chiave segreta per JWT
- `PASSWORD_DB`: Password database MongoDB
- `NAME_DB`: Nome database MongoDB
- `PASSWORD_MAIL`: Password email
- `GOOGLE_MAPS_APY_KEY`: Chiave API Google Maps
- `ADMIN_EMAIL`: Email amministratore
- `CORS_ORIGIN`: Origini CORS consentite 