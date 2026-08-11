function appendStatusHistory(target, { status, by, note = '' }) {
    if (!target) return [];
    if (!Array.isArray(target.statusHistory)) {
        target.statusHistory = [];
    }
    target.statusHistory.push({
        status,
        at: new Date(),
        by: by || null,
        note: note || '',
    });
    return target.statusHistory;
}

module.exports = {
    appendStatusHistory,
};
