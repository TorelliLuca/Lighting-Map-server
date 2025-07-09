const { Schema, model } = require("mongoose")
//metodi della costante
const schema = new Schema({
    marker: {type: String, default: ""},
    numero_palo: {type: String, default: ""},
    composizione_punto: {type: String, default: ""},
    indirizzo: {type: String, default: ""},
    lotto: {type: String, default: ""},
    quadro: {type: String, default: ""},
    proprieta: {type: String, default: ""},
    tipo_apparecchio: {type: String, default: ""},
    modello: {type: String, default: ""},
    numero_apparecchi: {type: String, default: ""},
    lampada_potenza: {type: String, default: ""},
    tipo_sostegno: {type: String, default: ""},
    tipo_linea: {type: String, default: ""},
    promiscuita: {type: String, default: ""},
    note: {type: String, default: ""},
    garanzia: {type: String, default: ""},
    lat: {type: String, default: ""},
    lng: {type: String, default: ""},
    pod: {type: String, default: ""},
    numero_contatore: {type: String, default: ""},
    alimentazione: {type: String, default: ""},
    potenza_contratto: {type: String, default: ""},
    potenza: {type: String, default: ""},
    punti_luce: {type: String, default: ""},
    tipo: {type: String, default: ""},
    segnalazioni_in_corso:[{type: Schema.Types.ObjectId, ref: "reports"}],
    segnalazioni_risolte:[{type: Schema.Types.ObjectId, ref: "reports"}],
    operazioni_effettuate: [{type: Schema.Types.ObjectId, ref: "operations"}]   
})

//per esportare il modello
module.exports = model("lightPoints", schema)

schema.post('findOneAndDelete', async function(doc) {
    if (doc) {
      await require('./townHalls').updateMany(
        { punti_luce: doc._id },
        { $pull: { punti_luce: doc._id } }
      );
    }
  });

/*
Punto luce spento
Impianto spento
Complesso danneggiato
Morsettiera rotta
Sostegno danneggiato
Quadro danneggiato
Altro*/
