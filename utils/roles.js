const users = require('../schemas/users');
const townHalls = require('../schemas/townHalls');

const STAFF_ROLES = ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'];
const CONFIG_EDITOR_ROLES = ['ADMINISTRATOR', 'SUPER_ADMIN'];
const TOWN_HALL_ACCESS_DENIED_MESSAGE =
    'Non sei autorizzato a visualizzare le informazioni di questo comune';

async function loadRequestUser(req) {
    if (!req.user?.id) return null;
    return users.findById(req.user.id).select('user_type sub_role town_halls_list email name surname');
}

function isSuperAdmin(user) {
    return user?.user_type === 'SUPER_ADMIN';
}

function canAccessTownHall(user, townHallId) {
    if (!user || !townHallId) return false;
    if (isSuperAdmin(user)) return true;
    return (user.town_halls_list || []).some((id) => String(id) === String(townHallId));
}

function canEditMaintenanceConfig(user, townHallId) {
    if (!user) return false;
    if (isSuperAdmin(user)) return true;
    if (user.user_type !== 'ADMINISTRATOR') return false;
    return canAccessTownHall(user, townHallId);
}

function requireRole(...allowedRoles) {
    const allowed = new Set(allowedRoles);

    return async (req, res, next) => {
        try {
            const user = await loadRequestUser(req);
            if (!user || !allowed.has(user.user_type)) {
                return res.status(403).json({ error: 'Accesso negato, non possiedi i diritti necessari!' });
            }
            req.currentUser = user;
            next();
        } catch (error) {
            console.error('Errore controllo ruolo:', error);
            return res.status(500).json({ error: 'Errore del server' });
        }
    };
}

async function requireTownHallAccess(req, res, townHallId) {
    const user = req.currentUser || await loadRequestUser(req);
    if (!user) {
        res.status(401).json({ error: 'Utente non autenticato' });
        return null;
    }
    if (!canAccessTownHall(user, townHallId)) {
        res.status(403).json({ error: TOWN_HALL_ACCESS_DENIED_MESSAGE });
        return null;
    }
    req.currentUser = user;
    return user;
}

/**
 * Risolve un comune per nome e verifica che l'utente autenticato possa accedervi.
 * @returns {Promise<object|null>} documento townHall (minimo _id/name) oppure null se ha già risposto
 */
async function requireTownHallAccessByName(req, res, townHallName) {
    const name = typeof townHallName === 'string' ? townHallName.trim() : '';
    if (!name) {
        res.status(400).json({ error: 'Nome comune obbligatorio' });
        return null;
    }
    const th = await townHalls.findOne({ name: { $eq: name } }).select('_id name');
    if (!th) {
        res.status(404).json({ error: 'Comune non trovato' });
        return null;
    }
    if (!(await requireTownHallAccess(req, res, th._id))) return null;
    return th;
}

async function requireTownHallEdit(req, res, townHallId) {
    const user = req.currentUser || await loadRequestUser(req);
    if (!user) {
        res.status(401).json({ error: 'Utente non autenticato' });
        return null;
    }
    if (!canEditMaintenanceConfig(user, townHallId)) {
        res.status(403).json({ error: 'Non hai i permessi per modificare la configurazione di questo comune' });
        return null;
    }
    req.currentUser = user;
    return user;
}

module.exports = {
    STAFF_ROLES,
    CONFIG_EDITOR_ROLES,
    TOWN_HALL_ACCESS_DENIED_MESSAGE,
    loadRequestUser,
    isSuperAdmin,
    canAccessTownHall,
    canEditMaintenanceConfig,
    requireRole,
    requireTownHallAccess,
    requireTownHallAccessByName,
    requireTownHallEdit,
};
