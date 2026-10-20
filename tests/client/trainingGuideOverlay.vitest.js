import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrainingGuideOverlay from "../../packages/vibe64-training/src/client/TrainingGuideOverlay.vue";
import { runTrainingGuideCommand, showTrainingGuide, trainingGuide } from "../../packages/vibe64-training/src/client/trainingGuide.js";
import { trainingGuideCommand, trainingGuideRequest } from "../../packages/vibe64-training/src/shared/guideTargets.js";

const overlayFile = path.resolve("packages/vibe64-training/src/client/TrainingGuideOverlay.vue");
{
  const { descriptor } = parse(fs.readFileSync(overlayFile, "utf8"), { filename: overlayFile });
  const script = compileScript(descriptor, { id: "training-guide-overlay" });
  TrainingGuideOverlay.render = new Function("Vue", compile(descriptor.template.content, {
    bindingMetadata: script.bindings, mode: "function", prefixIdentifiers: true
  }).code)(Vue);
}

// The teacher's guide rings one real Vibe64 control (by its data-vibe64-guide
// id), never takes input, and reports truthfully whether anything was drawn.

function control(attributes, rect = { top: 10, left: 20, width: 80, height: 24 }) {
  return { isConnected: true, attributes, rect, hidden: false,
    closest: () => null,
    getBoundingClientRect() { return this.hidden ? { top: 0, left: 0, width: 0, height: 0 } : this.rect; } };
}
function fakeDocument(controls) {
  const listeners = new Map();
  return { controls, listeners,
    querySelectorAll(selector) {
      const [, name, value] = selector.match(/^\[([a-z0-9-]+)="(.*)"\]$/u);
      return controls.filter(item => item.attributes[name] === value.replace(/\\(.)/gu, "$1"));
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); } };
}
function text(node) {
  return node.type === "text" ? node.text : (node.children || []).map(text).join("") + (node.text || "");
}
function find(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) find(child, predicate, found);
  return found;
}

const body = { type: "body", children: [], props: {} };
const renderer = Vue.createRenderer({
  createElement: type => ({ type, children: [], props: {}, parent: null }),
  createComment: value => ({ type: "comment", text: value, children: [], props: {} }),
  createText: value => ({ type: "text", text: value, children: [], props: {} }),
  insert(child, parent, anchor = null) {
    const previous = child.parent?.children?.indexOf(child) ?? -1;
    if (previous >= 0) child.parent.children.splice(previous, 1);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child);
  },
  remove(child) { const index = child.parent?.children?.indexOf(child) ?? -1; if (index >= 0) child.parent.children.splice(index, 1); },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  patchProp: (node, key, _previous, value) => { node.props[key] = value; },
  setElementText: (node, value) => { node.text = value; node.children = []; },
  setText: (node, value) => { node.text = value; },
  querySelector: selector => selector === "body" ? body : null
});
let app = null;
function mountOverlay() {
  app = renderer.createApp(TrainingGuideOverlay);
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  app.mount({ type: "root", children: [], props: {} });
}
const overlay = () => find(body, node => String(node.props.class || "").includes("training-guide-overlay") &&
  node.props["data-guide-step"])[0];
const erd = trainingGuideCommand(trainingGuideRequest({ target: "database-erd" }), { id: "one", attemptId: "attempt" }).guide;

let document;
beforeEach(() => {
  vi.useFakeTimers();
  document = fakeDocument([control({ "data-vibe64-guide": "dashboard" })]);
  vi.stubGlobal("document", document);
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  app?.unmount(); app = null;
  body.children.splice(0);
  trainingGuide.value = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("teacher guide overlay", () => {
  it("never claims a highlight without a mounted overlay or a visible real control", async () => {
    expect(await showTrainingGuide(erd)).toEqual({ shown: false, reason: "overlay-unavailable" });
    mountOverlay();
    expect(await showTrainingGuide({ ...erd, highlight: false })).toEqual({ shown: false, reason: "highlight-off" });
    document.controls[0].hidden = true; // e.g. the phone layout hides the Dashboard tab
    expect(await showTrainingGuide(erd)).toEqual({ shown: false, reason: "target-hidden" });
    await Vue.nextTick();
    expect(overlay()).toBeUndefined();
  });

  it("rings the next real control on the path with its caption, without taking input", async () => {
    mountOverlay();
    expect(await showTrainingGuide(erd)).toEqual({ shown: true, step: "dashboard" });
    await Vue.nextTick();
    const node = overlay();
    expect(node.props["data-guide-step"]).toBe("dashboard");
    expect(text(node).trim()).toBe("Dashboard → Database → ERD");
    const ring = find(node, child => child.props.class === "training-guide-overlay__ring")[0];
    expect(ring.props.style).toMatchObject({ top: "4px", left: "14px", width: "92px", height: "36px" });
    expect(String(node.props.class)).not.toContain("training-guide-overlay--still");

    // Once the learner reaches Database, the deepest visible step is the ERD toggle.
    document.controls.push(control({ "data-vibe64-guide": "database" }), control({ "data-vibe64-guide": "database-erd" }));
    expect(await showTrainingGuide(erd)).toEqual({ shown: true, step: "database-erd" });
  });

  it("on a phone with no path step visible, rings the header pane switch with the whole path's caption", async () => {
    mountOverlay();
    document.controls[0].hidden = true; // the phone header hides the Dashboard tab
    const chatToggle = control({ "data-vibe64-guide": "pane-switch" }, { top: 8, left: 8, width: 40, height: 40 });
    const nextPane = control({ "data-vibe64-guide": "pane-switch" }, { top: 8, left: 300, width: 80, height: 40 });
    document.controls.push(chatToggle, nextPane);
    expect(await showTrainingGuide(erd)).toEqual({ shown: true, step: "pane-switch" });
    await Vue.nextTick();
    const node = overlay();
    expect(node.props["data-guide-step"]).toBe("pane-switch");
    expect(text(node).trim()).toBe("Dashboard → Database → ERD");
    const ring = find(node, child => child.props.class === "training-guide-overlay__ring")[0];
    expect(ring.props.style).toMatchObject({ left: "294px", width: "92px" });

    // The same clearing rules apply: the first learner click clears it.
    document.listeners.get("pointerdown")({ type: "pointerdown" });
    await Vue.nextTick();
    expect(overlay()).toBeUndefined();

    // A visible path step always wins over the switch; no switch stays honest.
    document.controls[0].hidden = false;
    expect(await showTrainingGuide(erd)).toEqual({ shown: true, step: "dashboard" });
    document.controls[0].hidden = true;
    chatToggle.hidden = nextPane.hidden = true;
    expect(await showTrainingGuide(erd)).toEqual({ shown: false, reason: "target-hidden" });
  });

  it("on a phone already showing the place, rings its open pane instead of the pane switch", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    mountOverlay();
    const preview = trainingGuideCommand(trainingGuideRequest({ target: "preview" }), { id: "preview" }).guide;
    const previewTab = control({ "data-vibe64-guide": "preview" });
    const previewPane = control({ "data-vibe64-guide-pane": "preview" }, { top: 56, left: 0, width: 390, height: 788 });
    const nextPane = control({ "data-vibe64-guide": "pane-switch" }, { top: 8, left: 290, width: 92, height: 40 });
    previewTab.hidden = true; // the phone header hides the Preview tab
    document.controls.push(previewTab, previewPane, nextPane);
    expect(await showTrainingGuide(preview)).toEqual({ shown: true, step: "preview" });
    await Vue.nextTick();
    const node = overlay();
    expect(node.props["data-guide-step"]).toBe("preview");
    expect(trainingGuide.value.element).toBe(previewPane);
    // The pane fills the screen, so the caption sits inside its top edge.
    const caption = find(node, child => String(child.props.class || "").includes("training-guide-overlay__caption "))[0];
    expect(String(caption.props.class)).toContain("training-guide-overlay__caption--inside");
    expect(caption.props.style).toMatchObject({ top: "70px" });

    // A visible control for the same step wins over its pane (desktop tabs).
    previewTab.hidden = false;
    await showTrainingGuide(preview);
    expect(trainingGuide.value.element).toBe(previewTab);

    // With the Dashboard open instead, the Preview pane is hidden: the switch is next.
    previewTab.hidden = previewPane.hidden = true;
    expect(await showTrainingGuide(preview)).toEqual({ shown: true, step: "pane-switch" });
    expect(trainingGuide.value.element).toBe(nextPane);
  });

  it("on a phone, rings the Dashboard section select, then the open section's pane", async () => {
    mountOverlay();
    document.controls[0].hidden = true; // the phone header hides the Dashboard tab
    const files = trainingGuideCommand(trainingGuideRequest({ target: "files" }), { id: "files" }).guide;
    const sectionSelect = control({ "data-vibe64-guide-pane": "dashboard" });
    const nextPane = control({ "data-vibe64-guide": "pane-switch" }, { top: 8, left: 290, width: 92, height: 40 });
    document.controls.push(sectionSelect, nextPane);
    expect(await showTrainingGuide(files)).toEqual({ shown: true, step: "dashboard" });
    expect(trainingGuide.value.element).toBe(sectionSelect);
    expect(trainingGuide.value.caption).toBe("Dashboard → Files");

    // Files open: the Dashboard select is gone and its pane is the target.
    sectionSelect.hidden = true;
    const filesPane = control({ "data-vibe64-guide-pane": "files" }, { top: 56, left: 0, width: 390, height: 600 });
    document.controls.push(filesPane);
    expect(await showTrainingGuide(files)).toEqual({ shown: true, step: "files" });
    expect(trainingGuide.value.element).toBe(filesPane);
  });

  it("on a phone with a standalone tool pane open, rings its Dashboard back button for another place", async () => {
    mountOverlay();
    document.controls[0].hidden = true; // the phone header hides the Dashboard tab
    // Files fills the pane: the Dashboard shell and its section select are hidden.
    const sectionSelect = control({ "data-vibe64-guide-pane": "dashboard" });
    sectionSelect.hidden = true;
    const filesPane = control({ "data-vibe64-guide-pane": "files" }, { top: 56, left: 0, width: 390, height: 600 });
    const backButton = control({ "data-vibe64-guide-pane": "dashboard" }, { top: 60, left: 8, width: 170, height: 40 });
    const nextPane = control({ "data-vibe64-guide": "pane-switch" }, { top: 8, left: 290, width: 92, height: 40 });
    document.controls.push(sectionSelect, filesPane, backButton, nextPane);
    for (const target of ["git-log", "database-erd"]) {
      const guide = trainingGuideCommand(trainingGuideRequest({ target }), { id: target }).guide;
      expect(await showTrainingGuide(guide)).toEqual({ shown: true, step: "dashboard" });
      expect(trainingGuide.value.element).toBe(backButton);
    }
    // The open place itself still wins over its back button.
    const files = trainingGuideCommand(trainingGuideRequest({ target: "files" }), { id: "files" }).guide;
    expect(await showTrainingGuide(files)).toEqual({ shown: true, step: "files" });
    expect(trainingGuide.value.element).toBe(filesPane);
  });

  it("clears after its time limit", async () => {
    mountOverlay();
    await showTrainingGuide(erd);
    await Vue.nextTick();
    expect(overlay()).toBeDefined();
    vi.advanceTimersByTime(7999);
    expect(trainingGuide.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    await Vue.nextTick();
    expect(trainingGuide.value).toBeNull();
    expect(overlay()).toBeUndefined();
  });

  it("clears on the learner's first click", async () => {
    mountOverlay();
    await showTrainingGuide(erd);
    await Vue.nextTick();
    document.listeners.get("pointerdown")({ type: "pointerdown" });
    await Vue.nextTick();
    expect(trainingGuide.value).toBeNull();
    expect(overlay()).toBeUndefined();
    expect(document.listeners.has("pointerdown")).toBe(false);
  });

  it("holds the ring still for reduced motion", async () => {
    vi.stubGlobal("matchMedia", query => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    mountOverlay();
    await showTrainingGuide(erd);
    await Vue.nextTick();
    expect(String(overlay().props.class)).toContain("training-guide-overlay--still");
  });
});

describe("teacher guide commands in the Main browser", () => {
  it("points without navigating, and shows me by navigating first and opening a lesson file", async () => {
    mountOverlay();
    const navigateBrowser = vi.fn(async () => ({ pane: "files" }));
    const pointed = trainingGuideCommand(trainingGuideRequest({ target: "files", filePath: "src/app.js" }),
      { id: "point", projectSlug: "practice", sessionId: "session", attemptId: "attempt" });
    expect(await runTrainingGuideCommand(pointed, { navigateBrowser })).toEqual({ guide: { shown: true, step: "dashboard" } });
    expect(navigateBrowser).not.toHaveBeenCalled();

    const shown = trainingGuideCommand(trainingGuideRequest({ target: "files", filePath: "src/app.js", navigate: true }),
      { id: "show", projectSlug: "practice", sessionId: "session", attemptId: "attempt" });
    const view = { openFile: vi.fn(path => {
      document.controls.push(control({ "data-vibe64-guide": "files" }), control({ "data-vibe64-guide-path": path }));
      return true;
    }) };
    expect(await runTrainingGuideCommand(shown, { navigateBrowser, view }))
      .toEqual({ focus: { pane: "files" }, guide: { shown: true, step: "file" } });
    const { guide, ...navigation } = shown;
    expect(navigateBrowser).toHaveBeenCalledWith(navigation);
    expect(view.openFile).toHaveBeenCalledWith("src/app.js");

    await expect(runTrainingGuideCommand(shown, { navigateBrowser, view: { openFile: () => false } }))
      .rejects.toThrow(/could not open that practice project file/u);
    await expect(runTrainingGuideCommand(shown, {})).rejects.toThrow(/navigation is unavailable/u);
    expect(guide.caption).toBe("Dashboard → Files → src/app.js");
  });
});

describe("Learning v2 guide commands", () => {
  it("opens real places, and opens Learning for its button", () => {
    expect(trainingGuideCommand(trainingGuideRequest({ target: "database-data", navigate: true }), { id: "data", projectSlug: "alpha", sessionId: "one" }))
      .toEqual({ id: "data", projectSlug: "alpha", sessionId: "one", conversationId: "", pane: "database", databaseView: "data", status: "pending",
        guide: { target: "database-data", navigate: true, highlight: true, caption: "Dashboard → Database → Data",
          steps: [{ id: "dashboard", label: "Dashboard" }, { id: "database", label: "Database" }, { id: "database-data", label: "Data" }] } });
    expect(trainingGuideCommand(trainingGuideRequest({ target: "learning", navigate: true, highlight: false }), { id: "open" }))
      .toEqual({ id: "open", learning: { open: true }, status: "pending" });
    expect(trainingGuideCommand(trainingGuideRequest({ target: "learning", caption: "Your lessons live here" }), { id: "point" }))
      .toEqual({ id: "point", status: "pending", guide: { target: "learning", navigate: false, highlight: true,
        caption: "Your lessons live here", steps: [{ id: "learning", label: "Learning" }] } });
  });

  it("bounds a lesson caption", () => {
    expect(trainingGuideRequest({ target: "preview", caption: "  Your app runs here " }).caption).toBe("Your app runs here");
    for (const caption of ["", "   ", "x".repeat(257), 7]) {
      expect(() => trainingGuideRequest({ target: "preview", caption })).toThrow(/caption of 1 to 256/u);
    }
  });

  it("shows the lesson caption on the ring", async () => {
    mountOverlay();
    const guide = trainingGuideCommand(trainingGuideRequest({ target: "dashboard", caption: "Start here" }), { id: "caption" }).guide;
    expect(await showTrainingGuide(guide)).toEqual({ shown: true, step: "dashboard" });
    expect(trainingGuide.value.caption).toBe("Start here");
  });
});
