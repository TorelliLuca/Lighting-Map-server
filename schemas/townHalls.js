const { Schema, model } = require("mongoose")
//metodi della costante
const schema = new Schema({
    name: {type: String, required: true},
    punti_luce: [{type: Schema.Types.ObjectId, ref: "lightPoints"}],

})

//per esportare il modello
module.exports = model("townHalls", schema)

/*
Punto luce spento
Impianto spento
Complesso danneggiato
Morsettiera rotta
Sostegno danneggiato
Quadro danneggiato
Altro*/
