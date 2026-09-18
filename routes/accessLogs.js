const express = require('express');
const AccessLog = require('../schemas/accessLog');
const router = express.Router();
const mongoose = require('mongoose');
const usersModel = require('../schemas/users');
const townHallsModel = require('../schemas/townHalls');
const lightPointsModel = require('../schemas/lightPoints');

function normalizeDateRange(startDateRaw, endDateRaw) {
  if (!startDateRaw && !endDateRaw) {
    return null;
  }

  const range = {};

  if (startDateRaw) {
    const startDate = new Date(startDateRaw);
    if (Number.isNaN(startDate.getTime())) {
      return { error: 'startDate non valida' };
    }
    startDate.setHours(0, 0, 0, 0);
    range.$gte = startDate;
  }

  if (endDateRaw) {
    const endDate = new Date(endDateRaw);
    if (Number.isNaN(endDate.getTime())) {
      return { error: 'endDate non valida' };
    }
    endDate.setHours(23, 59, 59, 999);
    range.$lte = endDate;
  }

  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    return { error: 'startDate deve essere precedente o uguale a endDate' };
  }

  return range;
}

function buildAccessLogMatch(baseMatch, startDateRaw, endDateRaw) {
  const dateRange = normalizeDateRange(startDateRaw, endDateRaw);
  if (dateRange?.error) {
    return { error: dateRange.error };
  }

  const match = { ...baseMatch };
  if (dateRange) {
    match.timestamp = dateRange;
  }

  return { match };
}

// 1. Utenti unici per mese
router.get('/stats/monthly-users', async (req, res) => {
  try {
    const { match, error } = buildAccessLogMatch(
      { action: "LOGIN", outcome: "SUCCESS", user: { $ne: null } },
      req.query.startDate,
      req.query.endDate
    );

    if (error) {
      return res.status(400).json({ error });
    }

    const result = await AccessLog.aggregate([
  { $match: match },
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
    const { match, error } = buildAccessLogMatch({}, req.query.startDate, req.query.endDate);
    if (error) {
      return res.status(400).json({ error });
    }

    const result = await AccessLog.aggregate([
      { $match: match },
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
    const { match, error } = buildAccessLogMatch(
      { user: { $ne: null } },
      req.query.startDate,
      req.query.endDate
    );
    if (error) {
      return res.status(400).json({ error });
    }

    const result = await AccessLog.aggregate([
      { $match: match },
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
          _id: "$userInfo._id",
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
    const { match, error } = buildAccessLogMatch(
      { action: "LOGIN", outcome: "SUCCESS", user: { $ne: null } },
      req.query.startDate,
      req.query.endDate
    );
    if (error) {
      return res.status(400).json({ error });
    }

    const result = await AccessLog.aggregate([
      { $match: match },
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
    const { match, error } = buildAccessLogMatch(
      { outcome: "FAILURE" },
      req.query.startDate,
      req.query.endDate
    );
    if (error) {
      return res.status(400).json({ error });
    }

    const result = await AccessLog.aggregate([
      { $match: match },
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
    const { match, error } = buildAccessLogMatch(
      { outcome: "FAILURE", action: req.params.action },
      req.query.startDate,
      req.query.endDate
    );
    if (error) {
      return res.status(400).json({ error });
    }

    const result = await AccessLog.aggregate([
      { $match: match },
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
    const { match, error } = buildAccessLogMatch({}, req.query.startDate, req.query.endDate);
    if (error) {
      return res.status(400).json({ error });
    }

    const result = await AccessLog.aggregate([
      {
        $match: match
      },
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
    const dateRange = normalizeDateRange(req.query.startDate, req.query.endDate);
    if (dateRange?.error) {
      return res.status(400).json({ error: dateRange.error });
    }

    const filter = dateRange ? { date: dateRange } : { date: { $gte: getFirstDayOfCurrentMonth() } };
    const count = await usersModel.countDocuments(filter);
    res.json({ newUsersThisMonth: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Percentage of new users compared to previous month
router.get('/newUsersPercentageChange', async (req, res) => {
  try {
    const dateRange = normalizeDateRange(req.query.startDate, req.query.endDate);
    if (dateRange?.error) {
      return res.status(400).json({ error: dateRange.error });
    }

    if (dateRange) {
      const currentCount = await usersModel.countDocuments({ date: dateRange });
      return res.json({ percentageChange: currentCount });
    }

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
    const dateRange = normalizeDateRange(req.query.startDate, req.query.endDate);
    if (dateRange?.error) {
      return res.status(400).json({ error: dateRange.error });
    }

    const filter = dateRange ? { created_at: dateRange } : { created_at: { $gte: getFirstDayOfCurrentMonth() } };
    const towns = await townHallsModel.countDocuments(filter);
    res.json(towns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. New light points this month - list
router.get('/newLightPointsThisMonth', async (req, res) => {
  try {
    const dateRange = normalizeDateRange(req.query.startDate, req.query.endDate);
    if (dateRange?.error) {
      return res.status(400).json({ error: dateRange.error });
    }

    const filter = dateRange ? { data_creazione: dateRange } : { data_creazione: { $gte: getFirstDayOfCurrentMonth() } };
    const lightPoints = await lightPointsModel.countDocuments(filter);
    res.json(lightPoints);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/access-this-month', async (req, res) => {
  try {
    const { ids, startDate, endDate } = req.body; // Array di id come stringhe
    const dateRange = normalizeDateRange(startDate, endDate);
    if (dateRange?.error) {
      return res.status(400).json({ error: dateRange.error });
    }

    // Cast degli id a ObjectId
    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));

    const timestampFilter = dateRange || { $gte: getFirstDayOfCurrentMonth() };

    const result = await AccessLog.aggregate([
      { 
        $match: { 
          timestamp: timestampFilter,
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
    const { userIds, startDate, endDate } = req.body;

    // 1. Validazione dell'input
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'Il corpo della richiesta deve contenere un array non vuoto di userIds.' });
    }

    // 2. Converte le stringhe in ObjectId di Mongoose
    const validUserIds = userIds.map(id => new mongoose.Types.ObjectId(id));

    // 3. Pipeline di aggregazione di MongoDB
    const dateRange = normalizeDateRange(startDate, endDate);
    if (dateRange?.error) {
      return res.status(400).json({ error: dateRange.error });
    }

    const loginMatch = {
      user: { $in: validUserIds },
      action: 'LOGIN'
    };
    if (dateRange) {
      loginMatch.timestamp = dateRange;
    }

    const latestLogins = await AccessLog.aggregate([
      // Fase 1: Filtra i documenti in base agli ID utente e al tipo di azione 'LOGIN'
      {
        $match: loginMatch
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
