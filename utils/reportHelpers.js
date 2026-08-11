const lightPoints = require('../schemas/lightPoints');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const { createNotifications, safeNotify, buildLightPointDashboardUrl } = require('./notificationHelpers');
const { sendConfiguredEmail } = require('./mailEngine');
const { appendStatusHistory } = require('./statusHistory');

const FAULT_LABEL_TO_REPORT_TYPE = {
    IMMEDIATE_DANGER: 'LIGHT_POINT_OFF',
    PLANT_OFF: 'PLANT_OFF',
    MULTIPLE_OFF: 'LIGHT_POINT_OFF',
    SINGLE_OFF: 'LIGHT_POINT_OFF',
    NON_URGENT: 'OTHER',
};

const FAULT_LABEL_LABELS = {
    IMMEDIATE_DANGER: 'Pericolo immediato per la pubblica incolumità',
    PLANT_OFF: 'Strada al buio / intera cabina spenta',
    MULTIPLE_OFF: 'Tre o più punti luce spenti nello stesso tratto',
    SINGLE_OFF: 'Punto luce singolo spento',
    NON_URGENT: 'Anomalia non urgente',
};

function mapFaultLabelToReportType(faultLabel, fallback = 'LIGHT_POINT_OFF') {
    return FAULT_LABEL_TO_REPORT_TYPE[faultLabel] || fallback;
}

function getFaultLabelDisplay(faultLabel, reportType) {
    if (faultLabel && FAULT_LABEL_LABELS[faultLabel]) {
        return FAULT_LABEL_LABELS[faultLabel];
    }
    const legacy = {
        LIGHT_POINT_OFF: 'Punto luce spento',
        PLANT_OFF: 'Impianto spento',
        DAMAGED_COMPLEX: 'Complesso danneggiato',
        DAMAGED_SUPPORT: 'Morsettiera rotta',
        BROKEN_TERMINAL_BLOCK: 'Sostegno danneggiato',
        BROKEN_PANEL: 'Quadro danneggiato',
        OTHER: 'Altro',
    };
    return legacy[reportType] || reportType || 'Guasto';
}

async function resolvePlantContext(puntoLuce, townHallDoc) {
    if (!puntoLuce) {
        return { quadroId: null, quadroLabel: '' };
    }

    if (puntoLuce.marker === 'QE') {
        return {
            quadroId: puntoLuce._id,
            quadroLabel: puntoLuce.numero_palo || puntoLuce.quadro || '',
        };
    }

    const quadroLabel = puntoLuce.quadro || '';
    let quadroId = null;

    if (townHallDoc?.punti_luce?.length) {
        const qe = await lightPoints.findOne({
            _id: { $in: townHallDoc.punti_luce },
            marker: 'QE',
            quadro: quadroLabel,
        }).select('_id numero_palo quadro');

        if (qe) {
            quadroId = qe._id;
        }
    }

    return {
        quadroId,
        quadroLabel: quadroLabel || '',
    };
}

async function notifyReportCreated({
    townHallName,
    lightPoint,
    report,
    creatorUser,
}) {
    const th = await townHalls.findOne({ name: { $eq: townHallName } }).select('_id');
    if (!th) return;

    const staff = await users.find({
        town_halls_list: th._id,
        user_type: { $in: ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'] },
    }).select('_id email name surname');

    const reportLabel = getFaultLabelDisplay(report.fault_label, report.report_type);
    const numeroPalo = lightPoint?.numero_palo || '';
    const dateLabel = new Date(report.report_date || Date.now()).toLocaleDateString('it-IT');
    const dashboardUrl = buildLightPointDashboardUrl({
        townHallName,
        numeroPalo,
        lat: lightPoint?.lat,
        lng: lightPoint?.lng,
    });

    await sendConfiguredEmail('REPORT_CREATED', {
        townHallId: th._id,
        townHallName,
        fromName: 'LIGHTING MAP - Segnalazione guasti',
        vars: {
            nome: creatorUser?.name || '',
            cognome: creatorUser?.surname || '',
            email: creatorUser?.email || '',
            data: dateLabel,
            nome_comune: townHallName,
            numero_palo: numeroPalo,
            indirizzo: lightPoint?.indirizzo || '',
            corpo_segnalazione: reportLabel,
            nota: report.description || '',
        },
    });

    await safeNotify(() =>
        createNotifications(
            staff.map((u) => u._id),
            {
                title: `Segnalazione su punto ${numeroPalo}`,
                body: `${reportLabel} — ${townHallName}${report.description ? `: ${report.description}` : ''}`,
                type: 'REPORT_CREATED',
                url: dashboardUrl,
                meta: {
                    townHallName,
                    numeroPalo,
                    lat: lightPoint?.lat || null,
                    lng: lightPoint?.lng || null,
                    reportId: String(report._id),
                    maintenanceCategory: report.maintenance_category,
                },
            }
        )
    );
}

function transitionReportStatus(report, status, userId, note = '') {
    report.workflow_status = status;
    appendStatusHistory(report, { status, by: userId, note });
}

module.exports = {
    FAULT_LABEL_TO_REPORT_TYPE,
    FAULT_LABEL_LABELS,
    mapFaultLabelToReportType,
    getFaultLabelDisplay,
    resolvePlantContext,
    notifyReportCreated,
    transitionReportStatus,
};
