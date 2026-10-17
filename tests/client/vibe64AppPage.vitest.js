import { readFileSync } from "node:fs";
import { createRenderer, defineComponent, h, nextTick, Teleport, vShow, withDirectives, onBeforeUnmount, reactive, ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIBE64_COLLEAGUE_LAYOUT_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY } from "../../src/lib/vibe64AssistantHost.js";

const pageFixture = vi.hoisted(() => ({ route: null, router: null }));
vi.mock("vue-router", async importOriginal => ({
  ...await importOriginal(),
  useRoute: () => pageFixture.route,
  useRouter: () => pageFixture.router
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) { pageFixture.realtime?.push(options); }
}));
vi.mock("@tanstack/vue-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => ({ report: vi.fn() }) }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: options => pageFixture.commands?.[options.apiSuffix] || ({ canRun: false, isRunning: false, run: vi.fn() })
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

function mountAppPage({ mobile = true, path = "/app/project/practice", withLearningChild = false, mode = "", commands = null } = {}) {
  pageFixture.commands = commands; pageFixture.realtime = [];
  pageFixture.route = reactive({ path, params: { slug: "practice" }, query: mode ? { mode } : {} });
  pageFixture.router = { push: vi.fn(async () => {}), afterEach: vi.fn(() => () => {}) };
  const media = { matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("window", { matchMedia: () => media });
  const layout = shallowRef(null), view = shallowRef(null);
  const learningLayout = { projectSlug: "saved-practice", learningAttemptId: "saved-attempt", learnerId: "own", ready: true,
    projectVisible: true, chatVisible: true };
  const learningView = { learningBinding: { learningAttemptId: "saved-attempt", learnerId: "own" }, ready: true };
  const learningChild = defineComponent({ setup() {
    layout.value = learningLayout; view.value = learningView;
    onBeforeUnmount(() => { if (layout.value === learningLayout) layout.value = null; if (view.value === learningView) view.value = null; });
    return () => null;
  } });
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
    return () => withLearningChild ? h(learningChild) : null;
  } }));
  app.provide(VIBE64_COLLEAGUE_LAYOUT_KEY, layout);
  app.provide(VIBE64_COLLEAGUE_VIEW_KEY, view);
  app.provide(VIBE64_TRAINING_LEARNER_GESTURE_KEY, gestures);
  app.mount({});
  mountedPages.push(app);
  page.handleProjectSelectionReady({ currentProject: { slug: "practice" } });
  return { page, layout, view, learningLayout, learningView, event, begin, finish, media, app };
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

  it.each([true, false])("retains Learning route identity through Dashboard and Preview (mobile=%s)", async mobile => {
    const { page, event } = mountAppPage({ mobile, mode: "learning" });
    Object.assign(pageFixture.route.query, { learningView: "workspace", session: "saved-learning-session" });
    const query = { ...pageFixture.route.query };
    page.selectProjectPane("dashboard", event);
    expect(pageFixture.router.push).toHaveBeenLastCalledWith({ path: "/app/project/practice/dashboard/env", query });
    pageFixture.route.path = "/app/project/practice/dashboard/files";
    await nextTick();
    page.selectProjectPane("preview", event);
    expect(pageFixture.router.push).toHaveBeenLastCalledWith({ path: "/app/project/practice", query });
    pageFixture.route.path = "/app/project/practice";
    await nextTick();
    page.selectProjectPane("dashboard", event);
    expect(pageFixture.router.push).toHaveBeenLastCalledWith({ path: "/app/project/practice/dashboard/files", query });
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


it("original parent mount cannot overwrite an already selected Learning child and only the live Working page reclaims release", () => {
  const fixture = mountAppPage({ withLearningChild: true });
  expect(fixture.view.value).toBe(fixture.learningView);
  expect(fixture.layout.value).toBe(fixture.learningLayout);
  fixture.view.value = null;
  const workingLayout = fixture.layout.value;
  expect(workingLayout).not.toBe(fixture.learningLayout); expect(workingLayout.projectSlug).toBe("practice");
  expect(workingLayout.ready).toBe(true);
  fixture.layout.value = fixture.learningLayout; fixture.view.value = fixture.learningView;
  fixture.app.unmount(); mountedPages.splice(mountedPages.indexOf(fixture.app), 1);
  expect(fixture.view.value).toBeNull(); expect(fixture.layout.value).toBeNull();
});


it("keeps mounted preview controls valid while Learning hides the Working toolbar target", async () => {
  const source = readFileSync(new URL("../../src/pages/app/project/[slug].vue", import.meta.url), "utf8");
  const expression = source.match(/:preview-toolbar-teleport-target="([^"]+)"/u)[1];
  const targetForMode = new Function("learningPaneActive", "previewToolbarTeleportTarget", `return (${expression});`);
  const host = source.match(/<div\s+v-if="([^"]+)"\s+v-show="([^"]+)"\s+:id="previewToolbarHostId"/u);
  const hostPresent = new Function("previewToolbarHostVisible", "learningPaneActive", `return (${host[1]});`);
  const hostShown = new Function("learningPaneActive", `return (${host[2]});`);
  const node = (tag, text = "") => ({ tag, text, props: {}, style: {}, children: [], parent: null });
  const root = node("root");
  const findTarget = parent => parent.props.id === "studio-home-shell-preview-toolbar"
    ? parent : parent.children.map(findTarget).find(Boolean);
  const detach = child => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = null;
  };
  const renderer = createRenderer({
    createElement: tag => node(tag), createText: text => node("text", text),
    createComment: text => node("comment", text),
    insert(child, parent, anchor) {
      detach(child); child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
    },
    remove: detach, parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
    setText: (child, text) => { child.text = text; },
    setElementText: (child, text) => { child.text = text; child.children = []; },
    patchProp: (child, key, _previous, value) => { child.props[key] = value; },
    querySelector: selector => selector === "body" ? root : findTarget(root)
  });
  const mode = ref(false), text = ref("initial"), errors = [], warnings = [], controls = [];
  const Controls = defineComponent({ props: ["target", "text"], setup(props) {
    const owner = {}; controls.push(owner);
    return () => h("section", [h(Teleport, { defer: true, disabled: !props.target, to: props.target || "body" },
      [h("span", { title: props.text }, props.text)])]);
  } });
  let learningOpened = false;
  const app = renderer.createApp(defineComponent({ setup() {
    return () => {
      if (mode.value) learningOpened = true;
      const target = targetForMode(mode.value, "#studio-home-shell-preview-toolbar");
      return h("main", [
        hostPresent(true, mode.value) ? withDirectives(h("div", { id: "studio-home-shell-preview-toolbar" }),
          [[vShow, hostShown(mode.value)]]) : null,
        h(Controls, { key: "working", target: mode.value ? "" : target, text: text.value }),
        learningOpened ? h(Controls, { key: "learning", target: mode.value ? target : "", text: text.value }) : null
      ]);
    };
  } }));
  app.config.errorHandler = error => errors.push(error);
  app.config.warnHandler = message => warnings.push(message);
  app.mount(root); mountedPages.push(app); await nextTick();
  const working = controls[0];
  expect(findTarget(root)).toBeTruthy();
  mode.value = true; await nextTick();
  const learning = controls[1];
  expect(findTarget(root)).toBeTruthy();
  expect(findTarget(root).style.display).toBe("none");
  text.value = "updated after the mode change"; await nextTick();
  expect(errors).toEqual([]); expect(warnings).toEqual([]);
  mode.value = false; await nextTick();
  expect(findTarget(root)).toBeTruthy();
  expect(findTarget(root).style.display).not.toBe("none");
  expect(controls).toEqual([working, learning]);
  expect(errors).toEqual([]); expect(warnings).toEqual([]);
});


it("retains selected Learning on outer idle close and uses original Open readiness when returning to Working", async () => {
  let confirmReturn;
  const open = { canRun: true, isRunning: false, run: vi.fn()
    .mockResolvedValueOnce({ ok: true, runtime: { open: true } })
    .mockImplementationOnce(() => new Promise(resolve => { confirmReturn = resolve; })) };
  const f = mountAppPage({ withLearningChild: true, mode: "learning",
    commands: { "/vibe64/project-runtime/open": open } });
  await Promise.resolve(); await nextTick();
  expect(f.page.projectRuntimeReady.value).toBe(true);
  expect(open.run).toHaveBeenCalledExactlyOnceWith({ projectSlug: "practice", reason: "project-open" });
  const selected = f.view.value, layout = f.layout.value;
  selected.draft = "Retain my exact Learning draft";
  const listener = pageFixture.realtime.find(item => item.matches({ payload: {
    projectSlug: "practice", action: "runtime-closed", runtime: { open: false } } }));
  const idle = { projectSlug: "practice", action: "runtime-closed", runtime: { open: false }, runtimeCloseReason: "idle-timeout", runtimeDormantClose: true };
  expect(listener.matches({ payload: { ...idle, projectSlug: "foreign" } })).toBe(false);
  listener.onEvent({ payload: idle }); await nextTick();
  expect(pageFixture.router.push).not.toHaveBeenCalled();
  expect(f.page.projectRuntimeReady.value).toBe(false);
  expect(f.view.value).toBe(selected); expect(f.layout.value).toBe(layout);
  expect(f.view.value.draft).toBe("Retain my exact Learning draft"); expect(layout.ready).toBe(true);
  expect(open.run).toHaveBeenCalledTimes(1);
  delete pageFixture.route.query.mode;
  await nextTick();
  expect(open.run).toHaveBeenCalledTimes(2);
  expect(open.run).toHaveBeenLastCalledWith({ projectSlug: "practice", reason: "project-open" });
  expect(f.page.projectRuntimeReady.value).toBe(false);
  confirmReturn({ ok: true, runtime: { open: true } });
  await Promise.resolve(); await nextTick();
  expect(f.page.projectRuntimeReady.value).toBe(true);
  expect(f.view.value).toBe(selected); expect(selected.draft).toBe("Retain my exact Learning draft");
});

it("keeps explicit Close and non-idle or unselected Learning closure on the original project redirect", () => {
  for (const reason of ["project-close", "project-delete", "project-runtime-marker-missing", "idle-timeout", ""]) {
    const f = mountAppPage({ withLearningChild: true, mode: "learning" });
    const payload = { projectSlug: "practice", action: "runtime-closed", runtime: { open: false }, runtimeCloseReason: reason };
    const listener = pageFixture.realtime.find(item => item.matches({ payload }));
    listener.onEvent({ payload });
    expect(pageFixture.router.push).toHaveBeenCalledExactlyOnceWith({ path: "/app/manage/projects", query: { projectClosed: "practice" } });
    expect(f.page.pageError.value).toBe("Project is closed.");
  }
  for (const options of [{ withLearningChild: true }, { mode: "learning" }]) {
    mountAppPage(options);
    const payload = { projectSlug: "practice", action: "runtime-closed", runtime: { open: false }, runtimeCloseReason: "idle-timeout", runtimeDormantClose: true };
    const listener = pageFixture.realtime.find(item => item.matches({ payload }));
    listener.onEvent({ payload });
    expect(pageFixture.router.push).toHaveBeenCalledExactlyOnceWith({ path: "/app/manage/projects", query: { projectClosed: "practice" } });
  }
});


it("rejects a late original Open result after Learning retained an authoritative outer dormant close", async () => {
  for (const lateError of [false, true]) {
    let finishInitial, finishReturn;
    const open = { canRun: true, isRunning: false, run: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve, reject) => { finishInitial = lateError ? reject : resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishReturn = resolve; })) };
    const f = mountAppPage({ withLearningChild: true, mode: "learning",
      commands: { "/vibe64/project-runtime/open": open } });
    const payload = { projectSlug: "practice", action: "runtime-closed", runtime: { open: false },
      runtimeCloseReason: "idle-timeout", runtimeDormantClose: true };
    const listener = pageFixture.realtime.find(item => item.matches({ payload }));
    listener.onEvent({ payload });
    finishInitial(lateError ? new Error("Late retired Open failure") : { ok: true, runtime: { open: true } });
    await Promise.resolve(); await nextTick();
    expect(f.page.projectRuntimeReady.value).toBe(false);
    expect(f.page.projectRuntimeError.value).toBe("");
    expect(f.view.value).toBe(f.learningView); expect(f.layout.value).toBe(f.learningLayout);
    expect(pageFixture.router.push).not.toHaveBeenCalled(); expect(open.run).toHaveBeenCalledTimes(1);
    delete pageFixture.route.query.mode; await nextTick();
    expect(open.run).toHaveBeenCalledTimes(2); expect(f.page.projectRuntimeReady.value).toBe(false);
    finishReturn({ ok: true, runtime: { open: true } }); await Promise.resolve(); await nextTick();
    expect(f.page.projectRuntimeReady.value).toBe(true);
  }
});
