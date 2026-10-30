// The Usage view renders each required state for Imports, Calls and
// Recording from real usage answers over the shared fixtures, and the
// Architecture view keeps Usage's state in the system dashboard address.
import { readFile } from "node:fs/promises";
import { createRenderer, createSSRApp, nextTick, ref, shallowRef, ssrContextKey } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { createVuetify } from "vuetify";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ usage: null, graph: null }));
vi.mock("../../packages/vibe64-system-graph/src/client/usage/useVibe64UsageWeb.js", () => ({ useVibe64UsageWeb: () => fake.usage }));
vi.mock("../../packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js", () => ({ useVibe64SystemGraph: () => fake.graph, SYSTEM_GRAPH_API_SUFFIX: "/vibe64/system-graph" }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: async () => ({}) }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ api: (suffix) => `/api/app/demo${suffix}` }) }));

import {
  buildCallIndex,
  buildSnapshotIndex,
  joinFunctions,
  readCallsWeb,
  readEntries,
  readFunction,
  readImportsWeb
} from "../../packages/vibe64-system-graph/src/server/usageWeb.js";
import Vibe64UsageView from "../../packages/vibe64-system-graph/src/client/usage/Vibe64UsageView.vue";
import Vibe64UsageFunctionPanel from "../../packages/vibe64-system-graph/src/client/usage/Vibe64UsageFunctionPanel.vue";
import Vibe64UsageWebCanvas from "../../packages/vibe64-system-graph/src/client/usage/Vibe64UsageWebCanvas.vue";
import Vibe64UsageEntryRail from "../../packages/vibe64-system-graph/src/client/usage/Vibe64UsageEntryRail.vue";
import Vibe64UiStoryboardView from "../../packages/vibe64-system-graph/src/client/components/Vibe64UiStoryboardView.vue";
import { webNodes } from "../../packages/vibe64-system-graph/src/client/usage/usageModel.js";

const json = async (name) => JSON.parse(await readFile(new URL(`../fixtures/usage-map/${name}`, import.meta.url), "utf8"));
const machine = await json("machine-city.json");
const callWeb = await json("call-web.json");
const recordingList = await json("recording/api/list.json");
const requests = await json("recording/api/requests.json");
const targets = await json("recording/api/targets.json");
const ran = await json("recording/api/request-functions/r_000004.json");
const LAYOUT = { groups: [
  { id: "entry", title: "Entry points", kind: "layer", subsystems: [{ root: "bin" }, { root: "server" }] },
  { id: "features", title: "Features", kind: "layer", subsystems: [{ root: "src" }, { root: "packages/sessions" }, { root: "packages/reports" }] },
  { id: "shared", title: "Shared code", kind: "layer", subsystems: [{ root: "packages/core" }] }
] };
const index = buildSnapshotIndex({ city: machine, exists: true, builtAt: "2026-10-30T10:00:00.000Z" }, LAYOUT);
const calls = buildCallIndex(callWeb);
const PAGE = "entry:page:src/pages/SessionsPage.vue";
const page = index.entryById.get(PAGE);
const recordingId = recordingList.recordings[0].id;

function read(data = null, { loading = false, error = "", errorCode = "" } = {}) {
  return { data: shallowRef(data), loading: ref(loading), error: ref(error), errorCode: ref(errorCode), run: vi.fn(async () => data), reset: vi.fn() };
}

function usageReads({ entries = readEntries(index, {}), snapshot = index.snapshot, web = null, result = null, recordings = null, ...reads } = {}) {
  return {
    entries: { items: shallowRef(entries.entries), kinds: shallowRef(entries.kinds), hasMore: ref(false), loading: ref(false), error: ref(""), errorCode: ref(""), search: vi.fn(async () => entries), more: vi.fn() },
    snapshot: shallowRef(snapshot),
    web: web || read(),
    detail: reads.detail || read(),
    recordings: recordings || read({ recordings: [] }),
    targets: reads.targets || read(targets),
    requests: reads.requests || read(null),
    result: result || read(),
    routes: shallowRef([{ title: "GET /api/sessions" }, { title: "POST /api/sessions" }]),
    loadRoutes: vi.fn(async () => [])
  };
}

const vuetify = () => createVuetify({ ssr: true });
async function render(component, props) {
  const app = createSSRApp(component, props);
  app.use(vuetify());
  // The Record dialog inside Usage reads recordings through the app's query client.
  app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/gu, "").replace(/ data-v-[0-9a-f]+/gu, "");
}
const usageState = (state) => ({ view: "usage", entry: "", mode: "calls", subsystem: "", recording: "", request: "", ...state });
const view = (state, reads) => {
  fake.usage = usageReads(reads);
  return render(Vibe64UsageView, { sessionId: "s1", state: usageState(state) });
};
const callsWeb = (input = {}) => ({ ok: true, snapshot: index.snapshot, ...readCallsWeb(index, calls, page, input) });

describe("Imports and Calls states", () => {
  it("asks for an entry, or for a refresh when the scan found none", async () => {
    const pick = await view({});
    expect(pick).toContain("Pick an entry point");
    expect(pick).toContain("Record");
    expect(pick).toContain("Sessions");
    const none = await view({}, { entries: { entries: [], kinds: [] } });
    expect(none).toContain("No entry points found yet. Refresh the architecture scan.");
  });

  it("shows a skeleton while loading, and errors with Retry or a way back", async () => {
    expect(await view({ entry: PAGE })).toContain("aria-label=\"Loading usage\"");
    const failed = await view({ entry: PAGE }, { web: read(null, { error: "The usage map could not be read." }) });
    expect(failed).toContain("The usage map could not be read.");
    expect(failed).toContain("Retry");
    const gone = await view({ entry: PAGE }, { web: read(null, { error: "x", errorCode: "vibe64_usage_entry_not_found" }) });
    expect(gone).toContain("This entry point is not in the current scan.");
    expect(gone).toContain("Choose another");
  });

  it("shows reached subsystems as cards with certainty, crossings and the untouched chip", async () => {
    const html = await view({ entry: PAGE }, { web: read(callsWeb()) });
    expect(html).toContain("Client");
    expect(html).toMatch(/\d+ by exact calls · \d+ only via probable/u);
    expect(html).toContain("1 exact call, 1 probable");
    expect(html).toMatch(/Show untouched \(\d+\)/u);
    expect(html).toContain("Exact only");
    expect(html).not.toContain("Source changed since the last scan");
    const imports = await view({ entry: PAGE, mode: "imports" }, { web: read({ ok: true, snapshot: index.snapshot, ...readImportsWeb(index, page, {}) }) });
    expect(imports).toMatch(/\d+ files?/u);
    expect(imports).not.toContain("Exact only");
  });

  it("zooms into one subsystem with its functions and the line legend", async () => {
    const zoomed = callsWeb({ subsystemId: "directory:src" });
    const html = await view({ entry: PAGE, subsystem: "directory:src" }, { web: read(zoomed) });
    expect(html).toContain("All subsystems");
    for (const label of ["Exact", "Probable", "Unresolved"]) expect(html).toContain(label);
    for (const node of webNodes("calls", zoomed)) expect(html).toContain(node.title.replace(/"/gu, "&quot;"));
  });

  it("offers more nodes when truncated and a refresh when the source changed", async () => {
    const truncated = { ...callsWeb({ subsystemId: "directory:src" }), truncated: true };
    const html = await view({ entry: PAGE, subsystem: "directory:src" }, { web: read(truncated), snapshot: { ...index.snapshot, stale: true } });
    expect(html).toContain("Showing the first 300");
    expect(html).toContain("Show more");
    expect(html).toContain("Source changed since the last scan");
    expect(html).toContain("Refresh");
  });

  it("explains entries whose calls are not known instead of an empty web", async () => {
    const web = { ...callsWeb(), entry: { ...callsWeb().entry, hasCalls: false } };
    const html = await view({ entry: PAGE }, { web: read(web), snapshot: { ...index.snapshot, callWebIdentity: null } });
    expect(html).toContain("Calls are not available here");
    expect(html).toContain("The last scan did not read calls for this project.");
    expect(html).toContain("Show Imports");
  });
});

describe("Recording states", () => {
  const recordings = read(recordingList);
  const joined = { recordingId, requestId: "r_000004", functions: ran.functions, total: ran.total, truncated: false, join: joinFunctions(index, calls, { functions: ran.functions }) };

  it("says when nothing can be recorded, and when nothing was recorded yet", async () => {
    const unavailable = { targets: targets.targets.filter((target) => !target.available) };
    const html = await view({ mode: "recording" }, { targets: read(unavailable) });
    expect(html).toContain("Recording not available for this project&#39;s runtimes (<code>go</code>). Imports and Calls still work.");
    expect(html).toContain("Record");
    expect(await view({ mode: "recording" })).toContain("No recordings yet");
  });

  it("lists requests under their click with method, route and counts, then asks for one", async () => {
    const html = await view({ mode: "recording", recording: recordingId }, { recordings, requests: read(requests) });
    expect(html).toContain("Pick a request");
    expect(html).toContain("Click: button &quot;Add&quot; (SessionList.vue)");
    expect(html).toContain("/api/sessions");
    expect(html).toContain("200 · 11 files · 16 functions");
    expect(html).toContain("Show requests that ran no project code");
    expect(html).not.toContain("Other requests");
    const later = { ...requests.requests.at(-1), id: "r_000009", interaction: null };
    const after = await view({ mode: "recording", recording: recordingId }, { recordings, requests: read({ ...requests, requests: [...requests.requests, later] }) });
    expect(after).toMatch(/Click: button &quot;Add&quot;[\s\S]*Other requests/u);
  });

  it("says honestly when a server records every request in one background scope", async () => {
    const shared = { requests: [{ id: "bg_4242", kind: "background", method: null, path: null, status: null, startedAt: null, durationMs: null, interaction: null, functionCount: 21, fileCount: 12 }], interactions: [], nextCursor: null };
    const html = await view({ mode: "recording", recording: recordingId }, { recordings, requests: read(shared) });
    expect(html).toContain("Not separated per request for this server: its requests share one process");
    expect(html).toContain("Everything that ran while recording · 12 files · 21 functions");
    expect(await view({ mode: "recording", recording: recordingId }, { recordings, requests: read(requests) })).not.toContain("Not separated per request");
  });

  it("lights only the subsystems that ran, with shared plumbing counted per card", async () => {
    const html = await view({ mode: "recording", recording: recordingId, request: "r_000004" }, { recordings, requests: read(requests), result: read(joined) });
    expect(html).toContain("6 functions ran");
    expect(html).toContain("Shared plumbing (5)");
    expect(html).not.toContain("Client");
    const zoomed = await view({ mode: "recording", recording: recordingId, request: "r_000004", subsystem: "directory:packages/sessions" }, { recordings, requests: read(requests), result: read(joined) });
    expect(zoomed).toContain("Shared plumbing (2)");
    expect(zoomed).toContain("listSessions");
    expect(zoomed).toContain("Not in the last scan");
    expect(zoomed).toMatch(/usage-node__badge[^>]*>not scanned</u);
    expect(zoomed).not.toContain("runAction");
  });

  it("shows loading, error with Retry and truncation for one request", async () => {
    const state = { mode: "recording", recording: recordingId, request: "r_000004" };
    expect(await view(state, { recordings, requests: read(requests), result: read(null, { loading: true }) })).toContain("aria-label=\"Loading what ran\"");
    const failed = await view(state, { recordings, requests: read(requests), result: read(null, { error: "Recording files are missing." }) });
    expect(failed).toContain("Recording files are missing.");
    expect(failed).toContain("Retry");
    const truncated = await view(state, { recordings, requests: read(requests), result: read({ ...joined, total: 4000, truncated: true }) });
    expect(truncated).toContain("Showing the first 16 of 4,000 functions that ran.");
  });
});

describe("parts", () => {
  it("shows a function's calls by certainty, unresolved calls and Open source", async () => {
    const detail = readFunction(index, calls, { functionId: callWeb.functions.find((fn) => fn.name === "runAction").id });
    const node = { id: detail.function.id, functionId: detail.function.id, title: "runAction", subtitle: `${detail.function.file}:${detail.function.start.line}`, file: detail.function.file, start: detail.function.start };
    const html = await render(Vibe64UsageFunctionPanel, { node, detail });
    expect(html).toContain("Open source");
    expect(html).toMatch(/Calls \((exact|probable)\)|Called by \((exact|probable)\)/u);
    const withUnresolved = { ...detail, unresolved: [{ callee: "systemGraph[method](input)", start: { line: 4, column: 3 } }], totals: { ...detail.totals, unresolved: 1 } };
    expect(await render(Vibe64UsageFunctionPanel, { node, detail: withUnresolved })).toContain("Unresolved call: <code>systemGraph[method](input)</code>");
  });

  it("lists the zoomed web by depth with certainty, call counts and unresolved calls on a phone", async () => {
    const zoomed = callsWeb({ subsystemId: "directory:src" });
    const html = await render(Vibe64UsageWebCanvas, { mode: "calls", compact: true, zoomedId: "directory:src", subsystems: zoomed.subsystems, nodes: webNodes("calls", zoomed), edges: zoomed.edges });
    expect(html).toContain("Start");
    expect(html).toMatch(/calls \d+ → · called by \d+ ←/u);
    expect(html).not.toContain("Legend");
    const probable = { id: "fn:a", functionId: "fn:a", title: "handle", subtitle: "server/router.js:18", file: "server/router.js", start: { line: 18, column: 3 }, depth: 1, certainty: "probable", outCount: 2, inCount: 1, unresolved: 1 };
    const row = await render(Vibe64UsageWebCanvas, { mode: "calls", compact: true, zoomedId: "directory:server", subsystems: zoomed.subsystems, nodes: [probable] });
    expect(row).toContain("only via probable calls · calls 2 → · called by 1 ← · 1 unresolved call");
  });

  it("offers only the kinds present, with counts, and a refresh when empty", async () => {
    const entries = readEntries(index, {});
    const html = await render(Vibe64UsageEntryRail, { entries: entries.entries, kinds: entries.kinds });
    expect(html).toContain("Pages · 1");
    expect(html, "titles wrap between folders").toContain(">/<wbr>sessions<wbr></div>");
    expect(html).toContain("Library exports · 1");
    expect(html).not.toContain("Jobs ·");
    expect(await render(Vibe64UsageEntryRail, {})).toContain("No entry points found yet. Refresh the architecture scan.");
  });
});

describe("actions", () => {
  it("reads a selected function and opens source at its line with a way back to Usage", async () => {
    fake.usage = usageReads();
    const opened = vi.fn();
    const node = () => ({});
    const renderer = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
      patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    const state = usageState({ entry: PAGE, subsystem: "directory:src" });
    const app = renderer.createApp({ ...Vibe64UsageView, render: () => null }, { sessionId: "s1", state, "onOpen-source-file": opened });
    app.provide(ssrContextKey, { modules: new Set() });
    app.mount({});
    const view = app._instance.setupState;
    view.selectNode({ id: "fn:a", functionId: "fn:a", title: "a", file: "src/a.js", start: { line: 3, column: 1 } });
    expect(fake.usage.detail.run).toHaveBeenCalledWith("fn:a");
    view.openSource({ path: "src/a.js", line: 3, column: 1 });
    expect(opened).toHaveBeenCalledWith({ path: "src/a.js", line: 3, column: 1, presentation: "code", origin: "system", systemContext: { usage: state } });
    view.selectFunction({ id: "fn:b", name: "b", file: "src/b.js", start: { line: 9, column: 2 } });
    expect(view.selected).toMatchObject({ functionId: "fn:b", title: "b", subtitle: "src/b.js:9" });
    app.unmount();
  });
});

describe("Architecture keeps Usage in the address", () => {
  let app;
  vi.stubGlobal("requestAnimationFrame", (callback) => setTimeout(callback, 0));
  vi.stubGlobal("cancelAnimationFrame", (handle) => clearTimeout(handle));
  afterEach(() => { app?.unmount(); app = null; });

  async function mountArchitecture(path, props = {}) {
    fake.graph = { architecture: ref(null), error: ref(""), loading: ref(false), refreshing: ref(false), refreshProgress: ref(null), refreshOutput: ref(""), refresh: vi.fn(), reload: vi.fn(), cancelRefresh: vi.fn() };
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }] });
    await router.push(path);
    const node = () => ({});
    const renderer = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
      patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    app = renderer.createApp({ ...Vibe64UiStoryboardView, render: () => null }, { sessionId: "s1", ...props });
    app.provide(ssrContextKey, { modules: new Set() });
    app.use(router);
    app.mount({});
    await nextTick();
    await router.isReady();
    return { state: app._instance.setupState, router };
  }

  it("restores Usage from the address on reload and writes changes back", async () => {
    const { state, router } = await mountArchitecture(`/app/demo/dashboard/system?tab=keep&view=usage&mode=imports&entry=${encodeURIComponent(PAGE)}&subsystem=directory:src`);
    expect(state.usageState).toEqual(usageState({ mode: "imports", entry: PAGE, subsystem: "directory:src" }));
    expect(state.usageMounted).toBe(true);
    state.usageState = usageState({ mode: "calls", entry: PAGE });
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ tab: "keep", view: "usage", mode: "calls", entry: PAGE }));
    state.setArchitectureView("map");
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ tab: "keep" }));
    state.setArchitectureView("usage");
    expect(state.usageState).toEqual(usageState({ mode: "calls", entry: PAGE }));
  });

  it("opens the requested recording, and a source-viewer return restores where Usage was", async () => {
    const opened = await mountArchitecture("/app/demo/dashboard/system", { usageOpenRequest: { view: "usage", mode: "recording", recordingId, requestId: "r_000004", nonce: 1 } });
    expect(opened.state.usageState).toEqual(usageState({ mode: "recording", recording: recordingId, request: "r_000004" }));
    await vi.waitFor(() => expect(opened.router.currentRoute.value.query).toEqual({ view: "usage", mode: "recording", recording: recordingId, request: "r_000004" }));
    app.unmount();
    const restored = await mountArchitecture("/app/demo/dashboard/system", { restoreRequest: { usage: { mode: "calls", entry: PAGE, subsystem: "directory:src" }, sequence: 1 } });
    expect(restored.state.usageState).toEqual(usageState({ mode: "calls", entry: PAGE, subsystem: "directory:src" }));
  });

  it("opens Usage from Map's Show usage with a search for that file", async () => {
    const { state } = await mountArchitecture("/app/demo/dashboard/system");
    expect(state.usageState.view).toBe("map");
    state.showUsage({ q: "src/pages/SessionsPage.vue" });
    expect(state.usageState).toEqual(usageState({}));
    expect(state.usageFind).toEqual({ q: "src/pages/SessionsPage.vue", kind: "" });
  });
});
