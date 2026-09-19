const { Schema, model } = require('mongoose');

const recipientResultSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    email: { type: String, default: '' },
    name: { type: String, default: '' },
    surname: { type: String, default: '' },
    status: {
        type: String,
        enum: ['SENT', 'FAILED'],
        required: true,
    },
    error: { type: String, default: null },
}, { _id: false });

const schema = new Schema({
    subject: { type: String, required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    /** Destinatari tentati (totale). Su log legacy può coincidere con gli invii ok. */
    recipientCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: null },
    failedCount: { type: Number, default: null },
    filters: { type: Schema.Types.Mixed, default: null },
    userIds: { type: [Schema.Types.ObjectId], default: [] },
    /** Esito per destinatario (solo campagne da quando è stato introdotto). */
    results: { type: [recipientResultSchema], default: undefined },
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
