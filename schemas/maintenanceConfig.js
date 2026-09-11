const { Schema, model } = require('mongoose');
const { DEFAULT_MATERIAL_CATEGORIES } = require('../utils/maintenanceConfigDefaults');

const riskClassSchema = new Schema({
    code: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    defaultMaterialDays: { type: Number, default: 0, min: 0 },
    defaultWorkDays: { type: Number, default: 0, min: 0 },
}, { _id: false });

const faultLabelSchema = new Schema({
    code: { type: String, required: true },
    label: { type: String, required: true },
    urgencyOrder: { type: Number, default: 0 },
    suggestedRiskClass: { type: String, enum: ['A', 'B', 'C', 'D'], default: 'C' },
}, { _id: false });

const MATERIAL_PRICE_TYPES = ['regional', 'user', 'capitolato'];

/** Distinta BOM di un Nuovo Prezzo nel prezziario. */
const materialBomItemSchema = new Schema({
    materialCode: { type: String, default: '' },
    description: { type: String, default: '' },
    fullDescription: { type: String, default: '' },
    udm: { type: String, default: 'cad' },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    category: { type: String, default: '' },
    isAdHoc: { type: Boolean, default: false },
}, { _id: false });

const materialCatalogItemSchema = new Schema({
    code: { type: String, required: true },
    /** Descrizione breve (mostrata di default in elenco/preventivo) */
    description: { type: String, required: true },
    /** Descrizione completa (visibile nei dettagli) */
    fullDescription: { type: String, default: '' },
    udm: { type: String, default: 'cad' },
    unitPrice: { type: Number, required: true, min: 0 },
    category: { type: String, default: '' },
    isStandard: { type: Boolean, default: true },
    /** Origine voce: prezziario regionale, utente, capitolato */
    priceType: {
        type: String,
        enum: MATERIAL_PRICE_TYPES,
        default: 'capitolato',
    },
    /** Nominativo se priceType === 'user' */
    addedBy: { type: String, default: '' },
    /** Distinta componenti (NP compositi) */
    bom: { type: [materialBomItemSchema], default: [] },
}, { _id: false });

const CAPITOLATO_STATUSES = ['active', 'draft', 'archived'];

/** Organizzazioni manutentori collegate al capitolato, con budget O/S. */
const linkedOrganizationSchema = new Schema({
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organizations',
        required: true,
    },
    budgetOrdinary: { type: Number, default: 0, min: 0 },
    budgetExtraordinary: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '' },
}, { _id: false });

const schema = new Schema({
    townHallId: { type: Schema.Types.ObjectId, ref: 'townHalls', required: true },
    status: {
        type: String,
        enum: CAPITOLATO_STATUSES,
        default: 'active',
        required: true,
    },
    capitolatoVersion: { type: String, default: '2026 Rev00' },
    minDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
    validFrom: { type: Date, default: Date.now },
    validTo: { type: Date, default: null },
    riskClasses: { type: [riskClassSchema], default: [] },
    faultLabels: { type: [faultLabelSchema], default: [] },
    /** Voci locali (user + capitolato). Il regionale arriva dal prezziario collegato. */
    materialCatalog: { type: [materialCatalogItemSchema], default: [] },
    materialCategories: { type: [String], default: () => [...DEFAULT_MATERIAL_CATEGORIES] },
    regionalPriceListId: {
        type: Schema.Types.ObjectId,
        ref: 'regionalPriceLists',
        default: null,
    },
    /**
     * Manutentori (ENTERPRISE) associati a questo capitolato.
     * Sostituisce il vecchio contracts[] org↔comune: budget ordinaria/straordinaria qui.
     */
    linkedOrganizations: { type: [linkedOrganizationSchema], default: [] },
    standardTemplateId: { type: String, default: 'bra-2026-rev00' },
    sequences: {
        quotes: { type: Map, of: Number, default: {} },
        verifications: { type: Map, of: Number, default: {} },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'users', default: null },
}, {
    timestamps: true,
});

schema.index({ townHallId: 1, status: 1 });
schema.index({ regionalPriceListId: 1 });
schema.index({ 'linkedOrganizations.organizationId': 1 });
schema.index(
    { townHallId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'active' },
        name: 'unique_active_per_townHall',
    }
);
schema.index(
    { townHallId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'draft' },
        name: 'unique_draft_per_townHall',
    }
);

module.exports = model('maintenanceConfigs', schema);
module.exports.CAPITOLATO_STATUSES = CAPITOLATO_STATUSES;
module.exports.MATERIAL_PRICE_TYPES = MATERIAL_PRICE_TYPES;
module.exports.DEFAULT_MATERIAL_CATEGORIES = DEFAULT_MATERIAL_CATEGORIES;
