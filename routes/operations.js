const express = require('express');
const townHalls = require('../schemas/townHalls');
const operations = require('../schemas/operations');
const light_points = require('../schemas/lightPoints');
const users = require('../schemas/users');
const mongoose = require('mongoose');
const { getAllPuntiLuce } = require('../utils/lightPointHelpers');

const router = express.Router();

router.post('/addOperation', async (req, res) => {
    try {
        const th = await townHalls.findOne({ name: {$eq: req.body.name} });

        if (!th) {
            return res.status(404).send('Comune non trovato');
        }

        const ids = th.punti_luce;
        const puntiLuce = await getAllPuntiLuce(ids);

        const puntoLuce = puntiLuce.find(punto => {
            if (punto) {
                return punto.numero_palo === req.body.numero_palo;
            } else {
                return false;
            }
        });
        
        if (!puntoLuce) {
            return res.status(404).send('Punto luce non trovato');
        }

        const user = await users.findOne({email: {$eq:req.body.email}});
        if (!user) {
            return res.status(404).send('utente non trovato');
        }

        await puntoLuce.populate('segnalazioni_in_corso');

        const report = await puntoLuce.segnalazioni_in_corso.find(segnalazione =>{
            if (segnalazione){
                return segnalazione._id == req.body.id_segnalazione;
            }else{
                return false;
            }
        });

        if(!report && req.body.id_segnalazione !== null){
            return res.status(404).send('segnalazione non trovata');
        }
        
        const fakeReport = {
            _id: new mongoose.Types.ObjectId(),
            description: "Operazione effettuata senza segnalazione"
        }
        
        const nuovaOperazione = new operations({
            operation_point_id: puntoLuce._id,
            operation_responsible: user,
            operation_type: req.body.operation_type,
            note: req.body.note,
            report_to_solve: report? report: fakeReport,
            is_solved: req.body.is_solved,
            operation_date: req.body.date
        });

        if (req.body.is_solved && report) {
            puntoLuce.segnalazioni_in_corso.pull(report);
            puntoLuce.segnalazioni_risolte.push(report);
        }

        puntoLuce.operazioni_effettuate.push(nuovaOperazione);

        await nuovaOperazione.save();
        await light_points.updateOne({ _id: puntoLuce._id }, { $set: { operazioni_effettuate: puntoLuce.operazioni_effettuate, segnalazioni_in_corso: puntoLuce.segnalazioni_in_corso, segnalazioni_risolte: puntoLuce.segnalazioni_risolte } });
        await townHalls.updateOne({ name: {$eq: req.body.name} }, { $set: { punti_luce: th.punti_luce } });
        
        res.send('Operazione aggiunta con successo');
    } catch (error) {
        console.error(error);
        res.status(500).send('Errore del server');
    }
});

module.exports = router; 