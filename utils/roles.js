const users = require('../schemas/users');

const STAFF_ROLES = ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'];
const CONFIG_EDITOR_ROLES = ['ADMINISTRATOR', 'SUPER_ADMIN'];

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
        res.status(403).json({ error: 'Accesso negato al comune richiesto' });
        return null;
    }
    req.currentUser = user;
    return user;
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
    loadRequestUser,
    isSuperAdmin,
    canAccessTownHall,
    canEditMaintenanceConfig,
    requireRole,
    requireTownHallAccess,
    requireTownHallEdit,
};
