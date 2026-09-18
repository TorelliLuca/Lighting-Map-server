const MaintenanceConfig = require('../schemas/maintenanceConfig');
const { ensureLegacyMigration } = require('./maintenanceConfigHelpers');

async function nextSequentialNumber(townHallId, key, { prefix = '', padLength = 4 } = {}) {
    await ensureLegacyMigration();

    const year = new Date().getFullYear();
    const path = `sequences.${key}.${year}`;
    const activeFilter = { townHallId, status: 'active' };

    let updated = await MaintenanceConfig.findOneAndUpdate(
        activeFilter,
        { $inc: { [path]: 1 } },
        { new: true }
    );

    if (!updated) {
        // Active config should already exist; avoid upsert that could create a second active
        updated = await MaintenanceConfig.findOneAndUpdate(
            activeFilter,
            { $set: { [path]: 1 } },
            { new: true }
        );
    }

    if (!updated) {
        throw new Error('Capitolato attivo non trovato per la numerazione progressiva');
    }

    const current = updated?.sequences?.[key]?.get?.(String(year))
        ?? updated?.sequences?.[key]?.[year]
        ?? 1;

    const padded = String(current).padStart(padLength, '0');
    return {
        year,
        counter: current,
        formatted: prefix ? `${prefix}-${year}-${padded}` : `${year}-${padded}`,
    };
}

module.exports = {
    nextSequentialNumber,
};
