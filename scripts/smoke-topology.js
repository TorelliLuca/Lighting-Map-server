/**
 * Smoke test in-process per utils/topology.js (senza DB).
 * Esegui: node scripts/smoke-topology.js
 */
const assert = require('assert');
const {
    UnionFind,
    localPower,
    validateUndirectedEdges,
    orientFromRoot,
    aggregatePowerBottomUp,
    buildAdjacency,
    planParentLink
} = require('../utils/topology');

function testUnionFindCycle() {
    const uf = new UnionFind(['QE', '1', '2', '3']);
    assert.strictEqual(uf.union('QE', '1'), true);
    assert.strictEqual(uf.union('1', '2'), true);
    assert.strictEqual(uf.union('2', '3'), true);
    assert.strictEqual(uf.union('3', '1'), false, 'deve rilevare ciclo');
}

function testValidateCycleReportsEdge() {
    const nodes = ['QE', 'A', 'B', 'C'];
    const edges = [
        { a: 'QE', b: 'A' },
        { a: 'A', b: 'B' },
        { a: 'B', b: 'C' },
        { a: 'C', b: 'A' } // ciclo
    ];
    const result = validateUndirectedEdges(nodes, edges);
    assert.strictEqual(result.ok, false);
    const cycle = result.anomalies.find((a) => a.code === 'CYCLE');
    assert.ok(cycle, 'attesa anomalia CYCLE');
    assert.deepStrictEqual(cycle.edge, { a: 'C', b: 'A' });
}

function testOrientBranchingTree() {
    // QE -> A, QE -> B, A -> C, A -> D  (albero non binario / non catena)
    const nodes = ['QE', 'A', 'B', 'C', 'D'];
    const edges = [
        { a: 'QE', b: 'A' },
        { a: 'QE', b: 'B' },
        { a: 'A', b: 'C' },
        { a: 'A', b: 'D' }
    ];
    const { ok, adjacency } = validateUndirectedEdges(nodes, edges);
    assert.strictEqual(ok, true);
    const { parentMap, order, unreachable, childrenMap } = orientFromRoot('QE', adjacency);
    assert.strictEqual(unreachable.length, 0);
    assert.strictEqual(parentMap.get('A'), 'QE');
    assert.strictEqual(parentMap.get('B'), 'QE');
    assert.strictEqual(parentMap.get('C'), 'A');
    assert.strictEqual(parentMap.get('D'), 'A');
    assert.strictEqual(parentMap.get('QE'), null);
    assert.ok(order[0] === 'QE');
    assert.deepStrictEqual(childrenMap.get('QE').sort(), ['A', 'B']);
    assert.deepStrictEqual(childrenMap.get('A').sort(), ['C', 'D']);
}

function testForceDirectionRegardlessOfEdgeOrder() {
    // Arco scritto "periferia → quadro" nei dati grezzi
    const nodes = ['QE', '1', '2'];
    const edges = [
        { a: '2', b: '1' },
        { a: '1', b: 'QE' }
    ];
    const { adjacency } = validateUndirectedEdges(nodes, edges);
    const { parentMap } = orientFromRoot('QE', adjacency);
    assert.strictEqual(parentMap.get('1'), 'QE');
    assert.strictEqual(parentMap.get('2'), '1');
}

function testPowerBottomUp() {
    const childrenMap = new Map([
        ['QE', ['A', 'B']],
        ['A', ['C']],
        ['B', []],
        ['C', []]
    ]);
    const powerOf = (id) => {
        if (id === 'QE') return 0;
        if (id === 'A') return 60; // 60W × 1
        if (id === 'B') return 100;
        if (id === 'C') return 80;
        return 0;
    };
    const result = aggregatePowerBottomUp(childrenMap, 'QE', powerOf);
    // Tutti i nodi della linea ricevono il totale (non i parziali a valle)
    assert.strictEqual(result.get('C').subtree, 240);
    assert.strictEqual(result.get('A').subtree, 240);
    assert.strictEqual(result.get('B').subtree, 240);
    assert.strictEqual(result.get('QE').subtree, 240);
    assert.strictEqual(result.get('A').local, 60);
    assert.strictEqual(result.get('C').local, 80);
}

function testLocalPowerParse() {
    assert.strictEqual(localPower({ marker: 'QE', potenza_lampada: '100' }), 0);
    assert.strictEqual(localPower({ marker: 'PL', potenza_lampada: '60', numero_apparecchi: '2' }), 120);
    assert.strictEqual(localPower({ marker: 'PL', potenza_lampada: '60,5', numero_apparecchi: '' }), 60.5);
    assert.strictEqual(localPower({ marker: 'PL', potenza_lampada: '', numero_apparecchi: '2' }), 0);
}

function testRebuildScenarioLikeSetParent() {
    // Stato: QE-A-B, QE-C. Provo a collegare C→B (ok). Poi C→A sarebbe ok.
    // Ciclo se collego B→C quando C già sotto B? Simula: esistente QE-A, A-B, QE-C;
    // setParent(C, B) ok; setParent(B, C) dopo aver tolto B-A... 
    const nodes = ['QE', 'A', 'B', 'C'];
    // Dopo aver rimosso parent di B e messo B→C, e C→QE, A→QE: archi QE-A, QE-C, C-B
    let edges = [
        { a: 'QE', b: 'A' },
        { a: 'QE', b: 'C' },
        { a: 'C', b: 'B' }
    ];
    let v = validateUndirectedEdges(nodes, edges);
    assert.strictEqual(v.ok, true);
    let oriented = orientFromRoot('QE', v.adjacency);
    assert.strictEqual(oriented.parentMap.get('B'), 'C');

    // Ora provo arco che chiude ciclo: aggiungo A-B mentre B è sotto C e... 
    // In realtà A e B non sono ancora connessi. Ciclo tipico: QE-A-B-C-QE
    edges = [
        { a: 'QE', b: 'A' },
        { a: 'A', b: 'B' },
        { a: 'B', b: 'C' },
        { a: 'C', b: 'QE' }
    ];
    v = validateUndirectedEdges(nodes, edges);
    assert.strictEqual(v.ok, false);
    assert.ok(v.anomalies.some((a) => a.code === 'CYCLE' && a.edge.a === 'C' && a.edge.b === 'QE'));
}

function testDisconnectedReported() {
    const nodes = ['QE', 'A', 'orphan'];
    const edges = [{ a: 'QE', b: 'A' }];
    const { adjacency } = validateUndirectedEdges(nodes, edges);
    // validateUndirectedEdges only includes accepted edges in adjacency,
    // but buildAdjacency still has all nodes
    const fullAdj = buildAdjacency(nodes, edges);
    const { unreachable } = orientFromRoot('QE', fullAdj);
    assert.deepStrictEqual(unreachable, ['orphan']);
}

function testAbsorbOrphanLineIntoQuadroLine() {
    // QE-P1-P2 (con quadro). Orfana: A-B-C con parent A←B←C (C radice locale).
    // Collego P2 (monte) a B (punto in mezzo all'orfana): tutta A-B-C deve
    // essere riorientata sotto P2 e assorbita.
    const byId = new Map([
        ['QE', { _id: 'QE', marker: 'QE', quadro: 'Q1', parent: null }],
        ['P1', { _id: 'P1', marker: 'PL', quadro: 'Q1', parent: 'QE' }],
        ['P2', { _id: 'P2', marker: 'PL', quadro: 'Q1', parent: 'P1' }],
        ['A', { _id: 'A', marker: 'PL', quadro: '', parent: 'B' }],
        ['B', { _id: 'B', marker: 'PL', quadro: '', parent: 'C' }],
        ['C', { _id: 'C', marker: 'PL', quadro: '', parent: null }]
    ]);
    const nodes = ['QE', 'P1', 'P2', 'A', 'B', 'C'];
    const edges = [
        { a: 'QE', b: 'P1' },
        { a: 'P1', b: 'P2' },
        { a: 'A', b: 'B' },
        { a: 'B', b: 'C' }
    ];
    const adjacency = buildAdjacency(nodes, edges);

    const plan = planParentLink({
        childId: 'B',
        parentId: 'P2',
        adjacency,
        byId
    });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.monteId, 'P2');
    assert.strictEqual(plan.valleId, 'B');
    assert.strictEqual(plan.quadroLabel, 'Q1');
    assert.strictEqual(plan.parentUpdates.get('B'), 'P2');
    assert.strictEqual(plan.parentUpdates.get('A'), 'B');
    assert.strictEqual(plan.parentUpdates.get('C'), 'B');
    assert.deepStrictEqual(plan.absorbedIds.sort(), ['A', 'B', 'C']);
}

function testFlipWhenOrphanSelectedAsMonte() {
    // Utente seleziona orfana come "a monte" e punto su quadro come "a valle":
    // il piano deve invertire per tenere il QE a monte.
    const byId = new Map([
        ['QE', { _id: 'QE', marker: 'QE', quadro: 'Q1', parent: null }],
        ['P1', { _id: 'P1', marker: 'PL', quadro: 'Q1', parent: 'QE' }],
        ['A', { _id: 'A', marker: 'PL', quadro: '', parent: null }],
        ['B', { _id: 'B', marker: 'PL', quadro: '', parent: 'A' }]
    ]);
    const adjacency = buildAdjacency(
        ['QE', 'P1', 'A', 'B'],
        [
            { a: 'QE', b: 'P1' },
            { a: 'A', b: 'B' }
        ]
    );

    const plan = planParentLink({
        childId: 'P1', // richiesto come valle
        parentId: 'B', // richiesto come monte (orfana)
        adjacency,
        byId
    });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.monteId, 'P1');
    assert.strictEqual(plan.valleId, 'B');
    assert.strictEqual(plan.parentUpdates.get('B'), 'P1');
    assert.strictEqual(plan.parentUpdates.get('A'), 'B');
    assert.strictEqual(plan.quadroLabel, 'Q1');
}

function testRejectLinkBetweenTwoQuadroLines() {
    const byId = new Map([
        ['QE1', { _id: 'QE1', marker: 'QE', quadro: 'Q1', parent: null }],
        ['A', { _id: 'A', marker: 'PL', quadro: 'Q1', parent: 'QE1' }],
        ['QE2', { _id: 'QE2', marker: 'QE', quadro: 'Q2', parent: null }],
        ['B', { _id: 'B', marker: 'PL', quadro: 'Q2', parent: 'QE2' }]
    ]);
    const adjacency = buildAdjacency(
        ['QE1', 'A', 'QE2', 'B'],
        [
            { a: 'QE1', b: 'A' },
            { a: 'QE2', b: 'B' }
        ]
    );
    const plan = planParentLink({
        childId: 'B',
        parentId: 'A',
        adjacency,
        byId
    });
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.code, 'CROSS_ROOT');
}

function run() {
    testUnionFindCycle();
    testValidateCycleReportsEdge();
    testOrientBranchingTree();
    testForceDirectionRegardlessOfEdgeOrder();
    testPowerBottomUp();
    testLocalPowerParse();
    testRebuildScenarioLikeSetParent();
    testDisconnectedReported();
    testAbsorbOrphanLineIntoQuadroLine();
    testFlipWhenOrphanSelectedAsMonte();
    testRejectLinkBetweenTwoQuadroLines();
    console.log('OK — smoke topology: tutti i casi passati');
}

run();
