const mongoose = require('mongoose');

// Definizione dello schema GeoJSON per un Poligono
const geometrySchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['Polygon'],
        required: true
    },
    coordinates: {
        type: [[[Number]]],
        required: true
    }
});

// Definizione dello schema per le proprietà del comune
const propertiesSchema = new mongoose.Schema({
    pkuid: Number,
    cod_rip: Number,
    cod_reg: Number,
    cod_prov: Number,
    cod_cm: Number,
    cod_uts: Number,
    pro_com: Number,
    
    pro_com_t: { type: String, required: true, index: true },  //codice istat
    comune: {
      type: String,
      required: true,
      index: true, // Aggiungiamo un indice per velocizzare la ricerca per nome
    },
    comune_a: String,
    cc_uts: Number,
    shape_leng: Number,
    shape_area: Number,
    den_cm: String,
    den_prov: String,
    // Ho rinominato 'den_reg' in 'region_name'
    den_reg: String,
    // Ho rinominato 'den_rip' in 'macroregion_name'
    den_rip: String,
    den_uts: String,
    ontopia: String,
    // Ho rinominato 'sigla' in 'province_code'
    sigla: String,
    tipo_uts: String
}, { _id: false });

// Schema principale per la Feature GeoJSON
const bordersSchema = new mongoose.Schema({
    type: {
        type: String,
        default: 'Feature'
    },
    properties: {
        type: propertiesSchema,
        required: true
    },
    geometry: {
        type: geometrySchema,
        required: true,
        // Crea un indice geospaziale su questo campo per query veloci
        index: '2dsphere' 
    }
}, { collection: 'borders' }); // Specifica il nome della collezione esistente

// Creazione del modello
const borders = mongoose.model('borders', bordersSchema);

module.exports = borders;