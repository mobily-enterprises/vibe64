import { renderToString } from "@vue/server-renderer";
import { createSSRApp, defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import getPlacements from "../../src/placement.js";
import placementTopology from "../../src/placementTopology.js";

function vuetifySlotHost(name) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("div", attrs, slots.default?.());
    }
  });
}

vi.mock("vuetify/components/VAppBar", () => ({
  VAppBar: vuetifySlotHost("VAppBar")
}));

vi.mock("vuetify/components/VGrid", () => ({
  VContainer: vuetifySlotHost("VContainer"),
  VSpacer: vuetifySlotHost("VSpacer")
}));

vi.mock("vuetify/components/VMain", () => ({
  VMain: vuetifySlotHost("VMain")
}));

vi.mock("@jskit-ai/shell-web/client/components/ShellOutlet", async () => {
  const { defineComponent: defineVueComponent, h: createElement } = await import("vue");
  return {
    default: defineVueComponent({
      name: "ShellOutletTestDouble",
      props: {
        target: {
          default: "",
          type: String
        }
      },
      setup(props) {
        return () => createElement("span", {
          "data-shell-outlet": props.target
        });
      }
    })
  };
});

vi.mock("@jskit-ai/shell-web/client/components/ShellLayout", async () => {
  const { defineComponent: defineVueComponent, h: createElement } = await import("vue");
  return {
    default: defineVueComponent({
      name: "PackageShellLayoutTestDouble",
      setup(_props, { slots }) {
        return () => createElement("section", { "data-test": "package-shell" }, [
          slots["top-left"]?.({ surface: "app" }),
          slots["top-right"]?.({ surface: "app" }),
          slots.default?.()
        ]);
      }
    })
  };
});

import ShellLayout from "../../src/components/ShellLayout.vue";
import StudioAppShellLayout from "../../src/components/StudioAppShellLayout.vue";

function slotHost(name) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("div", attrs, slots.default?.());
    }
  });
}

async function renderCustomShell(topRightTestId) {
  const app = createSSRApp({
    render() {
      return h(StudioAppShellLayout, null, {
        "top-left": () => h("span", { "data-test": "shell-identity" }),
        "top-right": () => h("button", { "data-test": topRightTestId }, "Action"),
        default: () => h("main", { "data-test": "shell-content" })
      });
    }
  });
  app.component("VAppBar", slotHost("VAppBar"));
  app.component("VContainer", slotHost("VContainer"));
  app.component("VMain", slotHost("VMain"));
  app.component("VSpacer", defineComponent({
    name: "VSpacer",
    render: () => h("span", { "data-test": "shell-spacer" })
  }));
  return renderToString(app);
}

async function renderPackageShell(topRightTestId = "") {
  const app = createSSRApp({
    render() {
      return h(ShellLayout, null, {
        "top-left": () => h("span", { "data-test": "shell-identity" }),
        ...(topRightTestId
          ? { "top-right": () => h("button", { "data-test": topRightTestId }, "Action") }
          : {}),
        default: () => h("main", { "data-test": "shell-content" })
      });
    }
  });
  return renderToString(app);
}

describe("Vibe64 custom shell status placement", () => {
  it("maps the shared realtime indicator into the app-bar outlet at every layout size", () => {
    const statusTopology = placementTopology.placements.find((entry) => entry.id === "shell.status");
    const realtimeIndicator = getPlacements().find((entry) => entry.id === "realtime.connection.indicator");

    expect(statusTopology).toBeTruthy();
    expect(Object.values(statusTopology.variants).map((variant) => variant.outlet)).toEqual([
      "shell-layout:top-right",
      "shell-layout:top-right",
      "shell-layout:top-right"
    ]);
    expect(realtimeIndicator).toMatchObject({
      componentToken: "realtime.web.connection.indicator",
      kind: "component",
      surfaces: ["*"],
      target: "shell.status"
    });
  });

  it.each([
    ["project picker", "account-settings"],
    ["project workspace", "workspace-actions"]
  ])("keeps one status outlet before the %s actions", async (_surface, actionTestId) => {
    const html = await renderCustomShell(actionTestId);
    const outlet = 'data-shell-outlet="shell-layout:top-right"';
    const action = `data-test="${actionTestId}"`;

    expect(html.match(new RegExp(outlet, "gu"))).toHaveLength(1);
    expect(html).toContain(action);
    expect(html.indexOf(outlet)).toBeLessThan(html.indexOf(action));
  });

  it.each([
    ["project management", "account-menu"],
    ["prerequisite setup", "prerequisite-account-menu"]
  ])("keeps one status outlet when %s supplies app-bar actions", async (_surface, actionTestId) => {
    const html = await renderPackageShell(actionTestId);
    const outlet = 'data-shell-outlet="shell-layout:top-right"';
    const action = `data-test="${actionTestId}"`;

    expect(html.match(new RegExp(outlet, "gu"))).toHaveLength(1);
    expect(html).toContain(action);
    expect(html.indexOf(outlet)).toBeLessThan(html.indexOf(action));
  });

  it("keeps one status outlet when an account page has no app-bar actions", async () => {
    const html = await renderPackageShell();
    expect(html.match(/data-shell-outlet="shell-layout:top-right"/gu)).toHaveLength(1);
  });
});


// Learning uses the same shell. These additions do not replace the original
// placement assertions above.
import { reactive } from "vue";
import { createVuetify } from "vuetify";
import { VIBE64_LEARNING_KEY } from "../../src/lib/vibe64AssistantHost.js";

async function renderLearningShell(environment = { actorKey: "local", open: false, minimised: false }) {
  const app = createSSRApp({
    render() {
      return h(StudioAppShellLayout, null, {
        "top-left": () => h("span", { "data-test": "unchanged-project-identity" }),
        "top-right": () => h("button", { "data-test": "unchanged-main-controls" }, "Main"),
        default: () => h("main", { "data-test": "retained-workspace" })
      });
    }
  });
  app.use(createVuetify());
  if (environment) app.provide(VIBE64_LEARNING_KEY, { state: reactive(environment), toggle() {} });
  return renderToString(app);
}

// Learning v2: the L button opens the Learning environment above the page. It
// keeps the plate's footprint and position in the app bar.
describe("controlled Learning shell", () => {
  it.each([
    [false, "false", "Open Learning"],
    [true, "true", "Hide Learning"]
  ])("renders the actual L button with truthful state (open %s)", async (open, pressed, title) => {
    const html = await renderLearningShell({ actorKey: "local", open, minimised: false });
    expect(html.match(/aria-label="Learning"/gu)).toHaveLength(1);
    expect(html).toContain(`aria-pressed="${pressed}"`);
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain('data-vibe64-guide="learning"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>L<\/span>/u);
    // Neighbouring header icon-button size; full yellow only while active.
    const plateClass = html.match(/class="([^"]*studio-app-shell-layout__learning-plate[^"]*)"/u)[1].split(" ");
    expect(plateClass).toEqual(expect.arrayContaining(["vibe64-learning-button", "v-btn--icon", "v-btn--size-small", "v-btn--density-comfortable"]));
    expect(plateClass).toContain(pressed === "true" ? "v-btn--variant-flat" : "v-btn--variant-outlined");
    expect(plateClass.includes("vibe64-learning-button--active")).toBe(pressed === "true");
    expect(html).toContain('data-test="retained-workspace"');
    expect(html).toContain('data-test="unchanged-main-controls"');
    expect(html).toContain('data-test="unchanged-project-identity"');
    expect(html.match(/data-shell-outlet="shell-layout:top-right"/gu)).toHaveLength(1);
  });

  it("marks a minimised lesson on the closed L button", async () => {
    const html = await renderLearningShell({ actorKey: "local", open: false, minimised: true });
    expect(html).toContain('title="Return to your lesson"');
    expect(html).toContain("vibe64-learning-button--minimised");
  });

  it("does not expose L without a signed-in Learning environment", async () => {
    expect(await renderLearningShell(null)).not.toContain('aria-label="Learning"');
    expect(await renderLearningShell({ actorKey: "", open: false, minimised: false })).not.toContain('aria-label="Learning"');
  });

  it("leads management page headers with the same L button", async () => {
    const app = createSSRApp({ render: () => h(ShellLayout, null, { "top-left": () => h("span", { "data-test": "page-title" }) }) });
    app.use(createVuetify());
    app.provide(VIBE64_LEARNING_KEY, { state: reactive({ actorKey: "member", open: false, minimised: false }), toggle() {} });
    const html = await renderToString(app);
    expect(html.match(/aria-label="Learning"/gu)).toHaveLength(1);
    expect(html.indexOf('aria-label="Learning"')).toBeLessThan(html.indexOf('data-test="page-title"'));
    expect(html.match(/data-shell-outlet="shell-layout:top-right"/gu)).toHaveLength(1);
  });
});
