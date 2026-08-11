const express = require('express');
const mongoose = require('mongoose');
const inspections = require('../schemas/inspections');
const reports = require('../schemas/reports');
const operations = require('../schemas/operations');
const quotes = require('../schemas/quotes');
const light_points = require('../schemas/lightPoints');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const MaintenanceConfig = require('../schemas/maintenanceConfig');
const { getAllPuntiLuce } = require('../utils/lightPointHelpers');
const { STAFF_ROLES, requireRole, requireTownHallAccess } = require('../utils/roles');
const { transitionReportStatus, resolvePlantContext } = require('../utils/reportHelpers');
const { appendStatusHistory } = require('../utils/statusHistory');
const {
    createNotifications,
    notifyTownHallStaff,
    safeNotify,
    buildLightPointDashboardUrl,
} = require('../utils/notificationHelpers');
const { sendConfiguredEmail } = require('../utils/mailEngine');
const { computeQuoteTotals } = require('../utils/quoteDocuments');
const logAccess = require('../utils/accessLogger');

const router = express.Router();

async function findLightPointInTownHall(townHallName, numeroPalo) {
    const th = await townHalls.findOne({ name: { $eq: townHallName } });
    if (!th) return { error: { status: 404, message: 'Comune non trovato' } };

    const puntiLuce = await getAllPuntiLuce(th.punti_luce);
    const puntoLuce = puntiLuce.find((p) => p && p.numero_palo === numeroPalo);
    if (!puntoLuce) {
        return { error: { status: 404, message: 'Punto luce non trovato' } };
    }
    return { th, puntoLuce };
}

router.post('/', requireRole('MAINTAINER', 'SUPER_ADMIN', 'ADMINISTRATOR'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const {
            name,
            numero_palo,
            report_id,
            outcome,
            risk_class,
            fault_label,
            report_type,
            suspension_reason,
            suspension_days,
            notes,
        } = req.body || {};

        if (!name || !numero_palo || !report_id || !outcome) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'name, numero_palo, report_id e outcome sono obbligatori' });
        }

        const lookup = await findLightPointInTownHall(name, numero_palo);
        if (lookup.error) {
            await session.abortTransaction();
            session.endSession();
            return res.status(lookup.error.status).json({ error: lookup.error.message });
        }

        const { th, puntoLuce } = lookup;
        if (!(await requireTownHallAccess(req, res, th._id))) {
            await session.abortTransaction();
            session.endSession();
            return;
        }

        const inspector = await users.findById(req.currentUser._id).session(session);
        if (!inspector) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        const puntoLuceDoc = await light_points.findById(puntoLuce._id).populate('segnalazioni_in_corso');
        if (!puntoLuceDoc) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Punto luce non trovato' });
        }

        const report = (puntoLuceDoc.segnalazioni_in_corso || []).find(
            (item) => String(item._id) === String(report_id)
        );
        if (!report) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Segnalazione non trovata o già chiusa' });
        }

        if (report.maintenance_category === 'EXTRAORDINARY') {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'Il sopralluogo ordinario non è applicabile a segnalazioni straordinarie' });
        }

        const inspectableStatuses = new Set(['OPEN', 'CLASSIFICATION_PENDING']);
        const currentStatus = report.workflow_status || 'OPEN';
        if (!inspectableStatuses.has(currentStatus)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'Sopralluogo già effettuato per questa segnalazione' });
        }

        const existingInspection = await inspections.findOne({ reportId: report._id }).session(session);
        if (existingInspection) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ error: 'Esiste già un sopralluogo per questa segnalazione' });
        }

        const previousRisk = report.risk_class;
        const previousFault = report.fault_label;
        const classificationModified =
            (risk_class && risk_class !== report.risk_class)
            || (fault_label && fault_label !== report.fault_label);

        if (risk_class) report.risk_class = risk_class;
        if (fault_label) {
            report.fault_label = fault_label;
            // Preferisci report_type esplicito, altrimenti il codice capitolato
            report.report_type = report_type || fault_label;
        } else if (report_type) {
            report.report_type = report_type;
        }

        report.classification = report.classification || {};
        report.classification.status = classificationModified ? 'MODIFIED' : 'CONFIRMED';
        report.classification.confirmedBy = inspector._id;
        report.classification.confirmedAt = new Date();
        if (classificationModified) {
            report.classification.previousRiskClass = previousRisk;
            report.classification.previousFaultLabel = previousFault;
        }

        let operationId = null;
        let childReportId = null;
        let quoteId = null;
        let redirectTo = '/dashboard';
        let askCompileQuote = false;

        if (outcome === 'RESOLVED') {
            const operation = new operations({
                operation_point_id: puntoLuce._id,
                operation_responsible: inspector._id,
                operation_type: 'FAULT_ELIMINATED_AND_SYSTEM_RESTORED',
                note: notes || '',
                report_to_solve: report._id,
                is_solved: true,
                maintenance_type: 'ORDINARY',
            });
            await operation.save({ session });
            operationId = operation._id;

            report.is_solved = true;
            report.user_responsible_id = inspector._id;
            transitionReportStatus(report, 'RESOLVED', inspector._id, notes || 'Risolto in sopralluogo');

            puntoLuceDoc.segnalazioni_in_corso.pull(report);
            puntoLuceDoc.segnalazioni_risolte.push(report);
            puntoLuceDoc.operazioni_effettuate.push(operation);
        } else if (outcome === 'SUSPENDED') {
            if (!suspension_reason?.trim()) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ error: 'Motivo sospensione obbligatorio' });
            }
            const suspensionDays = Number(suspension_days);
            if (!Number.isFinite(suspensionDays) || suspensionDays < 1) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ error: 'Indicare i giorni di sospensione (minimo 1)' });
            }
            report.suspension = {
                reason: suspension_reason.trim(),
                days: Math.floor(suspensionDays),
                suspendedAt: new Date(),
                suspendedBy: inspector._id,
            };
            transitionReportStatus(
                report,
                'SUSPENDED',
                inspector._id,
                `${suspension_reason.trim()} (${Math.floor(suspensionDays)} giorni)`
            );
        } else if (outcome === 'SCHEDULED') {
            // Scadenza dai termini capitolato: giorni materiale + giorni opera
            const config = await MaintenanceConfig.findOne({ townHallId: th._id, status: 'active' }).session(session);
            const riskCode = report.risk_class || 'C';
            const riskCfg = (config?.riskClasses || []).find((r) => r.code === riskCode);
            const materialDays = Number(riskCfg?.defaultMaterialDays) || 0;
            const workDays = Number(riskCfg?.defaultWorkDays) || 0;
            const leadDays = materialDays + workDays;
            if (leadDays < 1) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    error: `Termini capitolato non configurati per la classe ${riskCode}`,
                });
            }
            const scheduled = new Date();
            scheduled.setHours(0, 0, 0, 0);
            scheduled.setDate(scheduled.getDate() + leadDays);
            report.scheduled_resolution_date = scheduled;
            transitionReportStatus(
                report,
                'SCHEDULED',
                inspector._id,
                notes || `Risoluzione differita — classe ${riskCode}, ${leadDays} giorni (${materialDays} materiale + ${workDays} opera, capitolato)`
            );
        } else if (outcome === 'SAFE_PENDING_RESTORATION') {
            // 1) Messa in sicurezza + chiusura segnalazione ordinaria
            const safeOperation = new operations({
                operation_point_id: puntoLuce._id,
                operation_responsible: inspector._id,
                operation_type: 'MADE_SAFE_BUT_SYSTEM_NEEDS_RESTORING',
                note: notes || '',
                report_to_solve: report._id,
                is_solved: true,
                maintenance_type: 'ORDINARY',
            });
            await safeOperation.save({ session });
            operationId = safeOperation._id;
            puntoLuceDoc.operazioni_effettuate.push(safeOperation);

            report.is_solved = true;
            report.user_responsible_id = inspector._id;
            transitionReportStatus(
                report,
                'RESOLVED',
                inspector._id,
                notes || 'Messa in sicurezza — segnalazione chiusa, preventivo IMS in bozza'
            );
            puntoLuceDoc.segnalazioni_in_corso.pull(report);
            puntoLuceDoc.segnalazioni_risolte.push(report);

            // 2) Segnalazione straordinaria in attesa preventivo (per ripristino successivo)
            const plantContext = await resolvePlantContext(puntoLuce, th);
            const extraordinaryReport = new reports({
                operation_point_id: puntoLuce._id,
                user_creator_id: inspector._id,
                report_type: report.report_type,
                description: report.description || 'Escalation da manutenzione ordinaria (messa in sicurezza)',
                report_date: new Date(),
                maintenance_category: 'EXTRAORDINARY',
                workflow_status: 'PENDING_QUOTE',
                risk_class: report.risk_class,
                fault_label: report.fault_label,
                parent_report_id: report._id,
                plant_context: plantContext,
                town_hall_id: th._id,
            });
            appendStatusHistory(extraordinaryReport, {
                status: 'PENDING_QUOTE',
                by: inspector._id,
                note: 'Creata da sopralluogo — messa in sicurezza con richiesta preventivo',
            });
            await extraordinaryReport.save({ session });
            childReportId = extraordinaryReport._id;
            puntoLuceDoc.segnalazioni_in_corso.push(extraordinaryReport);

            // 3) Bozza IMS collegata (compilabile subito o in seguito)
            const config = await MaintenanceConfig.findOne({ townHallId: th._id, status: 'active' }).session(session);
            const riskCode = report.risk_class || 'C';
            const riskCfg = (config?.riskClasses || []).find((r) => r.code === riskCode);
            const totals = computeQuoteTotals([], 0.02, 0);

            const quote = new quotes({
                type: 'QUOTE',
                townHallId: th._id,
                lightPointId: puntoLuceDoc._id,
                reportId: extraordinaryReport._id,
                createdBy: inspector._id,
                assignedMaintainer: inspector._id,
                status: 'DRAFT',
                priorityClass: riskCode,
                materialLeadDays: riskCfg?.defaultMaterialDays ?? 0,
                workLeadDays: riskCfg?.defaultWorkDays ?? 0,
                faultDescription: report.description || '',
                notes: notes || '',
                lineItems: [],
                subtotal: totals.subtotal,
                total: totals.total,
                safetyChargeRate: totals.safetyChargeRate,
                discountPercent: totals.discountPercent,
            });
            appendStatusHistory(quote, {
                status: 'DRAFT',
                by: inspector._id,
                note: 'Bozza creata automaticamente da sopralluogo (messa in sicurezza)',
            });
            await quote.save({ session });

            extraordinaryReport.linked_quote_id = quote._id;
            await extraordinaryReport.save({ session });
            report.linked_quote_id = quote._id;

            quoteId = quote._id;
            askCompileQuote = true;
            redirectTo = `/quote/${quote._id}`;
        } else if (outcome === 'REQUIRES_QUOTE') {
            report.maintenance_category = 'EXTRAORDINARY';
            transitionReportStatus(
                report,
                'PENDING_QUOTE',
                inspector._id,
                notes || 'Richiesto preventivo IMS'
            );
            redirectTo = `/quote?comune=${encodeURIComponent(name)}&id=${puntoLuceDoc._id}&reportId=${report._id}`;
        } else {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'Esito sopralluogo non valido' });
        }

        await report.save({ session });

        const inspection = new inspections({
            reportId: report._id,
            lightPointId: puntoLuceDoc._id,
            townHallId: th._id,
            inspectorId: inspector._id,
            outcome,
            riskClassConfirmed: report.risk_class,
            faultLabelConfirmed: report.fault_label,
            classificationModified,
            suspensionReason: suspension_reason || '',
            suspensionDays: outcome === 'SUSPENDED' ? Math.floor(Number(suspension_days)) : null,
            scheduledDate: report.scheduled_resolution_date || null,
            notes: notes || '',
            operationId,
            childReportId,
        });
        await inspection.save({ session });

        await light_points.updateOne(
            { _id: puntoLuceDoc._id },
            {
                $set: {
                    segnalazioni_in_corso: puntoLuceDoc.segnalazioni_in_corso,
                    segnalazioni_risolte: puntoLuceDoc.segnalazioni_risolte,
                    operazioni_effettuate: puntoLuceDoc.operazioni_effettuate,
                },
            },
            { session }
        );

        await session.commitTransaction();
        session.endSession();

        const dashboardUrl = buildLightPointDashboardUrl({
            townHallName: name,
            numeroPalo: numero_palo,
            lat: puntoLuceDoc.lat,
            lng: puntoLuceDoc.lng,
        });
        const plMeta = {
            townHallName: name,
            numeroPalo: numero_palo,
            lat: puntoLuceDoc.lat || null,
            lng: puntoLuceDoc.lng || null,
            reportId: String(report._id),
        };

        await safeNotify(() =>
            notifyTownHallStaff(name, {
                title: `Sopralluogo completato — ${numero_palo}`,
                body: `Esito: ${outcome}${notes ? ` — ${notes}` : ''}`,
                type: 'INSPECTION_COMPLETED',
                url: dashboardUrl,
                meta: { ...plMeta, outcome },
            })
        );

        try {
            await sendConfiguredEmail('INSPECTION_COMPLETED', {
                townHallName: name,
                vars: {
                    nome_comune: name,
                    numero_palo,
                    esito: outcome || '',
                    nota: notes || '',
                },
            });
        } catch (mailErr) {
            console.error('[mail] INSPECTION_COMPLETED:', mailErr.message || mailErr);
        }

        if (report.user_creator_id && classificationModified) {
            await safeNotify(() =>
                createNotifications([report.user_creator_id], {
                    title: 'Classificazione segnalazione aggiornata',
                    body: `Il manutentore ha modificato la classificazione sul punto ${numero_palo}.`,
                    type: 'CLASSIFICATION_CONFIRMED',
                    url: dashboardUrl,
                    meta: plMeta,
                })
            );
            try {
                await sendConfiguredEmail('CLASSIFICATION_CONFIRMED', {
                    townHallName: name,
                    creatorUserId: report.user_creator_id,
                    recipientUserIds: [report.user_creator_id],
                    vars: {
                        nome_comune: name,
                        numero_palo,
                    },
                });
            } catch (mailErr) {
                console.error('[mail] CLASSIFICATION_CONFIRMED:', mailErr.message || mailErr);
            }
        }

        await logAccess({
            user: req.user ? req.user._id : null,
            action: 'ADD_INSPECTION',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Inspection ${inspection._id} outcome=${outcome}`,
        });

        return res.status(201).json({
            message: 'Sopralluogo registrato',
            inspection,
            report,
            operationId,
            childReportId,
            quoteId,
            askCompileQuote,
            redirectTo,
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Errore POST inspection:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.get('/report/:reportId', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const report = await reports.findById(req.params.reportId)
            .populate('user_creator_id', 'name surname email')
            .populate('user_responsible_id', 'name surname email');
        if (!report) {
            return res.status(404).json({ error: 'Segnalazione non trovata' });
        }
        return res.json(report);
    } catch (error) {
        console.error('Errore GET inspection report:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

module.exports = router;
