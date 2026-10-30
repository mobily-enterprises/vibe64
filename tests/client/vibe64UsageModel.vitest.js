// The usage view's presentation model and its reads: address state, cards,
// canvas layout, call lists, recorded requests and their joins, shaped from
// real usage answers over the shared usage-map fixtures.
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ request: null }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: (...args) => http.request(...args) }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ api: (suffix) => `/api/app/demo${suffix}` }) }));

import {
  buildCallIndex,
  buildSnapshotIndex,
  joinFunctions,
  readCallsWeb,
  readImportsWeb
} from "../../packages/vibe64-system-graph/src/server/usageWeb.js";
import {
  callGroups,
  canvasLayout,
  crossingText,
  functionLabel,
  interactionTitle,
  onlyBackground,
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
} from "../../packages/vibe64-system-graph/src/client/usage/usageModel.js";
import { useVibe64UsageWeb } from "../../packages/vibe64-system-graph/src/client/usage/useVibe64UsageWeb.js";

const json = async (name) => JSON.parse(await readFile(new URL(`../fixtures/usage-map/${name}`, import.meta.url), "utf8"));
const machine = await json("machine-city.json");
const callWeb = await json("call-web.json");
const ran = await json("recording/api/request-functions/r_000004.json");
const requests = await json("recording/api/requests.json");
const LAYOUT = { groups: [
  { id: "entry", title: "Entry points", kind: "layer", subsystems: [{ root: "bin" }, { root: "server" }] },
  { id: "features", title: "Features", kind: "layer", subsystems: [{ root: "src" }, { root: "packages/sessions" }, { root: "packages/reports" }] },
  { id: "shared", title: "Shared code", kind: "layer", subsystems: [{ root: "packages/core" }] }
] };
const index = buildSnapshotIndex({ city: machine, exists: true, builtAt: "2026-10-30T10:00:00.000Z" }, LAYOUT);
const calls = buildCallIndex(callWeb);
const PAGE = index.entryById.get("entry:page:src/pages/SessionsPage.vue");
const ROUTE_GET = index.entryById.get("entry:route:http:demo:GET:/api/sessions");

describe("address state", () => {
  it("round-trips Usage through the query and leaves other parameters alone", () => {
    const state = usageStateFromQuery({ view: "usage", entry: PAGE.id, mode: "imports", subsystem: "directory:src", recording: "", request: "" });
    const query = usageQueryFor({ tab: "x", entry: "old" }, state);
    expect(query).toEqual({ tab: "x", view: "usage", mode: "imports", entry: PAGE.id, subsystem: "directory:src" });
    expect(sameUsageState(usageStateFromQuery(query), state)).toBe(true);
    expect(usageQueryFor({ tab: "x", view: "usage", mode: "calls" }, usageStateFromQuery({}))).toEqual({ tab: "x" });
    expect(usageStateFromQuery({ view: ["usage"], mode: "bogus", entry: [" a "] })).toMatchObject({ view: "usage", mode: "calls", entry: "a" });
    expect(usageStateFromQuery({ entry: "a" })).toMatchObject({ view: "map", entry: "" });
    expect(sameQuery({ a: "1", b: undefined }, { a: 1 })).toBe(true);
    expect(sameQuery({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });
});

describe("presentation", () => {
  it("names functions, cards and crossings the way the view shows them", () => {
    expect(functionLabel({ name: "", start: { line: 12 } })).toBe("anonymous (line 12)");
    expect(functionLabel({ name: "read", container: "Store", start: { line: 1 } })).toBe("Store.read");
    expect(functionLabel({ name: "", kind: "module", file: "src/main.js", start: { line: 1 } })).toBe("main.js top level");
    expect(subsystemCard("calls", { functionCount: 3, exact: 2, probable: 1 })).toEqual({ count: "3 functions", detail: "2 exact · 1 probable" });
    expect(subsystemCard("imports", { fileCount: 1 })).toEqual({ count: "1 file", detail: "" });
    expect(subsystemCard("recording", { ranCount: 4, plumbingCount: 2 })).toEqual({ count: "4 functions ran", detail: "", plumbing: 2 });
    expect(crossingText("imports", { count: 2 })).toBe("2 imports");
    expect(crossingText("calls", { exact: 1, probable: 0 })).toBe("1 exact");
  });

  it("places reached subsystems in layout groups and hides untouched ones behind a count", () => {
    const web = readImportsWeb(index, ROUTE_GET, {});
    const { sections, untouched } = subsystemSections(web.subsystems, web.groups, { countKey: "fileCount" });
    expect(sections.map((section) => [section.title, section.cards.map((card) => card.title)])).toEqual([
      ["Features", ["Sessions"]], ["Shared code", ["Core"]]
    ]);
    expect(untouched).toBe(web.subsystems.length - 2);
    const all = subsystemSections(web.subsystems, web.groups, { countKey: "fileCount", showUntouched: true });
    expect(all.sections.at(-1)).toMatchObject({ id: "", title: "Other subsystems" });
    expect(subsystemSections(web.subsystems, [], { countKey: "fileCount" }).sections).toEqual([
      { id: "", title: "", cards: expect.any(Array) }
    ]);
  });

  it("lays the zoomed web out by depth with one path per drawn edge", () => {
    const web = readCallsWeb(index, calls, PAGE, { subsystemId: "directory:src" });
    const nodes = webNodes("calls", web);
    const plan = canvasLayout(nodes, web.edges);
    expect(nodes.every((node) => plan.positions.has(node.id))).toBe(true);
    const columns = new Set([...plan.positions.values()].map((position) => position.x));
    expect(columns.size).toBe(new Set(nodes.map((node) => node.depth)).size);
    expect(plan.paths).toHaveLength(web.edges.length);
    expect(canvasLayout(nodes.slice(0, 1), web.edges).paths.every((path) => path.from === nodes[0].id && path.to === nodes[0].id)).toBe(true);
    expect(nodes.find((node) => node.depth === 0)).toMatchObject({ certainty: expect.stringMatching(/exact|probable/u) });
  });

  it("splits a function's calls by certainty with the documented titles", () => {
    const groups = callGroups([{ certainty: "probable" }, { certainty: "exact" }, { certainty: "exact" }], "Calls");
    expect(groups.map((group) => [group.title, group.rows.length])).toEqual([["Calls (exact)", 2], ["Calls (probable)", 1]]);
  });
});

describe("recordings", () => {
  it("names a request by its route template and groups requests under the click that caused them", () => {
    const routes = [{ title: "GET /api/sessions/:id" }, { title: "POST /api/sessions" }];
    expect(routeTemplateFor("get", "/api/sessions/42", routes)).toBe("/api/sessions/:id");
    expect(routeTemplateFor("POST", "/api/sessions/42", routes)).toBe("");
    const groups = requestGroups(requests.requests, requests.interactions);
    expect(groups.map((group) => [group.interaction?.id || null, group.requests.map((request) => request.id)])).toEqual([
      [null, ["r_000002"]], ["i_0001", ["r_000003", "r_000004"]]
    ]);
    expect(interactionTitle(groups[1].interaction)).toBe("Click: button \"Add\" (SessionList.vue)");
  });

  it("joins what ran to the call web and lights only the subsystems that ran", () => {
    const join = joinFunctions(index, calls, { functions: ran.functions });
    const web = recordingWeb(ran.functions, join);
    expect(web.nodes).toHaveLength(ran.functions.length);
    expect(web.nodes.filter((node) => node.join === "stale").map((node) => node.file)).toEqual(["packages/core/src/shared/text.js"]);
    expect(web.subsystems.map((owner) => [owner.title, owner.ranCount, owner.plumbingCount])).toEqual([
      ["Core", 6, 5], ["Sessions", 8, 2], ["Server", 2, 2]
    ]);
    expect(web.edges.every((edge) => web.nodes.some((node) => node.id === edge.from) && web.nodes.some((node) => node.id === edge.to))).toBe(true);
    // The fixture's static arrows stay inside subsystems; a crossing counts by certainty.
    expect(web.crossings).toEqual([]);
    const crossing = recordingWeb(ran.functions, { ...join, edges: [...join.edges, { from: 15, to: 8, certainty: "probable" }] });
    expect(crossing.crossings).toEqual([{ fromSubsystemId: "directory:server", toSubsystemId: "directory:packages/sessions", exact: 0, probable: 1 }]);
    const depths = recordedDepths(web.nodes, web.edges);
    expect(depths.every((node) => Number.isInteger(node.depth))).toBe(true);
    const zoomed = webNodes("recording", { nodes: web.nodes.filter((node) => node.subsystemId === "directory:server"), edges: web.edges });
    expect(zoomed.map((node) => [node.title, node.count])).toEqual([["anonymous (line 8)", 1], ["handle", 1]]);
  });

  it("names background scopes as not separated per request", () => {
    const background = { id: "bg_4242", functionCount: 3 };
    expect(requestTitle(background)).toBe("Not separated per request for this server");
    expect(requestTitle({ id: "r_000001", method: "GET", path: "/api/sessions/1" }, [{ title: "GET /api/sessions/:id" }])).toBe("/api/sessions/:id");
    expect(onlyBackground([{ id: "r_000001", functionCount: 0 }, background])).toBe(true);
    expect(onlyBackground([{ id: "r_000001", functionCount: 2 }, background])).toBe(false);
    expect(onlyBackground([{ id: "r_000001", functionCount: 0 }])).toBe(false);
  });

  it("reports runtimes only when no target can be recorded", () => {
    expect(unavailableRuntimes([{ available: false, runtimes: ["go"] }, { available: false, runtimes: ["go", "rust"] }])).toEqual(["go", "rust"]);
    expect(unavailableRuntimes([{ available: true, runtimes: ["nodejs"] }, { available: false, runtimes: ["go"] }])).toEqual([]);
    expect(unavailableRuntimes([])).toEqual([]);
  });
});

describe("reads", () => {
  it("keeps the latest entry search, pages on, and joins a request's functions to the call web", async () => {
    const sent = [];
    const pending = [];
    http.request = vi.fn((path, options = {}) => {
      sent.push([options.method, path, options.query || options.body]);
      if (path.endsWith("/usage/entries") && options.query.q === "slow") return new Promise((resolve) => pending.push(resolve));
      if (path.endsWith("/usage/entries")) return Promise.resolve({ snapshot: index.snapshot, entries: [{ id: options.query.cursor || "first" }], kinds: [], nextCursor: options.query.cursor ? null : "100" });
      if (path.endsWith("/functions")) return Promise.resolve(ran);
      if (path.endsWith("/usage/join")) return Promise.resolve(joinFunctions(index, calls, options.body));
      throw new Error(`unexpected ${path}`);
    });
    const usage = useVibe64UsageWeb({ sessionId: "s 1" });
    const slow = usage.entries.search({ q: "slow" });
    await usage.entries.search({ q: "  route  ", kind: "route" });
    pending[0]({ entries: [{ id: "stale" }], kinds: [], nextCursor: null });
    expect(await slow).toBeNull();
    expect(usage.entries.items.value).toEqual([{ id: "first" }]);
    expect(usage.entries.hasMore.value).toBe(true);
    await usage.entries.more();
    expect(usage.entries.items.value.map((entry) => entry.id)).toEqual(["first", "100"]);
    expect(sent[1]).toEqual(["GET", "/api/app/demo/vibe64/system-graph/sessions/s%201/usage/entries", { q: "route", kind: "route", limit: 100 }]);

    const result = await usage.result.run({ recordingId: "rec_1", requestId: "r_000004" });
    expect(sent.at(-2)).toEqual(["GET", "/api/app/demo/vibe64/usage-recordings/sessions/s%201/rec_1/requests/r_000004/functions", { limit: 1500 }]);
    expect(sent.at(-1)[0]).toBe("POST");
    expect(sent.at(-1)[2].functions[0]).toEqual({ path: ran.functions[0].path, hash: ran.functions[0].hash, name: ran.functions[0].name, start: ran.functions[0].start });
    expect(result).toMatchObject({ recordingId: "rec_1", requestId: "r_000004", total: 16, truncated: false });
    expect(result.join.joined).toHaveLength(16);

    http.request = vi.fn(() => Promise.reject(Object.assign(new Error("This entry point is not in the current scan."), { code: "vibe64_usage_entry_not_found" })));
    expect(await usage.web.run({ entryId: "gone", mode: "calls" })).toBeNull();
    expect([usage.web.error.value, usage.web.errorCode.value]).toEqual(["This entry point is not in the current scan.", "vibe64_usage_entry_not_found"]);
  });
});
