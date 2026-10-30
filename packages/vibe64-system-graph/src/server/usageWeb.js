import { inspectVibe64ArchitectureLayout } from "@local/vibe64-genesis/server";
import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { vibe64Result } from "@local/vibe64-core/server/serverResponses";

import {
  readGenesisCallWeb,
  readGenesisCity,
  requireGenesisCity
} from "./genesisCities.js";

// Usage queries start from one Genesis entry point and return only what it
// reaches: files through Imports, functions through Calls. Every response is
// bounded; nothing here returns the project's whole import or call graph.
const USAGE_ENTRY_KINDS = Object.freeze([
  "page", "component", "route", "action", "library-export", "cli-command", "job", "program-operation", "test"
]);
const USAGE_QUERY_LIMITS = Object.freeze({
  entries: 50,
  entriesMax: 200,
  searchLength: 80,
  maxNodes: 300,
  maxNodesMax: 1000,
  responseBytes: 1024 * 1024,
  unresolved: 50,
  functionList: 200,
  joinFunctions: 1500
});
const CALL_WEB_CACHE_SESSIONS = 2;
const CALL_WEB_CACHE_IDLE_MS = 10 * 60 * 1000;
const NEAR_LINES = 3;

function usageError(message, code, details) {
  const error = vibe64Error(message, code);
  if (details) error.details = details;
  return error;
}

const byText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const pointBefore = (left, right) => left.line - right.line || left.column - right.column;

// ---------------------------------------------------------------- snapshot

function layoutGroups(layout) {
  return (layout?.groups || []).map((group) => ({ id: group.id, title: group.title, kind: group.kind, roots: group.subsystems.map((member) => member.root) }));
}

// Machine City links each page or component to the components its template
// renders. Calls follows them as "renders" steps between files, keeping the
// link's certainty: a tag resolved through its import is exact.
function renderLinks(ui) {
  const fileOf = new Map([...(ui?.pages || []), ...(ui?.components || [])].filter((record) => record.file).map((record) => [record.id, record.file]));
  const uses = new Map((ui?.componentUses || []).map((use) => [use.id, use]));
  const links = new Map();
  for (const use of uses.values()) {
    // A tag inside another tag's slot is still drawn by the file around both.
    let parentId = use.parentId;
    for (let hops = 0; uses.has(parentId) && hops < uses.size; hops += 1) parentId = uses.get(parentId).parentId;
    const from = fileOf.get(parentId);
    const to = fileOf.get(use.componentId);
    if (!from || !to || from === to) continue;
    const certainty = use.resolution === "resolved" ? "exact" : "probable";
    const key = `${from}\n${to}`;
    if (links.get(key)?.certainty === "exact" || (links.has(key) && certainty !== "exact")) continue;
    links.set(key, { from, to, certainty, title: use.title || "", start: use.evidence?.find((item) => item.path === from)?.start || null });
  }
  const grouped = (end) => {
    const byFile = new Map();
    for (const link of [...links.values()].sort((left, right) => byText(left.from, right.from) || byText(left.to, right.to))) {
      if (!byFile.has(link[end])) byFile.set(link[end], []);
      byFile.get(link[end]).push(link);
    }
    return byFile;
  };
  return { rendersFrom: grouped("from"), rendersInto: grouped("to") };
}

// Pages are named by their address: page files are often all called "index".
function pageAddresses(ui) {
  const addresses = new Map();
  for (const registration of ui?.registrations || []) if (!addresses.has(registration.pageId)) addresses.set(registration.pageId, registration.identity);
  return addresses;
}

// One index per validated Machine City object. City reads share that object
// while its file is unchanged, so this is built once per snapshot.
function buildSnapshotIndex(record, layout) {
  const machine = requireGenesisCity(record, "machine");
  const architecture = machine.architecture;
  if (!architecture) throw usageError("This scan has no architecture. Refresh analysis.", "vibe64_genesis_city_missing");
  const groups = layoutGroups(layout);
  const groupByRoot = new Map(groups.flatMap((group) => group.roots.map((root) => [root, group.id])));
  const subsystems = (architecture.subsystems || []).map((owner) => ({
    id: owner.id, title: owner.title || owner.root || owner.id, root: owner.root || "", group: groupByRoot.get(owner.root) ?? null
  }));
  const subsystemById = new Map(subsystems.map((owner) => [owner.id, owner]));
  const files = new Map();
  const fileByPath = new Map();
  for (const file of architecture.files || []) {
    files.set(file.id, file);
    fileByPath.set(file.path, file);
  }
  const imports = new Map();
  const unresolvedImports = new Map();
  for (const relation of architecture.relations || []) {
    if (relation.typeOnly) continue;
    if (relation.resolution === "resolved" && relation.targetFileId && files.has(relation.targetFileId)) {
      if (!imports.has(relation.fromFileId)) imports.set(relation.fromFileId, []);
      imports.get(relation.fromFileId).push(relation.targetFileId);
    } else if (relation.resolution !== "resolved") {
      unresolvedImports.set(relation.fromFileId, (unresolvedImports.get(relation.fromFileId) || 0) + 1);
    }
  }
  const order = new Map(USAGE_ENTRY_KINDS.map((kind, index) => [kind, index]));
  const callWeb = architecture.callWeb || null;
  const addresses = pageAddresses(architecture.ui);
  const entries = (architecture.entryPoints || [])
    .filter((entry) => order.has(entry.kind))
    .map((entry) => {
      const functionIds = Array.isArray(entry.functionIds) ? entry.functionIds : [];
      return {
        id: entry.id,
        kind: entry.kind,
        title: (entry.kind === "page" && addresses.get(entry.pageId)) || entry.title || entry.file,
        file: entry.file,
        subsystemId: fileByPath.get(entry.file)?.subsystemId ?? null,
        hasCalls: Boolean(callWeb) && (functionIds.length > 0 || entry.kind === "page" || entry.kind === "component"),
        functionIds,
        search: `${entry.title || ""}\n${entry.file || ""}`.toLowerCase()
      };
    })
    .sort((left, right) => order.get(left.kind) - order.get(right.kind) || byText(left.title, right.title) || byText(left.id, right.id));
  return {
    architecture,
    entries,
    entryById: new Map(entries.map((entry) => [entry.id, entry])),
    files,
    fileByPath,
    groups: groups.map(({ id, title, kind }) => ({ id, title, kind })),
    imports,
    ...renderLinks(architecture.ui),
    subsystemById,
    subsystems,
    unresolvedImports,
    snapshot: {
      sourceIdentity: architecture.sourceHash || null,
      callWebIdentity: callWeb?.identity || null,
      builtAt: record.builtAt || null,
      // The System Graph's own out-of-date signal: Genesis re-indexed source
      // without the inspectors, so observations and calls need a re-scan.
      stale: (architecture.diagnostics || []).some((item) => item.code === "ARCHITECTURE_UI_STALE")
    }
  };
}

// Longest declared root owning a path that the snapshot never indexed.
function subsystemForPath(index, filePath) {
  const indexed = index.fileByPath.get(filePath);
  if (indexed) return indexed.subsystemId ?? null;
  let best = null;
  for (const owner of index.subsystems) {
    const root = owner.root;
    const owns = root === "." || root === "" || filePath === root || filePath.startsWith(`${root}/`);
    const depth = root === "." || root === "" ? 0 : root.length;
    if (owns && (!best || depth > best.depth)) best = { id: owner.id, depth };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------- call web

function buildCallIndex(document) {
  const functions = document.functions;
  const count = functions.length;
  const files = document.files;
  const ids = new Map(functions.map((fn, position) => [fn.id, position]));
  const outCalls = Array.from({ length: count }, () => []);
  const inCalls = Array.from({ length: count }, () => []);
  const outBridges = Array.from({ length: count }, () => []);
  const inBridges = Array.from({ length: count }, () => []);
  document.calls.forEach((call, position) => {
    outCalls[call.from].push(position);
    for (const target of call.targets) inCalls[target].push(position);
  });
  document.bridges.forEach((bridge, position) => {
    outBridges[bridge.from].push(position);
    inBridges[bridge.to].push(position);
  });
  const byPath = new Map();
  functions.forEach((fn, position) => {
    const filePath = files[fn.file].path;
    if (!byPath.has(filePath)) byPath.set(filePath, []);
    byPath.get(filePath).push(position);
  });
  // A file's top-level code (else its first function) stands for the file
  // in render steps.
  const anchorByPath = new Map([...byPath].map(([filePath, positions]) => [
    filePath, positions.find((position) => functions[position].kind === "module") ?? positions[0]
  ]));
  return {
    anchorByPath,
    bridges: document.bridges,
    byPath,
    calls: document.calls,
    fileByPath: new Map(files.map((file) => [file.path, file])),
    files,
    functions,
    ids,
    inBridges,
    inCalls,
    outBridges,
    outCalls
  };
}

function bridgeCallee(bridge) {
  const key = bridge.operationKey || {};
  return [key.method, key.operation].filter(Boolean).join(" ") || "request";
}

// Every edge leaving a function that the traversal may follow. Probable calls
// with several candidates contribute one edge per candidate.
function forEachEdge(callIndex, from, allowed, visit) {
  for (const position of callIndex.outCalls[from]) {
    const call = callIndex.calls[position];
    if (!allowed(call.certainty)) continue;
    for (const to of call.targets) visit(to, call.certainty, call.method);
  }
  for (const position of callIndex.outBridges[from]) {
    const bridge = callIndex.bridges[position];
    if (allowed(bridge.certainty)) visit(bridge.to, bridge.certainty, "operation");
  }
}

// Render steps leaving a file's anchor: to each rendered component's anchor.
function forEachRender(index, callIndex, from, allowed, visit) {
  const filePath = callIndex.files[callIndex.functions[from].file].path;
  if (callIndex.anchorByPath.get(filePath) !== from) return;
  for (const link of index.rendersFrom.get(filePath) || []) {
    const to = callIndex.anchorByPath.get(link.to);
    if (to !== undefined && allowed(link.certainty)) visit(to, link);
  }
}

// What Calls follows from one function: its calls and requests, and, from a
// file's anchor, the components that file renders. A rendered component is
// reached whole, like an entry's own file.
function followSteps(index, callIndex, allowed) {
  return (from, reach) => {
    forEachEdge(callIndex, from, allowed, reach);
    forEachRender(index, callIndex, from, allowed, (to, link) => {
      reach(to);
      for (const position of callIndex.byPath.get(link.to)) reach(position);
    });
  };
}

function breadthFirst(starts, follow) {
  const depth = new Map();
  const queue = [];
  for (const start of starts) if (!depth.has(start)) { depth.set(start, 0); queue.push(start); }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    follow(current, (next) => {
      if (!depth.has(next)) { depth.set(next, depth.get(current) + 1); queue.push(next); }
    });
  }
  return depth;
}

function functionView(callIndex, position) {
  const fn = callIndex.functions[position];
  const file = callIndex.files[fn.file];
  return {
    id: fn.id,
    name: fn.name,
    kind: fn.kind,
    ...(fn.container ? { container: fn.container } : {}),
    file: file.path,
    subsystemId: file.subsystemId ?? null,
    start: fn.start,
    end: fn.end
  };
}

// ---------------------------------------------------------------- bounded output

function responseBytes(response) {
  return Buffer.byteLength(JSON.stringify(response));
}

// Removes nodes from the end (deepest first) until the response fits 1 MiB.
function fitResponse(response, nodesKey, edgeEnds) {
  while (responseBytes(response) > USAGE_QUERY_LIMITS.responseBytes) {
    response.truncated = true;
    const nodes = response[nodesKey];
    if (nodes?.length) {
      response[nodesKey] = nodes.slice(0, Math.floor(nodes.length / 2));
      const kept = new Set(response[nodesKey].map((node) => node.id));
      response.edges = (response.edges || []).filter((edge) => edgeEnds(edge).every((id) => kept.has(id)));
    } else if (response.unresolved?.length) {
      response.unresolved = response.unresolved.slice(0, Math.floor(response.unresolved.length / 2));
    } else {
      break;
    }
  }
  return response;
}

function sortedNodes(depth, label) {
  return [...depth.keys()].sort((left, right) => depth.get(left) - depth.get(right) || label(left, right));
}

// ---------------------------------------------------------------- queries

function clampInteger(value, fallback, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function readEntries(index, input = {}) {
  const kind = normalizeText(input.kind);
  if (kind && !USAGE_ENTRY_KINDS.includes(kind)) throw usageError(`Unknown entry kind: ${kind}.`, "vibe64_invalid_usage_entry_kind");
  const search = normalizeText(input.q).toLowerCase();
  if (search.length > USAGE_QUERY_LIMITS.searchLength) throw usageError("Search at most 80 characters.", "vibe64_invalid_usage_search");
  const limit = clampInteger(input.limit, USAGE_QUERY_LIMITS.entries, USAGE_QUERY_LIMITS.entriesMax);
  const cursor = normalizeText(input.cursor);
  if (cursor && !/^[0-9]{1,9}$/u.test(cursor)) throw usageError("The entry cursor is invalid.", "vibe64_invalid_usage_cursor");
  const offset = cursor ? Number(cursor) : 0;
  const matching = search ? index.entries.filter((entry) => entry.search.includes(search)) : index.entries;
  const counts = new Map();
  for (const entry of matching) counts.set(entry.kind, (counts.get(entry.kind) || 0) + 1);
  const selected = kind ? matching.filter((entry) => entry.kind === kind) : matching;
  const page = selected.slice(offset, offset + limit);
  return {
    kinds: USAGE_ENTRY_KINDS.filter((name) => counts.has(name)).map((name) => ({ kind: name, count: counts.get(name) })),
    entries: page.map(({ id, kind: entryKind, title, file, subsystemId, hasCalls }) => ({ id, kind: entryKind, title, file, subsystemId, hasCalls })),
    nextCursor: offset + limit < selected.length ? String(offset + limit) : null,
    limits: { limit, maxLimit: USAGE_QUERY_LIMITS.entriesMax, searchLength: USAGE_QUERY_LIMITS.searchLength },
    truncated: false
  };
}

function requireEntry(index, entryId) {
  const entry = index.entryById.get(normalizeText(entryId));
  if (!entry) throw usageError("This entry point is not in the current scan.", "vibe64_usage_entry_not_found", { entryId: normalizeText(entryId) });
  return entry;
}

function webLimits(input) {
  return { maxNodes: clampInteger(input.maxNodes, USAGE_QUERY_LIMITS.maxNodes, USAGE_QUERY_LIMITS.maxNodesMax), responseBytes: USAGE_QUERY_LIMITS.responseBytes, unresolved: USAGE_QUERY_LIMITS.unresolved };
}

function zoomSubsystem(index, input) {
  const subsystemId = normalizeText(input.subsystemId);
  if (subsystemId && !index.subsystemById.has(subsystemId)) throw usageError("This subsystem is not in the current scan.", "vibe64_usage_subsystem_not_found");
  return subsystemId;
}

function crossingList(crossings, fields) {
  return [...crossings.values()].sort((left, right) => byText(left.fromSubsystemId, right.fromSubsystemId) || byText(left.toSubsystemId, right.toSubsystemId))
    .map((crossing) => ({ fromSubsystemId: crossing.fromSubsystemId, toSubsystemId: crossing.toSubsystemId, ...Object.fromEntries(fields.map((field) => [field, crossing[field]])) }));
}

function readImportsWeb(index, entry, input) {
  const limits = webLimits(input);
  const subsystemId = zoomSubsystem(index, input);
  const startFile = index.fileByPath.get(entry.file);
  const depth = breadthFirst(startFile ? [startFile.id] : [], (fileId, reach) => {
    for (const target of index.imports.get(fileId) || []) reach(target);
  });
  const owner = (fileId) => index.files.get(fileId)?.subsystemId ?? null;
  const reachedBySubsystem = new Map();
  const crossings = new Map();
  let unresolvedImports = 0;
  for (const fileId of depth.keys()) {
    const ownerId = owner(fileId);
    reachedBySubsystem.set(ownerId, (reachedBySubsystem.get(ownerId) || 0) + 1);
    unresolvedImports += index.unresolvedImports.get(fileId) || 0;
    for (const target of index.imports.get(fileId) || []) {
      const targetOwner = owner(target);
      if (ownerId === targetOwner || !ownerId || !targetOwner) continue;
      const key = `${ownerId}\n${targetOwner}`;
      if (!crossings.has(key)) crossings.set(key, { fromSubsystemId: ownerId, toSubsystemId: targetOwner, count: 0 });
      crossings.get(key).count += 1;
    }
  }
  const response = {
    entry: entryView(entry),
    mode: "imports",
    groups: index.groups,
    subsystems: index.subsystems.map((item) => ({ id: item.id, title: item.title, group: item.group, fileCount: reachedBySubsystem.get(item.id) || 0, reached: reachedBySubsystem.has(item.id) })),
    crossings: crossingList(crossings, ["count"]),
    unresolvedImports,
    limits,
    truncated: false
  };
  const scope = sortedNodes(depth, (left, right) => byText(index.files.get(left).path, index.files.get(right).path))
    .filter((fileId) => !subsystemId || owner(fileId) === subsystemId);
  if (subsystemId || depth.size <= limits.maxNodes) {
    const kept = scope.slice(0, limits.maxNodes);
    response.truncated = kept.length < scope.length;
    const keptSet = new Set(kept);
    response.files = kept.map((fileId) => ({ id: fileId, path: index.files.get(fileId).path, subsystemId: owner(fileId), depth: depth.get(fileId) }));
    response.edges = kept.flatMap((fileId) => [...new Set(index.imports.get(fileId) || [])].filter((target) => keptSet.has(target)).map((target) => ({ from: fileId, to: target })));
  }
  return fitResponse(response, "files", (edge) => [edge.from, edge.to]);
}

function entryView(entry) {
  return { id: entry.id, kind: entry.kind, title: entry.title, file: entry.file, subsystemId: entry.subsystemId, hasCalls: entry.hasCalls };
}

function entryStarts(callIndex, entry) {
  const known = entry.functionIds.map((id) => callIndex.ids.get(id)).filter((position) => position !== undefined);
  // Pages, components and entries without resolved functions start from
  // every function of their file, including the file's top-level code.
  return known.length ? known : [...(callIndex.byPath.get(entry.file) || [])];
}

function readCallsWeb(index, callIndex, entry, input) {
  const limits = webLimits(input);
  const subsystemId = zoomSubsystem(index, input);
  const certainty = normalizeText(input.certainty) || "all";
  if (!["all", "exact"].includes(certainty)) throw usageError("Certainty must be all or exact.", "vibe64_invalid_usage_certainty");
  const response = {
    entry: entryView(entry),
    mode: "calls",
    certainty,
    groups: index.groups,
    subsystems: [],
    crossings: [],
    unresolved: [],
    unresolvedTotal: 0,
    limits,
    truncated: false
  };
  if (!callIndex) {
    response.subsystems = index.subsystems.map((item) => ({ id: item.id, title: item.title, group: item.group, functionCount: 0, exact: 0, probable: 0 }));
    return response;
  }
  const allowed = certainty === "exact" ? (value) => value === "exact" : (value) => value === "exact" || value === "probable";
  const starts = entryStarts(callIndex, entry);
  const depth = breadthFirst(starts, followSteps(index, callIndex, allowed));
  const exactReach = certainty === "exact" ? depth : breadthFirst(starts, followSteps(index, callIndex, (value) => value === "exact"));
  const owner = (position) => callIndex.files[callIndex.functions[position].file].subsystemId ?? null;
  const edges = new Map();
  const outCount = new Map();
  const inCount = new Map();
  const counts = new Map();
  const crossings = new Map();
  const unresolved = [];
  const crossingOf = (fromOwner, toOwner) => {
    if (!fromOwner || !toOwner || fromOwner === toOwner) return null;
    const key = `${fromOwner}\n${toOwner}`;
    if (!crossings.has(key)) crossings.set(key, { fromSubsystemId: fromOwner, toSubsystemId: toOwner, exact: 0, probable: 0, renders: 0 });
    return crossings.get(key);
  };
  const countStep = (from, to) => {
    outCount.set(from, (outCount.get(from) || 0) + 1);
    inCount.set(to, (inCount.get(to) || 0) + 1);
  };
  for (const from of depth.keys()) {
    const fromOwner = owner(from);
    const bucket = counts.get(fromOwner) || { functionCount: 0, exact: 0 };
    bucket.functionCount += 1;
    if (exactReach.has(from)) bucket.exact += 1;
    counts.set(fromOwner, bucket);
    forEachEdge(callIndex, from, allowed, (to, edgeCertainty, method) => {
      const key = `${from}>${to}`;
      const existing = edges.get(key);
      if (existing && (existing.certainty === "exact" || edgeCertainty !== "exact")) return;
      if (!existing) {
        countStep(from, to);
        const crossing = crossingOf(fromOwner, owner(to));
        if (crossing) crossing[edgeCertainty] += 1;
      } else {
        // An exact call replaces a probable one between the same functions.
        const crossing = crossings.get(`${fromOwner}\n${owner(to)}`);
        if (crossing) { crossing.probable -= 1; crossing.exact += 1; }
      }
      edges.set(key, { from, to, certainty: edgeCertainty, method });
    });
    // Renders are counted apart from calls: they are links between files.
    forEachRender(index, callIndex, from, allowed, (to, link) => {
      countStep(from, to);
      const crossing = crossingOf(fromOwner, owner(to));
      if (crossing) crossing.renders += 1;
      edges.set(`${from}>${to}>renders`, { from, to, certainty: link.certainty, method: "renders" });
    });
    if (!subsystemId || fromOwner === subsystemId) {
      for (const position of callIndex.outCalls[from]) {
        const call = callIndex.calls[position];
        if (call.certainty === "unresolved") unresolved.push({ from, callee: call.callee, start: call.site.start });
      }
    }
  }
  response.subsystems = index.subsystems.map((item) => {
    const bucket = counts.get(item.id) || { functionCount: 0, exact: 0 };
    return { id: item.id, title: item.title, group: item.group, functionCount: bucket.functionCount, exact: bucket.exact, probable: bucket.functionCount - bucket.exact };
  });
  response.crossings = crossingList(crossings, ["exact", "probable", "renders"]);
  unresolved.sort((left, right) => depth.get(left.from) - depth.get(right.from) || left.from - right.from || pointBefore(left.start, right.start));
  response.unresolvedTotal = unresolved.length;
  response.unresolved = unresolved.slice(0, USAGE_QUERY_LIMITS.unresolved)
    .map((item) => ({ fromFunctionId: callIndex.functions[item.from].id, callee: item.callee, start: item.start }));
  const label = (position) => callIndex.functions[position];
  const scope = sortedNodes(depth, (left, right) => byText(label(left).name, label(right).name) || left - right)
    .filter((position) => !subsystemId || owner(position) === subsystemId);
  if (subsystemId || depth.size <= limits.maxNodes) {
    const kept = scope.slice(0, limits.maxNodes);
    response.truncated = kept.length < scope.length;
    const keptSet = new Set(kept);
    response.functions = kept.map((position) => ({
      ...functionView(callIndex, position),
      depth: depth.get(position),
      reach: exactReach.has(position) ? "exact" : "probable",
      callCount: outCount.get(position) || 0,
      calledByCount: inCount.get(position) || 0
    }));
    response.edges = [...edges.values()].filter((edge) => keptSet.has(edge.from) && keptSet.has(edge.to))
      .map((edge) => ({ from: callIndex.functions[edge.from].id, to: callIndex.functions[edge.to].id, certainty: edge.certainty, method: edge.method }));
  }
  return fitResponse(response, "functions", (edge) => [edge.from, edge.to]);
}

function readFunction(index, callIndex, input) {
  const functionId = normalizeText(input.functionId);
  const position = callIndex?.ids.get(functionId);
  if (position === undefined) throw usageError("This function is not in the current call web.", "vibe64_usage_function_not_found", { functionId });
  const limit = USAGE_QUERY_LIMITS.functionList;
  const calls = [];
  const unresolved = [];
  for (const callPosition of callIndex.outCalls[position]) {
    const call = callIndex.calls[callPosition];
    if (call.certainty === "unresolved") unresolved.push({ callee: call.callee, start: call.site.start });
    else for (const target of call.targets) calls.push({ target: functionView(callIndex, target), certainty: call.certainty, method: call.method, callee: call.callee, start: call.site.start });
  }
  for (const bridgePosition of callIndex.outBridges[position]) {
    const bridge = callIndex.bridges[bridgePosition];
    calls.push({ target: functionView(callIndex, bridge.to), certainty: bridge.certainty, method: "operation", callee: bridgeCallee(bridge), start: null });
  }
  const calledBy = [];
  for (const callPosition of callIndex.inCalls[position]) {
    const call = callIndex.calls[callPosition];
    calledBy.push({ source: functionView(callIndex, call.from), certainty: call.certainty, method: call.method, callee: call.callee, start: call.site.start });
  }
  for (const bridgePosition of callIndex.inBridges[position]) {
    const bridge = callIndex.bridges[bridgePosition];
    calledBy.push({ source: functionView(callIndex, bridge.from), certainty: bridge.certainty, method: "operation", callee: bridgeCallee(bridge), start: null });
  }
  // A file's anchor also lists the components it renders and the files that
  // render it; `start` is the tag in the rendering file.
  const filePath = callIndex.files[callIndex.functions[position].file].path;
  if (callIndex.anchorByPath.get(filePath) === position) {
    const step = (link) => ({ certainty: link.certainty, method: "renders", callee: `<${link.title}>`, start: link.start });
    for (const link of index.rendersFrom.get(filePath) || []) {
      const to = callIndex.anchorByPath.get(link.to);
      if (to !== undefined) calls.push({ target: functionView(callIndex, to), ...step(link) });
    }
    for (const link of index.rendersInto.get(filePath) || []) {
      const from = callIndex.anchorByPath.get(link.from);
      if (from !== undefined) calledBy.push({ source: functionView(callIndex, from), ...step(link) });
    }
  }
  const certaintyOrder = (row) => (row.certainty === "exact" ? 0 : 1);
  const atSite = (left, right) => certaintyOrder(left) - certaintyOrder(right) || (left.start && right.start ? pointBefore(left.start, right.start) : left.start ? -1 : right.start ? 1 : 0);
  calls.sort(atSite);
  calledBy.sort(atSite);
  unresolved.sort((left, right) => pointBefore(left.start, right.start));
  const file = callIndex.files[callIndex.functions[position].file];
  const fn = callIndex.functions[position];
  return {
    function: { ...functionView(callIndex, position), ...(fn.exported ? { exported: true } : {}), coverage: file.coverage },
    calls: calls.slice(0, limit),
    calledBy: calledBy.slice(0, limit),
    unresolved: unresolved.slice(0, limit),
    totals: { calls: calls.length, calledBy: calledBy.length, unresolved: unresolved.length },
    limits: { list: limit },
    truncated: [calls, calledBy, unresolved].some((list) => list.length > limit)
  };
}

function joinFunctions(index, callIndex, input) {
  const candidates = Array.isArray(input.functions) ? input.functions : [];
  if (candidates.length > USAGE_QUERY_LIMITS.joinFunctions) {
    throw usageError("Join at most 1,500 functions at a time.", "vibe64_invalid_usage_join_size");
  }
  const joined = candidates.map((candidate, position) => {
    const filePath = String(candidate.path || "");
    const file = callIndex?.fileByPath.get(filePath);
    if (!file) {
      const indexed = index.fileByPath.get(filePath);
      // Without a call web, the Machine City's hash still says whether the
      // recording ran the scanned version of the file.
      const changed = indexed && indexed.hash !== candidate.hash;
      return { index: position, functionId: null, subsystemId: subsystemForPath(index, filePath), join: changed ? "stale" : "none" };
    }
    if (file.hash !== candidate.hash) return { index: position, functionId: null, subsystemId: file.subsystemId ?? null, join: "stale" };
    const inFile = callIndex.byPath.get(filePath) || [];
    const start = candidate.start || {};
    const atStart = inFile.filter((fnPosition) => {
      const fn = callIndex.functions[fnPosition];
      return fn.start.line === start.line && fn.start.column === start.column;
    });
    // A file's top-level code and a function opening the file share 1:1;
    // the recorded name picks the function, any other name the top level.
    const exact = atStart.length > 1
      ? atStart.find((fnPosition) => callIndex.functions[fnPosition].name === (candidate.name || ""))
        ?? atStart.find((fnPosition) => callIndex.functions[fnPosition].kind === "module")
      : atStart[0];
    if (exact !== undefined) return { index: position, functionId: callIndex.functions[exact].id, subsystemId: file.subsystemId ?? null, join: "exact", position: exact };
    const near = candidate.name ? inFile.filter((fnPosition) => {
      const fn = callIndex.functions[fnPosition];
      return fn.name === candidate.name && Math.abs(fn.start.line - start.line) <= NEAR_LINES;
    }) : [];
    if (near.length === 1) return { index: position, functionId: callIndex.functions[near[0]].id, subsystemId: file.subsystemId ?? null, join: "name-line", position: near[0] };
    return { index: position, functionId: null, subsystemId: file.subsystemId ?? null, join: "none" };
  });
  const byFunction = new Map();
  for (const item of joined) if (item.position !== undefined && !byFunction.has(item.position)) byFunction.set(item.position, item.index);
  const edges = new Map();
  for (const [from, fromIndex] of byFunction) {
    forEachEdge(callIndex, from, (value) => value === "exact" || value === "probable", (to, certainty) => {
      const toIndex = byFunction.get(to);
      if (toIndex === undefined) return;
      const key = `${fromIndex}>${toIndex}`;
      if (edges.get(key)?.certainty !== "exact") edges.set(key, { from: fromIndex, to: toIndex, certainty });
    });
  }
  const subsystemIds = [...new Set(joined.map((item) => item.subsystemId).filter(Boolean))].sort(byText);
  return {
    joined: joined.map(({ index: position, functionId, subsystemId, join }) => ({ index: position, functionId, subsystemId, join })),
    edges: [...edges.values()].sort((left, right) => left.from - right.from || left.to - right.to),
    groups: index.groups,
    subsystems: subsystemIds.map((id) => {
      const owner = index.subsystemById.get(id);
      return { id, title: owner?.title || id, group: owner?.group ?? null };
    }),
    limits: { functions: USAGE_QUERY_LIMITS.joinFunctions },
    truncated: false
  };
}

// ---------------------------------------------------------------- cache

// One parsed call web per session source, at most two sessions, released after
// ten idle minutes and replaced when the Machine City names another identity.
function createCallWebCache({ sessions = CALL_WEB_CACHE_SESSIONS, idleMs = CALL_WEB_CACHE_IDLE_MS, now = Date.now } = {}) {
  const entries = new Map();
  let timer = null;

  function sweep() {
    const current = now();
    for (const [key, entry] of entries) if (current - entry.usedAt >= idleMs) entries.delete(key);
    clearTimeout(timer);
    timer = null;
    if (entries.size) {
      const next = Math.min(...[...entries.values()].map((entry) => entry.usedAt + idleMs)) - current;
      timer = setTimeout(sweep, Math.max(1000, next));
      timer.unref?.();
    }
  }

  function read(key, identity, load) {
    sweep();
    const existing = entries.get(key);
    entries.delete(key);
    if (existing?.identity === identity) {
      existing.usedAt = now();
      entries.set(key, existing);
      return existing.promise;
    }
    const entry = { identity, usedAt: now(), promise: Promise.resolve().then(load) };
    entries.set(key, entry);
    while (entries.size > sessions) entries.delete(entries.keys().next().value);
    entry.promise.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
    sweep();
    return entry.promise;
  }

  return Object.freeze({
    read,
    sweep,
    get size() { return entries.size; },
    clear() { entries.clear(); clearTimeout(timer); timer = null; }
  });
}

// ---------------------------------------------------------------- service

function createUsageService({
  projectService,
  cityReader = readGenesisCity,
  callWebReader = readGenesisCallWeb,
  layoutReader = inspectVibe64ArchitectureLayout,
  callWebCache = createCallWebCache()
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createUsageService requires the Vibe64 Project API.");
  }
  const snapshotIndexes = new WeakMap();

  async function sessionSource(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) throw usageError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    const runtime = await projectService.createRuntime({ sessionId: normalizedSessionId });
    const session = await runtime.getSession(normalizedSessionId);
    const sourceRoot = sessionSourcePath(session);
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      throw usageError("Create the active session source before opening Architecture.", "vibe64_system_source_unavailable", { sessionId: normalizedSessionId });
    }
    return sourceRoot;
  }

  async function snapshot(sourceRoot) {
    const record = await cityReader(sourceRoot, "machine");
    const machine = requireGenesisCity(record, "machine");
    if (!snapshotIndexes.has(machine)) {
      snapshotIndexes.set(machine, (async () => {
        let layout = null;
        // Groups only arrange cards; an invalid layout leaves them alphabetical.
        try { layout = await layoutReader({ projectRoot: sourceRoot }); } catch { layout = null; }
        return buildSnapshotIndex(record, layout);
      })());
      snapshotIndexes.get(machine).catch(() => snapshotIndexes.delete(machine));
    }
    return snapshotIndexes.get(machine);
  }

  async function callIndexFor(sourceRoot, index) {
    const identity = index.snapshot.callWebIdentity;
    if (!identity) return null;
    return callWebCache.read(sourceRoot, identity, async () => {
      const document = await callWebReader(sourceRoot, index.architecture);
      return document ? buildCallIndex(document) : null;
    });
  }

  function query(operation) {
    return (input = {}) => vibe64Result(async () => {
      const sourceRoot = await sessionSource(input.sessionId);
      const index = await snapshot(sourceRoot);
      const result = await operation(index, input, () => callIndexFor(sourceRoot, index));
      return { ok: true, snapshot: index.snapshot, ...result };
    }, { fallbackCode: "vibe64_usage_query_failed", fallbackMessage: "The usage map could not be read." });
  }

  return Object.freeze({
    readUsageEntries: query((index, input) => readEntries(index, input)),
    readUsageWeb: query(async (index, input, calls) => {
      const entry = requireEntry(index, input.entryId);
      const mode = normalizeText(input.mode) || "imports";
      if (mode === "imports") return readImportsWeb(index, entry, input);
      if (mode === "calls") return readCallsWeb(index, await calls(), entry, input);
      throw usageError("Mode must be imports or calls.", "vibe64_invalid_usage_mode");
    }),
    readUsageFunction: query(async (index, input, calls) => readFunction(index, await calls(), input)),
    joinUsage: query(async (index, input, calls) => joinFunctions(index, await calls(), input))
  });
}

export {
  USAGE_ENTRY_KINDS,
  USAGE_QUERY_LIMITS,
  buildCallIndex,
  buildSnapshotIndex,
  createCallWebCache,
  createUsageService,
  joinFunctions,
  readCallsWeb,
  readEntries,
  readFunction,
  readImportsWeb
};
