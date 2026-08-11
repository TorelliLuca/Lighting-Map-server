const { Schema, model } = require("mongoose")

const schema = new Schema({
    reportId: { type: Schema.Types.ObjectId, ref: "reports", required: true },
    lightPointId: { type: Schema.Types.ObjectId, ref: "lightPoints", required: true },
    townHallId: { type: Schema.Types.ObjectId, ref: "townHalls", required: true },
    inspectorId: { type: Schema.Types.ObjectId, ref: "users", required: true },
    outcome: {
        type: String,
        enum: ["RESOLVED", "SUSPENDED", "SCHEDULED", "SAFE_PENDING_RESTORATION", "REQUIRES_QUOTE"],
        required: true,
    },
    riskClassConfirmed: { type: String, enum: ["A", "B", "C", "D", null], default: null },
    faultLabelConfirmed: { type: String, default: null },
    classificationModified: { type: Boolean, default: false },
    suspensionReason: { type: String, default: "" },
    suspensionDays: { type: Number, default: null, min: 1 },
    scheduledDate: { type: Date, default: null },
    notes: { type: String, default: "" },
    operationId: { type: Schema.Types.ObjectId, ref: "operations", default: null },
    childReportId: { type: Schema.Types.ObjectId, ref: "reports", default: null },
}, {
    timestamps: true,
})

schema.index({ reportId: 1 }, { unique: true })
schema.index({ townHallId: 1, createdAt: -1 })

module.exports = model("inspections", schema)
