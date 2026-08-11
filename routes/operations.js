const express = require('express');
const townHalls = require('../schemas/townHalls');
const operations = require('../schemas/operations');
const light_points = require('../schemas/lightPoints');
const users = require('../schemas/users');
const mongoose = require('mongoose');
const { getAllPuntiLuce } = require('../utils/lightPointHelpers');
const accessLogger = require('../middleware/accessLogger');
const logAccess = require('../utils/accessLogger');
const reports = require('../schemas/reports');
const { transitionReportStatus } = require('../utils/reportHelpers');
const { requireRole } = require('../utils/roles');
const router = express.Router();    

router.post('/addOperation', requireRole('MAINTAINER', 'SUPER_ADMIN'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const th = await townHalls.findOne({ name: {$eq: req.body.name} }).session(session);

        if (!th) {
            await session.abortTransaction();
            session.endSession();
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
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('Punto luce non trovato');
        }

        const user = await users.findOne({email: {$eq:req.body.email}}).session(session);
        if (!user) {
            await session.abortTransaction();
            session.endSession();
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
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('segnalazione non trovata');
        }

        if (report?.maintenance_category === 'EXTRAORDINARY') {
            await report.populate({
                path: 'linked_quote_id',
                select: 'status protocolNumber type',
            });
            const linkedQuote = report.linked_quote_id;
            if (!linkedQuote || linkedQuote.status !== 'APPROVED') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    error: 'Il preventivo IMS deve essere approvato dal DEC prima di chiudere la straordinaria',
                });
            }
        }

        // Finché esiste una segnalazione ordinaria senza sopralluogo, niente operazioni sul punto
        const preInspection = new Set(['OPEN', 'CLASSIFICATION_PENDING']);
        const needsInspection = (puntoLuce.segnalazioni_in_corso || []).some((s) => {
            if (!s || s.is_solved) return false;
            if (s.maintenance_category === 'EXTRAORDINARY') return false;
            return preInspection.has(s.workflow_status || 'OPEN');
        });
        if (needsInspection) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                error: 'Completare prima il sopralluogo: l\'operazione non è consentita su punti con segnalazione non ispezionata',
            });
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
            operation_date: req.body.date,
            maintenance_type: req.body.maintenance_type
        });

        if (req.body.is_solved && report) {
            report.is_solved = true;
            report.user_responsible_id = user._id;
            // Chiusura workflow (es. ripresa dopo sospensione)
            transitionReportStatus(
                report,
                'RESOLVED',
                user._id,
                req.body.note || 'Guasto eliminato e impianto ripristinato'
            );
            await report.save({ session });
            puntoLuce.segnalazioni_in_corso.pull(report);
            puntoLuce.segnalazioni_risolte.push(report);
        }

        puntoLuce.operazioni_effettuate.push(nuovaOperazione);

        await nuovaOperazione.save({ session });
        await light_points.updateOne(
            { _id: puntoLuce._id },
            { $set: { operazioni_effettuate: puntoLuce.operazioni_effettuate, segnalazioni_in_corso: puntoLuce.segnalazioni_in_corso, segnalazioni_risolte: puntoLuce.segnalazioni_risolte } },
            { session }
        );
        await townHalls.updateOne(
            { name: {$eq: req.body.name} },
            { $set: { punti_luce: th.punti_luce } },
            { session }
        );
        
        // Log dettagliato
        await logAccess({
            user: req.user ? req.user._id : null,
            action: 'ADD_OPERATION',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Operazione creata con id: ${nuovaOperazione._id}`
        });

        await session.commitTransaction();
        session.endSession();
        res.json({
            message: 'Operazione aggiunta con successo',
            operationId: nuovaOperazione._id,
            report: report
                ? {
                    _id: report._id,
                    maintenance_category: report.maintenance_category,
                    linked_quote_id: report.linked_quote_id,
                    workflow_status: report.workflow_status,
                    is_solved: report.is_solved,
                }
                : null,
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        // Log errore
        await logAccess({
            user: req.user ? req.user._id : null,
            action: 'ADD_OPERATION',
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

router.get('/api/avg-time-report-operation/:comune', async (req, res) => {
    try {
        const comune = req.params.comune;
        if (!comune) return res.status(400).json({ error: 'Comune mancante' });

        // 1. Trova il comune
        const th = await townHalls.findOne({ name: { $eq: comune } });
        if (!th) return res.status(404).json({ error: 'Comune non trovato' });

        // 2. Trova tutti i punti luce del comune
        const ids = th.punti_luce;
        if (!ids || ids.length === 0) return res.status(404).json({ error: 'Nessun punto luce trovato per questo comune' });
        const puntiLuce = await getAllPuntiLuce(ids);

        let totalDiff = 0;
        let count = 0;

        for (const punto of puntiLuce) {
            if (!punto) continue;
            // Unisco segnalazioni in corso e risolte (se esistono)


            for (const segnalazione of punto.segnalazioni_risolte) {
                if (!segnalazione || !segnalazione._id) continue;
                // Trova l'operazione risolutiva più vicina (is_solved: true, report_to_solve = id segnalazione)
                const report = await reports.findOne({_id: segnalazione._id});
                const operazione = await operations.findOne({
                    report_to_solve: report._id,
                    is_solved: true,
                    operation_date: { $gte: report.report_date }
                }).sort({ operation_date: 1 });
                console.log(operazione);

                if (operazione) {
                    const diff = new Date(operazione.operation_date) - new Date(report.report_date);
                    totalDiff += diff;
                    count++;
                }
            }
        }

        if (count === 0) return res.json({ avgTimeMs: null, message: 'Nessuna operazione risolutiva trovata' });

        const avgTimeMs = totalDiff / count;
        res.json({ avgTimeMs, avgTimeHours: avgTimeMs / (1000 * 60 * 60), count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

module.exports = router;