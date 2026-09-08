import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  ssrContextKey
} from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VChip", () => ({
  VChip: passthroughComponent("span")
}));

vi.mock("vuetify/components/VSheet", () => ({
  VSheet: passthroughComponent("section")
}));

vi.mock("@/components/studio/Vibe64Terminal.vue", async () => {
  const { defineComponent: defineVueComponent, h: render } = await import("vue");
  return {
    default: defineVueComponent({
      emits: ["close"],
      props: {
        status: {
          default: "",
          type: String
        },
        title: {
          default: "",
          type: String
        },
        visible: {
          default: false,
          type: Boolean
        }
      },
      setup(props, { emit }) {
        return () => props.visible
          ? render("section", { class: "fake-full-terminal" }, [
              render("strong", props.title),
              render("span", props.status),
              render("button", { onClick: () => emit("close") }, "Hide")
            ])
          : null;
      }
    })
  };
});

vi.mock("@/components/studio/StudioErrorNotice.vue", () => ({
  default: defineComponent({ render: () => null })
}));

import Vibe64LongRunningTerminal from "../../src/components/studio/Vibe64LongRunningTerminal.vue";
import Vibe64TemporaryActionTerminal from "../../src/components/studio/Vibe64TemporaryActionTerminal.vue";
import Vibe64TemporaryAiFixAction from "../../src/components/studio/Vibe64TemporaryAiFixAction.vue";
import Vibe64TerminalSurface from "../../src/components/studio/Vibe64TerminalSurface.vue";

for (const [component, componentPath, id] of [
  [
    Vibe64LongRunningTerminal,
    "src/components/studio/Vibe64LongRunningTerminal.vue",
    "vibe64-long-running-terminal-lifecycle-test"
  ],
  [
    Vibe64TemporaryActionTerminal,
    "src/components/studio/Vibe64TemporaryActionTerminal.vue",
    "vibe64-temporary-action-terminal-lifecycle-test"
  ],
  [
    Vibe64TemporaryAiFixAction,
    "src/components/studio/Vibe64TemporaryAiFixAction.vue",
    "vibe64-temporary-ai-fix-action-lifecycle-test"
  ],
  [
    Vibe64TerminalSurface,
    "src/components/studio/Vibe64TerminalSurface.vue",
    "vibe64-terminal-surface-lifecycle-test"
  ]
]) {
  const filename = path.resolve(componentPath);
  const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
  const script = compileScript(descriptor, { id });
  const template = compile(descriptor.template.content, {
    bindingMetadata: script.bindings,
    mode: "function",
    prefixIdentifiers: true
  });
  component.render = new Function("Vue", template.code)(VueRuntime);
}

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

const renderer = createRenderer({
  createComment: (text) => ({ children: [], props: {}, style: {}, text, type: "comment" }),
  createElement: (type) => ({ children: [], parent: null, props: {}, style: {}, type }),
  createText: (text) => ({ children: [], props: {}, style: {}, text, type: "text" }),
  insert(child, parent, anchor = null) {
    child.parent = parent;
    const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1;
    if (anchorIndex < 0) {
      parent.children.push(child);
    } else {
      parent.children.splice(anchorIndex, 0, child);
    }
  },
  nextSibling(node) {
    const index = node.parent?.children?.indexOf(node) ?? -1;
    return index >= 0 ? node.parent.children[index + 1] || null : null;
  },
  parentNode: (node) => node.parent,
  querySelector: () => null,
  patchProp(element, key, _previous, value) {
    element.props[key] = value;
  },
  remove(child) {
    const index = child.parent?.children?.indexOf(child) ?? -1;
    if (index >= 0) {
      child.parent.children.splice(index, 1);
    }
    child.parent = null;
  },
  setElementText(element, text) {
    element.text = text;
  },
  setText(node, text) {
    node.text = text;
  }
});

function mount(component) {
  const container = { children: [], parent: null, type: "root" };
  const app = renderer.createApp(component);
  app.component("VBtn", passthroughComponent("button"));
  app.component("VChip", passthroughComponent("span"));
  app.component("VSheet", passthroughComponent("section"));
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return { app, container };
}

function findNode(root, predicate) {
  if (predicate(root)) {
    return root;
  }
  for (const child of root.children || []) {
    const match = findNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

function hasClass(name) {
  return (node) => String(node.props?.class || "").includes(name);
}

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

describe("Vibe64 terminal lifecycle components", () => {
  it("dismisses early failures without a server operation and shows a later identical failure", async () => {
    const state = reactive({ active: false, error: "The assistant is still reconnecting." });
    const { app, container } = mount(defineComponent({
      render: () => h(Vibe64TemporaryActionTerminal, {
        ...state,
        onDismiss: () => { state.error = ""; },
        title: "Save work"
      })
    }));
    const dismiss = () => findNode(container, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Dismiss Save work"
    ));
    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__status"))).toBeNull();
    expect(dismiss()).toBeTruthy();
    dismiss().props.onClick();
    await nextTick();
    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__summary"))).toBeNull();
    state.active = true;
    await nextTick();
    expect(dismiss()).toBeNull();
    state.active = false;
    state.error = "The assistant is still reconnecting.";
    await nextTick();
    expect(dismiss()).toBeTruthy();
    app.unmount();
  });

  it("allows collapse while active and dismissal only after the operation finishes", async () => {
    const state = reactive({
      active: false,
      dismissedKey: "",
      operationKey: "save-1",
      output: "",
      stage: "Saving work",
      status: "running"
    });
    const { app, container } = mount(defineComponent({
      render: () => h(Vibe64TemporaryActionTerminal, {
        ...state,
        dismissed: state.dismissedKey === state.operationKey,
        onDismiss: () => {
          state.dismissedKey = state.operationKey;
        },
        title: "Save work"
      })
    }));

    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__summary"))).toBeNull();

    state.active = true;
    state.output = "Preparing\nSaved revision 42";
    await nextTick();

    const summary = findNode(container, hasClass("vibe64-temporary-action-terminal__summary"));
    const details = findNode(container, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Show Save work details"
    ));
    expect(summary).toBeTruthy();
    expect(summary.props.color).toBe("surface-variant");
    expect(nodeText(summary)).toContain("Saved revision 42");
    expect(findNode(container, hasClass("vibe64-terminal-surface"))).toBeNull();
    expect(findNode(container, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Dismiss Save work"
    ))).toBeNull();

    details.props.onClick();
    await nextTick();
    expect(findNode(container, hasClass("vibe64-terminal-surface"))).toBeTruthy();
    expect(findNode(container, (node) => (
      node.type === "button" && nodeText(node) === "Dismiss"
    ))).toBeNull();

    const activeCollapse = findNode(container, (node) => (
      node.type === "button" && nodeText(node) === "Collapse"
    ));
    activeCollapse.props.onClick();
    await nextTick();
    expect(findNode(container, hasClass("vibe64-terminal-surface"))).toBeNull();

    const activeReopen = findNode(container, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Show Save work details"
    ));
    activeReopen.props.onClick();
    await nextTick();

    state.active = false;
    state.status = "succeeded";
    await nextTick();
    expect(findNode(container, hasClass("vibe64-terminal-surface"))).toBeTruthy();

    const collapseDetails = findNode(container, (node) => (
      node.type === "button" && nodeText(node) === "Collapse"
    ));
    collapseDetails.props.onClick();
    await nextTick();
    expect(findNode(container, hasClass("vibe64-terminal-surface"))).toBeNull();
    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__summary"))).toBeTruthy();
    expect(state.dismissedKey).toBe("");

    const reopenedDetails = findNode(container, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Show Save work details"
    ));
    reopenedDetails.props.onClick();
    await nextTick();
    const dismissDetails = findNode(container, (node) => (
      node.type === "button" && nodeText(node) === "Dismiss"
    ));
    dismissDetails.props.onClick();
    await nextTick();
    expect(findNode(container, hasClass("vibe64-terminal-surface"))).toBeNull();
    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__summary"))).toBeNull();

    state.operationKey = "save-2";
    state.active = true;
    state.status = "running";
    await nextTick();
    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__summary"))).toBeTruthy();
    expect(findNode(container, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Dismiss Save work"
    ))).toBeNull();

    state.operationKey = "save-3";
    await nextTick();
    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__summary"))).toBeTruthy();
    state.active = false;
    await nextTick();
    expect(findNode(container, hasClass("vibe64-temporary-action-terminal__summary"))).toBeNull();
    app.unmount();
  });

  it("forwards the output loading overlay into expanded action details", async () => {
    const { app, container } = mount(defineComponent({
      render: () => h(Vibe64TemporaryActionTerminal, {
        active: true, operationKey: "publish-1", title: "Publish"
      }, {
        overlay: () => h("div", { "aria-label": "Loading publish output" }, "Loading")
      })
    }));
    try {
      const details = findNode(container, (node) => node.props?.["aria-label"] === "Show Publish details");
      details.props.onClick();
      await nextTick();
      const overlay = findNode(container, hasClass("vibe64-terminal-surface__overlay"));
      expect(findNode(overlay, (node) => node.props?.["aria-label"] === "Loading publish output")).toBeTruthy();
      expect(findNode(container, hasClass("vibe64-terminal-surface__log"))).toBeTruthy();
    } finally {
      app.unmount();
    }
  });

  it("keeps error recovery actions directly available in the collapsed summary", async () => {
    const retry = vi.fn();
    const fix = vi.fn();
    const { app, container } = mount(defineComponent({
      render: () => h(Vibe64TemporaryActionTerminal, {
        error: "Dependency installation exited with code 1.",
        onRetry: retry,
        retryable: true,
        status: "failed",
        title: "Workspace preparation"
      }, {
        "error-actions": () => h(Vibe64TemporaryAiFixAction, { onClick: fix })
      })
    }));

    const summary = findNode(container, hasClass("vibe64-temporary-action-terminal__summary"));
    const fixButton = findNode(summary, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Fix it with AI"
    ));
    const retryButton = findNode(summary, (node) => (
      node.type === "button" && node.props?.["aria-label"] === "Retry Workspace preparation"
    ));
    expect(summary.props.role).toBe("alert");
    expect(fixButton).toBeTruthy();
    expect(nodeText(fixButton)).toBe("Fix it with AI");
    expect(retryButton).toBeTruthy();
    expect(findNode(container, hasClass("vibe64-terminal-surface"))).toBeNull();

    fixButton.props.onClick();
    retryButton.props.onClick();
    expect(fix).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it("shows a long-running terminal only on request and never hides it on process exit", async () => {
    const closeTerminalSocket = vi.fn();
    const state = reactive({
      open: false,
      status: "running"
    });
    const { app, container } = mount(defineComponent({
      render: () => h(Vibe64LongRunningTerminal, {
        "onUpdate:open": (open) => {
          state.open = open;
        },
        open: state.open,
        status: state.status,
        terminal: { closeTerminalSocket },
        title: "Run app"
      })
    }));

    expect(findNode(container, hasClass("fake-full-terminal"))).toBeNull();
    state.open = true;
    await nextTick();
    expect(findNode(container, hasClass("fake-full-terminal"))).toBeTruthy();

    state.status = "exited";
    await nextTick();
    expect(findNode(container, hasClass("fake-full-terminal"))).toBeTruthy();
    expect(nodeText(container)).toContain("exited");

    const hide = findNode(container, (node) => node.type === "button" && nodeText(node) === "Hide");
    hide.props.onClick();
    await nextTick();
    expect(findNode(container, hasClass("fake-full-terminal"))).toBeNull();
    expect(closeTerminalSocket).toHaveBeenCalledTimes(1);
    app.unmount();
  });
});
