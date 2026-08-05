const mongoose = require('mongoose');
const lightPoints = require('../schemas/lightPoints');
const townHalls = require('../schemas/townHalls');
const {
    toIdString,
    localPower,
    validateUndirectedEdges,
    orientFromRoot,
    aggregatePowerBottomUp,
    edgesFromParentPointers,
    buildAdjacency,
    planParentLink
} = require('./topology');

class TopologyError extends Error {
    constructor(status, payload) {
        super(payload.message || payload.error || 'Errore topologia');
        this.name = 'TopologyError';
        this.status = status;
        this.payload = payload;
    }
}

function nodeLabel(doc) {
    if (!doc) return null;
    return {
        _id: toIdString(doc._id),
        numero_palo: doc.numero_palo || '',
        marker: doc.marker || '',
        quadro: doc.quadro || ''
    };
}

function enrichAnomaly(anomaly, byId) {
    const out = { ...anomaly };
    if (anomaly.edge) {
        out.edge = {
            a: anomaly.edge.a,
            b: anomaly.edge.b,
            a_label: byId.get(anomaly.edge.a) ? nodeLabel(byId.get(anomaly.edge.a)) : null,
            b_label: byId.get(anomaly.edge.b) ? nodeLabel(byId.get(anomaly.edge.b)) : null
        };
    }
    if (anomaly.nodeId) {
        out.node = byId.get(anomaly.nodeId) ? nodeLabel(byId.get(anomaly.nodeId)) : { _id: anomaly.nodeId };
    }
    return out;
}

async function resolveTownHall(townHallRef) {
    if (!townHallRef) return null;
    if (mongoose.Types.ObjectId.isValid(townHallRef) && String(new mongoose.Types.ObjectId(townHallRef)) === String(townHallRef)) {
        const byId = await townHalls.findById(townHallRef).select('name punti_luce');
        if (byId) return byId;
    }
    return townHalls.findOne({ name: townHallRef }).select('name punti_luce');
}

/**
 * Carica tutti i nodi (QE+PL) del comune con lo stesso `quadro`.
 */
async function loadQuadroGraph(townHallRef, quadroLabel) {
    if (!quadroLabel && quadroLabel !== 0) {
        throw new TopologyError(400, { error: 'Parametro quadro obbligatorio.', code: 'MISSING_QUADRO' });
    }

    const townHall = await resolveTownHall(townHallRef);
    if (!townHall) {
        throw new TopologyError(404, { error: 'Comune non trovato.', code: 'TOWN_NOT_FOUND' });
    }

    const nodes = await lightPoints.find({
        _id: { $in: townHall.punti_luce },
        quadro: quadroLabel
    });

    const byId = new Map(nodes.map((n) => [toIdString(n._id), n]));
    const nodeIds = [...byId.keys()];

    const qeList = nodes.filter((n) => n.marker === 'QE');
    const anomalies = [];

    let root = null;
    if (qeList.length === 0) {
        anomalies.push({
            code: 'MISSING_ROOT',
            message: `Nessun quadro elettrico (marker QE) con quadro="${quadroLabel}" nel comune.`
        });
    } else if (qeList.length > 1) {
        anomalies.push({
            code: 'AMBIGUOUS_ROOT',
            message: `Trovati ${qeList.length} documenti QE con quadro="${quadroLabel}". Ambiguo.`,
            roots: qeList.map(nodeLabel)
        });
    } else {
        root = qeList[0];
    }

    const existingEdges = edgesFromParentPointers(nodes);

    return {
        townHall,
        quadro: quadroLabel,
        nodes,
        byId,
        nodeIds,
        root,
        existingEdges,
        anomalies
    };
}

function normalizeIncomingEdges(edges, byId, townIdSet, quadroLabel) {
    const normalized = [];
    const anomalies = [];

    if (!Array.isArray(edges)) {
        throw new TopologyError(400, { error: 'Body non valido: edges deve essere un array.', code: 'INVALID_BODY' });
    }

    for (const raw of edges) {
        const a = toIdString(raw?.a ?? raw?.from);
        const b = toIdString(raw?.b ?? raw?.to);

        if (!a || !b) {
            anomalies.push({
                code: 'INVALID_EDGE',
                edge: { a, b },
                message: 'Arco con estremi mancanti.'
            });
            continue;
        }

        if (a === b) {
            anomalies.push({
                code: 'SELF_LOOP',
                edge: { a, b },
                message: `Self-loop sul nodo ${a}.`
            });
            continue;
        }

        const docA = byId.get(a);
        const docB = byId.get(b);

        if (!docA || !docB) {
            const missingInTown = (!townIdSet.has(a) || !townIdSet.has(b));
            anomalies.push({
                code: missingInTown ? 'CROSS_TOWN' : 'CROSS_QUADRO',
                edge: { a, b },
                message: missingInTown
                    ? `Arco ${a}–${b}: uno o entrambi i nodi non appartengono al comune.`
                    : `Arco ${a}–${b}: uno o entrambi i nodi non appartengono al quadro "${quadroLabel}".`
            });
            continue;
        }

        if (docA.quadro !== quadroLabel || docB.quadro !== quadroLabel) {
            anomalies.push({
                code: 'CROSS_QUADRO',
                edge: { a, b },
                message: `Arco ${a}–${b}: quadro diverso da "${quadroLabel}".`
            });
            continue;
        }

        normalized.push({ a, b });
    }

    return { normalized, anomalies };
}

async function persistParentMap(parentMap, session = null) {
    const ops = [];
    for (const [childId, parentId] of parentMap.entries()) {
        ops.push({
            updateOne: {
                filter: { _id: childId },
                update: { $set: { parent: parentId } }
            }
        });
    }
    if (ops.length === 0) return { modified: 0 };
    const opts = session ? { session, ordered: false } : { ordered: false };
    const result = await lightPoints.bulkWrite(ops, opts);
    return { modified: result.modifiedCount ?? 0 };
}

/**
 * Valida (e opzionalmente applica) un set di archi non orientati sul quadro.
 * Se `replaceAll` è true, gli archi proposti sostituiscono la topologia esistente.
 * Altrimenti vengono uniti agli archi derivati dai parent già salvati
 * (esclusi quelli che coinvolgono nodi già riorientati — di default replaceAll=true sull'import).
 */
async function applyUndirectedEdges({
    townHallRef,
    quadro,
    edges,
    validateOnly = false,
    replaceAll = true
}) {
    const graph = await loadQuadroGraph(townHallRef, quadro);
    const townIdSet = new Set((graph.townHall.punti_luce || []).map(toIdString));
    const { normalized, anomalies: scopeAnomalies } = normalizeIncomingEdges(
        edges,
        graph.byId,
        townIdSet,
        graph.quadro
    );

    const blockingScope = scopeAnomalies.filter((a) =>
        ['CROSS_TOWN', 'CROSS_QUADRO', 'SELF_LOOP', 'INVALID_EDGE'].includes(a.code)
    );

    const rootAnomalies = graph.anomalies.filter((a) =>
        ['MISSING_ROOT', 'AMBIGUOUS_ROOT'].includes(a.code)
    );

    const candidateEdges = replaceAll
        ? normalized
        : [...graph.existingEdges, ...normalized];

    const validation = validateUndirectedEdges(graph.nodeIds, candidateEdges);
    let allAnomalies = [
        ...rootAnomalies,
        ...scopeAnomalies,
        ...validation.anomalies
    ].map((a) => enrichAnomaly(a, graph.byId));

    if (rootAnomalies.length > 0 || blockingScope.length > 0 || !validation.ok) {
        const cycle = allAnomalies.find((a) => a.code === 'CYCLE');
        const payload = {
            ok: false,
            dry_run: Boolean(validateOnly),
            error: cycle
                ? cycle.message
                : 'Validazione topologia fallita.',
            code: cycle ? 'CYCLE' : 'VALIDATION_FAILED',
            anomalies: allAnomalies,
            edge: cycle?.edge || null
        };
        if (validateOnly) {
            return payload;
        }
        throw new TopologyError(409, payload);
    }

    const rootId = toIdString(graph.root._id);
    const { parentMap, order, unreachable, childrenMap } = orientFromRoot(
        rootId,
        validation.adjacency
    );

    for (const id of unreachable) {
        allAnomalies.push(enrichAnomaly({
            code: 'DISCONNECTED',
            nodeId: id,
            message: `Nodo ${id} non raggiungibile dal quadro (QE).`
        }, graph.byId));
    }

    const powerById = aggregatePowerBottomUp(childrenMap, rootId, (id) =>
        localPower(graph.byId.get(id))
    );

    if (validateOnly) {
        return {
            ok: true,
            dry_run: true,
            root: nodeLabel(graph.root),
            oriented_count: order.length - 1,
            unreachable,
            anomalies: allAnomalies,
            parent_map: Object.fromEntries(parentMap),
            power: Object.fromEntries(
                [...powerById.entries()].map(([id, v]) => [id, v])
            )
        };
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // Pulisci parent di nodi del quadro non orientati / da riscrivere
        await lightPoints.updateMany(
            { _id: { $in: graph.nodeIds } },
            { $set: { parent: null } },
            { session }
        );
        await persistParentMap(parentMap, session);
        await session.commitTransaction();
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }

    return {
        ok: true,
        dry_run: false,
        root: nodeLabel(graph.root),
        oriented_count: Math.max(0, order.length - 1),
        unreachable,
        anomalies: allAnomalies,
        updated: parentMap.size
    };
}

async function validateEdgesOnly(params) {
    return applyUndirectedEdges({ ...params, validateOnly: true });
}

/**
 * Collega child→parent. Se una delle due linee ha un QE e l'altra no,
 * assorbe l'intera componente orfana sotto il lato con quadro (a monte),
 * riorienta i parent e propaga l'etichetta `quadro`.
 */
async function setParent(childId, newParentId) {
    const child = await lightPoints.findById(childId);
    if (!child) {
        throw new TopologyError(404, { error: 'Punto luce non trovato.', code: 'NOT_FOUND' });
    }

    const childKey = toIdString(child._id);

    if (newParentId == null || newParentId === '' || newParentId === 'null') {
        child.parent = null;
        await child.save();
        return {
            ok: true,
            child: nodeLabel(child),
            parent: null,
            parent_id: null,
            updates: [],
            anomalies: []
        };
    }

    const parentKey = toIdString(newParentId);
    if (parentKey === childKey) {
        throw new TopologyError(400, {
            error: 'Self-loop non consentito.',
            code: 'SELF_LOOP',
            edge: { a: childKey, b: childKey }
        });
    }

    const parentDoc = await lightPoints.findById(parentKey);
    if (!parentDoc) {
        throw new TopologyError(404, {
            error: 'Genitore non trovato.',
            code: 'PARENT_NOT_FOUND',
            edge: { a: childKey, b: parentKey }
        });
    }

    const townHall = await townHalls.findOne({ punti_luce: child._id }).select('name punti_luce');
    if (!townHall) {
        throw new TopologyError(404, { error: 'Comune non trovato.', code: 'TOWN_NOT_FOUND' });
    }

    const townIds = (townHall.punti_luce || []).map(toIdString);
    const townIdSet = new Set(townIds);
    if (!townIdSet.has(parentKey)) {
        throw new TopologyError(409, {
            error: 'I due punti non appartengono allo stesso comune.',
            code: 'CROSS_TOWN',
            edge: { a: childKey, b: parentKey }
        });
    }

    const townNodes = await lightPoints.find({ _id: { $in: townHall.punti_luce } })
        .select('_id parent marker quadro numero_palo');
    const byId = new Map(townNodes.map((n) => [toIdString(n._id), n]));
    // Assicura che child/parent siano nella mappa anche se la select è stale
    byId.set(childKey, child);
    byId.set(parentKey, parentDoc);

    const existingEdges = edgesFromParentPointers(townNodes);
    const adjacency = buildAdjacency(townIds, existingEdges);

    const plan = planParentLink({
        childId: childKey,
        parentId: parentKey,
        adjacency,
        byId
    });

    if (!plan.ok) {
        const status = plan.code === 'SELF_LOOP' || plan.code === 'QE_AS_CHILD' ? 400 : 409;
        throw new TopologyError(status, {
            error: plan.message,
            code: plan.code,
            edge: { a: childKey, b: parentKey }
        });
    }

    const ops = [];
    const updates = [];
    const quadroLabel = plan.quadroLabel;

    for (const [id, newParent] of plan.parentUpdates.entries()) {
        if (id === plan.monteId) continue; // il monte non cambia parent in questo link
        const doc = byId.get(id);
        if (!doc) continue;

        const prevParent = toIdString(doc.parent);
        const nextParent = newParent == null ? null : toIdString(newParent);
        const prevQuadro = doc.quadro == null ? '' : String(doc.quadro);
        const shouldSetQuadro =
            quadroLabel != null &&
            quadroLabel !== '' &&
            prevQuadro !== String(quadroLabel) &&
            doc.marker !== 'QE';

        if (prevParent === nextParent && !shouldSetQuadro) continue;

        const $set = {};
        if (prevParent !== nextParent) {
            $set.parent = nextParent;
        }
        if (shouldSetQuadro) {
            $set.quadro = quadroLabel;
        }
        if (Object.keys($set).length === 0) continue;

        ops.push({
            updateOne: {
                filter: { _id: id },
                update: { $set }
            }
        });
        updates.push({
            _id: id,
            parent: Object.prototype.hasOwnProperty.call($set, 'parent')
                ? nextParent
                : prevParent,
            quadro: Object.prototype.hasOwnProperty.call($set, 'quadro')
                ? quadroLabel
                : prevQuadro,
            numero_palo: doc.numero_palo || '',
            marker: doc.marker || ''
        });
    }

    if (ops.length > 0) {
        await lightPoints.bulkWrite(ops, { ordered: false });
    }

    const monteDoc = byId.get(plan.monteId);
    const valleDoc = byId.get(plan.valleId);

    return {
        ok: true,
        child: nodeLabel(valleDoc),
        parent: nodeLabel(monteDoc),
        parent_id: plan.monteId,
        valle_id: plan.valleId,
        absorbed_count: plan.absorbedIds.length,
        quadro: quadroLabel || (monteDoc?.quadro ?? null),
        updates,
        anomalies: []
    };
}

async function clearParent(childId) {
    return setParent(childId, null);
}

/**
 * Albero orientato + potenze aggregate on-read.
 */
async function getTree({ townHallRef, quadro, rootId }) {
    let graph;

    if (rootId) {
        const rootDoc = await lightPoints.findById(rootId);
        if (!rootDoc) {
            throw new TopologyError(404, { error: 'QE non trovato.', code: 'NOT_FOUND' });
        }
        if (rootDoc.marker !== 'QE') {
            throw new TopologyError(400, {
                error: 'root_id deve riferirsi a un marker QE.',
                code: 'NOT_ROOT'
            });
        }
        const townHall = await townHalls.findOne({ punti_luce: rootDoc._id }).select('name punti_luce');
        if (!townHall) {
            throw new TopologyError(404, { error: 'Comune non trovato.', code: 'TOWN_NOT_FOUND' });
        }
        const quadroLabel = quadro || rootDoc.quadro;
        graph = await loadQuadroGraph(townHall.name, quadroLabel);
    } else {
        graph = await loadQuadroGraph(townHallRef, quadro);
    }

    const rootAnomalies = graph.anomalies.filter((a) =>
        ['MISSING_ROOT', 'AMBIGUOUS_ROOT'].includes(a.code)
    );
    if (rootAnomalies.length > 0) {
        return {
            root: null,
            nodes: [],
            edges: [],
            anomalies: rootAnomalies.map((a) => enrichAnomaly(a, graph.byId)),
            total_subtree_power: 0
        };
    }

    const edges = graph.existingEdges;
    const validation = validateUndirectedEdges(graph.nodeIds, edges);
    const rootKey = toIdString(graph.root._id);

    // Anche se i parent salvati hanno cicli (dati corrotti), segnala e non inventare
    const anomalies = [
        ...graph.anomalies,
        ...validation.anomalies
    ].map((a) => enrichAnomaly(a, graph.byId));

    let adjacency = validation.adjacency;
    if (!validation.ok) {
        // fallback: usa solo parent pointers come archi diretti child-parent per BFS
        adjacency = buildAdjacency(graph.nodeIds, edges);
    }

    const { order, unreachable } = orientFromRoot(rootKey, adjacency);

    for (const id of unreachable) {
        anomalies.push(enrichAnomaly({
            code: 'DISCONNECTED',
            nodeId: id,
            message: `Nodo ${id} non raggiungibile dal quadro (QE).`
        }, graph.byId));
    }

    // Se i parent persistiti differiscono dall'orientamento BFS, usa i parent salvati
    // per la risposta (fonte di verità DB), ma children da parent salvati
    const savedChildren = new Map(graph.nodeIds.map((id) => [id, []]));
    for (const n of graph.nodes) {
        const id = toIdString(n._id);
        const p = toIdString(n.parent);
        if (p && savedChildren.has(p)) {
            savedChildren.get(p).push(id);
        }
    }

    const powerById = aggregatePowerBottomUp(savedChildren, rootKey, (id) =>
        localPower(graph.byId.get(id))
    );

    const nodesOut = graph.nodes.map((n) => {
        const id = toIdString(n._id);
        const pow = powerById.get(id) || { local: 0, subtree: 0 };
        return {
            _id: id,
            numero_palo: n.numero_palo || '',
            marker: n.marker || '',
            quadro: n.quadro || '',
            parent: toIdString(n.parent),
            children: savedChildren.get(id) || [],
            local_power: pow.local,
            subtree_power: pow.subtree,
            lat: n.lat,
            lng: n.lng
        };
    });

    const edgeOut = [];
    for (const n of graph.nodes) {
        const id = toIdString(n._id);
        const p = toIdString(n.parent);
        if (p) edgeOut.push({ from: p, to: id });
    }

    const rootPower = powerById.get(rootKey) || { local: 0, subtree: 0 };

    return {
        root: {
            ...nodeLabel(graph.root),
            subtree_power: rootPower.subtree
        },
        nodes: nodesOut,
        edges: edgeOut,
        topological_order: order,
        anomalies,
        total_subtree_power: rootPower.subtree
    };
}

/**
 * Conta figli topologici di un nodo (per delete guard).
 */
async function countChildren(nodeId) {
    return lightPoints.countDocuments({ parent: nodeId });
}

module.exports = {
    TopologyError,
    loadQuadroGraph,
    applyUndirectedEdges,
    validateEdgesOnly,
    setParent,
    clearParent,
    getTree,
    countChildren,
    nodeLabel,
    localPower
};
