const express = require('express');
const mongoose = require('mongoose');
const RegionalPriceList = require('../schemas/regionalPriceList');
const MaintenanceConfig = require('../schemas/maintenanceConfig');
const townHalls = require('../schemas/townHalls');
const { parsePrezziarioCsv } = require('../utils/prezziarioCsvImport');
const { DEFAULT_MATERIAL_CATEGORIES } = require('../utils/maintenanceConfigDefaults');
const { mergeMaterialCategories } = require('../utils/maintenanceConfigHelpers');
const { normalizeUdm } = require('../utils/udm');
const {
    CONFIG_EDITOR_ROLES,
    requireRole,
} = require('../utils/roles');

const router = express.Router();

function normalizeCategories(categories, materials = []) {
    // Non reimporre sempre i default: altrimenti delete categoria non persiste.
    const base = Array.isArray(categories) && categories.length > 0
        ? categories
        : DEFAULT_MATERIAL_CATEGORIES;
    return mergeMaterialCategories(base, materials, []);
}

function normalizeMaterials(materials = []) {
    return materials.map((item) => ({
        code: String(item.code || '').trim(),
        description: String(item.description || '').trim(),
        fullDescription: String(item.fullDescription || '').trim(),
        udm: normalizeUdm(item.udm),
        unitPrice: Number(item.unitPrice) || 0,
        category: String(item.category || '').trim(),
    })).filter((item) => item.code && item.description);
}

async function listLinkedTownHallIds(regionalPriceListId) {
    const configs = await MaintenanceConfig.find({
        regionalPriceListId,
        status: { $in: ['active', 'draft'] },
    }).select('townHallId status').lean();

    const byTown = new Map();
    for (const cfg of configs) {
        const key = String(cfg.townHallId);
        if (!byTown.has(key)) byTown.set(key, cfg.townHallId);
    }
    return [...byTown.values()];
}

async function serializeList(list) {
    const plain = typeof list.toObject === 'function' ? list.toObject() : { ...list };
    const townHallIds = await listLinkedTownHallIds(plain._id);
    const towns = await townHalls.find({ _id: { $in: townHallIds } }).select('_id name').lean();
    return {
        ...plain,
        materialsCount: (plain.materials || []).length,
        townHallIds: towns.map((t) => t._id),
        townHalls: towns,
    };
}

router.get('/', requireRole(...CONFIG_EDITOR_ROLES), async (_req, res) => {
    try {
        const lists = await RegionalPriceList.find().sort({ name: 1 });
        const serialized = await Promise.all(lists.map((list) => serializeList(list)));
        return res.json({ lists: serialized });
    } catch (error) {
        console.error('Errore GET regional price lists:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.get('/:id', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID prezziario regionale non valido' });
        }
        const list = await RegionalPriceList.findById(req.params.id);
        if (!list) {
            return res.status(404).json({ error: 'Prezziario regionale non trovato' });
        }
        return res.json({ list: await serializeList(list) });
    } catch (error) {
        console.error('Errore GET regional price list:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        if (!name) {
            return res.status(400).json({ error: 'Il nome del prezziario regionale è obbligatorio' });
        }

        const materials = normalizeMaterials(req.body?.materials);
        const categories = normalizeCategories(req.body?.categories, materials);

        const list = await RegionalPriceList.create({
            name,
            description: String(req.body?.description || '').trim(),
            categories,
            materials,
            updatedBy: req.currentUser._id,
        });

        const townHallIds = Array.isArray(req.body?.townHallIds) ? req.body.townHallIds : [];
        if (townHallIds.length > 0) {
            await syncAssociations(list._id, townHallIds, req.currentUser._id);
        }

        const fresh = await RegionalPriceList.findById(list._id);
        return res.status(201).json({ list: await serializeList(fresh) });
    } catch (error) {
        console.error('Errore POST regional price list:', error);
        if (error?.code === 11000) {
            return res.status(409).json({ error: 'Esiste già un prezziario regionale con questo nome' });
        }
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.put('/:id', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID prezziario regionale non valido' });
        }

        const list = await RegionalPriceList.findById(req.params.id);
        if (!list) {
            return res.status(404).json({ error: 'Prezziario regionale non trovato' });
        }

        if (req.body?.name !== undefined) {
            const name = String(req.body.name || '').trim();
            if (!name) {
                return res.status(400).json({ error: 'Il nome del prezziario regionale è obbligatorio' });
            }
            list.name = name;
        }
        if (req.body?.description !== undefined) {
            list.description = String(req.body.description || '').trim();
        }
        if (req.body?.materials !== undefined) {
            list.materials = normalizeMaterials(req.body.materials);
        }
        if (req.body?.categories !== undefined || req.body?.materials !== undefined) {
            list.categories = normalizeCategories(
                req.body?.categories !== undefined ? req.body.categories : list.categories,
                list.materials
            );
        }

        list.updatedBy = req.currentUser._id;
        list.markModified('materials');
        list.markModified('categories');
        await list.save();

        if (Array.isArray(req.body?.townHallIds)) {
            await syncAssociations(list._id, req.body.townHallIds, req.currentUser._id);
        }

        const fresh = await RegionalPriceList.findById(list._id);
        return res.json({ list: await serializeList(fresh) });
    } catch (error) {
        console.error('Errore PUT regional price list:', error);
        if (error?.code === 11000) {
            return res.status(409).json({ error: 'Esiste già un prezziario regionale con questo nome' });
        }
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.put('/:id/associations', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID prezziario regionale non valido' });
        }
        const list = await RegionalPriceList.findById(req.params.id);
        if (!list) {
            return res.status(404).json({ error: 'Prezziario regionale non trovato' });
        }
        if (!Array.isArray(req.body?.townHallIds)) {
            return res.status(400).json({ error: 'townHallIds deve essere un array' });
        }

        await syncAssociations(list._id, req.body.townHallIds, req.currentUser._id);
        return res.json({ list: await serializeList(list) });
    } catch (error) {
        console.error('Errore PUT regional associations:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

router.post('/:id/import-csv', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID prezziario regionale non valido' });
        }
        const list = await RegionalPriceList.findById(req.params.id);
        if (!list) {
            return res.status(404).json({ error: 'Prezziario regionale non trovato' });
        }

        const { csv, merge } = req.body || {};
        if (!csv || typeof csv !== 'string') {
            return res.status(400).json({ error: 'Contenuto CSV mancante' });
        }

        const { materials, skippedRows } = parsePrezziarioCsv(csv);
        const imported = materials.map((item) => ({
            code: item.code,
            description: item.description,
            fullDescription: item.fullDescription || '',
            udm: item.udm || 'cad',
            unitPrice: item.unitPrice,
            category: item.category || '',
        }));

        if (merge === true) {
            const byCode = new Map((list.materials || []).map((m) => [m.code, {
                code: m.code,
                description: m.description,
                fullDescription: m.fullDescription || '',
                udm: m.udm,
                unitPrice: m.unitPrice,
                category: m.category,
            }]));
            for (const material of imported) {
                byCode.set(material.code, material);
            }
            list.materials = [...byCode.values()];
        } else {
            list.materials = imported;
        }

        list.categories = normalizeCategories(list.categories, list.materials);
        list.updatedBy = req.currentUser._id;
        list.markModified('materials');
        list.markModified('categories');
        await list.save();

        return res.json({
            list: await serializeList(list),
            importedCount: imported.length,
            skippedRows,
        });
    } catch (error) {
        console.error('Errore import-csv regional:', error);
        return res.status(400).json({ error: error.message || 'Errore import CSV' });
    }
});

router.delete('/:id', requireRole(...CONFIG_EDITOR_ROLES), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID prezziario regionale non valido' });
        }
        const list = await RegionalPriceList.findById(req.params.id);
        if (!list) {
            return res.status(404).json({ error: 'Prezziario regionale non trovato' });
        }

        await MaintenanceConfig.updateMany(
            { regionalPriceListId: list._id },
            { $set: { regionalPriceListId: null } }
        );
        await list.deleteOne();

        return res.json({ ok: true });
    } catch (error) {
        console.error('Errore DELETE regional price list:', error);
        return res.status(500).json({ error: 'Errore del server' });
    }
});

/**
 * Associa il prezziario regionale ai comuni indicati (active + draft).
 * I comuni non più presenti vengono scollegati da questo list.
 */
async function syncAssociations(regionalPriceListId, townHallIds, userId) {
    const validIds = townHallIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    const uniqueIds = [...new Map(validIds.map((id) => [String(id), id])).values()];

    await MaintenanceConfig.updateMany(
        {
            regionalPriceListId,
            townHallId: { $nin: uniqueIds },
            status: { $in: ['active', 'draft'] },
        },
        { $set: { regionalPriceListId: null, updatedBy: userId } }
    );

    if (uniqueIds.length === 0) return;

    await MaintenanceConfig.updateMany(
        {
            townHallId: { $in: uniqueIds },
            status: { $in: ['active', 'draft'] },
        },
        { $set: { regionalPriceListId, updatedBy: userId } }
    );
}

module.exports = router;
