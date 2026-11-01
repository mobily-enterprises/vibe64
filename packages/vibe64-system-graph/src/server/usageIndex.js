import { vibe64Error } from "@local/vibe64-core/server/core";

import { requireGenesisCity } from "./genesisCities.js";

// The indexes usage queries read: one per Genesis snapshot (entry points, files, subsystems and UI renders) and one
// per parsed call web (functions and their call edges).
const USAGE_ENTRY_KINDS = Object.freeze([
  "page", "component", "route", "action", "library-export", "cli-command", "job", "program-operation", "test"
]);

function usageError(message, code, details) {
  const error = vibe64Error(message, code);
  if (details) error.details = details;
  return error;
}

const byText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

// ---------------------------------------------------------------- snapshot

function layoutGroups(layout) {
  return (layout?.groups || []).map((group) => ({
    id: group.id,
    title: group.title,
    kind: group.kind,
    roots: group.subsystems.map((member) => member.root)
  }));
}

/**
 * Machine City links each page or component to the components its template
 * renders. Calls follows them as "renders" steps between files, keeping the
 * link's certainty: a tag resolved through its import is exact.
 */
function renderLinks(ui) {
  const fileOf = new Map(
    [...(ui?.pages || []), ...(ui?.components || [])].filter((record) => record.file).map((record) => [record.id, record.file])
  );
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

/**
 * One index per validated Machine City object. City reads share that object
 * while its file is unchanged, so this is built once per snapshot.
 */
function buildSnapshotIndex(record, layout) {
  const machine = requireGenesisCity(record, "machine");
  const architecture = machine.architecture;
  if (!architecture) throw usageError("This scan has no architecture. Refresh analysis.", "vibe64_genesis_city_missing");
  const groups = layoutGroups(layout);
  const groupByRoot = new Map(groups.flatMap((group) => group.roots.map((root) => [root, group.id])));
  const subsystems = (architecture.subsystems || []).map((owner) => ({
    id: owner.id,
    title: owner.title || owner.root || owner.id,
    root: owner.root || "",
    group: groupByRoot.get(owner.root) ?? null
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
  const entries = (architecture.entryPoints || [])
    .filter((entry) => order.has(entry.kind))
    .map((entry) => {
      const functionIds = Array.isArray(entry.functionIds) ? entry.functionIds : [];
      return {
        id: entry.id,
        kind: entry.kind,
        title: entry.title || entry.file,
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
      // Why a scan has no calls, when Genesis said: Git does not ignore the call web.
      callWebProblem: !callWeb && (architecture.diagnostics || []).some((item) => item.code === "CALL_WEB_NOT_IGNORED")
        ? "not-ignored"
        : null,
      builtAt: record.builtAt || null,
      // The System Graph's own out-of-date signal: Genesis re-indexed source
      // without the inspectors, so observations and calls need a re-scan.
      stale: (architecture.diagnostics || []).some((item) => item.code === "ARCHITECTURE_UI_STALE")
    }
  };
}

/**
 * Longest declared root owning a path that the snapshot never indexed.
 */
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

/**
 * Every edge leaving a function that the traversal may follow. Probable calls
 * with several candidates contribute one edge per candidate.
 */
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

/**
 * Render steps leaving a file's anchor: to each rendered component's anchor.
 */
function forEachRender(index, callIndex, from, allowed, visit) {
  const filePath = callIndex.files[callIndex.functions[from].file].path;
  if (callIndex.anchorByPath.get(filePath) !== from) return;
  for (const link of index.rendersFrom.get(filePath) || []) {
    const to = callIndex.anchorByPath.get(link.to);
    if (to !== undefined && allowed(link.certainty)) visit(to, link);
  }
}

/**
 * What Calls follows from one function: its calls and requests, and, from a
 * file's anchor, the components that file renders. A rendered component is
 * reached whole, like an entry's own file.
 */
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
  for (const start of starts) if (!depth.has(start)) {
    depth.set(start, 0);
    queue.push(start);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    follow(current, (next) => {
      if (!depth.has(next)) {
        depth.set(next, depth.get(current) + 1);
        queue.push(next);
      }
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

export {
  USAGE_ENTRY_KINDS,
  breadthFirst,
  bridgeCallee,
  buildCallIndex,
  buildSnapshotIndex,
  byText,
  forEachEdge,
  forEachRender,
  followSteps,
  functionView,
  subsystemForPath,
  usageError
};
