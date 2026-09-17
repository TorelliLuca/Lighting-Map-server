const ASSET_MARKERS = ['PL', 'QE'];

/** Fallback known codes → marker applicability (for configs without applicableTo). */
const KNOWN_FAULT_APPLICABLE_TO = {
    IMMEDIATE_DANGER: ['PL', 'QE'],
    PLANT_OFF: ['PL', 'QE'],
    MULTIPLE_OFF: ['PL'],
    SINGLE_OFF: ['PL'],
    NON_URGENT: ['PL', 'QE'],
    PANEL_DAMAGE: ['QE'],
    PANEL_DOOR_UNSAFE: ['QE'],
    PANEL_PROTECTION_TRIP: ['QE'],
    PANEL_SUPPLY_FAULT: ['QE'],
};

const DEFAULT_FAULT_LABELS = [
    {
        code: 'IMMEDIATE_DANGER',
        label: 'Pericolo immediato per la pubblica incolumità',
        urgencyOrder: 1,
        suggestedRiskClass: 'A',
        applicableTo: ['PL', 'QE'],
    },
    {
        code: 'PLANT_OFF',
        label: 'Strada al buio / intera cabina spenta',
        urgencyOrder: 2,
        suggestedRiskClass: 'A',
        applicableTo: ['PL', 'QE'],
    },
    {
        code: 'MULTIPLE_OFF',
        label: 'Tre o più punti luce spenti nello stesso tratto',
        urgencyOrder: 3,
        suggestedRiskClass: 'B',
        applicableTo: ['PL'],
    },
    {
        code: 'SINGLE_OFF',
        label: 'Punto luce singolo spento',
        urgencyOrder: 4,
        suggestedRiskClass: 'C',
        applicableTo: ['PL'],
    },
    {
        code: 'PANEL_DAMAGE',
        label: 'Quadro elettrico danneggiato',
        urgencyOrder: 3,
        suggestedRiskClass: 'B',
        applicableTo: ['QE'],
    },
    {
        code: 'PANEL_DOOR_UNSAFE',
        label: 'Sportello aperto / quadro non sicuro',
        urgencyOrder: 2,
        suggestedRiskClass: 'A',
        applicableTo: ['QE'],
    },
    {
        code: 'PANEL_PROTECTION_TRIP',
        label: 'Protezioni intervenute / interruttore scattato',
        urgencyOrder: 3,
        suggestedRiskClass: 'B',
        applicableTo: ['QE'],
    },
    {
        code: 'PANEL_SUPPLY_FAULT',
        label: 'Anomalia alimentazione quadro',
        urgencyOrder: 3,
        suggestedRiskClass: 'B',
        applicableTo: ['QE'],
    },
    {
        code: 'NON_URGENT',
        label: 'Anomalia non urgente',
        urgencyOrder: 5,
        suggestedRiskClass: 'D',
        applicableTo: ['PL', 'QE'],
    },
];

const DEFAULT_RISK_CLASSES = [
    {
        code: 'A',
        label: 'Priorità massima',
        description: 'Intervento urgente — rischio per la pubblica incolumità',
        defaultMaterialDays: 3,
        defaultWorkDays: 2,
    },
    {
        code: 'B',
        label: 'Priorità alta',
        description: 'Intervento prioritario — degrado significativo',
        defaultMaterialDays: 5,
        defaultWorkDays: 3,
    },
    {
        code: 'C',
        label: 'Priorità media',
        description: 'Intervento programmabile',
        defaultMaterialDays: 10,
        defaultWorkDays: 5,
    },
    {
        code: 'D',
        label: 'Priorità bassa',
        description: 'Anomalia non urgente',
        defaultMaterialDays: 15,
        defaultWorkDays: 7,
    },
];

const DEFAULT_MATERIAL_CATEGORIES = [
    'A) SCAVI E OPERE EDILI',
    'B) LINEE',
    'C) QUADRI ELETTRICI',
    'D) MATERIALI VARI',
    'E) LAVORI VARI',
    'H) MANODOPERA E NOLI',
];

function normalizeApplicableTo(raw, code) {
    const fromKnown = KNOWN_FAULT_APPLICABLE_TO[code];
    const source = Array.isArray(raw) && raw.length > 0 ? raw : (fromKnown || ASSET_MARKERS);
    const normalized = [...new Set(
        source
            .map((item) => String(item || '').toUpperCase())
            .filter((item) => ASSET_MARKERS.includes(item))
    )];
    return normalized.length > 0 ? normalized : [...ASSET_MARKERS];
}

function normalizeFaultLabelItem(item = {}) {
    const code = item.code || '';
    return {
        code,
        label: item.label || code,
        urgencyOrder: Number(item.urgencyOrder) || 0,
        suggestedRiskClass: ['A', 'B', 'C', 'D'].includes(item.suggestedRiskClass)
            ? item.suggestedRiskClass
            : 'C',
        applicableTo: normalizeApplicableTo(item.applicableTo, code),
    };
}

/**
 * Normalizza applicableTo sulle voci esistenti.
 * Con mergeDefaults=true aggiunge anche le voci capitolato mancanti (es. QE).
 */
function normalizeFaultLabelsList(list, { mergeDefaults = true } = {}) {
    const existing = Array.isArray(list) ? list.map(normalizeFaultLabelItem) : [];
    const byCode = new Map(existing.map((item) => [item.code, item]));
    if (mergeDefaults) {
        for (const def of DEFAULT_FAULT_LABELS) {
            if (!byCode.has(def.code)) {
                byCode.set(def.code, normalizeFaultLabelItem(def));
            }
        }
    }
    return Array.from(byCode.values()).sort(
        (a, b) => (a.urgencyOrder - b.urgencyOrder) || a.code.localeCompare(b.code)
    );
}

function isFaultLabelApplicableToMarker(faultLabel, marker) {
    const m = String(marker || '').toUpperCase();
    if (!ASSET_MARKERS.includes(m)) return true;
    const applicableTo = normalizeApplicableTo(faultLabel?.applicableTo, faultLabel?.code);
    return applicableTo.includes(m);
}

function filterFaultLabelsForMarker(faultLabels, marker, { includeCodes = [] } = {}) {
    const list = Array.isArray(faultLabels) ? faultLabels : [];
    const include = new Set((includeCodes || []).filter(Boolean));
    const filtered = list.filter(
        (item) => include.has(item.code) || isFaultLabelApplicableToMarker(item, marker)
    );
    if (filtered.length > 0) return filtered;
    return list.length > 0 ? list : [];
}

function cloneDefaults() {
    return {
        capitolatoVersion: '2026 Rev00',
        minDiscountPercent: 0,
        riskClasses: DEFAULT_RISK_CLASSES.map((item) => ({ ...item })),
        faultLabels: DEFAULT_FAULT_LABELS.map((item) => ({
            ...item,
            applicableTo: [...item.applicableTo],
        })),
        materialCatalog: [],
        materialCategories: [...DEFAULT_MATERIAL_CATEGORIES],
        regionalPriceListId: null,
        standardTemplateId: 'bra-2026-rev00',
    };
}

module.exports = {
    ASSET_MARKERS,
    KNOWN_FAULT_APPLICABLE_TO,
    DEFAULT_FAULT_LABELS,
    DEFAULT_RISK_CLASSES,
    DEFAULT_MATERIAL_CATEGORIES,
    normalizeApplicableTo,
    normalizeFaultLabelItem,
    normalizeFaultLabelsList,
    isFaultLabelApplicableToMarker,
    filterFaultLabelsForMarker,
    cloneDefaults,
};
