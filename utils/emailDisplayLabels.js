/**
 * Mapping codice DB → etichetta italiana per i placeholder email.
 * Allineato a Lighting-map/src/utils/utils.js (QUOTE_STATUS, INSPECTION_OUTCOMES, ecc.).
 */

const QUOTE_STATUS_LABELS = {
    DRAFT: 'Bozza',
    PENDING_APPROVAL: 'In approvazione',
    APPROVED: 'Approvato',
    REJECTED: 'Rifiutato',
    NEEDS_REVISION: 'Da revisionare',
};

const INSPECTION_OUTCOME_LABELS = {
    RESOLVED: 'Guasto risolto — chiusura segnalazione',
    SUSPENDED: 'Sospensione intervento (mancanza componente)',
    SCHEDULED: 'Risolvi in seguito (tempi capitolato)',
    SAFE_PENDING_RESTORATION: 'Messa in sicurezza + richiesta preventivo (escalation straordinaria)',
    REQUIRES_QUOTE: 'Serve preventivo IMS (senza escalation immediata)',
};

const MAINTENANCE_CATEGORY_LABELS = {
    ORDINARY: 'Ordinaria',
    EXTRAORDINARY: 'Straordinaria',
};

const CLASSIFICATION_STATUS_LABELS = {
    PROVISIONAL: 'Provvisoria',
    CONFIRMED: 'Confermata',
    MODIFIED: 'Modificata',
};

const OPERATION_TYPE_LABELS = {
    MADE_SAFE_BUT_SYSTEM_NEEDS_RESTORING: 'Messa in sicurezza ma da ripristinare impianto',
    FAULT_ELIMINATED_AND_SYSTEM_RESTORED: 'Guasto eliminato e impianto ripristinato',
    OTHER: 'Altro',
};

const FAULT_AND_REPORT_LABELS = {
    IMMEDIATE_DANGER: 'Pericolo immediato per la pubblica incolumità',
    PLANT_OFF: 'Strada al buio / intera cabina spenta',
    MULTIPLE_OFF: 'Tre o più punti luce spenti nello stesso tratto',
    SINGLE_OFF: 'Punto luce singolo spento',
    NON_URGENT: 'Anomalia non urgente',
    PANEL_DAMAGE: 'Quadro elettrico danneggiato',
    PANEL_DOOR_UNSAFE: 'Sportello aperto / quadro non sicuro',
    PANEL_PROTECTION_TRIP: 'Protezioni intervenute / interruttore scattato',
    PANEL_SUPPLY_FAULT: 'Anomalia alimentazione quadro',
    LIGHT_POINT_OFF: 'Punto luce spento',
    DAMAGED_COMPLEX: 'Complesso danneggiato',
    DAMAGED_SUPPORT: 'Morsettiera rotta',
    BROKEN_TERMINAL_BLOCK: 'Sostegno danneggiato',
    BROKEN_PANEL: 'Quadro danneggiato',
    OTHER: 'Altro',
};

const PLACEHOLDER_MAPPERS = {
    stato: (code) => QUOTE_STATUS_LABELS[code] || CLASSIFICATION_STATUS_LABELS[code] || code,
    esito: (code) => INSPECTION_OUTCOME_LABELS[code] || MAINTENANCE_CATEGORY_LABELS[code] || code,
    tipo_operazione: (code) => OPERATION_TYPE_LABELS[code] || FAULT_AND_REPORT_LABELS[code] || code,
    corpo_segnalazione: (code) => FAULT_AND_REPORT_LABELS[code] || code,
};

/**
 * Converte un valore placeholder da codice DB a etichetta leggibile.
 * Se il valore è già un'etichetta (o non è un codice noto), lo lascia invariato.
 */
function mapEmailPlaceholderValue(key, value) {
    if (value === undefined || value === null) return value;
    const str = String(value);
    if (!str) return value;
    const mapper = PLACEHOLDER_MAPPERS[key];
    return mapper ? mapper(str) : value;
}

module.exports = {
    QUOTE_STATUS_LABELS,
    INSPECTION_OUTCOME_LABELS,
    MAINTENANCE_CATEGORY_LABELS,
    CLASSIFICATION_STATUS_LABELS,
    OPERATION_TYPE_LABELS,
    FAULT_AND_REPORT_LABELS,
    mapEmailPlaceholderValue,
};
