const { parsePrice, normalizeCell } = require('./braCatalogImport');

const EXPECTED_HEADERS = [
    ['tariffa', 'code'],
    ['descrizione articolo', 'description'],
    ['descrizione', 'description'],
    ['u.m.', 'udm'],
    ['um', 'udm'],
    ['prezzo unitario', 'unitPrice'],
    ['categoria', 'category'],
];

function stripBom(text) {
    if (text.charCodeAt(0) === 0xfeff) {
        return text.slice(1);
    }
    return text;
}

function parseCsvLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result.map((cell) => cell.replace(/^"|"$/g, '').trim());
}

function detectDelimiter(headerLine) {
    const semicolons = (headerLine.match(/;/g) || []).length;
    const commas = (headerLine.match(/,/g) || []).length;
    return semicolons >= commas ? ';' : ',';
}

function mapHeaders(headerCells) {
    const mapping = {};
    headerCells.forEach((header, index) => {
        const normalized = normalizeCell(header).toLowerCase();
        for (const [alias, field] of EXPECTED_HEADERS) {
            if (normalized === alias) {
                mapping[field] = index;
                break;
            }
        }
    });
    return mapping;
}

function rowToMaterial(row, headerMap) {
    const code = normalizeCell(row[headerMap.code]);
    const description = normalizeCell(row[headerMap.description]);
    const udm = normalizeCell(row[headerMap.udm]);
    const unitPrice = parsePrice(row[headerMap.unitPrice]);
    const category = headerMap.category != null ? normalizeCell(row[headerMap.category]) : '';

    if (!code || !description || unitPrice == null) {
        return null;
    }

    return {
        code,
        description,
        udm: udm || 'cad',
        unitPrice,
        category: category || 'GENERALE',
        isStandard: true,
    };
}

function parsePrezziarioCsv(csvText) {
    if (!csvText || typeof csvText !== 'string') {
        throw new Error('Contenuto CSV non valido');
    }

    const cleaned = stripBom(csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    const lines = cleaned.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
        throw new Error('Il file CSV deve contenere intestazione e almeno una riga dati');
    }

    const delimiter = detectDelimiter(lines[0]);
    const headerCells = parseCsvLine(lines[0], delimiter);
    const headerMap = mapHeaders(headerCells);

    if (headerMap.code == null || headerMap.description == null || headerMap.unitPrice == null) {
        throw new Error(
            'Intestazioni CSV non riconosciute. Attese: Tariffa, Descrizione articolo, U.M., Prezzo unitario, Categoria'
        );
    }

    const materials = [];
    const skippedRows = [];

    for (let i = 1; i < lines.length; i += 1) {
        const row = parseCsvLine(lines[i], delimiter);
        const material = rowToMaterial(row, headerMap);
        if (material) {
            materials.push(material);
        } else if (row.some((cell) => normalizeCell(cell))) {
            skippedRows.push(i + 1);
        }
    }

    if (materials.length === 0) {
        throw new Error('Nessuna riga valida trovata nel CSV');
    }

    return { materials, skippedRows, delimiter };
}

module.exports = {
    parsePrezziarioCsv,
    parseCsvLine,
    detectDelimiter,
};
