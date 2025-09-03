
const emailTemplate = require('../emailBodies');
const emailTemplateAdmin = require('../email/toAdmin/htmlText');
const emailTemplateAfterReport = require('../email/afterReport/htmlText');
const emailTemplateAfterOperation = require('../email/afterOperation/htmlText');
const emailTemplateConfirmEmail = require('../email/confirmEmail/htmlText');
const emailResetPassword = require('../email/resetPassword/htmlText');
const emailTemplateUserValidated = require('../email/userValidated/htmlText');

function returnHtmlEmail(username) {
  const htmlEmail = emailTemplate.replace('USERNAME', username);
  return htmlEmail;
}

function returnHtmlEmailAdmin(username, surname, date) {
    let htmlEmail = emailTemplateAdmin.replace(/USERNAME/g, username);
    htmlEmail = htmlEmail.replace(/COGNOME/g, surname);
    const formattedDate = formatDate(date);
    htmlEmail = htmlEmail.replace(/DATA/g, formattedDate);
    return htmlEmail;
}

function returnHtmlEmailAfterReport(user, date, thName, pl, report) {
    let htmlEmail = emailTemplateAfterReport.replace(/USERNAME/g, user.name);
    htmlEmail = htmlEmail.replace(/COGNOME/g, user.surname);
    const formattedDate = formatDate(date);
    htmlEmail = htmlEmail.replace(/DATA/g, formattedDate);
    htmlEmail = htmlEmail.replace(/NOME_COMUNE/g, thName);
    htmlEmail = htmlEmail.replace(/USER_EMAIL/g, user.email);
    htmlEmail = htmlEmail.replace(/USER_TELNUMB/g, user.cell);

    htmlEmail = htmlEmail.replace(/NUMERO_PALO/g, pl.numero_palo);
    htmlEmail = htmlEmail.replace(/INDIRIZZO/g, pl.indirizzo);

    htmlEmail = htmlEmail.replace(/CORPO_SEGNALAZIONE/g, report.report_type);
    htmlEmail = htmlEmail.replace(/NOTA/g, report.description);

    return htmlEmail;
}

function returnHtmlEmailAfterOperation(user, date, thName, pl, operation) {
    let htmlEmail = emailTemplateAfterOperation.replace(/NOME/g, user.name);
    htmlEmail = htmlEmail.replace(/SURNAME/g, user.surname);
    const formattedDate = formatDate(date);
    htmlEmail = htmlEmail.replace(/OPERATION_DATE/g, formattedDate);
    htmlEmail = htmlEmail.replace(/TOWNHALL/g, thName);

    htmlEmail = htmlEmail.replace(/NUMERO_PALO/g, pl.numero_palo);
    htmlEmail = htmlEmail.replace(/INDIRIZZO/g, pl.indirizzo);

    htmlEmail = htmlEmail.replace(/OPERATION_TYPE/g, operation.operation_type);
    htmlEmail = htmlEmail.replace(/NOTE/g, operation.description);

    return htmlEmail;
}
function returnHtmlConfirmEmail(user, link) {
    let htmlEmail = emailTemplateConfirmEmail.replace(/NOME/g, user.name);
    htmlEmail = htmlEmail.replace(/URL_CONFIRM/g, link);


    return htmlEmail;
}

function returnHtmlResetPassword(user, link) {
    let htmlEmail = emailResetPassword.replace(/NOME_UTENTE/g, user.name);
    htmlEmail = htmlEmail.replace(/LINK_AL_RESET/g, link);


    return htmlEmail;
}

function returnHtmlEmailUploadSuccess(nomeComune, batchStatus) {
    return `
        <div style="font-family: Arial, sans-serif; background: #f4f6fb; padding: 32px;">
            <div style="max-width: 600px; margin: auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); padding: 32px;">
                <div style="text-align: center;">
                    <img src=\"https://img.icons8.com/color/96/000000/ok--v1.png\" alt=\"Successo\" style=\"width: 64px; margin-bottom: 16px;\" />
                    <h2 style=\"color: #2e7d32; margin-bottom: 8px;\">Caricamento Completato!</h2>
                </div>
                <p style=\"font-size: 18px; color: #333;\">
                    Il caricamento del comune <b style=\"color: #1976d2;\">${nomeComune}</b> e dei suoi punti luce è stato completato con successo.
                </p>
                <div style=\"background: #e3f2fd; border-radius: 8px; padding: 16px; margin: 24px 0;\">
                    <h4 style=\"margin: 0 0 8px 0; color: #1565c0;\">Stato dei batch:</h4>
                    <ul style=\"padding-left: 20px; margin: 0;\">
                        ${batchStatus.map(b => `<li style=\"margin-bottom: 4px;\">Batch <b>${b.batch}</b>: <span style=\"color: #388e3c;\">${b.status}</span></li>`).join('')}
                    </ul>
                </div>
                <p style=\"color: #666; font-size: 15px; margin-top: 32px;\">
                    Grazie per aver utilizzato <b>Lighting Map</b>!<br>
                    <span style=\"font-size: 13px; color: #aaa;\">Questa è una notifica automatica, si prega di non rispondere a questa email.</span>
                </p>
            </div>
        </div>
    `;
}

function returnHtmlEmailUploadError(nomeComune, errore) {
    return `
        <div style="font-family: Arial, sans-serif; background: #fff3f3; padding: 32px;">
            <div style="max-width: 600px; margin: auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(255,0,0,0.07); padding: 32px;">
                <div style="text-align: center;">
                    <img src=\"https://img.icons8.com/color/96/FA5252/high-importance.png\" alt=\"Errore\" style=\"width: 64px; margin-bottom: 16px;\" />
                    <h2 style=\"color: #d32f2f; margin-bottom: 8px;\">Errore durante il caricamento</h2>
                </div>
                <p style=\"font-size: 18px; color: #333;\">
                    Si è verificato un errore durante il caricamento del comune <b style=\"color: #d32f2f;\">${nomeComune}</b>.
                </p>
                ${errore ? `<div style=\"background: #ffebee; border-radius: 8px; padding: 16px; margin: 24px 0; color: #b71c1c;\"><b>Dettagli errore:</b><br><span style=\"font-size: 15px;\">${errore}</span></div>` : ''}
                <p style=\"color: #666; font-size: 15px; margin-top: 32px;\">
                    Ti invitiamo a riprovare o a contattare l'assistenza se il problema persiste.<br>
                    <span style=\"font-size: 13px; color: #aaa;\">Questa è una notifica automatica, si prega di non rispondere a questa email.</span>
                </p>
            </div>
        </div>
    `;
}

function returnHtmlUserValidated(user, user_type) {
    let htmlEmail = emailTemplateUserValidated.replace(/NOME/g, user.name);
    const menu = generateMenu(user_type);
    const userTypeOptions = [
    { value: "SUPER_ADMIN", label: "super admin" },
    { value: "ADMINISTRATOR", label: "amministratore" },
    { value: "MAINTAINER", label: "manutentore" },
    { value: "DEFAULT_USER", label: "utente standard" }
  ];
  const mappedUserType = userTypeOptions.find(option => option.value === user_type);
    htmlEmail = htmlEmail.replace(/USER_TYPE/g, mappedUserType.label);
    htmlEmail = htmlEmail.replace(/MENU_DINAMICO/g, menu);
    return htmlEmail;
}


function generateMenu(userType){
    let menu = `
        <ul>
    `;
    if(userType === 'MAINTAINER'){
        menu += `
            <li>Visualizzare punti luce, statistiche e report sullo stato dell'impianto</li>
            <li>Scaricare report in formato CSV</li>
            <li>Risolvere guasti segnalati sugli impianti</li>
            
        `;
    }else if(userType === 'DEFAULT_USER'){
        menu += `
            <li>Visualizzare punti luce, statistiche e report sullo stato dell'impianto</li>
            <li>Scaricare report in formato CSV</li>
        `;
    }else if(userType === 'ADMINISTRATOR'){
        menu += `
            <li>Visualizzare punti luce, statistiche e report sullo stato dell'impianto</li>
            <li>Scaricare report in formato CSV</li>
            <li>Segnalare guasti sugli impianti</li>
        `;
    }
    if(userType === 'SUPER_ADMIN'){
        menu += `
            <li>Visualizzare punti luce, statistiche e report sullo stato dell'impianto</li>
            <li>Scaricare report in formato CSV</li>
            <li>Segnalare guasti sugli impianti</li>
            <li>Risolvere guasti segnalati sugli impianti</li>
            <li>Amministrare i comuni e gli utenti tramite piattaforma dedicata</li>
            <li>Creare, eliminare e modificare punti luce</li>
        `;
    }
    menu += `</ul>`;
    return menu;
}



function formatDate(isoString) {
    let data = new Date(isoString);
    return data.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'long', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
    });
}


const jwt = require('jsonwebtoken');
const { transporter, emailLighting, debugMail } = require('../config/email');

// In-memory rate limiter: max 1 invii/5min per email
const confirmationEmailRate = {};
const RATE_LIMIT_MAX = 1;
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minuti

async function sendConfirmationEmail(user) {
    if (!user || !user.email) throw new Error('Utente non valido');
    const now = Date.now();
    const email = user.email;
    if (!confirmationEmailRate[email]) confirmationEmailRate[email] = [];
    // Rimuovi invii più vecchi diel ratelimit
    confirmationEmailRate[email] = confirmationEmailRate[email].filter(ts => now - ts < RATE_LIMIT_WINDOW);
    if (confirmationEmailRate[email].length >= RATE_LIMIT_MAX) {
        throw new Error('Hai raggiunto il limite di invii di mail di conferma per questa email. Riprova più tardi.');
    }
    confirmationEmailRate[email].push(now);

    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1d' });
    const confirmUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/confirm-email?token=${token}`;
    const html = returnHtmlConfirmEmail(user, confirmUrl);
    try {
        await transporter.sendMail({
            from: `LIGHTING MAP - Conferma Email <${emailLighting}>`,
            to: user.email,
            subject: 'Conferma il tuo indirizzo email',
            html,
            attachments: [
                {
                    filename: 'image-1.gif',
                    path: './email/confirmEmail/images/image-1.gif',
                    cid: 'image1' 
                },
                {
                    filename: 'image-2.png',
                    path: './email/confirmEmail/images/image-2.png',
                    cid: 'image2' 
                },
                {
                    filename: 'image-3.png',
                    path: './email/confirmEmail/images/image-3.png',
                    cid: 'image3' 
                },
                {
                    filename: 'image-4.png',
                    path: './email/confirmEmail/images/image-4.png',
                    cid: 'image4' 
                }
            ]
        });
    } catch (e) {
        debugMail(e);
        // Rimuovi il timestamp se invio fallisce
        confirmationEmailRate[email].pop();
        throw e;
    }
}

async function sendResetPasswordEmail(user, resetUrl) {
    const { transporter, emailLighting, debugMail } = require('../config/email');
    const html = returnHtmlResetPassword(user, resetUrl);
    try {
        await transporter.sendMail({
            from: `LIGHTING MAP - Reset Password <${emailLighting}>`,
            to: user.email,
            subject: 'Reset della password',
            html, 
            attachments: [
                {
                    filename: 'image-1.png',
                    path: './email/resetPassword/images/image-1.png',
                    cid: 'image1' 
                },
                {
                    filename: 'image-2.gif',
                    path: './email/resetPassword/images/image-2.gif',
                    cid: 'image2' 
                },
                {
                    filename: 'image-3.png',
                    path: './email/resetPassword/images/image-3.png',
                    cid: 'image3' 
                },
                {
                    filename: 'image-4.png',
                    path: './email/resetPassword/images/image-4.png',
                    cid: 'image4' 
                },
                {
                    filename: 'image-5.png',
                    path: './email/resetPassword/images/image-5.png',
                    cid: 'image5' 
                }
            ]
        });
    } catch (e) {
        debugMail(e);
        throw e;
    }
}

module.exports = {
    returnHtmlEmail,
    returnHtmlEmailAdmin,
    returnHtmlEmailAfterReport,
    returnHtmlEmailAfterOperation,
    returnHtmlEmailUploadSuccess,
    returnHtmlEmailUploadError,
    returnHtmlUserValidated,
    formatDate,
    sendConfirmationEmail,
    sendResetPasswordEmail,
    returnHtmlResetPassword
};