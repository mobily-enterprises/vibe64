import { readFileSync } from "node:fs";
import { createRenderer, defineComponent, nextTick, reactive, ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIBE64_COLLEAGUE_LAYOUT_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY } from "../../src/lib/vibe64AssistantHost.js";

const pageFixture = vi.hoisted(() => ({ route: null, router: null }));
vi.mock("vue-router", async importOriginal => ({
  ...await importOriginal(),
  useRoute: () => pageFixture.route,
  useRouter: () => pageFixture.router
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({ useRealtimeEvent() {} }));
vi.mock("@tanstack/vue-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => ({ report: vi.fn() }) }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: () => ({ canRun: false, isRunning: false, run: vi.fn() })
}));
vi.mock("@/composables/useStudioShellDrawer.js", () => ({ useStudioShellDrawer() {} }));
vi.mock("@/composables/useVibe64ProjectsResource.js", () => ({
  useVibe64ProjectsResource: () => ({ loadError: ref(""), projects: ref([]),
    selfTargetAutoSelectProjectRepro: ref(null), targetRoot: ref(""), isLoading: ref(false) })
}));

const mountedPages = [];
afterEach(() => {
  for (const app of mountedPages.splice(0)) app.unmount();
  vi.unstubAllGlobals();
});

function mountAppPage({ mobile = true, path = "/app/project/practice" } = {}) {
  pageFixture.route = reactive({ path, params: { slug: "practice" }, query: {} });
  pageFixture.router = { push: vi.fn(async () => {}), afterEach: vi.fn(() => () => {}) };
  const media = { matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("window", { matchMedia: () => media });
  const layout = shallowRef(null);
  const event = { type: "click", isTrusted: true };
  const begin = vi.fn((input, control) => input === event ? { control } : null);
  let page;
  const finish = vi.fn(ticket => {
    expect(layout.value.projectVisible || layout.value.chatVisible).toBe(true);
    if (ticket.control === "preview-select") expect(layout.value.projectVisible).toBe(true);
  });
  const gestures = shallowRef({ begin, finish });
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp(defineComponent({ setup() {
    page = useVibe64AppPage();
    return () => null;
  } }));
  app.provide(VIBE64_COLLEAGUE_LAYOUT_KEY, layout);
  app.provide(VIBE64_TRAINING_LEARNER_GESTURE_KEY, gestures);
  app.mount({});
  mountedPages.push(app);
  page.handleProjectSelectionReady({ currentProject: { slug: "practice" } });
  return { page, layout, event, begin, finish, media };
}

import {
  dashboardReturnPath,
  openProjectSwitcherProjects,
  projectPaneNavigationReady,
  projectRuntimeClosedPayloadMatches,
  previewToolbarTargetVisible,
  selfTargetAutoSelectProjectTarget,
  useVibe64AppPage
} from "../../src/composables/useVibe64AppPage.js";

describe("Vibe64 app page", () => {
  it("phone Show project uses one original Preview ticket after making the workspace visible", async () => {
    const { page, layout, event, begin, finish } = mountAppPage();
    expect(layout.value.ready).toBe(true);
    expect(page.chatToggleTitle.value).toBe("Show project");
    expect(layout.value.projectVisible).toBe(false);
    page.showProjectPane(event);
    await nextTick();
    expect(begin).toHaveBeenCalledExactlyOnceWith(event, "preview-select");
    expect(finish).toHaveBeenCalledExactlyOnceWith({ control: "preview-select" });
    expect(layout.value.projectVisible).toBe(true);
    expect(page.chatToggleTitle.value).toBe("Show chat");
    page.setChatCollapsed(true, event);
    expect(begin).toHaveBeenCalledTimes(1);
    page.setChatCollapsed(false, event);
    expect(begin).toHaveBeenLastCalledWith(event, "chat-show");
    expect(finish).toHaveBeenLastCalledWith({ control: "chat-show" });
    expect(layout.value.chatVisible).toBe(true);
  });

  it("programmatic attention, dashboard reveal and desktop collapse do not manufacture Preview receipts", () => {
    const phone = mountAppPage();
    phone.page.showProjectPane();
    expect(phone.begin).toHaveBeenCalledWith(undefined, "preview-select");
    expect(phone.finish).not.toHaveBeenCalled();
    expect(phone.layout.value.projectVisible).toBe(true);
    const dashboard = mountAppPage({ path: "/app/project/practice/dashboard/env" });
    dashboard.page.showProjectPane(dashboard.event);
    expect(dashboard.begin).not.toHaveBeenCalled();
    expect(dashboard.finish).not.toHaveBeenCalled();
    const desktop = mountAppPage({ mobile: false });
    desktop.page.setChatCollapsed(true, desktop.event);
    expect(desktop.begin).not.toHaveBeenCalled();
    expect(desktop.finish).not.toHaveBeenCalled();
  });

  it("explicit Preview navigation retains its original one-ticket ownership and public clicks forward the event", () => {
    const { page, event, begin, finish } = mountAppPage();
    page.selectProjectPane("preview", event);
    expect(begin.mock.calls).toEqual([[event, "preview-select"], [undefined, "preview-select"]]);
    expect(finish).toHaveBeenCalledExactlyOnceWith({ control: "preview-select" });
    const source = readFileSync(new URL("../../src/pages/app/project/[slug].vue", import.meta.url), "utf8");
    expect(source).toContain('@click="setChatCollapsed(!chatCollapsed, $event)"');
    expect(source).toContain('@click="selectProjectPane(tab.id, $event)"');
    expect(source).toContain('@click="selectProjectPane(mobileProjectAction.pane, $event)"');
  });

  it("shows only open projects in the project switcher", () => {
    const projects = [
      { runtime: { open: false }, slug: "closed" },
      { runtime: { open: true }, slug: "zulu" },
      { runtime: { open: true }, slug: "alpha" },
      { slug: "unknown" }
    ];

    expect(openProjectSwitcherProjects(projects).map((project) => project.slug)).toEqual([
      "alpha",
      "zulu"
    ]);
    expect(projects.map((project) => project.slug)).toEqual([
      "closed",
      "zulu",
      "alpha",
      "unknown"
    ]);
  });

  it("targets the configured self-target project only when the repro hook is active", () => {
    const projects = [
      { slug: "beepollen" },
      { slug: "vibe64" }
    ];

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "vibe64",
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: true
      }
    })).toEqual({ slug: "beepollen" });

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "vibe64",
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: false
      }
    })).toBeNull();

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "beepollen",
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: true
      }
    })).toBeNull();

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "vibe64",
      loading: true,
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: true
      }
    })).toBeNull();
  });

  it("shows the preview toolbar target with the same pane visibility rule as project navigation", () => {
    expect(previewToolbarTargetVisible({
      chatCollapsed: false,
      mobilePaneLayout: false,
      projectPane: "preview",
      projectPaneNavigationVisible: true
    })).toBe(true);

    expect(previewToolbarTargetVisible({
      chatCollapsed: false,
      mobilePaneLayout: true,
      projectPane: "preview",
      projectPaneNavigationVisible: true
    })).toBe(false);

    expect(previewToolbarTargetVisible({
      chatCollapsed: true,
      mobilePaneLayout: true,
      projectPane: "preview",
      projectPaneNavigationVisible: true
    })).toBe(true);

    expect(previewToolbarTargetVisible({
      chatCollapsed: true,
      mobilePaneLayout: true,
      projectPane: "dashboard",
      projectPaneNavigationVisible: true
    })).toBe(false);
  });

  it("keeps project pane navigation scoped to the selected project", () => {
    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      selectionReady: true,
      readyProjectSlug: "beepollen"
    })).toBe(true);

    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      selectionReady: true,
      readyProjectSlug: "compas-next"
    })).toBe(false);

    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      selectionReady: false,
      readyProjectSlug: "beepollen"
    })).toBe(false);

    expect(projectPaneNavigationReady({
      projectSlug: "",
      selectionReady: true,
      readyProjectSlug: "beepollen"
    })).toBe(false);
  });

  it("returns dashboard navigation to the last dashboard route", () => {
    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/beepollen/dashboard/files"
    })).toBe("/app/project/beepollen/dashboard/files");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/beepollen/dashboard/repository"
    })).toBe("/app/project/beepollen/dashboard/repository");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/other/dashboard/files"
    })).toBe("/app/project/beepollen/dashboard/env");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: ""
    })).toBe("/app/project/beepollen/dashboard/env");
  });

  it("keeps project runtime close available without route-leave shutdown", () => {
    const source = readFileSync(new URL("../../src/composables/useVibe64AppPage.js", import.meta.url), "utf8");

    expect(source).toContain("closeProjectRuntimeForSlug");
    expect(source).toContain("PROJECT_RUNTIME_CLOSE_API_PATH");
    expect(source).toContain("PROJECT_RUNTIME_OPEN_API_PATH");
    expect(source).not.toContain("onBeforeRouteLeave");
    expect(source).not.toContain("project-route-leave");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("pagehide");
  });

  it("matches project runtime closed realtime events for the active project", () => {
    expect(projectRuntimeClosedPayloadMatches({
      action: "runtime-closed",
      projectSlug: "alpha",
      runtime: {
        open: false
      }
    }, "alpha")).toBe(true);

    expect(projectRuntimeClosedPayloadMatches({
      action: "runtime-closed",
      projectSlug: "beta",
      runtime: {
        open: false
      }
    }, "alpha")).toBe(false);

    expect(projectRuntimeClosedPayloadMatches({
      action: "runtime-closed",
      projectSlug: "alpha",
      runtime: {
        open: true
      }
    }, "alpha")).toBe(false);

    expect(projectRuntimeClosedPayloadMatches({
      projectSlug: "alpha",
      runtime: {
        open: false
      }
    }, "alpha")).toBe(false);
  });
});
