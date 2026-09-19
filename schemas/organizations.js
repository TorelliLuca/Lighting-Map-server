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
    /** Solo per type TOWNHALL: legame org piattaforma ↔ comune (`organization_admin`). */
    townhallId: { type: Schema.Types.ObjectId, ref: 'townHalls' },
    /**
     * Il legame manutentore↔comune vive esclusivamente sul capitolato
     * (`maintenanceConfig.linkedOrganizations` con budget O/S).
     * Campo rimosso: migrare con `scripts/migrate-contracts-to-linkedOrganizations.js`.
     */
});

module.exports = mongoose.model('Organizations', organizationsSchema);