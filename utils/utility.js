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

module.exports = {
    toCsvItalianStyle,
    normalizeKeysToLowerCase,
    isEmptyLightPoint,
    compareNumeroPalo
}