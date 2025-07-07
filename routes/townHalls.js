const express = require('express');
const mongoose = require('mongoose');
const townHalls = require('../schemas/townHalls');
const light_points = require('../schemas/lightPoints');
const lightPoints = require('../schemas/lightPoints');
const users = require('../schemas/users');
const XLSX = require('xlsx');
const { transporter, emailLighting, debugMail } = require('../config/email');
const { returnHtmlEmailUploadSuccess, returnHtmlEmailUploadError } = require('../utils/emailHelpers');
const { toCsvItalianStyle } = require('../utils/utility');

const router = express.Router();


router.post('/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    let batchStatus = [];
    let responseStatus = 200;
    let responseMessage = 'Caricamento completato con successo!';
    let mailSubject = 'Caricamento completato';
    let mailHtml = null;
    let isError = false;
    try {
        const existingTownHall = await townHalls.findOne({ name: req.body.name }).session(session);
        if (existingTownHall) {
            await session.abortTransaction();
            session.endSession();
            responseStatus = 409;
            responseMessage = 'Comune già esistente.';
            res.status(responseStatus).send(responseMessage);
            return;
        }

        // Crea il comune senza punti luce
        const th = await townHalls.create([{
            name: req.body.name,
            region: req.body.region,
            province: req.body.province,
            coordinates: {
                lat: req.body.coordinates?.lat,
                lng: req.body.coordinates?.lng
            }
        }], { session });

        function chunkArray(array, size) {
            const result = [];
            for (let i = 0; i < array.length; i += size) {
                result.push(array.slice(i, i + size));
            }
            return result;
        }

        let puntiLuceIds = [];
        const BATCH_SIZE = 300;
        if (req.body.light_points && Array.isArray(req.body.light_points) && req.body.light_points.length > 0) {
            const lightPointsData = req.body.light_points.map(element => ({
                marker: element.MARKER,
                numero_palo: element.NUMERO_PALO,
                composizione_punto: element.COMPOSIZIONE_PUNTO,
                indirizzo: element.INDIRIZZO,
                lotto: element.LOTTO,
                quadro: element.QUADRO,
                proprieta: element.PROPRIETA,
                tipo_apparecchio: element.TIPO_APPARECCHIO,
                modello: element.MODELLO,
                numero_apparecchi: element.NUMERO_APPARECCHI,
                lampada_potenza: element.LAMPADA_E_POTENZA,
                tipo_sostegno: element.TIPO_SOSTEGNO,
                tipo_linea: element.TIPO_LINEA,
                promiscuita: element.PROMISCUITA,
                note: element.NOTE,
                garanzia: element.GARANZIA,
                lat: element.lat,
                lng: element.lng,
                pod: element.POD,
                numero_contatore: element.NUMERO_CONTATORE,
                alimentazione: element.ALIMENTAZIONE,
                potenza_contratto: element.POTENZA_CONTRATTO,
                potenza: element.POTENZA,
                punti_luce: element.PUNTI_LUCE,
                tipo: element.TIPO
            }));

            const batches = chunkArray(lightPointsData, BATCH_SIZE);
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                try {
                    const inserted = await light_points.insertMany(batch, { session });
                    puntiLuceIds.push(...inserted.map(lp => lp._id));
                    batchStatus.push({ batch: batchIndex + 1, status: 'ok' });
                } catch (batchErr) {
                    let markerErrore = null;
                    if (batch && batch.length > 0) {
                        markerErrore = batch[0].marker;
                    }
                    await session.abortTransaction();
                    session.endSession();
                    responseStatus = 500;
                    responseMessage = `Errore durante il caricamento batch ${batchIndex + 1}`;
                    mailSubject = `Errore durante il caricamento batch ${batchIndex + 1}`;

                    // Serializza solo l’oggetto che ha causato l’errore (il primo del batch)
                    const erroreOggetto = batch && batch.length > 0 ? batch[0] : null;
                    const oggettoString = erroreOggetto ? `<pre>${JSON.stringify(erroreOggetto, null, 2)}</pre>` : '<i>Nessun oggetto disponibile</i>';
                    // Messaggio di errore dettagliato
                    const errorMsg = `<b>Errore:</b> ${batchErr && batchErr.message ? batchErr.message : batchErr.toString()}`;

                    // Crea un HTML dettagliato per la mail
                    mailHtml = `
                        <h3>Errore durante il caricamento del batch <b>${batchIndex + 1}</b> (marker: <b>${markerErrore}</b>)</h3>
                        <p><b>Oggetto che ha causato l'errore:</b></p>
                        ${oggettoString}
                        <p>${errorMsg}</p>
                    `;

                    isError = true;
                    res.status(responseStatus).send(responseMessage);
                    // Invia mail dopo la risposta
                    try {
                        const adminEmails = req.body.userEmail;
                        const mailOptions = {
                            from: `LIGHTING MAP<${emailLighting}>`,
                            to: adminEmails,
                            subject: mailSubject,
                            html: mailHtml
                        };
                        await transporter.sendMail(mailOptions);
                        debugMail(batchErr);
                    } catch (e) {
                        console.error('Errore nell\'invio email:', e);
                    }
                    return;
                }
            }
            th[0].punti_luce = puntiLuceIds;
            await th[0].save({ session });
        }

        await session.commitTransaction();
        session.endSession();
        mailHtml = returnHtmlEmailUploadSuccess(req.body.name, batchStatus);
        res.status(responseStatus).send(responseMessage);
        // Invia mail dopo la risposta
        try {
            const adminEmails = req.body.userEmail;
            const mailOptions = {
                from: `LIGHTING MAP<${emailLighting}>`,
                to: adminEmails,
                subject: mailSubject,
                html: mailHtml
            };
            await transporter.sendMail(mailOptions);
        } catch (e) {
            debugMail('Errore nell\'invio email di notifica:', e);
        }
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        responseStatus = 500;
        responseMessage = 'Errore durante il caricamento';
        mailSubject = 'Errore durante il caricamento';
        mailHtml = returnHtmlEmailUploadError(req.body.name, err?.message || '');
        isError = true;
        res.status(responseStatus).send(responseMessage);
        // Invia mail dopo la risposta
        try {
            const adminEmails = req.body.userEmail;
            const mailOptions = {
                from: `LIGHTING MAP<${emailLighting}>`,
                to: adminEmails,
                subject: mailSubject,
                html: mailHtml
            };
            await transporter.sendMail(mailOptions);
            debugMail(err);
        } catch (e) {
            console.error('Errore nell\'invio email:', e);
        }
    }
});

router.delete('/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const townHallName = req.body.name;
        const townHall = await townHalls.findOne({ name: {$eq: townHallName} }).session(session);
        if (!townHall) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('Comune non trovato nel database');
        }

        // Rimuovi tutti i punti luce associati al comune in un'unica query
        if (townHall.punti_luce && townHall.punti_luce.length > 0) {
            await lightPoints.deleteMany({ _id: { $in: townHall.punti_luce } }).session(session);
        }

        await users.updateMany(
            { town_halls_list: townHall._id },
            { $pull: { town_halls_list: townHall._id } }
        ).session(session);

        // Rimuovi il comune
        await townHalls.findByIdAndDelete(townHall._id).session(session);

        await session.commitTransaction();
        session.endSession();
        res.status(200).send('Comune e punti luce rimossi con successo');
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

// Funzione per calcolare cosa aggiornare, aggiungere, eliminare
function diffLightPoints(existingIds, incomingPoints) {
    const incomingIds = incomingPoints.map(lp => lp._id).filter(Boolean);
    const toDelete = existingIds.filter(id => !incomingIds.includes(id.toString()));
    return { toDelete, incomingIds };
}

// Funzione per preparare le operazioni bulk
function prepareBulkOps(incomingPoints) {
    return incomingPoints.map(lp => {
        const { _id, ...rest } = lp;
        if (_id) {
            return {
                updateOne: {
                    filter: { _id },
                    update: { $set: rest },
                    upsert: true
                }
            };
        } else {
            return {
                insertOne: { document: rest }
            };
        }
    });
}


router.post('/update/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // Recupera solo gli _id dei punti luce
        let th = await townHalls.findOne({ name: req.body.name }).session(session);
        if (!th) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('Comune non trovato');
        }

        const existingIds = th.punti_luce.map(id => id.toString());
        // Normalizza i dati se sono in formato tabulato
        let incomingPoints = req.body.light_points;


        // Calcola cosa eliminare
        const { toDelete } = diffLightPoints(existingIds, incomingPoints);

        // Elimina in bulk
        if (toDelete.length > 0) {
            await lightPoints.deleteMany({ _id: { $in: toDelete } }).session(session);
        }

        // Aggiorna/inserisci in bulk
        const bulkOps = prepareBulkOps(incomingPoints);
        if (bulkOps.length > 0) {
            await lightPoints.bulkWrite(bulkOps, { session });
        }

        // Recupera tutti gli _id aggiornati (inclusi quelli nuovi)
        const updatedLightPoints = await lightPoints.find({
            marker: { $in: incomingPoints.map(lp => lp.MARKER) }
        }).session(session);

        th.punti_luce = updatedLightPoints.map(lp => lp._id);
        await th.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.status(200).send('Comune e punti luce aggiornati con successo');
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.patch('/lightPoints/update/:_id', async (req, res) => {

    const _id = req.params._id; 
    const lpToUpdate = req.body; 

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

router.get('/', async (req, res) => {
    try {
        const thList = await townHalls.find({});
        
        const transformedList = thList.map(th => {
            const thObject = th.toObject(); // Converte il documento Mongoose in un oggetto JavaScript
            
            const puntiLuceLength = th.punti_luce ? th.punti_luce.length : 0;
            
            delete thObject.punti_luce;
            thObject.light_points = puntiLuceLength;
            
            return thObject;
        });
        
        res.json(transformedList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/:name', async (req, res) => {
    try {
        const th = await townHalls.findOne({ name: req.params.name })
            .populate({
                path: 'punti_luce',
                populate: [{
                    path: 'segnalazioni_in_corso',
                    model: 'reports'
                }, {
                    path: 'segnalazioni_risolte',
                    model: 'reports'
                }, {
                    path: 'operazioni_effettuate',
                    model: 'operations',
                    populate: [{ 
                        path: 'operation_point_id',
                        model: 'lightPoints' 
                    }, {
                        path: 'operation_responsible',
                        model: 'users' ,
                        select: 'name surname email'
                    },{
                        path: 'report_to_solve',
                        model: 'reports'
                    }
                
                ]
                }]
            });

        if (th) {
            res.json(th);
        } else {
            res.status(404).send('Comune non trovato');
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.get('/lightpoints/getActiveReports', async (req, res) => {
    try {
        const { name, numero_palo } = req.query;
        const townHall = await townHalls.findOne({ name })
            .populate({
                path: 'punti_luce',
                match: { numero_palo },
                populate: {
                    path: 'segnalazioni_in_corso',
                    model: 'reports'
                }
            });

        if (townHall && townHall.punti_luce.length > 0) {
            const segnalazioniInCorso = townHall.punti_luce[0].segnalazioni_in_corso;
            res.json(segnalazioniInCorso);
        } else {
            res.status(404).send('Comune o numero_palo non trovato');
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.get('/lightpoints/getPoint/', async (req, res) => {
    try {
        const { name, numero_palo } = req.query;

        if (!name || !numero_palo) {
            return res.status(400).send('Nome del comune e numero del palo sono richiesti.');
        }

        const townHall = await townHalls.findOne({ $eq: name }).populate({
            path: 'punti_luce',
            match: { numero_palo: numero_palo },
        });

        if (!townHall || !townHall.punti_luce || townHall.punti_luce.length === 0) {
            return res.status(404).send('Palo non trovato.');
        }

        const pl = townHall.punti_luce[0]

        res.json(pl);
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.post('/api/downloadExcelTownHall', function (req, res) {
    try {
        const jsonData = req.body;
        if (!Array.isArray(jsonData.punti_luce)) {
            return res.status(400).send('Dati non validi');
        }

        // Appiattisci l'oggetto JSON
        const cleanedJson = jsonData.punti_luce
            .map(lp => ({ ...lp, name: jsonData.name }))
            .map(({ segnalazioni_in_corso, segnalazioni_risolte, operazioni_effettuate, name, __v, ...item }) => item)
            .map(item => Object.fromEntries(Object.entries(item).map(([key, value]) => key === '_id' ? [key, value] : [key.toUpperCase(), value])));

        const workbook = XLSX.utils.book_new();
        const townHallWS = XLSX.utils.json_to_sheet(cleanedJson);
        XLSX.utils.book_append_sheet(workbook, townHallWS, jsonData.name);
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.set({
            'Content-Disposition': 'attachment; filename="output.xlsx"',
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control': 'no-store'
        });
        res.send(buffer);
    } catch (err) {
        res.status(500).send('Errore nella generazione del file Excel');
    }
});



router.post('/api/downloadCsvTownHall', function (req, res) {
    const jsonData = req.body;
    // Appiattisci l'oggetto JSON come per l'XLSX
    const cleanedJson = jsonData.punti_luce
        .map(lp => ({ ...lp, name: jsonData.name }))
        .map(({ segnalazioni_in_corso, segnalazioni_risolte, operazioni_effettuate, name, __v, ...item }) => item)
        .map(item => Object.fromEntries(Object.entries(item).map(([key, value]) => key === '_id' ? [key, value] : [key.toUpperCase(), value])));

    try {
        const csv = '\uFEFF' + toCsvItalianStyle(cleanedJson);

        res.set({
            'Content-Disposition': 'attachment; filename="output.csv"',
            'Content-Type': 'text/csv; charset=utf-8',
        });
        res.send(csv);
    } catch (err) {
        res.status(500).send('Errore nella generazione del CSV');
    }
});

module.exports = router; 