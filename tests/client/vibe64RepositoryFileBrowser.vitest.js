import { readFileSync } from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/studio/repository/Vibe64RepositoryDiff.vue", () => ({
  default: { render: () => Vue.h("div", { "data-test": "diff" }) }
}));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: { render: () => null } }));

import FileBrowser from "../../src/components/studio/repository/Vibe64RepositoryFileBrowser.vue";

const filename = new URL("../../src/components/studio/repository/Vibe64RepositoryFileBrowser.vue", import.meta.url).pathname;
const { descriptor } = parse(readFileSync(filename, "utf8"), { filename });
const script = compileScript(descriptor, { id: "repository-file-browser-test" });
FileBrowser.render = new Function("Vue", compile(descriptor.template.content, {
  bindingMetadata: script.bindings,
  mode: "function",
  prefixIdentifiers: true
}).code)(Vue);

const storageKey = "vibe64:repository-file-list-width";
let app;
let storage;
let resizeObserver;

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

async function mountBrowser(width = 1000) {
  const renderer = Vue.createRenderer({
    createElement: (type) => ({
      type, children: [], props: {}, clientWidth: width,
      focus: vi.fn(),
      setPointerCapture(pointerId) { this.pointerId = pointerId; },
      hasPointerCapture(pointerId) { return this.pointerId === pointerId; },
      releasePointerCapture() { this.pointerId = null; }
    }),
    createComment: (text) => ({ type: "comment", text, children: [], props: {} }),
    createText: (text) => ({ type: "text", text, children: [], props: {} }),
    insert(child, parent) { child.parent = parent; parent.children.push(child); },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1); },
    parentNode: (node) => node.parent,
    nextSibling: () => null,
    patchProp: (node, key, _previous, value) => { node.props[key] = value; },
    setElementText(node, text) { node.children = []; node.text = text; },
    setText: (node, text) => { node.text = text; }
  });
  const select = vi.fn();
  app = renderer.createApp(FileBrowser, {
    files: [{ path: "src/app.js", status: "M", added: 1, deleted: 0 }],
    selectedPath: "src/app.js",
    onSelect: select
  });
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  const root = { children: [] };
  app.mount(root);
  await Vue.nextTick();
  return {
    browser: root.children[0],
    separator: findNode(root, (node) => node.props?.role === "separator"),
    file: findNode(root, (node) => node.props?.["aria-current"] === "true"),
    diff: findNode(root, (node) => node.props?.["data-test"] === "diff"),
    select
  };
}

function pointer(separator, overrides = {}) {
  return { button: 0, pointerId: 1, clientX: 336, currentTarget: separator, preventDefault: vi.fn(), ...overrides };
}

beforeEach(() => {
  const values = new Map();
  storage = {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, value))
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      resizeObserver = this;
    }
  });
});

afterEach(() => {
  app?.unmount();
  app = null;
  vi.unstubAllGlobals();
});

describe("repository file divider", () => {
  it("drags with pointer capture, saves on completion and preserves file selection and diff", async () => {
    const view = await mountBrowser();
    view.separator.props.onPointerdown(pointer(view.separator));
    expect(view.separator.pointerId).toBe(1);
    view.separator.props.onPointermove(pointer(view.separator, { pointerId: 2, clientX: 460 }));
    await Vue.nextTick();
    expect(view.separator.props["aria-valuenow"]).toBe(336);
    view.separator.props.onPointermove(pointer(view.separator, { clientX: 460 }));
    await Vue.nextTick();
    expect(view.browser.props.style["--repository-file-list-width"]).toBe("460px");
    expect(storage.setItem).not.toHaveBeenCalled();
    view.separator.props.onPointerup(pointer(view.separator, { clientX: 460 }));
    expect(view.separator.pointerId).toBeNull();
    expect(storage.getItem(storageKey)).toBe("460");
    view.file.props.onClick();
    expect(view.select).toHaveBeenCalledWith(expect.objectContaining({ path: "src/app.js" }));
    expect(findNode(view.browser, (node) => node.props?.["data-test"] === "diff")).toBe(view.diff);
    app.unmount();
    app = null;
    expect((await mountBrowser()).separator.props["aria-valuenow"]).toBe(460);
  });

  it("supports keyboard bounds without consuming unrelated keys", async () => {
    const { separator } = await mountBrowser(600);
    expect(separator.props["aria-valuemax"]).toBe(308);
    for (const [key, expected] of [["Home", 160], ["ArrowRight", 176], ["ArrowLeft", 160], ["End", 308]]) {
      const event = { key, preventDefault: vi.fn() };
      separator.props.onKeydown(event);
      await Vue.nextTick();
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(separator.props["aria-valuenow"]).toBe(expected);
      expect(storage.getItem(storageKey)).toBe(String(expected));
    }
    const tab = { key: "Tab", preventDefault: vi.fn() };
    separator.props.onKeydown(tab);
    expect(tab.preventDefault).not.toHaveBeenCalled();
  });

  it("keeps the preferred width when the pane temporarily narrows or stacks", async () => {
    storage.setItem(storageKey, "460");
    const { browser, separator } = await mountBrowser();
    browser.clientWidth = 520;
    resizeObserver.callback();
    await Vue.nextTick();
    expect(separator.props["aria-valuenow"]).toBe(228);
    browser.clientWidth = 400;
    resizeObserver.callback();
    await Vue.nextTick();
    expect(browser.props.class).toContain("vibe64-repository-file-browser--stacked");
    browser.clientWidth = 1000;
    resizeObserver.callback();
    await Vue.nextTick();
    expect(browser.props.class).not.toContain("vibe64-repository-file-browser--stacked");
    expect(separator.props["aria-valuenow"]).toBe(460);
    expect(storage.getItem(storageKey)).toBe("460");
  });

  it.each([["\"900\"", 336], ["null", 336], ["invalid", 336], ["900", 480], ["0", 160]])(
    "safely restores stored width %s", async (saved, expected) => {
      storage.setItem(storageKey, saved);
      expect((await mountBrowser()).separator.props["aria-valuenow"]).toBe(expected);
    }
  );

  it("ends capture and disconnects observation when a dragging pane closes", async () => {
    const { separator } = await mountBrowser();
    separator.props.onPointerdown(pointer(separator, { pointerType: "touch" }));
    separator.props.onPointermove(pointer(separator, { clientX: 999 }));
    app.unmount();
    app = null;
    expect(separator.pointerId).toBeNull();
    expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
    expect(storage.getItem(storageKey)).toBe("480");
  });
});
