const { Schema, model } = require("mongoose")

const classificationSchema = new Schema({
    status: {
        type: String,
        enum: ["PROVISIONAL", "CONFIRMED", "MODIFIED"],
        default: "PROVISIONAL",
    },
    proposedBy: { type: Schema.Types.ObjectId, ref: "users", default: null },
    proposedAt: { type: Date, default: null },
    confirmedBy: { type: Schema.Types.ObjectId, ref: "users", default: null },
    confirmedAt: { type: Date, default: null },
    previousRiskClass: { type: String, default: null },
    previousFaultLabel: { type: String, default: null },
}, { _id: false })

const plantContextSchema = new Schema({
    quadroId: { type: Schema.Types.ObjectId, ref: "lightPoints", default: null },
    quadroLabel: { type: String, default: "" },
}, { _id: false })

const suspensionSchema = new Schema({
    reason: { type: String, default: "" },
    days: { type: Number, default: null, min: 1 },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: Schema.Types.ObjectId, ref: "users", default: null },
}, { _id: false })

const statusHistorySchema = new Schema({
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "users", default: null },
    note: { type: String, default: "" },
}, { _id: false })

const schema = new Schema({
    operation_point_id: { type: Schema.Types.ObjectId, ref: "lightPoints" },
    user_creator_id: { type: Schema.Types.ObjectId, ref: "users" },
    user_responsible_id: { type: Schema.Types.ObjectId, ref: "users", default: null },
    report_date: { type: Date, default: Date.now() },
    report_time: {
        type: String,
        default: () => {
            const date = new Date(Date.now())
            return `${date.getHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`
        },
    },
    // Stringa libera: tipizzazioni legacy (LIGHT_POINT_OFF, …) oppure
    // codici fault label del capitolato comunale (configurabili, es. MULTIPLE_OFF).
    report_type: {
        type: String,
        default: "LIGHT_POINT_OFF",
    },
    description: { type: String, default: "" },
    is_solved: { type: Boolean, default: false },
    maintenance_category: {
        type: String,
        enum: ["ORDINARY", "EXTRAORDINARY"],
        default: "ORDINARY",
    },
    workflow_status: {
        type: String,
        enum: ["OPEN", "CLASSIFICATION_PENDING", "SURVEYED", "SUSPENDED", "SCHEDULED", "PENDING_QUOTE", "ESCALATED", "RESOLVED"],
        default: "OPEN",
    },
    risk_class: { type: String, enum: ["A", "B", "C", "D", null], default: null },
    fault_label: { type: String, default: null },
    classification: { type: classificationSchema, default: () => ({}) },
    plant_context: { type: plantContextSchema, default: () => ({}) },
    suspension: { type: suspensionSchema, default: () => ({}) },
    scheduled_resolution_date: { type: Date, default: null },
    parent_report_id: { type: Schema.Types.ObjectId, ref: "reports", default: null },
    linked_quote_id: { type: Schema.Types.ObjectId, ref: "quotes", default: null },
    due_date: { type: Date, default: null },
    town_hall_id: { type: Schema.Types.ObjectId, ref: "townHalls", default: null },
    status_history: { type: [statusHistorySchema], default: [] },
})

module.exports = model("reports", schema)
