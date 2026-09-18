const express = require('express');
const townHalls = require('../schemas/townHalls');
const users = require('../schemas/users');
const organizations = require('../schemas/organizations');
const MaintenanceConfig = require('../schemas/maintenanceConfig');
const mongoose = require('mongoose');
const {
    findActiveConfig,
    getOrCreateActiveConfig,
    buildValidityMeta,
    enrichConfigDocument,
} = require('../utils/maintenanceConfigHelpers');
const {
    requireRole,
    requireTownHallAccess,
    loadRequestUser,
    isSuperAdmin,
} = require('../utils/roles');
const router = express.Router();

const requireSuperAdmin = requireRole('SUPER_ADMIN');

const USER_SAFE_SELECT =
    '-password -resetPasswordToken -resetPasswordExpires -emailConfirmToken -emailConfirmExpires -passwordChangedAt';

const populateMembersSafe = { path: 'members', select: USER_SAFE_SELECT };
const populateResponsibleSafe = { path: 'responsible', select: USER_SAFE_SELECT };

async function canAccessOrganization(user, organizationId) {
    if (!user || !organizationId) return false;
    if (isSuperAdmin(user)) return true;
    const fullUser = await users.findById(user._id).select('id_organization').lean();
    if (fullUser?.id_organization && String(fullUser.id_organization) === String(organizationId)) {
        return true;
    }
    const asMember = await organizations.exists({ _id: organizationId, members: user._id });
    return Boolean(asMember);
}

router.get('/my-organization/:organizationId', async (req, res) => {
    try {
        const user = await loadRequestUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Utente non autenticato' });
        }

        const organizationId = req.params.organizationId;
        if (!(await canAccessOrganization(user, organizationId))) {
            return res.status(403).json({ error: 'Accesso negato a questa organizzazione' });
        }

        const organization = await organizations
            .findById(organizationId)
            .populate(populateMembersSafe)
            .populate(populateResponsibleSafe);
        if (!organization) return res.status(404).send('Organizzazione non trovata');
        res.status(200).json(organization);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

router.get('/all-organizations', requireSuperAdmin, async (req, res) => {
    try {
        const organizationsList = await organizations.find();
        res.status(200).json(organizationsList);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

/**
 * Organizzazioni manutentori del comune, legate al capitolato attivo
 * (con budget ordinaria/straordinaria). Fallback legacy su contracts[].
 */
router.get('/townhall/:townhallId', async (req, res) => {
    try {
        const townhallParam = req.params.townhallId;
        let townHallOid = null;

        if (mongoose.Types.ObjectId.isValid(townhallParam)) {
            townHallOid = new mongoose.Types.ObjectId(townhallParam);
        } else {
            const decoded = decodeURIComponent(townhallParam);
            const byName = await townHalls.findOne({ name: decoded }).select('_id').lean();
            if (byName?._id) townHallOid = byName._id;
        }

        if (!townHallOid) {
            return res.status(400).json({ error: "L'ID o il nome del comune fornito non è valido." });
        }

        if (!(await requireTownHallAccess(req, res, townHallOid))) return;

        const activeConfig = await findActiveConfig(townHallOid);
        const validity = activeConfig ? buildValidityMeta(activeConfig) : null;
        const linked = Array.isArray(activeConfig?.linkedOrganizations)
            ? activeConfig.linkedOrganizations
            : [];

        let orgDocs = [];
        const bindingByOrgId = new Map();

        if (linked.length > 0) {
            const orgIds = linked.map((item) => item.organizationId).filter(Boolean);
            orgDocs = await organizations.find({ _id: { $in: orgIds } })
                .populate(populateMembersSafe)
                .populate(populateResponsibleSafe)
                .lean();
            for (const item of linked) {
                bindingByOrgId.set(String(item.organizationId), {
                    budgetOrdinary: Number(item.budgetOrdinary) || 0,
                    budgetExtraordinary: Number(item.budgetExtraordinary) || 0,
                    notes: item.notes || '',
                });
            }
        } else {
            const townHall = await townHalls.findById(townHallOid)
                .select('organizations_maintainers')
                .lean();
            const maintainerIds = (townHall?.organizations_maintainers || []).map(String);

            const byContract = await organizations.find({
                type: 'ENTERPRISE',
                'contracts.townhall_associated': townHallOid,
            })
                .populate(populateMembersSafe)
                .populate(populateResponsibleSafe)
                .lean();

            const byMaintainer = maintainerIds.length > 0
                ? await organizations.find({
                    _id: { $in: maintainerIds },
                    type: 'ENTERPRISE',
                })
                    .populate(populateMembersSafe)
                    .populate(populateResponsibleSafe)
                    .lean()
                : [];

            const byId = new Map();
            for (const org of [...byContract, ...byMaintainer]) {
                byId.set(String(org._id), org);
            }
            orgDocs = [...byId.values()];

            for (const org of orgDocs) {
                const contract = (org.contracts || []).find(
                    (c) => String(c.townhall_associated) === String(townHallOid)
                );
                bindingByOrgId.set(String(org._id), {
                    budgetOrdinary: Number(contract?.price) || 0,
                    budgetExtraordinary: 0,
                    notes: contract?.details || '',
                });
            }
        }

        orgDocs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it', { sensitivity: 'base' }));

        const payload = orgDocs.map((org) => {
            const binding = bindingByOrgId.get(String(org._id)) || {
                budgetOrdinary: 0,
                budgetExtraordinary: 0,
                notes: '',
            };
            const responsible = org.responsible;
            const responsibleLabel = responsible
                ? [responsible.name, responsible.surname].filter(Boolean).join(' ').trim()
                    || responsible.email
                    || null
                : null;

            return {
                ...org,
                id: org._id,
                isActive: true,
                responsible: responsibleLabel || org.responsible || null,
                responsibleUser: responsible || null,
                members: (org.members || []).map((m) => ({
                    ...m,
                    id: m._id,
                })),
                capitolato: activeConfig
                    ? {
                        configId: activeConfig._id,
                        version: activeConfig.capitolatoVersion,
                        status: activeConfig.status,
                        validFrom: activeConfig.validFrom,
                        validTo: activeConfig.validTo,
                        validity,
                    }
                    : null,
                budgetOrdinary: binding.budgetOrdinary,
                budgetExtraordinary: binding.budgetExtraordinary,
                bindingNotes: binding.notes,
                contracts: [],
            };
        });

        if (payload.length === 0) {
            return res.status(200).json([]);
        }

        res.status(200).json(payload);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server.' });
    }
});

router.post('/add-organization', requireSuperAdmin, async (req, res) => {
    try {
        const { name, description, type, logo, location, address, townhall_id } = req.body;
        const newOrganization = new organizations({
            name,
            description,
            type,
            logo,
            location,
            address,
        });
        if (townhall_id) {
            newOrganization.townhallId = townhall_id;
            const townhallToUpdate = await townHalls.findById(townhall_id);
            if (townhallToUpdate) {
                townhallToUpdate.organization_admin = newOrganization._id;
                await townhallToUpdate.save();
            }
        }
        await newOrganization.save();
        res.status(200).json(newOrganization);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

router.put('/add-users-to-organization', requireSuperAdmin, async (req, res) => {
    try {
        const { members, organizationId } = req.body;

        const updatedOrganization = await organizations.findByIdAndUpdate(
            organizationId,
            { $addToSet: { members: { $each: members } } },
            { new: true }
        );

        if (!updatedOrganization) {
            return res.status(404).send('Organizzazione non trovata');
        }

        const result = await users.updateMany(
            { _id: { $in: members } },
            { $set: { id_organization: organizationId } }
        );

        if (result.modifiedCount === 0) {
            console.warn('Nessun utente aggiornato. ID utente non validi.');
        }

        res.status(200).json(updatedOrganization);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

router.put('/remove-user-from-organization', requireSuperAdmin, async (req, res) => {
    const userId = req.body.userId;
    const organizationId = req.body.organizationId;
    try {
        const updatedOrganization = await organizations.findByIdAndUpdate(
            organizationId,
            { $pull: { members: userId } },
            { new: true }
        );
        if (!updatedOrganization) {
            return res.status(404).send('Organizzazione non trovata');
        }
        const updatedUser = await users.findByIdAndUpdate(
            userId,
            { $unset: { id_organization: '' } },
            { new: true }
        ).select(USER_SAFE_SELECT);
        if (!updatedUser) {
            return res.status(404).send('Utente non trovato');
        }
        res.status(200).json({ organization: updatedOrganization, user: updatedUser });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

/**
 * @deprecated Preferire ParametriCapitolato → linkedOrganizations.
 * Compatibilità: collega l'org al capitolato attivo del comune con budget O/S.
 */
router.put('/add-contract-to-organization', requireSuperAdmin, async (req, res) => {
    const { organizationId, contract, budgetOrdinary, budgetExtraordinary } = req.body;
    try {
        const organization = await organizations.findById(organizationId);
        if (!organization) return res.status(404).send('Organizzazione non trovata');
        if (organization.type !== 'ENTERPRISE') {
            return res.status(400).json({ error: 'Solo organizzazioni ENTERPRISE possono essere collegate al capitolato' });
        }

        const townhallId = contract?.townhall_associated || contract?.associated_townhall_id;
        if (!townhallId || !mongoose.Types.ObjectId.isValid(townhallId)) {
            return res.status(400).json({ error: 'Comune (townhall_associated) obbligatorio' });
        }

        const townhallToUpdate = await townHalls.findById(townhallId);
        if (!townhallToUpdate) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }

        const config = await getOrCreateActiveConfig(townhallId, null);
        const existing = (config.linkedOrganizations || []).find(
            (item) => String(item.organizationId) === String(organizationId)
        );
        const ordinary = budgetOrdinary != null
            ? Number(budgetOrdinary)
            : (existing ? Number(existing.budgetOrdinary) || 0 : Number(contract?.price) || 0);
        const extraordinary = budgetExtraordinary != null
            ? Number(budgetExtraordinary)
            : (existing ? Number(existing.budgetExtraordinary) || 0 : 0);

        if (!Number.isFinite(ordinary) || ordinary < 0 || !Number.isFinite(extraordinary) || extraordinary < 0) {
            return res.status(400).json({ error: 'I budget devono essere numeri >= 0' });
        }

        if (existing) {
            existing.budgetOrdinary = ordinary;
            existing.budgetExtraordinary = extraordinary;
            if (contract?.details) existing.notes = String(contract.details);
        } else {
            config.linkedOrganizations.push({
                organizationId: organization._id,
                budgetOrdinary: ordinary,
                budgetExtraordinary: extraordinary,
                notes: contract?.details ? String(contract.details) : '',
            });
        }
        await config.save();

        if (!townhallToUpdate.organizations_maintainers.some((id) => String(id) === String(organization._id))) {
            townhallToUpdate.organizations_maintainers.push(organization._id);
            await townhallToUpdate.save();
        }

        const enriched = await enrichConfigDocument(config);
        res.status(200).json({
            organization,
            capitolato: enriched,
            message: 'Organizzazione collegata al capitolato attivo del comune',
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

router.put('/associate-townhall-to-organization', requireSuperAdmin, async (req, res) => {
    const { organizationId, townhallId } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const organization = await organizations.findById(organizationId);
        if (!organization) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('Organizzazione non trovata');
        }
        organization.townhallId = townhallId;
        await organization.save();
        const townhallToUpdate = await townHalls.findById(townhallId);
        if (townhallToUpdate) {
            townhallToUpdate.organization_admin = organization._id;
            await townhallToUpdate.save();
        } else {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('Municipio non trovato');
        }
        session.commitTransaction();
        session.endSession();
        res.status(200).json(organization);
    } catch (err) {
        console.error(err);
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

const ALLOWED_ORG_UPDATE_FIELDS = ['name', 'description', 'logo', 'address', 'location', 'townhallId'];
const ADDRESS_FIELDS = ['street', 'city', 'province', 'postal_code', 'state'];
const NAME_SPECIAL_CHARS_RE = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/;

/**
 * Valida il body di aggiornamento organizzazione (PATCH parziale).
 * @returns {{ errors: string[], updates: object }}
 */
function validateOrganizationPatch(body) {
    const errors = [];
    const updates = {};

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { errors: ['Body non valido: richiesto un oggetto JSON.'], updates: {} };
    }

    const unknownKeys = Object.keys(body).filter((key) => !ALLOWED_ORG_UPDATE_FIELDS.includes(key));
    if (unknownKeys.length > 0) {
        errors.push(`Campi non consentiti: ${unknownKeys.join(', ')}. Consentiti: ${ALLOWED_ORG_UPDATE_FIELDS.join(', ')}.`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        if (typeof body.name !== 'string' || !body.name.trim()) {
            errors.push('Il nome è obbligatorio e deve essere una stringa non vuota.');
        } else if (NAME_SPECIAL_CHARS_RE.test(body.name)) {
            errors.push('Il nome non può contenere caratteri speciali.');
        } else {
            updates.name = body.name.trim();
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        if (body.description !== null && typeof body.description !== 'string') {
            errors.push('La descrizione deve essere una stringa.');
        } else {
            updates.description = body.description == null ? '' : body.description.trim();
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'logo')) {
        if (body.logo !== null && typeof body.logo !== 'string') {
            errors.push('Il logo deve essere una stringa (URL o data URL).');
        } else {
            updates.logo = body.logo == null ? '' : body.logo;
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'address')) {
        if (body.address === null) {
            updates.address = {};
        } else if (typeof body.address !== 'object' || Array.isArray(body.address)) {
            errors.push("L'indirizzo deve essere un oggetto.");
        } else {
            const addressUnknown = Object.keys(body.address).filter((key) => !ADDRESS_FIELDS.includes(key));
            if (addressUnknown.length > 0) {
                errors.push(`Campi indirizzo non consentiti: ${addressUnknown.join(', ')}.`);
            }
            const address = {};
            for (const field of ADDRESS_FIELDS) {
                if (!Object.prototype.hasOwnProperty.call(body.address, field)) continue;
                const value = body.address[field];
                if (value !== null && typeof value !== 'string') {
                    errors.push(`address.${field} deve essere una stringa.`);
                } else {
                    address[field] = value == null ? '' : value.trim();
                }
            }
            if (Object.keys(address).length > 0 || Object.keys(body.address).length === 0) {
                updates.address = address;
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'location')) {
        if (body.location === null) {
            errors.push('La location non può essere null; omettila se non va aggiornata.');
        } else if (typeof body.location !== 'object' || Array.isArray(body.location)) {
            errors.push('La location deve essere un oggetto GeoJSON Point.');
        } else {
            const { type, coordinates } = body.location;
            if (type != null && type !== 'Point') {
                errors.push('location.type deve essere "Point".');
            }
            if (!Array.isArray(coordinates) || coordinates.length !== 2) {
                errors.push('location.coordinates deve essere un array [lng, lat].');
            } else {
                const [lng, lat] = coordinates.map(Number);
                if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                    errors.push('location.coordinates deve contenere numeri validi [lng, lat].');
                } else if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
                    errors.push('location.coordinates fuori range (lng -180..180, lat -90..90).');
                } else {
                    updates.location = { type: 'Point', coordinates: [lng, lat] };
                }
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'townhallId')) {
        if (body.townhallId === null || body.townhallId === '') {
            updates.townhallId = null;
        } else if (typeof body.townhallId !== 'string' || !mongoose.Types.ObjectId.isValid(body.townhallId)) {
            errors.push('townhallId non valido.');
        } else {
            updates.townhallId = body.townhallId;
        }
    }

    if (errors.length === 0 && Object.keys(updates).length === 0) {
        errors.push('Nessun campo valido da aggiornare.');
    }

    return { errors, updates };
}

router.patch('/:id', requireSuperAdmin, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const organizationId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(organizationId)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'ID organizzazione non valido.' });
        }

        const { errors, updates } = validateOrganizationPatch(req.body);
        if (errors.length > 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'Validazione fallita.', details: errors });
        }

        const organization = await organizations.findById(organizationId).session(session);
        if (!organization) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Organizzazione non trovata.' });
        }

        const unsetFields = {};

        if (Object.prototype.hasOwnProperty.call(updates, 'townhallId')) {
            if (organization.type !== 'TOWNHALL') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    error: 'Validazione fallita.',
                    details: ['townhallId può essere modificato solo per organizzazioni di tipo TOWNHALL.'],
                });
            }

            const newTownhallId = updates.townhallId;
            const previousTownhallId = organization.townhallId ? organization.townhallId.toString() : null;

            if (newTownhallId) {
                const townhallToUpdate = await townHalls.findById(newTownhallId).session(session);
                if (!townhallToUpdate) {
                    await session.abortTransaction();
                    session.endSession();
                    return res.status(404).json({ error: 'Comune non trovato.' });
                }

                const alreadyTaken =
                    townhallToUpdate.organization_admin
                    && townhallToUpdate.organization_admin.toString() !== organizationId;
                if (alreadyTaken) {
                    await session.abortTransaction();
                    session.endSession();
                    return res.status(409).json({
                        error: "Il comune è già associato a un'altra organizzazione.",
                    });
                }

                townhallToUpdate.organization_admin = organization._id;
                await townhallToUpdate.save({ session });
            } else {
                delete updates.townhallId;
                unsetFields.townhallId = '';
            }

            if (previousTownhallId && previousTownhallId !== newTownhallId) {
                await townHalls.updateOne(
                    { _id: previousTownhallId, organization_admin: organizationId },
                    { $unset: { organization_admin: '' } },
                    { session }
                );
            }
        }

        updates.updated_at = new Date();

        const updateQuery = { $set: updates };
        if (Object.keys(unsetFields).length > 0) {
            updateQuery.$unset = unsetFields;
        }

        const updatedOrganization = await organizations.findByIdAndUpdate(
            organizationId,
            updateQuery,
            { new: true, runValidators: true, session }
        );

        await session.commitTransaction();
        session.endSession();

        res.status(200).json(updatedOrganization);
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error(err);
        if (err.name === 'ValidationError') {
            return res.status(400).json({
                error: 'Validazione schema fallita.',
                details: Object.values(err.errors).map((e) => e.message),
            });
        }
        res.status(500).json({ error: 'Errore interno del server.' });
    }
});

async function purgeOrganizationFromCapitolati(organizationId, session) {
    await MaintenanceConfig.updateMany(
        { 'linkedOrganizations.organizationId': organizationId },
        { $pull: { linkedOrganizations: { organizationId } } },
        session ? { session } : undefined
    );
}

router.delete('/:id', requireSuperAdmin, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const organizationId = req.params.id;

        await users.updateMany({ id_organization: organizationId }, { $set: { id_organization: null } }, { session });

        await townHalls.updateMany(
            { $or: [{ organization_admin: organizationId }, { organizations_maintainers: organizationId }] },
            {
                $unset: { organization_admin: '' },
                $pull: { organizations_maintainers: organizationId },
            },
            { session }
        );

        await purgeOrganizationFromCapitolati(organizationId, session);

        const deletedOrganization = await organizations.findByIdAndDelete(organizationId, { session });
        if (!deletedOrganization) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Organizzazione non trovata.' });
        }

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({ message: 'Organizzazione e riferimenti correlati puliti con successo.' });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Errore durante l'eliminazione:", error);
        res.status(500).json({ message: 'Errore interno del server.' });
    }
});

router.delete('/:id/with-users', requireSuperAdmin, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const organizationId = req.params.id;

        const deletedOrganization = await organizations.findByIdAndDelete(organizationId, { session });
        if (!deletedOrganization) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Organizzazione non trovata.' });
        }

        const result = await users.deleteMany({ id_organization: organizationId }, { session });

        await townHalls.updateMany(
            { $or: [{ organization_admin: organizationId }, { organizations_maintainers: organizationId }] },
            {
                $unset: { organization_admin: '' },
                $pull: { organizations_maintainers: organizationId },
            },
            { session }
        );

        await purgeOrganizationFromCapitolati(organizationId, session);

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: `Organizzazione e ${result.deletedCount} utenti e relativi riferimenti nei comuni eliminati con successo.`,
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Errore durante l'eliminazione a cascata:", error);
        res.status(500).json({ message: 'Errore interno del server.' });
    }
});

module.exports = router;
