const { Schema, model } = require('mongoose');
const { DEFAULT_MATERIAL_CATEGORIES } = require('../utils/maintenanceConfigDefaults');

const regionalMaterialSchema = new Schema({
    code: { type: String, required: true },
    /** Descrizione breve */
    description: { type: String, required: true },
    /** Descrizione completa */
    fullDescription: { type: String, default: '' },
    udm: { type: String, default: 'cad' },
    unitPrice: { type: Number, required: true, min: 0 },
    category: { type: String, default: '' },
}, { _id: false });

const schema = new Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    categories: {
        type: [String],
        default: () => [...DEFAULT_MATERIAL_CATEGORIES],
    },
    materials: { type: [regionalMaterialSchema], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'users', default: null },
}, {
    timestamps: true,
});

schema.index({ name: 1 }, { unique: true });

module.exports = model('regionalPriceLists', schema);
