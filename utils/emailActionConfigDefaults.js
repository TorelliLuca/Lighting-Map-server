function wrapEmail(title, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.07);padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#1a365d;font-size:22px;margin:0;">Lighting Map</h1>
    </div>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 16px;" />
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0;">Messaggio automatico — non rispondere a questa email.</p>
  </div>
</body>
</html>`;
}

const COMMON_USER = ['nome', 'cognome', 'email'];

const DEFAULT_ACTIONS = [
    {
        actionKey: 'EMAIL_CONFIRMATION',
        label: 'Conferma email',
        description: 'Invio link di conferma account. Non disattivabile.',
        enabled: true,
        locked: true,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Conferma il tuo account Lighting Map',
        bodyTemplate: wrapEmail('Conferma email', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Conferma il tuo indirizzo email cliccando sul link seguente:</p>
          <p style="text-align:center;margin:24px 0;"><a href="{{url_confirm}}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Conferma email</a></p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'url_confirm'],
    },
    {
        actionKey: 'PASSWORD_RESET',
        label: 'Reset password',
        description: 'Invio link di reset password. Non disattivabile.',
        enabled: true,
        locked: true,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Reimposta la password — Lighting Map',
        bodyTemplate: wrapEmail('Reset password', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Hai richiesto il reset della password. Usa il link seguente:</p>
          <p style="text-align:center;margin:24px 0;"><a href="{{link_reset}}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Reimposta password</a></p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'link_reset'],
    },
    {
        actionKey: 'ACCOUNT_APPROVED',
        label: 'Account abilitato',
        description: 'Notifica all\'utente che l\'account è stato approvato.',
        enabled: true,
        locked: true,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Account abilitato — Lighting Map',
        bodyTemplate: wrapEmail('Account abilitato', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Il tuo account (<strong>{{email}}</strong>) è stato abilitato. Puoi accedere alla piattaforma.</p>
        `),
        allowedPlaceholders: [...COMMON_USER],
    },
    {
        actionKey: 'USER_VALIDATED',
        label: 'Utente validato',
        description: 'Notifica all\'utente dopo la validazione da parte di un admin.',
        enabled: true,
        locked: true,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Account validato — Lighting Map',
        bodyTemplate: wrapEmail('Account validato', `
          <p>Ciao <strong>{{nome}} {{cognome}}</strong>,</p>
          <p>Il tuo account è stato validato. Ora puoi utilizzare Lighting Map.</p>
        `),
        allowedPlaceholders: [...COMMON_USER],
    },
    {
        actionKey: 'USER_NEED_VALIDATION',
        label: 'Richiesta validazione utente',
        description: 'Avviso all\'admin di sistema di un nuovo utente da validare.',
        enabled: true,
        locked: false,
        audience: { mode: 'admin_email', userTypes: [], subRoles: [] },
        subjectTemplate: 'Nuovo utente da validare: {{nome}} {{cognome}}',
        bodyTemplate: wrapEmail('Validazione richiesta', `
          <p>L'utente <strong>{{nome}} {{cognome}}</strong> ({{email}}) richiede la validazione.</p>
          <p>Data richiesta: {{data}}</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'data'],
    },
    {
        actionKey: 'REPORT_CREATED',
        label: 'Nuova segnalazione',
        description: 'Email allo staff del comune quando viene aperta una segnalazione.',
        enabled: true,
        locked: false,
        audience: {
            mode: 'staff_of_townhall',
            userTypes: ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'],
            subRoles: [],
        },
        subjectTemplate: 'Aperta segnalazione sul punto {{numero_palo}}, {{nome_comune}}',
        bodyTemplate: wrapEmail('Nuova segnalazione', `
          <p>Ciao,</p>
          <p>È stata aperta una segnalazione sul comune <strong>{{nome_comune}}</strong>.</p>
          <ul>
            <li><strong>Punto luce:</strong> {{numero_palo}}</li>
            <li><strong>Indirizzo:</strong> {{indirizzo}}</li>
            <li><strong>Tipo:</strong> {{corpo_segnalazione}}</li>
            <li><strong>Nota:</strong> {{nota}}</li>
            <li><strong>Segnalato da:</strong> {{nome}} {{cognome}} ({{email}})</li>
            <li><strong>Data:</strong> {{data}}</li>
          </ul>
        `),
        allowedPlaceholders: [
            ...COMMON_USER, 'data', 'nome_comune', 'numero_palo', 'indirizzo',
            'corpo_segnalazione', 'nota',
        ],
    },
    {
        actionKey: 'REPORT_SOLVED',
        label: 'Segnalazione risolta / operazione',
        description: 'Email allo staff quando un\'operazione chiude o aggiorna una segnalazione.',
        enabled: true,
        locked: false,
        audience: {
            mode: 'staff_of_townhall',
            userTypes: ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'],
            subRoles: [],
        },
        subjectTemplate: 'Operazione su punto {{numero_palo}} — {{nome_comune}}',
        bodyTemplate: wrapEmail('Operazione completata', `
          <p>Ciao <strong>{{nome}} {{cognome}}</strong>,</p>
          <p>È stata registrata un'operazione sul comune <strong>{{nome_comune}}</strong>.</p>
          <ul>
            <li><strong>Punto luce:</strong> {{numero_palo}}</li>
            <li><strong>Indirizzo:</strong> {{indirizzo}}</li>
            <li><strong>Tipo operazione:</strong> {{tipo_operazione}}</li>
            <li><strong>Note:</strong> {{nota}}</li>
            <li><strong>Data:</strong> {{data}}</li>
          </ul>
        `),
        allowedPlaceholders: [
            ...COMMON_USER, 'data', 'nome_comune', 'numero_palo', 'indirizzo',
            'tipo_operazione', 'nota',
        ],
    },
    {
        actionKey: 'UPLOAD_SUCCESS',
        label: 'Caricamento comune riuscito',
        description: 'Conferma all\'operatore dopo upload/update dati comune.',
        enabled: true,
        locked: false,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Caricamento completato — {{nome_comune}}',
        bodyTemplate: wrapEmail('Caricamento completato', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Il caricamento del comune <strong>{{nome_comune}}</strong> è stato completato con successo.</p>
          <p>{{dettaglio}}</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'nome_comune', 'dettaglio'],
    },
    {
        actionKey: 'UPLOAD_ERROR',
        label: 'Errore caricamento comune',
        description: 'Avviso all\'operatore in caso di errore upload/update.',
        enabled: true,
        locked: false,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Errore caricamento — {{nome_comune}}',
        bodyTemplate: wrapEmail('Errore caricamento', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Si è verificato un errore durante l'operazione sul comune <strong>{{nome_comune}}</strong>.</p>
          <p>{{dettaglio}}</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'nome_comune', 'dettaglio'],
    },
    {
        actionKey: 'INSPECTION_COMPLETED',
        label: 'Sopralluogo completato',
        description: 'Email allo staff del comune al termine di un sopralluogo.',
        enabled: false,
        locked: false,
        audience: {
            mode: 'staff_of_townhall',
            userTypes: ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'],
            subRoles: [],
        },
        subjectTemplate: 'Sopralluogo completato — punto {{numero_palo}}, {{nome_comune}}',
        bodyTemplate: wrapEmail('Sopralluogo completato', `
          <p>È stato completato un sopralluogo sul comune <strong>{{nome_comune}}</strong>.</p>
          <ul>
            <li><strong>Punto luce:</strong> {{numero_palo}}</li>
            <li><strong>Esito:</strong> {{esito}}</li>
            <li><strong>Note:</strong> {{nota}}</li>
          </ul>
        `),
        allowedPlaceholders: ['nome_comune', 'numero_palo', 'esito', 'nota'],
    },
    {
        actionKey: 'CLASSIFICATION_CONFIRMED',
        label: 'Classificazione aggiornata',
        description: 'Email al creatore della segnalazione se la classificazione viene modificata.',
        enabled: false,
        locked: false,
        audience: { mode: 'creator', userTypes: [], subRoles: [] },
        subjectTemplate: 'Classificazione aggiornata — punto {{numero_palo}}',
        bodyTemplate: wrapEmail('Classificazione aggiornata', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>La classificazione della segnalazione sul punto <strong>{{numero_palo}}</strong> ({{nome_comune}}) è stata aggiornata dal manutentore.</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'numero_palo', 'nome_comune'],
    },
    {
        actionKey: 'QUOTE_PENDING',
        label: 'Preventivo in approvazione',
        description: 'Email agli admin (RUP/DEC) quando un preventivo è in attesa.',
        enabled: false,
        locked: false,
        audience: {
            mode: 'admins',
            userTypes: ['ADMINISTRATOR', 'SUPER_ADMIN'],
            subRoles: ['RUP', 'DEC'],
        },
        subjectTemplate: 'Preventivo in approvazione — {{nome_comune}}',
        bodyTemplate: wrapEmail('Preventivo in approvazione', `
          <p>È in attesa di approvazione un preventivo IMS per <strong>{{nome_comune}}</strong>.</p>
          <ul>
            <li><strong>Protocollo:</strong> {{numero_preventivo}}</li>
            <li><strong>Totale:</strong> € {{totale}}</li>
            <li><strong>Stato:</strong> {{stato}}</li>
          </ul>
        `),
        allowedPlaceholders: ['nome_comune', 'numero_preventivo', 'totale', 'stato'],
    },
    {
        actionKey: 'QUOTE_APPROVED',
        label: 'Preventivo approvato',
        description: 'Email al manutentore quando un preventivo viene approvato.',
        enabled: false,
        locked: false,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Preventivo {{numero_preventivo}} approvato',
        bodyTemplate: wrapEmail('Preventivo approvato', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Il preventivo <strong>{{numero_preventivo}}</strong> ({{nome_comune}}) è stato approvato.</p>
          <p>Scadenza intervento: {{scadenza}}</p>
          <p>Totale: € {{totale}}</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'nome_comune', 'numero_preventivo', 'totale', 'scadenza'],
    },
    {
        actionKey: 'QUOTE_REJECTED',
        label: 'Preventivo rifiutato',
        description: 'Email al manutentore quando un preventivo viene rifiutato.',
        enabled: false,
        locked: false,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Preventivo {{numero_preventivo}} rifiutato',
        bodyTemplate: wrapEmail('Preventivo rifiutato', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Il preventivo <strong>{{numero_preventivo}}</strong> ({{nome_comune}}) è stato rifiutato.</p>
          <p>Motivo: {{motivo}}</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'nome_comune', 'numero_preventivo', 'motivo'],
    },
    {
        actionKey: 'CONSUNTIVO_PENDING',
        label: 'Consuntivo in approvazione',
        description: 'Email agli admin quando un consuntivo è in attesa di revisione.',
        enabled: false,
        locked: false,
        audience: {
            mode: 'admins',
            userTypes: ['ADMINISTRATOR', 'SUPER_ADMIN'],
            subRoles: ['RUP', 'DEC'],
        },
        subjectTemplate: 'Consuntivo in approvazione — {{nome_comune}}',
        bodyTemplate: wrapEmail('Consuntivo in approvazione', `
          <p>È in attesa di revisione un consuntivo IMS per <strong>{{nome_comune}}</strong>.</p>
          <ul>
            <li><strong>Protocollo:</strong> {{numero_preventivo}}</li>
            <li><strong>Totale:</strong> € {{totale}}</li>
          </ul>
        `),
        allowedPlaceholders: ['nome_comune', 'numero_preventivo', 'totale', 'stato'],
    },
    {
        actionKey: 'CONSUNTIVO_FINALIZED',
        label: 'Consuntivo approvato',
        description: 'Email al manutentore quando un consuntivo viene finalizzato.',
        enabled: false,
        locked: false,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Consuntivo {{numero_preventivo}} approvato',
        bodyTemplate: wrapEmail('Consuntivo approvato', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Il consuntivo <strong>{{numero_preventivo}}</strong> ({{nome_comune}}) è stato approvato.</p>
          <p>Totale: € {{totale}}</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'nome_comune', 'numero_preventivo', 'totale'],
    },
    {
        actionKey: 'CONSUNTIVO_REJECTED',
        label: 'Consuntivo rifiutato',
        description: 'Email al manutentore quando un consuntivo viene rifiutato.',
        enabled: false,
        locked: false,
        audience: { mode: 'recipients', userTypes: [], subRoles: [] },
        subjectTemplate: 'Consuntivo {{numero_preventivo}} rifiutato',
        bodyTemplate: wrapEmail('Consuntivo rifiutato', `
          <p>Ciao <strong>{{nome}}</strong>,</p>
          <p>Il consuntivo <strong>{{numero_preventivo}}</strong> ({{nome_comune}}) è stato rifiutato.</p>
          <p>Motivo: {{motivo}}</p>
        `),
        allowedPlaceholders: [...COMMON_USER, 'nome_comune', 'numero_preventivo', 'motivo'],
    },
];

function cloneDefaults() {
    return DEFAULT_ACTIONS.map((item) => ({
        ...item,
        audience: { ...item.audience, userTypes: [...item.audience.userTypes], subRoles: [...item.audience.subRoles] },
        allowedPlaceholders: [...item.allowedPlaceholders],
    }));
}

function getDefaultByKey(actionKey) {
    return cloneDefaults().find((d) => d.actionKey === actionKey) || null;
}

module.exports = {
    DEFAULT_ACTIONS,
    cloneDefaults,
    getDefaultByKey,
    wrapEmail,
};
