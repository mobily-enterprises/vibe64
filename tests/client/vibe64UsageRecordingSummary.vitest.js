import fs from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import { createRenderer, defineComponent, h, markRaw, ref, ssrContextKey } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import current from "../fixtures/usage-map/recording/api/current.json" with { type: "json" };

vi.mock("/src/composables/useVibe64ProjectScope.js", async () => {
  const { ref: makeRef } = await import("vue");
  return { useVibe64ProjectSlug: () => makeRef("fixture") };
});
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({ api: (suffix) => `/api/projects/fixture${suffix}` })
}));
import Summary from "../../packages/vibe64-usage-recording/src/client/Vibe64UsageRecordingSummary.vue";

// The line under the usage view's Recording selector, rendered as a client tree.
const source = parse(fs.readFileSync(Summary.__file, "utf8"), { filename: Summary.__file }).descriptor;
Summary.render = new Function("Vue", compile(source.template.content, {
  bindingMetadata: compileScript(source, { id: "usage-recording-summary-test" }).bindings,
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
const COMPONENTS = {
  VAlert: passthrough("aside"),
  VBtn: passthrough("button"),
  VCard: passthrough("section"),
  VCardActions: passthrough("footer"),
  VCardText: passthrough("div"),
  VCardTitle: passthrough("header"),
  VDialog: defineComponent({
    props: { modelValue: Boolean },
    setup: (props, { slots }) => () => h("div", { "data-kind": "dialog" }, props.modelValue ? slots.default?.() : [])
  }),
  VSpacer: passthrough("span")
};

const BASE = "/api/projects/fixture/vibe64/usage-recordings/sessions/session-fixture";
const STOPPED = { ...current.recording, state: "stopped", stoppedAt: "2026-10-30T10:10:00.000Z", stopReason: "time-limit" };
const originalClient = getHttpWebClient();
let app;
let server;
beforeEach(() => {
  server = { requests: [], remove: () => Promise.resolve({ ok: true }) };
  configureHttpWebClient({
    request(path, options = {}) {
      server.requests.push(`${options.method} ${path.replace(BASE, "")}`);
      if (path.endsWith("/current")) return Promise.resolve({ recording: null, serverTime: new Date().toISOString() });
      return server.remove();
    }
  });
});
afterEach(() => {
  app?.unmount();
  app = null;
  configureHttpWebClient(originalClient);
});

const flush = async () => { for (let pass = 0; pass < 4; pass += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

async function mountSummary(recording) {
  const shown = ref(recording);
  const events = [];
  const host = markRaw({ type: "div", props: {}, children: [], parentElement: null });
  app = renderer.createApp(defineComponent({
    setup: () => () => h(Summary, {
      recording: shown.value,
      sessionId: "session-fixture",
      onDeleted: (payload) => events.push(["deleted", payload])
    })
  }));
  for (const [name, component] of Object.entries(COMPONENTS)) app.component(name, component);
  app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.config.warnHandler = () => {};
  app.mount(host);
  await flush();
  const nodes = (predicate) => collect(host).filter(predicate);
  const view = {
    events,
    shown,
    text: () => textOf(host).replace(/\s+/gu, " ").trim(),
    ended: () => textOf(nodes((node) => node.props?.class === "usage-recording-summary__ended")[0]),
    dialogOpen: () => nodes((node) => node.props?.["data-kind"] === "dialog")[0].children.length > 0,
    buttons: (name) => nodes((node) => node.type === "button" && textOf(node).trim() === name),
    async click(name, index = 0) {
      view.buttons(name)[index].props.onClick();
      await flush();
    }
  };
  return view;
}

function collect(node) {
  return [node, ...(node.children || []).flatMap(collect)];
}

function textOf(node) {
  return node.type === "text" ? node.text : (node.children || []).map(textOf).join("");
}

it.each([
  ["time-limit", "Stopped after 10 minutes"],
  ["request-limit", "Stopped at 2,000 requests"],
  ["person", "Stopped manually"],
  ["size-limit", "Stopped at its size limit"],
  ["target-exited", "Stopped when the command finished"],
  ["session-ended", "Stopped when the session ended"],
  ["error", "Stopped after an error"]
])("says in plain words that a recording stopped for %s", async (stopReason, text) => {
  const view = await mountSummary({ ...STOPPED, stopReason });
  expect(view.ended()).toBe(text);
});

it("says why a recording failed and says nothing while one runs", async () => {
  const failed = await mountSummary({ ...STOPPED, state: "unavailable", stopReason: "error",
    tracers: [{ runtime: "go", state: "unavailable", reason: "Recording not available for `go`" }] });
  expect(failed.ended()).toBe("Failed: Recording not available for `go`");
  failed.shown.value = { ...STOPPED, state: "recording", stoppedAt: null, stopReason: null };
  await flush();
  expect(failed.ended()).toBe("");
});

it("deletes the recording only after the confirmation, through the server's delete action", async () => {
  const view = await mountSummary(STOPPED);
  expect(view.dialogOpen()).toBe(false);
  await view.click("Delete");
  expect(view.dialogOpen()).toBe(true);
  expect(view.text()).toContain("Delete this recording?");
  expect(view.text()).toContain("Its requests and results are deleted. This can't be undone.");
  expect(view.text()).not.toContain("It stops first.");
  await view.click("Cancel");
  expect(view.dialogOpen()).toBe(false);
  expect(server.requests).not.toContain(`DELETE /${STOPPED.id}`);

  await view.click("Delete");
  await view.click("Delete", 1);
  expect(server.requests).toContain(`DELETE /${STOPPED.id}`);
  expect(view.events).toEqual([["deleted", { recordingId: STOPPED.id }]]);
  expect(view.dialogOpen()).toBe(false);
});

it("warns that a running recording stops first, and keeps the dialog open with a refusal", async () => {
  server.remove = () => Promise.reject(Object.assign(new Error("Only people who control this session can delete recordings."), { status: 403 }));
  const view = await mountSummary({ ...STOPPED, state: "recording", stoppedAt: null, stopReason: null });
  await view.click("Delete");
  expect(view.text()).toContain("It stops first. Its requests and results are deleted.");
  await view.click("Delete", 1);
  expect(view.dialogOpen()).toBe(true);
  expect(view.text()).toContain("Only people who control this session can delete recordings.");
  expect(view.events).toEqual([]);
});
