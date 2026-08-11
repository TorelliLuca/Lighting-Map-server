const { Schema, model } = require('mongoose');

const schema = new Schema({
    subject: { type: String, required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    recipientCount: { type: Number, default: 0 },
    filters: { type: Schema.Types.Mixed, default: null },
    userIds: { type: [Schema.Types.ObjectId], default: [] },
    status: {
        type: String,
        enum: ['SUCCESS', 'PARTIAL', 'FAILED'],
        default: 'SUCCESS',
    },
    errorMessage: { type: String, default: null },
}, {
    timestamps: { createdAt: true, updatedAt: false },
});

schema.index({ createdAt: -1 });

module.exports = model('newsletterLogs', schema);
