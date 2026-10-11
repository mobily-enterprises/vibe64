import assert from 'node:assert/strict';
import test from 'node:test';
import { layeredGraph, architectureGraph } from '../../packages/vibe64-system-graph/src/client/layeredGraph.js';
import { architectureOverview, engineOverview, pageStoryboard, subsystemOutline } from '../../packages/vibe64-system-graph/src/client/architectureModel.js';
import { parseVibe64ArchitectureInspectionLines } from '../../packages/vibe64-genesis/src/server/architectureInspection.js';
import { parseVibe64ArchitectureLayoutLines, vibe64ArchitectureLayout } from '../../packages/vibe64-genesis/src/server/architectureLayout.js';

test('authored architectural groups accept any stack and reject ambiguous placement', () => {
  const lines = ['### Group `work`: Request handling', '- Kind: `layer`', '- Purpose: `Receives application requests.`',
    '- Subsystem: `Services/Orders` `Orders` `Manages orders.`',
    '### Group `common`: Shared facilities', '- Kind: `libraries`', '- Purpose: `Independent reusable APIs.`',
    '- Subsystem: `vendor-owned/math` `Math` `Numerical operations.`'];
  const groups = parseVibe64ArchitectureLayoutLines(lines);
  assert.deepEqual(groups.map(group => [group.kind, group.subsystems[0].root]), [['layer','Services/Orders'],['libraries','vendor-owned/math']]);
  assert.equal(vibe64ArchitectureLayout({status:'ready',lines}).groups.length, 2);
  assert.deepEqual(vibe64ArchitectureLayout({status:'missing'}).groups, []);
  assert.deepEqual(parseVibe64ArchitectureLayoutLines(['- Nothing.']), []);
  for (const extra of ['- Subsystem: `Services/Orders` `Duplicate` `Description.`', '- Kind: `library`', '- Extra: `value`']) assert.throws(() => parseVibe64ArchitectureLayoutLines([...lines, extra]));
  for (const root of ['../outside','/absolute','a/../b','a\\b']) assert.throws(() => parseVibe64ArchitectureLayoutLines(lines.map(line => line.replace('Services/Orders', root))));
  assert.throws(() => parseVibe64ArchitectureLayoutLines(lines.slice(0, 2)), /needs Kind, Purpose/);
});

test('circle map retains every source owner and explicit library roles without imposing layers', () => {
  const roots = ['host','work/feature','outside/common','another/place','unknown','resources'];
  const architecture = {
    subsystems: roots.map(root => ({id:root,root,title:root,fileIds:[root+'.file']})),
    files: roots.map(root => ({id:root+'.file',path:root+'/Api.cs',subsystemId:root,sourceLines:10})),
    packages:[{id:'own',subsystemId:'outside/common',name:'Common',opaque:false,entryPoints:[{importPath:'.',file:'outside/common/Api.cs',symbols:[{name:'run'}]}]}],
    relations:[['host','work/feature'],['work/feature','outside/common'],['outside/common','another/place']].map(([from,to])=>({fromFileId:from+'.file',targetFileId:to+'.file',resolution:'resolved'})),
    layout:{groups:parseVibe64ArchitectureLayoutLines([
      '### Group `application`: Application work','- Kind: `layer`','- Purpose: `Handles user requests.`',
      '- Subsystem: `host` `Host` `Starts the app.`','- Subsystem: `work/feature` `Feature` `Performs the work.`',
      '### Group `library`: Independent facilities','- Kind: `libraries`','- Purpose: `Reusable APIs.`',
      '- Subsystem: `outside/common` `Common` `Public shared functions.`','- Subsystem: `another/place` `Numbers` `Numerical operations.`',
      '### Group `resources`: Resources','- Kind: `support`','- Purpose: `Not a runtime layer.`','- Subsystem: `resources` `Resources` `Static assets.`'
    ])}
  };
  const diagram = engineOverview(architecture);
  const nodes = new Map(diagram.nodes.map(node => [node.id,node]));
  assert.equal(nodes.get('host').position.y,nodes.get('work/feature').position.y,'different import ranks do not split one declared group');
  const libraries = ['outside/common','another/place'].map(id => nodes.get(id));
  assert.equal(libraries[0].position.x,libraries[1].position.x);
  assert.ok(libraries[0].position.y + parseFloat(libraries[0].style.height) < libraries[1].position.y);
  assert.ok(diagram.nodes.filter(node=>!node.data.library).every(node=>node.position.x+parseFloat(node.style.width)<libraries[0].position.x));
  assert.ok(libraries.every(node => !node.draggable && node.data.library));
  assert.equal(nodes.get('outside/common').data.publicSummary,'1 public declaration');
  assert.equal(nodes.get('unknown').data.library, false, 'classification is explicit, not inferred from fan-in or packaging');
  assert.deepEqual([...nodes.keys()].sort(), roots.slice().sort(), 'undeclared and supporting roots remain visible');
  assert.equal(nodes.get('resources').data.placementKind, 'support');
  assert.ok(!diagram.decorations.some(node=>['layer','support'].includes(node.data.kind)));
  assert.ok(diagram.nodes.every(node=>node.style.width===node.style.height));
  assert.deepEqual(diagram.edges,[]);
  assert.equal(architectureGraph(architecture).edges.length,3,'dependency evidence remains intact');
  const outline = subsystemOutline(architecture,'outside/common');
  assert.equal(outline.owner.title,'Common');
  assert.equal(outline.owner.description,'Public shared functions.');
  assert.equal(outline.owner.placementKind,'libraries');
  assert.equal(outline.files[0].path,'outside/common/Api.cs');
  assert.equal(outline.publicEntries[0].symbols[0].name,'run');
  assert.equal(outline.fileLinks.length,0);
  assert.deepEqual(engineOverview({...architecture,subsystems:[...architecture.subsystems].reverse()}).nodes.map(node=>[node.id,node.position]),diagram.nodes.map(node=>[node.id,node.position]));
});

test('Stack entry files are explicit canonical paths for any language', () => {
  const recipe = ['### Inspector `app`: Application facts', '- Runtime: `nodejs`', '- Directory: `.`', '- Command: `node` `inspect.mjs`', '- Timeout seconds: `10`', '- Max output bytes: `4096`'];
  assert.deepEqual(parseVibe64ArchitectureInspectionLines([...recipe, '- Entry files: `web/host.go` `desktop/App.cs` `game/main.cpp`'])[0].entryFiles, ['web/host.go', 'desktop/App.cs', 'game/main.cpp']);
  assert.equal(parseVibe64ArchitectureInspectionLines(recipe)[0].entryFiles, undefined);
  for (const invalid of ['../main.py', '/absolute/Main.kt', 'src/../main.rs']) assert.throws(() => parseVibe64ArchitectureInspectionLines([...recipe, `- Entry files: \`${invalid}\``]));
});

test('entry roles are emphasised while import ranks do not determine circle positions', () => {
  const architecture = {
    subsystems: ['host', 'controllers', 'common', 'unknown', 'package'].map(id => ({ id, title: id, root: id, fileIds: id === 'package' ? [] : [id + '.file'], opaque: id === 'package', packageId: id === 'package' ? 'dependency' : undefined })),
    files: [{ id: 'host.file', subsystemId: 'host', sourceLines: 100 }, { id: 'controllers.file', subsystemId: 'controllers', sourceLines: 40 }, { id: 'common.file', subsystemId: 'common', sourceLines: 8 }, { id: 'unknown.file', subsystemId: 'unknown' }],
    packages: [{ id: 'dependency', subsystemId: 'package', name: 'package', root: 'dependency', opaque: true }],
    relations: [['host', 'controllers'], ['controllers', 'common']].map(([from, to]) => ({ resolution: 'resolved', fromFileId: from + '.file', targetFileId: to + '.file' })),
    entryPoints: [{ file: 'host/main.go', subsystemId: 'host', resolution: 'resolved' }, { file: 'native/Main.kt', subsystemId: 'unknown', resolution: 'resolved' }]
  };
  architecture.relations.push({ resolution: 'resolved', fromFileId: 'common.file', targetPackageId: 'dependency' });
  const diagram = engineOverview(architecture);
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]));
  const centreY = node => node.position.y + parseFloat(node.style.height) / 2;
  assert.equal(centreY(nodes.get('host')), centreY(nodes.get('unknown')), 'entry owners are presented first');
  assert.deepEqual(nodes.get('unknown').data.entryFiles, ['native/Main.kt'], 'entry evidence remains visible independently of size');
  assert.equal(parseFloat(nodes.get('unknown').style.width), 260, 'an unmeasured entry uses the readable size floor');
  const differentImports = engineOverview({ ...architecture, relations: [] });
  assert.deepEqual(differentImports.nodes.filter(node=>node.type==='subsystem').map(node=>[node.id,node.position]), diagram.nodes.filter(node=>node.type==='subsystem').map(node=>[node.id,node.position]), 'changing dependency depths does not relocate source owners');
  assert.ok(parseFloat(nodes.get('host').style.width) > parseFloat(nodes.get('common').style.width));
  assert.equal(nodes.get('unknown').data.sourceLines, null);
  assert.equal(nodes.get('visual:external-dependencies').data.sourceLines, null);
  assert.ok(!nodes.has('package'));
  assert.ok(nodes.get('visual:external-dependencies').position.x > nodes.get('common').position.x + parseFloat(nodes.get('common').style.width));
  assert.equal(diagram.edges.length, 0, 'the overview has no Engine arrows');
  assert.equal(architectureGraph(architecture).edges.length, 3, 'all source and external-use evidence is retained');
  for (const a of diagram.nodes) for (const b of diagram.nodes) if (a.id !== b.id) assert.ok(
    a.position.x + parseFloat(a.style.width) <= b.position.x || b.position.x + parseFloat(b.style.width) <= a.position.x
    || a.position.y + parseFloat(a.style.height) <= b.position.y || b.position.y + parseFloat(b.style.height) <= a.position.y,
    `${a.id} overlaps ${b.id}`);
  const isolated = engineOverview({ ...architecture, entryPoints: [] });
  assert.ok(isolated.nodes.some(node => node.id === 'unknown'), 'disconnected source owners are not dropped');
});

test('shared architecture sheet separates UI and Engine spatially, retaining cycles without Engine arrows', () => {
  const architecture = {
    ui: { pages: [{ id: 'page', title: 'Home', kind: 'screen', surface: 'native' }], registrations: [] },
    subsystems: ['a', 'b'].map(id => ({ id, title: id, root: id, fileIds: [id + '.file'] })),
    files: ['a', 'b'].map(id => ({ id: id + '.file', subsystemId: id, sourceLines: 10 })),
    relations: [['a','b'],['b','a']].map(([from,to]) => ({ resolution: 'resolved', fromFileId: from + '.file', targetFileId: to + '.file' }))
  };
  const diagram = architectureOverview(architecture);
  const divider = diagram.nodes.find(node => node.id === 'visual:divider');
  assert.ok(diagram.nodes.filter(node => node.type === 'page').every(node => node.position.y + parseFloat(node.style.height) < divider.position.y));
  assert.ok(diagram.nodes.filter(node => node.type === 'subsystem').every(node => node.position.y > divider.position.y));
  assert.equal(divider.style.height, '1px');
  assert.ok(parseFloat(divider.style.width) >= 400);
  assert.equal(diagram.edges.length, 0);
  assert.equal(architectureGraph(architecture).edges.length, 2);
  assert.ok(diagram.nodes.filter(node => node.type === 'subsystem').every(node => node.data.cycleLabel === 'Dependency cycle'));
  assert.deepEqual(diagram.uiIds, ['page']);
  assert.deepEqual(diagram.engineIds, ['a', 'b']);
});

test('storyboard centers parents over children, retains exact route identities and separates unrelated roots', () => {
  const ui = {
    pages: [
      { id: 'home', title: 'Home', kind: 'page', surface: 'web' },
      { id: 'orders', title: 'Orders', kind: 'page', surface: 'web', parentId: 'home' },
      { id: 'receipt', title: 'Receipt', kind: 'page', surface: 'web', parentId: 'orders' },
      { id: 'account', title: 'Account', kind: 'page', surface: 'web', parentId: 'home' },
      { id: 'independent', title: 'Independent', kind: 'page', surface: 'web' }
    ],
    registrations: [{ pageId: 'home', identity: '/' }, { pageId: 'receipt', identity: '/orders/receipt/:id' }, { pageId: 'independent', identity: '/orders/receipt/archive' }]
  };
  const graph = pageStoryboard(ui);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target]).sort(), [['home', 'account'], ['home', 'orders'], ['orders', 'receipt']]);
  assert.equal(nodes.get('home').position.y, 0);
  assert.equal(nodes.get('independent').position.y, 0, 'a nested-looking URL does not manufacture hierarchy');
  assert.ok(nodes.get('receipt').position.y > nodes.get('orders').position.y);
  assert.equal(nodes.get('home').position.x, (nodes.get('orders').position.x + nodes.get('account').position.x) / 2);
  assert.deepEqual(nodes.get('receipt').data.identities, ['/orders/receipt/:id']);
  for (const a of graph.nodes) for (const b of graph.nodes) if (a.id !== b.id) {
    const separated = a.position.x + parseFloat(a.style.width) <= b.position.x || b.position.x + parseFloat(b.style.width) <= a.position.x
      || a.position.y + parseFloat(a.style.height) <= b.position.y || b.position.y + parseFloat(b.style.height) <= a.position.y;
    assert.ok(separated, `${a.id} overlaps ${b.id}`);
  }
  assert.deepEqual(pageStoryboard({ ...ui, pages: [...ui.pages].reverse() }), graph);
});

test('native screens and game scenes have the same storyboard without URLs or JavaScript files', () => {
  const graph = pageStoryboard({ pages: [
    { id: 'main', title: 'Main menu', kind: 'scene', surface: 'game', file: 'Scenes/Menu.tscn' },
    { id: 'play', title: 'Play', kind: 'scene', surface: 'game', file: 'Scenes/Play.tscn', parentId: 'main' },
    { id: 'desktop', title: 'Import preview', kind: 'screen', surface: 'desktop', file: 'Preview.qml' }
  ], registrations: [{ pageId: 'desktop', identity: 'import-preview-menu' }] });
  assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target]), [['main', 'play']]);
  assert.equal(graph.nodes.find(node => node.id === 'play').data.kind, 'scene');
  assert.deepEqual(graph.nodes.find(node => node.id === 'desktop').data.identities, ['import-preview-menu']);
  assert.deepEqual(pageStoryboard(null), { nodes: [], edges: [] });
});

test('wide UI hierarchies keep siblings and unrelated roots at their actual depth, without wrapping or overlapping routes', () => {
  const graph = pageStoryboard({ pages: [
    {id:'a',title:'A'}, {id:'child',title:'Child',parentId:'a'}, {id:'grandchild',title:'Grandchild',parentId:'child'},
    {id:'b',title:'B'}, {id:'other',title:'Other child',parentId:'b'}, {id:'c',title:'C'},
    ...Array.from({length:13}, (_, index) => ({id:`sibling:${index}`,title:`Sibling ${index}`,parentId:'a'}))
  ], registrations:[{pageId:'other',identity:'/very-long-registered-route'.repeat(20)}] });
  assert.equal(new Set(graph.nodes.filter(node => node.data.depth === 0).map(node => node.position.y)).size, 1);
  assert.equal(new Set(graph.nodes.filter(node => node.data.depth === 1).map(node => node.position.y)).size, 1);
  const children = graph.nodes.filter(node => node.data.parentId === 'a');
  assert.equal(children.length, 14);
  assert.ok(Math.max(...children.map(node => node.position.x)) - Math.min(...children.map(node => node.position.x)) > 3000);
  assert.ok(graph.nodes.find(node => node.id === 'grandchild').position.y > Math.max(...children.map(node => node.position.y + parseFloat(node.style.height))));
  for (const a of graph.nodes) for (const b of graph.nodes) if(a.id!==b.id) assert.ok(
    a.position.x + parseFloat(a.style.width) <= b.position.x || b.position.x + parseFloat(b.style.width) <= a.position.x
    || a.position.y + parseFloat(a.style.height) <= b.position.y || b.position.y + parseFloat(b.style.height) <= a.position.y,
    `${a.id} overlaps ${b.id}`);
});

test('consumer ranks point downward across a diamond, skipped layer and isolated file', () => {
  const nodes = ['a', 'b', 'c', 'd', 'isolated'].map(id => ({ id }));
  const edges = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['a', 'd']].map(([fromId, toId]) => ({ fromId, toId }));
  const graph = layeredGraph(nodes, edges);
  assert.deepEqual(Object.fromEntries(graph.nodeRanks), { a: 2, c: 1, b: 1, d: 0, isolated: 0 });
  assert.equal(graph.edges.length, 5);
  assert.equal(graph.cyclicIds.size, 0);
  assert.deepEqual([...graph.disconnectedIds], ['isolated']);
  assert.deepEqual(layeredGraph([...nodes].reverse(), [...edges].reverse()).layers, graph.layers);
});

test('real cycles are retained, while recursion inside one file is not a file cycle', () => {
  const graph = layeredGraph([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ fromId: 'a', toId: 'b' }, { fromId: 'b', toId: 'a' }, { fromId: 'b', toId: 'c' }, { fromId: 'c', toId: 'c' }]);
  assert.equal(graph.edges.length, 3);
  assert.deepEqual([...graph.cyclicIds].sort(), ['a', 'b']);
  assert.equal(graph.nodeRanks.get('a'), 1);
  assert.equal(graph.nodeRanks.get('c'), 0);
});

test('aggregation-only coupling is distinguished from a concrete cross-subsystem cycle', () => {
  const files = ['a1', 'a2', 'b1', 'b2'].map(id => ({ id, subsystemId: id[0] }));
  const subsystems = ['a', 'b'].map(id => ({ id, fileIds: files.filter(file => file.subsystemId === id).map(file => file.id) }));
  const relation = (fromFileId, targetFileId) => ({ id: `${fromFileId}->${targetFileId}`, fromFileId, targetFileId, resolution: 'resolved' });
  const architecture = { files, subsystems, relations: [relation('a1', 'b1'), relation('b2', 'a2')] };
  assert.equal(architectureGraph(architecture).layers[0].groups[0].cycleLabel, 'Bidirectional subsystem coupling');
  architecture.relations.push(relation('b1', 'b2'), relation('a2', 'a1'));
  assert.equal(architectureGraph(architecture).layers[0].groups[0].cycleLabel, 'Dependency cycle');
  assert.equal(architectureGraph(architecture, 'a').boundary.length, 2);
  const local = architectureGraph(architecture, 'a');
  assert.deepEqual([...local.externalCycleFileIds].sort(), ['a1', 'a2']);
  assert.equal(local.cyclicIds.size, 0, 'a scoped view must not invent a local cycle');
  assert.equal(architectureGraph({ ...architecture, relations: architecture.relations.slice(0, 2) }, 'a').externalCycleFileIds.size, 0);
});

test('large dependency chains do not overflow the call stack', () => {
  const nodes = Array.from({ length: 5000 }, (_, index) => ({ id: String(index) }));
  const edges = nodes.slice(1).map((node, index) => ({ fromId: String(index), toId: node.id }));
  const graph = layeredGraph(nodes, edges);
  assert.equal(graph.nodeRanks.get('0'), 4999);
  assert.equal(graph.layers.length, 5000);
});

test('opaque packages are foundation boundaries at both subsystem and file depth', () => {
  const architecture = {
    files: [{ id: 'file:app.js', path: 'app.js', subsystemId: 'app' }],
    subsystems: [{ id: 'app', fileIds: ['file:app.js'] }, { id: 'external', kind: 'package', packageId: 'external', opaque: true, fileIds: [] }, { id: 'unused', packageId: 'unused', opaque: true, fileIds: [] }],
    packages: [{ id: 'external', name: 'boundary', root: 'node_modules/boundary', subsystemId: 'external', opaque: true }],
    relations: [{ id: 'import', fromFileId: 'file:app.js', targetPackageId: 'external', resolution: 'resolved' }, { id: 'second-import', fromFileId: 'file:app.js', targetPackageId: 'external', resolution: 'resolved' }],
  };
  const overview = architectureGraph(architecture);
  assert.equal(overview.nodeRanks.get('external'), 0);
  assert.equal(overview.nodeRanks.get('app'), 1);
  assert.equal(overview.nodeRanks.has('unused'), false);
  assert.deepEqual(overview.edges.map(edge => [edge.fromId, edge.toId, edge.evidence.length]), [['app', 'external', 2]]);
  const files = architectureGraph(architecture, 'app');
  assert.deepEqual(files.edges.map(edge => [edge.fromId, edge.toId, edge.evidence.length]), [['file:app.js', 'external', 2]]);
  assert.equal(files.nodeRanks.get('file:app.js'), 1);
  assert.equal(files.layers[1].groups[0].members[0].opaque, true);
});


test('component expansion is bounded while operation reachability retains hidden and recursive relationships', async () => {
  const { pageComposition, pageConnections } = await import('../../packages/vibe64-system-graph/src/client/architectureModel.js');
  const components = Array.from({ length: 16 }, (_, index) => ({ id: `c${index}` }));
  const componentUses = [{ id: 'root', parentId: 'page', componentId: 'c0' }];
  for (let index = 0; index < 15; index++) for (let branch = 0; branch < 2; branch++) componentUses.push({ id: `u${index}:${branch}`, parentId: `c${index}`, componentId: `c${index + 1}` });
  componentUses.push({ id: 'recursive', parentId: 'c15', componentId: 'c0' });
  const ui = { components, componentUses, connections: [{ id: 'deep', parentId: 'c15' }, { id: 'instance', parentId: 'u14:1' }, { id: 'unrelated', parentId: 'other' }] };
  const composition = pageComposition(ui, 'page');
  assert.equal(composition.length, 200);
  assert.equal(composition.truncated, true);
  assert.ok(composition.some(use => use.recursive));
  assert.deepEqual(pageConnections(ui, 'page').map(connection => connection.id), ['deep', 'instance']);
});

test('type-only dependencies cannot create default ranks or cycles and can be included explicitly', () => {
  const architecture = {
    files: [{ id: 'a1', subsystemId: 'a' }, { id: 'b1', subsystemId: 'b' }],
    subsystems: [{ id: 'a' }, { id: 'b' }],
    relations: [
      { id: 'value', fromFileId: 'a1', targetFileId: 'b1', resolution: 'resolved', typeOnly: false },
      { id: 'type', fromFileId: 'b1', targetFileId: 'a1', resolution: 'resolved', kind: 're-export', typeOnly: true },
    ],
  };
  const defaults = architectureGraph(architecture);
  assert.equal(defaults.cyclicIds.size, 0);
  assert.equal(defaults.nodeRanks.get('a'), 1);
  assert.equal(defaults.edges.length, 1);
  const included = architectureGraph(architecture, '', { includeTypeOnly: true });
  assert.deepEqual([...included.cyclicIds].sort(), ['a', 'b']);
  assert.equal(included.layers[0].groups[0].cycleLabel, 'Dependency cycle');
  assert.equal(architectureGraph(architecture, 'a').externalCycleFileIds.size, 0);
  assert.deepEqual([...architectureGraph(architecture, 'a', { includeTypeOnly: true }).externalCycleFileIds], ['a1']);
  const legacy = { ...architecture, relations: [{ ...architecture.relations[1], kind: 'type-import', typeOnly: undefined }] };
  assert.equal(architectureGraph(legacy).edges.length, 0);
  assert.equal(architectureGraph(legacy, '', { includeTypeOnly: true }).edges.length, 1);
});


test('UI bridges retain exact receivers and use the same relationship contract across transports and languages', () => {
  const architecture = {
    ui: {
      pages: [{id:'web',title:'Checkout'}, {id:'native',title:'Import preview',surface:'desktop'}],
      componentUses: [{id:'use',parentId:'native',componentId:'component'}],
      connections: [
        {id:'http',parentId:'web',controllerFileId:'js',resolution:'resolved',key:{protocol:'http',method:'POST',operation:'/orders'}},
        {id:'second',parentId:'web',controllerFileId:'go',resolution:'resolved',key:{protocol:'rpc',operation:'Review'}},
        {id:'local',parentId:'component',controllerFileId:'py',resolution:'resolved',key:{protocol:'local',operation:'read_record'}},
        {id:'ws',parentId:'use',controllerFileId:'go',resolution:'resolved',key:{protocol:'websocket',operation:'store'}},
        {id:'unknown',parentId:'web',resolution:'ambiguous',key:{protocol:'custom',operation:'unknown'}},
        {id:'missing',parentId:'web',resolution:'resolved',controllerFileId:'not-indexed'}
      ]
    },
    subsystems: [{id:'controllers',fileIds:['js','go']},{id:'importer',fileIds:['py']}],
    files: [{id:'js',path:'controllers/Orders.js',subsystemId:'controllers'},
      {id:'go',path:'controllers/review.go',subsystemId:'controllers'},
      {id:'py',path:'tools/read.py',subsystemId:'importer'}], relations: []
  };
  const diagram = architectureOverview(architecture);
  const bridges = diagram.edges.filter(edge => edge.type === 'controller');
  assert.equal(bridges.length, 4);
  assert.deepEqual(bridges.map(edge => edge.data.connection.key.protocol), ['http','rpc','local','websocket']);
  assert.notEqual(bridges[0].targetHandle, bridges[1].targetHandle, 'different controllers in one owner keep separate ports');
  assert.equal(bridges[0].target, bridges[1].target);
  assert.equal(bridges[0].data.controllerFile, 'controllers/Orders.js');
  assert.equal(bridges[2].source, 'native', 'component-mediated calls belong to the page');
  assert.equal(bridges[2].target, 'importer');
  assert.equal(diagram.nodes.find(node => node.id === 'web').data.unresolvedCalls, 2);
  assert.deepEqual(diagram.nodes.find(node => node.id === 'controllers').data.receivers.map(receiver => receiver.id), ['js','go']);
  assert.ok(bridges.every(edge => edge.sourceHandle === 'engine-out' && edge.markerEnd.color === '#7954b3'));
});


test('subsystem outline uses one declared owner, real folders, relative size and observed boundary entries', () => {
  const architecture = {
    subsystems: [{ id: 'out', root: 'tools/outside', fileIds: ['main', 'helper', 'internal', 'unknown'] }, { id: 'app', root: 'app', fileIds: ['caller'] }],
    files: [
      { id: 'main', path: 'tools/outside/src/main.py', subsystemId: 'out', sourceLines: 40, language: 'python' },
      { id: 'helper', path: 'tools/outside/src/deep/helper.rs', subsystemId: 'out', sourceLines: 10, language: 'rust' },
      { id: 'internal', path: 'tools/outside/private.kt', subsystemId: 'out', sourceLines: 100 },
      { id: 'unknown', path: 'tools/outside/Scene.qml', subsystemId: 'out' },
      { id: 'caller', path: 'app/host.go', subsystemId: 'app', sourceLines: 100000 }
    ],
    entryPoints: [{ fileId: 'main', file: 'tools/outside/src/main.py', subsystemId: 'out', resolution: 'resolved' }],
    relations: [
      { fromFileId: 'caller', targetFileId: 'helper', resolution: 'resolved' },
      { fromFileId: 'caller', targetFileId: 'internal', resolution: 'resolved', typeOnly: true },
      { fromFileId: 'main', targetFileId: 'internal', resolution: 'resolved' }
    ],
    symbols: [{ id: 'public-helper', fileId: 'helper', name: 'normalize', visibility: 'public', parameters: ['record'] }, { id: 'public-internal', fileId: 'internal', name: 'secret', visibility: 'public' }]
  };
  const outline = subsystemOutline(architecture, 'out');
  assert.deepEqual(outline.entryFiles.map(entry => entry.file.id).sort(), ['helper', 'internal', 'main'], 'type imports also cross the subsystem boundary');
  assert.deepEqual(outline.entryFiles.find(entry => entry.file.id === 'helper').consumers.map(file => file.id), ['caller']);
  assert.deepEqual(outline.publicEntries, [], 'exports of ordinary internal files do not define a subsystem API');
  const flat = items => items.flatMap(item => item.kind === 'directory' ? flat(item.children) : [item]);
  const leaves = flat(outline.tree);
  assert.deepEqual(leaves.map(item => item.id).sort(), ['helper', 'internal', 'main', 'unknown']);
  assert.equal(leaves.find(item => item.id === 'helper').relativePath, 'src/deep/helper.rs');
  assert.equal(leaves.find(item => item.id === 'helper').volume, 0.1, 'unrelated large source does not change local proportions');
  assert.equal(leaves.find(item => item.id === 'unknown').volume, null);
  assert.equal(outline.tree.find(item => item.name === 'src').count, 2);
  assert.deepEqual(outline.tree.map(item => item.kind), ['file', 'file', 'directory'], 'direct files precede subdirectories');
  assert.equal(outline.tree.find(item => item.name === 'src').children[0].name, 'main.py', 'files come first at every depth');
  assert.deepEqual(outline.fileLinks, [{ fromId: 'main', toId: 'internal', from: 'tools/outside/src/main.py', to: 'tools/outside/private.kt' }]);
  assert.equal(subsystemOutline(architecture, 'missing'), null);
});

test('declared public paths, available symbols and generic UI receiving operations remain distinct evidence', () => {
  const architecture = {
    subsystems: [{ id: 'owner', root: 'engine', fileIds: ['api', 'controller', 'private'] }],
    files: ['api', 'controller', 'private'].map(id => ({ id, path: `engine/${id}.java`, subsystemId: 'owner' })),
    packages: [{ id: 'lib', subsystemId: 'owner', name: 'library', opaque: false, entryPoints: [
      { importPath: '.', file: 'engine/api.java', coverage: 'partial', symbols: [{name:'publicOperation',parameters:['request']}] },
      { importPath: './extensions/*', file: 'engine/*.java', coverage: 'unavailable', symbols: [] }
    ] }],
    ui: { pages: [{ id: 'page', title: 'Desktop' }], componentUses: [{id:'use',parentId:'page',componentId:'component'}], connections: [
      { id: 'receive', parentId: 'component', controllerFileId: 'controller', resolution: 'resolved', key: { protocol: 'rpc', operation: 'Load' } },
      { id: 'not-resolved', parentId: 'page', controllerFileId: 'private', resolution: 'ambiguous', key: { protocol: 'custom' } }
    ] },
    symbols: [{id:'private-export',fileId:'private',visibility:'public',name:'onlyInternal'}]
  };
  const outline = subsystemOutline(architecture, 'owner');
  assert.deepEqual(outline.publicEntries.map(entry => entry.importPath), ['library', 'library/extensions/*']);
  assert.equal(outline.publicEntries[0].file.id, 'api');
  assert.equal(outline.publicEntries[1].file, undefined, 'a wildcard is not a concrete file');
  assert.deepEqual(outline.entryFiles.map(entry => entry.file.id), ['api', 'controller']);
  assert.deepEqual(outline.operations[0].pages.map(page => page.id), ['page']);
  assert.equal(outline.operations[0].key.protocol, 'rpc');
  assert.equal(outline.operations.length, 1);
  assert.ok(!outline.publicEntries.flatMap(entry => entry.symbols).some(symbol => symbol.name === 'onlyInternal'));
});

test('public signatures link to the exact source symbol, including overloads, without guessing opaque or ambiguous targets', () => {
  const architecture = {
    subsystems: [{id:'owner',root:'Services/Orders',fileIds:['file']},{id:'external',opaque:true,packageId:'dependency',fileIds:[]}],
    files: [{id:'file',path:'Services/Orders/Api.cs',subsystemId:'owner'}],
    symbols: [10,30].map(line=>({id:`run:${line}`,fileId:'file',qualifiedName:'Orders.Run',name:'Run',visibility:'public',start:{line,column:1}})),
    packages: [{id:'own',subsystemId:'owner',name:'Orders',entryPoints:[{importPath:'.',file:'Services/Orders/Api.cs',symbols:[
      {qualifiedName:'Orders.Run',name:'Run',start:{line:10,column:1}}, {qualifiedName:'Orders.Run',name:'Run',start:{line:30,column:1}}, {qualifiedName:'Orders.Run',name:'Run'}
    ]}]},{id:'dependency',subsystemId:'external',name:'Remote',opaque:true,entryPoints:[{importPath:'.',file:'Services/Orders/Api.cs',symbols:[{qualifiedName:'Orders.Run',name:'Run',start:{line:10,column:1}}]}]}]
  };
  const operations = subsystemOutline(architecture,'owner').publicEntries[0].symbols;
  assert.deepEqual(operations[0].source,{path:'Services/Orders/Api.cs',symbolId:'run:10',symbol:'Orders.Run',line:10});
  assert.equal(operations[1].source.symbolId,'run:30');
  assert.equal(operations[2].source,undefined,'a repeated qualified name alone is not an exact function target');
  assert.equal(subsystemOutline(architecture,'external').publicEntries[0].symbols[0].source,undefined,'external API metadata cannot grant project source navigation');
});

test('opaque packages expose declared public entries without a pretend internal tree', () => {
  const architecture = { subsystems: [{id:'opaque',opaque:true,root:'vendor/library',fileIds:[]}], packages: [{id:'package',subsystemId:'opaque',name:'library',entryPoints:[{importPath:'./api',symbols:[{name:'run'}]}]}] };
  const detail = subsystemOutline(architecture, 'opaque');
  assert.deepEqual(detail.tree, []);
  assert.deepEqual(detail.files, []);
  assert.equal(detail.publicEntries[0].importPath, 'library/api');
  assert.equal(detail.publicEntries[0].symbols[0].name, 'run');
});

test('declared aliases link to their original signatures, while boundary exports stay review candidates', () => {
  const architecture = {
    subsystems: [{id:'voice',root:'voice',fileIds:['barrel','binding']},{id:'consumer',fileIds:['app']}],
    files: [{id:'barrel',path:'voice/index.js',subsystemId:'voice'},{id:'binding',path:'voice/binding.js',subsystemId:'voice',hash:'current'},{id:'app',path:'main.py',subsystemId:'consumer'}],
    symbols: [{id:'bind',fileId:'binding',name:'createBinding',visibility:'public',parameters:['runtime'],start:{line:11,column:8}},{id:'helper',fileId:'binding',name:'helper',visibility:'public',parameters:[],start:{line:22,column:8}}],
    packages: [{subsystemId:'voice',name:'Voice',entryPoints:[{importPath:'.',file:'voice/index.js',symbols:[{name:'bind',sourceName:'createBinding',sourceFile:'voice/binding.js',sourceHash:'current',start:{line:11,column:8},parameters:['runtime']},{name:'stale',sourceName:'helper',sourceFile:'voice/binding.js',sourceHash:'outdated',start:{line:22,column:8}}]}]}],
    relations: [{fromFileId:'app',targetFileId:'binding',resolution:'resolved'}]
  };
  const detail = subsystemOutline(architecture,'voice');
  assert.equal(detail.publicSymbols[0].name,'bind');
  assert.deepEqual(detail.publicSymbols[0].source,{path:'voice/binding.js',symbolId:'bind',symbol:'createBinding',line:11});
  assert.equal(detail.publicSymbols[1].source,undefined,'stale declaration facts cannot select a current function');
  assert.deepEqual(detail.boundarySymbols.map(symbol=>symbol.name),['helper']);
  assert.equal(detail.files.length,2);
  architecture.packages[0].entryPoints.push({importPath:'./alias',file:'voice/index.js',symbols:[
    {...architecture.packages[0].entryPoints[0].symbols[0]},
    {...architecture.packages[0].entryPoints[0].symbols[0],name:'connect'}
  ]});
  const aliases = subsystemOutline(architecture,'voice');
  assert.deepEqual(aliases.publicSymbols.map(symbol=>symbol.name),['bind','stale','connect']);
  assert.deepEqual(aliases.publicSymbols[0].importPaths,['Voice','Voice/alias']);
  assert.equal(aliases.publicSymbols[2].source.symbolId,'bind','distinct public names keep the same exact implementation');
  assert.deepEqual(aliases.boundarySymbols.map(symbol=>symbol.name),['helper'],'alias names do not duplicate declared implementations as candidates');
});

test('observed signatures use declaration evidence, not every export in an imported file, across stacks', () => {
  for (const extension of ['js', 'rs', 'cs', 'py']) {
    const architecture = {
      subsystems: [{ id: 'tools', root: 'tools', fileIds: ['api', 'extra'] }, { id: 'app', root: 'app', fileIds: ['consumer'] }],
      files: [{ id: 'api', path: `tools/api.${extension}`, subsystemId: 'tools' }, { id: 'extra', path: `tools/extra.${extension}`, subsystemId: 'tools' }, { id: 'consumer', path: `app/main.${extension}`, subsystemId: 'app' }],
      symbols: [{ id: 'used', fileId: 'api', name: 'run', visibility: 'public', parameters: ['input'], start: { line: 2, column: 1 } },
        { id: 'helper', fileId: 'api', name: 'helper', visibility: 'public', parameters: [] }, { id: 'future', fileId: 'extra', name: 'future', visibility: 'public' }],
      relations: [{ fromFileId: 'consumer', targetFileId: 'api', resolution: 'resolved', importedSymbolIds: ['used'], importedNames: ['run'] }],
      capabilities: { dependencies: 'partial' }
    };
    const outline = subsystemOutline(architecture, 'tools');
    assert.deepEqual(outline.observedSymbols.map(symbol => symbol.name), ['run']);
    assert.equal(outline.observedSymbols[0].consumers[0].subsystemId, 'app');
    assert.deepEqual(outline.observedSymbols[0].source, { path: `tools/api.${extension}`, symbolId: 'used', symbol: 'run', line: 2 });
    assert.deepEqual(outline.boundarySymbols.map(symbol => symbol.name), ['helper']);
    assert.deepEqual(outline.availableSymbols.map(symbol => symbol.name), ['future']);
    assert.equal(outline.exportCount, 3);
    assert.equal(outline.publicSymbols.length, 0, 'an observed consumer does not author an intended contract');
    assert.equal(outline.dependencyCoverage, 'partial');
  }
});

test('opening subsystem detail keeps the map and exact controller port intact', () => {
  const architecture = {
    ui: {pages:[{id:'page',title:'Page'}],connections:[{id:'call',parentId:'page',resolution:'resolved',controllerFileId:'receiver',key:{protocol:'local',operation:'receive'}}]},
    subsystems:[{id:'owner',title:'Owner',root:'engine',fileIds:['receiver','helper']}],
    files:[{id:'receiver',path:'engine/controller.cpp',subsystemId:'owner',sourceLines:15}, {id:'helper',path:'engine/helper.kt',subsystemId:'owner',sourceLines:5}],
    relations:[{fromFileId:'receiver',targetFileId:'helper',resolution:'resolved'}]
  };
  const overview = architectureOverview(architecture);
  const detail = architectureOverview(architecture, 'owner');
  assert.deepEqual(detail.nodes.map(node => node.position), overview.nodes.map(node => node.position));
  assert.deepEqual(detail.nodes.map(node => node.style), overview.nodes.map(node => node.style));
  assert.equal(detail.nodes.find(node => node.id === 'owner').data.expanded, true);
  assert.ok(!detail.nodes.some(node => node.type === 'file'), 'no miniature files are squeezed into the parent card');
  assert.equal(detail.edges.find(edge => edge.type === 'controller').targetHandle, 'controller:receiver');
});

test('circle map stays compact with extreme source sizes, preserves owners on reorder and allows both-axis arrangement', () => {
  const architecture = { subsystems: Array.from({length:8}, (_,i) => ({id:`s${i}`,root:`s${i}`,fileIds:[`f${i}`]})),
    files: Array.from({length:8}, (_,i) => ({id:`f${i}`,subsystemId:`s${i}`,sourceLines:i===0?440000:100})),
    relations: Array.from({length:7}, (_,i) => ({fromFileId:`f${i}`,targetFileId:'f7',resolution:'resolved'})) };
  const before = engineOverview(architecture); const after = engineOverview(architecture, ['s2','s1','s0','s6']);
  assert.ok(before.width < 7 * 240, 'one wide dependency level cannot create a giant row');
  assert.equal(before.nodes.length, 8);
  assert.ok(before.nodes.every(node=>!node.data.layoutRow && node.data.arrangeable));
  assert.ok(!before.decorations.some(node=>node.data.kind==='layer'));
  for (const node of before.nodes) {
    assert.ok(parseFloat(node.style.width) >= 260 && parseFloat(node.style.width) <= 420, 'logarithmic sizes stay readable and bounded');
    assert.equal(node.style.width, node.style.height);
    assert.equal(node.dragHandle, '.engine-subsystem__grip');
    const reordered = after.nodes.find(peer => peer.id === node.id);
    assert.deepEqual(reordered.style, node.style, 'arrangement cannot change source-size or identity evidence');
    for (const peer of before.nodes) if (peer.id !== node.id) assert.ok(
      node.position.x + parseFloat(node.style.width) <= peer.position.x || peer.position.x + parseFloat(peer.style.width) <= node.position.x
      || node.position.y + parseFloat(node.style.height) <= peer.position.y || peer.position.y + parseFloat(peer.style.height) <= node.position.y);
  }
  assert.ok(parseFloat(before.nodes.find(node => node.id === 's0').style.width) > parseFloat(before.nodes.find(node => node.id === 's1').style.width), 'larger source owners have larger circles');
  assert.ok(after.nodes.find(node => node.id === 's2').position.x < after.nodes.find(node => node.id === 's0').position.x);
  for (const node of architectureOverview(architecture).nodes.filter(node => node.type === 'subsystem')) {
    assert.ok(node.extent[0][0] <= node.position.x && node.extent[0][1] <= node.position.y);
    assert.ok(node.extent[1][0] >= node.position.x + parseFloat(node.style.width));
    assert.ok(node.extent[1][1] >= node.position.y + parseFloat(node.style.height));
    assert.ok(node.extent[1][1] - node.extent[0][1] > parseFloat(node.style.height), 'dragging is no longer constrained to a layer row');
  }
});


test('external packages share one right-hand list without arrows for every stack, with exact public evidence retained', () => {
  const packages = Array.from({ length: 120 }, (_, index) => ({ id: `package:${index}`, subsystemId: `external:${index}`,
    name: `library-${index}`, manager: ['npm', 'pip', 'cargo', 'maven', 'nuget', 'composer'][index % 6], opaque: true,
    root: `installed/${index}`, entryPoints: [{ importPath: '.', symbols: [{ name: `operation${index}` }] }] }));
  const architecture = {
    subsystems: [{id:'app',title:'App',root:'application',fileIds:['app']}, {id:'workspace',title:'Owned library',root:'workspace/library',fileIds:['owned']},
      {id:'isolated',title:'Unconnected source',root:'source',fileIds:['isolated']},
      ...packages.map(pkg => ({id:pkg.subsystemId, title:pkg.name, root:pkg.root, opaque:true, packageId:pkg.id, fileIds:[]}))],
    files:[{id:'app',path:'application/main.py',subsystemId:'app',sourceLines:100}, {id:'owned',path:'workspace/library/api.rs',subsystemId:'workspace',sourceLines:20}, {id:'isolated',path:'source/Main.cs',subsystemId:'isolated',sourceLines:10}],
    packages:[...packages,{id:'owned-package',name:'owned',subsystemId:'workspace',opaque:false,entryPoints:[{importPath:'.',file:'workspace/library/api.rs',symbols:[]}]}],
    relations:[{fromFileId:'app',targetFileId:'owned',resolution:'resolved'}, ...packages.map(pkg => ({fromFileId:'app',targetPackageId:pkg.id,resolution:'resolved'})),
      {fromFileId:'owned',targetPackageId:packages[0].id,resolution:'resolved'}]
  };
  const diagram = engineOverview(architecture);
  const column = diagram.nodes.find(node => node.id === 'visual:external-dependencies');
  const application = diagram.nodes.filter(node => node.id !== column.id);
  assert.equal(column.data.title, 'External dependencies');
  assert.equal(column.type, 'external-dependencies');
  assert.equal(column.data.packages.length, 120);
  assert.equal(diagram.externalCount, 120);
  assert.equal(column.draggable, false);
  assert.equal(column.position.y, 0);
  assert.ok(application.every(node => node.position.x + parseFloat(node.style.width) < column.position.x));
  assert.ok(parseFloat(column.style.height) > parseFloat(column.style.width), 'names occupy one vertical list');
  assert.deepEqual(column.data.packages.map(pkg => pkg.title), packages.map(pkg => pkg.name).sort((a,b)=>a.localeCompare(b)));
  assert.equal(diagram.nodes.length, 4, 'workspace packages remain source-owned and externals consume one presentation node');
  const few = engineOverview({...architecture, subsystems:architecture.subsystems.filter(owner => !owner.opaque || owner.id === 'external:0'),packages:architecture.packages.filter(pkg=>!pkg.opaque||pkg.id==='package:0'),relations:architecture.relations.filter(relation=>!relation.targetPackageId||relation.targetPackageId==='package:0')});
  assert.equal(diagram.width, few.width, 'external package count cannot increase map width');
  assert.equal(diagram.applicationWidth, few.applicationWidth);
  assert.deepEqual(diagram.edges, []);
  assert.ok(architectureGraph(architecture).edges.some(edge=>edge.fromId==='app'&&edge.toId==='workspace'));
  assert.equal(architectureGraph(architecture).edges.filter(edge=>edge.fromId==='app'&&edge.toId.startsWith('external:')).length,120, 'individual external-use evidence remains available');
  assert.equal(subsystemOutline(architecture, column.id), null, 'the list is a presentation group, not a synthetic public API');
  const outline = subsystemOutline(architecture, 'external:0');
  assert.equal(outline.publicEntries.length, 1);
  assert.equal(outline.publicEntries[0].importPath, 'library-0');
  assert.equal(outline.publicEntries[0].symbols[0].name, 'operation0');
  assert.deepEqual(outline.files, []);
  assert.deepEqual(outline.tree, []);
  assert.ok(!outline.publicEntries.some(entry => entry.importPath === 'owned'), 'project-owned public APIs stay with their real subsystem');
  const sheet = architectureOverview(architecture);
  assert.ok(sheet.nodes.find(node=>node.id==='visual:external-dependencies').position.y <= Math.min(...sheet.nodes.filter(node=>node.type==='subsystem').map(node=>node.position.y)));
  assert.ok(!sheet.edges.some(edge=>edge.source===column.id||edge.target===column.id));
});

test('no external list is fabricated without observed package use, including type-only imports', () => {
  const architecture = {subsystems:[{id:'app',fileIds:['file']},{id:'external',opaque:true,packageId:'pkg',fileIds:[]}],files:[{id:'file',subsystemId:'app'}],packages:[{id:'pkg',name:'Dependency',subsystemId:'external',opaque:true}],relations:[{fromFileId:'file',targetPackageId:'pkg',resolution:'resolved',typeOnly:true}]};
  assert.equal(engineOverview(architecture).externalCount,0);
  assert.ok(!engineOverview(architecture).nodes.some(node=>node.id==='visual:external-dependencies'));
  assert.equal(subsystemOutline(architecture,'visual:external-dependencies'),null);
});
