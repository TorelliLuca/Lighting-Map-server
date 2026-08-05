const express = require('express');
const lightPoints = require('../schemas/lightPoints');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const mongoose = require('mongoose');
const {
    normalizeItalianCoordinate,
    applyItalianCoordinatesToLightPoint
} = require('../utils/utility');

const router = express.Router();

const BATCH_UPDATE_MAX = 500;

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
            const latRes = normalizeItalianCoordinate(item.lat, 'lat');
            const lngRes = normalizeItalianCoordinate(item.lng, 'lng');
            if (!latRes.ok || !lngRes.ok || latRes.numeric == null || lngRes.numeric == null) {
                invalid.push({
                    _id: id,
                    reason: [latRes.ok ? null : latRes.reason, lngRes.ok ? null : lngRes.reason]
                        .filter(Boolean)
                        .join('; ') || 'coordinate non valide'
                });
                continue;
            }
            ops.push({
                updateOne: {
                    filter: { _id: id },
                    update: {
                        $set: {
                            lat: latRes.value,
                            lng: lngRes.value
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
    const coordErrors = applyItalianCoordinatesToLightPoint(lpToUpdate);
    if (coordErrors.length > 0) {
        return res.status(400).send('Coordinate non valide: ' + coordErrors.join('; '));
    }
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

    const normalizedNumeroPalo = String(lpToCreate?.numero_palo || '').trim();
    if (!normalizedNumeroPalo) {
        return res.status(400).json({ error: 'Il campo numero_palo è obbligatorio.' });
    }

    const duplicateLightPoint = await lightPoints.findOne({
        _id: { $in: townHall.punti_luce || [] },
        numero_palo: { $regex: `^${normalizedNumeroPalo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    }).select('_id numero_palo marker');

    if (duplicateLightPoint) {
        return res.status(409).json({
            error: `Il numero_palo "${normalizedNumeroPalo}" è già presente nel comune ${townHallName}.`,
            code: 'DUPLICATE_NUMERO_PALO',
            duplicate: {
                _id: duplicateLightPoint._id,
                numero_palo: duplicateLightPoint.numero_palo,
                marker: duplicateLightPoint.marker
            }
        });
    }

    lpToCreate.numero_palo = normalizedNumeroPalo;

    const coordErrors = applyItalianCoordinatesToLightPoint(lpToCreate);
    if (coordErrors.length > 0) {
        return res.status(400).send('Coordinate non valide: ' + coordErrors.join('; '));
    }

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
        const childCount = await lightPoints.countDocuments({ parent: _id });
        if (childCount > 0) {
            return res.status(409).json({
                error: `Impossibile eliminare: ${childCount} nodi hanno questo punto come genitore topologico. Scollegali o riassegna il parent prima di eliminare.`,
                code: 'HAS_TOPOLOGY_CHILDREN',
                children_count: childCount
            });
        }

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
