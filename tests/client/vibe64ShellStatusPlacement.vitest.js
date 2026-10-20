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


// Learning uses the same shell and stored-selection owners. These additions do
// not replace the original placement assertions above.
import { effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach } from "vitest";
import { createVuetify } from "vuetify";
import { VIBE64_LEARNING_KEY } from "../../src/lib/vibe64AssistantHost.js";
import { useVibe64SessionSelection } from "../../src/composables/useVibe64SessionSelection.js";
import { selectedSessionStorageKey } from "../../src/lib/vibe64SessionRequestConfig.js";

async function renderLearningShell(learningMode, environment = { actorKey: "local", open: false, minimised: false }) {
  const app = createSSRApp({
    render() {
      return h(StudioAppShellLayout, { learningMode, showLearningModeControl: true }, {
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
// keeps the plate's footprint and position; legacy route mode only warms it.
describe("controlled Learning shell", () => {
  it.each([
    [false, false, "false", "Open Learning"],
    [false, true, "true", "Close Learning"],
    [true, false, "true", "Open Learning"]
  ])("renders the actual L button with truthful state (legacy mode %s, open %s)", async (mode, open, pressed, title) => {
    const html = await renderLearningShell(mode, { actorKey: "local", open, minimised: false });
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
    expect(html.includes("studio-app-shell-layout--learning")).toBe(mode);
  });

  it("marks a minimised lesson on the closed L button", async () => {
    const html = await renderLearningShell(false, { actorKey: "local", open: false, minimised: true });
    expect(html).toContain('title="Return to your lesson"');
    expect(html).toContain("vibe64-learning-button--minimised");
  });

  it("does not expose L without a signed-in Learning environment", async () => {
    expect(await renderLearningShell(false, null)).not.toContain('aria-label="Learning"');
    expect(await renderLearningShell(false, { actorKey: "", open: false, minimised: false })).not.toContain('aria-label="Learning"');
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

describe("separate remembered Working and Learning selections", () => {
  let scopes;
  let saved;
  beforeEach(() => {
    scopes = [];
    saved = new Map();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key) => saved.get(key) || null,
        setItem: (key, value) => saved.set(key, value),
        removeItem: (key) => saved.delete(key)
      }
    });
  });
  afterEach(() => {
    for (const scope of scopes) scope.stop();
    vi.unstubAllGlobals();
  });

  function remember(options) {
    const scope = effectScope();
    scopes.push(scope);
    return scope.run(() => useVibe64SessionSelection({ projectSlug: "project-one", ...options }));
  }

  it("retains the exact Working key and route while Learning remembers its own selection", async () => {
    const route = reactive({ query: { session: "work-a", learningAttempt: "attempt-one", learningSession: "lesson-a" } });
    const working = remember({ route });
    const learning = remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-one" });
    expect(working.selectedId.value).toBe("work-a");
    expect(learning.selectedId.value).toBe("lesson-a");
    working.select("work-b");
    learning.select("lesson-b");
    await nextTick();
    expect(working.selectedId.value).toBe("work-b");
    expect(learning.selectedId.value).toBe("lesson-b");
    expect(saved.get(selectedSessionStorageKey("project-one"))).toBe("work-b");
    expect(saved.size).toBe(2);
    expect(remember({ route: { query: {} } }).selectedId.value).toBe("work-b");
    expect(remember({ route: { query: {} }, learnerId: "learner-one", learningAttemptId: "attempt-one" }).selectedId.value).toBe("lesson-b");
  });

  it("does not borrow a Working session or another attempt's Learning route", async () => {
    const route = reactive({ query: { session: "work-a", learningAttempt: "attempt-one", learningSession: "lesson-a" } });
    const first = remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-one" });
    first.select("lesson-remembered");
    const second = remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-two" });
    expect(second.selectedId.value).toBe("");
    route.query.learningAttempt = "attempt-two";
    route.query.learningSession = "second-lesson";
    await nextTick();
    expect(second.selectedId.value).toBe("second-lesson");
    expect(first.selectedId.value).toBe("lesson-remembered");
    delete route.query.learningAttempt;
    route.query.learningSession = "unscoped-lesson";
    await nextTick();
    expect(first.selectedId.value).toBe("lesson-remembered");
    expect(second.selectedId.value).toBe("second-lesson");
  });

  it("separates personal selections and exact attempts even when session IDs collide", () => {
    const route = { query: {} };
    remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-one" }).select("same-id");
    const otherLearner = remember({ route, learnerId: "learner-two", learningAttemptId: "attempt-one" });
    const otherAttempt = remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-two" });
    expect(otherLearner.selectedId.value).toBe("");
    expect(otherAttempt.selectedId.value).toBe("");
    otherLearner.select("other-personal-id");
    otherAttempt.select("other-attempt-id");
    expect(remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-one" }).selectedId.value).toBe("same-id");
    expect(remember({ route, learnerId: "learner-two", learningAttemptId: "attempt-one" }).selectedId.value).toBe("other-personal-id");
    expect(remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-two" }).selectedId.value).toBe("other-attempt-id");
  });

  it("reconciles only actual Learning rows without clearing the Working selection", () => {
    const route = { query: { session: "work-a" } };
    const working = remember({ route });
    working.select("work-a");
    const learning = remember({ route, learnerId: "learner-one", learningAttemptId: "attempt-one" });
    learning.select("expired-lesson");
    learning.selectAvailableId([{ id: "real-lesson" }], { fallbackId: "real-lesson" });
    expect(learning.selectedId.value).toBe("real-lesson");
    learning.selectAvailableId([]);
    expect(learning.selectedId.value).toBe("");
    expect(working.selectedId.value).toBe("work-a");
    expect(saved.get(selectedSessionStorageKey("project-one"))).toBe("work-a");
  });

  it("refuses partial claimed Learning scope instead of sharing Working memory", () => {
    expect(() => remember({ route: { query: {} }, learningAttemptId: "attempt-one" })).toThrow("exact learner and attempt");
    expect(() => remember({ route: { query: {} }, learnerId: "learner-one" })).toThrow("exact learner and attempt");
    expect(saved.size).toBe(0);
  });

  it("reuses the original remembered-selection owner across explicit scope changes", async () => {
    const learnerId = ref("learner-one");
    const learningAttemptId = ref("attempt-one");
    const route = reactive({ query: {} });
    const selection = remember({ route, learnerId, learningAttemptId });
    selection.select("first-lesson");
    learningAttemptId.value = "attempt-two";
    await nextTick();
    expect(selection.selectedId.value).toBe("");
    selection.select("second-lesson");
    learningAttemptId.value = "attempt-one";
    await nextTick();
    expect(selection.selectedId.value).toBe("first-lesson");
    learnerId.value = "learner-two";
    await nextTick();
    expect(selection.selectedId.value).toBe("");
    learnerId.value = "learner-one";
    await nextTick();
    expect(selection.selectedId.value).toBe("first-lesson");
  });
});
