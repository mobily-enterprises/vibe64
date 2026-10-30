import fs from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import { createRenderer, defineComponent, h, markRaw, ssrContextKey } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { mdiStop } from "@mdi/js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import current from "../fixtures/usage-map/recording/api/current.json" with { type: "json" };

const harness = vi.hoisted(() => ({ width: null, reports: [] }));
vi.mock("vuetify", async () => {
  const { ref } = await import("vue");
  harness.width = ref(1024);
  return { useDisplay: () => ({ width: harness.width }) };
});
vi.mock("vuetify/components/VMenu", () => ({ VMenu: overlay("menu") }));
vi.mock("vuetify/components/VBottomSheet", () => ({ VBottomSheet: overlay("bottom-sheet") }));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => ({ report: (entry) => harness.reports.push(entry) }) }));
vi.mock("/src/composables/useVibe64ProjectScope.js", async () => {
  const { ref } = await import("vue");
  return { useVibe64ProjectSlug: () => ref("fixture") };
});
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({ api: (suffix) => `/api/projects/fixture${suffix}` })
}));
import Indicator from "../../packages/vibe64-usage-recording/src/client/Vibe64UsageRecordingIndicator.vue";

function overlay(kind) {
  return defineComponent({
    props: { modelValue: Boolean },
    emits: ["update:modelValue"],
    setup(props, { emit, slots }) {
      return () => h("div", { "data-kind": kind }, [
        slots.activator?.({ props: { onClick: () => emit("update:modelValue", !props.modelValue) } }),
        props.modelValue ? h("div", { "data-kind": `${kind}-content` }, slots.default?.()) : null
      ]);
    }
  });
}

// The header indicator rendered as a client tree, so container width and clicks
// are real. Nodes stay raw, as DOM elements do inside template refs.
const source = parse(fs.readFileSync(Indicator.__file, "utf8"), { filename: Indicator.__file }).descriptor;
Indicator.render = new Function("Vue", compile(source.template.content, {
  bindingMetadata: compileScript(source, { id: "usage-recording-indicator-test" }).bindings,
  mode: "function",
  prefixIdentifiers: true
}).code)(VueRuntime);

const renderer = createRenderer({
  createComment: (text) => ({ type: "comment", text, children: [] }),
  createElement: (type) => markRaw({ type, props: {}, children: [], parentElement: null }),
  createText: (text) => ({ type: "text", text, children: [] }),
  insert(child, parent, anchor = null) {
    child.parentElement = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  },
  nextSibling(node) {
    const siblings = node.parentElement?.children || [];
    return siblings[siblings.indexOf(node) + 1] || null;
  },
  parentNode: (node) => node.parentElement,
  patchProp(element, key, _previous, value) { element.props[key] = value; },
  remove(child) {
    const siblings = child.parentElement?.children || [];
    if (siblings.includes(child)) siblings.splice(siblings.indexOf(child), 1);
  },
  setElementText(element, text) { element.children = [{ type: "text", text, children: [] }]; },
  setText(node, text) { node.text = text; }
});
const passthrough = (element) => defineComponent({
  inheritAttrs: false,
  setup: (_props, { attrs, slots }) => () => h(element, attrs, [attrs.title, slots.default?.()])
});
const COMPONENTS = {
  VBtn: passthrough("button"),
  VCard: passthrough("section"),
  VCardActions: passthrough("footer"),
  VCardText: passthrough("div"),
  VCardTitle: passthrough("header"),
  VDialog: defineComponent({ setup: (_props, { attrs, slots }) => () => h("div", { "data-kind": "dialog" }, attrs.modelValue ? slots.default?.() : []) }),
  VIcon: defineComponent({ setup: () => () => h("i") }),
  VProgressCircular: defineComponent({ setup: () => () => h("span", { "data-kind": "progress" }) })
};

const BASE = "/api/projects/fixture/vibe64/usage-recordings/sessions/session-fixture";
const NOW = Date.parse("2026-10-30T10:02:14.000Z");
const STARTED = { ...current.recording, startedAt: "2026-10-30T10:00:00.000Z", stoppedAt: null, stopReason: null,
  counts: { requests: 37, functions: 40 } };
const STATES = {
  starting: { ...STARTED, state: "starting", counts: { requests: 0, functions: 0 } },
  recording: { ...STARTED, state: "recording" },
  stopping: { ...STARTED, state: "stopping" },
  stopped: { ...STARTED, state: "stopped", stoppedAt: "2026-10-30T10:02:14.000Z", stopReason: "person" },
  failed: { ...STARTED, state: "failed", stoppedAt: "2026-10-30T10:00:01.000Z", stopReason: "error", counts: { requests: 0, functions: 0 },
    tracers: [{ runtime: "nodejs", state: "failed",
      reason: "The application did not load the recorder. This Output target may not run a supported runtime directly." }] },
  unavailable: { ...STARTED, state: "unavailable", stoppedAt: "2026-10-30T10:00:00.000Z", counts: { requests: 0, functions: 0 },
    tracers: [{ runtime: "nodejs", state: "unavailable", reason: "" }] }
};

const originalClient = getHttpWebClient();
const mounted = [];
let server;
let observers;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  harness.reports = [];
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  server = { current: null, requests: [], routes: {} };
  configureHttpWebClient({
    request(path, options = {}) {
      const route = `${options.method} ${path.replace(BASE, "")}`;
      server.requests.push(route);
      if (route === "GET /current") return Promise.resolve({ recording: server.current, serverTime: new Date().toISOString() });
      const response = server.routes[route];
      return response ? Promise.resolve(response()) : Promise.reject(Object.assign(new Error("Not found."), { status: 404 }));
    }
  });
});
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  configureHttpWebClient(originalClient);
  delete globalThis.ResizeObserver;
  vi.useRealTimers();
});

async function mountIndicator({ recording = null, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }) } = {}) {
  server.current = recording;
  const listeners = new Map();
  const host = markRaw({ type: "div", props: {}, children: [], parentElement: null });
  const opened = [];
  const app = renderer.createApp(Indicator, { sessionId: "session-fixture", onOpenUsage: (payload) => opened.push(payload) });
  for (const [name, component] of Object.entries(COMPONENTS)) app.component(name, component);
  app.use(VueQueryPlugin, { queryClient });
  app.provide("jskit.realtime.runtime.client.socket", {
    on(event, listener) { listeners.set(event, [...listeners.get(event) || [], listener]); },
    off(event, listener) { listeners.set(event, (listeners.get(event) || []).filter((entry) => entry !== listener)); }
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.config.warnHandler = () => {};
  app.mount(host);
  mounted.push(app);
  await vi.advanceTimersByTimeAsync(0);
  const view = {
    app,
    host,
    opened,
    queryClient,
    nodes: (predicate) => collect(host).filter(predicate),
    text: (className) => textOf(view.nodes((node) => String(node.props?.class || "").split(" ").includes(className))[0]).trim(),
    pill: () => view.text("usage-recording-indicator__text"),
    live: () => textOf(view.nodes((node) => node.props?.role === "status")[0]),
    button: (name) => view.nodes((node) => node.type === "button")
      .find((node) => node.props["aria-label"] === name || textOf(node).trim() === name),
    async click(name) {
      const target = view.button(name);
      if (!target) throw new Error(`No ${name} button in: ${textOf(host)}`);
      target.props.onClick();
      await vi.advanceTimersByTimeAsync(0);
    },
    async emit(event, payload) {
      for (const listener of listeners.get(event) || []) listener(payload);
      await vi.advanceTimersByTimeAsync(0);
    },
    async resize(width) {
      observers.at(-1).callback([{ contentRect: { width } }]);
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  return view;
}

function collect(node) {
  return [node, ...(node.children || []).flatMap(collect)];
}

function textOf(node) {
  if (!node) return "";
  return node.type === "text" ? node.text : (node.children || []).map(textOf).join("");
}

const changed = (payload) => ({ projectSlug: "fixture", sessionId: "session-fixture", recordingId: STARTED.id, ...payload });

it.each([
  ["starting", "Starting recording…", ["Stop recording"]],
  ["recording", "Recording 2:14 · 37 requests", ["Stop recording"]],
  ["stopping", "Stopping…", ["Stop recording"]],
  ["stopped", "Recording ready · 37 requests", ["Open", "Dismiss recording"]],
  ["failed", "Recording failed", ["Details", "Dismiss recording"]],
  ["unavailable", "Recording failed", ["Details", "Dismiss recording"]]
])("renders the %s state in a wide header", async (state, text, actions) => {
  const view = await mountIndicator({ recording: STATES[state] });
  expect(view.pill()).toBe(text);
  for (const action of actions) expect(view.button(action), action).toBeTruthy();
  expect(view.nodes((node) => node.props?.["data-kind"] === "progress")).toHaveLength(["starting", "stopping"].includes(state) ? 1 : 0);
  expect(view.nodes((node) => node.props?.class === "usage-recording-indicator__dot")).toHaveLength(state === "recording" ? 1 : 0);
  // The word is always there, even when the visible text is short.
  expect(textOf(view.host)).toContain("Recording");
  if (state === "recording") {
    expect(view.button("Stop recording").props["prepend-icon"]).toBe(mdiStop);
    expect(view.button("Stop recording").props.variant).toBe("tonal");
  }
});

it("shows nothing without a recording, and the failure reason under Details", async () => {
  const none = await mountIndicator();
  expect(none.nodes((node) => node.type === "button")).toEqual([]);
  expect(textOf(none.host)).toBe("");

  const failed = await mountIndicator({ recording: STATES.failed });
  expect(textOf(failed.host)).not.toContain("did not load the recorder");
  await failed.click("Details");
  expect(textOf(failed.host)).toContain(
    "The application did not load the recorder. This Output target may not run a supported runtime directly.");
  const unavailable = await mountIndicator({ recording: STATES.unavailable });
  await unavailable.click("Details");
  expect(textOf(unavailable.host)).toContain("The recording could not start.");
});

it("switches between wide and compact by the width of its header host", async () => {
  const view = await mountIndicator({ recording: STATES.recording });
  expect(observers.at(-1).target === view.host).toBe(true);
  await view.resize(339);
  expect(view.pill()).toBe("2:14 · 37");
  expect(view.button("Stop recording").props.icon).toBe(mdiStop);
  expect(textOf(view.button("Stop recording"))).toBe("");
  expect(textOf(view.host)).toContain("Recording");
  await view.resize(340);
  expect(view.pill()).toBe("Recording 2:14 · 37 requests");

  const ready = await mountIndicator({ recording: STATES.stopped });
  await ready.resize(200);
  expect(ready.pill()).toBe("Ready · 37");
  expect(ready.button("Open results")).toBeTruthy();
  expect(ready.button("Dismiss recording")).toBeTruthy();
  const starting = await mountIndicator({ recording: STATES.starting });
  await starting.resize(200);
  expect(starting.pill()).toBe("Starting…");
  ready.app.unmount();
  mounted.splice(mounted.indexOf(ready.app), 1);
  expect(observers.find((observer) => observer.target === ready.host)?.disconnected).toBe(true);
});

it("formats elapsed time as m:ss, then h:mm:ss from one hour", async () => {
  const view = await mountIndicator({ recording: { ...STATES.recording, startedAt: "2026-10-30T10:02:05.000Z" } });
  expect(view.pill()).toBe("Recording 0:09 · 37 requests");
  await vi.advanceTimersByTimeAsync(3000);
  expect(view.pill()).toBe("Recording 0:12 · 37 requests");
  const long = await mountIndicator({ recording: { ...STATES.recording, startedAt: new Date(Date.now() - 3_723_000).toISOString() } });
  expect(long.pill()).toBe("Recording 1:02:03 · 37 requests");
});

it("says Stopping… until the server confirms, with Stop still sending the stop", async () => {
  const stopping = { ...STATES.recording, state: "stopping" };
  server.routes[`POST /${STARTED.id}/stop`] = () => ({ recording: stopping });
  const view = await mountIndicator({ recording: STATES.recording });
  await view.click("Stop recording");
  expect(view.pill()).toBe("Stopping…");
  expect(view.button("Stop recording").props.disabled).toBeFalsy();
  await view.click("Stop recording");
  expect(server.requests.filter((route) => route.endsWith("/stop"))).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(view.pill()).toBe("Stopping…");

  server.current = STATES.stopped;
  await view.emit("vibe64.usage-recording.changed", changed({ state: "stopped", stoppedAt: STATES.stopped.stoppedAt }));
  expect(view.pill()).toBe("Recording ready · 37 requests");
});

it("keeps a dismissed recording dismissed across remounts", async () => {
  const dismissed = { ...STATES.stopped, dismissedAt: new Date(NOW).toISOString() };
  server.routes[`POST /${STARTED.id}/dismiss`] = () => ({ recording: dismissed });
  const view = await mountIndicator({ recording: STATES.stopped });
  await view.click("Dismiss recording");
  expect(view.nodes((node) => node.type === "button")).toEqual([]);

  // Remounted with the same page cache, and after a reload that reads it again.
  view.app.unmount();
  mounted.splice(mounted.indexOf(view.app), 1);
  const again = await mountIndicator({ recording: dismissed, queryClient: view.queryClient });
  expect(again.nodes((node) => node.type === "button")).toEqual([]);
  const reloaded = await mountIndicator({ recording: dismissed });
  expect(reloaded.nodes((node) => node.type === "button")).toEqual([]);
  expect(server.requests.filter((route) => route === "GET /current")).toHaveLength(2);
});

it("opens results from the pill and its menu, dismissing a stopped recording", async () => {
  server.routes[`POST /${STARTED.id}/dismiss`] = () => ({ recording: { ...STATES.stopped, dismissedAt: new Date(NOW).toISOString() } });
  const live = await mountIndicator({ recording: STATES.recording });
  const body = live.nodes((node) => node.props?.class === "usage-recording-indicator__body")[0];
  body.props.onClick();
  await vi.advanceTimersByTimeAsync(0);
  expect(live.nodes((node) => node.props?.["data-kind"] === "menu-content")).toHaveLength(1);
  expect(textOf(live.host)).toContain("Preview");
  expect(textOf(live.host)).toContain("2:14 · 37 requests");
  expect(live.button("Stop recording")).toBeTruthy();
  await live.click("Open results");
  expect(live.opened).toEqual([{ recordingId: STARTED.id }]);
  expect(server.requests).not.toContain(`POST /${STARTED.id}/dismiss`);

  const ready = await mountIndicator({ recording: STATES.stopped });
  await ready.click("Open");
  expect(ready.opened).toEqual([{ recordingId: STARTED.id }]);
  expect(server.requests).toContain(`POST /${STARTED.id}/dismiss`);

  harness.width.value = 600;
  const phone = await mountIndicator({ recording: STATES.recording });
  expect(phone.nodes((node) => node.props?.["data-kind"] === "bottom-sheet")).toHaveLength(1);
  harness.width.value = 1024;
});

it("announces start, stop and failure in the live region, never the ticking time", async () => {
  const view = await mountIndicator({ recording: null });
  const heard = [];
  const listen = () => { if (view.live() !== heard.at(-1)) heard.push(view.live()); };
  listen();
  server.current = STATES.starting;
  await view.emit("vibe64.usage-recording.changed", changed({ state: "starting" }));
  listen();
  await view.emit("vibe64.usage-recording.changed", changed({ state: "recording", counts: { requests: 1, functions: 3 } }));
  listen();
  for (let second = 0; second < 3; second += 1) {
    await vi.advanceTimersByTimeAsync(1000);
    await view.emit("vibe64.usage-recording.changed", changed({ state: "recording", counts: { requests: 2 + second, functions: 3 } }));
    listen();
  }
  server.current = STATES.stopped;
  await view.emit("vibe64.usage-recording.changed", changed({ state: "stopped", stoppedAt: STATES.stopped.stoppedAt }));
  listen();
  server.current = { ...STATES.failed, id: "rec_secondrecording2abcd" };
  await view.emit("vibe64.usage-recording.changed", changed({ recordingId: "rec_secondrecording2abcd", state: "failed" }));
  listen();
  expect(heard).toEqual(["", "Recording started", "Recording stopped", "Recording failed"]);
});

it("reports a refused stop", async () => {
  server.routes[`POST /${STARTED.id}/stop`] = () => { throw Object.assign(new Error("Only the project owner can record."), { status: 403 }); };
  const view = await mountIndicator({ recording: STATES.recording });
  await view.click("Stop recording");
  expect(harness.reports).toEqual([expect.objectContaining({ message: "Only the project owner can record.", severity: "error" })]);
});
