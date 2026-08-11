const MaintenanceConfig = require('../schemas/maintenanceConfig');

async function nextSequentialNumber(townHallId, key, { prefix = '', padLength = 4 } = {}) {
    const year = new Date().getFullYear();
    const path = `sequences.${key}.${year}`;

    let updated = await MaintenanceConfig.findOneAndUpdate(
        { townHallId },
        { $inc: { [path]: 1 } },
        { new: true }
    );

    if (!updated) {
        updated = await MaintenanceConfig.findOneAndUpdate(
            { townHallId },
            { $set: { [path]: 1 } },
            { new: true, upsert: true }
        );
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
