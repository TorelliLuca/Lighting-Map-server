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
      {
        $group: {
          _id: { year: "$_id.year", month: "$_id.month" },
          users: { $push: { _id: "$userInfo._id", name: "$userInfo.name", surname: "$userInfo.surname" } }
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

// 6. Heatmap delle azioni
router.get('/stats/action-heatmap', async (req, res) => {
  try {
    const result = await AccessLog.aggregate([
      {
        $group: {
          _id: {
            action: "$action",
            hour: { $hour: "$timestamp" }
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

module.exports = router; 