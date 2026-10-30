import fs from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import { createRenderer, defineComponent, h, markRaw, ref, ssrContextKey } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import fixtureTargets from "../fixtures/usage-map/recording/api/targets.json" with { type: "json" };
import current from "../fixtures/usage-map/recording/api/current.json" with { type: "json" };

const harness = vi.hoisted(() => ({ width: null }));
vi.mock("vuetify", async () => {
  const { ref: makeRef } = await import("vue");
  harness.width = makeRef(1024);
  return { useDisplay: () => ({ width: harness.width }) };
});
vi.mock("/src/composables/useVibe64ProjectScope.js", async () => {
  const { ref: makeRef } = await import("vue");
  return { useVibe64ProjectSlug: () => makeRef("fixture") };
});
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({ api: (suffix) => `/api/projects/fixture${suffix}` })
}));
import RecordDialog from "../../packages/vibe64-usage-recording/src/client/Vibe64UsageRecordDialog.vue";

// The dialog rendered as a client tree, so fields, radios and buttons can be used.
const source = parse(fs.readFileSync(RecordDialog.__file, "utf8"), { filename: RecordDialog.__file }).descriptor;
RecordDialog.render = new Function("Vue", compile(source.template.content, {
  bindingMetadata: compileScript(source, { id: "usage-record-dialog-test" }).bindings,
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
  setup: (_props, { attrs, slots }) => () => h(element, attrs, slots.default?.())
});
const shownWhenOpen = (kind) => defineComponent({
  props: { fullscreen: Boolean, modelValue: Boolean },
  setup: (props, { slots }) => () => h("div", { "data-kind": kind, fullscreen: props.fullscreen },
    props.modelValue ? [slots.default?.(), slots.actions?.()] : [])
});
const COMPONENTS = {
  VAlert: passthrough("aside"),
  VBtn: passthrough("button"),
  VCard: passthrough("section"),
  VCardActions: passthrough("footer"),
  VCardText: passthrough("div"),
  VCardTitle: passthrough("header"),
  VDialog: shownWhenOpen("dialog"),
  VProgressLinear: passthrough("progress"),
  VRadio: defineComponent({ inheritAttrs: false, setup: (_props, { attrs }) => () => h("label", { "data-kind": "radio", ...attrs }, attrs.label) }),
  VRadioGroup: defineComponent({ inheritAttrs: false, setup: (_props, { attrs, slots }) => () => h("div", { "data-kind": "radio-group", ...attrs }, slots.default?.()) }),
  VSnackbar: shownWhenOpen("snackbar"),
  VSpacer: passthrough("span"),
  VTextField: defineComponent({ inheritAttrs: false, setup: (_props, { attrs }) => () => h("div", { "data-kind": "field", ...attrs },
    [attrs.label, " ", attrs["error-messages"] || ""]) })
};

const BASE = "/api/projects/fixture/vibe64/usage-recordings/sessions/session-fixture";
const SEED = { id: "output:seed", kind: "terminal", label: "Seed data", runtimes: ["nodejs"], available: true, reason: "",
  parameters: [{ id: "count", label: "Count", required: true }, { id: "note", label: "Note", required: false }] };
const TARGETS = [...fixtureTargets.targets, SEED];
const originalClient = getHttpWebClient();
let app;
let server;
beforeEach(() => {
  server = { requests: [], start: null, targets: TARGETS };
  configureHttpWebClient({
    request(path, options = {}) {
      server.requests.push({ route: `${options.method} ${path.replace(BASE, "")}`, body: options.body });
      if (path.endsWith("/current")) return Promise.resolve({ recording: null, serverTime: new Date().toISOString() });
      if (path.endsWith("/targets")) return Promise.resolve({ targets: server.targets });
      return server.start();
    }
  });
});
afterEach(() => {
  app?.unmount();
  app = null;
  configureHttpWebClient(originalClient);
  harness.width.value = 1024;
});

const flush = async () => { for (let pass = 0; pass < 4; pass += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

async function openDialog() {
  const open = ref(true);
  const events = [];
  const host = markRaw({ type: "div", props: {}, children: [], parentElement: null });
  app = renderer.createApp(defineComponent({
    setup: () => () => h(RecordDialog, {
      modelValue: open.value,
      sessionId: "session-fixture",
      "onUpdate:modelValue": (value) => { open.value = value; events.push(["update:modelValue", value]); },
      onStarted: (payload) => events.push(["started", payload]),
      onSelectPreview: () => events.push(["select-preview"])
    })
  }));
  for (const [name, component] of Object.entries(COMPONENTS)) app.component(name, component);
  app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.config.warnHandler = () => {};
  app.mount(host);
  await flush();
  const nodes = (predicate) => collect(host).filter(predicate);
  const kind = (name) => nodes((node) => node.props?.["data-kind"] === name);
  const view = {
    events,
    open,
    text: () => textOf(host).replace(/\s+/gu, " "),
    kind,
    radio: (label) => kind("radio").find((node) => node.props.label === label),
    field: (label) => kind("field").find((node) => String(node.props.label).startsWith(label)),
    async select(label) {
      kind("radio-group")[0].props["onUpdate:modelValue"](view.radio(label).props.value);
      await flush();
    },
    async type(label, value) {
      view.field(label).props["onUpdate:modelValue"](value);
      await flush();
    },
    button: (name) => nodes((node) => node.type === "button").find((node) => textOf(node).trim() === name),
    async click(name) {
      view.button(name).props.onClick();
      await flush();
    },
    starts: () => server.requests.filter((request) => request.route === "POST ")
  };
  return view;
}

function collect(node) {
  return [node, ...(node.children || []).flatMap(collect)];
}

function textOf(node) {
  return node.type === "text" ? node.text : (node.children || []).map(textOf).join("");
}

it("lists the session's targets with the privacy copy, disabling unavailable ones with their reason", async () => {
  const view = await openDialog();
  expect(server.requests.map((request) => request.route)).toContain("GET /targets");
  expect(view.text()).toContain("Record what runs");
  expect(view.text()).toContain(
    "Use your app while recording. Vibe64 saves which functions ran for each request, with its method, path and status, " +
    "and for each click the element's role, up to 40 characters of its text and its component file. Long ids and tokens " +
    "in paths are hidden. It never saves what you type, request contents, headers or cookies.");
  expect(view.text()).toContain("Stops automatically after 10 minutes or 2,000 requests.");
  expect(view.kind("radio").map((node) => [node.props.label, Boolean(node.props.disabled)])).toEqual([
    ["Preview (restarts Preview)", false],
    ["Run List sessions", false],
    ["Run Build docs", true],
    ["Run Seed data", false]
  ]);
  expect(view.text()).toContain("Recording not available for `go`");
  expect(view.kind("radio-group")[0].props.modelValue).toBe("preview");
  expect(view.button("Cancel")).toBeTruthy();
  expect(view.button("Start recording").props.disabled).toBe(false);
  expect(view.kind("dialog")[0].props.fullscreen).toBe(false);

  await view.click("Cancel");
  expect(view.events).toEqual([["update:modelValue", false]]);
});

it("shows only the selected target's parameter fields and validates them before starting", async () => {
  server.start = () => Promise.resolve({ recording: { ...current.recording, state: "starting", target: { id: SEED.id, kind: "terminal", label: SEED.label } } });
  const view = await openDialog();
  expect(view.kind("field")).toEqual([]);
  await view.select("Run Seed data");
  expect(view.kind("field").map((node) => node.props.label)).toEqual(["Count (required)", "Note"]);
  expect(view.text()).not.toContain("Count is required.");

  await view.click("Start recording");
  expect(view.text()).toContain("Count is required.");
  await view.type("Count", "5\n6");
  expect(view.text()).toContain("Count must be a single line.");
  await view.type("Count", "5");
  await view.type("Note", "x".repeat(4097));
  expect(view.text()).toContain("Note must be at most 4,096 characters.");
  await view.click("Start recording");
  expect(view.starts()).toEqual([]);

  await view.type("Note", "x".repeat(4096));
  expect(view.text()).not.toContain("must be");
  await view.type("Note", "");
  await view.click("Start recording");
  expect(view.starts()).toEqual([{ route: "POST ", body: { targetId: SEED.id, parameters: { count: "5" } } }]);
  expect(view.events.map(([name]) => name)).toEqual(["started", "update:modelValue"]);
  expect(view.events[0][1].recording.target.id).toBe(SEED.id);
  expect(view.kind("snackbar")[0].children.length).toBeGreaterThan(0);
  expect(view.text()).toContain("Recording — Seed data is running");
  expect(view.button("Go to Preview")).toBeUndefined();
});

it("points to Preview after starting a Preview recording", async () => {
  server.start = () => Promise.resolve({ recording: { ...current.recording, state: "starting" } });
  const view = await openDialog();
  await view.click("Start recording");
  expect(view.starts()).toEqual([{ route: "POST ", body: { targetId: "preview" } }]);
  expect(view.open.value).toBe(false);
  expect(view.text()).toContain("Recording — use Preview now");
  await view.click("Go to Preview");
  expect(view.events.at(-1)).toEqual(["select-preview"]);
  expect(view.kind("snackbar")[0].children).toEqual([]);
});

it("keeps the dialog open with the server's refusal shown verbatim", async () => {
  server.start = () => Promise.reject(Object.assign(new Error("Recording is paused while this computer is short of memory."), { status: 503 }));
  harness.width.value = 600;
  const view = await openDialog();
  expect(view.kind("dialog")[0].props.fullscreen).toBe(true);
  await view.click("Start recording");
  expect(view.text()).toContain("Recording is paused while this computer is short of memory.");
  expect(view.open.value).toBe(true);
  expect(view.events).toEqual([]);
});

it("says why there is nothing to record and offers Preview when the session has no targets", async () => {
  server.targets = [];
  const view = await openDialog();
  expect(view.kind("radio")).toEqual([]);
  expect(view.text()).toContain("Nothing to record yet");
  expect(view.text()).toContain("Open Preview, start the app there, then record.");
  expect(view.button("Start recording")).toBeUndefined();
  await view.click("Open Preview");
  expect(view.events).toEqual([["update:modelValue", false], ["select-preview"]]);
  expect(view.starts()).toEqual([]);
});

it("keeps the target list and its error, not the empty guidance, when targets cannot be read", async () => {
  server.targets = null;
  configureHttpWebClient({
    request(path) {
      if (path.endsWith("/current")) return Promise.resolve({ recording: null, serverTime: new Date().toISOString() });
      return Promise.reject(Object.assign(new Error("This session's Output targets cannot be read."), { status: 422 }));
    }
  });
  const view = await openDialog();
  expect(view.text()).toContain("This session's Output targets cannot be read.");
  expect(view.text()).not.toContain("Nothing to record yet");
  expect(view.button("Start recording").props.disabled).toBe(true);
});
