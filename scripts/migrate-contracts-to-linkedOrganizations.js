/**
 * Migra organizations.contracts[] → maintenanceConfig.linkedOrganizations
 * sul capitolato attivo di ogni comune, poi allinea organizations_maintainers
 * e rimuove i contracts legacy dalle organizzazioni.
 *
 * Uso:
 *   NODE_ENV=development node scripts/migrate-contracts-to-linkedOrganizations.js
 *   NODE_ENV=development node scripts/migrate-contracts-to-linkedOrganizations.js --dry-run
 *
 * Mapping: price → budgetOrdinary, details → notes, budgetExtraordinary = 0.
 * start_date/end_date non migrati (validità = capitolato).
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.resolve(__dirname, '..', envFile) });

const townHalls = require('../schemas/townHalls');
const { getOrCreateActiveConfig } = require('../utils/maintenanceConfigHelpers');

const dryRun = process.argv.includes('--dry-run');

async function connect() {
    const uri = `mongodb+srv://torelliStudio:${process.env.PASSWORD_DB}@lightingmap.vlfo8t5.mongodb.net/${process.env.NAME_DB}?retryWrites=true&w=majority&appName=LightingMap`;
    await mongoose.connect(uri);
}

function toOid(value) {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    const raw = typeof value === 'object' && value._id ? value._id : value;
    if (!mongoose.Types.ObjectId.isValid(raw)) return null;
    return new mongoose.Types.ObjectId(raw);
}

async function main() {
    await connect();
    // Lettura raw: lo schema Mongoose non espone più `contracts`
    const orgColl = mongoose.connection.collection('organizations');

    console.log(`[migrate-contracts] DB=${process.env.NAME_DB} dryRun=${dryRun}`);

    const orgs = await orgColl.find({
        type: 'ENTERPRISE',
        'contracts.0': { $exists: true },
    }).toArray();

    console.log(`[migrate-contracts] Organizzazioni ENTERPRISE con contracts: ${orgs.length}`);

    let contractsSeen = 0;
    let linkedCreated = 0;
    let linkedUpdated = 0;
    let orgsCleared = 0;
    const touchedTownHallIds = new Set();
    const orphans = [];

    for (const org of orgs) {
        const contracts = Array.isArray(org.contracts) ? org.contracts : [];

        for (const contract of contracts) {
            contractsSeen += 1;
            const townhallId = toOid(contract.townhall_associated);
            if (!townhallId) {
                orphans.push({
                    orgId: String(org._id),
                    orgName: org.name,
                    price: contract.price,
                    details: contract.details,
                    reason: 'townhall_associated mancante o non valido',
                });
                continue;
            }

            const townhall = await townHalls.findById(townhallId).select('_id name').lean();
            if (!townhall) {
                orphans.push({
                    orgId: String(org._id),
                    orgName: org.name,
                    townhallId: String(townhallId),
                    price: contract.price,
                    details: contract.details,
                    reason: 'comune non trovato (ricollegare a mano da Parametri capitolato)',
                });
                continue;
            }

            touchedTownHallIds.add(String(townhallId));
            const ordinary = Number(contract.price);
            const budgetOrdinary = Number.isFinite(ordinary) && ordinary >= 0 ? ordinary : 0;
            const notes = contract.details != null ? String(contract.details) : '';

            if (dryRun) {
                console.log(
                    `[dry-run] ${org.name} → ${townhall.name} ` +
                    `ordinaria=${budgetOrdinary} notes=${notes ? 'yes' : 'no'}`
                );
                linkedCreated += 1;
                continue;
            }

            const config = await getOrCreateActiveConfig(townhallId, null);
            const existing = (config.linkedOrganizations || []).find(
                (item) => String(item.organizationId) === String(org._id)
            );

            if (existing) {
                if (Number.isFinite(ordinary) && ordinary >= 0) {
                    existing.budgetOrdinary = budgetOrdinary;
                }
                if (notes && !existing.notes) {
                    existing.notes = notes;
                }
                linkedUpdated += 1;
            } else {
                config.linkedOrganizations.push({
                    organizationId: org._id,
                    budgetOrdinary,
                    budgetExtraordinary: 0,
                    notes,
                });
                linkedCreated += 1;
            }

            await config.save();
        }
    }

    let maintainersSynced = 0;
    if (!dryRun) {
        for (const townhallId of touchedTownHallIds) {
            const config = await getOrCreateActiveConfig(townhallId, null);
            const orgIds = (config.linkedOrganizations || [])
                .map((item) => item.organizationId)
                .filter(Boolean);
            await townHalls.updateOne(
                { _id: new mongoose.Types.ObjectId(townhallId) },
                { $set: { organizations_maintainers: orgIds } }
            );
            maintainersSynced += 1;
        }
    } else {
        maintainersSynced = touchedTownHallIds.size;
    }

    // Rimuovi sempre il campo legacy (anche orfani: vanno ricollegati a mano)
    if (!dryRun) {
        const residual = await orgColl.updateMany(
            { contracts: { $exists: true } },
            { $unset: { contracts: '' } }
        );
        orgsCleared = residual.modifiedCount ?? residual.result?.nModified ?? 0;
        console.log(
            `[migrate-contracts] $unset contracts: matched=${residual.matchedCount} modified=${orgsCleared}`
        );
    } else {
        orgsCleared = await orgColl.countDocuments({ contracts: { $exists: true } });
        console.log(`[dry-run] $unset contracts su ${orgsCleared} documenti`);
    }

    console.log('[migrate-contracts] Riepilogo');
    console.log({
        contractsSeen,
        linkedCreated,
        linkedUpdated,
        orgsCleared,
        townHallsTouched: touchedTownHallIds.size,
        maintainersSynced,
        orphans: orphans.length,
    });
    if (orphans.length > 0) {
        console.log('[migrate-contracts] Contratti non migrabili (ricollegare da Parametri capitolato):');
        for (const err of orphans) console.log(' -', err);
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('[migrate-contracts] FATAL', err);
    try {
        await mongoose.disconnect();
    } catch (_) {
        /* ignore */
    }
    process.exit(1);
});
