const nodemailer = require('nodemailer');
const debugMail = require('debug')('lighting-map:mail');
const emailLighting = 'sicurezza@torellistudio.com';

// Configure email transporter
const transporter = nodemailer.createTransport({
    host: 'smtps.aruba.it',
    port: 465,
    secure: true,
    auth: {
        user: emailLighting,
        pass: process.env.PASSWORD_MAIL
    }
});

module.exports = {
    transporter,
    emailLighting,
    debugMail
}; 