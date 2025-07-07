// Funzione per generare CSV "all'italiana" senza virgolette
function toCsvItalianStyle(data) {
    if (!Array.isArray(data) || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const rows = data.map(row =>
        headers.map(h => (row[h] !== undefined && row[h] !== null) ? String(row[h]).replace(/(\r\n|\n|\r)/gm, ' ') : '').join(';')
    );
    return [headers.join(';'), ...rows].join('\r\n');
}

module.exports = {
    toCsvItalianStyle
}