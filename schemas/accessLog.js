const mongoose = require('mongoose');
const { Schema } = mongoose;

const accessLogSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: false }, // può essere null per azioni anonime
  action: { type: String, required: true }, // es: LOGIN, LOGOUT, ACCESS_RESOURCE
  resource: { type: String, required: true }, // es: /api/reports/123
  timestamp: { type: Date, default: Date.now },
  ipAddress: { type: String },
  userAgent: { type: String },
  outcome: { type: String, enum: ['SUCCESS', 'FAILURE'], required: true },
  details: { type: String },
});

module.exports = mongoose.model('AccessLog', accessLogSchema); 