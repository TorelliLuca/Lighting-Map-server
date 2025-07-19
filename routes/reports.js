const express = require('express');
const XLSX = require('xlsx');
const townHalls = require('../schemas/townHalls');
const reports = require('../schemas/reports');
const light_points = require('../schemas/lightPoints');
const { getAllPuntiLuce } = require('../utils/lightPointHelpers');
const accessLogger = require('../middleware/accessLogger');
const logAccess = require('../utils/accessLogger');
const router = express.Router();

router.post('/addReport', async (req, res) => {

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

        const nuovaSegnalazione = new reports({
            report_type: req.body.report_type,
            description: req.body.description,
            report_date: req.body.date 
        });

        puntoLuce.segnalazioni_in_corso.push(nuovaSegnalazione);


        await nuovaSegnalazione.save();

        await light_points.updateOne({_id: puntoLuce.id}, {$set: {segnalazioni_in_corso: puntoLuce.segnalazioni_in_corso}});
        await townHalls.updateOne({ name: {$eq: req.body.name} }, { $set: { punti_luce: th.punti_luce } });

        // Log dettagliato
        await logAccess({
            user: req.user ? req.user._id : null,
            action: 'ADD_REPORT',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Report creato con id: ${nuovaSegnalazione._id}`
        });



        res.send('Segnalazione aggiunta con successo');

    } catch (error) {
        // Log errore
        await logAccess({
            user: req.user ? req.user._id : null,
            action: 'ADD_REPORT',
            resource: req.originalUrl,
            outcome: 'FAILURE',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Errore: ${error.message}`
        });
        console.error(error);
        res.status(500).send('Errore del server');
    }
});

router.post('/api/downloadExcelReport', function (req, res) {
    const jsonData = req.body;
    const workbook = XLSX.utils.book_new();

    const segnalazioniInCorsoWS = XLSX.utils.json_to_sheet(jsonData.segnalazioni_in_corso);
    XLSX.utils.book_append_sheet(workbook, segnalazioniInCorsoWS, 'Segnalazioni In Corso');

    const segnalazioniRisolteWS = XLSX.utils.json_to_sheet(jsonData.segnalazioni_risolte);
    XLSX.utils.book_append_sheet(workbook, segnalazioniRisolteWS, 'Segnalazioni Risolte');

    const operazioniEffettuateWS = XLSX.utils.json_to_sheet(jsonData.operazioni_effettuate);
    XLSX.utils.book_append_sheet(workbook, operazioniEffettuateWS, 'Operazioni Effettuate');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.set({
        'Content-Disposition': 'attachment; filename="output.xlsx"',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    res.send(buffer);
});

module.exports = router; 