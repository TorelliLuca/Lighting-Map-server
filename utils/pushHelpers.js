const webpush = require('web-push');
const Subscription = require('../schemas/subscription');
const users = require('../schemas/users');
const townHalls = require('../schemas/townHalls');

const STAFF_ROLES = ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'];
const GONE_STATUS = new Set([404, 410]);

/**
 * Invia una push a una subscription e disattiva quelle scadute (410/404).
 */
async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    );
    return { ok: true, endpoint: sub.endpoint };
  } catch (err) {
    const statusCode = err.statusCode || err.status;
    if (GONE_STATUS.has(statusCode)) {
      await Subscription.updateOne(
        { _id: sub._id },
        { $set: { isActive: false, updatedAt: new Date() } }
      );
    }
    return {
      ok: false,
      endpoint: sub.endpoint,
      statusCode,
      message: err.body || err.message,
    };
  }
}

async function sendToSubscriptions(subs, payload) {
  const results = { success: 0, fail: 0, failed: [], successed: [] };
  for (const sub of subs) {
    const result = await sendToSubscription(sub, payload);
    if (result.ok) {
      results.success += 1;
      results.successed.push(result.endpoint);
    } else {
      results.fail += 1;
      results.failed.push(result);
    }
  }
  return results;
}

async function findStaffUserIdsForTownHall(townHallName) {
  const th = await townHalls.findOne({ name: { $eq: townHallName } }).select('_id');
  if (!th) return [];

  const staff = await users.find({
    town_halls_list: th._id,
    user_type: { $in: STAFF_ROLES },
    is_approved: true,
  }).select('_id');

  return staff.map((u) => u._id);
}

async function getActiveSubscriptionsForUserIds(userIds) {
  if (!userIds?.length) return [];
  return Subscription.find({
    userId: { $in: userIds },
    isActive: true,
  });
}

module.exports = {
  STAFF_ROLES,
  sendToSubscription,
  sendToSubscriptions,
  findStaffUserIdsForTownHall,
  getActiveSubscriptionsForUserIds,
};
