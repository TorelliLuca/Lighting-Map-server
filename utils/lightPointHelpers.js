const light_points = require('../schemas/lightPoints');

async function getPuntoLuceById(id) {
    try {
        const puntoLuce = await light_points.findById(id);
        return puntoLuce;
    } catch (error) {
        console.error('Errore nel recuperare il punto luce:', error);
        return null;
    }
}

async function getAllPuntiLuce(ids) {
    try {
        const puntiLuce = await Promise.all(ids.map(id => getPuntoLuceById(id)));
        return puntiLuce;
    } catch (error) {
        console.error('Errore nel recuperare i punti luce:', error);
        return [];
    }
}

module.exports = {
    getPuntoLuceById,
    getAllPuntiLuce
}; 