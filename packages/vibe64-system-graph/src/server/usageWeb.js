import { toText } from "@jskit-ai/kernel/shared/support/normalize";

import {
  USAGE_ENTRY_KINDS,
  breadthFirst,
  bridgeCallee,
  byText,
  forEachEdge,
  forEachRender,
  followSteps,
  functionView,
  subsystemForPath,
  usageError
} from "./usageIndex.js";

// Usage queries start from one Genesis entry point and return only what it
// reaches: files through Imports, functions through Calls. Every response is
// bounded; nothing here returns the project's whole import or call graph.
const USAGE_QUERY_LIMITS = Object.freeze({
  entries: 50,
  entriesMax: 200,
  searchLength: 80,
  maxNodes: 300,
  maxNodesMax: 1000,
  responseBytes: 1024 * 1024,
  unresolved: 50,
  functionList: 200,
  joinFunctions: 1500,
  routeRequests: 200
});
const CALL_WEB_CACHE_SESSIONS = 2;
const NEAR_LINES = 3;

const pointBefore = (left, right) => left.line - right.line || left.column - right.column;

// ---------------------------------------------------------------- bounded output

function responseBytes(response) {
  return Buffer.byteLength(JSON.stringify(response));
}

/**
 * Removes nodes from the end (deepest first) until the response fits 1 MiB.
 */
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
  const kind = toText(input.kind);
  if (kind && !USAGE_ENTRY_KINDS.includes(kind)) throw usageError(`Unknown entry kind: ${kind}.`, "vibe64_invalid_usage_entry_kind");
  const search = toText(input.q).toLowerCase();
  if (search.length > USAGE_QUERY_LIMITS.searchLength) throw usageError("Search at most 80 characters.", "vibe64_invalid_usage_search");
  const limit = clampInteger(input.limit, USAGE_QUERY_LIMITS.entries, USAGE_QUERY_LIMITS.entriesMax);
  const cursor = toText(input.cursor);
  if (cursor && !/^[0-9]{1,9}$/u.test(cursor)) throw usageError("The entry cursor is invalid.", "vibe64_invalid_usage_cursor");
  const offset = cursor ? Number(cursor) : 0;
  // `file` names exactly one source file: Click in Preview finds a picked
  // component's entries this way, whatever its path's substring also matches.
  const file = toText(input.file);
  const matching = search || file
    ? index.entries.filter((entry) => (!file || entry.file === file) && (!search || entry.search.includes(search)))
    : index.entries;
  const counts = new Map();
  for (const entry of matching) counts.set(entry.kind, (counts.get(entry.kind) || 0) + 1);
  const selected = kind ? matching.filter((entry) => entry.kind === kind) : matching;
  const page = selected.slice(offset, offset + limit);
  return {
    kinds: USAGE_ENTRY_KINDS.filter((name) => counts.has(name)).map((name) => ({ kind: name, count: counts.get(name) })),
    entries: page.map(({
      id,
      kind: entryKind,
      title,
      file,
      subsystemId,
      hasCalls
    }) => ({
      id,
      kind: entryKind,
      title,
      file,
      subsystemId,
      hasCalls
    })),
    nextCursor: offset + limit < selected.length ? String(offset + limit) : null,
    limits: { limit, maxLimit: USAGE_QUERY_LIMITS.entriesMax, searchLength: USAGE_QUERY_LIMITS.searchLength },
    truncated: false
  };
}

function requireEntry(index, entryId) {
  const entry = index.entryById.get(toText(entryId));
  if (!entry) {
    throw usageError("This entry point is not in the current scan.", "vibe64_usage_entry_not_found", { entryId: toText(entryId) });
  }
  return entry;
}

function webLimits(input) {
  return {
    maxNodes: clampInteger(input.maxNodes, USAGE_QUERY_LIMITS.maxNodes, USAGE_QUERY_LIMITS.maxNodesMax),
    responseBytes: USAGE_QUERY_LIMITS.responseBytes,
    unresolved: USAGE_QUERY_LIMITS.unresolved
  };
}

function zoomSubsystem(index, input) {
  const subsystemId = toText(input.subsystemId);
  if (subsystemId && !index.subsystemById.has(subsystemId)) {
    throw usageError("This subsystem is not in the current scan.", "vibe64_usage_subsystem_not_found");
  }
  return subsystemId;
}

function crossingList(crossings, fields) {
  return [...crossings.values()].sort((
    left,
    right
  ) => byText(left.fromSubsystemId, right.fromSubsystemId) || byText(left.toSubsystemId, right.toSubsystemId))
    .map((crossing) => ({
      fromSubsystemId: crossing.fromSubsystemId,
      toSubsystemId: crossing.toSubsystemId,
      ...Object.fromEntries(fields.map((field) => [field, crossing[field]]))
    }));
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
    subsystems: index.subsystems.map((item) => ({
      id: item.id,
      title: item.title,
      group: item.group,
      fileCount: reachedBySubsystem.get(item.id) || 0,
      reached: reachedBySubsystem.has(item.id)
    })),
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
    response.files = kept.map((fileId) => ({
      id: fileId,
      path: index.files.get(fileId).path,
      subsystemId: owner(fileId),
      depth: depth.get(fileId)
    }));
    response.edges = kept.flatMap((fileId) => [...new Set(
      index.imports.get(fileId) || []
    )].filter((target) => keptSet.has(target)).map((target) => ({
      from: fileId,
      to: target
    })));
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
  const certainty = toText(input.certainty) || "all";
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
    response.subsystems = index.subsystems.map((item) => ({
      id: item.id,
      title: item.title,
      group: item.group,
      functionCount: 0,
      exact: 0,
      probable: 0
    }));
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
        if (crossing) {
          crossing.probable -= 1;
          crossing.exact += 1;
        }
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
    return {
      id: item.id,
      title: item.title,
      group: item.group,
      functionCount: bucket.functionCount,
      exact: bucket.exact,
      probable: bucket.functionCount - bucket.exact
    };
  });
  response.crossings = crossingList(crossings, ["exact", "probable", "renders"]);
  unresolved.sort((
    left,
    right
  ) => depth.get(left.from) - depth.get(right.from) || left.from - right.from || pointBefore(left.start, right.start));
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
      .map((edge) => ({
        from: callIndex.functions[edge.from].id,
        to: callIndex.functions[edge.to].id,
        certainty: edge.certainty,
        method: edge.method
      }));
  }
  return fitResponse(response, "functions", (edge) => [edge.from, edge.to]);
}

function readFunction(index, callIndex, input) {
  const functionId = toText(input.functionId);
  const position = callIndex?.ids.get(functionId);
  if (position === undefined) {
    throw usageError("This function is not in the current call web.", "vibe64_usage_function_not_found", { functionId });
  }
  const limit = USAGE_QUERY_LIMITS.functionList;
  const calls = [];
  const unresolved = [];
  for (const callPosition of callIndex.outCalls[position]) {
    const call = callIndex.calls[callPosition];
    if (call.certainty === "unresolved") {
      unresolved.push({ callee: call.callee, start: call.site.start });
    } else {
      for (const target of call.targets) {
        calls.push({
          target: functionView(callIndex, target),
          certainty: call.certainty,
          method: call.method,
          callee: call.callee,
          start: call.site.start
        });
      }
    }
  }
  for (const bridgePosition of callIndex.outBridges[position]) {
    const bridge = callIndex.bridges[bridgePosition];
    calls.push({
      target: functionView(callIndex, bridge.to),
      certainty: bridge.certainty,
      method: "operation",
      callee: bridgeCallee(bridge),
      start: null
    });
  }
  const calledBy = [];
  for (const callPosition of callIndex.inCalls[position]) {
    const call = callIndex.calls[callPosition];
    calledBy.push({
      source: functionView(callIndex, call.from),
      certainty: call.certainty,
      method: call.method,
      callee: call.callee,
      start: call.site.start
    });
  }
  for (const bridgePosition of callIndex.inBridges[position]) {
    const bridge = callIndex.bridges[bridgePosition];
    calledBy.push({
      source: functionView(callIndex, bridge.from),
      certainty: bridge.certainty,
      method: "operation",
      callee: bridgeCallee(bridge),
      start: null
    });
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
  const atSite = (
    left,
    right
  ) => certaintyOrder(left) - certaintyOrder(right) ||
    (left.start && right.start ? pointBefore(left.start, right.start) : left.start ? -1 : right.start ? 1 : 0);
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
  // Why a function is not in the scan's calls, when known: the scan could not
  // read calls, or its file's language is not one the scan reads calls for.
  const noCalls = callIndex ? null : index.snapshot.callWebProblem;
  const joined = candidates.map((candidate, position) => {
    const filePath = String(candidate.path || "");
    const file = callIndex?.fileByPath.get(filePath);
    if (!file) {
      const indexed = index.fileByPath.get(filePath);
      // Without a call web, the Machine City's hash still says whether the
      // recording ran the scanned version of the file.
      const changed = indexed && indexed.hash !== candidate.hash;
      return {
        index: position,
        functionId: null,
        subsystemId: subsystemForPath(index, filePath),
        join: changed ? "stale" : "none",
        ...(!changed && noCalls ? { reason: noCalls } : {})
      };
    }
    if (file.hash !== candidate.hash) return { index: position, functionId: null, subsystemId: file.subsystemId ?? null, join: "stale" };
    if (file.coverage === "none") {
      return {
        index: position,
        functionId: null,
        subsystemId: file.subsystemId ?? null,
        join: "none",
        reason: "language"
      };
    }
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
    if (exact !== undefined) {
      return {
        index: position,
        functionId: callIndex.functions[exact].id,
        subsystemId: file.subsystemId ?? null,
        join: "exact",
        position: exact
      };
    }
    const near = candidate.name ? inFile.filter((fnPosition) => {
      const fn = callIndex.functions[fnPosition];
      return fn.name === candidate.name && Math.abs(fn.start.line - start.line) <= NEAR_LINES;
    }) : [];
    if (near.length === 1) {
      return {
        index: position,
        functionId: callIndex.functions[near[0]].id,
        subsystemId: file.subsystemId ?? null,
        join: "name-line",
        position: near[0]
      };
    }
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
    joined: joined.map(({
      index: position,
      functionId,
      subsystemId,
      join,
      reason
    }) => ({
      index: position,
      functionId,
      subsystemId,
      join,
      ...(reason ? { reason } : {})
    })),
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

// ---------------------------------------------------------------- route templates

// The snapshot's route entries by method and segment count, in entry order,
// built once per snapshot index.
const routeTables = new WeakMap();

function routeTable(index) {
  if (!routeTables.has(index)) {
    const table = new Map();
    for (const entry of index.entries) {
      if (entry.kind !== "route") continue;
      const [method, template] = String(entry.title || "").split(" ");
      if (!template) continue;
      const parts = template.split("/");
      const key = `${method.toUpperCase()} ${parts.length}`;
      if (!table.has(key)) table.set(key, []);
      table.get(key).push({ parts, template: entry.title.split(" ").slice(1).join(" ") });
    }
    routeTables.set(index, table);
  }
  return routeTables.get(index);
}

/**
 * Each recorded request's route template, in the order asked: the first route
 * entry whose template matches its method and path, where `:name` and `*`
 * stand for one segment; "" when no route matches. Every route in the scan is
 * considered, however many there are.
 */
function matchRoutes(index, input = {}) {
  const requests = Array.isArray(input.requests) ? input.requests : [];
  if (requests.length > USAGE_QUERY_LIMITS.routeRequests) {
    throw usageError("Match at most 200 requests at a time.", "vibe64_invalid_usage_route_size");
  }
  const table = routeTable(index);
  const templates = requests.map(({ method, path }) => {
    const parts = String(path || "").split("/");
    const candidates = table.get(`${String(method || "").toUpperCase()} ${parts.length}`) || [];
    const match = candidates.find((route) => route.parts.every((part, position) => (
      part === parts[position] || part.startsWith(":") || part === "*"
    )));
    return match ? match.template : "";
  });
  return { templates, limits: { requests: USAGE_QUERY_LIMITS.routeRequests } };
}

const __testables = Object.freeze({ USAGE_QUERY_LIMITS });

export {
  CALL_WEB_CACHE_SESSIONS,
  joinFunctions,
  matchRoutes,
  readCallsWeb,
  readEntries,
  readFunction,
  readImportsWeb,
  requireEntry,
  __testables
};
