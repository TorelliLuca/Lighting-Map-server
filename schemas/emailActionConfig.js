const { Schema, model } = require('mongoose');

const AUDIENCE_MODES = [
    'staff_of_townhall',
    'admins',
    'creator',
    'explicit_types',
    'admin_email',
    'recipients',
];

const audienceSchema = new Schema({
    mode: {
        type: String,
        enum: AUDIENCE_MODES,
        default: 'staff_of_townhall',
    },
    userTypes: { type: [String], default: [] },
    subRoles: { type: [String], default: [] },
}, { _id: false });

const schema = new Schema({
    actionKey: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    locked: { type: Boolean, default: false },
    audience: { type: audienceSchema, default: () => ({}) },
    subjectTemplate: { type: String, required: true },
    bodyTemplate: { type: String, required: true },
    allowedPlaceholders: { type: [String], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'users', default: null },
}, {
    timestamps: true,
});

module.exports = model('emailActionConfigs', schema);
module.exports.AUDIENCE_MODES = AUDIENCE_MODES;
