import { architectureGraph } from './layeredGraph.js';

const externalDependenciesId = 'visual:external-dependencies';

// The browser consumes evidence; it never discovers routes or parses project code.
export function pageComposition(ui, pageId) {
  const components = new Map((ui?.components || []).map(component => [component.id, component]));
  const usesByParent = new Map();
  for (const use of ui?.componentUses || []) {
    if (!usesByParent.has(use.parentId)) usesByParent.set(use.parentId, []);
    usesByParent.get(use.parentId).push(use);
  }
  const result = [];
  const stack = (usesByParent.get(pageId) || []).slice().reverse().map(use => ({ use, ancestry: new Set(), depth: 0 }));
  while (stack.length && result.length < 200) {
    const { use, ancestry, depth } = stack.pop();
    const component = components.get(use.componentId);
    const recursive = ancestry.has(use.componentId);
    result.push({ ...use, component, depth, recursive, contextId: `${pageId}:${result.length}` });
    if (!component || recursive) continue;
    const next = new Set([...ancestry, component.id]);
    const children = [...(usesByParent.get(use.id) || []), ...(usesByParent.get(component.id) || [])];
    stack.push(...children.slice().reverse().map(child => ({ use: child, ancestry: next, depth: depth + 1 })));
  }
  result.truncated = stack.length > 0;
  return result;
}

export function pageConnections(ui, pageId) {
  // Operation reachability uses the complete relationship graph, independent
  // of the bounded expansion of repeated component instances in the UI.
  const parents = new Set([pageId]);
  const children = new Map();
  for (const use of ui?.componentUses || []) {
    if (!children.has(use.parentId)) children.set(use.parentId, []);
    children.get(use.parentId).push(use);
  }
  const pending = [pageId];
  while (pending.length) for (const use of children.get(pending.pop()) || []) for (const id of [use.id, use.componentId]) {
    if (!id || parents.has(id)) continue;
    parents.add(id); pending.push(id);
  }
  return (ui?.connections || []).filter(connection => parents.has(connection.parentId));
}

export function pageHierarchy(ui) {
  const pages = ui?.pages || [];
  const registrations = ui?.registrations || [];
  const rows = [];
  const children = new Map();
  for (const page of pages) {
    const parent = page.parentId || null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(page);
  }
  for (const list of children.values()) list.sort((a, b) => b.title.localeCompare(a.title));
  const stack = (children.get(null) || []).map(page => ({ page, depth: 0 }));
  while (stack.length) {
    const { page, depth } = stack.pop();
    rows.push({ ...page, depth, registrations: registrations.filter(entry => entry.pageId === page.id) });
    stack.push(...(children.get(page.id) || []).map(child => ({ page: child, depth: depth + 1 })));
  }
  return rows;
}

// Subtree widths keep siblings apart and put each parent over its children.
// Navigation ancestry is observed by the stack adapter, never inferred from URLs.
export function pageStoryboard(ui) {
  const rows = pageHierarchy(ui);
  const children = new Map();
  const widths = new Map();
  const heights = new Map();
  const depthHeights = new Map();
  const cardWidth = 264;
  const siblingGap = 36;
  for (const page of rows) {
    if (!children.has(page.parentId || null)) children.set(page.parentId || null, []);
    children.get(page.parentId || null).push(page);
    const identities = [...new Set(page.registrations.map(entry => entry.identity))];
    const height = Math.max(120, 64 + Math.ceil(page.title.length / 24) * 26
      + identities.reduce((total, identity) => total + Math.ceil(identity.length / 32) * 20, 0));
    heights.set(page.id, height);
    depthHeights.set(page.depth, Math.max(depthHeights.get(page.depth) || 0, height));
  }
  // Every hierarchy depth gets one row. Siblings never wrap into apparent
  // descendants; wide storyboards use the canvas's existing pan and zoom.
  for (const page of [...rows].reverse()) {
    const descendants = children.get(page.id) || [];
    widths.set(page.id, Math.max(cardWidth, descendants.reduce((total, child) => total + widths.get(child.id), 0)
      + Math.max(0, descendants.length - 1) * siblingGap));
  }
  const depthTops = new Map();
  let y = 0;
  for (const [depth, height] of [...depthHeights].sort((a, b) => a[0] - b[0])) {
    depthTops.set(depth, y);
    y += height + 84;
  }
  const left = new Map();
  let rootLeft = 0;
  for (const root of children.get(null) || []) {
    left.set(root.id, rootLeft);
    rootLeft += widths.get(root.id) + 100;
  }
  const nodes = rows.map(page => {
    let childLeft = left.get(page.id);
    for (const child of children.get(page.id) || []) {
      left.set(child.id, childLeft);
      childLeft += widths.get(child.id) + siblingGap;
    }
    return {
      id: page.id,
      type: 'page',
      position: { x: left.get(page.id) + (widths.get(page.id) - cardWidth) / 2, y: depthTops.get(page.depth) },
      style: { width: `${cardWidth}px`, height: `${heights.get(page.id)}px` },
      data: { ...page, identities: [...new Set(page.registrations.map(entry => entry.identity))], childCount: (children.get(page.id) || []).length }
    };
  });
  return {
    nodes,
    edges: rows.filter(page => page.parentId).map(page => ({
      id: `parent:${page.id}`, source: page.parentId, target: page.id,
      sourceHandle: 'children', targetHandle: 'parent', type: 'smoothstep',
      selectable: false, style: { stroke: '#93a7ba', strokeWidth: 2 }
    }))
  };
}

export function engineOverview(architecture, order = []) {
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const graph = architectureGraph(architecture);
  const externalPackages = graph.layers.flatMap(layer => layer.groups.flatMap(group => group.members)).filter(owner => owner.opaque)
    .sort((a, b) => a.title.localeCompare(b.title));
  const applicationLayers = graph.layers.map(layer => ({ ...layer,
    groups: layer.groups.map(group => ({ ...group, members: group.members.filter(owner => !owner.opaque) })).filter(group => group.members.length)
  }));
  const files = new Map((architecture?.files || []).map(file => [file.id, file]));
  const placements = new Map((architecture?.layout?.groups || []).flatMap((group, index) => group.subsystems.map((member, memberIndex) => [member.root, { ...member, kind: group.kind, groupId: group.id, order: index, memberOrder: memberIndex }])));
  const entryOwners = new Set((architecture?.entryPoints || []).filter(entry => entry.resolution === 'resolved').map(entry => entry.subsystemId));
  const cards = new Map();
  const totals = applicationLayers.flatMap(layer => layer.groups.flatMap(group => group.members)).map(subsystem =>
    (subsystem.fileIds || []).map(id => files.get(id)?.sourceLines).filter(Number.isSafeInteger).reduce((sum, lines) => sum + Math.max(0, lines), 0));
  const largest = Math.max(1, ...totals);
  for (const layer of applicationLayers) for (const group of layer.groups) for (const subsystem of group.members) {
    const sourceFiles = (subsystem.fileIds || []).map(id => files.get(id)).filter(Boolean);
    const measured = sourceFiles.filter(file => Number.isSafeInteger(file.sourceLines) && file.sourceLines >= 0);
    const sourceLines = measured.length ? measured.reduce((total, file) => total + file.sourceLines, 0) : null;
    // Logarithmic diameter keeps both tiny and very large owners readable.
    // Role styling is independent of size; unknown sizes get the readable floor.
    const volume = Math.log1p((sourceLines || 0) / 100) / Math.log1p(largest / 100);
    const placement = placements.get(subsystem.root);
    const width = 260 + 160 * volume;
    const height = width;
    const publicEntries = (architecture?.packages || []).filter(pkg => pkg.subsystemId === subsystem.id).flatMap(pkg => pkg.entryPoints || []);
    const receivingFiles = new Set((architecture?.relations || []).filter(relation => relation.resolution === 'resolved'
      && files.get(relation.targetFileId)?.subsystemId === subsystem.id && files.get(relation.fromFileId)?.subsystemId !== subsystem.id).map(relation => relation.targetFileId));
    const publicCount = new Set(publicEntries.flatMap(entry => (entry.symbols || []).map(symbol => `${symbol.sourceFile || entry.file}:${symbol.qualifiedName || symbol.name}:${symbol.start?.line || ''}`))).size;
    const publicSummary = publicCount ? `${publicCount} public declaration${publicCount === 1 ? '' : 's'}` : publicEntries.length ? 'Public declarations need analysis'
      : receivingFiles.size ? 'Exported signatures to review' : 'Public interface not recorded';
    cards.set(subsystem.id, {
      id: subsystem.id, type: 'subsystem', style: { width: `${width}px`, height: `${height}px` },
      data: { ...subsystem, ...(placement ? { placementKind: placement.kind } : {}), publicSummary,
        library: placement?.kind === 'libraries', presentationOrder: placement?.order ?? Infinity, memberOrder: placement?.memberOrder ?? Infinity, sourceLines, sizePartial: measured.length !== sourceFiles.length, measuredFiles: measured.length, sourceVolume: (sourceLines || 0) / largest,
        entryFiles: (architecture?.entryPoints || []).filter(entry => entry.subsystemId === subsystem.id).map(entry => entry.file),
        cycleLabel: group.cyclic ? group.cycleLabel : '', disconnected: graph.disconnectedIds.has(subsystem.id), rank: layer.rank }
    });
  }
  // Display every source owner, independently of entry status, import rank or
  // authored layer groups. Position is an arrangement, not an architectural rule.
  const sourceCards = [...cards.values()].sort((a, b) =>
    (orderIndex.get(a.id) ?? Infinity) - (orderIndex.get(b.id) ?? Infinity)
    || Number(!entryOwners.has(a.id)) - Number(!entryOwners.has(b.id))
    || Number(a.data.placementKind === 'support') - Number(b.data.placementKind === 'support')
    || a.data.presentationOrder - b.data.presentationOrder
    || a.data.memberOrder - b.data.memberOrder
    || (a.data.root || a.id).localeCompare(b.data.root || b.id));
  const libraryCards = sourceCards.filter(card => card.data.library);
  const applicationCards = sourceCards.filter(card => !card.data.library);
  const columns = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(applicationCards.length))));
  const cellSize = Math.max(280, ...applicationCards.map(card => parseFloat(card.style.width)));
  const gap = 56;
  const applicationWidth = applicationCards.length ? columns * cellSize + (columns - 1) * gap : 0;
  const rowCount = Math.ceil(applicationCards.length / columns);
  const applicationHeight = rowCount ? rowCount * cellSize + (rowCount - 1) * gap : 0;
  const decorations = [];
  const nodes = [];
  for (const [index, card] of applicationCards.entries()) {
    const inset = (cellSize - parseFloat(card.style.width)) / 2;
    card.position = { x: (index % columns) * (cellSize + gap) + inset, y: Math.floor(index / columns) * (cellSize + gap) + inset };
    card.data.arrangeable = true;
    card.data.initialFocus = index < columns;
    card.draggable = true;
    card.dragHandle = '.engine-subsystem__grip';
    nodes.push(card);
  }
  let width = applicationWidth;
  let height = Math.max(200, applicationHeight);
  if (libraryCards.length) {
    const columnX = applicationWidth + 48;
    const columnWidth = Math.max(...libraryCards.map(card => parseFloat(card.style.width)));
    decorations.push({ id: 'visual:shared-libraries', type: 'annotation', position: { x: columnX, y: 0 },
      style: { width: `${columnWidth}px`, height: '76px' }, selectable: false, focusable: false, draggable: false,
      data: { kind: 'libraries', title: 'Shared libraries', detail: 'Project-owned reusable interfaces' } });
    let libraryY = 88;
    for (const card of libraryCards) {
      card.position = { x: columnX + (columnWidth - parseFloat(card.style.width)) / 2, y: libraryY };
      card.data.library = true;
      card.draggable = false;
      nodes.push(card);
      libraryY += parseFloat(card.style.height) + 24;
    }
    width = columnX + columnWidth;
    height = Math.max(height, libraryY - 24);
  }
  if (externalPackages.length) {
    const columnWidth = Math.min(640, Math.max(420, ...externalPackages.map(pkg => pkg.title.length * 9 + 48)));
    const charactersPerLine = Math.floor((columnWidth - 48) / 9);
    const columnHeight = 112 + externalPackages.reduce((total, pkg) => total + 15 + 22 * Math.ceil(pkg.title.length / charactersPerLine), 0);
    nodes.push({ id: externalDependenciesId, type: 'external-dependencies', position: { x: width + 48, y: 0 },
      style: { width: `${columnWidth}px`, height: `${columnHeight}px` }, draggable: false,
      data: { id: externalDependenciesId, kind: 'external-dependencies', title: 'External dependencies',
        root: '', opaque: true, fileIds: [], entryFiles: [], sourceLines: null, packages: externalPackages,
        description: 'Available throughout the project. Select a dependency to read its public interface.' }
    });
    width += 48 + columnWidth;
    height = Math.max(height, columnHeight);
  }
  // The overview communicates declared roles and public boundaries. Actual
  // imports/cycles remain in architectureGraph and the existing file inspector.
  return { nodes, edges: [], decorations, width, height, applicationWidth, applicationHeight, externalCount: externalPackages.length };
}

function symbolSource(path, symbol) {
  return { path, symbolId: symbol.id, symbol: symbol.qualifiedName || symbol.name, line: symbol.start?.line };
}

// File ownership and API declarations come from the index. Directory nesting is
// presentation only; internal file exports do not define a subsystem's contract.
export function subsystemOutline(architecture, subsystemId) {
  const nativeOwner = (architecture?.subsystems || []).find(subsystem => subsystem.id === subsystemId);
  if (!nativeOwner) return null;
  const placementGroup = (architecture?.layout?.groups || []).find(group => group.subsystems.some(member => member.root === nativeOwner.root));
  const placement = placementGroup?.subsystems.find(member => member.root === nativeOwner.root);
  const owner = placement ? { ...nativeOwner, placementKind: placementGroup.kind } : nativeOwner;
  const files = new Map((architecture?.files || []).map(file => [file.id, file]));
  const local = owner.opaque ? [] : [...files.values()].filter(file => file.subsystemId === owner.id);
  const localIds = new Set(local.map(file => file.id));
  const byPath = new Map(local.map(file => [file.path, file]));
  const sourceFilesByPath = new Map([...files.values()].map(file => [file.path, file]));
  const symbolsByFile = new Map();
  for (const symbol of architecture?.symbols || []) if (symbol.visibility === 'public') {
    if (!symbolsByFile.has(symbol.fileId)) symbolsByFile.set(symbol.fileId, []);
    symbolsByFile.get(symbol.fileId).push(symbol);
  }
  const entries = new Map();
  const addEntry = (file, reason) => {
    if (!file || !localIds.has(file.id)) return;
    if (!entries.has(file.id)) entries.set(file.id, { file, reasons: new Set(), consumers: new Map() });
    entries.get(file.id).reasons.add(reason);
    return entries.get(file.id);
  };
  for (const entry of architecture?.entryPoints || []) if (entry.resolution === 'resolved' && entry.subsystemId === owner.id) {
    addEntry(files.get(entry.fileId) || byPath.get(entry.file), 'Application entry');
  }
  const publicEntries = (architecture?.packages || []).filter(pkg => pkg.subsystemId === owner.id).flatMap(pkg =>
    (pkg.entryPoints || []).map(entry => {
      const file = byPath.get(entry.file);
      addEntry(file, 'Declared public import');
      return { ...entry, file, symbols: (entry.symbols || []).map(symbol => {
        const sourceFile = symbol.sourceFile ? files.get(`file:${symbol.sourceFile}`) || sourceFilesByPath.get(symbol.sourceFile) : file;
        // Join package exposure to a concrete source symbol. Qualified names
        // alone cannot distinguish overloads, and opaque packages have no source.
        const candidates = (symbolsByFile.get(sourceFile?.id) || []).filter(candidate => !owner.opaque && (!symbol.sourceHash || symbol.sourceHash === sourceFile.hash)
          && (candidate.qualifiedName || candidate.name) === (symbol.sourceQualifiedName || symbol.sourceName || symbol.qualifiedName || symbol.name)
          && (!symbol.start || candidate.start?.line === symbol.start.line && candidate.start?.column === symbol.start.column));
        const source = candidates.length === 1 ? candidates[0] : null;
        return { ...symbol, ...(source ? { source: symbolSource(sourceFile.path, source) } : {}) };
      }), conditions: entry.conditions || [],
        importPath: entry.importPath === '.' ? pkg.name : `${pkg.name}${entry.importPath?.startsWith('./') ? entry.importPath.slice(1) : '/' + (entry.importPath || '')}` };
    }));
  // A directory browser needs the observed boundary, not a fresh dependency
  // layering of every file in the project. Keep the graph owner for graph views.
  const packages = new Map((architecture?.packages || []).map(pkg => [pkg.id, pkg]));
  const symbolsById = new Map((architecture?.symbols || []).map(symbol => [symbol.id, symbol]));
  const observed = new Map();
  const fileLinks = new Map();
  const importsByFile = new Map();
  const importsBySymbol = new Map();
  const exposedFiles = new Set(publicEntries.flatMap(entry => entry.symbols.map(symbol => sourceFilesByPath.get(symbol.source?.path)?.id)).filter(Boolean));
  for (const relation of architecture?.relations || []) {
    if (relation.resolution !== 'resolved') continue;
    const from = files.get(relation.fromFileId);
    const to = files.get(relation.targetFileId) || packages.get(relation.targetPackageId);
    if (!from || !to) continue;
    if (localIds.has(to.id) || exposedFiles.has(to.id)) {
      if (!importsByFile.has(to.id)) importsByFile.set(to.id, new Map());
      importsByFile.get(to.id).set(from.id, from);
      for (const id of relation.importedSymbolIds || []) {
        const symbol = symbolsById.get(id);
        if (!symbol || symbol.fileId !== to.id || symbol.visibility !== 'public') continue;
        if (!importsBySymbol.has(id)) importsBySymbol.set(id, new Map());
        importsBySymbol.get(id).set(from.id, from);
      }
    }
    if (localIds.has(to.id) && !localIds.has(from.id)) {
      addEntry(to, 'Used by other subsystems').consumers.set(from.id, from);
      for (const id of relation.importedSymbolIds || []) {
        const symbol = symbolsById.get(id);
        if (!symbol || symbol.fileId !== to.id || symbol.visibility !== 'public') continue;
        if (!observed.has(id)) observed.set(id, { ...symbol, consumers: new Map(), source: symbolSource(to.path, symbol) });
        observed.get(id).consumers.set(from.id, from);
      }
    }
    if (relation.typeOnly || relation.kind === 'type-import') continue;
    if (from.id !== to.id && localIds.has(from.id) && (localIds.has(to.id) || !relation.targetFileId)) {
      const key = JSON.stringify([from.id, to.id]);
      fileLinks.set(key, { fromId: from.id, toId: to.id, from: from.path, to: to.path || to.name });
    }
  }
  const pages = architecture?.ui?.pages || [];
  let callsByPage; // page id -> ids of the UI calls it reaches, built once when needed
  const operations = (architecture?.ui?.connections || []).filter(connection => connection.resolution === 'resolved' && localIds.has(connection.controllerFileId)).map(connection => {
    const file = files.get(connection.controllerFileId);
    addEntry(file, 'Receives UI calls');
    callsByPage ||= new Map(pages.map(page => [page.id, new Set(pageConnections(architecture.ui, page.id).map(call => call.id))]));
    return { ...connection, file, pages: pages.filter(page => callsByPage.get(page.id).has(connection.id)) };
  });
  const entryFiles = [...entries.values()].map(entry => ({ ...entry, reasons: [...entry.reasons], consumers: [...entry.consumers.values()],
    symbols: symbolsByFile.get(entry.file.id) || []
  })).sort((a, b) => a.file.path.localeCompare(b.file.path));
  const programs = (architecture?.program?.modules || []).filter(module => module.subsystemId === owner.id);
  const programsByFile = new Map();
  for (const module of architecture?.program?.modules || []) for (const source of module.sources) {
    if (!programsByFile.has(source)) programsByFile.set(source, []);
    programsByFile.get(source).push(module);
  }
  const largest = Math.max(1, ...local.map(file => Number.isSafeInteger(file.sourceLines) ? file.sourceLines : 0));
  const root = { children: [] };
  const directories = new Map([['', root]]);
  for (const file of local) {
    const prefix = owner.root && owner.root !== '.' ? owner.root + '/' : '';
    const relativePath = prefix && file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
    const segments = relativePath.split('/');
    let directory = root;
    let path = '';
    for (const name of segments.slice(0, -1)) {
      path = path ? path + '/' + name : name;
      if (!directories.has(path)) {
        const folder = { kind: 'directory', name, path, children: [], count: 0 };
        directories.set(path, folder); directory.children.push(folder);
      }
      directory = directories.get(path);
      directory.count++;
    }
    directory.children.push({ kind: 'file', id: file.id, name: segments.at(-1), file, relativePath,
      reasons: entries.has(file.id) ? [...entries.get(file.id).reasons] : [],
      programs: programsByFile.get(file.path) || [],
      publicCount: symbolsByFile.get(file.id)?.length || 0,
      volume: Number.isSafeInteger(file.sourceLines) ? Math.max(0, file.sourceLines) / largest : null });
  }
  for (const directory of directories.values()) directory.children.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'file' ? -1 : 1) || a.name.localeCompare(b.name));
  const publicSymbols = new Map();
  const declaredSymbolIds = new Set();
  for (const entry of publicEntries) for (const symbol of entry.symbols) {
    const key = `${symbol.source?.symbolId || entry.importPath}:${symbol.qualifiedName || symbol.name}:${symbol.start?.line || ''}`;
    if (symbol.source?.symbolId) declaredSymbolIds.add(symbol.source.symbolId);
    if (!publicSymbols.has(key)) publicSymbols.set(key, { ...symbol, importPaths: [] });
    const exposed = publicSymbols.get(key);
    if (!exposed.importPaths.includes(entry.importPath)) exposed.importPaths.push(entry.importPath);
  }
  const boundarySymbols = entryFiles.filter(entry => entry.consumers.length).flatMap(entry => entry.symbols.filter(symbol => !declaredSymbolIds.has(symbol.id) && !observed.has(symbol.id)).map(symbol => ({ ...symbol, consumers: entry.consumers, source: symbolSource(entry.file.path, symbol) })));
  const observedSymbols = [...observed.values()].map(symbol => ({ ...symbol, declared: declaredSymbolIds.has(symbol.id), consumers: [...symbol.consumers.values()] }));
  const candidates = new Set(boundarySymbols.map(symbol => symbol.id));
  const availableSymbols = local.flatMap(file => (symbolsByFile.get(file.id) || []).filter(symbol => !declaredSymbolIds.has(symbol.id) && !observed.has(symbol.id) && !candidates.has(symbol.id))
    .map(symbol => ({ ...symbol, source: symbolSource(file.path, symbol) })));
  for (const symbol of [...publicSymbols.values(), ...observedSymbols, ...boundarySymbols, ...availableSymbols]) {
    if (!symbol.source) continue;
    const exact = [...(importsBySymbol.get(symbol.source.symbolId)?.values() || [])];
    const sourceFile = sourceFilesByPath.get(symbol.source.path);
    symbol.consumers = (exact.length ? exact : [...(importsByFile.get(sourceFile?.id)?.values() || [])]).sort((a, b) => a.path.localeCompare(b.path));
    symbol.consumerEvidence = exact.length ? 'declaration' : 'file';
  }
  return { owner, tree: root.children, files: local, programs, programStatus: architecture?.program?.status || 'unavailable', programDiagnostics: architecture?.program?.diagnostics || [], entryFiles, publicEntries, publicSymbols: [...publicSymbols.values()], observedSymbols, boundarySymbols, availableSymbols, operations, fileLinks: [...fileLinks.values()], dependencyCoverage: architecture?.ui?.capabilities?.imports || architecture?.capabilities?.dependencies || 'unconfigured', exportCount: local.reduce((count, file) => count + (symbolsByFile.get(file.id)?.length || 0), 0) };
}

export function architectureOverview(architecture, expandedSubsystemId = '', order = []) {
  const ui = pageStoryboard(architecture?.ui);
  const engine = engineOverview(architecture, order);
  const uiWidth = Math.max(400, ...ui.nodes.map(node => node.position.x + parseFloat(node.style.width)));
  const uiHeight = Math.max(200, ...ui.nodes.map(node => node.position.y + parseFloat(node.style.height)));
  const width = Math.max(uiWidth, engine.width);
  const uiLeft = (width - uiWidth) / 2;
  const engineLeft = (width - engine.width) / 2;
  const engineTop = ui.nodes.length ? uiHeight + 112 : 0;
  const uiParents = ui.nodes.filter(node => node.data.childCount);
  const uiFocus = uiParents.length ? uiParents : ui.nodes.slice(0, 3);
  const uiHeadingLeft = uiLeft + (uiFocus[0]?.position.x || 0);
  const shift = (node, x, y) => ({ ...node, position: { x: node.position.x + x, y: node.position.y + y + 48 } });
  const annotations = [
    ...(ui.nodes.length ? [{ id: 'visual:ui-heading', type: 'annotation', position: { x: uiHeadingLeft, y: 0 }, style: { width: '640px', height: '36px' }, data: { kind: 'heading', title: 'UI', detail: 'Pages / screens / scenes · parents above children · siblings on the same row' } }] : []),
    ...(engine.nodes.length ? [{ id: 'visual:engine-heading', type: 'annotation', position: { x: engineLeft, y: engineTop }, style: { width: '640px', height: '36px' }, data: { kind: 'heading', title: 'Engine', detail: 'Directory subsystems · interfaces and responsibilities' } }] : []),
    ...(ui.nodes.length ? [{ id: 'visual:divider', type: 'annotation', position: { x: 0, y: uiHeight + 84 }, style: { width: `${width}px`, height: '1px' }, data: { kind: 'divider' } }] : []),
    ...engine.decorations.map(node => shift(node, engineLeft, engineTop))
  ].map(node => ({ ...node, selectable: false, focusable: false, draggable: false, zIndex: -1 }));
  // Stack analysers own transport and code discovery. These validated facts
  // already identify the receiving file, irrespective of language or protocol.
  const files = new Map((architecture?.files || []).map(file => [file.id, file]));
  const owners = new Map(engine.nodes.map(node => [node.id, node]));
  const bridges = [];
  for (const page of ui.nodes) {
    const connections = pageConnections(architecture?.ui, page.id);
    page.data.unresolvedCalls = 0;
    page.data.callCount = 0;
    for (const connection of connections) {
      const file = files.get(connection.controllerFileId);
      const owner = owners.get(file?.subsystemId);
      if (connection.resolution !== 'resolved' || !file || !owner) {
        page.data.unresolvedCalls++;
        continue;
      }
      const receivers = owner.data.receivers ||= [];
      if (!receivers.some(receiver => receiver.id === file.id)) receivers.push({ id: file.id, path: file.path });
      const key = connection.key || {};
      const operation = [key.protocol, key.method, key.operation].filter(Boolean).join(' · ');
      bridges.push({
        id: `call:${page.id}:${connection.id}`, source: page.id, target: owner.id,
        sourceHandle: 'engine-out', targetHandle: `controller:${file.id}`, type: 'controller',
        selectable: true, zIndex: 2,
        markerEnd: { type: 'arrowclosed', color: '#7954b3', width: 18, height: 18 },
        style: { stroke: '#7954b3', strokeWidth: 2 },
        data: { connection, controllerFile: file.path, operation,
          label: `${file.path.split('/').pop()} · ${operation}` }
      });
      page.data.callCount++;
    }
  }
  const engineNodes = engine.nodes.map(node => shift(node, engineLeft, engineTop));
  for (const node of engineNodes) {
    node.data.expanded = node.id === expandedSubsystemId;
    if (node.data.arrangeable) node.extent = [[engineLeft, engineTop + 48], [engineLeft + engine.applicationWidth, engineTop + 48 + engine.applicationHeight]];
  }
  return {
    nodes: [...annotations, ...ui.nodes.map(node => shift(node, uiLeft, 0)), ...engineNodes],
    edges: [...ui.edges, ...engine.edges, ...bridges],
    uiIds: ui.nodes.map(node => node.id), engineIds: engine.nodes.map(node => node.id), externalCount: engine.externalCount,
    initialIds: [...uiFocus.map(node => node.id), ...engine.nodes.filter(node => node.data.initialFocus || engine.nodes.length === 1).map(node => node.id), ...annotations.filter(node => node.data.kind === 'heading').map(node => node.id)]
  };
}
