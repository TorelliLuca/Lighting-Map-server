const DEFAULT_FAULT_LABELS = [
    {
        code: 'IMMEDIATE_DANGER',
        label: 'Pericolo immediato per la pubblica incolumità',
        urgencyOrder: 1,
        suggestedRiskClass: 'A',
    },
    {
        code: 'PLANT_OFF',
        label: 'Strada al buio / intera cabina spenta',
        urgencyOrder: 2,
        suggestedRiskClass: 'A',
    },
    {
        code: 'MULTIPLE_OFF',
        label: 'Tre o più punti luce spenti nello stesso tratto',
        urgencyOrder: 3,
        suggestedRiskClass: 'B',
    },
    {
        code: 'SINGLE_OFF',
        label: 'Punto luce singolo spento',
        urgencyOrder: 4,
        suggestedRiskClass: 'C',
    },
    {
        code: 'NON_URGENT',
        label: 'Anomalia non urgente',
        urgencyOrder: 5,
        suggestedRiskClass: 'D',
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

function cloneDefaults() {
    return {
        capitolatoVersion: '2026 Rev00',
        minDiscountPercent: 0,
        riskClasses: DEFAULT_RISK_CLASSES.map((item) => ({ ...item })),
        faultLabels: DEFAULT_FAULT_LABELS.map((item) => ({ ...item })),
        materialCatalog: [],
        standardTemplateId: 'bra-2026-rev00',
    };
}

module.exports = {
    DEFAULT_FAULT_LABELS,
    DEFAULT_RISK_CLASSES,
    cloneDefaults,
};
