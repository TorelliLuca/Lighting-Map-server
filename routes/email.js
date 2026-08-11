const express = require('express');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const { createNotifications, createNotificationsForEmails, safeNotify } = require('../utils/notificationHelpers');
const { sendConfiguredEmail } = require('../utils/mailEngine');

const router = express.Router();

router.post('/send-email-to-user/isApproved', async (req, res) => {
    try {
        const to = req.body.to;
        const name = req.body.user?.name || '';
        await sendConfiguredEmail('ACCOUNT_APPROVED', {
            recipientEmails: Array.isArray(to) ? to : [to],
            vars: {
                nome: name,
                cognome: req.body.user?.surname || '',
                email: Array.isArray(to) ? to[0] : to,
            },
        });
        await safeNotify(() =>
            createNotificationsForEmails(to, {
                title: 'Account abilitato',
                body: 'La tua autenticazione su Lighting-map è stata abilitata.',
                type: 'ACCOUNT_APPROVED',
                url: '/dashboard',
            })
        );
        res.status(200).send('Email inviata con successo');
    } catch (error) {
        console.error(error);
        res.status(400).send('Errore durante l\'invio della mail');
    }
});

router.post('/send-email-to-user/lightPointReported', async (req, res) => {
    const th = await townHalls.findOne({ name: { $eq: req.body.name } });
    if (!th) return res.status(404).send('Comune non trovato, impossibile inviare la mail');

    const destination = await users.find({
        town_halls_list: th._id,
        user_type: { $in: ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'] },
    }).select('_id email');
    const destinationIds = destination.map((u) => u._id);

    const numeroPalo = req.body.light_point?.numero_palo || '';
    const user = req.body.user || {};
    const report = req.body.report || {};
    const dateLabel = req.body.date
        ? new Date(req.body.date).toLocaleDateString('it-IT')
        : new Date().toLocaleDateString('it-IT');

    await sendConfiguredEmail('REPORT_CREATED', {
        townHallId: th._id,
        townHallName: req.body.name,
        fromName: 'LIGHTING MAP - Segnalazione guasti',
        vars: {
            nome: user.name || '',
            cognome: user.surname || '',
            email: user.email || '',
            data: dateLabel,
            nome_comune: req.body.name,
            numero_palo: numeroPalo,
            indirizzo: req.body.light_point?.indirizzo || '',
            corpo_segnalazione: report.report_type || '',
            nota: report.description || '',
        },
    });

    await safeNotify(() =>
        createNotifications(destinationIds, {
            title: `Segnalazione su punto ${numeroPalo}`,
            body: `${report.report_type || 'Guasto'} — ${req.body.name}${report.description ? `: ${report.description}` : ''}`,
            type: 'REPORT_CREATED',
            url: '/dashboard',
            meta: {
                townHallName: req.body.name,
                numeroPalo,
                reportType: report.report_type,
            },
        })
    );

    res.status(200).send('Emails sent');
});

router.post('/send-email-to-user/reportSolved', async (req, res) => {
    const th = await townHalls.findOne({ name: { $eq: req.body.name } });
    if (!th) return res.status(404).send('Comune non trovato, impossibile inviare la mail');

    const destination = await users.find({
        town_halls_list: th._id,
        user_type: { $in: ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'] },
    }).select('_id email');
    const destinationIds = destination.map((u) => u._id);

    const numeroPalo = req.body.light_point?.numero_palo || '';
    const user = req.body.user || {};
    const operation = req.body.operation || {};
    const dateLabel = req.body.date
        ? new Date(req.body.date).toLocaleDateString('it-IT')
        : new Date().toLocaleDateString('it-IT');

    await sendConfiguredEmail('REPORT_SOLVED', {
        townHallId: th._id,
        townHallName: req.body.name,
        fromName: 'LIGHTING MAP - Segnalazione guasti',
        vars: {
            nome: user.name || '',
            cognome: user.surname || '',
            email: user.email || '',
            data: dateLabel,
            nome_comune: req.body.name,
            numero_palo: numeroPalo,
            indirizzo: req.body.light_point?.indirizzo || '',
            tipo_operazione: operation.operation_type || '',
            nota: operation.description || '',
        },
    });

    await safeNotify(() =>
        createNotifications(destinationIds, {
            title: `Operazione su punto ${numeroPalo}`,
            body: `${operation.operation_type || 'Intervento'} — ${req.body.name}${operation.description ? `: ${operation.description}` : ''}`,
            type: 'REPORT_SOLVED',
            url: '/dashboard',
            meta: {
                townHallName: req.body.name,
                numeroPalo,
                operationType: operation.operation_type,
            },
        })
    );

    res.status(200).send('Emails sent');
});

module.exports = router;
