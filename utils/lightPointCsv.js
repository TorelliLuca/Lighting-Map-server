const mongoose = require('mongoose');
const {
    isEmptyLightPoint,
    applyItalianCoordinatesToLightPoint
} = require('./utility');

/** Campi schema lightPoints ammessi in import CSV (+ metadati relazioni). */
const LIGHT_POINT_ALLOWED_FIELDS = [
    'marker', 'numero_palo', 'composizione_punto', 'indirizzo', 'lotto', 'quadro', 'proprieta',
    'tipo_apparecchio', 'marca_apparecchio', 'modello_apparecchio', 'numero_apparecchi',
    'tipo_lampada', 'potenza_lampada', 'tipo_sostegno', 'tipo_linea', 'promiscuita', 'note', 'garanzia',
    'lat', 'lng', 'pod', 'numero_contatore', 'alimentazione', 'potenza_contratto', 'potenza', 'punti_luce', 'tipo',
    'altezza_sostegno', 'data_creazione',
    'parent',
    '_id',
    'segnalazioni_in_corso', 'segnalazioni_risolte', 'operazioni_effettuate'
];

/** Campo solo CSV: risolto a ObjectId parent in un secondo passaggio. */
const CSV_ONLY_FIELDS = ['numero_palo_parent'];

/** Alias legacy CSV → campo schema. */
const LEGACY_ALIASES = {
    modello: 'modello_apparecchio',
    lampada_e_potenza: 'tipo_lampada+potenza_lampada',
    lampada_potenza: 'tipo_lampada+potenza_lampada'
};

const RELATION_ARRAY_FIELDS = [
    'segnalazioni_in_corso',
    'segnalazioni_risolte',
    'operazioni_effettuate'
];

const PREVIEW_ACCEPTED_LIMIT = 50;

function isValidObjectIdString(value) {
    if (value == null || value === '') return false;
    const s = String(value).trim();
    if (!s) return false;
    return mongoose.Types.ObjectId.isValid(s) && String(new mongoose.Types.ObjectId(s)) === s;
}

/**
 * Rimuove valori CSV che rompono il cast Mongoose (_id vuoto, relazioni stringa, date invalide).
 */
function sanitizeNormalizedLightPoint(normalized) {
    if (!normalized || typeof normalized !== 'object') return normalized;

    if (Object.prototype.hasOwnProperty.call(normalized, '_id')) {
        if (!isValidObjectIdString(normalized._id)) {
            delete normalized._id;
        } else {
            normalized._id = String(normalized._id).trim();
        }
    }

    for (const key of RELATION_ARRAY_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue;
        const value = normalized[key];
        if (!Array.isArray(value)) {
            delete normalized[key];
            continue;
        }
        const cleaned = value.filter(isValidObjectIdString).map(v => String(v).trim());
        if (cleaned.length === 0) delete normalized[key];
        else normalized[key] = cleaned;
    }

    if (Object.prototype.hasOwnProperty.call(normalized, 'data_creazione')) {
        const raw = normalized.data_creazione;
        if (raw == null || String(raw).trim() === '') {
            delete normalized.data_creazione;
        } else {
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) delete normalized.data_creazione;
        }
    }

    return normalized;
}

/**
 * Normalizzazione robusta per i dati dei punti luce (create/update/preview).
 */
function normalizeLightPointData(lp) {
    const lowerCaseLp = {};
    Object.keys(lp || {}).forEach(key => {
        lowerCaseLp[key.toLowerCase()] = lp[key];
    });

    const normalized = {};
    for (const key of LIGHT_POINT_ALLOWED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(lowerCaseLp, key)) {
            normalized[key] = lowerCaseLp[key];
        }
    }

    if (Object.prototype.hasOwnProperty.call(lowerCaseLp, 'numero_palo_parent')) {
        normalized.numero_palo_parent = lowerCaseLp.numero_palo_parent;
    }

    if (!normalized.modello_apparecchio && lowerCaseLp.modello) {
        normalized.modello_apparecchio = lowerCaseLp.modello;
    }
    const legacyLampada = lowerCaseLp.lampada_e_potenza || lowerCaseLp.lampada_potenza;
    if (legacyLampada && (!normalized.tipo_lampada || !normalized.potenza_lampada)) {
        const parts = String(legacyLampada).trim().split(/\s+/);
        if (!normalized.tipo_lampada) {
            normalized.tipo_lampada = parts[0] || '';
        }
        if (!normalized.potenza_lampada) {
            normalized.potenza_lampada = parts.slice(1).join(' ') || '';
        }
    }

    return sanitizeNormalizedLightPoint(normalized);
}

/**
 * Analizza le colonne grezze del CSV rispetto allo schema.
 */
function analyzeCsvColumns(rows) {
    const headerSet = new Set();
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        Object.keys(row).forEach(k => {
            const key = String(k).trim();
            if (key) headerSet.add(key);
        });
    }

    const recognized = [];
    const ignored = [];
    const legacyMapped = [];

    const allowedLower = new Set([
        ...LIGHT_POINT_ALLOWED_FIELDS,
        ...CSV_ONLY_FIELDS
    ]);

    for (const header of headerSet) {
        const lower = header.toLowerCase();
        if (allowedLower.has(lower)) {
            recognized.push(header);
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, lower)) {
            legacyMapped.push({
                from: header,
                to: LEGACY_ALIASES[lower],
                reason: 'Alias legacy mappato allo schema aggiornato'
            });
            continue;
        }
        ignored.push({
            column: header,
            reason: 'Colonna non presente nello schema punti luce — verrà ignorata'
        });
    }

    recognized.sort((a, b) => a.localeCompare(b, 'it'));
    ignored.sort((a, b) => a.column.localeCompare(b.column, 'it'));
    legacyMapped.sort((a, b) => a.from.localeCompare(b.from, 'it'));

    return { recognized, ignored, legacyMapped };
}

function isBlankCoord(value) {
    if (value == null) return true;
    return String(value).trim() === '';
}

/**
 * Warning non bloccanti su lat/lng mancanti (vuoti ammessi in DB ma segnalati in anteprima).
 * @returns {string[]}
 */
function missingCoordinateWarnings(normalized) {
    const warnings = [];
    if (isBlankCoord(normalized.lat)) {
        warnings.push('lat mancante — il punto sarà senza latitudine');
    }
    if (isBlankCoord(normalized.lng)) {
        warnings.push('lng mancante — il punto sarà senza longitudine');
    }
    return warnings;
}

function toPreviewRow(normalized, rowIndex, warnings = []) {
    const hasParent =
        (normalized.parent != null && String(normalized.parent).trim() !== '') ||
        (normalized.numero_palo_parent != null && String(normalized.numero_palo_parent).trim() !== '');

    return {
        rowIndex,
        _id: normalized._id || null,
        marker: normalized.marker || '',
        numero_palo: normalized.numero_palo || '',
        indirizzo: normalized.indirizzo || '',
        lat: normalized.lat || '',
        lng: normalized.lng || '',
        hasParent,
        warnings
    };
}

/**
 * Dry-run import CSV: stesse regole di create/update senza scrivere sul DB.
 *
 * @param {object[]} rows
 * @param {{ mode?: 'create'|'update', existingIds?: string[] }} options
 */
function previewLightPointsImport(rows, options = {}) {
    const mode = options.mode === 'update' ? 'update' : 'create';
    const existingIds = Array.isArray(options.existingIds)
        ? options.existingIds.map(id => String(id))
        : [];
    const existingSet = new Set(existingIds);

    const inputRows = Array.isArray(rows) ? rows : [];
    const columns = analyzeCsvColumns(inputRows);

    const accepted = [];
    const rejected = [];
    const warnings = [];
    let emptySkipped = 0;
    let coordRejected = 0;
    let missingCoordWarned = 0;

    const docsForDiff = [];

    inputRows.forEach((raw, index) => {
        const rowIndex = index + 1; // 1-based rispetto ai dati (header = riga 0 CSV)
        const normalized = normalizeLightPointData(raw || {});

        if (!normalized._id && isEmptyLightPoint(normalized)) {
            emptySkipped += 1;
            rejected.push({
                rowIndex,
                marker: '',
                numero_palo: '',
                _id: null,
                reasons: ['Riga vuota — saltata']
            });
            return;
        }

        // Copia per validazione coordinate senza alterare il doc originale usato in preview
        const forCoords = { ...normalized };
        const coordReasons = applyItalianCoordinatesToLightPoint(forCoords);
        if (coordReasons.length > 0) {
            coordRejected += 1;
            rejected.push({
                rowIndex,
                marker: normalized.marker || '',
                numero_palo: normalized.numero_palo || '',
                _id: normalized._id || null,
                reasons: coordReasons
            });
            return;
        }

        // Applica coordinate normalizzate come farebbe create/update
        Object.assign(normalized, {
            lat: forCoords.lat !== undefined ? forCoords.lat : normalized.lat,
            lng: forCoords.lng !== undefined ? forCoords.lng : normalized.lng
        });

        const rowWarnings = missingCoordinateWarnings(normalized);
        if (rowWarnings.length > 0) {
            missingCoordWarned += 1;
            warnings.push({
                rowIndex,
                marker: normalized.marker || '',
                numero_palo: normalized.numero_palo || '',
                _id: normalized._id || null,
                reasons: rowWarnings
            });
        }

        docsForDiff.push(normalized);
        if (accepted.length < PREVIEW_ACCEPTED_LIMIT) {
            accepted.push(toPreviewRow(normalized, rowIndex, rowWarnings));
        }
    });

    const summary = {
        totalRows: inputRows.length,
        accepted: docsForDiff.length,
        acceptedPreviewLimit: PREVIEW_ACCEPTED_LIMIT,
        emptySkipped,
        coordRejected,
        missingCoordWarned,
        rejected: rejected.length,
        warnings: warnings.length
    };

    if (mode === 'update') {
        const incomingIds = docsForDiff.map(lp => lp._id).filter(Boolean).map(String);
        const incomingIdSet = new Set(incomingIds);
        const toDelete = existingIds.filter(id => !incomingIdSet.has(id));
        const toModify = docsForDiff.filter(lp => lp._id && existingSet.has(String(lp._id)));
        const toAdd = docsForDiff.filter(lp => !lp._id);

        summary.toAdd = toAdd.length;
        summary.toModify = toModify.length;
        summary.toDelete = toDelete.length;
    }

    const hasUsefulColumns =
        columns.recognized.length > 0 || columns.legacyMapped.length > 0;

    const canProceed =
        hasUsefulColumns &&
        coordRejected === 0 &&
        docsForDiff.length > 0;

    return {
        columns,
        summary,
        accepted,
        rejected,
        warnings,
        canProceed,
        blockers: [
            ...(!hasUsefulColumns
                ? ['Nessuna colonna riconosciuta dallo schema punti luce']
                : []),
            ...(coordRejected > 0
                ? [`${coordRejected} punti luce con coordinate non valide`]
                : []),
            ...(docsForDiff.length === 0
                ? ['Nessun punto luce valido da caricare']
                : [])
        ],
        notices: [
            ...(missingCoordWarned > 0
                ? [`${missingCoordWarned} punti luce senza lat e/o lng (caricabili, ma senza posizione completa)`]
                : [])
        ]
    };
}

module.exports = {
    LIGHT_POINT_ALLOWED_FIELDS,
    CSV_ONLY_FIELDS,
    LEGACY_ALIASES,
    normalizeLightPointData,
    analyzeCsvColumns,
    previewLightPointsImport
};
