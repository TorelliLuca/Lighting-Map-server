const express = require('express');
const mongoose = require('mongoose');
const townHalls = require('../schemas/townHalls');
const light_points = require('../schemas/lightPoints');
const lightPoints = require('../schemas/lightPoints');
const users = require('../schemas/users');
const XLSX = require('xlsx');
const { transporter, emailLighting, debugMail } = require('../config/email');
const { returnHtmlEmailUploadSuccess, returnHtmlEmailUploadError } = require('../utils/emailHelpers');
const { toCsvItalianStyle, normalizeKeysToLowerCase, isEmptyLightPoint, compareNumeroPalo } = require('../utils/utility');

const router = express.Router();

function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}


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
                modello: element.MODELLO_ARMATURA,
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

router.delete('/:id', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const townHallId = req.params.id;
        const townHall = await townHalls.findById(townHallId).session(session);
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

// Funzione per generare l'HTML della mail di successo con riepilogo quantità
function returnHtmlEmailUpdateSuccessSummary(nomeComune, eliminati, modificati, aggiunti) {
    return `
        <h2>Aggiornamento punti luce per il comune di <b>${nomeComune}</b> completato con successo!</h2>
        <ul>
            <li><b>Eliminati</b>: ${eliminati.length}</li>
            <li><b>Modificati</b>: ${modificati.length}</li>
            <li><b>Aggiunti</b>: ${aggiunti.length}</li>
        </ul>
        <p>In allegato trovi il file Excel con il dettaglio completo.</p>
    `;
}

// Funzione di normalizzazione robusta per i dati dei punti luce
function normalizeLightPointData(lp) {
    // Porta tutte le chiavi a minuscolo
    const lowerCaseLp = {};
    Object.keys(lp).forEach(key => {
        lowerCaseLp[key.toLowerCase()] = lp[key];
    });

    // Mappa di conversione CSV → DB
    const csvToDbFieldMap = {
        'lampada_e_potenza': 'lampada_potenza',
        'modello_armatura': 'modello',
        // aggiungi qui altre conversioni se necessario
    };

    // Lista dei campi previsti dallo schema (tutti minuscoli)
    const allowedFields = [
        'marker', 'numero_palo', 'composizione_punto', 'indirizzo', 'lotto', 'quadro', 'proprieta',
        'tipo_apparecchio', 'modello', 'numero_apparecchi', 'lampada_potenza', 'tipo_sostegno',
        'tipo_linea', 'promiscuita', 'note', 'garanzia', 'lat', 'lng', 'pod', 'numero_contatore',
        'alimentazione', 'potenza_contratto', 'potenza', 'punti_luce', 'tipo',
        '_id', // per update
        'segnalazioni_in_corso', 'segnalazioni_risolte', 'operazioni_effettuate'
    ];

    const normalized = {};
    for (const key of allowedFields) {
        // Se il campo esiste già con il nome giusto
        if (lowerCaseLp.hasOwnProperty(key)) {
            normalized[key] = lowerCaseLp[key];
        }
        // Se il campo esiste con il nome del CSV, lo mappo
        else {
            // Cerco se c'è una chiave CSV che mappa su questo campo DB
            const csvKey = Object.keys(csvToDbFieldMap).find(csvField => csvToDbFieldMap[csvField] === key);
            if (csvKey && lowerCaseLp.hasOwnProperty(csvKey)) {
                normalized[key] = lowerCaseLp[csvKey];
            }
        }
    }
    return normalized;
}


router.post('/update/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    let responseStatus = 200;
    let responseMessage = 'Comune e punti luce aggiornati con successo';
    let mailSubject = 'Aggiornamento completato';
    let mailHtml = null;
    let isError = false;
    // Variabili per la mail dettagliata
    let eliminati = [];
    let modificati = [];
    let aggiunti = [];
    // Variabili per i dati completi da inserire nel file Excel
    let eliminatiFull = [];
    let modificatiFull = [];
    let aggiuntiFull = [];
    // Costante per batch size
    const BATCH_SIZE = 100;
    try {
        // 1. Recupera il comune
        let th = await townHalls.findOne({ name: req.body.name }).session(session);
        if (!th) {
            await session.abortTransaction();
            session.endSession();
            responseStatus = 404;
            responseMessage = 'Comune non trovato';
            mailSubject = 'Errore durante aggiornamento';
            mailHtml = returnHtmlEmailUploadError(req.body.name, responseMessage);
            res.status(responseStatus).send(responseMessage);
            // Invio email dopo la risposta
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
            return;
        }

        // 2. Recupera solo gli ID dei punti luce esistenti
        const existingIds = th.punti_luce.map(id => id.toString());
        // 3. Normalizza e valida i dati in ingresso
        let incomingPoints = req.body.light_points || [];
        incomingPoints = incomingPoints.map(normalizeLightPointData);
        // Filtra i punti luce vuoti (usando la funzione già esistente)
        incomingPoints = incomingPoints.filter(lp => {
            if (!lp._id && isEmptyLightPoint(lp)) {
                return false;
            }
            return true;
        });
        // 4. Calcola cosa eliminare
        const { toDelete } = diffLightPoints(existingIds, incomingPoints);
        eliminati = [...toDelete];
        // Recupera i dati completi dei punti luce eliminati prima di cancellarli (in batch)
        if (eliminati.length > 0) {
            for (let i = 0; i < eliminati.length; i += BATCH_SIZE) {
                const batchIds = eliminati.slice(i, i + BATCH_SIZE);
                const batchData = await lightPoints.find({ _id: { $in: batchIds } }).lean().session(session);
                eliminatiFull = eliminatiFull.concat(batchData);
            }
        }
        // 5. Calcola modificati e aggiunti
        modificati = incomingPoints.filter(lp => lp._id && existingIds.includes(lp._id.toString())).map(lp => lp._id);
        aggiunti = incomingPoints.filter(lp => !lp._id);

        // 6. Elimina in batch
        if (toDelete.length > 0) {
            for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
                const batchIds = toDelete.slice(i, i + BATCH_SIZE);
                await lightPoints.deleteMany({ _id: { $in: batchIds } }).session(session);
            }
        }
        // 7. Aggiorna/inserisci in batch
        const bulkOps = prepareBulkOps(incomingPoints);
        // Array per raccogliere i nuovi _id inseriti
        let insertedIds = [];
        if (bulkOps.length > 0) {
            for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
                const batchOps = bulkOps.slice(i, i + BATCH_SIZE);
                try {
                    const result = await lightPoints.bulkWrite(batchOps, { session });
                    // Estrai i nuovi _id dagli insertOne
                    if (result && result.insertedIds) {
                        Object.values(result.insertedIds).forEach(id => insertedIds.push(id));
                    }
                } catch (bulkErr) {
                    await session.abortTransaction();
                    session.endSession();
                    responseStatus = 500;
                    responseMessage = `Errore durante l'aggiornamento dei punti luce: ${bulkErr && bulkErr.message ? bulkErr.message : bulkErr.toString()}`;
                    mailSubject = 'Errore durante aggiornamento punti luce';
                    const erroreOggetto = batchOps[0] ? JSON.stringify(batchOps[0], null, 2) : '<i>Nessun oggetto disponibile</i>';
                    const errorMsg = `<b>Errore:</b> ${bulkErr && bulkErr.message ? bulkErr.message : bulkErr.toString()}`;
                    mailHtml = `
                        <h3>Errore durante l'aggiornamento dei punti luce</h3>
                        <p><b>Oggetto che ha causato l'errore:</b></p>
                        <pre>${erroreOggetto}</pre>
                        <p>${errorMsg}</p>
                    `;
                    res.status(responseStatus).send(responseMessage);
                    try {
                        const adminEmails = req.body.userEmail;
                        const mailOptions = {
                            from: `LIGHTING MAP<${emailLighting}>`,
                            to: adminEmails,
                            subject: mailSubject,
                            html: mailHtml
                        };
                        await transporter.sendMail(mailOptions);
                        debugMail(bulkErr);
                    } catch (e) {
                        debugMail('Errore nell\'invio email:', e);
                    }
                    return;
                }
            }
        }
        // 8. Recupera tutti gli _id aggiornati (inclusi quelli nuovi) in batch
        let updatedLightPoints = [];
        // Per i modificati
        if (modificati.length > 0) {
            for (let i = 0; i < modificati.length; i += BATCH_SIZE) {
                const batchIds = modificati.slice(i, i + BATCH_SIZE);
                const batchData = await lightPoints.find({ _id: { $in: batchIds } }).lean().session(session);
                modificatiFull = modificatiFull.concat(batchData);
                updatedLightPoints = updatedLightPoints.concat(batchData.map(lp => lp._id));
            }
        }
        // Per gli aggiunti: ora abbiamo gli _id direttamente
        if (insertedIds.length > 0) {
            for (let i = 0; i < insertedIds.length; i += BATCH_SIZE) {
                const batchIds = insertedIds.slice(i, i + BATCH_SIZE);
                const batchData = await lightPoints.find({ _id: { $in: batchIds } }).lean().session(session);
                aggiuntiFull = aggiuntiFull.concat(batchData);
                updatedLightPoints = updatedLightPoints.concat(batchData.map(lp => lp._id));
            }
        }
        // 9. Aggiorna la lista punti_luce del comune (solo ID unici)
        th.punti_luce = Array.from(new Set(updatedLightPoints));
        await th.save({ session });
        await session.commitTransaction();
        session.endSession();
        console.log("arrivato alla fine delle operazioni, tutto ok")
        // 10. Genera file Excel con 3 fogli

    } catch (err) {
        try {await session.abortTransaction();} catch (e) {}
        session.endSession();
        responseStatus = 500;
        responseMessage = 'Errore durante l\'aggiornamento';
        mailSubject = 'Errore durante aggiornamento';
        mailHtml = returnHtmlEmailUploadError(req.body.name, err?.message || '');
        isError = true;
        res.status(responseStatus).send(responseMessage + (err?.message ? (': ' + err.message) : ''));
        // Invio email dopo la risposta
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
            debugMail('Errore nell\'invio email:', e);
        }
    }
    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.utils.book_new();
        if (eliminatiFull.length > 0) {
            const wsEliminati = XLSX.utils.json_to_sheet(eliminatiFull);
            XLSX.utils.book_append_sheet(workbook, wsEliminati, 'Eliminati');
        }
        if (modificatiFull.length > 0) {
            const wsModificati = XLSX.utils.json_to_sheet(modificatiFull);
            XLSX.utils.book_append_sheet(workbook, wsModificati, 'Modificati');
        }
        if (aggiuntiFull.length > 0) {
            const wsAggiunti = XLSX.utils.json_to_sheet(aggiuntiFull);
            XLSX.utils.book_append_sheet(workbook, wsAggiunti, 'Aggiunti');
        }
        // Se nessun foglio è stato aggiunto, aggiungi un foglio vuoto di servizio
        if (workbook.SheetNames.length === 0) {
            const wsVuoto = XLSX.utils.aoa_to_sheet([['Nessuna modifica rilevata']]);
            XLSX.utils.book_append_sheet(workbook, wsVuoto, 'Nessuna Modifica');
        }
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        mailHtml = returnHtmlEmailUpdateSuccessSummary(req.body.name, eliminati, modificati, aggiunti);
        res.status(responseStatus).send(responseMessage);
        // Invio email dopo la risposta
        try {
            const adminEmails = req.body.userEmail;
            const mailOptions = {
                from: `LIGHTING MAP<${emailLighting}>`,
                to: adminEmails,
                subject: mailSubject,
                html: mailHtml,
                attachments: [
                    {
                        filename: `dettaglio_aggiornamento_${req.body.name}.xlsx`,
                        content: buffer
                    }
                ]
            };
            await transporter.sendMail(mailOptions);
        } catch (e) {
            debugMail('Errore nell\'invio email di notifica:', e);
        }
    }catch(e){
        console.log("errore nella generazione del file excel",e)
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
        const thList = await townHalls.find({}).sort({ name: 1 });

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
                populate: [
                    {
                        path: 'segnalazioni_in_corso',
                        model: 'reports',
                        populate: {
                            path: 'user_creator_id',
                            model: 'users',
                            select: 'name surname email'
                        }
                    },
                    {
                        path: 'segnalazioni_risolte',
                        model: 'reports',
                        populate: [{
                            path: 'user_creator_id',
                            model: 'users',
                            select: 'name surname email'
                        }, {
                            path: 'user_responsible_id',
                            model: 'users',
                            select: 'name surname email'
                        }]
                    },
                    {
                        path: 'operazioni_effettuate',
                        model: 'operations',
                        populate: [
                            {
                                path: 'operation_point_id',
                                model: 'lightPoints'
                            },
                            {
                                path: 'operation_responsible',
                                model: 'users',
                                select: 'name surname email'
                            },
                            {
                                path: 'report_to_solve',
                                model: 'reports'
                            }
                        ]
                    }
                ]
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

router.get('/lightpoints/getPointGeoJSON/', async (req, res) => {
    try {
        const { name, numero_palo } = req.query;

        if (!name || !numero_palo) {
            return res.status(400).send('Nome del comune e numero del palo sono richiesti.');
        }

        const townHall = await townHalls.findOne({ name: name }).populate({
            path: 'punti_luce',
            match: { numero_palo: numero_palo },
        });

        if (!townHall || !townHall.punti_luce || townHall.punti_luce.length === 0) {
            return res.status(404).send('Palo non trovato.');
        }

        const pl = townHall.punti_luce[0];
        if (!pl || typeof pl.lat !== 'number' || typeof pl.lng !== 'number') {
            return res.status(400).send('Coordinate non valide per il punto luce.');
        }

        // Costruisci il GeoJSON
        const geojson = {
            type: "Feature",
            city: townHall.name,
            geometry: {
                type: "Point",
                coordinates: [pl.lng, pl.lat]
            },
            properties: { ...pl.toObject ? pl.toObject() : pl }
        };
        // Rimuovi lat/lng da properties (già in geometry)
        delete geojson.properties.lat;
        delete geojson.properties.lng;

        res.json(geojson);
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.get('/:name/geojson', async (req, res) => {
    try {
        const th = await townHalls.findOne({ name: req.params.name })
            .populate({
                path: 'punti_luce',
                populate: [
                    { path: 'segnalazioni_in_corso', model: 'reports' },
                    { path: 'segnalazioni_risolte', model: 'reports' },
                    { path: 'operazioni_effettuate', model: 'operations',
                        populate: [
                            { path: 'operation_point_id', model: 'lightPoints' },
                            { path: 'operation_responsible', model: 'users', select: 'name surname email' },
                            { path: 'report_to_solve', model: 'reports' }
                        ]
                    }
                ]
            });

        if (!th || !th.punti_luce || th.punti_luce.length === 0) {
            return res.status(404).send('Comune o punti luce non trovati');
        }

        // Costruisci la FeatureCollection GeoJSON
        const features = th.punti_luce

            .map(pl => {
                const props = pl.toObject ? pl.toObject() : pl;
                const { lat, lng, ...rest } = props;
                return {
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [parseFloat(lng.replace(",", ".")), parseFloat(lat.replace(",", "."))]
                    },
                    properties: rest
                };
            });

        const geojson = {
            type: "FeatureCollection",
            city: th.name,
            features
        };

        res.json(geojson);
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

        // Ordina i punti luce per numero_palo (come stringa)
        const sortedPuntiLuce = [...jsonData.punti_luce].sort((a, b) => {
            const aVal = a.numero_palo !== undefined && a.numero_palo !== null ? String(a.numero_palo) : '';
            const bVal = b.numero_palo !== undefined && b.numero_palo !== null ? String(b.numero_palo) : '';
            return aVal.localeCompare(bVal, 'it', { numeric: false, sensitivity: 'base' });
        });

        // Appiattisci l'oggetto JSON
        const cleanedJson = sortedPuntiLuce
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
    // Ordina i punti luce per numero_palo (come stringa)
    const sortedPuntiLuce = [...jsonData.punti_luce].sort(compareNumeroPalo);
    // Appiattisci l'oggetto JSON come per l'XLSX
    const cleanedJson = sortedPuntiLuce
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

// Endpoint: /townHalls/lightPoints/viewport
// Metodo: POST
// Body: north, south, east, west, city, filter (opzionale), limit (es: 200)
router.post('/lightPoints/viewport', async (req, res) => {
    try {
        const north = req.body.north;
        const south = req.body.south;
        const east = req.body.east;
        const west = req.body.west;
        const city = req.body.city;
        const filter = req.body.filter || 'SELECT';
        const limit = parseInt(req.body.limit) || 200;

        if (!city || isNaN(north) || isNaN(south) || isNaN(east) || isNaN(west)) {
            return res.status(400).json({ error: 'Parametri mancanti o non validi' });
        }

        // Trova il comune
        const townHall = await townHalls.findOne({ name: city }).select('punti_luce');
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }

        // Conta tutti i marker del comune (per total_count)
        const total_count = await lightPoints.countDocuments({ _id: { $in: townHall.punti_luce } });

        // Costruisci la query base
        let query = {
            _id: { $in: townHall.punti_luce },
            lat: { $gte: south, $lte: north },
            lng: { $gte: west, $lte: east }
        };

        // Applica filtro custom
        if (filter === 'REPORTED') {
            query.segnalazioni_in_corso = { $exists: true, $not: { $size: 0 } };
        } else if (filter === 'MARKER') {
            query.marker = 'QE';
        } else if (filter === 'PROPRIETA') {
            query.proprieta = { $in: ['comunale', 'enelsole'] };
        }
        // SELECT = nessun filtro aggiuntivo

        // Recupera i marker (limite impostato), tutti i campi
        const markers = await lightPoints.find(query)
            .limit(limit);

        res.json({
            markers,
            total_count
        });
    } catch (error) {
        res.status(500).json({ error: 'Errore del server', details: error.message });
    }
});

// Endpoint: /townHalls/lightPoints/clusters
// Metodo: POST
// Body: north, south, east, west, zoom, city, filter (opzionale)
router.post('/lightPoints/clusters', async (req, res) => {
    try {
        const north = req.body.north;
        const south = req.body.south;
        const east = req.body.east;
        const west = req.body.west;
        const city = req.body.city;
        const filter = req.body.filter || 'SELECT';
        const zoom = parseInt(req.body.zoom);

        if (!city || north === undefined || south === undefined || east === undefined || west === undefined || isNaN(zoom)) {
            return res.status(400).json({ error: 'Parametri mancanti o non validi' });
        }

        // Trova il comune
        const townHall = await townHalls.findOne({ name: city }).select('punti_luce');
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }

        // Conta tutti i marker del comune (per total_count)
        const total_count = await lightPoints.countDocuments({ _id: { $in: townHall.punti_luce } });

        // Costruisci la query base
        let query = {
            _id: { $in: townHall.punti_luce },
            lat: { $gte: south, $lte: north },
            lng: { $gte: west, $lte: east }
        };

        // Applica filtro custom
        if (filter === 'REPORTED') {
            query.segnalazioni_in_corso = { $exists: true, $not: { $size: 0 } };
        } else if (filter === 'MARKER') {
            query.marker = 'QE';
        } else if (filter === 'PROPRIETA') { //!!DA METTERE A POSTO 
            query.proprieta = { $in: ['comunale', 'enelsole'] };
        }
        // SELECT = nessun filtro aggiuntivo

        // Recupera tutti i marker nella bounding box e filtri
        const markers = await lightPoints.find(query).select('lat lng');

        // Calcola la dimensione della cella in base allo zoom (logica Google Maps)
        // Più lo zoom è basso, più la cella è grande
        // Esempio: zoom 8 = celle grandi, zoom 16 = celle piccole
        // Possiamo usare una griglia 2^(zoom-8) x 2^(zoom-8) (min 1x1, max 32x32)
        let gridSize = Math.max(1, Math.pow(2, zoom - 8));
        if (zoom < 8) gridSize = 1;
        if (zoom > 16) gridSize = 32;

        const latStep = (north - south) / gridSize;
        const lngStep = (east - west) / gridSize;

        // Mappa per clusterizzare
        const clusterMap = new Map();

        markers.forEach(marker => {
            const lat = parseFloat(marker.lat);
            const lng = parseFloat(marker.lng);
            if (isNaN(lat) || isNaN(lng)) return;
            // Calcola la cella
            const latIdx = Math.floor((lat - south) / latStep);
            const lngIdx = Math.floor((lng - west) / lngStep);
            const key = `${latIdx}_${lngIdx}`;
            if (!clusterMap.has(key)) {
                clusterMap.set(key, []);
            }
            clusterMap.get(key).push({ lat, lng });
        });

        // Costruisci i cluster
        const clusters = [];
        for (const [key, points] of clusterMap.entries()) {
            const [latIdx, lngIdx] = key.split('_').map(Number);
            const count = points.length;
            const lat = points.reduce((sum, p) => sum + p.lat, 0) / count;
            const lng = points.reduce((sum, p) => sum + p.lng, 0) / count;
            const bounds = {
                north: south + latStep * (latIdx + 1),
                south: south + latStep * latIdx,
                east: west + lngStep * (lngIdx + 1),
                west: west + lngStep * lngIdx
            };
            clusters.push({ count, lat, lng, bounds });
        }

        res.json({
            clusters,
            total_count
        });
    } catch (error) {
        res.status(500).json({ error: 'Errore del server', details: error.message });
    }
});

// Endpoint: /townHalls/lightPoints/counts
// Restituisce: { "ComuneA": 1200, ... } solo per i comuni dell'utente se userId è fornito
router.get('/lightPoints/counts', async (req, res) => {
    try {
        const userId = req.query.userId;
        let thList;
        if (userId) {
            // Recupera l'utente e la sua lista di comuni
            const user = await users.findById(userId).select('town_halls_list');
            if (!user || !user.town_halls_list || user.town_halls_list.length === 0) {
                return res.json({});
            }
            thList = await townHalls.find({ _id: { $in: user.town_halls_list } }).select('name punti_luce');
        } else {
            // Nessun filtro utente, restituisci tutti i comuni
            thList = await townHalls.find({}).select('name punti_luce');
        }
        const result = {};
        thList.forEach(th => {
            result[th.name] = th.punti_luce ? th.punti_luce.length : 0;
        });
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

module.exports = router;