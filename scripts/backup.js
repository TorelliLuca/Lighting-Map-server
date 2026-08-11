/**
 * Backup completo MongoDB → Cloudflare R2 (JSON plain).
 * Uso locale: node scripts/backup.js
 * GitHub Actions: .github/workflows/backup.yml
 */
const path = require('path');
const mongoose = require('mongoose');
const {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const BACKUP_PREFIX = 'backups/';
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_BACKUP_BUCKET = 'lighting-map-backups';

function loadEnv() {
    if (process.env.MONGO_URI) return;
    const envFile = process.env.NODE_ENV === 'production'
        ? '.env.production'
        : '.env.development';
    require('dotenv').config({
        path: path.resolve(__dirname, '..', envFile),
    });
}

function getMongoUri() {
    if (process.env.MONGO_URI) return process.env.MONGO_URI;

    const password = process.env.PASSWORD_DB;
    const dbName = process.env.NAME_DB;
    if (!password || !dbName) {
        throw new Error('Imposta MONGO_URI oppure PASSWORD_DB e NAME_DB');
    }

    return `mongodb+srv://torelliStudio:${password}@lightingmap.vlfo8t5.mongodb.net/${dbName}?retryWrites=true&w=majority&appName=LightingMap`;
}

function getRetentionDays() {
    const parsed = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '', 10);
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_RETENTION_DAYS;
}

function getBackupBucket() {
    return process.env.R2_BACKUP_BUCKET_NAME
        || process.env.R2_BUCKET_NAME
        || DEFAULT_BACKUP_BUCKET;
}

function getR2Client() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error('Credenziali R2 mancanti (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    }

    return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });
}

function getBackupDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

async function listCollectionNames(db) {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return collections
        .map((entry) => entry.name)
        .filter((name) => name && !name.startsWith('system.'))
        .sort((a, b) => a.localeCompare(b));
}

async function uploadJson(client, bucket, key, payload) {
    const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
    }));
    return body.length;
}

async function exportCollections(db, client, bucket, dateKey) {
    const collectionNames = await listCollectionNames(db);
    const stats = {};
    let totalDocuments = 0;
    let totalBytes = 0;

    for (const collectionName of collectionNames) {
        const documents = await db.collection(collectionName).find({}).toArray();
        const key = `${BACKUP_PREFIX}${dateKey}/${collectionName}.json`;
        const bytes = await uploadJson(client, bucket, key, documents);

        stats[collectionName] = {
            documents: documents.length,
            bytes,
        };
        totalDocuments += documents.length;
        totalBytes += bytes;

        console.log(`✓ ${collectionName}: ${documents.length} documenti (${bytes} byte)`);
    }

    const backupInfo = {
        backup_date: new Date().toISOString(),
        backup_bucket: bucket,
        backup_prefix: `${BACKUP_PREFIX}${dateKey}/`,
        collections: stats,
        total_documents: totalDocuments,
        total_bytes: totalBytes,
    };

    const infoBytes = await uploadJson(
        client,
        bucket,
        `${BACKUP_PREFIX}${dateKey}/backup_info.json`,
        backupInfo,
    );
    totalBytes += infoBytes;

    return backupInfo;
}

async function listBackupDates(client, bucket) {
    const dates = new Set();
    let continuationToken;

    do {
        const response = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: BACKUP_PREFIX,
            ContinuationToken: continuationToken,
        }));

        for (const object of response.Contents || []) {
            const match = object.Key?.match(/^backups\/(\d{4}-\d{2}-\d{2})\//);
            if (match) dates.add(match[1]);
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return [...dates].sort((a, b) => a.localeCompare(b));
}

async function deleteBackupDate(client, bucket, dateKey) {
    const prefix = `${BACKUP_PREFIX}${dateKey}/`;
    let continuationToken;
    let deleted = 0;

    do {
        const response = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));

        for (const object of response.Contents || []) {
            if (!object.Key) continue;
            await client.send(new DeleteObjectCommand({
                Bucket: bucket,
                Key: object.Key,
            }));
            deleted += 1;
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
}

async function applyRetention(client, bucket, retentionDays) {
    const dates = await listBackupDates(client, bucket);
    if (dates.length <= retentionDays) {
        console.log(`Retention: ${dates.length} backup disponibili, nessuna pulizia necessaria`);
        return;
    }

    const datesToDelete = dates.slice(0, dates.length - retentionDays);
    for (const dateKey of datesToDelete) {
        const deleted = await deleteBackupDate(client, bucket, dateKey);
        console.log(`Rimosso backup ${dateKey} (${deleted} oggetti)`);
    }
}

async function runBackup() {
    loadEnv();

    const mongoUri = getMongoUri();
    const bucket = getBackupBucket();
    const retentionDays = getRetentionDays();
    const dateKey = getBackupDateKey();
    const client = getR2Client();

    console.log(`Backup MongoDB → R2 (${bucket}/${BACKUP_PREFIX}${dateKey}/)`);

    await mongoose.connect(mongoUri);

    try {
        const db = mongoose.connection.db;
        const backupInfo = await exportCollections(db, client, bucket, dateKey);
        await applyRetention(client, bucket, retentionDays);

        console.log('\n✅ Backup completato');
        console.log(`   Documenti: ${backupInfo.total_documents}`);
        console.log(`   Dimensione: ${backupInfo.total_bytes} byte`);
        console.log(`   Retention: ${retentionDays} giorni`);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    runBackup().catch((error) => {
        console.error('Backup fallito:', error.message);
        process.exit(1);
    });
}

module.exports = { runBackup };
