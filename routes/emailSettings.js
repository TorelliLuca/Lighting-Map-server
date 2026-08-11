const express = require('express');
const rateLimit = require('express-rate-limit');
const users = require('../schemas/users');
const EmailActionConfig = require('../schemas/emailActionConfig');
const NewsletterLog = require('../schemas/newsletterLogs');
const { requireRole } = require('../utils/roles');
const {
    ensureDefaultsSeeded,
    getConfig,
    renderTemplate,
    validateTemplatesAgainstWhitelist,
    sendNewsletter,
} = require('../utils/mailEngine');
const { getDefaultByKey } = require('../utils/emailActionConfigDefaults');
const { transporter, emailLighting } = require('../config/email');
const {
    listAssets,
    saveAssetFromBase64,
    deleteAsset,
} = require('../utils/emailAssets');

const router = express.Router();

const NEWSLETTER_MAX_RECIPIENTS = 200;

const SAMPLE_VARS = {
    nome: 'Mario',
    cognome: 'Rossi',
    email: 'mario.rossi@example.com',
    data: new Date().toLocaleDateString('it-IT'),
    nome_comune: 'Comune Esempio',
    numero_palo: '42',
    indirizzo: 'Via Roma 1',
    corpo_segnalazione: 'Punto luce spento',
    nota: 'Nota di esempio',
    tipo_operazione: 'Sostituzione lampada',
    dettaglio: 'Dettaglio operazione',
    esito: 'ORDINARY',
    numero_preventivo: 'IMS-2026-001',
    totale: '1234.56',
    stato: 'PENDING_APPROVAL',
    scadenza: new Date().toLocaleDateString('it-IT'),
    motivo: 'Importo non conforme',
    url_confirm: 'https://example.com/confirm',
    link_reset: 'https://example.com/reset',
};

const newsletterLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Troppi invii newsletter. Riprova tra qualche minuto.' },
});

const testMailLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Troppe mail di prova. Riprova tra qualche minuto.' },
});

function buildSampleVars(reqUser, extra = {}) {
    return {
        ...SAMPLE_VARS,
        data: new Date().toLocaleDateString('it-IT'),
        scadenza: new Date().toLocaleDateString('it-IT'),
        nome: reqUser?.name || SAMPLE_VARS.nome,
        cognome: reqUser?.surname || SAMPLE_VARS.cognome,
        email: reqUser?.email || SAMPLE_VARS.email,
        ...extra,
    };
}

router.use(requireRole('SUPER_ADMIN'));

// GET /api/email-settings
router.get('/', async (_req, res) => {
    try {
        const configs = await ensureDefaultsSeeded();
        return res.json(configs);
    } catch (error) {
        console.error('GET email-settings:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// GET /api/email-settings/newsletter/logs
router.get('/newsletter/logs', async (_req, res) => {
    try {
        const logs = await NewsletterLog.find()
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('senderId', 'name surname email')
            .lean();
        return res.json(logs);
    } catch (error) {
        console.error('GET newsletter logs:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// GET /api/email-settings/assets
router.get('/assets', async (req, res) => {
    try {
        return res.json(await listAssets(req));
    } catch (error) {
        console.error('GET email assets:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/email-settings/assets — upload immagine (base64 → R2 pubblico o disco locale)
router.post('/assets', async (req, res) => {
    try {
        const { data, filename, mimeType } = req.body || {};
        if (!data) {
            return res.status(400).json({ error: 'Campo data (base64 o data-URL) obbligatorio' });
        }
        const saved = await saveAssetFromBase64({ data, filename, mimeType }, req);
        return res.status(201).json(saved);
    } catch (error) {
        const status = error.status || 500;
        console.error('POST email assets:', error);
        return res.status(status).json({ error: error.message || 'Errore upload' });
    }
});

// DELETE /api/email-settings/assets/:filename
router.delete('/assets/:filename', async (req, res) => {
    try {
        await deleteAsset(req.params.filename);
        return res.json({ ok: true });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({ error: error.message || 'Errore eliminazione' });
    }
});

// GET /api/email-settings/config/:actionKey — config completa per modifica
router.get('/config/:actionKey', async (req, res) => {
    try {
        const config = await getConfig(req.params.actionKey);
        if (!config) {
            return res.status(404).json({ error: 'Azione non trovata' });
        }
        return res.json(config);
    } catch (error) {
        console.error('GET email-settings config:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// PATCH /api/email-settings/:actionKey
router.patch('/:actionKey', async (req, res) => {
    try {
        const { actionKey } = req.params;
        let config = await EmailActionConfig.findOne({ actionKey });
        if (!config) {
            const def = getDefaultByKey(actionKey);
            if (!def) {
                return res.status(404).json({ error: 'Azione non trovata' });
            }
            config = await EmailActionConfig.create(def);
        }

        if (config.locked) {
            return res.status(403).json({
                error: 'Questa azione di sicurezza non è modificabile',
            });
        }

        const {
            enabled,
            audience,
            subjectTemplate,
            bodyTemplate,
        } = req.body;

        if (typeof enabled === 'boolean') {
            config.enabled = enabled;
        }

        if (audience && typeof audience === 'object') {
            if (audience.mode) config.audience.mode = audience.mode;
            if (Array.isArray(audience.userTypes)) {
                config.audience.userTypes = audience.userTypes;
            }
            if (Array.isArray(audience.subRoles)) {
                config.audience.subRoles = audience.subRoles;
            }
        }

        if (typeof subjectTemplate === 'string') {
            config.subjectTemplate = subjectTemplate;
        }
        if (typeof bodyTemplate === 'string') {
            config.bodyTemplate = bodyTemplate;
        }

        const validation = validateTemplatesAgainstWhitelist(
            config.subjectTemplate,
            config.bodyTemplate,
            config.allowedPlaceholders
        );
        if (!validation.ok) {
            return res.status(400).json({
                error: `Placeholder non consentiti: ${validation.unknown.join(', ')}`,
                unknown: validation.unknown,
                allowed: config.allowedPlaceholders,
            });
        }

        config.updatedBy = req.currentUser._id;
        await config.save();
        return res.json(config);
    } catch (error) {
        console.error('PATCH email-settings:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/email-settings/preview
router.post('/preview', async (req, res) => {
    try {
        const {
            actionKey,
            subjectTemplate,
            bodyTemplate,
            vars = {},
        } = req.body;

        let subject = subjectTemplate;
        let body = bodyTemplate;
        let allowed = null;

        if (actionKey) {
            const config = await getConfig(actionKey);
            if (!config) {
                return res.status(404).json({ error: 'Azione non trovata' });
            }
            subject = subject ?? config.subjectTemplate;
            body = body ?? config.bodyTemplate;
            allowed = config.allowedPlaceholders;
        }

        if (typeof subject !== 'string' || typeof body !== 'string') {
            return res.status(400).json({ error: 'subjectTemplate e bodyTemplate richiesti' });
        }

        const sampleVars = buildSampleVars(req.currentUser, vars);

        return res.json({
            subject: renderTemplate(subject, sampleVars, allowed),
            html: renderTemplate(body, sampleVars, allowed),
        });
    } catch (error) {
        console.error('POST email-settings preview:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/email-settings/test — invia mail di prova all'account richiedente
router.post('/test', testMailLimiter, async (req, res) => {
    try {
        const to = req.currentUser?.email;
        if (!to) {
            return res.status(400).json({ error: 'Account senza email: impossibile inviare la prova' });
        }

        const {
            actionKey,
            subjectTemplate,
            bodyTemplate,
            subject,
            htmlBody,
            vars = {},
        } = req.body || {};

        const inlineSubject = subject ?? subjectTemplate;
        const inlineBody = htmlBody ?? bodyTemplate;
        const hasInlineTemplates = typeof inlineSubject === 'string' && typeof inlineBody === 'string';

        let subjectSrc;
        let bodySrc;
        let allowed = null;
        let label = 'prova';

        if (hasInlineTemplates) {
            subjectSrc = inlineSubject;
            bodySrc = inlineBody;
            if (actionKey) {
                const config = await getConfig(actionKey);
                if (config) {
                    allowed = config.allowedPlaceholders;
                    label = config.label || actionKey;
                } else {
                    const defaults = getDefaultByKey(actionKey);
                    allowed = defaults?.allowedPlaceholders ?? null;
                    label = defaults?.label || actionKey;
                }
            }
        } else if (actionKey) {
            const config = await getConfig(actionKey);
            if (!config) {
                return res.status(404).json({ error: 'Azione non trovata' });
            }
            const defaults = getDefaultByKey(actionKey);
            subjectSrc = config.subjectTemplate ?? defaults?.subjectTemplate;
            bodySrc = config.bodyTemplate ?? defaults?.bodyTemplate;
            allowed = config.allowedPlaceholders;
            label = config.label || actionKey;
        } else {
            subjectSrc = inlineSubject;
            bodySrc = inlineBody;
        }

        if (typeof subjectSrc !== 'string' || typeof bodySrc !== 'string') {
            return res.status(400).json({
                error: 'Template incompleto: compila oggetto e corpo HTML prima di inviare la prova.',
            });
        }

        const sampleVars = buildSampleVars(req.currentUser, vars);
        const renderedSubject = renderTemplate(subjectSrc, sampleVars, allowed);
        const renderedHtml = renderTemplate(bodySrc, sampleVars, allowed);

        await transporter.sendMail({
            from: `LIGHTING MAP — Test <${emailLighting}>`,
            to,
            subject: `[PROVA] ${renderedSubject}`,
            html: `${renderedHtml}
              <div style="margin-top:24px;padding:12px;border-top:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">
                Mail di prova per l'azione/template «${label}». Inviata a ${to}.
              </div>`,
        });

        return res.json({
            ok: true,
            to,
            subject: `[PROVA] ${renderedSubject}`,
        });
    } catch (error) {
        console.error('POST email-settings test:', error);
        return res.status(500).json({ error: 'Errore durante l\'invio della mail di prova' });
    }
});

// POST /api/email-settings/newsletter
router.post('/newsletter', newsletterLimiter, async (req, res) => {
    try {
        const { subject, htmlBody, userIds, filters } = req.body;

        if (!subject || !htmlBody) {
            return res.status(400).json({ error: 'subject e htmlBody sono obbligatori' });
        }

        let recipients = [];

        if (Array.isArray(userIds) && userIds.length > 0) {
            recipients = await users
                .find({ _id: { $in: userIds } })
                .select('_id email name surname');
        } else if (filters && typeof filters === 'object') {
            const query = {};
            if (Array.isArray(filters.userTypes) && filters.userTypes.length > 0) {
                query.user_type = { $in: filters.userTypes };
            }
            if (filters.approvedOnly !== false) {
                query.is_approved = true;
            }
            recipients = await users.find(query).select('_id email name surname');
        } else {
            return res.status(400).json({
                error: 'Specifica userIds oppure filters.userTypes',
            });
        }

        recipients = recipients.filter((u) => u.email);
        if (recipients.length === 0) {
            return res.status(400).json({ error: 'Nessun destinatario trovato' });
        }
        if (recipients.length > NEWSLETTER_MAX_RECIPIENTS) {
            return res.status(400).json({
                error: `Massimo ${NEWSLETTER_MAX_RECIPIENTS} destinatari per invio (richiesti: ${recipients.length})`,
            });
        }

        const result = await sendNewsletter({
            subject,
            htmlBody,
            recipients,
        });

        const status = result.errors.length === 0
            ? 'SUCCESS'
            : result.sent > 0
                ? 'PARTIAL'
                : 'FAILED';

        const log = await NewsletterLog.create({
            subject,
            senderId: req.currentUser._id,
            recipientCount: result.sent,
            filters: filters || { userIds },
            userIds: recipients.map((r) => r._id).filter(Boolean),
            status,
            errorMessage: result.errors.length ? result.errors.slice(0, 5).join('; ') : null,
        });

        return res.json({
            sent: result.sent,
            failed: result.errors.length,
            status,
            logId: log._id,
            errors: result.errors.slice(0, 10),
        });
    } catch (error) {
        console.error('POST newsletter:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /api/email-settings/newsletter/count — anteprima conteggio destinatari
router.post('/newsletter/count', async (req, res) => {
    try {
        const { userIds, filters } = req.body;
        let count = 0;

        if (Array.isArray(userIds) && userIds.length > 0) {
            count = await users.countDocuments({
                _id: { $in: userIds },
                email: { $exists: true, $ne: '' },
            });
        } else if (filters && typeof filters === 'object') {
            const query = { email: { $exists: true, $ne: '' } };
            if (Array.isArray(filters.userTypes) && filters.userTypes.length > 0) {
                query.user_type = { $in: filters.userTypes };
            }
            if (filters.approvedOnly !== false) {
                query.is_approved = true;
            }
            count = await users.countDocuments(query);
        }

        return res.json({ count, max: NEWSLETTER_MAX_RECIPIENTS });
    } catch (error) {
        console.error('POST newsletter count:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

module.exports = router;
