const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const TEMPLATE_PATH = path.join(
    __dirname,
    '..',
    'templates',
    'bra',
    '2-BRA-Rapporti-manutenzione-2026-Rev00.xlsx'
);

const SHEET_IMS = 'Intervento straordinario';
const SHEET_ADHOC = 'Nuovo Prezzo';
const SHEET_CATALOG = 'Elenco prezzi';
const LINE_START = 15; // 1-based row
const LINE_END = 34;
const MAX_LINES = LINE_END - LINE_START + 1;
const CONS_LINE_START = 50;
const CONS_LINE_END = 69;
const CONS_MAX_LINES = CONS_LINE_END - CONS_LINE_START + 1;
/** Ultima riga della sola sezione preventivo (escluso consuntivo). */
const PREVENTIVO_LAST_ROW = 45;
const SHEET_LAST_ROW = 89;

/** Altezze / wrap per voci materiali (col. B descrizione). */
const DEFAULT_LINE_ROW_HEIGHT = 18;
const MIN_LINE_ROW_HEIGHT = 18;
const MAX_LINE_ROW_HEIGHT = 120;
const TEXT_LINE_HEIGHT_PT = 15;
const DESC_COL_INDEX = 2;
const DESC_COL_WIDTH_FALLBACK = 44;

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Calcola totali preventivo/consuntivo.
 * subtotal → safety = subtotal * rate → discount sul (subtotal+safety) → total netto
 */
function computeQuoteTotals(lineItems = [], safetyChargeRate = 0.02, discountPercent = 0) {
    const subtotal = round2(
        (lineItems || []).reduce((sum, item) => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unitPrice) || 0;
            return sum + qty * price;
        }, 0)
    );
    const rate = Number(safetyChargeRate);
    const safeRate = Number.isFinite(rate) ? rate : 0.02;
    const safetyAmount = round2(subtotal * safeRate);
    const discPct = Number(discountPercent) || 0;
    const discountAmount = round2((subtotal + safetyAmount) * (discPct / 100));
    const total = round2(subtotal + safetyAmount - discountAmount);
    return { subtotal, safetyAmount, discountAmount, total, safetyChargeRate: safeRate, discountPercent: discPct };
}

function formatDateIt(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function formatYmd(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    if (Number.isNaN(d.getTime())) return '00000000';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${yyyy}${mm}${dd}`;
}

/**
 * Codice documento leggibile per file/nome (no ObjectId Mongo).
 * Preferisce protocollo ufficiale; in bozza usa IMS-BOZZA-YYYYMMDD-XXXXXX.
 */
function quoteDocumentCode(quote) {
    if (quote?.protocolNumber) return String(quote.protocolNumber);
    const ymd = formatYmd(quote?.createdAt || Date.now());
    const tail = String(quote?._id || '')
        .replace(/[^a-fA-F0-9]/g, '')
        .slice(-6)
        .toUpperCase() || '000000';
    return `IMS-BOZZA-${ymd}-${tail}`;
}

function getDescriptionColumnWidth(sheet) {
    const width = Number(sheet.getColumn(DESC_COL_INDEX)?.width);
    return Number.isFinite(width) && width > 0 ? width : DESC_COL_WIDTH_FALLBACK;
}

/**
 * Stima righe di testo wrappato in base alla larghezza colonna Excel.
 * Larghezza Excel ≈ n. caratteri "0" del font di default.
 */
function estimateWrappedLines(text, columnWidth) {
    const raw = String(text || '');
    if (!raw.trim()) return 1;
    const charsPerLine = Math.max(8, Math.floor(columnWidth * 0.95));
    return raw.split(/\r?\n/).reduce((sum, paragraph) => {
        const len = paragraph.length || 1;
        return sum + Math.max(1, Math.ceil(len / charsPerLine));
    }, 0);
}

function applyMaterialRowHeight(sheet, rowNumber, description) {
    const row = sheet.getRow(rowNumber);
    const colWidth = getDescriptionColumnWidth(sheet);
    const lines = estimateWrappedLines(description, colWidth);
    row.height = Math.min(
        MAX_LINE_ROW_HEIGHT,
        Math.max(MIN_LINE_ROW_HEIGHT, lines * TEXT_LINE_HEIGHT_PT + 3)
    );

    const descCell = sheet.getCell(rowNumber, DESC_COL_INDEX);
    descCell.alignment = {
        ...(descCell.alignment || {}),
        wrapText: true,
        vertical: 'middle',
        horizontal: descCell.alignment?.horizontal || 'left',
    };
}

function setCell(sheet, row, col, value) {
    const cell = sheet.getCell(row, col);
    cell.value = value === undefined || value === null ? null : value;
}

function clearRowCells(sheet, row, fromCol = 1, toCol = 6) {
    for (let col = fromCol; col <= toCol; col++) {
        setCell(sheet, row, col, null);
    }
}

/**
 * Compila le voci materiali.
 * - Solo le N voci preventivate restano visibili; le altre righe template vengono nascoste.
 * - Altezza riga adattata al testo della descrizione (wrap).
 */
function fillLineItems(sheet, items, startRow, maxLines) {
    const sliced = (items || []).slice(0, maxLines);
    const usedCount = sliced.length;

    for (let i = 0; i < maxLines; i++) {
        const row = startRow + i;
        const sheetRow = sheet.getRow(row);
        const item = sliced[i];

        if (!item) {
            clearRowCells(sheet, row);
            sheetRow.hidden = true;
            sheetRow.height = DEFAULT_LINE_ROW_HEIGHT;
            continue;
        }

        sheetRow.hidden = false;
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || 0;
        setCell(sheet, row, 1, item.materialCode || '');
        setCell(sheet, row, 2, item.description || '');
        setCell(sheet, row, 3, item.udm || '');
        setCell(sheet, row, 4, qty);
        setCell(sheet, row, 5, price);
        setCell(sheet, row, 6, round2(qty * price));
        applyMaterialRowHeight(sheet, row, item.description || '');
    }

    return usedCount;
}

function resolveTownHallName(townHall, report, config) {
    return (
        townHall?.name
        || report?.town_hall_name
        || report?.townHallName
        || report?.comune
        || config?.townHallName
        || ''
    );
}

function resolveCapitolatoLabel(config) {
    const version = config?.capitolatoVersion || '2026 Rev00';
    return `Capitolato ${version}`;
}

function fillPreventivoSection(sheet, quote, { report, lightPoint, config, approver, townHall } = {}) {
    const totals = computeQuoteTotals(
        quote.lineItems,
        quote.safetyChargeRate,
        quote.discountPercent
    );

    const reportDate = report?.report_date || quote.createdAt || new Date();
    const numeroPalo = lightPoint?.numero_palo || '';
    const faultDescription = quote.faultDescription || report?.description || '';
    const comuneName = resolveTownHallName(townHall, report, config);
    const docCode = quoteDocumentCode(quote);

    // Intestazione: A4 = codice interno, B3 = comune, B5 = capitolato
    setCell(sheet, 4, 1, docCode);
    if (comuneName) {
        setCell(sheet, 3, 2, `Comune di ${comuneName}`);
    }
    setCell(sheet, 5, 2, resolveCapitolatoLabel(config));

    // C4:D4 data, E4 tipo chiamata, F4 rif. punto luce (non tagliare F)
    setCell(sheet, 4, 3, formatDateIt(reportDate));
    setCell(sheet, 4, 5, quote.priorityClass || '');
    setCell(sheet, 4, 6, numeroPalo);

    // Descrizione guasto (merge A8:F11)
    setCell(sheet, 8, 1, faultDescription);

    fillLineItems(sheet, quote.lineItems, LINE_START, MAX_LINES);

    setCell(sheet, 35, 6, totals.subtotal);
    setCell(sheet, 36, 4, totals.safetyChargeRate);
    setCell(sheet, 36, 5, totals.safetyAmount);
    setCell(sheet, 37, 4, totals.discountPercent / 100);
    setCell(sheet, 37, 6, totals.discountAmount);
    setCell(sheet, 38, 6, totals.total);

    const materialDays = Number(quote.materialLeadDays) || 0;
    const workDays = Number(quote.workLeadDays) || 0;
    setCell(sheet, 40, 1, `Materiali: ${materialDays} gg — Opera: ${workDays} gg`);

    if (quote.status === 'APPROVED' && (approver || quote.approvedAt)) {
        const name = approver
            ? `${approver.name || ''} ${approver.surname || ''}`.trim()
            : '';
        const stamp = [name, formatDateIt(quote.approvedAt || new Date())]
            .filter(Boolean)
            .join(' — ');
        setCell(sheet, 44, 5, stamp);
    }

    setCell(sheet, 1, 1, `IMS — ${docCode}`);
}

function fillConsuntivoSection(sheet, consuntivo, { operationDate } = {}) {
    const totals = computeQuoteTotals(
        consuntivo.lineItems,
        consuntivo.safetyChargeRate,
        consuntivo.discountPercent
    );

    fillLineItems(sheet, consuntivo.lineItems, CONS_LINE_START, CONS_MAX_LINES);

    setCell(sheet, 70, 6, totals.subtotal);
    setCell(sheet, 71, 4, totals.safetyChargeRate);
    setCell(sheet, 71, 5, totals.safetyAmount);
    setCell(sheet, 72, 4, totals.discountPercent / 100);
    setCell(sheet, 72, 6, totals.discountAmount);
    setCell(sheet, 73, 6, totals.total);

    if (consuntivo.notes) {
        setCell(sheet, 75, 1, consuntivo.notes);
    }
    setCell(sheet, 79, 1, formatDateIt(operationDate || consuntivo.updatedAt || new Date()));

    if (consuntivo.protocolNumber) {
        setCell(sheet, 48, 1, `Consuntivo — ${consuntivo.protocolNumber}`);
    }
}

/**
 * Per export preventivo: nasconde e pulisce la sezione consuntivo,
 * così in stampa/pagina si vede una sola tabella.
 */
function collapseConsuntivoSection(sheet) {
    for (let row = PREVENTIVO_LAST_ROW + 1; row <= SHEET_LAST_ROW; row++) {
        const r = sheet.getRow(row);
        r.hidden = true;
        clearRowCells(sheet, row);
    }
    sheet.pageSetup.printArea = `A1:F${PREVENTIVO_LAST_ROW}`;
}

function ensurePrintIncludesColumnF(sheet) {
    // Evita che il layout pagina “tagli” la col. F (rif. punto luce)
    sheet.pageSetup.fitToPage = true;
    sheet.pageSetup.fitToWidth = 1;
    sheet.pageSetup.fitToHeight = 0;
    sheet.pageSetup.orientation = 'portrait';
    if (Array.isArray(sheet.views) && sheet.views[0]) {
        sheet.views[0].style = 'pageBreakPreview';
    }
}

function fillAdHocSheet(workbook, lineItems) {
    const adHocItems = (lineItems || []).filter((i) => i.isAdHoc);
    const adHocSheet = workbook.getWorksheet(SHEET_ADHOC);
    if (!adHocSheet) return;

    if (!adHocItems.length) {
        // Nessun nuovo prezzo: rimuovi il foglio dall'export
        workbook.removeWorksheet(adHocSheet.id);
        return;
    }

    adHocItems.forEach((item, idx) => {
        const row = 15 + idx;
        if (row > 34) return;
        const sheetRow = adHocSheet.getRow(row);
        sheetRow.hidden = false;
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || 0;
        setCell(adHocSheet, row, 1, item.materialCode || `NP-${idx + 1}`);
        setCell(adHocSheet, row, 2, item.description || '');
        setCell(adHocSheet, row, 3, item.udm || '');
        setCell(adHocSheet, row, 4, qty);
        setCell(adHocSheet, row, 5, price);
        setCell(adHocSheet, row, 6, round2(qty * price));
        applyMaterialRowHeight(adHocSheet, row, item.description || '');
    });
    // Nasconde e pulisce le righe residue
    for (let row = 15 + adHocItems.length; row <= 34; row++) {
        clearRowCells(adHocSheet, row);
        const sheetRow = adHocSheet.getRow(row);
        sheetRow.hidden = true;
        sheetRow.height = DEFAULT_LINE_ROW_HEIGHT;
    }
    setCell(adHocSheet, 3, 6, formatDateIt(new Date()));
    if (adHocItems[0]) {
        setCell(adHocSheet, 4, 1, adHocItems[0].materialCode || 'NP-1');
        setCell(adHocSheet, 7, 1, adHocItems.map((i) => i.description).join('; '));
    }
}

/**
 * Rimuove il foglio catalogo (Tabella1): ExcelJS lo riscrive in modo non valido
 * e Excel chiede di riparare /xl/tables/table1.xml. Per l'export non serve.
 */
function removeCatalogSheet(workbook) {
    const catalog = workbook.getWorksheet(SHEET_CATALOG);
    if (catalog) workbook.removeWorksheet(catalog.id);
}

/**
 * @param {object} ctx
 * @param {object} ctx.quote - documento quote o consuntivo
 * @param {object} [ctx.parentQuote] - preventivo origine (se quote è CONSUNTIVO)
 * @param {object} [ctx.report]
 * @param {object} [ctx.lightPoint]
 * @param {object} [ctx.config] - maintenanceConfig
 * @param {object} [ctx.townHall] - { name }
 * @param {object} [ctx.approver] - { name, surname } se approvato
 * @param {Date|string} [ctx.operationDate] - data chiusura intervento (consuntivo)
 */
async function fillImsWorkbook(ctx) {
    const {
        quote,
        parentQuote,
        report,
        lightPoint,
        config,
        townHall,
        approver,
        operationDate,
    } = ctx;
    if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error(`Template IMS non trovato: ${TEMPLATE_PATH}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);
    const sheet = workbook.getWorksheet(SHEET_IMS);
    if (!sheet) {
        throw new Error(`Foglio "${SHEET_IMS}" non trovato nel template`);
    }

    const isConsuntivo = quote.type === 'CONSUNTIVO';
    const preventivoSource = isConsuntivo ? (parentQuote || quote) : quote;
    const headerCtx = { report, lightPoint, config, approver, townHall };

    fillPreventivoSection(sheet, preventivoSource, headerCtx);

    if (isConsuntivo) {
        fillConsuntivoSection(sheet, quote, { operationDate });
        sheet.pageSetup.printArea = `A1:F${SHEET_LAST_ROW}`;
        fillAdHocSheet(workbook, [
            ...(preventivoSource.lineItems || []),
            ...(quote.lineItems || []),
        ]);
    } else {
        collapseConsuntivoSection(sheet);
        fillAdHocSheet(workbook, quote.lineItems);
    }

    ensurePrintIncludesColumnF(sheet);
    removeCatalogSheet(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/**
 * Converte buffer XLSX in PDF via LibreOffice.
 * @throws Error se LibreOffice non è disponibile
 */
async function toPdf(xlsxBuffer) {
    let convert;
    try {
        // eslint-disable-next-line global-require
        convert = require('libreoffice-convert').convert;
    } catch (err) {
        const error = new Error('Modulo libreoffice-convert non disponibile');
        error.code = 'LIBREOFFICE_UNAVAILABLE';
        throw error;
    }

    return new Promise((resolve, reject) => {
        convert(xlsxBuffer, '.pdf', undefined, (err, done) => {
            if (err) {
                const error = new Error(
                    err.message || 'Conversione PDF fallita. Verificare che LibreOffice sia installato sul server.'
                );
                error.code = 'LIBREOFFICE_UNAVAILABLE';
                error.cause = err;
                reject(error);
                return;
            }
            resolve(Buffer.from(done));
        });
    });
}

module.exports = {
    TEMPLATE_PATH,
    computeQuoteTotals,
    fillImsWorkbook,
    toPdf,
    round2,
    quoteDocumentCode,
};
