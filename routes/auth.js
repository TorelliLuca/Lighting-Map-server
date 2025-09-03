const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const users = require('../schemas/users');
const { transporter, emailLighting, debugMail } = require('../config/email');
const { returnHtmlEmailAdmin } = require('../utils/emailHelpers');
const accessLogger = require('../middleware/accessLogger');
const logAccess = require('../utils/accessLogger');
const router = express.Router();

// Rate limiting per invio mail di reset password (max 1 richiesta/30s per email)
const RateLimit = require('express-rate-limit');
const resetPasswordLimiter = RateLimit({
    windowMs: 30 * 1000, // 30 secondi
    max: 1,
    keyGenerator: (req) => req.body.email || req.ip,
    message: 'Hai raggiunto il limite di richieste per il reset password. Riprova più tardi.'
});
// Richiesta reset password
router.post('/forgot-password', resetPasswordLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).send('Email richiesta');
    try {
        const user = await users.findOne({ email });
        if (!user) return res.status(200).send('Se l\'email è registrata riceverai istruzioni per il reset.'); // risposta generica
        // Genera token JWT valido 1 ora
        const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000;
        await user.save();
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
        const { sendResetPasswordEmail } = require('../utils/emailHelpers');
        await sendResetPasswordEmail(user, resetUrl);
        res.status(200).send('Se l\'email è registrata riceverai istruzioni per il reset.');
    } catch (e) {
        console.log(e);
        res.status(500).send('Errore invio email');
    }
});

// Reset password effettivo
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).send('Token e nuova password richiesti');
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await users.findById(payload.id);
        if (!user || user.resetPasswordToken !== token || !user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
            return res.status(400).send('Token non valido o scaduto');
        }
        user.password = password;
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();
        res.send('Password aggiornata con successo');
    } catch (e) {
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

    if (!user.is_approved) {
        return { error: 'Utente non ancora approvato' };
    }

    if (!user.emailVerified) {
        const { sendConfirmationEmail } = require("../utils/emailHelpers");
        try{
            await sendConfirmationEmail(user);
        }catch(e){
            //console.log(e);
            return {error: e.message}
        }
        return { error: `L'account non è ancora verificato, abbiamo inviato un link a ${user.email}. Controlla la posta (anche nello spam)` };
    }

    return { user };
}

// Login routes
router.post('/login', async function (req, res) {
    if (!req.body.email || !req.body.password) {
        return res.status(400).send('Email e Password richiesti');
    }

    try {
        const user = await users.findOne({email: {$eq: req.body.email}}).populate('town_halls_list');
        const validation = await validateUserForLogin(user, req.body.password);
        if (validation.error) return res.status(400).send(validation.error);
        // Create JWT token with user data
        const token = jwt.sign(
            { 
                id: user._id,
                email: user.email,
                name: user.name,
                surname: user.surname
            }, 
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );
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
                town_halls_list: user.town_halls_list
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
        const user = await users.findOne({email: {$eq: req.body.email}}).populate('town_halls_list');
        const validation = await validateUserForLogin(user, req.body.password);
        if (validation.error) return res.status(400).send(validation.error);
        if (user.user_type !== 'SUPER_ADMIN') return res.status(400).send('Permessi insufficienti');
        res.json({ user });
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

    try {
        const existingUsr = await users.findOne({email: {$eq: req.body.email}});
        if (existingUsr) return res.status(400).send('Email già in uso');

        const newUser = new users({
            name: req.body.name,
            surname: req.body.surname,
            email: req.body.email,
            password: req.body.password,
            is_approved: false,
            emailVerified: false
        });
        await newUser.save();

        // Invio email di conferma centralizzato
        const { sendConfirmationEmail } = require('../utils/emailHelpers');
        try {
            await sendConfirmationEmail(newUser);
        } catch (e) {
            console.log(e);
            // Non bloccare la registrazione se la mail fallisce
        }

        res.status(201).send("Utente registrato con successo. Controlla la mail per confermare.");
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

router.get("/test-mail", async (req, res) => {
    const { sendConfirmationEmail } = require('../utils/emailHelpers');
        try {
            await sendConfirmationEmail({name: "luca", _id:"sdgjhsdguhsdfghsdfjkoghsdjkghsdfjkghsdjkfgsdjk", email: "lighting.map2023@gmail.com"});
        } catch (e) {
            console.log(e);
            // Non bloccare la registrazione se la mail fallisce
        }
        res.status(200).send('Test email inviata con successo');
})

// Conferma email tramite token
router.get('/confirm-email', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token mancante');
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await users.findById(payload.id);
        if (!user) return res.status(404).send('Utente non trovato');
        if (user.emailVerified) return res.status(400).send('Email già verificata');
        user.emailVerified = true;
        await user.save();
        res.send('Email confermata con successo');
    } catch (e) {
        res.status(400).send('Token non valido o scaduto');
    }
});

router.post('/send-email-to-user/userNeedValidation', async(req, res) => {
    const username = req.body.user.name
    const htmlEmail = returnHtmlEmailAdmin(username, req.body.user.surname, req.body.user.date)
    var mailOptions = {
        from: `LIGHTING MAP<${emailLighting}>` ,
        to: process.env.ADMIN_EMAIL,
        subject: `Richiesta di autenticazione per ${username} ${req.body.user.surname}`,
        html: htmlEmail,
        attachments: [
            {
                filename: 'image-1.png',
                path: './email/toAdmin/images/image-1.png',
                cid: 'image1' 
            }
        ]
    };
    try {
        let info = await transporter.sendMail(mailOptions);
        debugMail('Email sent: ' + info.response);
        res.status(200).send('Email inviata con successo');
    } catch (error) {
        debugMail(error);
        res.status(400).send('Errore durante l\'invio della mail');
    }
});



module.exports = router; 