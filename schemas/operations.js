const { Schema, model } = require("mongoose")

const schema = new Schema({
    operation_point_id:{type: Schema.Types.ObjectId, ref: "lightPoints"},
    operation_date: {type: Date, default: Date.now()},
    operation_responsible: {type: Schema.Types.ObjectId, ref: "users"},
    operation_type: {type: String, enum: ["MADE_SAFE_BUT_SYSTEM_NEEDS_RESTORING", "FAULT_ELIMINATED_AND_SYSTEM_RESTORED", "OTHER"], default: "OTHER"},
    note: {type: String, default: ""},
    report_to_solve:{type: Schema.Types.ObjectId, ref: "reports"},
    is_solved: {type: Boolean, default: false},
    maintenance_type: {type: String, enum: ["ORDINARY", "EXTRAORDINARY"], default: "ORDINARY"}
})

module.exports = model("operations", schema)
