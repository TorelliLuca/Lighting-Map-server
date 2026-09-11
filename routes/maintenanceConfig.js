const express = require('express');
const mongoose = require('mongoose');
const MaintenanceConfig = require('../schemas/maintenanceConfig');
const townHalls = require('../schemas/townHalls');
const {
    ensureLegacyMigration,
    buildValidityMeta,
    getOrCreateActiveConfig,
    findActiveConfig,
    cloneConfigFields,
    copySequences,
    assertEditable,
    validateValidityRange,
    mergeCatalogByPriceType,
    mergeMaterialCategories,
    stripRegionalFromCatalog,
    enrichConfigDocument,
    normalizeLinkedOrganizations,
    nextNpCode,
    parseNpSequence,
    normalizeNpCode,
    normalizeBomList,
    sumBomUnitPrice,
} = require('../utils/maintenanceConfigHelpers');
const { cloneDefaults, DEFAULT_MATERIAL_CATEGORIES } = require('../utils/maintenanceConfigDefaults');
const { importMaterialCatalogFromBra } = require('../utils/braCatalogImport');
const { parsePrezziarioCsv } = require('../utils/prezziarioCsvImport');
const { normalizeUdm } = require('../utils/udm');
const {
    STAFF_ROLES,
    CONFIG_EDITOR_ROLES,
    requireRole,
    requireTownHallAccess,
    requireTownHallEdit,
} = require('../utils/roles');
const Organizations = require('../schemas/organizations');

const router = express.Router();

const EDITABLE_FIELDS = [
    'capitolatoVersion',
    'minDiscountPercent',
    'validFrom',
    'validTo',
    'riskClasses',
    'faultLabels',
    'materialCatalog',
    'materialCategories',
    'regionalPriceListId',
    'linkedOrganizations',
    'standardTemplateId',
];

async function resolveTownHallId(townHallIdOrName) {
    if (mongoose.Types.ObjectId.isValid(townHallIdOrName)) {
        const byId = await townHalls.findById(townHallIdOrName).select('_id name');
        if (byId) return byId;
    }
    return townHalls.findOne({ name: { $eq: townHallIdOrName } }).select('_id name');
}

/**
 * Allinea townHall.organizations_maintainers agli org collegati al capitolato.
 */
async function syncTownHallMaintainers(townHallId, linkedOrganizations) {
    const orgIds = (linkedOrganizations || [])
        .map((item) => item.organizationId)
        .filter(Boolean);
    await townHalls.findByIdAndUpdate(townHallId, {
        $set: { organizations_maintainers: orgIds },
    });
}

function applyEditableFields(target, body, userId) {
    for (const field of EDITABLE_FIELDS) {
        if (body[field] === undefined) continue;
        if (field === 'materialCatalog') {
            target.materialCatalog = stripRegionalFromCatalog(body.materialCatalog);
            continue;
        }
        if (field === 'regionalPriceListId') {
            target.regionalPriceListId = body.regionalPriceListId || null;
            continue;
        }
        if (field === 'linkedOrganizations') {
            const normalized = normalizeLinkedOrganizations(body.linkedOrganizations);
            if (!normalized.ok) {
                const error = new Error(normalized.error);
                error.status = 400;
                throw error;
            }
            target.linkedOrganizations = normalized.value;
            continue;
        }
        target[field] = body[field];
    }
    target.updatedBy = userId;
}

async function activeResponse(townHall, config) {
    return {
        townHall,
        config: await enrichConfigDocument(config),
        validity: buildValidityMeta(config),
    };
}

async function configResponse(townHall, config, extra = {}) {
    return {
        townHall,
        config: await enrichConfigDocument(config),
        ...extra,
    };
}

// Ensure legacy migration runs once when routes are loaded
ensureLegacyMigration().catch(() => {});

router.get('/defaults', requireRole(...STAFF_ROLES), (_req, res) => {
    res.json(cloneDefaults());
});

router.get('/by-name/:townHallName', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallName);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallAccess(req, res, townHall._id))) return;

        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);
        return res.json(await activeResponse(townHall, config));
    } catch (error) {
        console.error('Errore GET maintenance-config by-name:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// --- Version / config-id endpoints (must be before /:townHallId) ---

router.get('/config/:configId', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        if (!config) {
            return res.status(404).json({ error: 'Configurazione non trovata' });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.json({
            ...(await configResponse(townHall, config)),
            validity: buildValidityMeta(config),
        });
    } catch (error) {
        console.error('Errore GET config by id:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.put('/config/:configId', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const prevLinked = JSON.stringify(config.linkedOrganizations || []);
        try {
            applyEditableFields(config, req.body || {}, req.currentUser._id);
        } catch (fieldError) {
            if (fieldError.status === 400) {
                return res.status(400).json({ error: fieldError.message });
            }
            throw fieldError;
        }

        if (req.body?.linkedOrganizations !== undefined) {
            const orgIds = (config.linkedOrganizations || []).map((item) => item.organizationId);
            if (orgIds.length > 0) {
                const count = await Organizations.countDocuments({
                    _id: { $in: orgIds },
                    type: 'ENTERPRISE',
                });
                if (count !== orgIds.length) {
                    return res.status(400).json({
                        error: 'Tutte le organizzazioni collegate devono esistere ed essere di tipo ENTERPRISE',
                    });
                }
            }
        }

        const rangeCheck = validateValidityRange(config.validFrom, config.validTo);
        if (!rangeCheck.ok) {
            return res.status(400).json({ error: rangeCheck.error });
        }
        await config.save();

        if (
            req.body?.linkedOrganizations !== undefined
            && config.status === 'active'
            && prevLinked !== JSON.stringify(config.linkedOrganizations || [])
        ) {
            await syncTownHallMaintainers(config.townHallId, config.linkedOrganizations);
        }

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.json({ ...(await configResponse(townHall, config)), validity: buildValidityMeta(config) });
    } catch (error) {
        console.error('Errore PUT config by id:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.patch('/config/:configId/extend', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        if (req.body?.validTo === undefined) {
            return res.status(400).json({ error: 'validTo è obbligatorio (null = senza scadenza)' });
        }

        const nextValidTo = req.body.validTo === null || req.body.validTo === ''
            ? null
            : new Date(req.body.validTo);
        const rangeCheck = validateValidityRange(config.validFrom, nextValidTo);
        if (!rangeCheck.ok) {
            return res.status(400).json({ error: rangeCheck.error });
        }

        config.validTo = nextValidTo;
        config.updatedBy = req.currentUser._id;
        await config.save();

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.json({ ...(await configResponse(townHall, config)), validity: buildValidityMeta(config) });
    } catch (error) {
        console.error('Errore PATCH extend:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/config/:configId/activate', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const draft = await MaintenanceConfig.findById(req.params.configId);
        if (!draft) {
            return res.status(404).json({ error: 'Configurazione non trovata' });
        }
        if (draft.status !== 'draft') {
            return res.status(400).json({ error: 'Solo una bozza può essere attivata' });
        }
        if (!(await requireTownHallEdit(req, res, draft.townHallId))) return;

        const currentActive = await findActiveConfig(draft.townHallId);
        const sequences = currentActive
            ? copySequences(currentActive)
            : { quotes: {}, verifications: {} };

        if (currentActive) {
            currentActive.status = 'archived';
            currentActive.updatedBy = req.currentUser._id;
            await currentActive.save();
        }

        draft.status = 'active';
        draft.sequences = sequences;
        draft.updatedBy = req.currentUser._id;
        draft.markModified('sequences');
        await draft.save();

        await syncTownHallMaintainers(draft.townHallId, draft.linkedOrganizations);

        const townHall = await townHalls.findById(draft.townHallId).select('_id name');
        return res.json({ ...(await configResponse(townHall, draft)), archivedConfigId: currentActive?._id || null, validity: buildValidityMeta(draft) });
    } catch (error) {
        console.error('Errore POST activate:', error);
        if (error?.code === 11000) {
            return res.status(409).json({ error: 'Esiste già un capitolato attivo per questo comune' });
        }
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/config/:configId/materials', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const { code, description, fullDescription, udm, unitPrice, category, isStandard, priceType, addedBy } = req.body || {};
        if (!code || !description || unitPrice == null) {
            return res.status(400).json({ error: 'code, description e unitPrice sono obbligatori' });
        }

        const exists = config.materialCatalog.some((item) => item.code === code);
        if (exists) {
            return res.status(409).json({ error: 'Materiale già presente con questo codice tariffa' });
        }

        const resolvedPriceType = ['regional', 'user', 'capitolato'].includes(priceType)
            ? priceType
            : 'capitolato';

        config.materialCatalog.push({
            code,
            description,
            fullDescription: fullDescription != null ? String(fullDescription) : '',
            udm: normalizeUdm(udm),
            unitPrice: Number(unitPrice),
            category: category || '',
            isStandard: isStandard !== false,
            priceType: resolvedPriceType,
            addedBy: resolvedPriceType === 'user' ? (addedBy || '') : '',
        });
        config.updatedBy = req.currentUser._id;
        await config.save();

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.status(201).json(await configResponse(townHall, config));
    } catch (error) {
        console.error('Errore POST material by configId:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.patch('/config/:configId/materials/:code', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const item = config.materialCatalog.find((m) => m.code === req.params.code);
        if (!item) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        const { description, fullDescription, udm, unitPrice, category, isStandard, priceType, addedBy } = req.body || {};
        if (description !== undefined) item.description = description;
        if (fullDescription !== undefined) item.fullDescription = String(fullDescription || '');
        if (udm !== undefined) item.udm = normalizeUdm(udm);
        if (unitPrice !== undefined) item.unitPrice = Number(unitPrice);
        if (category !== undefined) item.category = category;
        if (isStandard !== undefined) item.isStandard = isStandard;
        if (priceType !== undefined) {
            if (!['regional', 'user', 'capitolato'].includes(priceType)) {
                return res.status(400).json({ error: 'priceType non valido' });
            }
            item.priceType = priceType;
            if (priceType !== 'user') item.addedBy = '';
        }
        if (addedBy !== undefined && (item.priceType === 'user' || priceType === 'user')) {
            item.addedBy = addedBy || '';
        }

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.json(await configResponse(townHall, config));
    } catch (error) {
        console.error('Errore PATCH material by configId:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.delete('/config/:configId/materials/:code', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const before = config.materialCatalog.length;
        config.materialCatalog = config.materialCatalog.filter((m) => m.code !== req.params.code);
        if (config.materialCatalog.length === before) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.json(await configResponse(townHall, config));
    } catch (error) {
        console.error('Errore DELETE material by configId:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/config/:configId/import-csv', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const { csv, merge } = req.body || {};
        if (!csv || typeof csv !== 'string') {
            return res.status(400).json({ error: 'Contenuto CSV mancante' });
        }

        const { materials, skippedRows } = parsePrezziarioCsv(csv);

        // Legacy: se il comune ha un prezziario regionale collegato, importa lì.
        if (config.regionalPriceListId) {
            const RegionalPriceList = require('../schemas/regionalPriceList');
            const list = await RegionalPriceList.findById(config.regionalPriceListId);
            if (!list) {
                return res.status(404).json({ error: 'Prezziario regionale collegato non trovato' });
            }
            const imported = materials.map((item) => ({
                code: item.code,
                description: item.description,
                fullDescription: item.fullDescription || '',
                udm: normalizeUdm(item.udm),
                unitPrice: item.unitPrice,
                category: item.category || '',
            }));
            if (merge === true) {
                const byCode = new Map((list.materials || []).map((m) => [m.code, {
                    code: m.code,
                    description: m.description,
                    fullDescription: m.fullDescription || '',
                    udm: normalizeUdm(m.udm),
                    unitPrice: m.unitPrice,
                    category: m.category,
                }]));
                for (const material of imported) byCode.set(material.code, material);
                list.materials = [...byCode.values()];
            } else {
                list.materials = imported;
            }
            list.categories = mergeMaterialCategories(list.categories, list.materials, DEFAULT_MATERIAL_CATEGORIES);
            list.updatedBy = req.currentUser._id;
            list.markModified('materials');
            list.markModified('categories');
            await list.save();
        } else {
            config.materialCatalog = mergeCatalogByPriceType(
                config.materialCatalog,
                materials,
                'regional',
                merge === true
            );
            config.materialCategories = mergeMaterialCategories(
                config.materialCategories,
                materials,
                DEFAULT_MATERIAL_CATEGORIES
            );
            config.updatedBy = req.currentUser._id;
            config.markModified('materialCatalog');
            config.markModified('materialCategories');
            await config.save();
        }

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        const fresh = await MaintenanceConfig.findById(config._id);
        return res.json({
            ...(await configResponse(townHall, fresh)),
            importedCount: materials.length,
            skippedRows,
        });
    } catch (error) {
        console.error('Errore import-csv by configId:', error);
        return res.status(400).json({ error: error.message || 'Errore import CSV' });
    }
});

router.post('/config/:configId/import-bra', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const materials = importMaterialCatalogFromBra();
        const merge = req.body?.merge === true;

        config.materialCatalog = mergeCatalogByPriceType(
            config.materialCatalog,
            materials,
            'capitolato',
            merge
        );
        config.materialCategories = mergeMaterialCategories(
            config.materialCategories,
            materials,
            DEFAULT_MATERIAL_CATEGORIES
        );

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        config.markModified('materialCategories');
        await config.save();

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.json({ ...(await configResponse(townHall, config)), importedCount: materials.length });
    } catch (error) {
        console.error('Errore import-bra by configId:', error);
        return res.status(500).json({ error: error.message || 'Errore del server' });
    }
});

router.post('/config/:configId/apply-defaults', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.configId)) {
            return res.status(400).json({ error: 'ID configurazione non valido' });
        }

        const config = await MaintenanceConfig.findById(req.params.configId);
        const editable = assertEditable(config);
        if (!editable.ok) {
            return res.status(editable.status).json({ error: editable.error });
        }
        if (!(await requireTownHallEdit(req, res, config.townHallId))) return;

        const defaults = cloneDefaults();
        config.riskClasses = defaults.riskClasses;
        config.faultLabels = defaults.faultLabels;
        config.capitolatoVersion = defaults.capitolatoVersion;
        config.standardTemplateId = defaults.standardTemplateId;
        if (defaults.materialCategories) {
            config.materialCategories = defaults.materialCategories;
        }
        config.updatedBy = req.currentUser._id;
        await config.save();

        const townHall = await townHalls.findById(config.townHallId).select('_id name');
        return res.json({ ...(await configResponse(townHall, config)), validity: buildValidityMeta(config) });
    } catch (error) {
        console.error('Errore apply-defaults by configId:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.get('/:townHallId/versions', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        await getOrCreateActiveConfig(townHall._id, req.currentUser._id);

        const versions = await MaintenanceConfig.find({ townHallId: townHall._id })
            .select('_id capitolatoVersion status validFrom validTo updatedAt createdAt')
            .sort({ status: 1, updatedAt: -1 })
            .lean();

        const statusOrder = { active: 0, draft: 1, archived: 2 };
        versions.sort((a, b) => {
            const da = statusOrder[a.status] ?? 9;
            const db = statusOrder[b.status] ?? 9;
            if (da !== db) return da - db;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });

        return res.json({ townHall, versions });
    } catch (error) {
        console.error('Errore GET versions:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/:townHallId/draft', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const existingDraft = await MaintenanceConfig.findOne({
            townHallId: townHall._id,
            status: 'draft',
        });
        if (existingDraft) {
            return res.status(409).json({
                error: 'Esiste già una bozza per questo comune',
                draftId: existingDraft._id,
            });
        }

        const active = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);
        const cloned = cloneConfigFields(active);

        if (req.body?.capitolatoVersion !== undefined) {
            cloned.capitolatoVersion = req.body.capitolatoVersion;
        }
        if (req.body?.validFrom !== undefined) {
            cloned.validFrom = new Date(req.body.validFrom);
        }
        if (req.body?.validTo !== undefined) {
            cloned.validTo = req.body.validTo === null || req.body.validTo === ''
                ? null
                : new Date(req.body.validTo);
        }

        if (!cloned.validFrom) {
            return res.status(400).json({ error: 'validFrom è obbligatorio per la bozza' });
        }

        const rangeCheck = validateValidityRange(cloned.validFrom, cloned.validTo);
        if (!rangeCheck.ok) {
            return res.status(400).json({ error: rangeCheck.error });
        }

        const draft = await MaintenanceConfig.create({
            townHallId: townHall._id,
            status: 'draft',
            ...cloned,
            sequences: { quotes: {}, verifications: {} },
            updatedBy: req.currentUser._id,
        });

        return res.status(201).json({
            ...(await configResponse(townHall, draft)),
            validity: buildValidityMeta(draft),
        });
    } catch (error) {
        console.error('Errore POST draft:', error);
        if (error?.code === 11000) {
            return res.status(409).json({ error: 'Esiste già una bozza per questo comune' });
        }
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.get('/:townHallId', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallAccess(req, res, townHall._id))) return;

        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);
        return res.json(await activeResponse(townHall, config));
    } catch (error) {
        console.error('Errore GET maintenance-config:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// Legacy PUT by townHallId → updates active only
router.put('/:townHallId', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);
        try {
            applyEditableFields(config, req.body || {}, req.currentUser._id);
        } catch (fieldError) {
            if (fieldError.status === 400) {
                return res.status(400).json({ error: fieldError.message });
            }
            throw fieldError;
        }
        const rangeCheck = validateValidityRange(config.validFrom, config.validTo);
        if (!rangeCheck.ok) {
            return res.status(400).json({ error: rangeCheck.error });
        }
        await config.save();

        if (req.body?.linkedOrganizations !== undefined) {
            await syncTownHallMaintainers(townHall._id, config.linkedOrganizations);
        }

        return res.json(await activeResponse(townHall, config));
    } catch (error) {
        console.error('Errore PUT maintenance-config:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

// Legacy material/import routes → operate on active
/**
 * Upsert di un Nuovo Prezzo (NP) sul capitolato attivo.
 * Accessibile anche ai manutentori: numerazione NP-n basata sul prezziario attivo.
 */
router.post('/:townHallId/materials/np', requireRole(...STAFF_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallAccess(req, res, townHall._id))) return;

        const {
            code: requestedCode,
            description,
            fullDescription,
            udm,
            unitPrice,
            category,
            bom,
        } = req.body || {};

        if (!description || String(description).trim() === '') {
            return res.status(400).json({ error: 'description è obbligatoria' });
        }

        const normalizedBom = normalizeBomList(bom);
        const computedUnitPrice = normalizedBom.length > 0
            ? sumBomUnitPrice(normalizedBom)
            : (Number(unitPrice) || 0);

        if (normalizedBom.length === 0 && (unitPrice == null || unitPrice === '')) {
            return res.status(400).json({ error: 'unitPrice è obbligatorio se non è presente una distinta BOM' });
        }

        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);
        const enriched = await enrichConfigDocument(config);
        const catalog = enriched?.materialCatalog || [];

        const addedBy = [req.currentUser.name, req.currentUser.surname]
            .filter(Boolean)
            .join(' ')
            .trim() || req.currentUser.email || '';

        let code = String(requestedCode || '').trim();
        if (code && parseNpSequence(code) == null) {
            return res.status(400).json({ error: 'Il codice NP deve essere nel formato NP-n (es. NP-001)' });
        }
        if (!code) {
            code = nextNpCode(catalog);
        } else {
            code = normalizeNpCode(code);
        }

        const existingIndex = config.materialCatalog.findIndex(
            (item) => normalizeNpCode(item.code) === code || item.code === code
        );
        const payload = {
            code,
            description: String(description).trim(),
            fullDescription: fullDescription != null ? String(fullDescription).trim() : '',
            udm: normalizeUdm(udm),
            unitPrice: computedUnitPrice,
            category: category || '',
            isStandard: false,
            priceType: 'user',
            addedBy,
            bom: normalizedBom,
        };

        if (existingIndex >= 0) {
            const existing = config.materialCatalog[existingIndex];
            const existingType = existing.priceType || 'capitolato';
            if (existingType !== 'user' && parseNpSequence(existing.code) == null) {
                return res.status(409).json({ error: 'Codice tariffa già presente nel prezziario' });
            }
            config.materialCatalog[existingIndex] = {
                ...(typeof existing.toObject === 'function' ? existing.toObject() : existing),
                ...payload,
                priceType: 'user',
                isStandard: false,
                addedBy: addedBy || existing.addedBy || '',
            };
        } else {
            // Evita collisioni se il codice era solo nel prezziario regionale
            if (catalog.some((item) => item.code === code && (item.priceType || '') === 'regional')) {
                code = nextNpCode(catalog);
                payload.code = code;
            }
            config.materialCatalog.push(payload);
        }

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        return res.status(existingIndex >= 0 ? 200 : 201).json({
            ...(await configResponse(townHall, config)),
            materialCode: payload.code,
        });
    } catch (error) {
        console.error('Errore POST material NP:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/:townHallId/materials', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const { code, description, fullDescription, udm, unitPrice, category, isStandard, priceType, addedBy } = req.body || {};
        if (!code || !description || unitPrice == null) {
            return res.status(400).json({ error: 'code, description e unitPrice sono obbligatori' });
        }

        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);
        const exists = config.materialCatalog.some((item) => item.code === code);
        if (exists) {
            return res.status(409).json({ error: 'Materiale già presente con questo codice tariffa' });
        }

        const resolvedPriceType = ['regional', 'user', 'capitolato'].includes(priceType)
            ? priceType
            : 'capitolato';

        config.materialCatalog.push({
            code,
            description,
            fullDescription: fullDescription != null ? String(fullDescription) : '',
            udm: normalizeUdm(udm),
            unitPrice: Number(unitPrice),
            category: category || '',
            isStandard: isStandard !== false,
            priceType: resolvedPriceType,
            addedBy: resolvedPriceType === 'user' ? (addedBy || '') : '',
        });
        config.updatedBy = req.currentUser._id;
        await config.save();

        return res.status(201).json(await configResponse(townHall, config));
    } catch (error) {
        console.error('Errore POST material:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.patch('/:townHallId/materials/:code', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const config = await findActiveConfig(townHall._id);
        if (!config) {
            return res.status(404).json({ error: 'Configurazione non trovata' });
        }

        const item = config.materialCatalog.find((m) => m.code === req.params.code);
        if (!item) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        const { description, fullDescription, udm, unitPrice, category, isStandard, priceType, addedBy } = req.body || {};
        if (description !== undefined) item.description = description;
        if (fullDescription !== undefined) item.fullDescription = String(fullDescription || '');
        if (udm !== undefined) item.udm = normalizeUdm(udm);
        if (unitPrice !== undefined) item.unitPrice = Number(unitPrice);
        if (category !== undefined) item.category = category;
        if (isStandard !== undefined) item.isStandard = isStandard;
        if (priceType !== undefined) {
            if (!['regional', 'user', 'capitolato'].includes(priceType)) {
                return res.status(400).json({ error: 'priceType non valido' });
            }
            item.priceType = priceType;
            if (priceType !== 'user') item.addedBy = '';
        }
        if (addedBy !== undefined && (item.priceType === 'user' || priceType === 'user')) {
            item.addedBy = addedBy || '';
        }

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        return res.json(await configResponse(townHall, config));
    } catch (error) {
        console.error('Errore PATCH material:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.delete('/:townHallId/materials/:code', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const config = await findActiveConfig(townHall._id);
        if (!config) {
            return res.status(404).json({ error: 'Configurazione non trovata' });
        }

        const before = config.materialCatalog.length;
        config.materialCatalog = config.materialCatalog.filter((m) => m.code !== req.params.code);
        if (config.materialCatalog.length === before) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        return res.json(await configResponse(townHall, config));
    } catch (error) {
        console.error('Errore DELETE material:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/:townHallId/import-csv', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const { csv, merge } = req.body || {};
        if (!csv || typeof csv !== 'string') {
            return res.status(400).json({ error: 'Contenuto CSV mancante' });
        }

        const { materials, skippedRows } = parsePrezziarioCsv(csv);
        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);

        config.materialCatalog = mergeCatalogByPriceType(
            config.materialCatalog,
            materials,
            'regional',
            merge === true
        );
        config.materialCategories = mergeMaterialCategories(
            config.materialCategories,
            materials,
            DEFAULT_MATERIAL_CATEGORIES
        );

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        config.markModified('materialCategories');
        await config.save();

        return res.json({ ...(await configResponse(townHall, config)), importedCount: materials.length, skippedRows });
    } catch (error) {
        console.error('Errore import-csv:', error);
        return res.status(400).json({ error: error.message || 'Errore import CSV' });
    }
});

router.post('/:townHallId/import-bra', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const materials = importMaterialCatalogFromBra();
        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);

        const merge = req.body?.merge === true;
        config.materialCatalog = mergeCatalogByPriceType(
            config.materialCatalog,
            materials,
            'capitolato',
            merge
        );
        config.materialCategories = mergeMaterialCategories(
            config.materialCategories,
            materials,
            DEFAULT_MATERIAL_CATEGORIES
        );

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        config.markModified('materialCategories');
        await config.save();

        return res.json({ ...(await configResponse(townHall, config)), importedCount: materials.length });
    } catch (error) {
        console.error('Errore import-bra:', error);
        return res.status(500).json({ error: error.message || 'Errore del server' });
    }
});

router.post('/:townHallId/apply-defaults', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const defaults = cloneDefaults();
        const config = await getOrCreateActiveConfig(townHall._id, req.currentUser._id);
        config.riskClasses = defaults.riskClasses;
        config.faultLabels = defaults.faultLabels;
        config.capitolatoVersion = defaults.capitolatoVersion;
        config.standardTemplateId = defaults.standardTemplateId;
        if (defaults.materialCategories) {
            config.materialCategories = defaults.materialCategories;
        }
        config.updatedBy = req.currentUser._id;
        await config.save();

        return res.json({ ...(await configResponse(townHall, config)), validity: buildValidityMeta(config) });
    } catch (error) {
        console.error('Errore apply-defaults:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

module.exports = router;
