const express = require('express');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const { transporter, emailLighting, debugMail } = require('../config/email');
const { returnHtmlEmail, returnHtmlEmailAfterReport, returnHtmlEmailAfterOperation } = require('../utils/emailHelpers');

const router = express.Router();

router.post('/send-email-to-user/isApproved', async(req, res) => {
    const username = req.body.user.name
    const htmlEmail = returnHtmlEmail(username)
    var mailOptions = {
        from: `LIGHTING MAP<${emailLighting}>` ,
        to: req.body.to,
        subject: 'Autenticazione su Lighting-map abilitata!',
        html: htmlEmail,
        attachments: [
            {
              filename: 'image-1.png',
              path: './email/images/image-1.png',
              cid: 'image1'
            },
            {
                filename: 'image-2.png',
                path: './email/images/image-2.png',
                cid: 'image2'
            },
            {
                filename: 'image-3.png',
                path: './email/images/image-3.png',
                cid: 'image3'
            },
            {
                filename: 'image-4.png',
                path: './email/images/image-4.png',
                cid: 'image4'
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

router.post('/send-email-to-user/lightPointReported', async(req, res) => {
    const th = await townHalls.findOne({name: {$eq: req.body.name}});
    if (!th) res.status(404).send('Comune non trovato, impossibile inviare la mail');

    const destination = await users.find({town_halls_list: th._id,
        user_type: { $in: ['ADMINISTRATOR', 'SUPER_ADMIN']}}).select('email -_id')
    const destinationEmail = destination.map(userEmail => userEmail.email)
    
    debugMail(destinationEmail);

    const username = req.body.user.name
    const htmlEmail = returnHtmlEmailAfterReport(req.body.user, req.body.date, req.body.name,req.body.light_point ,req.body.report)
    
    for (let email of destinationEmail) {
        var mailOptions = {
            from: `LIGHTING MAP - Segnalazione guasti<${emailLighting}>`,
            to: email,
            subject: `Aperta segnalazione sul punto ${req.body.light_point.numero_palo}, ${req.body.name}`,
            html: htmlEmail,
            attachments: [
                {
                    filename: 'image-1.png',
                    path: './email/afterReport/images/image-1.png',
                    cid: 'image1' 
                },
                {
                    filename: 'image-2.png',
                    path: './email/afterReport/images/image-2.png',
                    cid: 'image2' 
                },
                {
                    filename: 'image-3.gif',
                    path: './email/afterReport/images/image-3.gif',
                    cid: 'image3' 
                }
            ]
        };
        try {
            let info = await transporter.sendMail(mailOptions);
            debugMail(`Email sent to ${email}: ` + info.response);
        } catch (error) {
            debugMail(`Error sending email to ${email}: ` + error);
        }
    }
    res.status(200).send('Emails sent');
});

router.post('/send-email-to-user/reportSolved', async(req, res) => {
    const th = await townHalls.findOne({name: {$eq: req.body.name}});
    if (!th) res.status(404).send('Comune non trovato, impossibile inviare la mail');

    const destination = await users.find({town_halls_list: th._id,
        user_type: { $in: ['ADMINISTRATOR', 'SUPER_ADMIN']}}).select('email -_id')
    const destinationEmail = ["TorelliLuca06@gmail.com"]
    debugMail(destinationEmail);

    const username = req.body.user.name
    const htmlEmail = returnHtmlEmailAfterOperation(req.body.user, req.body.date, req.body.name,req.body.light_point ,req.body.operation)
    
    for (let email of destinationEmail) {
        var mailOptions = {
            from: `LIGHTING MAP - Segnalazione guasti<${emailLighting}>`,
            to: email,
            subject: `Operazione effettuata sul punto ${req.body.light_point.numero_palo}, ${req.body.name}`,
            html: htmlEmail,
            attachments: [
                {
                    filename: 'image-1.png',
                    path: './email/afterOperation/images/image-1.png',
                    cid: 'image1' 
                },
                {
                    filename: 'image-2.png',
                    path: './email/afterOperation/images/image-2.png',
                    cid: 'image2' 
                },
                {
                    filename: 'image-3.png',
                    path: './email/afterOperation/images/image-3.png',
                    cid: 'image3' 
                },
                {
                    filename: 'image-4.png',
                    path: './email/afterOperation/images/image-4.png',
                    cid: 'image4' 
                },
                {
                    filename: 'image-5.png',
                    path: './email/afterOperation/images/image-5.png',
                    cid: 'image5' 
                },
                {
                    filename: 'image-6.png',
                    path: './email/afterOperation/images/image-6.png',
                    cid: 'image6' 
                }
            ]
        };
        try {
            let info = await transporter.sendMail(mailOptions);
            debugMail(`Email sent to ${email}: ` + info.response);
        } catch (error) {
            debugMail(`Error sending email to ${email}: ` + error);
        }
    }
    res.status(200).send('Emails sent');
});

module.exports = router; 