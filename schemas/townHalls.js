const { Schema, model } = require("mongoose")

const schema = new Schema({
    name: {type: String, required: true},
    region: {type: String},
    province: {type: String},
    coordinates: {
        lat: {type: Number},
        lng: {type: Number}
    },
    punti_luce: [{type: Schema.Types.ObjectId, ref: "lightPoints"}],
    created_at: {type: Date, default: Date.now},
    updated_at: {type: Date, default: Date.now}
})

// Middleware to update the "updated_at" field on document updates
schema.pre('save', function(next) {
    if (this.isModified() && !this.isNew) {
        this.updated_at = Date.now();
    }
    next();
});

module.exports = model("townHalls", schema)

/*
Punto luce spento
Impianto spento
Complesso danneggiato
Morsettiera rotta
Sostegno danneggiato
Quadro danneggiato
Altro*/
