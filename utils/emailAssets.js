const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    isR2Configured,
    putObject,
    deleteObject,
    listObjects,
    EMAIL_ASSETS_PREFIX,
} = require('./r2Client');

const ASSETS_DIR = path.join(__dirname, '..', 'uploads', 'email-assets');
const PUBLIC_MOUNT = '/email-assets';
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

function ensureAssetsDir() {
    if (!fs.existsSync(ASSETS_DIR)) {
        fs.mkdirSync(ASSETS_DIR, { recursive: true });
    }
}

function getPublicBaseUrl(req) {
    if (process.env.SERVER_PUBLIC_URL) {
        return String(process.env.SERVER_PUBLIC_URL).replace(/\/$/, '');
    }
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}`;
}

function publicUrlFor(filename, req) {
    return `${getPublicBaseUrl(req)}${PUBLIC_MOUNT}/${encodeURIComponent(filename)}`;
}

function sanitizeBaseName(name) {
    const base = String(name || 'image')
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return base || 'image';
}

function parseBase64Payload({ data, filename, mimeType }) {
    let mime = mimeType;
    let b64 = data;

    if (typeof data === 'string' && data.startsWith('data:')) {
        const match = /^data:([^;]+);base64,(.+)$/s.exec(data);
        if (!match) {
            const err = new Error('Data URL non valido');
            err.status = 400;
            throw err;
        }
        mime = match[1];
        b64 = match[2];
    }

    const ext = ALLOWED_MIME[mime];
    if (!ext) {
        const err = new Error('Formato non supportato (usa JPG, PNG, GIF o WebP)');
        err.status = 400;
        throw err;
    }

    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) {
        const err = new Error('File vuoto');
        err.status = 400;
        throw err;
    }
    if (buffer.length > MAX_BYTES) {
        const err = new Error('Immagine troppo grande (max 2 MB)');
        err.status = 400;
        throw err;
    }

    const stamp = Date.now();
    const rand = crypto.randomBytes(3).toString('hex');
    const safe = sanitizeBaseName(filename);
    const finalName = `${stamp}-${rand}-${safe}.${ext}`;

    return { buffer, mime, finalName };
}

async function listAssets(req) {
    if (isR2Configured()) {
        return listObjects({ prefix: EMAIL_ASSETS_PREFIX });
    }
    ensureAssetsDir();
    return fs.readdirSync(ASSETS_DIR)
        .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
        .map((filename) => {
            const full = path.join(ASSETS_DIR, filename);
            const stat = fs.statSync(full);
            return {
                filename,
                url: publicUrlFor(filename, req),
                size: stat.size,
                updatedAt: stat.mtime.toISOString(),
            };
        })
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/**
 * Salva un'immagine da base64 data-URL o raw base64.
 * Con R2 configurato carica su Cloudflare e restituisce l'URL pubblico del bucket.
 * @returns {Promise<{ filename, url, size, storage }>}
 */
async function saveAssetFromBase64({ data, filename, mimeType }, req) {
    const { buffer, mime, finalName } = parseBase64Payload({ data, filename, mimeType });

    if (isR2Configured()) {
        const key = `${EMAIL_ASSETS_PREFIX}${finalName}`;
        const uploaded = await putObject({
            key,
            body: buffer,
            contentType: mime,
        });
        return {
            filename: finalName,
            url: uploaded.url,
            size: uploaded.size,
            storage: 'r2',
        };
    }

    ensureAssetsDir();
    const dest = path.join(ASSETS_DIR, finalName);
    fs.writeFileSync(dest, buffer);

    return {
        filename: finalName,
        url: publicUrlFor(finalName, req),
        size: buffer.length,
        storage: 'local',
    };
}

async function deleteAsset(filename) {
    const safe = path.basename(filename);
    if (safe !== filename || !/\.(jpe?g|png|gif|webp)$/i.test(safe)) {
        const err = new Error('Nome file non valido');
        err.status = 400;
        throw err;
    }

    if (isR2Configured()) {
        await deleteObject(`${EMAIL_ASSETS_PREFIX}${safe}`);
        return true;
    }

    ensureAssetsDir();
    const full = path.join(ASSETS_DIR, safe);
    if (!fs.existsSync(full)) {
        const err = new Error('File non trovato');
        err.status = 404;
        throw err;
    }
    fs.unlinkSync(full);
    return true;
}

module.exports = {
    ASSETS_DIR,
    PUBLIC_MOUNT,
    MAX_BYTES,
    ensureAssetsDir,
    listAssets,
    saveAssetFromBase64,
    deleteAsset,
    publicUrlFor,
    getPublicBaseUrl,
    isR2Configured,
};
