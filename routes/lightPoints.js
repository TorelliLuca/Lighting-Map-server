const express = require('express');
const lightPoints = require('../schemas/lightPoints');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const mongoose = require('mongoose');

const router = express.Router();

const BATCH_UPDATE_MAX = 500;

function parseCoord(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/**
 * Aggiorna lat/lng di più punti luce in un'unica richiesta (strumento lazo).
 * Body: { updates: [{ _id, lat, lng }, ...] }
 * Solo SUPER_ADMIN.
 */
router.patch('/updateBatch', async (req, res) => {
    try {
        const requester = await users.findById(req.user.id).select('user_type');
        if (!requester || requester.user_type !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Accesso negato, non possiedi i diritti necessari!' });
        }

        const { updates } = req.body || {};
        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ error: 'Body non valido: richiesto updates (array non vuoto).' });
        }
        if (updates.length > BATCH_UPDATE_MAX) {
            return res.status(400).json({
                error: `Troppi aggiornamenti in una sola richiesta (max ${BATCH_UPDATE_MAX}).`
            });
        }

        const ops = [];
        const invalid = [];

        for (const item of updates) {
            const id = item?._id;
            if (!id || !mongoose.Types.ObjectId.isValid(id)) {
                invalid.push({ _id: id, reason: 'id non valido' });
                continue;
            }
            const lat = parseCoord(item.lat);
            const lng = parseCoord(item.lng);
            if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                invalid.push({ _id: id, reason: 'coordinate non valide' });
                continue;
            }
            ops.push({
                updateOne: {
                    filter: { _id: id },
                    update: {
                        $set: {
                            lat: String(lat),
                            lng: String(lng)
                        }
                    }
                }
            });
        }

        if (ops.length === 0) {
            return res.status(400).json({
                error: 'Nessun aggiornamento valido.',
                failed: invalid
            });
        }

        const result = await lightPoints.bulkWrite(ops, { ordered: false });
        const matched = result.matchedCount ?? 0;
        const modified = result.modifiedCount ?? 0;

        if (invalid.length > 0) {
            return res.status(207).json({
                updated: modified,
                matched,
                failed: invalid,
                message: `${modified} punti aggiornati, ${invalid.length} non validi.`
            });
        }

        res.json({
            updated: modified,
            matched,
            failed: [],
            message: `${modified} punti luce aggiornati con successo.`
        });
    } catch (error) {
        console.error('Errore updateBatch:', error);
        res.status(500).json({ error: 'Errore del server: ' + error.message });
    }
});

router.post('/update/:_id', async (req, res) => {
    const type = req.body.user_type;
    if(type !== "SUPER_ADMIN") {
        return res.status(403).send("Accesso negato, non possiedi i diritti necessari!");
    }

    const _id = req.params._id; 
    const lpToUpdate = req.body.light_point; 

    try {
        const updatedLP = await lightPoints.findOneAndUpdate(
            { _id: _id }, 
            lpToUpdate, 
            { new: true } 
        );

        if (!updatedLP) {
            return res.status(404).send("Punto luce non trovato.");
        }

        res.send(updatedLP); 
    } catch (error) {
        res.status(500).send("Errore del server: " + error.message);
    }
});

router.post('/create', async (req, res) => {
    const { light_point: lpToCreate, town_hall: townHallName, return_object: returnObject } = req.body;
    
    const townHall = await townHalls.findOne({name: townHallName});
    if(!townHall) {
        return res.status(404).send("Comune non trovato.");
    }
    console.log(lpToCreate);

    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const newLP = new lightPoints(lpToCreate);
        await newLP.save({ session });

        townHall.punti_luce.push(newLP._id);
        await townHall.save({ session });

        await session.commitTransaction();

        if (returnObject === true) {
            return res.status(201).json(newLP);
        }
        res.status(201).send("Punto luce creato con successo.");
    } catch (error) {
        await session.abortTransaction();
        res.status(500).send("Errore del server: " + error.message);
    } finally {
        session.endSession();
    }
});

router.delete('/delete/:_id',  async (req, res) => {
    const _id = req.params._id;
    const lpToDelete = await lightPoints.findOne({_id: _id});
    if(!lpToDelete) {
        return res.status(404).send("Punto luce non trovato.");
    }
    try {
        const townHall = await townHalls.findOne({punti_luce: _id});
        if(townHall) {
            townHall.punti_luce = townHall.punti_luce.filter(id => id.toString() !== _id);
            await townHall.save();
        }
        await lightPoints.deleteOne({_id: _id});
        res.status(200).send("Punto luce eliminato con successo.");
    } catch (error) {
        res.status(500).send("Errore del server: " + error.message);
    }
    
});

router.get('/:_id', async (req, res) => {
    const _id = req.params._id;
    try {
        const lightPoint = await lightPoints.findById(_id);
        if (!lightPoint) {
            return res.status(404).send("Punto luce non trovato.");
        }
        res.json(lightPoint);
    } catch (error) {
        res.status(500).send("Errore del server: " + error.message);
    }
});

module.exports = router; 