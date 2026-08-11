const { Schema, model } = require('mongoose');

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

const materialCatalogItemSchema = new Schema({
    code: { type: String, required: true },
    description: { type: String, required: true },
    udm: { type: String, default: 'cad' },
    unitPrice: { type: Number, required: true, min: 0 },
    category: { type: String, default: '' },
    isStandard: { type: Boolean, default: true },
}, { _id: false });

const CAPITOLATO_STATUSES = ['active', 'draft', 'archived'];

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
    materialCatalog: { type: [materialCatalogItemSchema], default: [] },
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
