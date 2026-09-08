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
  app.component("VBtn", passthroughComponent("button"));
  app.component("VChip", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  app.component("VTooltip", passthroughComponent("aside"));
  return renderToString(app);
}

describe("session creation controls", () => {
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
