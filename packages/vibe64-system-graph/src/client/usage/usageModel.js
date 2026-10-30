import {
  mdiApi,
  mdiBookOpenPageVariantOutline,
  mdiClockOutline,
  mdiConsoleLine,
  mdiFileDocumentOutline,
  mdiFlaskOutline,
  mdiLightningBoltOutline,
  mdiPackageVariantClosed,
  mdiPuzzleOutline
} from "@mdi/js";

// The usage view's presentation model. It shapes server answers for display
// and never derives facts the server did not return.
const USAGE_ENTRY_KINDS = Object.freeze([
  { kind: "page", label: "Page", plural: "Pages", icon: mdiFileDocumentOutline },
  { kind: "component", label: "Component", plural: "Components", icon: mdiPuzzleOutline },
  { kind: "route", label: "Route", plural: "Routes", icon: mdiApi },
  { kind: "action", label: "Action", plural: "Actions", icon: mdiLightningBoltOutline },
  { kind: "library-export", label: "Library export", plural: "Library exports", icon: mdiPackageVariantClosed },
  { kind: "cli-command", label: "Command", plural: "Commands", icon: mdiConsoleLine },
  { kind: "job", label: "Job", plural: "Jobs", icon: mdiClockOutline },
  { kind: "program-operation", label: "Program operation", plural: "Program operations", icon: mdiBookOpenPageVariantOutline },
  { kind: "test", label: "Test file", plural: "Test files", icon: mdiFlaskOutline }
].map(Object.freeze));
const USAGE_MODES = Object.freeze([
  Object.freeze({ value: "imports", title: "Imports" }),
  Object.freeze({ value: "calls", title: "Calls" }),
  Object.freeze({ value: "recording", title: "Recording" })
]);
const USAGE_QUERY_KEYS = Object.freeze(["view", "entry", "mode", "subsystem", "recording", "request"]);
const MAX_NODES = 300;
const MORE_NODES = 1000;

function entryKind(kind) {
  return USAGE_ENTRY_KINDS.find((item) => item.kind === kind) || { kind, label: kind, plural: kind, icon: mdiFileDocumentOutline };
}

const text = (value) => (typeof value === "string" ? value.trim() : Array.isArray(value) ? text(value[0]) : "");

// The address keeps the usage state; Map is the default and writes nothing.
function usageStateFromQuery(query = {}) {
  const view = text(query.view) === "usage" ? "usage" : "map";
  const mode = USAGE_MODES.some((item) => item.value === text(query.mode)) ? text(query.mode) : "calls";
  return {
    view,
    entry: view === "usage" ? text(query.entry) : "",
    mode: view === "usage" ? mode : "calls",
    subsystem: view === "usage" ? text(query.subsystem) : "",
    recording: view === "usage" ? text(query.recording) : "",
    request: view === "usage" ? text(query.request) : ""
  };
}

function usageQueryFor(query = {}, state = {}) {
  const next = Object.fromEntries(Object.entries(query).filter(([key]) => !USAGE_QUERY_KEYS.includes(key)));
  const normalized = usageStateFromQuery(state);
  if (normalized.view !== "usage") return next;
  next.view = "usage";
  next.mode = normalized.mode;
  for (const key of ["entry", "subsystem", "recording", "request"]) if (normalized[key]) next[key] = normalized[key];
  return next;
}

function sameUsageState(left = {}, right = {}) {
  const a = usageStateFromQuery(left);
  const b = usageStateFromQuery(right);
  return USAGE_QUERY_KEYS.every((key) => a[key] === b[key]);
}

function sameQuery(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => String(left[key] ?? "") === String(right[key] ?? ""));
}

function functionLabel(fn = {}) {
  if (fn.kind === "module") return `${fileName(fn.file)} top level`;
  const name = fn.name || `anonymous (line ${fn.start?.line ?? "?"})`;
  return fn.container ? `${fn.container}.${name}` : name;
}

function fileName(filePath = "") {
  return String(filePath).split("/").pop();
}

// Path segments that keep their slash, so long paths wrap between folders.
function pathParts(filePath = "") {
  return String(filePath).split(/(?<=\/)/u);
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${Number(count || 0).toLocaleString()} ${count === 1 ? singular : plural}`;
}

// Cards per declared layout group, in group order; alphabetical when the
// project declares none. Untouched subsystems stay hidden unless asked for.
function subsystemSections(subsystems = [], groups = [], { countKey, showUntouched = false } = {}) {
  const reached = (item) => Number(item[countKey] || 0) > 0;
  const visible = subsystems.filter((item) => showUntouched || reached(item));
  const alphabetical = (left, right) => left.title.localeCompare(right.title);
  const sections = [];
  for (const group of groups) {
    const cards = visible.filter((item) => item.group === group.id).sort(alphabetical);
    if (cards.length) sections.push({ id: group.id, title: group.title, cards });
  }
  const placed = new Set(groups.map((group) => group.id));
  const rest = visible.filter((item) => !placed.has(item.group)).sort(alphabetical);
  if (rest.length) sections.push({ id: "", title: groups.length ? "Other subsystems" : "", cards: rest });
  return { sections, untouched: subsystems.filter((item) => !reached(item)).length };
}

function crossingsFrom(crossings = [], subsystemId = "", subsystems = []) {
  const titles = new Map(subsystems.map((item) => [item.id, item.title]));
  return crossings.filter((crossing) => crossing.fromSubsystemId === subsystemId)
    .map((crossing) => ({ ...crossing, title: titles.get(crossing.toSubsystemId) || crossing.toSubsystemId }));
}

const COUNT_KEYS = Object.freeze({ imports: "fileCount", calls: "functionCount", recording: "ranCount" });

function subsystemCard(mode, item = {}) {
  if (mode === "imports") return { count: countLabel(item.fileCount, "file"), detail: "" };
  if (mode === "calls") return { count: countLabel(item.functionCount, "function"), detail: `${Number(item.exact || 0).toLocaleString()} by exact calls · ${Number(item.probable || 0).toLocaleString()} only via probable` };
  return { count: `${countLabel(item.ranCount, "function")} ran`, detail: "", plumbing: item.plumbingCount || 0 };
}

// Crossings count calls (cards count functions). In Recording they are the
// static calls between functions that ran, not proof that a call happened.
function crossingText(mode, crossing = {}) {
  if (mode === "imports") return countLabel(crossing.count, "import");
  const exact = Number(crossing.exact || 0);
  const probable = Number(crossing.probable || 0);
  if (mode === "recording") return countLabel(exact + probable, "call in code", "calls in code");
  const calls = [exact && countLabel(exact, "exact call"), probable && (exact ? `${probable.toLocaleString()} probable` : countLabel(probable, "probable call"))].filter(Boolean).join(", ");
  return [calls, crossing.renders && `renders ${countLabel(crossing.renders, "component")}`].filter(Boolean).join(" · ");
}

function depthTitle(depth) {
  return depth === 0 ? "Start" : depth === 1 ? "1 step away" : `${depth} steps away`;
}

function edgeCounts(edges = []) {
  const out = new Map();
  const into = new Map();
  for (const edge of edges) {
    out.set(edge.from, (out.get(edge.from) || 0) + 1);
    into.set(edge.to, (into.get(edge.to) || 0) + 1);
  }
  return { out, into };
}

// One display shape for files (Imports), reached functions (Calls) and
// functions that ran (Recording), so the zoomed view draws them alike.
function webNodes(mode, data = {}) {
  const edges = data.edges || [];
  const { out, into } = edgeCounts(edges);
  if (mode === "imports") {
    return (data.files || []).map((file) => ({
      id: file.id, title: fileName(file.path), subtitle: file.path, file: file.path, start: null, depth: file.depth,
      certainty: null, outCount: out.get(file.id) || 0, inCount: into.get(file.id) || 0, unresolved: 0
    }));
  }
  if (mode === "calls") {
    const unresolved = new Map();
    for (const item of data.unresolved || []) unresolved.set(item.fromFunctionId, (unresolved.get(item.fromFunctionId) || 0) + 1);
    return (data.functions || []).map((fn) => ({
      id: fn.id, functionId: fn.id, title: functionLabel(fn), subtitle: `${fn.file}:${fn.start.line}`, file: fn.file, start: fn.start,
      depth: fn.depth, certainty: fn.reach, outCount: fn.callCount || 0, inCount: fn.calledByCount || 0, unresolved: unresolved.get(fn.id) || 0
    }));
  }
  return recordedDepths(data.nodes || [], edges).map((node) => ({
    id: node.id, functionId: node.functionId, title: functionLabel({ name: node.name, start: node.start }), subtitle: `${node.file}:${node.start.line}`,
    file: node.file, start: node.start, depth: node.depth, certainty: null, count: node.count, plumbing: node.plumbing, join: node.join,
    outCount: out.get(node.id) || 0, inCount: into.get(node.id) || 0, unresolved: 0
  }));
}

// Columns by depth for the zoomed canvas, and the same groups for phone rows.
function depthColumns(nodes = []) {
  const columns = new Map();
  for (const node of nodes) {
    const depth = Number(node.depth || 0);
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth).push(node);
  }
  return [...columns.entries()].sort(([left], [right]) => left - right).map(([depth, items]) => ({ depth, items }));
}

const NODE = Object.freeze({ width: 220, height: 64, columnGap: 72, rowGap: 16, padding: 16 });

// Fixed positions: a node's column is its depth, its row its order there.
function canvasLayout(nodes = [], edges = []) {
  const positions = new Map();
  const columns = depthColumns(nodes);
  columns.forEach((column, columnIndex) => column.items.forEach((node, rowIndex) => {
    positions.set(node.id, { x: NODE.padding + columnIndex * (NODE.width + NODE.columnGap), y: NODE.padding + rowIndex * (NODE.height + NODE.rowGap) });
  }));
  const tallest = Math.max(0, ...columns.map((column) => column.items.length));
  const paths = edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to)).map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const forward = to.x > from.x;
    const start = { x: from.x + NODE.width, y: from.y + NODE.height / 2 };
    const end = forward ? { x: to.x, y: to.y + NODE.height / 2 } : { x: to.x + NODE.width, y: to.y + NODE.height / 2 };
    const bend = forward ? Math.max(32, (end.x - start.x) / 2) : NODE.columnGap / 2 + Math.abs(end.y - start.y) / 4;
    const d = forward
      ? `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
      : `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x + bend} ${end.y}, ${end.x} ${end.y}`;
    return { ...edge, key: `${edge.from}>${edge.to}`, d };
  });
  return {
    positions,
    paths,
    width: NODE.padding * 2 + Math.max(1, columns.length) * NODE.width + Math.max(0, columns.length - 1) * NODE.columnGap,
    height: NODE.padding * 2 + tallest * NODE.height + Math.max(0, tallest - 1) * NODE.rowGap
  };
}

const CERTAINTY_TEXT = Object.freeze({ exact: "exact", probable: "probable", unresolved: "unresolved" });
// How the analysis found each call's target, in plain words.
const METHOD_TEXT = Object.freeze({
  checker: "proved by types",
  "di-binding": "dependency binding",
  "route-action": "the route's action",
  "argument-flow": "passed as an argument",
  "import-scope": "matched by imported name",
  "same-file-name": "matched by name in this file",
  self: "same class",
  "receiver-name": "matched by method name",
  operation: "request",
  // Renders rows have their own headings; the tag says the rest.
  renders: "",
  none: ""
});

function callMethodText(method = "") {
  return METHOD_TEXT[method] ?? method;
}

const ANALYSIS_NAMES = Object.freeze({ jskit: "JSKIT" });

function coverageText(coverage = "") {
  if (coverage.startsWith("adapter:")) {
    const family = coverage.slice("adapter:".length).split(".")[0];
    return `Calls read by ${ANALYSIS_NAMES[family] || family} analysis, which can prove exact calls`;
  }
  if (coverage === "generic") return "Calls read by name only: probable at best";
  return "Calls not read for this file";
}

// Rows for one direction of a function's calls, split by certainty.
function callGroups(rows = [], heading) {
  return ["exact", "probable"].map((certainty) => ({
    certainty,
    title: `${heading} (${certainty})`,
    rows: rows.filter((row) => row.certainty === certainty)
  })).filter((group) => group.rows.length);
}

// Routes are matched by their own template; `:name` and `*` stand for one segment.
function routeTemplateFor(method = "", requestPath = "", routes = []) {
  const parts = String(requestPath).split("/");
  const match = routes.find((route) => {
    const [routeMethod, template] = String(route.title || "").split(" ");
    if (!template || routeMethod.toUpperCase() !== String(method).toUpperCase()) return false;
    const templateParts = template.split("/");
    return templateParts.length === parts.length && templateParts.every((part, position) => part === parts[position] || part.startsWith(":") || part === "*");
  });
  return match ? match.title.split(" ").slice(1).join(" ") : "";
}

// Worker and ASGI servers run every request in one process; their project
// code is recorded under a background scope instead of per request.
// Beside per-request rows, a background row is a process's start-up and other
// work outside any request.
const BACKGROUND_TEXT = "Not separated per request for this server";
const OUTSIDE_REQUESTS_TEXT = "Start-up and work outside requests";
const isBackgroundRequest = (request = {}) => request.kind === "background" || /^bg_[0-9]+$/u.test(String(request.id || ""));

// True when project code ran only outside per-request scopes.
function onlyBackground(requests = []) {
  const ran = requests.filter((request) => Number(request.functionCount || 0) > 0);
  return ran.length > 0 && ran.every(isBackgroundRequest);
}

function requestTitle(request = {}, routes = [], requests = [request]) {
  if (isBackgroundRequest(request)) return onlyBackground(requests) ? BACKGROUND_TEXT : OUTSIDE_REQUESTS_TEXT;
  return routeTemplateFor(request.method, request.path, routes) || request.path || "";
}

// Requests under the click that caused them, in recorded order.
function requestGroups(requests = [], interactions = []) {
  const byId = new Map(interactions.map((interaction) => [interaction.id, interaction]));
  const groups = [];
  for (const request of requests) {
    const interaction = byId.get(request.interaction) || null;
    const last = groups.at(-1);
    if (last && last.interaction?.id === interaction?.id) last.requests.push(request);
    else groups.push({ key: `${interaction?.id || "none"}:${request.id}`, interaction, requests: [request] });
  }
  return groups;
}

const INTERACTION_VERBS = Object.freeze({ click: "Click", enter: "Enter", submit: "Submit" });

function interactionTitle(interaction) {
  if (!interaction) return "";
  const verb = INTERACTION_VERBS[interaction.kind] || INTERACTION_VERBS.click;
  return `${verb}: ${interaction.label}${interaction.componentFile ? ` (${fileName(interaction.componentFile)})` : ""}`;
}

// What ran in one request, joined to the call web and grouped by subsystem.
function recordingWeb(functions = [], join = null) {
  const joined = new Map((join?.joined || []).map((item) => [item.index, item]));
  const nodes = functions.map((fn, index) => {
    const match = joined.get(index) || { functionId: null, subsystemId: null, join: "none" };
    return {
      id: match.functionId || `ran:${index}`,
      functionId: match.functionId,
      name: fn.name,
      file: fn.path,
      start: fn.start,
      end: fn.end,
      count: fn.count,
      plumbing: fn.plumbing === true,
      subsystemId: match.subsystemId,
      join: match.join
    };
  });
  const edges = (join?.edges || []).filter((edge) => nodes[edge.from] && nodes[edge.to])
    .map((edge) => ({ from: nodes[edge.from].id, to: nodes[edge.to].id, certainty: edge.certainty }));
  const subsystems = (join?.subsystems || []).map((owner) => {
    const ran = nodes.filter((node) => node.subsystemId === owner.id);
    return { ...owner, ranCount: ran.length, plumbingCount: ran.filter((node) => node.plumbing).length };
  });
  const owners = new Map(nodes.map((node) => [node.id, node.subsystemId]));
  const crossings = new Map();
  for (const edge of edges) {
    const from = owners.get(edge.from);
    const to = owners.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\n${to}`;
    if (!crossings.has(key)) crossings.set(key, { fromSubsystemId: from, toSubsystemId: to, exact: 0, probable: 0 });
    crossings.get(key)[edge.certainty === "exact" ? "exact" : "probable"] += 1;
  }
  return { nodes, edges, subsystems, crossings: [...crossings.values()] };
}

// Recorded functions have no traversal depth: order them by their arrows.
function recordedDepths(nodes = [], edges = []) {
  const ids = new Set(nodes.map((node) => node.id));
  const inside = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of inside) incoming.set(edge.to, incoming.get(edge.to) + 1);
  const depth = new Map();
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) depth.set(id, 0);
  for (let head = 0; head < queue.length; head += 1) {
    for (const edge of inside) if (edge.from === queue[head] && !depth.has(edge.to)) { depth.set(edge.to, depth.get(queue[head]) + 1); queue.push(edge.to); }
  }
  return nodes.map((node) => ({ ...node, depth: depth.get(node.id) ?? 0 }));
}

function unavailableRuntimes(targets = []) {
  if (!targets.length || targets.some((target) => target.available)) return [];
  return [...new Set(targets.flatMap((target) => target.runtimes || []))];
}

function joinText(join = "") {
  if (join === "stale") return "Changed since the last scan";
  if (join === "none") return "Not in the last scan";
  return "";
}

export {
  BACKGROUND_TEXT,
  COUNT_KEYS,
  MAX_NODES,
  MORE_NODES,
  NODE,
  USAGE_MODES,
  CERTAINTY_TEXT,
  callGroups,
  callMethodText,
  canvasLayout,
  countLabel,
  coverageText,
  crossingText,
  crossingsFrom,
  depthColumns,
  depthTitle,
  entryKind,
  functionLabel,
  interactionTitle,
  isBackgroundRequest,
  joinText,
  onlyBackground,
  pathParts,
  recordedDepths,
  recordingWeb,
  requestGroups,
  requestTitle,
  routeTemplateFor,
  sameQuery,
  sameUsageState,
  subsystemCard,
  subsystemSections,
  unavailableRuntimes,
  usageQueryFor,
  usageStateFromQuery,
  webNodes
};
