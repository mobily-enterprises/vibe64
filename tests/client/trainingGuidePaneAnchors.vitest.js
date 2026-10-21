import { readFileSync } from "node:fs";
import { parse } from "@vue/compiler-sfc";
import { renderToString } from "@vue/server-renderer";
import { createSSRApp, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import SectionContainerShell from "../../src/components/SectionContainerShell.vue";
import { VIBE64_SESSION_TOOL_DEFINITIONS, vibe64SessionToolGuideId } from "../../src/lib/vibe64SessionToolDefinitions.js";
import { TRAINING_GUIDE_PLACES } from "../../packages/vibe64-training/src/shared/guideTargets.js";

// "Show me" rings the open pane when the learner is already at the place. On a
// phone the header tabs and the Dashboard menu are hidden, so the open panes
// and the Dashboard section select carry `data-vibe64-guide-pane` anchors.

function host(tag) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.());
    }
  });
}

vi.mock("vuetify/components/VSheet", () => ({ VSheet: host("div") }));
vi.mock("vuetify/components/VSelect", () => ({ VSelect: host("select") }));
vi.mock("vuetify/components/VList", () => ({ VList: host("ul") }));

async function renderShell({ phone }) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: phone }) });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:path(.*)*", component: { render: () => null } }] });
  await router.push("/app/project/alpha/dashboard/env");
  const app = createSSRApp({
    render: () => h(SectionContainerShell, {
      navigationGuidePane: "dashboard",
      mobileSectionLinks: [{ id: "env", label: "Env", to: "/app/project/alpha/dashboard/env" }]
    }, { tabs: () => h("span", "tabs"), default: () => h("p", "content") })
  });
  app.use(router);
  return renderToString(app);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guide pane anchors", () => {
  it("anchors the Dashboard section select on a phone and the section menu otherwise", async () => {
    const phone = await renderShell({ phone: true });
    expect(phone).toMatch(/<select[^>]*class="section-container-shell__mobile-select"[^>]*data-vibe64-guide-pane="dashboard"/u);
    expect(phone).not.toContain("section-container-shell__nav");

    const wide = await renderShell({ phone: false });
    expect(wide).toMatch(/<nav[^>]*class="section-container-shell__nav"[^>]*data-vibe64-guide-pane="dashboard"/u);
    expect(wide).not.toContain("section-container-shell__mobile-select");
  });

  it("names every guided session tool pane by its declared guide place", () => {
    const places = new Set(Object.values(TRAINING_GUIDE_PLACES).flatMap(place => place.steps.map(step => step.id)));
    for (const tool of VIBE64_SESSION_TOOL_DEFINITIONS) {
      expect(vibe64SessionToolGuideId(tool.id)).toBe(tool.guideId);
      if (tool.guideId) expect(places.has(tool.guideId)).toBe(true);
    }
    expect(vibe64SessionToolGuideId("dashboard")).toBeUndefined();
    expect(vibe64SessionToolGuideId("ai-terminal")).toBeUndefined();
  });

  it("marks each open project pane with its guide place", () => {
    const file = "src/components/studio/vibe64-session/Vibe64AutopilotView.vue";
    const source = readFileSync(file, "utf8");
    expect(parse(source, { filename: file }).errors).toEqual([]);
    expect(source).toContain('data-vibe64-guide-pane="preview"');
    expect(source).toContain(':data-vibe64-guide-pane="vibe64SessionToolGuideId(rightPaneTab)"');
    for (const tool of ["changes", "editor", "database", "system"]) {
      expect(source).toMatch(new RegExp(`rightPaneTab === '${tool}'"\\n\\s+:data-vibe64-guide-pane="vibe64SessionToolGuideId\\('${tool}'\\)"`, "u"));
    }
    // A standalone tool pane hides the Dashboard shell's section select, so its
    // own back button is the Dashboard step there.
    const backButtons = source.match(/<Vibe64DashboardBackButton[^>]*>/gu);
    expect(backButtons).toHaveLength(4);
    for (const button of backButtons) expect(button).toContain('data-vibe64-guide-pane="dashboard"');
    expect(readFileSync("src/components/studio/Vibe64EmptySessionLayout.vue", "utf8"))
      .toMatch(/class="studio-ai-sessions__preview-empty-pane"\n\s+data-vibe64-guide-pane="preview"/u);
    expect(readFileSync("src/components/studio/Vibe64DashboardShell.vue", "utf8")).toContain('navigation-guide-pane="dashboard"');
  });
});
