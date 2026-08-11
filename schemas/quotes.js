const { Schema, model } = require('mongoose');

const lineItemSchema = new Schema({
    materialCode: { type: String, default: '' },
    description: { type: String, required: true },
    udm: { type: String, default: 'cad' },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    category: { type: String, default: '' },
    isAdHoc: { type: Boolean, default: false },
    /** Contestazione RUP sul consuntivo (voce non chiara) */
    isContested: { type: Boolean, default: false },
    contestNote: { type: String, default: '' },
}, { _id: false });

const statusHistorySchema = new Schema({
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    note: { type: String, default: '' },
}, { _id: false });

const documentsSchema = new Schema({
    xlsxPath: { type: String, default: null },
    pdfPath: { type: String, default: null },
}, { _id: false });

const schema = new Schema({
    type: {
        type: String,
        enum: ['QUOTE', 'CONSUNTIVO'],
        default: 'QUOTE',
    },
    protocolNumber: { type: String, default: null },
    townHallId: { type: Schema.Types.ObjectId, ref: 'townHalls', required: true },
    lightPointId: { type: Schema.Types.ObjectId, ref: 'lightPoints', required: true },
    reportId: { type: Schema.Types.ObjectId, ref: 'reports', default: null, index: true },
    verificationId: { type: Schema.Types.ObjectId, default: null },
    parentQuoteId: { type: Schema.Types.ObjectId, ref: 'quotes', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'users', required: true },
    assignedMaintainer: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    status: {
        type: String,
        enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'NEEDS_REVISION'],
        default: 'DRAFT',
    },
    priorityClass: { type: String, enum: ['A', 'B', 'C', 'D'], default: 'C' },
    materialLeadDays: { type: Number, default: 0, min: 0 },
    workLeadDays: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, default: null },
    lineItems: { type: [lineItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    safetyChargeRate: { type: Number, default: 0.02, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0 },
    faultDescription: { type: String, default: '' },
    notes: { type: String, default: '' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    approvedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: '' },
    documents: { type: documentsSchema, default: () => ({}) },
    statusHistory: { type: [statusHistorySchema], default: [] },
}, {
    timestamps: true,
});

schema.index({ townHallId: 1, status: 1, createdAt: -1 });

module.exports = model('quotes', schema);
