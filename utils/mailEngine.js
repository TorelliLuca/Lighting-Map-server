const users = require('../schemas/users');
const townHalls = require('../schemas/townHalls');
const EmailActionConfig = require('../schemas/emailActionConfig');
const { transporter, emailLighting, debugMail } = require('../config/email');
const { cloneDefaults, getDefaultByKey } = require('./emailActionConfigDefaults');

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 100;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Interpola {{placeholder}} usando solo le chiavi in whitelist (o tutte se whitelist vuota).
 * Placeholder sconosciuti → stringa vuota.
 */
function renderTemplate(str, vars = {}, allowedPlaceholders = null) {
    if (typeof str !== 'string') return '';
    const allow = allowedPlaceholders && allowedPlaceholders.length > 0
        ? new Set(allowedPlaceholders)
        : null;

    return str.replace(PLACEHOLDER_RE, (_, key) => {
        if (allow && !allow.has(key)) return '';
        const value = vars[key];
        if (value === undefined || value === null) return '';
        return String(value);
    });
}

function extractPlaceholders(str) {
    if (typeof str !== 'string') return [];
    const found = new Set();
    let match;
    const re = new RegExp(PLACEHOLDER_RE.source, 'g');
    while ((match = re.exec(str)) !== null) {
        found.add(match[1]);
    }
    return [...found];
}

function validateTemplatesAgainstWhitelist(subjectTemplate, bodyTemplate, allowedPlaceholders) {
    const allowed = new Set(allowedPlaceholders || []);
    const used = [
        ...extractPlaceholders(subjectTemplate),
        ...extractPlaceholders(bodyTemplate),
    ];
    const unknown = [...new Set(used.filter((p) => !allowed.has(p)))];
    return { ok: unknown.length === 0, unknown };
}

async function ensureDefaultsSeeded() {
    const count = await EmailActionConfig.countDocuments();
    if (count > 0) {
        const defaults = cloneDefaults();
        for (const def of defaults) {
            const exists = await EmailActionConfig.exists({ actionKey: def.actionKey });
            if (!exists) {
                await EmailActionConfig.create(def);
            }
        }
        return EmailActionConfig.find().sort({ locked: -1, actionKey: 1 }).lean();
    }
    await EmailActionConfig.insertMany(cloneDefaults());
    return EmailActionConfig.find().sort({ locked: -1, actionKey: 1 }).lean();
}

async function getConfig(actionKey) {
    let config = await EmailActionConfig.findOne({ actionKey }).lean();
    if (!config) {
        const def = getDefaultByKey(actionKey);
        if (!def) return null;
        config = (await EmailActionConfig.create(def)).toObject();
    }
    return config;
}

async function resolveTownHallId(townHallId, townHallName) {
    if (townHallId) return townHallId;
    if (!townHallName) return null;
    const th = await townHalls.findOne({ name: { $eq: townHallName } }).select('_id');
    return th?._id || null;
}

/**
 * Risolve i destinatari in base a audience + contesto.
 * @returns {Promise<Array<{_id, email, name, surname}>>}
 */
async function resolveRecipients(config, context = {}) {
    const {
        townHallId: ctxTownHallId,
        townHallName,
        recipientUserIds,
        recipientEmails,
        creatorUserId,
    } = context;

    const mode = config.audience?.mode || 'recipients';
    const userTypes = config.audience?.userTypes?.length
        ? config.audience.userTypes
        : null;
    const subRoles = config.audience?.subRoles?.length
        ? config.audience.subRoles
        : null;

    if (mode === 'admin_email') {
        const adminEmail = process.env.ADMIN_EMAIL;
        if (!adminEmail) return [];
        const found = await users.findOne({ email: adminEmail }).select('_id email name surname');
        if (found) return [found];
        return [{ _id: null, email: adminEmail, name: 'Admin', surname: '' }];
    }

    if (mode === 'recipients' || recipientUserIds?.length || recipientEmails?.length) {
        const byId = recipientUserIds?.length
            ? await users.find({ _id: { $in: recipientUserIds } }).select('_id email name surname')
            : [];
        if (recipientEmails?.length) {
            const byEmail = await users
                .find({ email: { $in: recipientEmails } })
                .select('_id email name surname');
            const map = new Map();
            [...byId, ...byEmail].forEach((u) => map.set(String(u._id || u.email), u));
            recipientEmails.forEach((email) => {
                if (![...map.values()].some((u) => u.email === email)) {
                    map.set(email, { _id: null, email, name: '', surname: '' });
                }
            });
            return [...map.values()].filter((u) => u.email);
        }
        return byId.filter((u) => u.email);
    }

    if (mode === 'creator') {
        if (!creatorUserId) return [];
        const u = await users.findById(creatorUserId).select('_id email name surname');
        return u?.email ? [u] : [];
    }

    const townHallId = await resolveTownHallId(ctxTownHallId, townHallName);
    if (!townHallId && (mode === 'staff_of_townhall' || mode === 'admins' || mode === 'explicit_types')) {
        return [];
    }

    if (mode === 'admins') {
        const adminTypes = userTypes || ['ADMINISTRATOR', 'SUPER_ADMIN'];
        const roleFilter = subRoles || ['RUP', 'DEC'];
        return users.find({
            town_halls_list: townHallId,
            is_approved: true,
            $or: [
                { user_type: 'SUPER_ADMIN' },
                {
                    user_type: { $in: adminTypes.filter((t) => t !== 'SUPER_ADMIN') },
                    sub_role: { $in: roleFilter },
                },
            ],
        }).select('_id email name surname');
    }

    const query = { town_halls_list: townHallId };
    if (userTypes) query.user_type = { $in: userTypes };
    if (subRoles) query.sub_role = { $in: subRoles };

    if (mode === 'staff_of_townhall' && !userTypes) {
        query.user_type = { $in: ['ADMINISTRATOR', 'SUPER_ADMIN', 'MAINTAINER'] };
    }

    return users.find(query).select('_id email name surname');
}

/**
 * Invia email secondo la config dell'azione.
 * Se enabled=false (e non locked) → skip senza errore.
 * @returns {{ skipped: boolean, sent: number, errors: string[] }}
 */
async function sendConfiguredEmail(actionKey, context = {}) {
    const config = await getConfig(actionKey);
    if (!config) {
        debugMail(`Unknown email action: ${actionKey}`);
        return { skipped: true, sent: 0, errors: [`Azione sconosciuta: ${actionKey}`] };
    }

    if (!config.enabled && !config.locked) {
        debugMail(`Email action ${actionKey} disabled — skip`);
        return { skipped: true, sent: 0, errors: [] };
    }

    const recipients = await resolveRecipients(config, context);
    if (!recipients.length) {
        debugMail(`Email action ${actionKey}: no recipients`);
        return { skipped: false, sent: 0, errors: [] };
    }

    const baseVars = { ...(context.vars || {}) };
    let fromLabel = context.fromName || `LIGHTING MAP <${emailLighting}>`;
    if (context.fromName && !String(context.fromName).includes('<')) {
        fromLabel = `${context.fromName} <${emailLighting}>`;
    }
    const attachments = context.attachments || [];
    const errors = [];
    let sent = 0;

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (recipient) => {
            // Destinatario come default; context.vars ha priorità (es. dati segnalante in REPORT_CREATED)
            const vars = {
                nome: recipient.name || '',
                cognome: recipient.surname || '',
                email: recipient.email || '',
                ...baseVars,
            };

            const subject = renderTemplate(config.subjectTemplate, vars, config.allowedPlaceholders);
            const html = renderTemplate(config.bodyTemplate, vars, config.allowedPlaceholders);

            try {
                await transporter.sendMail({
                    from: fromLabel,
                    to: recipient.email,
                    subject,
                    html,
                    attachments,
                });
                sent += 1;
                debugMail(`Email ${actionKey} sent to ${recipient.email}`);
            } catch (err) {
                const msg = err.message || String(err);
                errors.push(`${recipient.email}: ${msg}`);
                debugMail(`Email ${actionKey} error for ${recipient.email}: ${msg}`);
            }
        }));

        if (i + BATCH_SIZE < recipients.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    return { skipped: false, sent, errors };
}

/**
 * Invio newsletter one-shot (bypass config azioni).
 */
async function sendNewsletter({ subject, htmlBody, recipients, fromName }) {
    const fromLabel = fromName || `LIGHTING MAP <${emailLighting}>`;
    const errors = [];
    let sent = 0;

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (recipient) => {
            const vars = {
                nome: recipient.name || '',
                cognome: recipient.surname || '',
                email: recipient.email || '',
            };
            const html = renderTemplate(htmlBody, vars);
            const subj = renderTemplate(subject, vars);
            try {
                await transporter.sendMail({
                    from: fromLabel,
                    to: recipient.email,
                    subject: subj,
                    html,
                });
                sent += 1;
            } catch (err) {
                errors.push(`${recipient.email}: ${err.message || err}`);
            }
        }));
        if (i + BATCH_SIZE < recipients.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    return { sent, errors };
}

module.exports = {
    renderTemplate,
    extractPlaceholders,
    validateTemplatesAgainstWhitelist,
    ensureDefaultsSeeded,
    getConfig,
    resolveRecipients,
    sendConfiguredEmail,
    sendNewsletter,
    PLACEHOLDER_RE,
};
