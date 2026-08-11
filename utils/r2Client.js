const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

/**
 * Client S3-compatibile per Cloudflare R2.
 * Attivo solo se tutte le env R2_* richieste sono impostate.
 */

function isR2Configured() {
    return Boolean(
        process.env.R2_ACCOUNT_ID
        && process.env.R2_ACCESS_KEY_ID
        && process.env.R2_SECRET_ACCESS_KEY
        && process.env.R2_BUCKET_NAME
        && process.env.R2_PUBLIC_URL
    );
}

let _client = null;

function getR2Client() {
    if (!isR2Configured()) return null;
    if (_client) return _client;

    const accountId = process.env.R2_ACCOUNT_ID;
    _client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    return _client;
}

function getBucket() {
    return process.env.R2_BUCKET_NAME;
}

function getPublicBaseUrl() {
    return String(process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
}

function publicUrlForKey(key) {
    const encodedPath = String(key)
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    return `${getPublicBaseUrl()}/${encodedPath}`;
}

async function putObject({ key, body, contentType }) {
    const client = getR2Client();
    if (!client) {
        const err = new Error('R2 non configurato');
        err.status = 500;
        throw err;
    }
    await client.send(new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
    return { key, url: publicUrlForKey(key), size: body.length };
}

async function deleteObject(key) {
    const client = getR2Client();
    if (!client) {
        const err = new Error('R2 non configurato');
        err.status = 500;
        throw err;
    }
    await client.send(new DeleteObjectCommand({
        Bucket: getBucket(),
        Key: key,
    }));
    return true;
}

async function listObjects({ prefix = 'email-assets/' } = {}) {
    const client = getR2Client();
    if (!client) return [];

    const out = [];
    let continuationToken;
    do {
        const res = await client.send(new ListObjectsV2Command({
            Bucket: getBucket(),
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        for (const obj of res.Contents || []) {
            if (!obj.Key || obj.Key.endsWith('/')) continue;
            const filename = obj.Key.slice(prefix.length) || obj.Key;
            if (!/\.(jpe?g|png|gif|webp)$/i.test(filename)) continue;
            out.push({
                filename,
                key: obj.Key,
                url: publicUrlForKey(obj.Key),
                size: obj.Size || 0,
                updatedAt: obj.LastModified
                    ? new Date(obj.LastModified).toISOString()
                    : new Date(0).toISOString(),
            });
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

module.exports = {
    isR2Configured,
    getR2Client,
    putObject,
    deleteObject,
    listObjects,
    publicUrlForKey,
    EMAIL_ASSETS_PREFIX: 'email-assets/',
};
