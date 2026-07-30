const { Schema, model } = require('mongoose');

const NOTIFICATION_TYPES = [
  'REPORT_CREATED',
  'REPORT_SOLVED',
  'USER_VALIDATED',
  'USER_NEED_VALIDATION',
  'ACCOUNT_APPROVED',
  'UPLOAD_SUCCESS',
  'UPLOAD_ERROR',
  'EMAIL_CONFIRMATION',
  'PASSWORD_RESET',
  'GENERIC',
];

const NotificationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'users',
    required: true,
    index: true,
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    default: 'GENERIC',
    index: true,
  },
  url: { type: String, default: null },
  meta: {
    type: Schema.Types.Mixed,
    default: null,
  },
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = model('notifications', NotificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
