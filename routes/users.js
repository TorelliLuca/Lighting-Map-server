const express = require('express');
const users = require('../schemas/users');
const townHalls = require('../schemas/townHalls');
const debugDB = require('debug')('lighting-map:DB');
const { parse } = require('json2csv');
const accessLogger = require('../middleware/accessLogger');
const { requireRole, loadRequestUser, isSuperAdmin } = require('../utils/roles');
const router = express.Router();

const ALLOWED_USER_TYPES = new Set([
    'DEFAULT_USER',
    'MAINTAINER',
    'ADMINISTRATOR',
    'SUPER_ADMIN',
    'SURVEYOR',
]);

const USER_SAFE_SELECT =
    '-password -resetPasswordToken -resetPasswordExpires -emailConfirmToken -emailConfirmExpires';

const USER_PUBLIC_POPULATE = {
    path: 'town_halls_list',
    select: 'name region province',
};

function normalizeSubRole(userType, subRoleRaw) {
    const subRole = subRoleRaw || null;
    if (userType === 'ADMINISTRATOR') {
        return ['RUP', 'DEC'].includes(subRole) ? subRole : null;
    }
    if (userType === 'MAINTAINER') {
        return ['LEAD_MAINTAINER', 'MAINTAINER'].includes(subRole) ? subRole : null;
    }
    return null;
}

function serializePreferences(prefs) {
    const raw = prefs || {};
    let seenPageTours = {};
    if (raw.seenPageTours) {
        if (typeof raw.seenPageTours.entries === 'function') {
            seenPageTours = Object.fromEntries(raw.seenPageTours.entries());
        } else if (typeof raw.seenPageTours === 'object') {
            seenPageTours = { ...raw.seenPageTours };
        }
    }
    return {
        onboardingCompleted: Boolean(raw.onboardingCompleted),
        onboardingCompletedAt: raw.onboardingCompletedAt || null,
        lastSeenWhatsNewId: raw.lastSeenWhatsNewId || null,
        seenPageTours,
    };
}

function defaultPreferences() {
    return {
        onboardingCompleted: false,
        onboardingCompletedAt: null,
        lastSeenWhatsNewId: null,
        seenPageTours: {},
    };
}

function toSafeUserJson(userDoc) {
    if (!userDoc) return null;
    const obj = typeof userDoc.toObject === 'function' ? userDoc.toObject() : { ...userDoc };
    delete obj.password;
    delete obj.resetPasswordToken;
    delete obj.resetPasswordExpires;
    delete obj.emailConfirmToken;
    delete obj.emailConfirmExpires;
    delete obj.passwordChangedAt;
    return obj;
}

function parseUserType(raw) {
    if (raw == null || raw === '') return { ok: true, value: null };
    if (!ALLOWED_USER_TYPES.has(raw)) {
        return { ok: false, error: 'user_type non valido' };
    }
    return { ok: true, value: raw };
}

const requireSuperAdmin = requireRole('SUPER_ADMIN');

// User validation
router.post('/validateUser', requireSuperAdmin, async (req, res) => {
    const usrType = req.body.user_type;
    const subRole = req.body.sub_role;
    const id = req.body.userId;

    if (!id) return res.status(404).send('ID non valido');

    const parsedType = parseUserType(usrType);
    if (usrType != null && usrType !== '' && !parsedType.ok) {
        return res.status(400).json({ error: parsedType.error });
    }

    try {
        const usr = await users.findById(id);
        if (!usr) return res.status(400).send('user not found');

        usr.is_approved = true;
        if (parsedType.value) {
            usr.user_type = parsedType.value;
        }
        usr.sub_role = normalizeSubRole(usr.user_type, subRole);

        const townHallId = req.body.townHallId;
        if (townHallId) {
            const townHall = await townHalls.findById(townHallId);
            debugDB(`Linking townhall id: ${townHallId} -> found: ${townHall ? townHall.name : 'null'}`);
            if (townHall && !usr.town_halls_list.some((t) => t.equals(townHall._id))) {
                usr.town_halls_list.push(townHall._id);
            }
        }

        await usr.save();

        try {
            const { sendConfiguredEmail } = require('../utils/mailEngine');
            await sendConfiguredEmail('USER_VALIDATED', {
                recipientUserIds: [usr._id],
                vars: {
                    nome: usr.name || '',
                    cognome: usr.surname || '',
                    email: usr.email || '',
                },
            });

            const { createNotification, safeNotify } = require('../utils/notificationHelpers');
            await safeNotify(() =>
                createNotification({
                    userId: usr._id,
                    title: 'Account validato',
                    body: 'Il tuo account è stato validato. Se hai già confermato l\'email puoi accedere a LightingMap.',
                    type: 'USER_VALIDATED',
                    url: '/login',
                    meta: { userType: usr.user_type },
                })
            );
        } catch (mailErr) {
            console.log(`Errore invio email validazione: ${mailErr}`);
        }
        res.send('Utente validato con successo');
    } catch (e) {
        debugDB(e);
        res.status(500).send('Errore del server');
    }
});

router.post('/removeUserByID/:id', requireSuperAdmin, async (req, res) => {
    const id = req.params.id;

    if (!id) return res.status(404).send('ID non valido');

    try {
        const usr = await users.findById(id);
        if (!usr) return res.status(400).send('user not found');

        if (String(usr._id) === String(req.user.id)) {
            return res.status(400).json({ error: 'Non puoi eliminare il tuo stesso account' });
        }

        await usr.deleteOne();

        res.send('Utente eliminato con successo');
    } catch (e) {
        debugDB(e);
        res.status(500).send('errore del server');
    }
});

router.post('/removeUser', requireSuperAdmin, async (req, res) => {
    const email = req.body.email;

    if (!email) return res.status(404).send('Email non valida');

    try {
        const usr = await users.findOne({ email: { $eq: email } });
        if (!usr) return res.status(400).send('user not found');

        if (String(usr._id) === String(req.user.id)) {
            return res.status(400).json({ error: 'Non puoi eliminare il tuo stesso account' });
        }

        await usr.deleteOne();

        res.send('Utente eliminato con successo');
    } catch (e) {
        debugDB(e);
        res.status(500).send('errore del server');
    }
});

router.post('/update/modifyUser', requireSuperAdmin, async (req, res) => {
    const id = req.body.id;
    const userData = req.body.userData || {};

    if (!id) return res.status(404).send('ID non trovato');

    const parsedType = parseUserType(userData.user_type);
    if (userData.user_type != null && userData.user_type !== '' && !parsedType.ok) {
        return res.status(400).json({ error: parsedType.error });
    }

    try {
        const usr = await users.findById(id);
        if (!usr) return res.status(400).send('user not found');

        if (typeof userData.name === 'string') usr.name = userData.name;
        if (typeof userData.surname === 'string') usr.surname = userData.surname;
        if (parsedType.value) {
            usr.user_type = parsedType.value;
            usr.sub_role = normalizeSubRole(parsedType.value, userData.sub_role);
        } else if (Object.prototype.hasOwnProperty.call(userData, 'sub_role')) {
            usr.sub_role = normalizeSubRole(usr.user_type, userData.sub_role);
        }
        if (typeof userData.email === 'string' && userData.email.trim()) {
            usr.email = userData.email.trim().toLowerCase();
        }

        if (userData.password) {
            usr.password = userData.password;
        }

        const townHallId = req.body.townHallId;
        if (townHallId) {
            const townHall = await townHalls.findById(townHallId);
            if (townHall && !usr.town_halls_list.some((t) => t.equals(townHall._id))) {
                usr.town_halls_list.push(townHall._id);
            }
        }

        await usr.save();

        res.send('Utente modificato con successo');
    } catch (e) {
        debugDB(e);
        res.status(500).send('errore del server');
    }
});

router.post('/addTownHalls', requireSuperAdmin, async (req, res) => {
    try {
        const townHallName = req.body.townHall;

        const townHall = await townHalls.findOne({ name: { $eq: townHallName } });
        if (!townHall) {
            return res.status(404).send('Comune non trovato nel database');
        }

        const user = await users.findOne({ email: { $eq: req.body.email } });
        if (!user) {
            return res.status(404).send('Utente non trovato');
        }
        if (!user.is_approved) return res.status(404).send("L'utente non è ancora stato approvato");
        if (user.town_halls_list.some((town) => town.equals(townHall._id))) {
            return res.status(409).send("Comune già presente nella lista dell'utente");
        }

        user.town_halls_list.push(townHall._id);
        await user.save();

        res.status(200).send('Comune aggiunto con successo!');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

router.delete('/removeTownHalls', requireSuperAdmin, async (req, res) => {
    try {
        const townHallName = req.body.townHall;
        const townHall = await townHalls.findOne({ name: { $eq: townHallName } });
        if (!townHall) {
            return res.status(404).send('Comune non trovato nel database');
        }

        const user = await users.findOne({ email: { $eq: req.body.email } });
        if (!user) {
            return res.status(404).send('Utente non trovato');
        }
        if (!user.is_approved) return res.status(404).send("L'utente non è ancora stato approvato");

        const townHallIndex = user.town_halls_list.findIndex((town) => town.equals(townHall._id));
        if (townHallIndex === -1) {
            return res.status(409).send("Comune non presente nella lista dell'utente");
        }

        user.town_halls_list.splice(townHallIndex, 1);
        await user.save();

        res.status(200).send('Comune rimosso con successo!');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

router.get('/', requireSuperAdmin, async function (req, res) {
    try {
        const usersList = await users
            .find({})
            .select(USER_SAFE_SELECT)
            .sort({ name: 1 })
            .collation({ locale: 'it', strength: 2 });
        res.json(usersList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/getNotValidateUsers', requireSuperAdmin, async function (req, res) {
    try {
        const usersList = await users.find({ is_approved: false }).select(USER_SAFE_SELECT);
        res.json(usersList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/profile', accessLogger('GET_PROFILE'), async function (req, res) {
    try {
        const userId = req.user.id;

        const user = await users
            .findById(userId)
            .select(USER_SAFE_SELECT)
            .populate(USER_PUBLIC_POPULATE);

        if (!user) {
            return res.status(404).send('User not found');
        }

        res.json({
            user: {
                id: user._id,
                name: user.name,
                surname: user.surname,
                email: user.email,
                is_approved: user.is_approved,
                user_type: user.user_type,
                sub_role: user.sub_role || null,
                town_halls_list: user.town_halls_list,
                id_organization: user.id_organization,
                emailVerified: user.emailVerified,
                date: user.date,
                preferences: serializePreferences(user.preferences),
            },
        });
    } catch (err) {
        console.error('Error fetching user profile:', err);
        res.status(500).send('Server error');
    }
});

router.post('/me/preferences', accessLogger('UPDATE_PREFERENCES'), async function (req, res) {
    try {
        const userId = req.user.id;
        const body = req.body || {};

        const user = await users.findById(userId);
        if (!user) {
            return res.status(404).send('User not found');
        }

        if (!user.preferences) {
            user.preferences = defaultPreferences();
        }

        if (typeof body.onboardingCompleted === 'boolean') {
            user.preferences.onboardingCompleted = body.onboardingCompleted;
            if (body.onboardingCompleted) {
                user.preferences.onboardingCompletedAt = body.onboardingCompletedAt
                    ? new Date(body.onboardingCompletedAt)
                    : new Date();
            } else if (body.onboardingCompleted === false) {
                user.preferences.onboardingCompletedAt = null;
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'lastSeenWhatsNewId')) {
            user.preferences.lastSeenWhatsNewId =
                body.lastSeenWhatsNewId == null ? null : String(body.lastSeenWhatsNewId);
        }

        if (body.seenPageTours && typeof body.seenPageTours === 'object') {
            if (!user.preferences.seenPageTours) {
                user.preferences.seenPageTours = new Map();
            }
            for (const [pageId, seen] of Object.entries(body.seenPageTours)) {
                if (!pageId || typeof pageId !== 'string') continue;
                const key = pageId.slice(0, 64);
                if (user.preferences.seenPageTours.set) {
                    user.preferences.seenPageTours.set(key, Boolean(seen));
                } else {
                    user.preferences.seenPageTours[key] = Boolean(seen);
                }
            }
        }

        user.markModified('preferences');
        await user.save();

        res.json({
            preferences: serializePreferences(user.preferences),
        });
    } catch (err) {
        console.error('Error updating user preferences:', err);
        res.status(500).send('Server error');
    }
});

router.get('/getForEmail/:email', requireSuperAdmin, async function (req, res) {
    try {
        const user = await users.findOne({ email: req.params.email }).select(USER_SAFE_SELECT);
        if (user) {
            res.json(user);
        } else {
            res.status(404).send('Utente non trovato');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/api/downloadCsv', requireSuperAdmin, async function (req, res) {
    try {
        const usersToDownload = await users.find({}).select(USER_SAFE_SELECT).populate('town_halls_list');
        const data = usersToDownload.map((u) => ({
            name: u.name,
            surname: u.surname,
            email: u.email,
            user_type: u.user_type,
            is_approved: u.is_approved,
            date: u.date ? u.date.toLocaleString('it-IT') : '',
            comuni:
                u.town_halls_list && u.town_halls_list.length > 0
                    ? u.town_halls_list.map((c) => c.name).join(', ')
                    : '',
        }));
        const fields = [
            { label: 'Nome', value: 'name' },
            { label: 'Cognome', value: 'surname' },
            { label: 'Email', value: 'email' },
            { label: 'Tipo', value: 'user_type' },
            { label: 'Approvato', value: 'is_approved' },
            { label: 'Data registrazione', value: 'date' },
            { label: 'Comuni associati', value: 'comuni' },
        ];
        const opts = { fields, delimiter: ';', quote: '' };
        const csv = parse(data, opts);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
        res.send(csv);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.post('/update-user-type', requireSuperAdmin, async (req, res) => {
    const { userId, newUserType, sub_role: subRole } = req.body;

    if (!userId || !newUserType) {
        return res.status(400).json({ error: 'Missing userId or newUserType' });
    }

    const parsedType = parseUserType(newUserType);
    if (!parsedType.ok) {
        return res.status(400).json({ error: parsedType.error });
    }

    try {
        const user = await users.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.user_type = parsedType.value;
        user.sub_role = normalizeSubRole(parsedType.value, subRole);
        user.is_approved = true;
        await user.save();
        res.json({ message: 'User type updated successfully', user: toSafeUserJson(user) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id/lightPointsCount', async function (req, res) {
    try {
        const requester = await loadRequestUser(req);
        if (!requester) {
            return res.status(401).json({ error: 'Utente non autenticato' });
        }

        const targetId = req.params.id;
        if (!isSuperAdmin(requester) && String(requester._id) !== String(targetId)) {
            return res.status(403).json({ error: 'Accesso negato' });
        }

        const user = await users.findById(targetId).populate('town_halls_list');
        if (!user) {
            return res.status(404).send('Utente non trovato');
        }
        let totalLightPoints = 0;
        const townhalls = [];
        for (const townHall of user.town_halls_list) {
            if (townHall.punti_luce && Array.isArray(townHall.punti_luce)) {
                totalLightPoints += townHall.punti_luce.length;
            }
            if (townHall.name) {
                townhalls.push(townHall.name);
            }
        }
        res.json({ totalLightPoints, townhalls });
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.get('/:id', requireSuperAdmin, async function (req, res) {
    try {
        const user = await users.findById(req.params.id).select(USER_SAFE_SELECT);
        if (user) {
            res.json(user);
        } else {
            res.status(404).send('Utente non trovato');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

module.exports = router;
