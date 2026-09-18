// Funzione per generare CSV "all'italiana" senza virgolette
function toCsvItalianStyle(data) {
    if (!Array.isArray(data) || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const rows = data.map(row =>
        headers.map(h => (row[h] !== undefined && row[h] !== null) ? String(row[h]).replace(/(\r\n|\n|\r)/gm, ' ') : '').join(';')
    );
    return [headers.join(';'), ...rows].join('\r\n');
}

// Funzione per normalizzare le chiavi di un oggetto a minuscolo
function normalizeKeysToLowerCase(obj) {
    return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])
    );
}

function isEmptyLightPoint(lp) {
    // Escludi _id dal controllo
    const { _id, ...fields } = lp;
    // Considera vuoto se tutti i valori sono stringa vuota, null o undefined
    return Object.values(fields).every(
        v => v === '' || v === null || v === undefined
    );
}

function compareNumeroPalo(a, b) {
    const getRaw = v => v == null ? '' : String(v).trim();

    const aRaw = getRaw(a.numero_palo);
    const bRaw = getRaw(b.numero_palo);

    // Un numero è solo se è composto SOLO da cifre (niente punti, virgole, spazi)
    const isPureNumber = v => /^[0-9]+$/.test(v);

    const aIsNum = isPureNumber(aRaw);
    const bIsNum = isPureNumber(bRaw);

    if (aIsNum && bIsNum) {
        return Number(aRaw) - Number(bRaw);
    }
    if (aIsNum && !bIsNum) {
        return -1; // i numeri vengono prima delle stringhe
    }
    if (!aIsNum && bIsNum) {
        return 1; // le stringhe vengono dopo i numeri
    }
    // entrambi stringhe: confronto alfabetico
    return aRaw.localeCompare(bRaw, 'it', { sensitivity: 'base' });
}

/**
 * Pattern ammesso: segno opzionale, intero, eventuale parte decimale con . o ,
 * (un solo separatore). Esempi ok: 45 | 45.123 | 45,123 | -12,5
 */
const COORD_FORMAT_RE = /^[+-]?\d+([.,]\d+)?$/;

/** Precisione stabile in DB (~1 cm); evita rumore float da sposta/scala/ruota. */
const COORD_DECIMALS = 7;

function toItalianCoordFixed(numeric) {
    const fixed = Number(numeric).toFixed(COORD_DECIMALS);
    // toFixed garantisce un solo '.' e evita notazione scientifica
    return fixed.replace('.', ',');
}

/**
 * Valida e normalizza una coordinata in formato italiano (virgola come separatore decimale).
 * Accetta stringhe con `.` o `,` e numeri JS; rifiuta formati ambigui/malformati.
 * Arrotonda a COORD_DECIMALS cifre decimali prima del salvataggio.
 *
 * @param {*} value
 * @param {'lat'|'lng'|'coord'} [axis='coord']
 * @returns {{ ok: true, value: string, numeric: number|null } | { ok: false, reason: string }}
 */
function normalizeItalianCoordinate(value, axis = 'coord') {
    if (value == null || value === '') {
        return { ok: true, value: '', numeric: null };
    }

    let numeric;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return { ok: false, reason: `${axis} non è un numero finito` };
        }
        numeric = value;
    } else {
        const raw = String(value).trim().replace(/\s+/g, '');
        if (raw === '') {
            return { ok: true, value: '', numeric: null };
        }
        if (raw.includes('.') && raw.includes(',')) {
            return {
                ok: false,
                reason: `${axis} con separatori misti non ammessi: "${value}"`
            };
        }
        if (!COORD_FORMAT_RE.test(raw)) {
            return {
                ok: false,
                reason: `${axis} non ben formattata: "${value}"`
            };
        }
        numeric = Number(raw.replace(',', '.'));
        if (!Number.isFinite(numeric)) {
            return { ok: false, reason: `${axis} non numerica: "${value}"` };
        }
    }

    if (axis === 'lat' && (numeric < -90 || numeric > 90)) {
        return { ok: false, reason: `lat fuori range [-90, 90]: "${value}"` };
    }
    if (axis === 'lng' && (numeric < -180 || numeric > 180)) {
        return { ok: false, reason: `lng fuori range [-180, 180]: "${value}"` };
    }

    const rounded = Number(numeric.toFixed(COORD_DECIMALS));
    return {
        ok: true,
        value: toItalianCoordFixed(rounded),
        numeric: rounded
    };
}

/**
 * Applica normalizzazione lat/lng su un punto luce (in-place).
 * @returns {string[]} lista motivi di errore (vuota se ok)
 */
function applyItalianCoordinatesToLightPoint(lp) {
    const errors = [];
    if (!lp || typeof lp !== 'object') return errors;

    if (Object.prototype.hasOwnProperty.call(lp, 'lat')) {
        const r = normalizeItalianCoordinate(lp.lat, 'lat');
        if (!r.ok) errors.push(r.reason);
        else lp.lat = r.value;
    }
    if (Object.prototype.hasOwnProperty.call(lp, 'lng')) {
        const r = normalizeItalianCoordinate(lp.lng, 'lng');
        if (!r.ok) errors.push(r.reason);
        else lp.lng = r.value;
    }
    return errors;
}

function parseCoordValue(value) {
    const r = normalizeItalianCoordinate(value, 'coord');
    return r.ok ? r.numeric : null;
}

/** Serializza lat/lng nel formato italiano con virgola (come in DB/export). */
function toItalianCoordString(value) {
    if (value == null || value === '') return value;
    const r = normalizeItalianCoordinate(value, 'coord');
    if (!r.ok) return null;
    return r.value;
}

function toIdString(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'object' && value._id != null) return String(value._id);
    return String(value);
}

/**
 * Arricchisce i punti luce con numero_palo_parent (numero_palo del parent)
 * per export CSV/Excel. parent resta l'ObjectId serializzato.
 */
function enrichLightPointsWithNumeroPaloParent(puntiLuce) {
    if (!Array.isArray(puntiLuce)) return [];
    const byId = new Map();
    for (const lp of puntiLuce) {
        if (!lp) continue;
        const id = toIdString(lp._id);
        if (id) byId.set(id, lp);
    }
    return puntiLuce.map(lp => {
        const parentId = toIdString(lp.parent);
        let numero_palo_parent = '';
        if (parentId) {
            const parentLp = byId.get(parentId);
            if (parentLp && parentLp.numero_palo != null) {
                numero_palo_parent = String(parentLp.numero_palo);
            }
        }
        return {
            ...lp,
            parent: parentId || '',
            numero_palo_parent
        };
    });
}

/**
 * Risolve parent da numero_palo_parent quando parent non è un ObjectId valido.
 * Pure: non tocca il DB. Mutates jobs via return values.
 *
 * @param {Array<{ childId: string, childNumeroPalo?: string, childMarker?: string, numero_palo_parent: string }>} jobs
 * @param {Array<{ _id: any, numero_palo?: string, marker?: string }>} candidates
 * @returns {{ resolved: Array<{ childId: string, parentId: string }>, ambiguities: Array<object> }}
 */
function resolveParentJobsFromNumeroPalo(jobs, candidates) {
    const byNumeroPalo = new Map();
    for (const c of candidates || []) {
        if (!c) continue;
        const key = c.numero_palo == null ? '' : String(c.numero_palo).trim();
        if (!key) continue;
        if (!byNumeroPalo.has(key)) byNumeroPalo.set(key, []);
        byNumeroPalo.get(key).push(c);
    }

    const resolved = [];
    const ambiguities = [];

    for (const job of jobs || []) {
        const npp = job.numero_palo_parent == null ? '' : String(job.numero_palo_parent).trim();
        if (!npp || !job.childId) continue;

        const childId = String(job.childId);
        const matches = (byNumeroPalo.get(npp) || []).filter(
            c => toIdString(c._id) !== childId
        );

        if (matches.length === 1) {
            resolved.push({ childId, parentId: toIdString(matches[0]._id) });
        } else if (matches.length > 1) {
            ambiguities.push({
                child_id: childId,
                child_numero_palo: job.childNumeroPalo != null ? String(job.childNumeroPalo) : '',
                child_marker: job.childMarker != null ? String(job.childMarker) : '',
                numero_palo_parent: npp,
                matches: matches.map(m => ({
                    _id: toIdString(m._id),
                    numero_palo: m.numero_palo != null ? String(m.numero_palo) : '',
                    marker: m.marker != null ? String(m.marker) : ''
                }))
            });
        }
    }

    return { resolved, ambiguities };
}

function formatParentAmbiguitiesHtml(ambiguities) {
    if (!Array.isArray(ambiguities) || ambiguities.length === 0) return '';
    const items = ambiguities.map(a => {
        const matchList = (a.matches || [])
            .map(m => `_id=${m._id} (marker=${m.marker || '—'})`)
            .join('; ');
        return `<li>
            Punto <b>${a.child_numero_palo || '—'}</b>
            (marker: ${a.child_marker || '—'}, _id: ${a.child_id || '—'}):
            <code>numero_palo_parent=${a.numero_palo_parent}</code> corrisponde a
            <b>${(a.matches || []).length}</b> punti nel comune — parent non impostato.
            Candidati: ${matchList}
        </li>`;
    }).join('');
    return `
        <div style="background: #fff8e1; border-radius: 8px; padding: 16px; margin: 24px 0; color: #e65100;">
            <h4 style="margin: 0 0 8px 0;">Attenzione: numero_palo_parent ambiguo</h4>
            <p style="margin: 0 0 8px 0; font-size: 14px;">
                Per i seguenti punti esistono più record con lo stesso <code>numero_palo</code>
                nel comune. Il collegamento topologico (parent) non è stato impostato automaticamente.
            </p>
            <ul style="padding-left: 20px; margin: 0; font-size: 14px;">${items}</ul>
        </div>
    `;
}

module.exports = {
    toCsvItalianStyle,
    normalizeKeysToLowerCase,
    isEmptyLightPoint,
    compareNumeroPalo,
    toIdString,
    enrichLightPointsWithNumeroPaloParent,
    resolveParentJobsFromNumeroPalo,
    formatParentAmbiguitiesHtml,
    normalizeItalianCoordinate,
    applyItalianCoordinatesToLightPoint,
    parseCoordValue,
    toItalianCoordString
}