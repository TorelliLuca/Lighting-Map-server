const nodemailer = require('nodemailer');
const debugMail = require('debug')('lighting-map:mail');
const emailLighting = 'sicurezza@torellistudio.com';

// Aruba SMTP limita le connessioni concorrenti (421 Too many connections).
// Pool con una sola connessione riusata + rate limit evita di aprirne troppe.
const transporter = nodemailer.createTransport({
    host: 'smtps.aruba.it',
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    rateDelta: 1000,
    rateLimit: 2,
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
