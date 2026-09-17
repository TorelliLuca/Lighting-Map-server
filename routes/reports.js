const express = require('express');
const XLSX = require('xlsx');
const townHalls = require('../schemas/townHalls');
const reports = require('../schemas/reports');
const light_points = require('../schemas/lightPoints');
const users = require('../schemas/users');
const quotes = require('../schemas/quotes');
const { getAllPuntiLuce } = require('../utils/lightPointHelpers');
const logAccess = require('../utils/accessLogger');
const { STAFF_ROLES, requireRole, requireTownHallAccess, requireTownHallAccessByName, loadRequestUser } = require('../utils/roles');
const {
    resolvePlantContext,
    notifyReportCreated,
    transitionReportStatus,
    assertFaultLabelForMarker,
} = require('../utils/reportHelpers');
const { appendStatusHistory } = require('../utils/statusHistory');
const router = express.Router();

const ADMIN_ROLES = new Set(['ADMINISTRATOR', 'SUPER_ADMIN']);

router.post('/addReport', async (req, res) => {
    try {
        const th = await requireTownHallAccessByName(req, res, req.body.name);
        if (!th) return;

        const townHall = await townHalls.findById(th._id);
        if (!townHall) {
            return res.status(404).send('Comune non trovato');
        }

        const puntiLuce = await getAllPuntiLuce(townHall.punti_luce);
        const puntoLuce = puntiLuce.find((punto) => punto && punto.numero_palo === req.body.numero_palo);

        if (!puntoLuce) {
            return res.status(404).send('Punto luce non trovato');
        }

        const creator = req.body.user_creator_id
            ? await users.findById(req.body.user_creator_id).select('name surname email user_type cell')
            : await loadRequestUser(req);

        const isAdminReport = ADMIN_ROLES.has(creator?.user_type);
        const faultLabel = req.body.fault_label || null;
        const riskClass = req.body.risk_class || null;
        // Con fault_label (capitolato) usiamo quel codice come report_type;
        // altrimenti resta il valore legacy inviato dal client.
        const reportType = faultLabel || req.body.report_type || 'LIGHT_POINT_OFF';

        if (faultLabel) {
            const check = await assertFaultLabelForMarker({
                townHallId: townHall._id,
                faultLabel,
                marker: puntoLuce.marker,
            });
            if (!check.ok) {
                return res.status(400).json({ error: check.error });
            }
        }

        const plantContext = await resolvePlantContext(puntoLuce, townHall);

        const reportPayload = {
            operation_point_id: puntoLuce._id,
            report_type: reportType,
            description: req.body.description || '',
            report_date: req.body.date || new Date(),
            user_creator_id: req.body.user_creator_id || creator?._id,
            maintenance_category: req.body.maintenance_category || 'ORDINARY',
            fault_label: faultLabel,
            risk_class: riskClass,
            plant_context: plantContext,
            town_hall_id: townHall._id,
        };

        if (isAdminReport && faultLabel && riskClass) {
            reportPayload.workflow_status = 'CLASSIFICATION_PENDING';
            reportPayload.classification = {
                status: 'PROVISIONAL',
                proposedBy: creator._id,
                proposedAt: new Date(),
            };
        } else {
            reportPayload.workflow_status = 'OPEN';
        }

        const nuovaSegnalazione = new reports(reportPayload);
        appendStatusHistory(nuovaSegnalazione, {
            status: nuovaSegnalazione.workflow_status,
            by: creator?._id,
            note: isAdminReport && faultLabel && riskClass
                ? 'Classificazione provvisoria admin'
                : 'Segnalazione aperta',
        });

        puntoLuce.segnalazioni_in_corso.push(nuovaSegnalazione);
        await nuovaSegnalazione.save();
        await light_points.updateOne(
            { _id: puntoLuce._id },
            { $set: { segnalazioni_in_corso: puntoLuce.segnalazioni_in_corso } }
        );

        await notifyReportCreated({
            townHallName: req.body.name,
            lightPoint: puntoLuce,
            report: nuovaSegnalazione,
            creatorUser: creator,
        }).catch((err) => console.error('notifyReportCreated:', err));

        await logAccess({
            user: req.user ? req.user._id : null,
            action: 'ADD_REPORT',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Report creato con id: ${nuovaSegnalazione._id}`,
        });

        return res.json({
            message: 'Segnalazione aggiunta con successo',
            report: nuovaSegnalazione,
        });
    } catch (error) {
        await logAccess({
            user: req.user ? req.user._id : null,
            action: 'ADD_REPORT',
            resource: req.originalUrl,
            outcome: 'FAILURE',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Errore: ${error.message}`,
        });
        console.error(error);
        return res.status(500).send('Errore del server');
    }
});

router.get('/api/reports/active', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const { townHallName, maintenance_category: category, workflow_status: statusFilter } = req.query;
        if (!townHallName) {
            return res.status(400).json({ error: 'townHallName obbligatorio' });
        }

        const th = await townHalls.findOne({ name: { $eq: townHallName } });
        if (!th) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallAccess(req, res, th._id))) return;

        const puntiLuce = await light_points.find({ _id: { $in: th.punti_luce } })
            .select('numero_palo marker indirizzo lat lng segnalazioni_in_corso')
            .populate({
                path: 'segnalazioni_in_corso',
                model: 'reports',
                populate: [
                    { path: 'user_creator_id', select: 'name surname email' },
                    {
                        path: 'linked_quote_id',
                        model: 'quotes',
                        select: 'protocolNumber status type total dueDate',
                    },
                ],
            });

        const results = [];
        for (const pl of puntiLuce) {
            for (const report of pl.segnalazioni_in_corso || []) {
                if (category && report.maintenance_category !== category) continue;
                if (statusFilter && report.workflow_status !== statusFilter) continue;
                results.push({
                    report,
                    lightPoint: {
                        _id: pl._id,
                        numero_palo: pl.numero_palo,
                        marker: pl.marker,
                        indirizzo: pl.indirizzo,
                        lat: pl.lat,
                        lng: pl.lng,
                    },
                });
            }
        }

        return res.json(results);
    } catch (error) {
        console.error('Errore GET active reports:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// GET /api/reports/extraordinary — lista straordinarie aperte (filtri scadenza/stato/classe)
router.get('/api/reports/extraordinary', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const {
            townHallName,
            townHallId,
            risk_class: riskClass,
            workflow_status: statusFilter,
            due: dueFilter,
        } = req.query;

        let thFilter = null;
        if (townHallId) {
            if (!(await requireTownHallAccess(req, res, townHallId))) return;
            thFilter = { _id: townHallId };
        } else if (townHallName) {
            const th = await townHalls.findOne({ name: { $eq: townHallName } });
            if (!th) {
                return res.status(404).json({ error: 'Comune non trovato' });
            }
            if (!(await requireTownHallAccess(req, res, th._id))) return;
            thFilter = { _id: th._id };
        } else if (!req.currentUser || req.currentUser.user_type !== 'SUPER_ADMIN') {
            thFilter = { _id: { $in: req.currentUser.town_halls_list || [] } };
        }

        const thList = await townHalls.find(thFilter || {})
            .select('_id name punti_luce');

        const now = new Date();
        const soonLimit = new Date(now);
        soonLimit.setDate(soonLimit.getDate() + 3);

        const results = [];
        for (const th of thList) {
            if (!th.punti_luce?.length) continue;
            const puntiLuce = await light_points.find({ _id: { $in: th.punti_luce } })
                .select('numero_palo marker indirizzo lat lng segnalazioni_in_corso')
                .populate({
                    path: 'segnalazioni_in_corso',
                    model: 'reports',
                    match: { maintenance_category: 'EXTRAORDINARY', is_solved: { $ne: true } },
                    populate: [
                        { path: 'user_creator_id', select: 'name surname email' },
                        { path: 'linked_quote_id', select: 'protocolNumber status type total dueDate' },
                    ],
                });

            for (const pl of puntiLuce) {
                for (const report of pl.segnalazioni_in_corso || []) {
                    if (riskClass && report.risk_class !== riskClass) continue;
                    if (statusFilter && report.workflow_status !== statusFilter) continue;

                    const dueDate = report.due_date ? new Date(report.due_date) : null;
                    let dueStatus = 'none';
                    let daysRemaining = null;
                    if (dueDate && !Number.isNaN(dueDate.getTime())) {
                        daysRemaining = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
                        if (dueDate < now) dueStatus = 'overdue';
                        else if (dueDate <= soonLimit) dueStatus = 'soon';
                        else dueStatus = 'ok';
                    }

                    if (dueFilter === 'overdue' && dueStatus !== 'overdue') continue;
                    if (dueFilter === 'soon' && dueStatus !== 'soon') continue;
                    if (dueFilter === 'ok' && dueStatus !== 'ok') continue;

                    results.push({
                        report,
                        lightPoint: {
                            _id: pl._id,
                            numero_palo: pl.numero_palo,
                            marker: pl.marker,
                            indirizzo: pl.indirizzo,
                            lat: pl.lat,
                            lng: pl.lng,
                        },
                        townHall: { _id: th._id, name: th.name },
                        dueStatus,
                        daysRemaining,
                    });
                }
            }
        }

        results.sort((a, b) => {
            const da = a.report.due_date ? new Date(a.report.due_date).getTime() : Infinity;
            const db = b.report.due_date ? new Date(b.report.due_date).getTime() : Infinity;
            return da - db;
        });

        return res.json(results);
    } catch (error) {
        console.error('Errore GET extraordinary reports:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// GET /api/reports/resolved-for-quote — segnalazioni aperte che richiedono preventivo IMS,
// senza preventivo già associato (esito sopralluogo REQUIRES_QUOTE / PENDING_QUOTE).
router.get('/api/reports/resolved-for-quote', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const { townHallName } = req.query;
        if (!townHallName) {
            return res.status(400).json({ error: 'townHallName obbligatorio' });
        }

        const th = await townHalls.findOne({ name: { $eq: townHallName } });
        if (!th) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallAccess(req, res, th._id))) return;

        const quotesModel = quotes;
        const ACTIVE_QUOTE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'NEEDS_REVISION', 'APPROVED', 'REJECTED'];
        const puntiLuce = await light_points.find({ _id: { $in: th.punti_luce } })
            .select('numero_palo marker indirizzo lat lng segnalazioni_in_corso')
            .populate({
                path: 'segnalazioni_in_corso',
                model: 'reports',
                match: {
                    is_solved: { $ne: true },
                    workflow_status: 'PENDING_QUOTE',
                },
                options: { sort: { report_date: -1 } },
            });

        const candidates = [];
        for (const pl of puntiLuce) {
            for (const report of pl.segnalazioni_in_corso || []) {
                if (!report || report.is_solved) continue;
                if (report.workflow_status !== 'PENDING_QUOTE') continue;
                candidates.push({ pl, report });
            }
        }

        const reportIds = candidates.map(({ report }) => report._id);
        const existingQuotes = reportIds.length
            ? await quotesModel.find({
                reportId: { $in: reportIds },
                type: 'QUOTE',
                status: { $in: ACTIVE_QUOTE_STATUSES },
            }).select('_id status reportId')
            : [];
        const quoteByReportId = new Map(
            existingQuotes.map((q) => [String(q.reportId), q])
        );

        const results = [];
        for (const { pl, report } of candidates) {
            if (report.linked_quote_id) continue;
            const activeQuote = quoteByReportId.get(String(report._id));
            if (activeQuote) continue;

            results.push({
                report,
                lightPoint: {
                    _id: pl._id,
                    numero_palo: pl.numero_palo,
                    marker: pl.marker,
                    indirizzo: pl.indirizzo,
                    lat: pl.lat,
                    lng: pl.lng,
                },
                hasActiveQuote: false,
                activeQuoteId: null,
                activeQuoteStatus: null,
            });
        }

        results.sort((a, b) => {
            const da = a.report.report_date ? new Date(a.report.report_date).getTime() : 0;
            const db = b.report.report_date ? new Date(b.report.report_date).getTime() : 0;
            return db - da;
        });

        return res.json(results.slice(0, 300));
    } catch (error) {
        console.error('Errore GET resolved-for-quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.get('/api/reports/:id', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const report = await reports.findById(req.params.id)
            .populate('user_creator_id', 'name surname email')
            .populate('user_responsible_id', 'name surname email');
        if (!report) {
            return res.status(404).json({ error: 'Segnalazione non trovata' });
        }
        if (report.town_hall_id) {
            if (!(await requireTownHallAccess(req, res, report.town_hall_id))) return;
        }
        return res.json(report);
    } catch (error) {
        console.error('Errore GET report:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.patch('/api/reports/:id/classification', requireRole('MAINTAINER', 'SUPER_ADMIN', 'ADMINISTRATOR'), async (req, res) => {
    try {
        const { risk_class, fault_label } = req.body || {};
        const report = await reports.findById(req.params.id);
        if (!report || report.is_solved) {
            return res.status(404).json({ error: 'Segnalazione non trovata o già chiusa' });
        }
        if (report.town_hall_id) {
            if (!(await requireTownHallAccess(req, res, report.town_hall_id))) return;
        }

        const userId = req.currentUser?._id || req.user?.id;
        const previousRisk = report.risk_class;
        const previousFault = report.fault_label;
        const modified = (risk_class && risk_class !== previousRisk) || (fault_label && fault_label !== previousFault);

        if (risk_class) report.risk_class = risk_class;
        if (fault_label) {
            report.fault_label = fault_label;
            report.report_type = fault_label;
        }

        report.classification = report.classification || {};
        report.classification.status = modified ? 'MODIFIED' : 'CONFIRMED';
        report.classification.confirmedBy = userId;
        report.classification.confirmedAt = new Date();
        if (modified) {
            report.classification.previousRiskClass = previousRisk;
            report.classification.previousFaultLabel = previousFault;
        }

        if (report.workflow_status === 'CLASSIFICATION_PENDING') {
            transitionReportStatus(report, 'OPEN', userId, 'Classificazione confermata');
        }

        await report.save();
        return res.json(report);
    } catch (error) {
        console.error('Errore PATCH classification:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/api/downloadExcelReport', function (req, res) {
    const jsonData = req.body;
    const workbook = XLSX.utils.book_new();

    const segnalazioniInCorsoWS = XLSX.utils.json_to_sheet(jsonData.segnalazioni_in_corso);
    XLSX.utils.book_append_sheet(workbook, segnalazioniInCorsoWS, 'Segnalazioni In Corso');

    const segnalazioniRisolteWS = XLSX.utils.json_to_sheet(jsonData.segnalazioni_risolte);
    XLSX.utils.book_append_sheet(workbook, segnalazioniRisolteWS, 'Segnalazioni Risolte');

    const operazioniEffettuateWS = XLSX.utils.json_to_sheet(jsonData.operazioni_effettuate);
    XLSX.utils.book_append_sheet(workbook, operazioniEffettuateWS, 'Operazioni Effettuate');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.set({
        'Content-Disposition': 'attachment; filename="output.xlsx"',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    res.send(buffer);
});

module.exports = router;
