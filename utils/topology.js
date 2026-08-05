/**
 * Utility pure per topologia reti radiali (Union-Find + BFS).
 * Nessun side-effect su DB/rete.
 */

function toIdString(id) {
    if (id == null) return null;
    return String(id);
}

function parseNumeric(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const n = parseFloat(String(value).replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
}

/**
 * Potenza nominale installata sul nodo.
 * PL: potenza_lampada × numero_apparecchi (count default 1 se potenza ok e count assente).
 * QE: 0 (aggrega solo a valle).
 */
function localPower(lp) {
    if (!lp) return 0;
    if (lp.marker === 'QE') return 0;
    const watt = parseNumeric(lp.potenza_lampada);
    if (watt === null) return 0;

    const countRaw = parseNumeric(lp.numero_apparecchi);
    const count = countRaw === null || countRaw <= 0 ? 1 : countRaw;
    return watt * count;
}

class UnionFind {
    constructor(nodeIds = []) {
        this.parent = new Map();
        this.rank = new Map();
        for (const id of nodeIds) {
            const key = toIdString(id);
            this.parent.set(key, key);
            this.rank.set(key, 0);
        }
    }

    add(id) {
        const key = toIdString(id);
        if (!this.parent.has(key)) {
            this.parent.set(key, key);
            this.rank.set(key, 0);
        }
    }

    find(id) {
        const key = toIdString(id);
        if (!this.parent.has(key)) {
            this.add(key);
            return key;
        }
        let root = key;
        while (this.parent.get(root) !== root) {
            root = this.parent.get(root);
        }
        // path compression
        let cur = key;
        while (cur !== root) {
            const next = this.parent.get(cur);
            this.parent.set(cur, root);
            cur = next;
        }
        return root;
    }

    connected(a, b) {
        return this.find(a) === this.find(b);
    }

    /**
     * @returns {boolean} true se union eseguita, false se già stesso set (ciclo)
     */
    union(a, b) {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra === rb) return false;

        const rankA = this.rank.get(ra) || 0;
        const rankB = this.rank.get(rb) || 0;
        if (rankA < rankB) {
            this.parent.set(ra, rb);
        } else if (rankA > rankB) {
            this.parent.set(rb, ra);
        } else {
            this.parent.set(rb, ra);
            this.rank.set(ra, rankA + 1);
        }
        return true;
    }

    /** Numero di componenti distinte tra i nodi noti. */
    componentCount() {
        const roots = new Set();
        for (const id of this.parent.keys()) {
            roots.add(this.find(id));
        }
        return roots.size;
    }
}

/**
 * Costruisce adjacency non orientata da una lista di archi {a,b}.
 */
function buildAdjacency(nodeIds, edges) {
    const adj = new Map();
    for (const id of nodeIds) {
        adj.set(toIdString(id), new Set());
    }
    for (const edge of edges) {
        const a = toIdString(edge.a);
        const b = toIdString(edge.b);
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a).add(b);
        adj.get(b).add(a);
    }
    return adj;
}

/**
 * Valida archi non orientati con Union-Find.
 * @param {string[]} nodeIds
 * @param {{a:string,b:string}[]} edges
 * @returns {{ ok: boolean, anomalies: object[], uf: UnionFind, adjacency: Map }}
 */
function validateUndirectedEdges(nodeIds, edges) {
    const nodes = nodeIds.map(toIdString);
    const uf = new UnionFind(nodes);
    const anomalies = [];
    const accepted = [];

    for (const edge of edges) {
        const a = toIdString(edge.a);
        const b = toIdString(edge.b);

        if (a == null || b == null) {
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

        if (!uf.parent.has(a) || !uf.parent.has(b)) {
            anomalies.push({
                code: 'NODE_OUT_OF_SCOPE',
                edge: { a, b },
                message: `Arco ${a}–${b}: uno o entrambi i nodi non appartengono al quadro.`
            });
            continue;
        }

        if (!uf.union(a, b)) {
            anomalies.push({
                code: 'CYCLE',
                edge: { a, b },
                message: `La linea ${a}–${b} introduce un ciclo (rete non radiale).`
            });
            continue;
        }

        accepted.push({ a, b });
    }

    const adjacency = buildAdjacency(nodes, accepted);
    const components = uf.componentCount();
    if (nodes.length > 0 && components > 1 && accepted.length > 0) {
        anomalies.push({
            code: 'MULTI_COMPONENT',
            message: `Il grafo del quadro ha ${components} componenti connesse (attesa 1 se tutti collegati).`,
            componentCount: components
        });
    }

    const hasBlocking = anomalies.some((x) =>
        ['CYCLE', 'SELF_LOOP', 'INVALID_EDGE', 'NODE_OUT_OF_SCOPE'].includes(x.code)
    );

    return {
        ok: !hasBlocking,
        anomalies,
        uf,
        adjacency,
        acceptedEdges: accepted
    };
}

/**
 * BFS dal root: forza verso root → periferia.
 * @returns {{ parentMap: Map<string,string|null>, order: string[], unreachable: string[], childrenMap: Map<string,string[]> }}
 */
function orientFromRoot(rootId, adjacency) {
    const root = toIdString(rootId);
    const parentMap = new Map();
    const childrenMap = new Map();
    const order = [];
    const visited = new Set();

    for (const id of adjacency.keys()) {
        childrenMap.set(id, []);
    }

    if (!adjacency.has(root)) {
        return {
            parentMap,
            order,
            unreachable: [...adjacency.keys()],
            childrenMap
        };
    }

    const queue = [root];
    visited.add(root);
    parentMap.set(root, null);

    while (queue.length > 0) {
        const u = queue.shift();
        order.push(u);
        const neighbors = adjacency.get(u) || new Set();
        for (const v of neighbors) {
            if (visited.has(v)) continue;
            visited.add(v);
            parentMap.set(v, u);
            childrenMap.get(u).push(v);
            queue.push(v);
        }
    }

    const unreachable = [];
    for (const id of adjacency.keys()) {
        if (!visited.has(id)) {
            unreachable.push(id);
            parentMap.set(id, null);
        }
    }

    return { parentMap, order, unreachable, childrenMap };
}

/**
 * Potenza di linea: somma di tutti i nodi sotto root.
 * Ogni nodo raggiungibile riceve lo stesso totale (non i parziali a valle).
 * @param {Map<string,string[]>} childrenMap
 * @param {string} rootId
 * @param {(id:string)=>number} powerOf
 * @returns {Map<string,{ local:number, subtree:number }>}
 */
function aggregatePowerBottomUp(childrenMap, rootId, powerOf) {
    const result = new Map();
    const root = toIdString(rootId);
    const visited = new Set();

    function dfs(id) {
        visited.add(id);
        const local = powerOf(id) || 0;
        let sum = local;
        const children = childrenMap.get(id) || [];
        for (const child of children) {
            sum += dfs(child).subtree;
        }
        const entry = { local, subtree: sum };
        result.set(id, entry);
        return entry;
    }

    if (childrenMap.has(root) || root) {
        dfs(root);
    }

    const lineTotal = result.get(root)?.subtree ?? 0;
    for (const id of visited) {
        const entry = result.get(id);
        if (entry) entry.subtree = lineTotal;
    }

    // nodi non raggiungibili dal root: solo potenza locale
    for (const id of childrenMap.keys()) {
        if (!result.has(id)) {
            const local = powerOf(id) || 0;
            result.set(id, { local, subtree: local });
        }
    }

    return result;
}

/**
 * Costruisce archi non orientati dai parent puntatori esistenti.
 * Ignora parent null o parent fuori dal set di nodi.
 */
function edgesFromParentPointers(nodes) {
    const nodeSet = new Set(nodes.map((n) => toIdString(n._id || n.id || n)));
    const seen = new Set();
    const unique = [];
    for (const n of nodes) {
        const id = toIdString(n._id || n.id);
        const parent = toIdString(n.parent);
        if (!parent || !nodeSet.has(parent)) continue;
        const a = id < parent ? id : parent;
        const b = id < parent ? parent : id;
        const key = `${a}|${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ a, b });
    }
    return unique;
}

/**
 * Componente connessa non orientata a partire da startId.
 * @param {string} startId
 * @param {Map<string, Set<string>>} adjacency
 * @returns {Set<string>}
 */
function connectedComponent(startId, adjacency) {
    const start = toIdString(startId);
    const visited = new Set();
    if (!adjacency.has(start) && start) {
        visited.add(start);
        return visited;
    }
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
        const u = queue.shift();
        for (const v of adjacency.get(u) || []) {
            if (visited.has(v)) continue;
            visited.add(v);
            queue.push(v);
        }
    }
    return visited;
}

/**
 * True se nella componente c'è un marker QE.
 * @param {Iterable<string>} componentIds
 * @param {Map<string, {marker?: string}>} byId
 */
function componentHasQe(componentIds, byId) {
    for (const id of componentIds) {
        if (byId.get(id)?.marker === 'QE') return true;
    }
    return false;
}

/**
 * Etichetta quadro da usare per propagazione: preferisce il QE, poi il primo non vuoto.
 * @param {Iterable<string>} componentIds
 * @param {Map<string, {marker?: string, quadro?: string}>} byId
 */
function resolveQuadroLabel(componentIds, byId) {
    let fallback = '';
    for (const id of componentIds) {
        const doc = byId.get(id);
        if (!doc) continue;
        const q = doc.quadro == null ? '' : String(doc.quadro);
        if (doc.marker === 'QE' && q !== '') return q;
        if (!fallback && q !== '') fallback = q;
    }
    return fallback;
}

/**
 * Decide monte/valle e riorienta la componente assorbita quando si collega
 * una linea con QE a una linea orfana (o due orfane).
 *
 * @returns {{
 *   ok: boolean,
 *   code?: string,
 *   message?: string,
 *   monteId?: string,
 *   valleId?: string,
 *   parentUpdates?: Map<string, string|null>,
 *   quadroLabel?: string|null,
 *   absorbedIds?: string[]
 * }}
 */
function planParentLink({ childId, parentId, adjacency, byId }) {
    const childKey = toIdString(childId);
    const parentKey = toIdString(parentId);

    if (!childKey || !parentKey) {
        return { ok: false, code: 'INVALID_EDGE', message: 'Estremi mancanti.' };
    }
    if (childKey === parentKey) {
        return { ok: false, code: 'SELF_LOOP', message: 'Self-loop non consentito.' };
    }

    const childComp = connectedComponent(childKey, adjacency);
    const parentComp = connectedComponent(parentKey, adjacency);

    if (childComp.has(parentKey)) {
        const currentParent = toIdString(byId.get(childKey)?.parent);
        if (currentParent === parentKey) {
            return {
                ok: true,
                monteId: parentKey,
                valleId: childKey,
                parentUpdates: new Map(),
                quadroLabel: null,
                absorbedIds: []
            };
        }
        return {
            ok: false,
            code: 'CYCLE',
            message: `La linea ${parentKey}–${childKey} introduce un ciclo (rete non radiale).`
        };
    }

    const childHasQe = componentHasQe(childComp, byId);
    const parentHasQe = componentHasQe(parentComp, byId);

    if (childHasQe && parentHasQe) {
        return {
            ok: false,
            code: 'CROSS_ROOT',
            message: 'Non è possibile collegare due linee già collegate a un quadro: si creerebbe un anello o un doppio alimentatore.'
        };
    }

    let monteId = parentKey;
    let valleId = childKey;
    let absorbComp = childComp;
    let quadroLabel = null;

    if (parentHasQe && !childHasQe) {
        monteId = parentKey;
        valleId = childKey;
        absorbComp = childComp;
        quadroLabel = resolveQuadroLabel(parentComp, byId);
    } else if (childHasQe && !parentHasQe) {
        // Il lato con quadro resta a monte anche se l'utente ha invertito i click
        monteId = childKey;
        valleId = parentKey;
        absorbComp = parentComp;
        quadroLabel = resolveQuadroLabel(childComp, byId);
    } else {
        // Entrambe orfane: rispetta la direzione richiesta, propaga eventuale quadro
        monteId = parentKey;
        valleId = childKey;
        absorbComp = childComp;
        quadroLabel =
            resolveQuadroLabel(parentComp, byId) ||
            resolveQuadroLabel(childComp, byId) ||
            null;
    }

    if (byId.get(valleId)?.marker === 'QE') {
        return {
            ok: false,
            code: 'QE_AS_CHILD',
            message: 'Un quadro elettrico non può essere figlio di una linea.'
        };
    }

    const absorbIds = [...absorbComp];
    const absorbEdges = [];
    const seenEdge = new Set();
    for (const id of absorbIds) {
        const p = toIdString(byId.get(id)?.parent);
        if (!p || !absorbComp.has(p)) continue;
        const a = id < p ? id : p;
        const b = id < p ? p : id;
        const key = `${a}|${b}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        absorbEdges.push({ a, b });
    }

    const absorbAdj = buildAdjacency(absorbIds, absorbEdges);
    const { parentMap } = orientFromRoot(valleId, absorbAdj);

    // Attacca la radice locale della linea assorbita al monte (lato con quadro)
    parentMap.set(valleId, monteId);

    return {
        ok: true,
        monteId,
        valleId,
        parentUpdates: parentMap,
        quadroLabel: quadroLabel || null,
        absorbedIds: absorbIds
    };
}

module.exports = {
    UnionFind,
    toIdString,
    parseNumeric,
    localPower,
    buildAdjacency,
    validateUndirectedEdges,
    orientFromRoot,
    aggregatePowerBottomUp,
    edgesFromParentPointers,
    connectedComponent,
    componentHasQe,
    resolveQuadroLabel,
    planParentLink
};
