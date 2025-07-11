const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const users = require('../schemas/users');
const { transporter, emailLighting, debugMail } = require('../config/email');
const { returnHtmlEmailAdmin } = require('../utils/emailHelpers');
const accessLogger = require('../middleware/accessLogger');
const logAccess = require('../utils/accessLogger');
const router = express.Router();

// Login routes
router.post('/login', async function (req, res) {
    if (!req.body.email || !req.body.password) {
        return res.status(400).send('Email e Password richiesti');
    }

    try {
        const user = await users.findOne({email: {$eq: req.body.email}}).populate('town_halls_list');
        if (!user) {
            return res.status(400).send('Email non valida');
        }
        
        if (!user.is_approved) return res.status(400).send('Utente non ancora approvato');
        
        const isMatch = await user.comparePassword(req.body.password);
        if (!isMatch) {
            return res.status(400).send('Password non valida');
        }

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

        // Return user data with token
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
        if (!user) {
            return res.status(400).send('Email non valida');
        }
        if(!user.is_approved) return res.status(400).send('Utente non ancora approvato')
        const isMatch = await user.comparePassword(req.body.password);

        if (!isMatch) {
            return res.status(400).send('Password non valida');
        }
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
            is_approved: false
        });
        
        await newUser.save();

        res.status(201).send("Utente registrato con successo");
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
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