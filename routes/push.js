const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Subscription = require('../schemas/subscription');
const users = require('../schemas/users');
const {
  sendToSubscriptions,
  findStaffUserIdsForTownHall,
  getActiveSubscriptionsForUserIds,
} = require('../utils/pushHelpers');

async function getRequester(req) {
  if (!req.user?.id) return null;
  return users.findById(req.user.id).select('user_type email');
}

function isAdmin(user) {
  return user && ['SUPER_ADMIN', 'ADMINISTRATOR'].includes(user.user_type);
}

// Elenco subscription (solo admin)
router.get('/subscriptions', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!isAdmin(requester)) {
      return res.status(403).send('Permessi insufficienti');
    }
    const subs = await Subscription.find({ isActive: true }).select('-__v');
    res.json(subs);
  } catch (err) {
    console.error('Error fetching subscriptions:', err);
    res.status(500).send('Errore durante il recupero delle subscription');
  }
});

// Registra / aggiorna subscription del chiamante
router.post('/subscribe', async (req, res) => {
  try {
    const { endpoint, keys, browser } = req.body;
    const userId = req.user?.id || req.body.userId || null;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).send('Dati subscription mancanti o non validi');
    }

    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).send('userId non valido');
    }

    const sub = await Subscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          keys,
          userId: userId || null,
          browser: browser || null,
          isActive: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ message: 'Subscription registrata', id: sub._id });
  } catch (err) {
    console.error('Error during subscription:', err);
    res.status(500).send('Errore durante la registrazione della subscription');
  }
});

/**
 * Invio mirato (qualsiasi utente autenticato, come le email di segnalazione):
 * - userIds / townHallName: targeting
 * - senza filtri: solo SUPER_ADMIN (broadcast di test)
 */
router.post('/send', async (req, res) => {
  const { title, body, userIds, townHallName, url } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title e body sono obbligatori' });
  }

  try {
    const requester = await getRequester(req);
    if (!requester) {
      return res.status(403).json({ error: 'Permessi insufficienti' });
    }

    let targetUserIds = [];

    if (Array.isArray(userIds) && userIds.length > 0) {
      targetUserIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    } else if (townHallName) {
      targetUserIds = await findStaffUserIdsForTownHall(townHallName);
    } else if (requester.user_type === 'SUPER_ADMIN') {
      const allSubs = await Subscription.find({ isActive: true });
      const results = await sendToSubscriptions(allSubs, { title, body, url });
      return res.json({
        message: `Notifiche inviate: ${results.success}, fallite: ${results.fail}`,
        ...results,
      });
    } else {
      return res.status(400).json({
        error: 'Specificare userIds o townHallName',
      });
    }

    const subs = await getActiveSubscriptionsForUserIds(targetUserIds);
    const results = await sendToSubscriptions(subs, { title, body, url });

    res.json({
      message: `Notifiche inviate: ${results.success}, fallite: ${results.fail}`,
      targetedUsers: targetUserIds.length,
      subscriptions: subs.length,
      ...results,
    });
  } catch (err) {
    console.error('Error sending push:', err);
    res.status(500).json({ error: "Errore durante l'invio delle notifiche" });
  }
});

// Compatibilità con client legacy
router.post('/send-test-push', async (req, res) => {
  const { title, body, userId, userIds, townHallName, url } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title e body sono obbligatori' });
  }

  try {
    const requester = await getRequester(req);
    if (!requester) {
      return res.status(403).json({ error: 'Permessi insufficienti' });
    }

    let targetUserIds = [];
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      targetUserIds = [userId];
    } else if (Array.isArray(userIds) && userIds.length > 0) {
      targetUserIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    } else if (townHallName) {
      targetUserIds = await findStaffUserIdsForTownHall(townHallName);
    }

    let subs;
    if (targetUserIds.length > 0) {
      subs = await getActiveSubscriptionsForUserIds(targetUserIds);
    } else if (requester.user_type === 'SUPER_ADMIN') {
      subs = await Subscription.find({ isActive: true });
    } else {
      return res.status(400).json({ error: 'Specificare userId, userIds o townHallName' });
    }

    const results = await sendToSubscriptions(subs, { title, body, url });
    res.json({
      message: `Notifiche inviate: ${results.success}, fallite: ${results.fail}`,
      ...results,
    });
  } catch (err) {
    console.error('Error send-test-push:', err);
    res.status(500).json({ error: "Errore durante l'invio delle notifiche" });
  }
});

router.patch('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).send('Endpoint mancante');
    }

    const filter = { endpoint };
    const requester = await getRequester(req);
    if (!isAdmin(requester) && req.user?.id) {
      filter.userId = req.user.id;
    }

    const sub = await Subscription.findOneAndUpdate(
      filter,
      { $set: { isActive: false, updatedAt: new Date() } },
      { new: true }
    );

    if (!sub) return res.status(404).send('Subscription non trovata');
    res.json({ message: 'Subscription disattivata' });
  } catch (err) {
    console.error('Error unsubscribe:', err);
    res.status(500).send('Errore durante la disattivazione');
  }
});

module.exports = router;
