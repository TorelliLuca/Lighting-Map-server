const emailTemplate = require('../emailBodies');
const emailTemplateAdmin = require('../email/toAdmin/htmlText');
const emailTemplateAfterReport = require('../email/afterReport/htmlText');
const emailTemplateAfterOperation = require('../email/afterOperation/htmlText');

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

module.exports = {
    returnHtmlEmail,
    returnHtmlEmailAdmin,
    returnHtmlEmailAfterReport,
    returnHtmlEmailAfterOperation,
    returnHtmlEmailUploadSuccess,
    returnHtmlEmailUploadError,
    formatDate
}; 