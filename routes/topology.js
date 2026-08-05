const express = require('express');
const users = require('../schemas/users');
const {
    TopologyError,
    applyUndirectedEdges,
    validateEdgesOnly,
    setParent,
    clearParent,
    getTree
} = require('../utils/topologyService');

const router = express.Router();

const TOPOLOGY_EDITOR_ROLES = new Set(['SUPER_ADMIN', 'SURVEYOR']);

async function requireTopologyEditor(req, res) {
    const requester = await users.findById(req.user.id).select('user_type');
    if (!requester || !TOPOLOGY_EDITOR_ROLES.has(requester.user_type)) {
        res.status(403).json({ error: 'Accesso negato, non possiedi i diritti necessari!' });
        return null;
    }
    return requester;
}

function handleTopologyError(res, err) {
    if (err instanceof TopologyError) {
        return res.status(err.status).json(err.payload);
    }
    console.error('Errore topologia:', err);
    return res.status(500).json({ error: 'Errore del server: ' + err.message });
}

/**
 * POST /topology/edges
 * Body: { town_hall, quadro, edges: [{a,b}], validate_only?, replace_all? }
 */
router.post('/edges', async (req, res) => {
    try {
        if (!(await requireTopologyEditor(req, res))) return;

        const {
            town_hall: townHall,
            quadro,
            edges,
            validate_only: validateOnly = false,
            replace_all: replaceAll = true
        } = req.body || {};

        if (!townHall || quadro == null || quadro === '') {
            return res.status(400).json({
                error: 'Parametri obbligatori: town_hall, quadro, edges.'
            });
        }

        const result = await applyUndirectedEdges({
            townHallRef: townHall,
            quadro,
            edges: edges || [],
            validateOnly: Boolean(validateOnly),
            replaceAll: replaceAll !== false
        });

        return res.status(validateOnly ? 200 : 201).json(result);
    } catch (err) {
        return handleTopologyError(res, err);
    }
});

/**
 * POST /topology/validate
 * Stesso body di /edges, solo diagnostica.
 */
router.post('/validate', async (req, res) => {
    try {
        if (!(await requireTopologyEditor(req, res))) return;

        const { town_hall: townHall, quadro, edges, replace_all: replaceAll = true } = req.body || {};

        if (!townHall || quadro == null || quadro === '') {
            return res.status(400).json({
                error: 'Parametri obbligatori: town_hall, quadro, edges.'
            });
        }

        const result = await validateEdgesOnly({
            townHallRef: townHall,
            quadro,
            edges: edges || [],
            replaceAll: replaceAll !== false
        });

        return res.json(result);
    } catch (err) {
        return handleTopologyError(res, err);
    }
});

/**
 * PATCH /topology/parent/:childId
 * Body: { parent: ObjectId | null }
 */
router.patch('/parent/:childId', async (req, res) => {
    try {
        if (!(await requireTopologyEditor(req, res))) return;

        const { childId } = req.params;
        const parent = req.body?.parent ?? null;

        const result = await setParent(childId, parent);
        return res.json(result);
    } catch (err) {
        return handleTopologyError(res, err);
    }
});

/**
 * DELETE /topology/parent/:childId
 * Scollega il nodo (parent = null).
 */
router.delete('/parent/:childId', async (req, res) => {
    try {
        if (!(await requireTopologyEditor(req, res))) return;

        const result = await clearParent(req.params.childId);
        return res.json(result);
    } catch (err) {
        return handleTopologyError(res, err);
    }
});

/**
 * GET /topology/tree?town_hall=&quadro=  oppure  ?root_id=
 */
router.get('/tree', async (req, res) => {
    try {
        const townHall = req.query.town_hall || req.query.townHall;
        const quadro = req.query.quadro;
        const rootId = req.query.root_id || req.query.rootId;

        if (!rootId && (!townHall || quadro == null || quadro === '')) {
            return res.status(400).json({
                error: 'Specificare root_id oppure town_hall + quadro.'
            });
        }

        const result = await getTree({
            townHallRef: townHall,
            quadro,
            rootId
        });

        return res.json(result);
    } catch (err) {
        return handleTopologyError(res, err);
    }
});

module.exports = router;
