const express = require('express');
const mongoose = require('mongoose');
const borders = require("./../schemas/borders");
const townHalls = require('../schemas/townHalls');
const router = express.Router();
const { getPolygonCentroid} = require("../utils/geometry")



router.get("/:istat_code", async (req, res)=>{
    try {
        const comuneDoc = await borders.findOne({ 'properties.pro_com_t': req.params.istat_code });

        if (comuneDoc) {
            res.json(comuneDoc);
        } else {
            res.status(404).json({ error: 'Comune non trovato.' });
        }
    } catch (err) {
        res.status(500).json({error: "Errore del server"})
        console.error(err)
    }
})
router.get("/townhall-name/:name", async (req, res) => {

    const townhallName = req.params.name;

    try {
        const townhall = await townHalls.findOne({ name: townhallName });

        if (!townhall) {
            return res.status(404).json({ error: 'Comune non trovato.' });
        }

        const comuneDoc = await borders.findById(townhall.borders);


        if (!comuneDoc) {
             return res.status(404).json({ error: 'Borders non trovati per il comune.' });
        }

        res.status(200).json(comuneDoc);

    } catch (err) {
        console.error('Errore nel recupero del comune:', err);
        res.status(500).json({ error: "Errore del server." });
    }
});



// Endpoint 1: Ricerca comuni per prefisso
router.get('/suggest-townhall-name/prefix', async (req, res) => {
  const { prefix } = req.query;
  console.log(prefix);

  // Controllo sulla validità dell'input
  if (!prefix || typeof prefix !== 'string' || prefix.length < 2) {
    return res.status(400).json({ error: 'Fornire un prefisso valido di almeno 2 caratteri.' });
  }

  try {
    // Utilizziamo un'espressione regolare per la ricerca case-insensitive e che inizia per il prefisso
    const regex = new RegExp(`^${prefix}`, 'i');
    
    // Proiezione: recuperiamo solo i campi essenziali per alleggerire il payload
    const comuni = await borders.find(
      { 'properties.comune': { $regex: regex } },
      { 'properties.comune': 1, 'properties.pro_com_t': 1, '_id': 1 }
    ).limit(10); // Limita i risultati per prevenire risposte troppo grandi

    res.json(comuni);
  } catch (err) {
    console.error('Errore durante la ricerca dei comuni:', err);
    res.status(500).json({ error: 'Errore interno del server.' });
  }
});

router.get('/geo-info/:id', async (req, res) => {
  const { id } = req.params;

  // Controllo sulla validità dell'ID di MongoDB
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID non valido.' });
  }

  try {
    const comune = await borders.findById(id);

    if (!comune) {
      return res.status(404).json({ error: 'Comune non trovato.' });
    }

    // Calcolo del centroide
    let latitudine, longitudine
    try{
        const { lat, lng } = getPolygonCentroid(comune.geometry.coordinates);
        latitudine = lat
        longitudine = lng
    }catch(e){
        latitudine = null
        longitudine = null
    }
    // Creazione del payload di risposta con i campi richiesti
    const responsePayload = {
      id: comune._id,
      comune: comune.properties.comune,
      regione: comune.properties.den_reg,
      provincia: comune.properties.den_uts,
      latitudine: latitudine,
      longitudine: longitudine,
    };

    res.json(responsePayload);
  } catch (err) {
    console.error('Errore durante il recupero del comune:', err);
    res.status(500).json({ error: 'Errore interno del server.' });
  }
});


module.exports = router;