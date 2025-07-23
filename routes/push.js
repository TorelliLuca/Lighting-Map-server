const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Subscription = require('../schemas/subscription');
const webpush = require('web-push');

// Endpoint per elencare tutte le subscription attive
router.get('/subscriptions', async (req, res) => {
    try {
        const subs = await Subscription.find({ isActive: true });
        res.json(subs);
    } catch (err) {
        res.status(500).send('Errore durante il recupero delle subscription');
    }
});

// Aggiungi una subscription (upsert sicuro)
router.post('/subscribe', async (req, res) => {

    try {
        const { endpoint, keys, userId, browser } = req.body;

        if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
            return res.status(400).send('Dati subscription mancanti o non validi');
        }

        // Upsert: aggiorna se esiste, crea se non esiste
        const sub = await Subscription.findOneAndUpdate(
            { endpoint },
            {
                $set: {
                    keys,
                    userId: userId || null,
                    browser: browser || null,
                    isActive: true,
                    updatedAt: new Date()
                },
            },
            { upsert: true, new: true }
        );


        res.status(201).json({ message: 'Subscription registrata', id: sub._id });
    } catch (err) {
        console.error("Error during subscription:", err);
        res.status(500).send('Errore durante la registrazione della subscription');
    }
});


// Endpoint per inviare una notifica di test a tutte le subscription attive
router.post('/send-test-push', async (req, res) => {
    const { title, body } = req.body;
    if (!title || !body) {
        return res.status(400).json({ error: 'title e body sono obbligatori' });
    }
    try {
        const subs = await Subscription.find({ isActive: true });
        const payload = JSON.stringify({ title, body });
        let success = 0, fail = 0;
        let failed = [];
        let successed = [];
        for (const sub of subs) {
            try {
                console.log(payload);
                const resp = await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: sub.keys
                }, payload);
                successed.push(resp);
                success++;
            } catch (err) {
                console.log(err);
                failed.push(sub.endpoint);
                fail++;
            }
        }
        res.json({ message: `Notifiche inviate: ${success}, fallite: ${fail}`, failed, successed });
    } catch (err) {
        res.status(500).json({ error: 'Errore durante l\'invio delle notifiche' });
    }
});


router.patch('/unsubscribe', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { endpoint } = req.body;
        if (!endpoint) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send('Endpoint mancante');
        }
        const sub = await Subscription.findOneAndUpdate(
            { endpoint },
            { $set: { isActive: false, updatedAt: new Date() } },
            { new: true, session }
        );
        await session.commitTransaction();
        session.endSession();
        if (!sub) return res.status(404).send('Subscription non trovata');
        res.json({ message: 'Subscription disattivata' });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).send('Errore durante la disattivazione');
    }
});

module.exports = router;