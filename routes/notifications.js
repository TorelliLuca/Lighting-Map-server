const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../schemas/notifications');

const router = express.Router();

function getUserId(req) {
  return req.user?.id || null;
}

// Elenco notifiche dell'utente autenticato
router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ error: 'Non autenticato' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const [items, unreadCount] = await Promise.all([
      Notification.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ userId, read: false }),
    ]);

    res.json({ items, unreadCount, limit, skip });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Errore durante il recupero delle notifiche' });
  }
});

// Solo conteggio non lette (per badge)
router.get('/unread-count', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ error: 'Non autenticato' });
    }

    const unreadCount = await Notification.countDocuments({ userId, read: false });
    res.json({ unreadCount });
  } catch (err) {
    console.error('Error counting unread notifications:', err);
    res.status(500).json({ error: 'Errore durante il conteggio delle notifiche' });
  }
});

// Segna tutte come lette
router.patch('/read-all', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ error: 'Non autenticato' });
    }

    const result = await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );

    res.json({ modifiedCount: result.modifiedCount || 0 });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ error: 'Errore durante l\'aggiornamento delle notifiche' });
  }
});

// Segna una notifica come letta
router.patch('/:id/read', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ error: 'Non autenticato' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID non valido' });
    }

    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { $set: { read: true } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'Notifica non trovata' });
    }

    res.json(updated);
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ error: 'Errore durante l\'aggiornamento della notifica' });
  }
});

module.exports = router;
