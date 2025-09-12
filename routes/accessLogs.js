const express = require('express');
const AccessLog = require('../schemas/accessLog');
const router = express.Router();
const mongoose = require('mongoose');

// 1. Utenti unici per mese
router.get('/stats/monthly-users', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
  { $match: { action: "LOGIN", outcome: "SUCCESS", user: { $ne: null } } },
  {
    $group: {
      _id: {
        year: { $year: "$timestamp" },
        month: { $month: "$timestamp" }
      },
      users: { $addToSet: "$user" }
    }
  },
  { $unwind: "$users" },
  {
    $lookup: {
      from: "users",
      localField: "users",
      foreignField: "_id",
      as: "userInfo"
    }
  },
  { $unwind: "$userInfo" },

  { $sort: { "userInfo.name": 1, "userInfo.surname": 1 } },

  {
    $group: {
      _id: { year: "$_id.year", month: "$_id.month" },
      users: {
        $push: {
          _id: "$userInfo._id",
          name: "$userInfo.name",
          surname: "$userInfo.surname"
        }
      }
    }
  },
  {
    $project: {
      year: "$_id.year",
      month: "$_id.month",
      users: 1,
      userCount: { $size: "$users" },
      _id: 0
    }
  },
  { $sort: { year: 1, month: 1 } }
]);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Azioni più frequenti
router.get('/stats/top-actions', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Utente più attivo
router.get('/stats/top-user', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
      { $match: { user: { $ne: null } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          _id: 0,
          name: "$userInfo.name",
          surname: "$userInfo.surname",
          count: 1
        }
      }
    ]);
    res.json(result[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Trend annuale degli accessi
router.get('/stats/yearly-trend', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
      { $match: { action: "LOGIN", outcome: "SUCCESS", user: { $ne: null } } },
      {
        $group: {
          _id: { year: { $year: "$timestamp" }, month: { $month: "$timestamp" } },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          year: "$_id.year",
          month: "$_id.month",
          count: 1,
          _id: 0
        }
      },
      { $sort: { year: 1, month: 1 } }
    ]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Richieste fallite
router.get('/stats/failed-requests', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
      { $match: { outcome: "FAILURE" } },
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/stats/failed-requests-details/:action', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
      { $match: { outcome: "FAILURE", action: req.params.action } },
       {
        $lookup: {
          from: 'users', 
          localField: 'user', 
          foreignField: '_id',
          as: 'userDetails' 
        }
      },
      {
        $unwind: {
            path: "$userDetails",
            preserveNullAndEmptyArrays: true 
        }
      },
      { $sort: { timestamp: 1 } }
    ]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Heatmap delle azioni
router.get('/stats/action-heatmap', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
      {
        $group: {
          _id: {
            action: "$action",
            hour: { 
              $hour: { 
                date: "$timestamp", 
                timezone: "Europe/Rome" 
              } 
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          action: "$_id.action",
          hour: "$_id.hour",
          count: 1,
          _id: 0
        }
      },
      { $sort: { action: 1, hour: 1 } }
    ]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



function getFirstDayOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Helper function to get first day of previous month
function getFirstDayOfPreviousMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

// Helper function to get last day of previous month
function getLastDayOfPreviousMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
}

// 7. New users this month - count
router.get('/newUsersThisMonth', async (req, res) => {
  try {
    const firstDay = getFirstDayOfCurrentMonth();
    const count = await require('../schemas/users').countDocuments({ date: { $gte: firstDay } });
    res.json({ newUsersThisMonth: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Percentage of new users compared to previous month
router.get('/newUsersPercentageChange', async (req, res) => {
  try {
    const usersModel = require('../schemas/users');
    const firstDayCurrent = getFirstDayOfCurrentMonth();
    const firstDayPrev = getFirstDayOfPreviousMonth();
    const lastDayPrev = getLastDayOfPreviousMonth();

    const currentCount = await usersModel.countDocuments({ date: { $gte: firstDayCurrent } });
    const prevCount = await usersModel.countDocuments({ date: { $gte: firstDayPrev, $lte: lastDayPrev } });

    let percentageChange = null;
    if (prevCount === 0) {
      percentageChange = currentCount === 0 ? 0 : 100;
    } else {
      percentageChange = ((currentCount - prevCount) / prevCount) * 100;
    }

    res.json({ percentageChange });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. New towns this month - list
router.get('/newTownsThisMonth', async (req, res) => {
  try {
    const firstDay = getFirstDayOfCurrentMonth();
    const towns = await require('../schemas/townHalls').countDocuments({ created_at: { $gte: firstDay } });
    res.json(towns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. New light points this month - list
router.get('/newLightPointsThisMonth', async (req, res) => {
  try {
    const firstDay = getFirstDayOfCurrentMonth();
    const lightPoints = await require('../schemas/lightPoints').countDocuments({ data_creazione: { $gte: firstDay } });
    res.json(lightPoints);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/access-this-month', async (req, res) => {
  try {
    const { ids } = req.body; // Array di id come stringhe
    const firstDay = getFirstDayOfCurrentMonth();

    // Cast degli id a ObjectId
    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));

    const result = await AccessLog.aggregate([
      { 
        $match: { 
          timestamp: { $gte: firstDay }, 
          user: { $in: objectIds },
          outcome: "SUCCESS"
        } 
      },
      {
        $group: {
          _id: "$user",
          count: { $sum: 1 }
        }
      }
    ]);

    // Mappa gli id che non hanno accessi a 0
    const counts = ids.reduce((acc, id) => {
      const found = result.find(r => String(r._id) === id);
      acc[id] = found ? found.count : 0;
      return acc;
    }, {});

    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/last-login', async (req, res)=> {
  try {
    const { userIds } = req.body;

    // 1. Validazione dell'input
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'Il corpo della richiesta deve contenere un array non vuoto di userIds.' });
    }

    // 2. Converte le stringhe in ObjectId di Mongoose
    const validUserIds = userIds.map(id => new mongoose.Types.ObjectId(id));

    // 3. Pipeline di aggregazione di MongoDB
    const latestLogins = await AccessLog.aggregate([
      // Fase 1: Filtra i documenti in base agli ID utente e al tipo di azione 'LOGIN'
      {
        $match: {
          user: { $in: validUserIds },
          action: 'LOGIN'
        }
      },
      // Fase 2: Raggruppa i documenti per ID utente
      {
        $group: {
          _id: '$user',
          latestLogin: { $max: '$timestamp' } // Trova il timestamp più recente
        }
      },
      // Fase 3 (opzionale): Proietta i campi desiderati per la risposta finale
      {
        $project: {
          _id: 0, // Escludi l'ID interno dell'aggregazione
          userId: '$_id',
          latestLogin: '$latestLogin'
        }
      }
    ]);

    // 4. Invia la risposta
    res.status(200).json(latestLogins);

  } catch (error) {
    // Gestione degli errori
    console.error('Errore durante l\'aggregazione per l\'ultimo login:', error);
    res.status(500).json({ error: 'Errore interno del server.' });
  }
});

module.exports = router;
