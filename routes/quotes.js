const express = require('express');
const mongoose = require('mongoose');
const quotes = require('../schemas/quotes');
const reports = require('../schemas/reports');
const light_points = require('../schemas/lightPoints');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const { findActiveConfig } = require('../utils/maintenanceConfigHelpers');
const { STAFF_ROLES, requireRole, requireTownHallAccess, isSuperAdmin, canAccessTownHall } = require('../utils/roles');
const { appendStatusHistory } = require('../utils/statusHistory');
const { transitionReportStatus, resolvePlantContext } = require('../utils/reportHelpers');
const { nextSequentialNumber } = require('../utils/sequentialNumbers');
const { computeQuoteTotals, fillImsWorkbook, toPdf, quoteDocumentCode } = require('../utils/quoteDocuments');
const { notifyUsersWithPush, safeNotify } = require('../utils/notificationHelpers');
const { sendConfiguredEmail } = require('../utils/mailEngine');
const logAccess = require('../utils/accessLogger');

const router = express.Router();

async function resolveTownHallName(townHallId) {
    if (!townHallId) return '';
    const th = await townHalls.findById(townHallId).select('name');
    return th?.name || '';
}

async function notifyQuoteEmail(actionKey, {
    townHallId,
    recipientUserIds,
    vars = {},
}) {
    try {
        const nome_comune = vars.nome_comune || await resolveTownHallName(townHallId);
        await sendConfiguredEmail(actionKey, {
            townHallId,
            townHallName: nome_comune,
            recipientUserIds,
            vars: { ...vars, nome_comune },
        });
    } catch (err) {
        console.error(`[mail] ${actionKey}:`, err.message || err);
    }
}

function normalizeLineItems(items = [], previousItems = null) {
    return (items || []).map((item, index) => {
        const prev = Array.isArray(previousItems) ? previousItems[index] : null;
        const description = String(item.description || '').trim();
        const materialCode = item.materialCode || '';
        const sameAsPrev = Boolean(
            prev
            && (prev.materialCode || '') === materialCode
            && String(prev.description || '').trim() === description
        );

        let isContested = false;
        let contestNote = '';
        if (item.isContested !== undefined || item.contestNote !== undefined) {
            isContested = Boolean(item.isContested);
            contestNote = String(item.contestNote || '').trim();
        } else if (sameAsPrev) {
            isContested = Boolean(prev.isContested);
            contestNote = String(prev.contestNote || '').trim();
        }

        return {
            materialCode,
            description,
            udm: item.udm || 'cad',
            quantity: Number(item.quantity) || 0,
            unitPrice: Number(item.unitPrice) || 0,
            category: item.category || '',
            isAdHoc: Boolean(item.isAdHoc),
            isContested,
            contestNote: isContested ? contestNote : '',
        };
    }).filter((item) => item.description);
}

function clearLineItemContests(items = []) {
    return (items || []).map((item) => ({
        ...(item.toObject ? item.toObject() : item),
        isContested: false,
        contestNote: '',
    }));
}

function applyTotals(quoteDoc, lineItems, safetyChargeRate, discountPercent) {
    const totals = computeQuoteTotals(lineItems, safetyChargeRate, discountPercent);
    quoteDoc.lineItems = lineItems;
    quoteDoc.subtotal = totals.subtotal;
    quoteDoc.total = totals.total;
    quoteDoc.safetyChargeRate = totals.safetyChargeRate;
    quoteDoc.discountPercent = totals.discountPercent;
    return totals;
}

function getMinimumDiscountPercent(config) {
    const value = Number(config?.minDiscountPercent);
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
}

function withMinimumDiscount(discountPercent, minDiscountPercent) {
    const discount = Number(discountPercent);
    const normalizedDiscount = Number.isFinite(discount) ? discount : 0;
    return Math.min(100, Math.max(minDiscountPercent, normalizedDiscount));
}

const EDITABLE_QUOTE_STATUSES = ['DRAFT', 'REJECTED', 'NEEDS_REVISION'];

function isReturnedForRevision(status) {
    return status === 'REJECTED' || status === 'NEEDS_REVISION';
}

function parseContestedLines(rawContested = [], lineItems = []) {
    const contestedByIndex = new Map();
    for (const entry of rawContested) {
        const index = Number(entry?.index);
        if (!Number.isInteger(index) || index < 0 || index >= (lineItems?.length || 0)) {
            continue;
        }
        const note = String(entry?.note || '').trim();
        if (!note) {
            return { error: `Indicare il motivo di contestazione per la voce ${index + 1}` };
        }
        contestedByIndex.set(index, note);
    }
    return { contestedByIndex };
}

function applyContestedLineItems(quote, contestedByIndex) {
    quote.lineItems = (quote.lineItems || []).map((item, index) => {
        const plain = item.toObject ? item.toObject() : { ...item };
        if (contestedByIndex.has(index)) {
            return {
                ...plain,
                isContested: true,
                contestNote: contestedByIndex.get(index),
            };
        }
        return {
            ...plain,
            isContested: false,
            contestNote: '',
        };
    });
}

async function loadQuoteForAccess(req, res, quoteId) {
    if (!mongoose.Types.ObjectId.isValid(quoteId)) {
        res.status(400).json({ error: 'ID preventivo non valido' });
        return null;
    }
    const quote = await quotes.findById(quoteId);
    if (!quote) {
        res.status(404).json({ error: 'Preventivo non trovato' });
        return null;
    }
    if (!(await requireTownHallAccess(req, res, quote.townHallId))) return null;
    return quote;
}

async function getTownHallAdmins(townHallId) {
    return users.find({
        town_halls_list: townHallId,
        $or: [
            { user_type: 'SUPER_ADMIN' },
            { user_type: 'ADMINISTRATOR', sub_role: { $in: ['RUP', 'DEC'] } },
        ],
        is_approved: true,
    }).select('_id email name surname');
}

function canEditQuote(user, quote) {
    if (!user) return false;
    if (isSuperAdmin(user)) return true;
    // Solo i manutentori possono creare/modificare preventivi e consuntivi
    if (user.user_type === 'MAINTAINER' && canAccessTownHall(user, quote.townHallId)) return true;
    return false;
}

function canApproveQuote(user, quote) {
    if (!user) return false;
    if (isSuperAdmin(user)) return true;
    if (user.user_type !== 'ADMINISTRATOR') return false;
    if (!['RUP', 'DEC'].includes(user.sub_role || '')) return false;
    return canAccessTownHall(user, quote.townHallId);
}

function canSubmitQuote(user) {
    if (!user) return false;
    if (isSuperAdmin(user)) return true;
    if (user.user_type === 'MAINTAINER') {
        return user.sub_role === 'LEAD_MAINTAINER';
    }
    return false;
}

/** Gli amministratori (DEC/RUP) non devono vedere le bozze: solo in approvazione / già deciditi. */
function restrictQuoteListForAdmin(user, filter) {
    if (!user || isSuperAdmin(user) || user.user_type !== 'ADMINISTRATOR') return filter;
    const adminVisible = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'NEEDS_REVISION'];
    if (filter.status) {
        const requested = filter.status.$in
            ? filter.status.$in
            : [filter.status];
        const allowed = requested.filter((s) => adminVisible.includes(s));
        filter.status = allowed.length > 1 ? { $in: allowed } : (allowed[0] || { $in: [] });
    } else {
        filter.status = { $in: adminVisible };
    }
    return filter;
}

// GET /api/quotes?townHallId=&townHallName=&status=&reportId=&type=
router.get('/', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const { townHallId, townHallName, status, reportId, type, parentQuoteId } = req.query;
        const filter = {};

        if (townHallId) {
            if (!(await requireTownHallAccess(req, res, townHallId))) return;
            filter.townHallId = townHallId;
        } else if (townHallName) {
            const th = await townHalls.findOne({ name: { $eq: townHallName } }).select('_id');
            if (!th) {
                return res.status(404).json({ error: 'Comune non trovato' });
            }
            if (!(await requireTownHallAccess(req, res, th._id))) return;
            filter.townHallId = th._id;
        } else if (!isSuperAdmin(req.currentUser)) {
            filter.townHallId = { $in: req.currentUser.town_halls_list || [] };
        }

        if (status) {
            const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
            filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
        }
        if (reportId) filter.reportId = reportId;
        if (type) filter.type = type;
        if (parentQuoteId) filter.parentQuoteId = parentQuoteId;

        restrictQuoteListForAdmin(req.currentUser, filter);

        const list = await quotes.find(filter)
            .sort({ updatedAt: -1 })
            .populate('createdBy', 'name surname email')
            .populate('lightPointId', 'numero_palo indirizzo')
            .populate('reportId', 'fault_label report_type description risk_class workflow_status is_solved report_date maintenance_category')
            .populate('townHallId', 'name')
            .populate('parentQuoteId', 'protocolNumber total status priorityClass')
            .limit(200);

        return res.json(list);
    } catch (error) {
        console.error('Errore GET quotes:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/quotes — crea bozza (solo manutentori)
router.post('/', requireRole('MAINTAINER', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const {
            townHallId,
            townHallName,
            lightPointId,
            reportId,
            priorityClass,
            materialLeadDays,
            workLeadDays,
            lineItems,
            safetyChargeRate,
            discountPercent,
            faultDescription,
            notes,
        } = req.body || {};

        if (!lightPointId || (!townHallId && !townHallName)) {
            return res.status(400).json({ error: 'lightPointId e townHallId/townHallName sono obbligatori' });
        }

        let th = null;
        if (townHallId && mongoose.Types.ObjectId.isValid(townHallId)) {
            th = await townHalls.findById(townHallId);
        }
        if (!th && townHallName) {
            th = await townHalls.findOne({ name: { $eq: townHallName } });
        }
        if (!th) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallAccess(req, res, th._id))) return;

        const lightPoint = await light_points.findById(lightPointId);
        if (!lightPoint) {
            return res.status(404).json({ error: 'Punto luce non trovato' });
        }

        let report = null;
        if (reportId) {
            report = await reports.findById(reportId);
            if (!report) {
                return res.status(404).json({ error: 'Segnalazione non trovata' });
            }
            const existing = await quotes.findOne({
                reportId: report._id,
                type: 'QUOTE',
                status: { $in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] },
            });
            if (existing) {
                return res.status(409).json({
                    error: 'Esiste già un preventivo attivo per questa segnalazione',
                    quoteId: existing._id,
                    quote: existing,
                });
            }
        }

        const config = await findActiveConfig(th._id);
        const minDiscountPercent = getMinimumDiscountPercent(config);
        const riskCode = priorityClass || report?.risk_class || 'C';
        const riskCfg = (config?.riskClasses || []).find((r) => r.code === riskCode);

        const items = normalizeLineItems(lineItems);
        const quote = new quotes({
            type: 'QUOTE',
            townHallId: th._id,
            lightPointId: lightPoint._id,
            reportId: report?._id || null,
            createdBy: req.currentUser._id,
            assignedMaintainer: req.currentUser._id,
            status: 'DRAFT',
            priorityClass: riskCode,
            materialLeadDays: materialLeadDays ?? riskCfg?.defaultMaterialDays ?? 0,
            workLeadDays: workLeadDays ?? riskCfg?.defaultWorkDays ?? 0,
            faultDescription: faultDescription
                || report?.description
                || '',
            notes: notes || '',
        });

        applyTotals(
            quote,
            items,
            safetyChargeRate ?? 0.02,
            withMinimumDiscount(discountPercent ?? 0, minDiscountPercent)
        );
        appendStatusHistory(quote, {
            status: 'DRAFT',
            by: req.currentUser._id,
            note: 'Bozza preventivo creata',
        });

        await quote.save();

        if (report && !report.linked_quote_id) {
            report.linked_quote_id = quote._id;
            // Preventivo IMS ⇒ intervento straordinario
            if (!report.is_solved) {
                report.maintenance_category = 'EXTRAORDINARY';
            }
            // Non riaprire segnalazioni già risolte
            if (
                !report.is_solved
                && report.workflow_status !== 'PENDING_QUOTE'
                && report.workflow_status !== 'ESCALATED'
            ) {
                transitionReportStatus(report, 'PENDING_QUOTE', req.currentUser._id, 'Preventivo in bozza');
            }
            await report.save();
        }

        await logAccess({
            user: req.user?._id || req.currentUser._id,
            action: 'CREATE_QUOTE',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Quote ${quote._id}`,
        });

        return res.status(201).json(quote);
    } catch (error) {
        console.error('Errore POST quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// GET /api/quotes/:id
router.get('/:id', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const quote = await loadQuoteForAccess(req, res, req.params.id);
        if (!quote) return;

        // Gli admin non possono aprire le bozze (né i rifiutati da riprendere)
        if (
            req.currentUser.user_type === 'ADMINISTRATOR'
            && !isSuperAdmin(req.currentUser)
            && quote.type === 'QUOTE'
            && EDITABLE_QUOTE_STATUSES.includes(quote.status)
        ) {
            return res.status(403).json({ error: 'Le bozze preventivo sono riservate ai manutentori' });
        }

        const populated = await quotes.findById(quote._id)
            .populate('createdBy', 'name surname email')
            .populate('approvedBy', 'name surname email')
            .populate('assignedMaintainer', 'name surname email')
            .populate('lightPointId', 'numero_palo indirizzo lat lng marker quadro')
            .populate('reportId')
            .populate('townHallId', 'name');

        return res.json(populated);
    } catch (error) {
        console.error('Errore GET quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// PATCH /api/quotes/:id — salva bozza (solo manutentori)
router.patch('/:id', requireRole('MAINTAINER', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const quote = await loadQuoteForAccess(req, res, req.params.id);
        if (!quote) return;

        if (!canEditQuote(req.currentUser, quote)) {
            return res.status(403).json({ error: 'Non puoi modificare questo preventivo' });
        }

        if (!EDITABLE_QUOTE_STATUSES.includes(quote.status)) {
            return res.status(400).json({ error: 'Solo le bozze o i preventivi da revisionare sono modificabili' });
        }

        const {
            priorityClass,
            materialLeadDays,
            workLeadDays,
            lineItems,
            safetyChargeRate,
            discountPercent,
            faultDescription,
            notes,
        } = req.body || {};

        const config = await findActiveConfig(quote.townHallId);
        const minDiscountPercent = getMinimumDiscountPercent(config);

        if (priorityClass) quote.priorityClass = priorityClass;
        if (materialLeadDays !== undefined) quote.materialLeadDays = Number(materialLeadDays) || 0;
        if (workLeadDays !== undefined) quote.workLeadDays = Number(workLeadDays) || 0;
        if (faultDescription !== undefined) quote.faultDescription = faultDescription;
        if (notes !== undefined) quote.notes = notes;

        const items = lineItems !== undefined
            ? normalizeLineItems(lineItems, quote.lineItems)
            : quote.lineItems;
        applyTotals(
            quote,
            items,
            safetyChargeRate !== undefined ? safetyChargeRate : quote.safetyChargeRate,
            withMinimumDiscount(
                discountPercent !== undefined ? discountPercent : quote.discountPercent,
                minDiscountPercent
            )
        );

        if (isReturnedForRevision(quote.status)) {
            quote.status = 'DRAFT';
            appendStatusHistory(quote, {
                status: 'DRAFT',
                by: req.currentUser._id,
                note: quote.type === 'CONSUNTIVO'
                    ? 'Bozza consuntivo ripresa dopo rifiuto RUP'
                    : 'Bozza ripresa dopo respingimento DEC',
            });
        }

        await quote.save();
        return res.json(quote);
    } catch (error) {
        console.error('Errore PATCH quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// DELETE /api/quotes/:id — elimina bozza preventivo/consuntivo o preventivo rifiutato (solo manutentori)
router.delete('/:id', requireRole('MAINTAINER', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const quote = await loadQuoteForAccess(req, res, req.params.id);
        if (!quote) return;

        if (!canEditQuote(req.currentUser, quote)) {
            return res.status(403).json({ error: 'Non puoi eliminare questo documento' });
        }

        if (quote.type === 'CONSUNTIVO') {
            if (quote.status !== 'DRAFT') {
                return res.status(400).json({ error: 'Solo le bozze consuntivo possono essere eliminate' });
            }
            await quotes.deleteOne({ _id: quote._id });
            await logAccess({
                user: req.currentUser._id,
                action: 'DELETE_CONSUNTIVO',
                resource: req.originalUrl,
                outcome: 'SUCCESS',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                details: `Consuntivo ${quote._id} deleted`,
            });
            return res.json({ message: 'Consuntivo eliminato', id: quote._id });
        }

        if (quote.type !== 'QUOTE') {
            return res.status(400).json({ error: 'Tipo documento non eliminabile' });
        }

        if (!EDITABLE_QUOTE_STATUSES.includes(quote.status)) {
            return res.status(400).json({ error: 'Solo le bozze o i preventivi da revisionare possono essere eliminati' });
        }

        if (quote.reportId) {
            await reports.updateOne(
                { _id: quote.reportId, linked_quote_id: quote._id },
                { $set: { linked_quote_id: null } }
            );
        }

        await quotes.deleteOne({ _id: quote._id });

        await logAccess({
            user: req.currentUser._id,
            action: 'DELETE_QUOTE',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Quote ${quote._id} deleted`,
        });

        return res.json({ message: 'Preventivo eliminato', id: quote._id });
    } catch (error) {
        console.error('Errore DELETE quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/quotes/:id/submit (solo manutentori / titolare) — preventivo o consuntivo
router.post('/:id/submit', requireRole('MAINTAINER', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const quote = await loadQuoteForAccess(req, res, req.params.id);
        if (!quote) return;

        if (!canEditQuote(req.currentUser, quote)) {
            return res.status(403).json({ error: 'Non puoi inviare questo documento' });
        }
        if (!canSubmitQuote(req.currentUser)) {
            return res.status(403).json({
                error: quote.type === 'CONSUNTIVO'
                    ? 'Solo il titolare manutentore può inviare il consuntivo in approvazione'
                    : 'Solo il titolare manutentore può inviare in approvazione',
            });
        }

        if (!EDITABLE_QUOTE_STATUSES.includes(quote.status)) {
            return res.status(400).json({
                error: quote.type === 'CONSUNTIVO'
                    ? 'Il consuntivo non è modificabile per l\'invio'
                    : 'Il preventivo non è in bozza',
            });
        }

        if (!quote.lineItems?.length) {
            return res.status(400).json({ error: 'Aggiungere almeno una voce di materiale' });
        }

        const config = await findActiveConfig(quote.townHallId);
        const minDiscountPercent = getMinimumDiscountPercent(config);
        applyTotals(
            quote,
            clearLineItemContests(quote.lineItems),
            quote.safetyChargeRate,
            withMinimumDiscount(quote.discountPercent, minDiscountPercent)
        );
        quote.status = 'PENDING_APPROVAL';
        quote.rejectedReason = '';
        appendStatusHistory(quote, {
            status: 'PENDING_APPROVAL',
            by: req.currentUser._id,
            note: quote.type === 'CONSUNTIVO'
                ? 'Consuntivo inviato in approvazione RUP'
                : 'Inviato in approvazione DEC',
        });
        await quote.save();

        const admins = await getTownHallAdmins(quote.townHallId);
        if (quote.type === 'CONSUNTIVO') {
            await safeNotify(() =>
                notifyUsersWithPush(
                    admins.map((a) => a._id),
                    {
                        title: 'Consuntivo in approvazione',
                        body: `Consuntivo IMS in attesa di revisione RUP (totale € ${quote.total.toFixed(2)})`,
                        type: 'CONSUNTIVO_PENDING',
                        url: `/consuntivo/${quote._id}/review`,
                        meta: { consuntivoId: String(quote._id) },
                    }
                )
            );
            await notifyQuoteEmail('CONSUNTIVO_PENDING', {
                townHallId: quote.townHallId,
                vars: {
                    numero_preventivo: quote.protocolNumber || String(quote._id),
                    totale: quote.total.toFixed(2),
                    stato: quote.status,
                },
            });
        } else {
            await safeNotify(() =>
                notifyUsersWithPush(
                    admins.map((a) => a._id),
                    {
                        title: 'Preventivo in approvazione',
                        body: `Nuovo preventivo IMS in attesa di approvazione (totale € ${quote.total.toFixed(2)})`,
                        type: 'QUOTE_PENDING',
                        url: `/quote/${quote._id}/review`,
                        meta: { quoteId: String(quote._id) },
                    }
                )
            );
            await notifyQuoteEmail('QUOTE_PENDING', {
                townHallId: quote.townHallId,
                vars: {
                    numero_preventivo: quote.protocolNumber || String(quote._id),
                    totale: quote.total.toFixed(2),
                    stato: quote.status,
                },
            });
        }

        return res.json(quote);
    } catch (error) {
        console.error('Errore SUBMIT quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/quotes/:id/approve
router.post('/:id/approve', requireRole('ADMINISTRATOR', 'SUPER_ADMIN'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const quote = await quotes.findById(req.params.id).session(session);
        if (!quote) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Documento non trovato' });
        }

        if (!(await requireTownHallAccess(req, res, quote.townHallId))) {
            await session.abortTransaction();
            session.endSession();
            return;
        }

        if (!canApproveQuote(req.currentUser, quote)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(403).json({ error: 'Solo RUP/DEC del comune può approvare' });
        }

        if (quote.status !== 'PENDING_APPROVAL') {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                error: quote.type === 'CONSUNTIVO'
                    ? 'Il consuntivo non è in attesa di approvazione'
                    : 'Il preventivo non è in attesa di approvazione',
            });
        }

        // ——— Approvazione / finalizzazione consuntivo ———
        if (quote.type === 'CONSUNTIVO') {
            const parent = quote.parentQuoteId
                ? await quotes.findById(quote.parentQuoteId).session(session)
                : null;
            if (!parent) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ error: 'Preventivo di origine non trovato' });
            }

            applyTotals(
                quote,
                clearLineItemContests(quote.lineItems),
                quote.safetyChargeRate,
                quote.discountPercent
            );

            const seq = await nextSequentialNumber(quote.townHallId, 'consuntivi', {
                prefix: 'IMS-C',
                padLength: 4,
            });

            quote.status = 'APPROVED';
            quote.protocolNumber = seq.formatted;
            quote.rejectedReason = '';
            quote.approvedBy = req.currentUser._id;
            quote.approvedAt = new Date();
            appendStatusHistory(quote, {
                status: 'APPROVED',
                by: req.currentUser._id,
                note: `Consuntivo approvato RUP — ${seq.formatted}`,
            });
            await quote.save({ session });

            await session.commitTransaction();
            session.endSession();

            const maintainerId = quote.assignedMaintainer || quote.createdBy;
            await safeNotify(() =>
                notifyUsersWithPush([maintainerId], {
                    title: `Consuntivo ${seq.formatted} approvato`,
                    body: `Totale € ${quote.total.toFixed(2)} (preventivo € ${Number(parent.total || 0).toFixed(2)})`,
                    type: 'CONSUNTIVO_FINALIZED',
                    url: `/consuntivo/${quote._id}`,
                    meta: {
                        consuntivoId: String(quote._id),
                        parentQuoteId: String(parent._id),
                    },
                })
            );
            await notifyQuoteEmail('CONSUNTIVO_FINALIZED', {
                townHallId: quote.townHallId,
                recipientUserIds: [maintainerId],
                vars: {
                    numero_preventivo: seq.formatted,
                    totale: quote.total.toFixed(2),
                },
            });

            await logAccess({
                user: req.currentUser._id,
                action: 'APPROVE_CONSUNTIVO',
                resource: req.originalUrl,
                outcome: 'SUCCESS',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                details: `Consuntivo ${quote._id} protocol ${seq.formatted}`,
            });

            return res.json({
                quote,
                consuntivo: quote,
                parentQuote: parent,
                protocolNumber: seq.formatted,
            });
        }

        if (quote.type !== 'QUOTE') {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'Tipo documento non approvabile' });
        }

        const seq = await nextSequentialNumber(quote.townHallId, 'quotes', {
            prefix: 'IMS',
            padLength: 4,
        });

        const leadDays = (Number(quote.materialLeadDays) || 0) + (Number(quote.workLeadDays) || 0);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + leadDays);

        quote.status = 'APPROVED';
        quote.protocolNumber = seq.formatted;
        quote.dueDate = dueDate;
        quote.approvedBy = req.currentUser._id;
        quote.approvedAt = new Date();
        appendStatusHistory(quote, {
            status: 'APPROVED',
            by: req.currentUser._id,
            note: `Approvato — protocollo ${seq.formatted}`,
        });
        await quote.save({ session });

        const th = await townHalls.findById(quote.townHallId).session(session);
        const lightPoint = await light_points.findById(quote.lightPointId).session(session);
        let sourceReport = quote.reportId
            ? await reports.findById(quote.reportId).session(session)
            : null;

        let extraordinaryReport = null;

        if (sourceReport?.maintenance_category === 'EXTRAORDINARY') {
            sourceReport.due_date = dueDate;
            sourceReport.linked_quote_id = quote._id;
            sourceReport.risk_class = quote.priorityClass;
            if (sourceReport.workflow_status === 'PENDING_QUOTE') {
                transitionReportStatus(
                    sourceReport,
                    'OPEN',
                    req.currentUser._id,
                    `Preventivo ${seq.formatted} approvato`
                );
            }
            await sourceReport.save({ session });
            extraordinaryReport = sourceReport;
        } else {
            if (sourceReport) {
                transitionReportStatus(
                    sourceReport,
                    'ESCALATED',
                    req.currentUser._id,
                    `Preventivo ${seq.formatted} approvato — escalation straordinaria`
                );
                sourceReport.linked_quote_id = quote._id;
                await sourceReport.save({ session });
            }

            const plantContext = lightPoint
                ? await resolvePlantContext(lightPoint, th)
                : { quadroId: null, quadroLabel: '' };

            extraordinaryReport = new reports({
                operation_point_id: quote.lightPointId,
                user_creator_id: req.currentUser._id,
                report_type: sourceReport?.report_type || sourceReport?.fault_label || 'OTHER',
                description: quote.faultDescription
                    || sourceReport?.description
                    || `Intervento straordinario da preventivo ${seq.formatted}`,
                report_date: new Date(),
                maintenance_category: 'EXTRAORDINARY',
                workflow_status: 'OPEN',
                risk_class: quote.priorityClass,
                fault_label: sourceReport?.fault_label || null,
                parent_report_id: sourceReport?._id || null,
                linked_quote_id: quote._id,
                due_date: dueDate,
                plant_context: plantContext,
                town_hall_id: quote.townHallId,
            });
            appendStatusHistory(extraordinaryReport, {
                status: 'OPEN',
                by: req.currentUser._id,
                note: `Creata da approvazione preventivo ${seq.formatted}`,
            });
            await extraordinaryReport.save({ session });

            if (lightPoint) {
                await light_points.updateOne(
                    { _id: lightPoint._id },
                    { $addToSet: { segnalazioni_in_corso: extraordinaryReport._id } },
                    { session }
                );
            }
        }

        await session.commitTransaction();
        session.endSession();

        const maintainerId = quote.assignedMaintainer || quote.createdBy;
        await safeNotify(() =>
            notifyUsersWithPush([maintainerId], {
                title: `Preventivo ${seq.formatted} approvato`,
                body: `Scadenza intervento: ${dueDate.toLocaleDateString('it-IT')}`,
                type: 'QUOTE_APPROVED',
                url: `/quote/${quote._id}`,
                meta: {
                    quoteId: String(quote._id),
                    extraordinaryReportId: extraordinaryReport ? String(extraordinaryReport._id) : null,
                },
            })
        );
        await notifyQuoteEmail('QUOTE_APPROVED', {
            townHallId: quote.townHallId,
            recipientUserIds: [maintainerId],
            vars: {
                numero_preventivo: seq.formatted,
                totale: Number(quote.total || 0).toFixed(2),
                scadenza: dueDate.toLocaleDateString('it-IT'),
            },
        });

        await logAccess({
            user: req.currentUser._id,
            action: 'APPROVE_QUOTE',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Quote ${quote._id} protocol ${seq.formatted}`,
        });

        return res.json({
            quote,
            extraordinaryReport,
            protocolNumber: seq.formatted,
            dueDate,
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Errore APPROVE quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/quotes/:id/reject
router.post('/:id/reject', requireRole('ADMINISTRATOR', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const quote = await loadQuoteForAccess(req, res, req.params.id);
        if (!quote) return;

        if (!canApproveQuote(req.currentUser, quote)) {
            return res.status(403).json({ error: 'Solo RUP/DEC del comune può rifiutare' });
        }

        if (quote.status !== 'PENDING_APPROVAL') {
            return res.status(400).json({
                error: quote.type === 'CONSUNTIVO'
                    ? 'Il consuntivo non è in attesa di approvazione'
                    : 'Il preventivo non è in attesa di approvazione',
            });
        }

        const reason = String(req.body?.reason || '').trim();

        if (quote.type === 'CONSUNTIVO') {
            const rawContested = Array.isArray(req.body?.contestedLines)
                ? req.body.contestedLines
                : [];
            const parsed = parseContestedLines(rawContested, quote.lineItems);
            if (parsed.error) {
                return res.status(400).json({ error: parsed.error });
            }
            const { contestedByIndex } = parsed;

            if (contestedByIndex.size === 0) {
                return res.status(400).json({
                    error: 'Selezionare almeno una voce non chiara e indicarne il motivo',
                });
            }

            const overallReason = reason
                || `Voci contestate: ${[...contestedByIndex.keys()].map((i) => i + 1).join(', ')}`;

            applyContestedLineItems(quote, contestedByIndex);

            quote.status = 'NEEDS_REVISION';
            quote.rejectedReason = overallReason;
            appendStatusHistory(quote, {
                status: 'NEEDS_REVISION',
                by: req.currentUser._id,
                note: overallReason,
            });
            await quote.save();

            const maintainerId = quote.assignedMaintainer || quote.createdBy;
            await safeNotify(() =>
                notifyUsersWithPush([maintainerId], {
                    title: 'Consuntivo da revisionare',
                    body: overallReason,
                    type: 'CONSUNTIVO_REJECTED',
                    url: `/consuntivo/${quote._id}`,
                    meta: {
                        consuntivoId: String(quote._id),
                        contestedCount: contestedByIndex.size,
                    },
                })
            );
            await notifyQuoteEmail('CONSUNTIVO_REJECTED', {
                townHallId: quote.townHallId,
                recipientUserIds: [maintainerId],
                vars: {
                    numero_preventivo: quote.protocolNumber || String(quote._id),
                    motivo: overallReason,
                },
            });

            await logAccess({
                user: req.currentUser._id,
                action: 'REJECT_CONSUNTIVO',
                resource: req.originalUrl,
                outcome: 'SUCCESS',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                details: `Consuntivo ${quote._id} returned for revision (${contestedByIndex.size} voci)`,
            });

            return res.json(quote);
        }

        const rawContested = Array.isArray(req.body?.contestedLines)
            ? req.body.contestedLines
            : [];
        const parsed = parseContestedLines(rawContested, quote.lineItems);
        if (parsed.error) {
            return res.status(400).json({ error: parsed.error });
        }
        const { contestedByIndex } = parsed;

        if (contestedByIndex.size === 0 && !reason) {
            return res.status(400).json({
                error: 'Selezionare almeno una voce da contestare oppure indicare un motivo generale',
            });
        }

        let overallReason = reason;
        if (contestedByIndex.size > 0) {
            applyContestedLineItems(quote, contestedByIndex);
            overallReason = reason
                || `Voci contestate: ${[...contestedByIndex.keys()].map((i) => i + 1).join(', ')}`;
        } else {
            applyContestedLineItems(quote, new Map());
            overallReason = reason;
        }

        quote.status = 'NEEDS_REVISION';
        quote.rejectedReason = overallReason;
        appendStatusHistory(quote, {
            status: 'NEEDS_REVISION',
            by: req.currentUser._id,
            note: overallReason,
        });
        await quote.save();

        const maintainerId = quote.assignedMaintainer || quote.createdBy;
        await safeNotify(() =>
            notifyUsersWithPush([maintainerId], {
                title: 'Preventivo da revisionare',
                body: overallReason,
                type: 'QUOTE_REJECTED',
                url: `/quote?quoteId=${quote._id}`,
                meta: {
                    quoteId: String(quote._id),
                    contestedCount: contestedByIndex.size,
                },
            })
        );
        await notifyQuoteEmail('QUOTE_REJECTED', {
            townHallId: quote.townHallId,
            recipientUserIds: [maintainerId],
            vars: {
                numero_preventivo: quote.protocolNumber || String(quote._id),
                motivo: overallReason,
            },
        });

        await logAccess({
            user: req.currentUser._id,
            action: 'REJECT_QUOTE',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Quote ${quote._id} returned for revision (${contestedByIndex.size} voci)`,
        });

        return res.json(quote);
    } catch (error) {
        console.error('Errore REJECT quote:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/quotes/:id/consuntivo — crea bozza consuntivo da preventivo approvato
router.post('/:id/consuntivo', requireRole('MAINTAINER', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const parent = await loadQuoteForAccess(req, res, req.params.id);
        if (!parent) return;

        if (parent.type !== 'QUOTE') {
            return res.status(400).json({ error: 'Il documento non è un preventivo' });
        }
        if (parent.status !== 'APPROVED') {
            return res.status(400).json({ error: 'Il preventivo deve essere approvato' });
        }
        if (!canEditQuote(req.currentUser, parent)) {
            return res.status(403).json({ error: 'Non puoi creare il consuntivo' });
        }

        const sourceItems = req.body?.lineItems?.length
            ? req.body.lineItems
            : parent.lineItems;
        const lineItems = normalizeLineItems(sourceItems);

        const existing = await quotes.findOne({
            parentQuoteId: parent._id,
            type: 'CONSUNTIVO',
        });
        if (existing) {
            // Bozze create prima del fix (voci perse dallo spread Mongoose): ripristina dal preventivo
            if (
                existing.status === 'DRAFT'
                && (!existing.lineItems || existing.lineItems.length === 0)
                && lineItems.length > 0
            ) {
                applyTotals(
                    existing,
                    lineItems,
                    existing.safetyChargeRate ?? parent.safetyChargeRate ?? 0.02,
                    existing.discountPercent ?? parent.discountPercent ?? 0
                );
                await existing.save();
            }
            return res.status(200).json({
                consuntivo: existing,
                parentQuote: parent,
                alreadyExists: true,
            });
        }

        const consuntivo = new quotes({
            type: 'CONSUNTIVO',
            townHallId: parent.townHallId,
            lightPointId: parent.lightPointId,
            reportId: parent.reportId,
            parentQuoteId: parent._id,
            createdBy: req.currentUser._id,
            assignedMaintainer: req.currentUser._id,
            status: 'DRAFT',
            priorityClass: parent.priorityClass,
            materialLeadDays: parent.materialLeadDays,
            workLeadDays: parent.workLeadDays,
            dueDate: parent.dueDate,
            faultDescription: parent.faultDescription,
            notes: req.body?.notes || '',
            safetyChargeRate: parent.safetyChargeRate ?? 0.02,
            discountPercent: parent.discountPercent ?? 0,
        });

        applyTotals(
            consuntivo,
            lineItems,
            consuntivo.safetyChargeRate,
            req.body?.discountPercent !== undefined
                ? req.body.discountPercent
                : consuntivo.discountPercent
        );
        appendStatusHistory(consuntivo, {
            status: 'DRAFT',
            by: req.currentUser._id,
            note: `Consuntivo creato da preventivo ${parent.protocolNumber || parent._id}`,
        });
        await consuntivo.save();

        await logAccess({
            user: req.currentUser._id,
            action: 'CREATE_CONSUNTIVO',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Consuntivo ${consuntivo._id} from quote ${parent._id}`,
        });

        return res.status(201).json({
            consuntivo,
            parentQuote: parent,
            alreadyExists: false,
        });
    } catch (error) {
        console.error('Errore POST consuntivo:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/quotes/:id/finalize-consuntivo
// Legacy alias: il titolare invia il consuntivo in approvazione RUP (non lo chiude più direttamente).
router.post('/:id/finalize-consuntivo', requireRole('MAINTAINER', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const consuntivo = await loadQuoteForAccess(req, res, req.params.id);
        if (!consuntivo) return;

        if (consuntivo.type !== 'CONSUNTIVO') {
            return res.status(400).json({ error: 'Il documento non è un consuntivo' });
        }
        if (!canEditQuote(req.currentUser, consuntivo)) {
            return res.status(403).json({ error: 'Non puoi inviare questo consuntivo' });
        }
        if (!canSubmitQuote(req.currentUser)) {
            return res.status(403).json({
                error: 'Solo il titolare manutentore può inviare il consuntivo in approvazione',
            });
        }
        if (!EDITABLE_QUOTE_STATUSES.includes(consuntivo.status)) {
            return res.status(400).json({
                error: 'Solo i consuntivi in bozza o da revisionare possono essere inviati in approvazione',
            });
        }
        if (!consuntivo.lineItems?.length) {
            return res.status(400).json({ error: 'Aggiungere almeno una voce' });
        }

        const parent = consuntivo.parentQuoteId
            ? await quotes.findById(consuntivo.parentQuoteId)
            : null;
        if (!parent) {
            return res.status(400).json({ error: 'Preventivo di origine non trovato' });
        }

        const config = await findActiveConfig(consuntivo.townHallId);
        const minDiscountPercent = getMinimumDiscountPercent(config);
        applyTotals(
            consuntivo,
            clearLineItemContests(consuntivo.lineItems),
            consuntivo.safetyChargeRate,
            withMinimumDiscount(consuntivo.discountPercent, minDiscountPercent)
        );

        consuntivo.status = 'PENDING_APPROVAL';
        consuntivo.rejectedReason = '';
        appendStatusHistory(consuntivo, {
            status: 'PENDING_APPROVAL',
            by: req.currentUser._id,
            note: 'Consuntivo inviato in approvazione RUP',
        });
        await consuntivo.save();

        const admins = await getTownHallAdmins(consuntivo.townHallId);
        await safeNotify(() =>
            notifyUsersWithPush(
                admins.map((a) => a._id),
                {
                    title: 'Consuntivo in approvazione',
                    body: `Consuntivo IMS in attesa di revisione RUP (totale € ${consuntivo.total.toFixed(2)})`,
                    type: 'CONSUNTIVO_PENDING',
                    url: `/consuntivo/${consuntivo._id}/review`,
                    meta: {
                        consuntivoId: String(consuntivo._id),
                        parentQuoteId: String(parent._id),
                    },
                }
            )
        );
        await notifyQuoteEmail('CONSUNTIVO_PENDING', {
            townHallId: consuntivo.townHallId,
            vars: {
                numero_preventivo: consuntivo.protocolNumber || String(consuntivo._id),
                totale: consuntivo.total.toFixed(2),
                stato: consuntivo.status,
            },
        });

        await logAccess({
            user: req.currentUser._id,
            action: 'SUBMIT_CONSUNTIVO',
            resource: req.originalUrl,
            outcome: 'SUCCESS',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: `Consuntivo ${consuntivo._id} submitted for RUP approval`,
        });

        return res.json({
            consuntivo,
            parentQuote: parent,
            submitted: true,
        });
    } catch (error) {
        console.error('Errore SUBMIT consuntivo (finalize alias):', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

async function buildDocumentContext(quote) {
    const [report, lightPoint, config, th, approver, parentQuote] = await Promise.all([
        quote.reportId ? reports.findById(quote.reportId) : null,
        light_points.findById(quote.lightPointId),
        findActiveConfig(quote.townHallId),
        townHalls.findById(quote.townHallId).select('name'),
        quote.approvedBy
            ? users.findById(quote.approvedBy).select('name surname')
            : null,
        quote.parentQuoteId
            ? quotes.findById(quote.parentQuoteId)
            : null,
    ]);
    return { quote, parentQuote, report, lightPoint, config, townHall: th, approver };
}

function safeDownloadFilename(baseName, extension) {
    const ext = String(extension || '').replace(/^\./, '').toLowerCase() || 'bin';
    const raw = String(baseName || 'documento')
        .replace(/\.[^.]+$/g, '') // evita doppia estensione
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    const safeBase = raw || 'documento';
    return `${safeBase}.${ext}`;
}

function sendDownload(res, buffer, { filename, contentType }) {
    // Header semplice e compatibile: filename* doppio confonde alcuni browser
    // e porta a salvare il file col segmento URL ("xlsx") senza estensione.
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(buffer));
    return res.send(buffer);
}

// GET /api/quotes/:id/xlsx
router.get('/:id/xlsx', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const quote = await loadQuoteForAccess(req, res, req.params.id);
        if (!quote) return;

        const ctx = await buildDocumentContext(quote);
        const buffer = await fillImsWorkbook(ctx);
        const filename = safeDownloadFilename(
            quoteDocumentCode(quote),
            'xlsx'
        );

        return sendDownload(res, buffer, {
            filename,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
    } catch (error) {
        console.error('Errore GET quote xlsx:', error);
        return res.status(500).json({ error: 'Errore generazione Excel' });
    }
});

// GET /api/quotes/:id/pdf
router.get('/:id/pdf', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const quote = await loadQuoteForAccess(req, res, req.params.id);
        if (!quote) return;

        const ctx = await buildDocumentContext(quote);
        const xlsxBuffer = await fillImsWorkbook(ctx);
        let pdfBuffer;
        try {
            pdfBuffer = await toPdf(xlsxBuffer);
        } catch (convErr) {
            if (convErr.code === 'LIBREOFFICE_UNAVAILABLE') {
                return res.status(503).json({
                    error: 'Conversione PDF non disponibile: LibreOffice non installato sul server. Scaricare il file XLSX.',
                });
            }
            throw convErr;
        }

        const filename = safeDownloadFilename(
            quoteDocumentCode(quote),
            'pdf'
        );
        return sendDownload(res, pdfBuffer, {
            filename,
            contentType: 'application/pdf',
        });
    } catch (error) {
        console.error('Errore GET quote pdf:', error);
        return res.status(500).json({ error: 'Errore generazione PDF' });
    }
});

module.exports = router;
