const express = require('express');
const axios = require('axios');
const debug = require('debug')('lighting-map');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
      const response = await axios.get(`https://maps.googleapis.com/maps/api/js?key=${process.env.GOOGLE_MAPS_APY_KEY}&callback=initMap`);
      res.send(response.data);
    } catch (error) {
        debug(error)
      res.status(500).send('Errore nella richiesta alla Google Maps API');
    }
});

module.exports = router; 