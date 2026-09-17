const express = require('express');
const users = require('../schemas/users');
const { debugMail } = require('../config/email');
const accessLogger = require('../middleware/accessLogger');
const logAccess = require('../utils/accessLogger');
const { signAccessToken } = require('../utils/jwtHelpers');
const { validatePasswordStrength, normalizeEmail } = require('../utils/passwordPolicy');
const {
    createResetPasswordToken,
    hashResetPasswordToken,
    getFrontendBaseUrl,
} = require('../utils/resetPasswordToken');
const router = express.Router();
const borders = require("./../schemas/borders");

const RateLimit = require('express-rate-limit');

const GENERIC_FORGOT_MSG = 'Se l\'email è registrata riceverai istruzioni per il reset.';

// Limite per IP: mitiga spray su molte email
const forgotPasswordIpLimiter = RateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Hai raggiunto il limite di richieste per il reset password. Riprova più tardi.',
});

// Limite per email: evita flood sulla stessa casella
const forgotPasswordEmailLimiter = RateLimit({
    windowMs: 60 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => normalizeEmail(req.body?.email) || req.ip,
    message: 'Hai raggiunto il limite di richieste per il reset password. Riprova più tardi.',
});

const resetPasswordSubmitLimiter = RateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Troppi tentativi di reset password. Riprova più tardi.',
});

async function findUserByEmailInsensitive(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    return users.findOne({
        $expr: { $eq: [{ $toLower: '$email' }, normalized] },
    });
}

// Richiesta reset password
router.post(
    '/forgot-password',
    forgotPasswordIpLimiter,
    forgotPasswordEmailLimiter,
    async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        if (!email) return res.status(400).send('Email richiesta');
        try {
            const user = await findUserByEmailInsensitive(email);
            if (!user) {
                await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 200)));
                return res.status(200).send(GENERIC_FORGOT_MSG);
            }

            const { rawToken, hashedToken, expiresAt } = createResetPasswordToken();
            user.resetPasswordToken = hashedToken;
            user.resetPasswordExpires = expiresAt;
            await user.save();

            const resetUrl = `${getFrontendBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
            const { sendResetPasswordEmail } = require('../utils/emailHelpers');
            await sendResetPasswordEmail(user, resetUrl);
            res.status(200).send(GENERIC_FORGOT_MSG);
        } catch (e) {
            console.log(e);
            // Non rivelare dettagli (es. fallimento SMTP) per anti-enumerazione
            res.status(200).send(GENERIC_FORGOT_MSG);
        }
    }
);

// Reset password effettivo
router.post('/reset-password', resetPasswordSubmitLimiter, async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).send('Token e nuova password richiesti');

    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).send(passwordError);

    try {
        const hashedToken = hashResetPasswordToken(token);
        const user = await users.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: new Date() },
        });
        if (!user) {
            return res.status(400).send('Token non valido o scaduto');
        }
        user.password = password;
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();
        res.send('Password aggiornata con successo');
    } catch (e) {
        console.error(e);
        res.status(400).send('Token non valido o scaduto');
    }
});


// Funzione riutilizzabile per validazione utente
async function validateUserForLogin(user, password) {
    if (!user) {
        return { error: 'Credenziali non valide' }; 
        // messaggio generico: non rivela se email esiste
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        return { error: 'Credenziali non valide' };
    }

    // Conferma email prima dell'approvazione admin: consente reinvio link
    if (!user.emailVerified) {
        const { sendConfirmationEmail } = require("../utils/emailHelpers");
        try {
            await sendConfirmationEmail(user);
        } catch (e) {
            return {
                error: e.message || "Account non verificato. Riprova più tardi a richiedere il link di conferma.",
                code: 'EMAIL_NOT_VERIFIED',
            };
        }
        return {
            error: "L'account non è ancora verificato. Controlla la posta (anche nello spam) o richiedi un nuovo link.",
            code: 'EMAIL_NOT_VERIFIED',
        };
    }

    if (!user.is_approved) {
        return { error: 'Utente non ancora approvato' };
    }

    return { user };
}

function sendLoginValidationError(res, validation) {
    if (validation.code) {
        return res.status(400).json({ message: validation.error, code: validation.code });
    }
    return res.status(400).send(validation.error);
}

// Login routes
router.post('/login', async function (req, res) {
    if (!req.body.email || !req.body.password) {
        return res.status(400).send('Email e Password richiesti');
    }

    try {
        let user = await findUserByEmailInsensitive(req.body.email);
        if (user) user = await user.populate('town_halls_list');
        const validation = await validateUserForLogin(user, req.body.password);
        if (validation.error) return sendLoginValidationError(res, validation);
        const rememberMe = Boolean(req.body.rememberMe);
        const token = signAccessToken(user, rememberMe);
        await logAccess({
            user: user._id, 
            action: 'LOGIN',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: null
        });
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
                preferences: user.preferences
                    ? {
                        onboardingCompleted: Boolean(user.preferences.onboardingCompleted),
                        onboardingCompletedAt: user.preferences.onboardingCompletedAt || null,
                        lastSeenWhatsNewId: user.preferences.lastSeenWhatsNewId || null,
                        seenPageTours: user.preferences.seenPageTours
                            ? (typeof user.preferences.seenPageTours.entries === 'function'
                                ? Object.fromEntries(user.preferences.seenPageTours.entries())
                                : { ...user.preferences.seenPageTours })
                            : {},
                    }
                    : {
                        onboardingCompleted: false,
                        onboardingCompletedAt: null,
                        lastSeenWhatsNewId: null,
                        seenPageTours: {},
                    },
            },
            token
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.post('/adminLogin', accessLogger('ADMIN_LOGIN'), async function (req, res) {
    if (!req.body.email || !req.body.password) {
        return res.status(400).send('Email e Password richiesti');
    }

    try {
        let user = await findUserByEmailInsensitive(req.body.email);
        if (user) user = await user.populate('town_halls_list');
        const validation = await validateUserForLogin(user, req.body.password);
        if (validation.error) return sendLoginValidationError(res, validation);
        if (user.user_type !== 'SUPER_ADMIN') return res.status(400).send('Permessi insufficienti');
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
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

// User registration
router.post('/addPendingUser', async function (req, res) {
    if (!req.body.name || !req.body.surname || !req.body.email || !req.body.password) {
        return res.status(400).send('id, name, surname, email, and password are required');
    }

    const passwordError = validatePasswordStrength(req.body.password);
    if (passwordError) return res.status(400).send(passwordError);

    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).send('Email non valida');

    try {
        const existingUsr = await findUserByEmailInsensitive(email);
        if (existingUsr) return res.status(400).send('Email già in uso');

        const newUser = new users({
            name: req.body.name,
            surname: req.body.surname,
            email,
            password: req.body.password,
            is_approved: false,
            emailVerified: false,
            requested_townhall: req.body.requested_townhall,
            requested_townhall_notes: req.body.requested_townhall_notes
        });
        await newUser.save();

        // Invio email di conferma centralizzato
        const { sendConfirmationEmail } = require('../utils/emailHelpers');
        let emailSent = true;
        try {
            await sendConfirmationEmail(newUser);
        } catch (e) {
            console.log(e);
            emailSent = false;
        }

        res.status(201).json({
            message: emailSent
                ? "Utente registrato con successo. Controlla la mail per confermare."
                : "Utente registrato, ma non siamo riusciti a inviare la mail di conferma. Usa 'Rinvia email' dal login.",
            emailSent,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

if (process.env.NODE_ENV !== 'production') {
    router.get('/test-mail', async (req, res) => {
        const { sendConfirmationEmail } = require('../utils/emailHelpers');
        try {
            await sendConfirmationEmail({
                name: 'test',
                _id: 'test-mail-dev-only',
                email: process.env.ADMIN_EMAIL || 'test@example.com',
            });
        } catch (e) {
            console.log(e);
            return res.status(500).send('Errore invio email di test');
        }
        res.status(200).send('Test email inviata con successo');
    });
}

// Conferma email tramite token opaco one-time
router.get('/confirm-email', async (req, res) => {
    const { token } = req.query;
    if (!token || typeof token !== 'string') return res.status(400).send('Token mancante');
    try {
        const { hashEmailConfirmToken } = require('../utils/emailConfirmToken');
        const hashedToken = hashEmailConfirmToken(token);

        const user = await users.findOne({
            emailConfirmToken: hashedToken,
            emailConfirmExpires: { $gt: new Date() },
        });

        if (!user) {
            // Idempotenza: se già verificato con questo flusso, oppure token già consumato
            // Non rivelare dettagli: messaggio generico se non trovato
            return res.status(400).send('Token non valido o scaduto');
        }

        if (user.emailVerified) {
            user.emailConfirmToken = null;
            user.emailConfirmExpires = null;
            await user.save();
            return res.send('Email confermata con successo');
        }

        const updated = await users.findOneAndUpdate(
            {
                _id: user._id,
                emailConfirmToken: hashedToken,
                emailVerified: false,
            },
            {
                $set: {
                    emailVerified: true,
                    emailConfirmToken: null,
                    emailConfirmExpires: null,
                },
            },
            { new: true }
        );

        if (!updated) {
            const current = await users.findById(user._id);
            if (current?.emailVerified) {
                return res.send('Email confermata con successo');
            }
            return res.status(400).send('Token non valido o scaduto');
        }

        res.send('Email confermata con successo');
    } catch (e) {
        console.error(e);
        res.status(400).send('Token non valido o scaduto');
    }
});

// Reinvio conferma email (pubblico, rate-limited; risposta generica anti-enumeration)
const confirmationResendLimiter = RateLimit({
    windowMs: 5 * 60 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => normalizeEmail(req.body?.email) || req.ip || 'unknown',
    message: 'Hai raggiunto il limite di richieste per questa email. Riprova più tardi.',
});

router.post('/send-confirmation', confirmationResendLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).send('Email richiesta');

    const genericOk = 'Se l\'email è registrata e non ancora verificata, riceverai un link di conferma.';
    try {
        const user = await findUserByEmailInsensitive(email);
        if (user && !user.emailVerified) {
            const { sendConfirmationEmail } = require('../utils/emailHelpers');
            try {
                await sendConfirmationEmail(user);
            } catch (e) {
                if (e.message && e.message.includes('limite di invii')) {
                    return res.status(429).send(e.message);
                }
                console.log(e);
            }
        }
        res.send(genericOk);
    } catch (e) {
        console.error(e);
        res.status(500).send('Errore invio email');
    }
});

router.post('/send-email-to-user/userNeedValidation', async(req, res) => {
    const username = req.body.user.name
    try {
        const { sendConfiguredEmail } = require('../utils/mailEngine');
        await sendConfiguredEmail('USER_NEED_VALIDATION', {
            vars: {
                nome: username || '',
                cognome: req.body.user.surname || '',
                email: req.body.user.email || '',
                data: req.body.user.date
                    ? new Date(req.body.user.date).toLocaleDateString('it-IT')
                    : new Date().toLocaleDateString('it-IT'),
            },
        });
        const { createNotificationsForEmails, safeNotify } = require('../utils/notificationHelpers');
        await safeNotify(() =>
            createNotificationsForEmails(process.env.ADMIN_EMAIL, {
                title: 'Nuova richiesta di autenticazione',
                body: `${username} ${req.body.user.surname} ha richiesto l'accesso a Lighting-map.`,
                type: 'USER_NEED_VALIDATION',
                url: '/dashboard',
                meta: {
                    name: username,
                    surname: req.body.user.surname,
                },
            })
        );
        res.status(200).send('Email inviata con successo');
    } catch (error) {
        debugMail(error);
        res.status(400).send('Errore durante l\'invio della mail');
    }
});

router.get('/suggest-townhall-name/prefix', async (req, res) => {
  const { prefix } = req.query;

  // Controllo sulla validità dell'input
  if (!prefix || typeof prefix !== 'string' || prefix.length < 2) {
    return res.status(400).json({ error: 'Fornire un prefisso valido di almeno 2 caratteri.' });
  }

  try {
    // Utilizziamo un'espressione regolare per la ricerca case-insensitive e che inizia per il prefisso
    const regex = new RegExp(`^${prefix}`, 'i');
    
    // Proiezione: recuperiamo solo i campi essenziali per alleggerire il payload
    const comuni = await borders.find(
      { 'properties.comune': { $regex: regex } },
      { 'properties.comune': 1, 'properties.pro_com_t': 1, '_id': 1 }
    ).limit(5); // Limita i risultati per prevenire risposte troppo grandi

    res.json(comuni);
  } catch (err) {
    console.error('Errore durante la ricerca dei comuni:', err);
    res.status(500).json({ error: 'Errore interno del server.' });
  }
});


module.exports = router; 