const express = require('express');
const mongoose = require('mongoose');
const MaintenanceConfig = require('../schemas/maintenanceConfig');
const townHalls = require('../schemas/townHalls');
const { cloneDefaults } = require('../utils/maintenanceConfigDefaults');
const { importMaterialCatalogFromBra } = require('../utils/braCatalogImport');
const { parsePrezziarioCsv } = require('../utils/prezziarioCsvImport');
const {
    STAFF_ROLES,
    CONFIG_EDITOR_ROLES,
    requireRole,
    requireTownHallAccess,
    requireTownHallEdit,
} = require('../utils/roles');

const router = express.Router();

async function resolveTownHallId(townHallIdOrName) {
    if (mongoose.Types.ObjectId.isValid(townHallIdOrName)) {
        const byId = await townHalls.findById(townHallIdOrName).select('_id name');
        if (byId) return byId;
    }
    return townHalls.findOne({ name: { $eq: townHallIdOrName } }).select('_id name');
}

async function getOrCreateConfig(townHallId, userId) {
    let config = await MaintenanceConfig.findOne({ townHallId });
    if (config) return config;

    const defaults = cloneDefaults();
    config = await MaintenanceConfig.create({
        townHallId,
        ...defaults,
        updatedBy: userId || null,
    });
    return config;
}

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

        const config = await getOrCreateConfig(townHall._id, req.currentUser._id);
        return res.json({ townHall, config });
    } catch (error) {
        console.error('Errore GET maintenance-config by-name:', error);
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

        const config = await getOrCreateConfig(townHall._id, req.currentUser._id);
        return res.json({ townHall, config });
    } catch (error) {
        console.error('Errore GET maintenance-config:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.put('/:townHallId', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const townHall = await resolveTownHallId(req.params.townHallId);
        if (!townHall) {
            return res.status(404).json({ error: 'Comune non trovato' });
        }
        if (!(await requireTownHallEdit(req, res, townHall._id))) return;

        const allowedFields = [
            'capitolatoVersion',
            'minDiscountPercent',
            'validFrom',
            'validTo',
            'riskClasses',
            'faultLabels',
            'materialCatalog',
            'standardTemplateId',
        ];

        const defaults = cloneDefaults();
        const updatePayload = { updatedBy: req.currentUser._id };
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updatePayload[field] = req.body[field];
            }
        }

        let config = await MaintenanceConfig.findOne({ townHallId: townHall._id });
        if (!config) {
            config = await MaintenanceConfig.create({
                townHallId: townHall._id,
                ...defaults,
                ...updatePayload,
            });
            return res.json({ townHall, config });
        }

        Object.assign(config, updatePayload);
        await config.save();

        return res.json({ townHall, config });
    } catch (error) {
        console.error('Errore PUT maintenance-config:', error);
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

        const { code, description, udm, unitPrice, category, isStandard } = req.body || {};
        if (!code || !description || unitPrice == null) {
            return res.status(400).json({ error: 'code, description e unitPrice sono obbligatori' });
        }

        const config = await getOrCreateConfig(townHall._id, req.currentUser._id);
        const exists = config.materialCatalog.some((item) => item.code === code);
        if (exists) {
            return res.status(409).json({ error: 'Materiale già presente con questo codice tariffa' });
        }

        config.materialCatalog.push({
            code,
            description,
            udm: udm || 'cad',
            unitPrice: Number(unitPrice),
            category: category || '',
            isStandard: isStandard !== false,
        });
        config.updatedBy = req.currentUser._id;
        await config.save();

        return res.status(201).json({ townHall, config });
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

        const config = await MaintenanceConfig.findOne({ townHallId: townHall._id });
        if (!config) {
            return res.status(404).json({ error: 'Configurazione non trovata' });
        }

        const item = config.materialCatalog.find((m) => m.code === req.params.code);
        if (!item) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        const { description, udm, unitPrice, category, isStandard } = req.body || {};
        if (description !== undefined) item.description = description;
        if (udm !== undefined) item.udm = udm;
        if (unitPrice !== undefined) item.unitPrice = Number(unitPrice);
        if (category !== undefined) item.category = category;
        if (isStandard !== undefined) item.isStandard = isStandard;

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        return res.json({ townHall, config });
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

        const config = await MaintenanceConfig.findOne({ townHallId: townHall._id });
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

        return res.json({ townHall, config });
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
        const config = await getOrCreateConfig(townHall._id, req.currentUser._id);

        if (merge === true) {
            const byCode = new Map(config.materialCatalog.map((m) => [m.code, m]));
            for (const material of materials) {
                byCode.set(material.code, material);
            }
            config.materialCatalog = [...byCode.values()];
        } else {
            config.materialCatalog = materials;
        }

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        return res.json({
            townHall,
            config,
            importedCount: materials.length,
            skippedRows,
        });
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
        const config = await getOrCreateConfig(townHall._id, req.currentUser._id);

        const merge = req.body?.merge === true;
        if (!merge) {
            config.materialCatalog = materials;
        } else {
            const byCode = new Map(config.materialCatalog.map((m) => [m.code, m]));
            for (const material of materials) {
                byCode.set(material.code, material);
            }
            config.materialCatalog = [...byCode.values()];
        }

        config.updatedBy = req.currentUser._id;
        config.markModified('materialCatalog');
        await config.save();

        return res.json({
            townHall,
            config,
            importedCount: materials.length,
        });
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
        const config = await MaintenanceConfig.findOneAndUpdate(
            { townHallId: townHall._id },
            {
                $set: {
                    riskClasses: defaults.riskClasses,
                    faultLabels: defaults.faultLabels,
                    capitolatoVersion: defaults.capitolatoVersion,
                    standardTemplateId: defaults.standardTemplateId,
                    updatedBy: req.currentUser._id,
                },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        return res.json({ townHall, config });
    } catch (error) {
        console.error('Errore apply-defaults:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

module.exports = router;
