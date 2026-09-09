import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VIcon", () => ({
  VIcon: passthroughComponent("span")
}));

vi.mock("vuetify/components/VChip", () => ({
  VChip: passthroughComponent("button")
}));

vi.mock("vuetify/components/VTooltip", () => ({
  VTooltip: passthroughComponent("aside")
}));

vi.mock("@/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue", () => ({
  default: emptyComponent()
}));

import Vibe64CreateSessionButton from "../../src/components/studio/vibe64-session/Vibe64CreateSessionButton.vue";
import Vibe64SessionToolbar from "../../src/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import {
  createVibe64SessionTooltipState,
  VIBE64_SESSION_TOOLTIP_KEY
} from "../../src/lib/vibe64SessionTooltip.js";

const buttonPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64CreateSessionButton.vue"
);
const buttonSource = fs.readFileSync(buttonPath, "utf8");
const { descriptor } = parse(buttonSource, { filename: buttonPath });
const componentScript = compileScript(descriptor, {
  id: "vibe64-session-create-ui-test"
});
const componentTemplate = compile(descriptor.template.content, {
  bindingMetadata: componentScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64CreateSessionButton.render = new Function(
  "Vue",
  componentTemplate.code
)(VueRuntime);

const toolbarPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64SessionToolbar.vue"
);
const { descriptor: toolbarDescriptor } = parse(
  fs.readFileSync(toolbarPath, "utf8"),
  { filename: toolbarPath }
);
const toolbarScript = compileScript(toolbarDescriptor, {
  id: "vibe64-session-toolbar-create-ui-test"
});
const toolbarTemplate = compile(toolbarDescriptor.template.content, {
  bindingMetadata: toolbarScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64SessionToolbar.render = new Function(
  "Vue",
  toolbarTemplate.code
)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function emptyComponent() {
  return defineComponent({
    setup() {
      return () => null;
    }
  });
}

async function renderCreateButton({
  canCreate = true,
  iconOnly = false,
  running = false,
  title = "Create a new Vibe64 session"
} = {}) {
  const createSession = vi.fn();
  const app = createSSRApp(Vibe64CreateSessionButton, {
    ariaLabel: iconOnly ? "New session" : "Create session",
    buttonClass: iconOnly
      ? "studio-ai-sessions__create-button"
      : "studio-ai-sessions__preview-create-button",
    iconOnly,
    label: "Create session",
    toolbar: {
      canCreateSession: canCreate,
      createSession,
      createSessionRunning: running,
      createSessionTitle: title
    }
  });
  app.component("VBtn", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  return {
    createSession,
    html: await renderToString(app)
  };
}

async function renderToolbar({
  canCreate = true,
  createVisible = true,
  sessions = [],
  title = "Create a new Vibe64 session"
} = {}) {
  const app = createSSRApp(Vibe64SessionToolbar, {
    archive: { command: { isRunning: false } },
    createVisible,
    toolbar: {
      canCreateSession: canCreate,
      createSession: vi.fn(),
      createSessionRunning: false,
      createSessionTitle: title,
      sessions
    }
  });
  app.provide(VIBE64_SESSION_TOOLTIP_KEY, createVibe64SessionTooltipState());
  app.component("VBtn", passthroughComponent("button"));
  app.component("VChip", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  app.component("VTooltip", passthroughComponent("aside"));
  return renderToString(app);
}

describe("session creation controls", () => {
  function mountSessionToolbars() {
    const nodes = [];
    const renderer = VueRuntime.createRenderer({
      createElement(type) {
        const node = { type, props: {} };
        nodes.push(node);
        return node;
      },
      createText: (text) => ({ text }),
      createComment: (text) => ({ text }),
      insert() {},
      remove() {},
      parentNode: () => null,
      nextSibling: () => null,
      patchProp(node, key, _previous, value) { node.props[key] = value; },
      setElementText(node, text) { node.text = text; },
      setText(node, text) { node.text = text; }
    });
    const selected = VueRuntime.ref("session-1");
    const sessionTooltip = createVibe64SessionTooltipState();
    const selectSession = vi.fn((id) => { selected.value = id; });
    const sessions = [{ sessionId: "session-1" }, { sessionId: "session-2" }];
    const app = renderer.createApp({
      setup() {
        VueRuntime.provide(VIBE64_SESSION_TOOLTIP_KEY, sessionTooltip);
        // The real panel retains a separate runtime/toolbar for each session.
        return () => h("main", {
          onPointermove: sessionTooltip.trackPointer,
          onPointerleave: sessionTooltip.resumeHover
        }, sessions.map(({ sessionId }) => h(Vibe64SessionToolbar, {
          key: sessionId,
          active: selected.value === sessionId,
          selectedSessionId: sessionId,
          archive: { command: { isRunning: false } },
          createVisible: false,
          toolbar: { selectSession, sessions }
        })));
      }
    });
    app.provide(VueRuntime.ssrContextKey, { modules: new Set() });
    app.component("VBtn", passthroughComponent("button"));
    app.component("VChip", passthroughComponent("button"));
    app.component("VIcon", passthroughComponent("span"));
    app.component("VTooltip", passthroughComponent("aside"));
    app.mount({});
    const tabs = nodes.filter((node) => node.props["data-vibe64-session-id"]);
    const tooltips = nodes.filter((node) => node.type === "aside");
    const panel = nodes.find((node) => node.type === "main");
    return {
      app, nodes, tabs, tooltips, selected, selectSession,
      requestOpen: (index) => tooltips[index].props["onUpdate:modelValue"](true),
      visible: (index) => tooltips[index].props["model-value"],
      movePointer(sessionId) {
        panel.props.onPointermove({ target: {
          closest: () => sessionId ? { dataset: { vibe64SessionId: sessionId } } : null
        } });
      },
      leavePanel: () => panel.props.onPointerleave()
    };
  }

  it.each([false, true])("keeps clicked details closed across retained toolbar swaps (initially open: %s)", async (initiallyOpen) => {
    const { app, tabs, tooltips, selected, requestOpen, visible, movePointer, leavePanel } = mountSessionToolbars();
    try {
      expect(tooltips.every((node) => node.props["open-delay"] === 1000)).toBe(true);
      if (initiallyOpen) requestOpen(1);
      await VueRuntime.nextTick();
      expect(visible(1)).toBe(initiallyOpen);

      tabs[1].props.onClick(); // First toolbar selects the second runtime.
      await VueRuntime.nextTick();
      expect(selected.value).toBe("session-2");
      expect(visible(1)).toBe(false);
      expect(tooltips[1].props.disabled).toBe(true);
      expect(tooltips[3].props.disabled).toBe(false);
      requestOpen(1); // Pending request from the now-hidden toolbar.
      requestOpen(3); // Newly shown toolbar receives hover under stationary mouse.
      await VueRuntime.nextTick();
      expect(visible(1)).toBe(false);
      expect(visible(3)).toBe(false);

      expect(tabs[3].props.onMouseenter).toBeUndefined();
      movePointer("session-2"); // Moving inside the clicked tab is not a new hover.
      requestOpen(3);
      await VueRuntime.nextTick();
      expect(visible(3)).toBe(false);

      movePointer(); // Real movement outside the tab permits a later hover.
      requestOpen(3);
      await VueRuntime.nextTick();
      expect(visible(3)).toBe(true);

      tabs[2].props.onClick(); // Switch back to the retained first toolbar.
      await VueRuntime.nextTick();
      expect(selected.value).toBe("session-1");
      expect(visible(3)).toBe(false);
      requestOpen(0);
      await VueRuntime.nextTick();
      expect(visible(0)).toBe(false);
      leavePanel();
      requestOpen(0);
      await VueRuntime.nextTick();
      expect(visible(0)).toBe(true);
    } finally {
      app.unmount();
    }
  });

  it("preserves deliberate keyboard focus and the explicit info action after selection", async () => {
    const { app, nodes, tabs, tooltips, requestOpen, visible, selectSession } = mountSessionToolbars();
    try {
      tabs[0].props.onClick();
      await VueRuntime.nextTick();
      tabs[0].props.onFocusin({ target: { matches: () => false } });
      requestOpen(0);
      await VueRuntime.nextTick();
      expect(visible(0)).toBe(false);
      tabs[0].props.onFocusin({ target: { matches: (selector) => selector === ":focus-visible" } });
      requestOpen(0);
      await VueRuntime.nextTick();
      expect(visible(0)).toBe(true);

      tabs[0].props.onClick();
      await VueRuntime.nextTick();
      const info = nodes.find((node) => node.props["aria-label"] === "Session info: session-1");
      info.props.onClick({ stopPropagation() {} });
      await VueRuntime.nextTick();
      expect(visible(0)).toBe(true);
      expect(selectSession).toHaveBeenCalledTimes(2);
      tooltips[0].props["onUpdate:modelValue"](false);
      await VueRuntime.nextTick();
      expect(visible(0)).toBe(false);
    } finally {
      app.unmount();
    }
  });

  it("does not share click suppression between project panels", () => {
    const first = createVibe64SessionTooltipState();
    const second = createVibe64SessionTooltipState();
    first.suppressedSessionId.value = "session-1";
    second.resumeHover();
    expect(first.suppressedSessionId.value).toBe("session-1");
    expect(second.suppressedSessionId.value).toBe("");
  });

  it("uses stable accessible pending feedback without a circular loader", async () => {
    const toolbar = await renderCreateButton({ iconOnly: true, running: true });
    const preview = await renderCreateButton({ running: true });

    for (const { html } of [toolbar, preview]) {
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-label="Creating session…"');
      expect(html).toContain('title="Creating session…"');
      expect(html).toContain("disabled");
      expect(html).not.toContain("progressbar");
      expect(html).not.toContain("v-progress-circular");
    }
    expect(preview.html).toContain("Creating session…");
    expect(buttonSource).not.toContain(":loading=");
  });

  it("retains ordinary action names while idle", async () => {
    const toolbar = await renderCreateButton({ iconOnly: true });
    const preview = await renderCreateButton();

    expect(toolbar.html).toContain('aria-label="New session"');
    expect(toolbar.html).toContain('title="Create a new Vibe64 session"');
    expect(toolbar.html).not.toContain("aria-busy");
    expect(toolbar.html).not.toContain("disabled");
    expect(preview.html).toContain('aria-label="Create session"');
    expect(preview.html).toContain("Create session");
  });

  it("hides the toolbar plus at three sessions while keeping the standalone disabled reason", async () => {
    const reason = "Studio allows up to 3 open sessions. Archive one before creating another.";
    const button = await renderCreateButton({
      canCreate: false,
      iconOnly: true,
      title: reason
    });
    const toolbar = await renderToolbar({
      canCreate: false,
      createVisible: true,
      sessions: [1, 2, 3].map((id) => ({ sessionId: `session-${id}` })),
      title: reason
    });

    expect(button.html).toContain('aria-disabled="true"');
    expect(button.html).toContain(`aria-label="New session. ${reason}"`);
    expect(button.html).not.toContain(" disabled");
    expect(button.html).toContain(`title="${reason}"`);
    expect(button.html).not.toContain("aria-busy");
    expect(toolbar).not.toContain("New session");
    expect(toolbar.match(/data-vibe64-session-id=/g)).toHaveLength(3);
  });

  it.each([0, 1, 2])("keeps New session available with %i sessions", async (count) => {
    const toolbar = await renderToolbar({
      sessions: Array.from({ length: count }, (_, id) => ({ sessionId: `session-${id}` }))
    });

    expect(toolbar).toContain('aria-label="New session"');
  });

  it("omits the toolbar action when the server marks creation invisible", async () => {
    const toolbar = await renderToolbar({
      canCreate: false,
      createVisible: false,
      title: "This project shares one development database."
    });

    expect(toolbar).not.toContain('aria-label="New session"');
    expect(toolbar).not.toContain("This project shares one development database.");
  });

  it("uses the authoritative visibility projection at every create-session entry point", () => {
    const panelSource = fs.readFileSync(path.resolve(
      "src/components/studio/Vibe64SessionPanel.vue"
    ), "utf8");
    const autopilotSource = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
    ), "utf8");
    const runtimeHostSource = fs.readFileSync(path.resolve(
      "src/composables/useVibe64SessionRuntimeHost.js"
    ), "utf8");

    expect(panelSource).toContain(
      ':create-visible="!emptyStateInitialLoading && toolbar.createSessionVisible"'
    );
    expect(panelSource).toContain('v-else-if="toolbar.createSessionVisible"');
    expect(panelSource).toContain('v-if="emptyStateInitialLoading"');
    expect(autopilotSource).toContain(
      ':create-visible="props.sessionToolbar.createSessionVisible === true"'
    );
    expect(runtimeHostSource).toContain(
      "createSessionRunning: props.sessionData.createSessionRunning"
    );
    expect(runtimeHostSource).toContain(
      "createSessionVisible: props.sessionData.createSessionVisible"
    );
    expect(buttonSource).toContain("min-height: 3rem");
    expect(buttonSource).toContain("min-width: 3rem");
    expect(buttonSource).toContain("prefers-reduced-motion: reduce");
  });
});
