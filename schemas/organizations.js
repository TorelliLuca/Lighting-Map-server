const mongoose = require('mongoose');
const { Schema } = mongoose;

const organizationsSchema = new Schema({
    name: { type: String, required: true },
    description: { type: String },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    logo: { type: String }, // URL al logo, come consigliato
    members: [{ type: Schema.Types.ObjectId, ref: 'users' }],
    type: { type: String, enum: ['TOWNHALL', 'ENTERPRISE'], required: true },
    location: {
        type: { type: String, default: 'Point' },
        coordinates: { type: [Number] } // [lng, lat] per GeoJSON
    },
    address: {
        street: { type: String },
        city: { type: String },
        province: { type: String },
        postal_code: { type: String },
        state: { type: String }
    },
    responsible: { type: Schema.Types.ObjectId, ref: 'users' },
    townhallId: { type: Schema.Types.ObjectId, ref: 'townHalls' }, // Solo per 'TOWNHALL'
    contracts: [{ // Solo per 'ENTERPRISE'
        townhall_associated: { type: Schema.Types.ObjectId, ref: 'townHalls' },
        start_date: { type: Date },
        end_date: { type: Date },
        details: { type: String },
        price: { type: Number }
    }]
});

module.exports = mongoose.model('Organizations', organizationsSchema);