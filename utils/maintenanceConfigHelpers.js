const MaintenanceConfig = require('../schemas/maintenanceConfig');
const { cloneDefaults } = require('./maintenanceConfigDefaults');

const EXPIRING_SOON_DAYS = 30;

let legacyMigrationPromise = null;

/**
 * One-shot: legacy docs without status become active.
 * Also drops the old unique-only index on townHallId if present.
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

function cloneConfigFields(source) {
    return {
        capitolatoVersion: source.capitolatoVersion,
        minDiscountPercent: source.minDiscountPercent,
        validFrom: source.validFrom || new Date(),
        validTo: source.validTo || null,
        riskClasses: (source.riskClasses || []).map((item) => (
            typeof item.toObject === 'function' ? item.toObject() : { ...item }
        )),
        faultLabels: (source.faultLabels || []).map((item) => (
            typeof item.toObject === 'function' ? item.toObject() : { ...item }
        )),
        materialCatalog: (source.materialCatalog || []).map((item) => (
            typeof item.toObject === 'function' ? item.toObject() : { ...item }
        )),
        standardTemplateId: source.standardTemplateId,
    };
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

module.exports = {
    EXPIRING_SOON_DAYS,
    ensureLegacyMigration,
    buildValidityMeta,
    findActiveConfig,
    getOrCreateActiveConfig,
    cloneConfigFields,
    copySequences,
    assertEditable,
    validateValidityRange,
};
