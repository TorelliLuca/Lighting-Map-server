const MaintenanceConfig = require('../schemas/maintenanceConfig');
const {
    cloneDefaults,
    normalizeFaultLabelsList,
} = require('./maintenanceConfigDefaults');

const EXPIRING_SOON_DAYS = 30;

let legacyMigrationPromise = null;

/**
 * One-shot: legacy docs without status become active.
 * Also drops the old unique-only index on townHallId if present.
 * Backfill applicableTo + voci quadro mancanti su faultLabels.
 */
async function ensureLegacyMigration() {
    if (legacyMigrationPromise) return legacyMigrationPromise;

    legacyMigrationPromise = (async () => {
        try {
            await MaintenanceConfig.updateMany(
                { $or: [{ status: { $exists: false } }, { status: null }] },
                { $set: { status: 'active' } }
            );

            const indexes = await MaintenanceConfig.collection.indexes();
            const oldUnique = indexes.find(
                (idx) =>
                    idx.unique
                    && idx.key
                    && Object.keys(idx.key).length === 1
                    && idx.key.townHallId === 1
                    && !idx.partialFilterExpression
            );
            if (oldUnique?.name) {
                await MaintenanceConfig.collection.dropIndex(oldUnique.name);
            }

            await MaintenanceConfig.syncIndexes();

            const configs = await MaintenanceConfig.find({}).select('faultLabels');
            for (const config of configs) {
                const current = Array.isArray(config.faultLabels) ? config.faultLabels : [];
                const needsApplicableTo = current.some(
                    (item) => !Array.isArray(item.applicableTo) || item.applicableTo.length === 0
                );
                const codes = new Set(current.map((item) => item.code));
                const { DEFAULT_FAULT_LABELS } = require('./maintenanceConfigDefaults');
                const missingDefaults = DEFAULT_FAULT_LABELS.some((item) => !codes.has(item.code));
                if (!needsApplicableTo && !missingDefaults) continue;
                config.faultLabels = normalizeFaultLabelsList(current);
                config.markModified('faultLabels');
                await config.save();
            }
        } catch (error) {
            console.error('Migrazione maintenanceConfig legacy fallita:', error);
            legacyMigrationPromise = null;
            throw error;
        }
    })();

    return legacyMigrationPromise;
}

function mapToPlainObject(mapOrObj) {
    if (!mapOrObj) return {};
    if (mapOrObj instanceof Map) {
        return Object.fromEntries(mapOrObj.entries());
    }
    if (typeof mapOrObj.toObject === 'function') {
        return mapOrObj.toObject();
    }
    return { ...mapOrObj };
}

function buildValidityMeta(config, { thresholdDays = EXPIRING_SOON_DAYS } = {}) {
    const validFrom = config?.validFrom || null;
    const validTo = config?.validTo || null;

    if (!validTo) {
        return {
            validFrom,
            validTo: null,
            daysRemaining: null,
            isExpiringSoon: false,
            isExpired: false,
        };
    }

    const now = new Date();
    const end = new Date(validTo);
    // Compare by calendar day (UTC midnight of validTo date)
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / msPerDay);
    const isExpired = daysRemaining < 0;
    const isExpiringSoon = !isExpired && daysRemaining <= thresholdDays;

    return {
        validFrom,
        validTo,
        daysRemaining,
        isExpiringSoon,
        isExpired,
    };
}

async function findActiveConfig(townHallId) {
    await ensureLegacyMigration();
    return MaintenanceConfig.findOne({ townHallId, status: 'active' });
}

async function getOrCreateActiveConfig(townHallId, userId) {
    await ensureLegacyMigration();

    let config = await MaintenanceConfig.findOne({ townHallId, status: 'active' });
    if (config) return config;

    // Legacy single doc without matching status filter (should be rare after migration)
    const legacy = await MaintenanceConfig.findOne({ townHallId, status: { $nin: ['draft', 'archived'] } });
    if (legacy) {
        if (legacy.status !== 'active') {
            legacy.status = 'active';
            await legacy.save();
        }
        return legacy;
    }

    const defaults = cloneDefaults();
    config = await MaintenanceConfig.create({
        townHallId,
        status: 'active',
        ...defaults,
        updatedBy: userId || null,
    });
    return config;
}

function cloneLinkedOrganizations(source) {
    return (source.linkedOrganizations || []).map((item) => {
        const plain = typeof item.toObject === 'function' ? item.toObject() : { ...item };
        return {
            organizationId: plain.organizationId,
            budgetOrdinary: Number(plain.budgetOrdinary) || 0,
            budgetExtraordinary: Number(plain.budgetExtraordinary) || 0,
            notes: plain.notes || '',
        };
    });
}

function cloneConfigFields(source) {
    return {
        capitolatoVersion: source.capitolatoVersion,
        minDiscountPercent: source.minDiscountPercent,
        validFrom: source.validFrom || new Date(),
        validTo: source.validTo || null,
        riskClasses: (source.riskClasses || []).map((item) => (
            typeof item.toObject === 'function' ? item.toObject() : { ...item }
        )),
        faultLabels: normalizeFaultLabelsList(
            (source.faultLabels || []).map((item) => (
                typeof item.toObject === 'function' ? item.toObject() : { ...item }
            ))
        ),
        materialCatalog: (source.materialCatalog || [])
            .filter((item) => (item.priceType || 'capitolato') !== 'regional')
            .map((item) => (
                typeof item.toObject === 'function' ? item.toObject() : { ...item }
            )),
        materialCategories: [...(source.materialCategories || [])],
        regionalPriceListId: source.regionalPriceListId || null,
        linkedOrganizations: cloneLinkedOrganizations(source),
        standardTemplateId: source.standardTemplateId,
    };
}

/**
 * Normalizza e deduplica le organizzazioni collegate al capitolato.
 * @returns {{ ok: true, value: object[] } | { ok: false, error: string }}
 */
function normalizeLinkedOrganizations(list) {
    if (list == null) return { ok: true, value: [] };
    if (!Array.isArray(list)) {
        return { ok: false, error: 'linkedOrganizations deve essere un array' };
    }

    const mongoose = require('mongoose');
    const seen = new Set();
    const value = [];

    for (const item of list) {
        if (!item || typeof item !== 'object') {
            return { ok: false, error: 'Ogni elemento di linkedOrganizations deve essere un oggetto' };
        }
        const rawId = item.organizationId?._id || item.organizationId;
        if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
            return { ok: false, error: 'organizationId non valido in linkedOrganizations' };
        }
        const key = String(rawId);
        if (seen.has(key)) continue;
        seen.add(key);

        const budgetOrdinary = Number(item.budgetOrdinary);
        const budgetExtraordinary = Number(item.budgetExtraordinary);
        if (!Number.isFinite(budgetOrdinary) || budgetOrdinary < 0) {
            return { ok: false, error: 'budgetOrdinary deve essere un numero >= 0' };
        }
        if (!Number.isFinite(budgetExtraordinary) || budgetExtraordinary < 0) {
            return { ok: false, error: 'budgetExtraordinary deve essere un numero >= 0' };
        }

        value.push({
            organizationId: rawId,
            budgetOrdinary,
            budgetExtraordinary,
            notes: item.notes == null ? '' : String(item.notes).trim(),
        });
    }

    return { ok: true, value };
}

function copySequences(source) {
    return {
        quotes: mapToPlainObject(source.sequences?.quotes),
        verifications: mapToPlainObject(source.sequences?.verifications),
    };
}

function assertEditable(config) {
    if (!config) return { ok: false, status: 404, error: 'Configurazione non trovata' };
    if (config.status === 'archived') {
        return { ok: false, status: 403, error: 'Il capitolato archiviato è in sola lettura' };
    }
    return { ok: true };
}

/**
 * Entrata in vigore non può essere posteriore alla scadenza (e viceversa).
 * validTo null = senza scadenza → ok.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateValidityRange(validFrom, validTo) {
    if (validFrom == null || validFrom === '') {
        return { ok: false, error: "La data di entrata in vigore è obbligatoria" };
    }
    if (validTo == null || validTo === '') {
        return { ok: true };
    }

    const from = new Date(validFrom);
    const to = new Date(validTo);
    if (Number.isNaN(from.getTime())) {
        return { ok: false, error: 'Data di entrata in vigore non valida' };
    }
    if (Number.isNaN(to.getTime())) {
        return { ok: false, error: 'Data di scadenza non valida' };
    }

    const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    if (fromDay > toDay) {
        return {
            ok: false,
            error: "La data di entrata in vigore non può essere posteriore alla data di scadenza",
        };
    }
    return { ok: true };
}

/**
 * Unisce un import di voci con un dato priceType nel catalogo esistente.
 * - merge=true: upsert per codice
 * - merge=false: sostituisce solo le voci di quel priceType; conserva le altre
 */
function mergeCatalogByPriceType(existingCatalog, importedMaterials, priceType, merge) {
    const existing = Array.isArray(existingCatalog) ? existingCatalog : [];
    const imported = (importedMaterials || []).map((item) => ({
        ...(typeof item.toObject === 'function' ? item.toObject() : item),
        priceType,
        addedBy: priceType === 'user' ? (item.addedBy || '') : '',
        isStandard: priceType !== 'user',
    }));

    if (merge === true) {
        const byCode = new Map(existing.map((m) => [m.code, typeof m.toObject === 'function' ? m.toObject() : { ...m }]));
        for (const material of imported) {
            byCode.set(material.code, material);
        }
        return [...byCode.values()];
    }

    const preserved = existing
        .filter((m) => (m.priceType || 'capitolato') !== priceType)
        .map((m) => (typeof m.toObject === 'function' ? m.toObject() : { ...m }));
    return [...preserved, ...imported];
}

function mergeMaterialCategories(existingCategories, materials, defaults = []) {
    const set = new Set(
        [...(defaults || []), ...(existingCategories || []), ...(materials || []).map((m) => m.category)]
            .map((c) => String(c || '').trim())
            .filter(Boolean)
    );
    return [...set];
}

function toPlainMaterial(item) {
    return typeof item?.toObject === 'function' ? item.toObject() : { ...item };
}

const NP_CODE_RE = /^NP-?(\d+)$/i;
const NP_SEQ_PAD = 3;

/** Estrae il progressivo da un codice NP (es. NP-001 → 1). */
function parseNpSequence(code) {
    const match = NP_CODE_RE.exec(String(code || '').trim());
    if (!match) return null;
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) ? n : null;
}

/** Formatta un progressivo come NP-001. */
function formatNpCode(n) {
    return `NP-${String(Math.max(0, Number(n) || 0)).padStart(NP_SEQ_PAD, '0')}`;
}

/** Normalizza NP-1 → NP-001; lascia invariati i codici non-NP. */
function normalizeNpCode(code) {
    const n = parseNpSequence(code);
    return n == null ? String(code || '').trim() : formatNpCode(n);
}

/**
 * Prossimo codice NP-n in base ai nuovi prezzi già presenti nel catalogo
 * (e a eventuali codici extra, es. voci già in bozza preventivo).
 */
function nextNpCode(catalog = [], extraCodes = []) {
    let max = 0;
    for (const item of catalog || []) {
        const n = parseNpSequence(item?.code);
        if (n != null && n > max) max = n;
    }
    for (const code of extraCodes || []) {
        const n = parseNpSequence(code);
        if (n != null && n > max) max = n;
    }
    return formatNpCode(max + 1);
}

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/** Normalizza una sotto-voce BOM / children. */
function normalizeBomItem(item = {}) {
    const { normalizeUdm } = require('./udm');
    return {
        materialCode: String(item.materialCode || '').trim(),
        description: String(item.description || '').trim(),
        fullDescription: String(item.fullDescription || '').trim(),
        udm: normalizeUdm(item.udm),
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        category: String(item.category || '').trim(),
        isAdHoc: Boolean(item.isAdHoc),
    };
}

/** Somma qty × prezzo delle sotto-voci (prezzo unitario del padre NP). */
function sumBomUnitPrice(bom = []) {
    return round2(
        (bom || []).reduce((sum, item) => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unitPrice) || 0;
            return sum + qty * price;
        }, 0)
    );
}

/**
 * Normalizza children di una line item.
 * I NP devono avere componenti reali in distinta: non si sintetizzano più
 * sotto-voci dal solo testo del padre.
 */
function normalizeLineItemChildren(item = {}) {
    const rawChildren = Array.isArray(item.children) ? item.children : [];
    return rawChildren
        .map(normalizeBomItem)
        .filter((c) => c.description);
}

/** NP (isAdHoc) senza almeno un componente con descrizione. */
function isEmptyNpLine(item = {}) {
    if (!item?.isAdHoc) return false;
    const children = Array.isArray(item.children) ? item.children : [];
    return !children.some((child) => String(child?.description || '').trim());
}

/**
 * Elenco 1-based delle voci NP senza componenti.
 * @returns {number[]}
 */
function findEmptyNpLineNumbers(lineItems = []) {
    const numbers = [];
    (lineItems || []).forEach((item, index) => {
        if (isEmptyNpLine(item)) numbers.push(index + 1);
    });
    return numbers;
}

function emptyNpValidationError(lineItems = []) {
    const numbers = findEmptyNpLineNumbers(lineItems);
    if (numbers.length === 0) return null;
    if (numbers.length === 1) {
        return `Il nuovo prezzo (voce ${numbers[0]}) non ha componenti nella distinta`;
    }
    return `I nuovi prezzi alle voci ${numbers.join(', ')} non hanno componenti nella distinta`;
}

function normalizeBomList(bom = []) {
    return (bom || [])
        .map(normalizeBomItem)
        .filter((c) => c.description);
}

/** Solo voci locali (user/capitolato) da persistere sul config. */
function stripRegionalFromCatalog(catalog) {
    const { normalizeUdm } = require('./udm');
    return (catalog || [])
        .filter((item) => (item.priceType || 'capitolato') !== 'regional')
        .map((item) => {
            const plain = toPlainMaterial(item);
            return {
                ...plain,
                udm: normalizeUdm(plain.udm),
                bom: normalizeBomList(plain.bom),
            };
        });
}

/**
 * Catalogo effettivo capitolato = voci prezziario regionale collegato + voci locali.
 * Se non c'è un list collegato, conserva eventuali voci regional legacy sul config.
 */
function buildEffectiveMaterialCatalog(config, regionalList) {
    const localAll = (config?.materialCatalog || []).map(toPlainMaterial);
    const localOnly = localAll.filter((item) => (item.priceType || 'capitolato') !== 'regional');
    const legacyRegional = localAll.filter((item) => item.priceType === 'regional');

    const fromList = (regionalList?.materials || []).map((item) => ({
        ...toPlainMaterial(item),
        priceType: 'regional',
        addedBy: '',
        isStandard: true,
    }));

    if (fromList.length > 0) {
        return [...fromList, ...localOnly];
    }
    return [...legacyRegional, ...localOnly];
}

async function enrichConfigDocument(config) {
    if (!config) return null;
    const RegionalPriceList = require('../schemas/regionalPriceList');
    const Organizations = require('../schemas/organizations');
    const plain = typeof config.toObject === 'function' ? config.toObject() : { ...config };
    plain.faultLabels = normalizeFaultLabelsList(plain.faultLabels);

    let regionalList = null;
    if (plain.regionalPriceListId) {
        regionalList = await RegionalPriceList.findById(plain.regionalPriceListId).lean();
    }

    plain.materialCatalog = buildEffectiveMaterialCatalog(plain, regionalList);
    plain.regionalPriceList = regionalList
        ? {
            _id: regionalList._id,
            name: regionalList.name,
            description: regionalList.description || '',
            categories: regionalList.categories || [],
            materialsCount: (regionalList.materials || []).length,
        }
        : null;

    const linked = Array.isArray(plain.linkedOrganizations) ? plain.linkedOrganizations : [];
    if (linked.length > 0) {
        const orgIds = linked
            .map((item) => item.organizationId)
            .filter(Boolean);
        const orgs = await Organizations.find({ _id: { $in: orgIds } })
            .select('_id name type logo description address')
            .lean();
        const byId = new Map(orgs.map((org) => [String(org._id), org]));
        plain.linkedOrganizations = linked.map((item) => {
            const id = String(item.organizationId || '');
            return {
                organizationId: item.organizationId,
                budgetOrdinary: Number(item.budgetOrdinary) || 0,
                budgetExtraordinary: Number(item.budgetExtraordinary) || 0,
                notes: item.notes || '',
                organization: byId.get(id) || null,
            };
        });
    } else {
        plain.linkedOrganizations = [];
    }

    const { DEFAULT_MATERIAL_CATEGORIES } = require('./maintenanceConfigDefaults');
    plain.effectiveCategories = mergeMaterialCategories(
        plain.materialCategories,
        plain.materialCatalog,
        [
            ...DEFAULT_MATERIAL_CATEGORIES,
            ...(regionalList?.categories || []),
        ]
    );

    return plain;
}

module.exports = {
    EXPIRING_SOON_DAYS,
    ensureLegacyMigration,
    buildValidityMeta,
    findActiveConfig,
    getOrCreateActiveConfig,
    cloneConfigFields,
    cloneLinkedOrganizations,
    normalizeLinkedOrganizations,
    copySequences,
    assertEditable,
    validateValidityRange,
    mergeCatalogByPriceType,
    mergeMaterialCategories,
    stripRegionalFromCatalog,
    buildEffectiveMaterialCatalog,
    enrichConfigDocument,
    parseNpSequence,
    formatNpCode,
    normalizeNpCode,
    nextNpCode,
    normalizeBomItem,
    normalizeBomList,
    normalizeLineItemChildren,
    sumBomUnitPrice,
    isEmptyNpLine,
    findEmptyNpLineNumbers,
    emptyNpValidationError,
};
