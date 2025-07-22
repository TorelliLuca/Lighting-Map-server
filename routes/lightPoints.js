const express = require('express');
const lightPoints = require('../schemas/lightPoints');
const townHalls = require('../schemas/townHalls');
const mongoose = require('mongoose');

const router = express.Router();

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