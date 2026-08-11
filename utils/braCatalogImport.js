const path = require('path');
const XLSX = require('xlsx');

const DEFAULT_BRA_XLSX = path.join(
    __dirname,
    '..',
    'templates',
    'bra',
    '2-BRA-Rapporti-manutenzione-2026-Rev00.xlsx'
);

function normalizeCell(value) {
    if (value == null) return '';
    return String(value).trim();
}

function parsePrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = normalizeCell(value).replace(',', '.');
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseElencoPrezziSheet(sheet) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const materials = [];

    for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const code = normalizeCell(row[0]);
        const description = normalizeCell(row[1]);
        const udm = normalizeCell(row[2]);
        const unitPrice = parsePrice(row[3]);
        const category = normalizeCell(row[4]);

        if (!code || !description || unitPrice == null) continue;

        materials.push({
            code,
            description,
            udm: udm || 'cad',
            unitPrice,
            category: category || 'GENERALE',
            isStandard: true,
        });
    }

    return materials;
}

function importMaterialCatalogFromBra(filePath = DEFAULT_BRA_XLSX) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets['Elenco prezzi'];
    if (!sheet) {
        throw new Error('Foglio "Elenco prezzi" non trovato nel template BRA');
    }
    return parseElencoPrezziSheet(sheet);
}

module.exports = {
    DEFAULT_BRA_XLSX,
    importMaterialCatalogFromBra,
    parseElencoPrezziSheet,
    normalizeCell,
    parsePrice,
};
