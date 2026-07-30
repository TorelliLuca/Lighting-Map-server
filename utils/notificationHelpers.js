const Notification = require('../schemas/notifications');
const users = require('../schemas/users');
const townHalls = require('../schemas/townHalls');
const { STAFF_ROLES } = require('./pushHelpers');

/**
 * Normalizza un valore in array di email uniche (stringhe non vuote).
 */
function normalizeEmails(emails) {
  const list = Array.isArray(emails) ? emails : [emails];
  return [...new Set(list.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim()))];
}

/**
 * Staff di un comune (stesso filtro delle email di segnalazione/operazione).
 */
async function findStaffUsersForTownHall(townHallName) {
  const th = await townHalls.findOne({ name: { $eq: townHallName } }).select('_id');
  if (!th) return [];
  return users
    .find({
      town_halls_list: th._id,
      user_type: { $in: STAFF_ROLES },
    })
    .select('_id email');
}

/**
 * Crea una singola notifica in-app.
 * @example
 * await createNotification({
 *   userId,
 *   title: 'Segnalazione aperta',
 *   body: 'Punto luce 12 — Comune X',
 *   type: 'REPORT_CREATED',
 *   url: '/dashboard',
 * });
 */
async function createNotification({ userId, title, body, type = 'GENERIC', url = null, meta = null }) {
  if (!userId || !title || !body) {
    throw new Error('userId, title e body sono obbligatori');
  }
  return Notification.create({ userId, title, body, type, url, meta });
}

/**
 * Crea la stessa notifica per più utenti (insertMany).
 * @example
 * await createNotifications(userIds, { title, body, type: 'REPORT_CREATED' });
 */
async function createNotifications(userIds, { title, body, type = 'GENERIC', url = null, meta = null } = {}) {
  if (!title || !body) {
    throw new Error('title e body sono obbligatori');
  }
  const ids = [...new Set((userIds || []).filter(Boolean).map((id) => String(id)))];
  if (ids.length === 0) return [];

  const docs = ids.map((userId) => ({
    userId,
    title,
    body,
    type,
    url,
    meta,
  }));
  return Notification.insertMany(docs, { ordered: false });
}

/**
 * Risolve email → userId e crea le notifiche.
 * @example
 * await createNotificationsForEmails('admin@x.it', { title, body, type: 'UPLOAD_SUCCESS' });
 * await createNotificationsForEmails(['a@x.it', 'b@x.it'], { title, body });
 */
async function createNotificationsForEmails(emails, payload) {
  const normalized = normalizeEmails(emails);
  if (normalized.length === 0) return [];

  const found = await users.find({ email: { $in: normalized } }).select('_id');
  return createNotifications(
    found.map((u) => u._id),
    payload
  );
}

/**
 * Notifica lo staff (admin / super admin / manutentore) di un comune.
 * Stesso targeting delle email di segnalazione/operazione.
 * @example
 * await notifyTownHallStaff('Roma', {
 *   title: 'Nuova segnalazione',
 *   body: 'Palo 42 guasto',
 *   type: 'REPORT_CREATED',
 *   url: '/dashboard',
 *   meta: { townHallName: 'Roma', numeroPalo: '42' },
 * });
 */
async function notifyTownHallStaff(townHallName, payload) {
  if (!townHallName) return [];
  const staff = await findStaffUsersForTownHall(townHallName);
  return createNotifications(
    staff.map((u) => u._id),
    payload
  );
}

/**
 * Variante "fire-and-forget": logga errori senza propagarli.
 * Utile accanto a sendMail per non far fallire l'invio email.
 */
async function safeNotify(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('[notifications]', err.message || err);
    return null;
  }
}

module.exports = {
  createNotification,
  createNotifications,
  createNotificationsForEmails,
  notifyTownHallStaff,
  findStaffUsersForTownHall,
  safeNotify,
  normalizeEmails,
};
