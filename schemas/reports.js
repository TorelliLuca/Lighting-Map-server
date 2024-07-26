const { Schema, model } = require("mongoose")
//metodi della costante
const schema = new Schema({
    operation_point_id:{type: Schema.Types.ObjectId, ref: "lightPoints"},
    report_date: {type: Date, default: Date.now()},
    report_time: {type: String, default: ()=> {
        let date = new Date(Date.now())
        return (date.getHours().toString().padStart(2, '0')+":" +date.getUTCMinutes().toString().padStart(2, '0'))
    }},
    report_type: {type: String, enum: ["LIGHT_POINT_OFF", "PLANT_OFF", "DAMAGED_COMPLEX", "DAMAGED_SUPPORT", "BROKEN_TERMINAL_BLOCK", "BROKEN_PANEL", "OTHER"], default: "LIGHT_POINT_OFF"},
    description: {type: String, default: ""}
})

//per esportare il modello
module.exports = model("reports", schema)

/*
Punto luce spento
Impianto spento
Complesso danneggiato
Morsettiera rotta
Sostegno danneggiato
Quadro danneggiato
Altro*/
