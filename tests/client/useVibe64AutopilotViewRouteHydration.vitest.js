import { readFileSync } from "node:fs";
import { createApp, effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = reactive({
  path: "/app/project/chat-test/dashboard/files"
});
const router = {
  push: vi.fn(),
  replace: vi.fn()
};

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => router
}));
vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64ProjectSlug: () => ref("chat-test")
  };
});
vi.mock("@/composables/useVibe64AgentSettings.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64AgentSettings: () => ({
      settings: ref({
        model: "",
        providerId: "codex",
        thinking: ""
      }),
      update: vi.fn()
    })
  };
});
vi.mock("@/lib/vibe64AsyncComponent.js", () => ({
  defineVibe64AsyncComponent: ({ label = "Async component" } = {}) => ({
    name: label.replaceAll(" ", "")
  })
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  useVibe64Accounts: () => ({
    status: {
      value: null
    }
  })
}));

function viewProps() {
  return reactive({
    active: true,
    agentConnectionStatus: "connected",
    cancelAgentMessage: vi.fn(async () => true),
    chatCollapsed: false,
    conversationLog: {
      turns: []
    },
    interruptAgentTurn: vi.fn(async () => true),
    page: {},
    projectContext: {},
    projectPane: "dashboard",
    refreshSessionData: vi.fn(async () => null),
    retryWorkspaceSetup: vi.fn(async () => true),
    saveSessionWork: vi.fn(async () => ({ ok: true, status: "saved" })),
    sendAgentMessage: vi.fn(async () => true),
    session: {
      agentSession: {
        turn: {}
      },
      metadata: {},
      sessionId: "session-1",
      sessionRoot: "/tmp/state/session-1"
    },
    sessionArchive: {},
    sessionSelectionArchived: false,
    sessionsApiPath: "/api/sessions",
    sessionToolbar: {}
  });
}

describe("useVibe64AutopilotView route hydration", () => {
  let app;
  let scope;
  beforeEach(() => {
    app = createApp({});
    scope = effectScope();
    route.path = "/app/project/chat-test/dashboard/files";
    router.push.mockReset();
    router.replace.mockReset().mockImplementation(async (path) => {
      route.path = path;
    });
  });
  afterEach(() => scope.stop());

  it.each([
    { label: "Files", tool: "editor", segment: "files", component: "Vibe64SessionFiles" },
    { label: "Database", tool: "database", segment: "database", component: "Vibe64DatabaseWorkspace" },
    { label: "Cities", tool: "system", segment: "system", component: "Vibe64SystemWorldView" }
  ])("retains $label inactive across Preview and retires it on an explicit tool switch", async ({ tool, segment, component }) => {
    route.path = `/app/project/chat-test/dashboard/${segment}`;
    const props = viewProps();
    props.session = {
      ...props.session,
      metadata: {
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      }
    };
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url
    ), "utf8");
    const tag = autopilot.match(new RegExp(`<${component}\\b[\\s\\S]*?/>`, "u"))?.[0];
    const binding = tag?.match(/:active="([^"]+)"/u)?.[1];
    expect(binding).toBeDefined();
    const toolActive = new Function("props", "rightPaneTab", `return (${binding});`);

    expect(view.rightPaneTabMounted(tool)).toBe(true);
    expect(toolActive(props, view.rightPaneTab.value)).toBe(true);
    props.projectPane = "preview";
    route.path = "/app/project/chat-test";
    await nextTick();
    expect(toolActive(props, view.rightPaneTab.value)).toBe(false);
    expect(view.dashboardShellVisible.value).toBe(false);
    expect(view.rightPaneTabMounted(tool)).toBe(true);

    props.active = false;
    await nextTick();
    expect(view.rightPaneTabMounted(tool)).toBe(true);
    expect(toolActive(props, view.rightPaneTab.value)).toBe(false);
    props.active = true;
    props.projectPane = "dashboard";
    route.path = `/app/project/chat-test/dashboard/${segment}`;
    await nextTick();
    expect(view.rightPaneTabMounted(tool)).toBe(true);
    expect(toolActive(props, view.rightPaneTab.value)).toBe(true);
    expect(view.sessionId.value).toBe("session-1");

    const nextTool = tool === "editor" ? "database" : "editor";
    route.path = `/app/project/chat-test/dashboard/${nextTool === "editor" ? "files" : "database"}`;
    await nextTick();
    expect(view.rightPaneTabMounted(tool)).toBe(false);
    expect(view.rightPaneTabMounted(nextTool)).toBe(true);
    expect(toolActive(props, view.rightPaneTab.value)).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("does not mount a source tool on cold Preview even when source is ready", async () => {
    route.path = "/app/project/chat-test";
    const props = viewProps();
    props.projectPane = "preview";
    props.session.metadata = {
      source_kind: "session_clone",
      source_path: "/tmp/sessions/active/session-1/source",
      source_path_authority: "managed_session_source"
    };
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));

    expect(view.sessionSourceRoot.value).toBe("/tmp/sessions/active/session-1/source");
    for (const tool of ["editor", "database", "system", "ai-terminal"]) {
      expect(view.rightPaneTabMounted(tool)).toBe(false);
    }
    expect(view.dashboardShellVisible.value).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(["preview-displayed", "toolbar-teleport-target"])("keeps the actual %s binding active independently of a retained tool", (attribute) => {
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url
    ), "utf8");
    const tag = autopilot.match(/<Vibe64OutputControls\b[\s\S]*?\/>/u)?.[0];
    const binding = tag?.match(new RegExp(`:${attribute}="([^"]+)"`, "u"))?.[1];
    expect(binding).toBeDefined();
    const previewValue = new Function("props", "rightPaneTab", `return (${binding});`);
    const props = { projectPane: "preview", previewToolbarTeleportTarget: "#preview-toolbar" };
    const visible = attribute === "preview-displayed" ? true : "#preview-toolbar";
    const hidden = attribute === "preview-displayed" ? false : "";

    expect(previewValue(props, "preview")).toBe(visible);
    props.projectPane = "dashboard";
    expect(previewValue(props, "preview")).toBe(hidden);
    props.projectPane = "preview";
    for (const tool of ["editor", "database", "system"]) {
      expect(previewValue(props, tool)).toBe(visible);
    }
  });

  it("projects retained session activity without hiding the shared dashboard route", async () => {
    route.path = "/app/project/chat-test/dashboard/repository";
    const props = viewProps();
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));
    const requestSaveWork = view.dashboardSessionContext.value.requestSaveWork;

    expect(view.dashboardSessionContext.value.active).toBe(true);
    props.active = false;
    await nextTick();
    expect(view.dashboardSessionContext.value).toMatchObject({
      active: false, requestSaveWork, sessionId: "session-1"
    });
    expect(view.dashboardRouteVisible.value).toBe(true);

    props.active = true;
    await nextTick();
    expect(view.dashboardSessionContext.value).toMatchObject({
      active: true, requestSaveWork, sessionId: "session-1"
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("opens a directly routed source tool when the selected source arrives", async () => {
    const props = viewProps();
    const selectedSession = props.session;
    const emit = vi.fn();
    // A remembered session mounts its host before either list or detail is available.
    props.session = null;
    props.page.launchBusy = true;
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, emit)));

    expect(view.sessionSourceRoot.value).toBe("");
    expect(view.rightPaneTab.value).not.toBe("editor");
    expect(view.sourceToolLoading.value).toBe(true);
    expect(view.dashboardShellVisible.value).toBe(false);
    expect(emit).toHaveBeenCalledWith("project-attention");
    expect(route.path).toBe("/app/project/chat-test/dashboard/files");
    expect(router.replace).not.toHaveBeenCalled();
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url
    ), "utf8");
    const loadingTag = autopilot.match(/<Vibe64AsyncModuleState\b[\s\S]*?\/>/u)?.[0];
    expect(autopilot).toContain('import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue"');
    expect(loadingTag).toContain('v-if="sourceToolLoading"');
    expect(loadingTag).toContain('class="studio-autopilot__right-pane-page"');
    expect(loadingTag).toMatch(/\sloading\s/u);
    const shellTag = autopilot.match(/<Vibe64DashboardShell\b[^>]*>/u)?.[0];
    expect(shellTag).toContain('v-show="dashboardShellVisible"');

    props.session = {
      ...selectedSession,
      metadata: {
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      },
      source: "/tmp/sessions/active/session-1/source"
    };
    props.page.launchBusy = false;
    await nextTick();

    expect(view.sessionSourceRoot.value).toBe("/tmp/sessions/active/session-1/source");
    expect(view.rightPaneTab.value).toBe("editor");
    expect(view.sourceToolLoading.value).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(route.path).toBe("/app/project/chat-test/dashboard/files");

    props.page.launchBusy = true;
    await nextTick();
    expect(view.sourceToolLoading.value).toBe(false);
    expect(view.rightPaneTabMounted("editor")).toBe(true);
    props.page.launchBusy = false;

    route.path = "/app/project/chat-test/dashboard/env";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("dashboard");

    route.path = "/app/project/chat-test/dashboard/files";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("editor");
  });

  it.each([
    { outcome: "source unavailable", error: "" },
    { outcome: "detail error", error: "Session could not load." }
  ])("settles Files access after session detail on $outcome", async ({ error }) => {
    const props = viewProps();
    if (error) props.session = null;
    props.page = { busy: true, error: "", launchBusy: true };
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));

    expect(view.sessionSourceRoot.value).toBe("");
    expect(view.rightPaneTabMounted("editor")).toBe(false);
    expect(view.sourceToolLoading.value).toBe(true);
    expect(view.dashboardShellVisible.value).toBe(false);
    expect(route.path).toBe("/app/project/chat-test/dashboard/files");
    expect(router.replace).not.toHaveBeenCalled();

    // No source-path dependency changes; detail settlement must reconsider the route.
    // Unrelated dialog busy state is not session-detail readiness.
    props.page.error = error;
    props.page.launchBusy = false;
    await nextTick();

    expect(props.page.busy).toBe(true);
    expect(props.page.error).toBe(error);
    expect(view.sessionSourceRoot.value).toBe("");
    expect(view.sourceToolLoading.value).toBe(false);
    if (error) {
      expect(view.rightPaneTab.value).toBe("dashboard");
      expect(view.dashboardShellVisible.value).toBe(true);
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/app/project/chat-test/dashboard/env");
    } else {
      expect(view.rightPaneTab.value).toBe("editor");
      expect(view.dashboardShellVisible.value).toBe(false);
      expect(router.replace).not.toHaveBeenCalled();
      expect(route.path).toBe("/app/project/chat-test/dashboard/files");
    }
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each(["Health", "Preview"])("does not restore the cold Files route after navigating to %s while detail loads", async (destination) => {
    const props = viewProps();
    const selectedSession = props.session;
    props.session = null;
    props.page.launchBusy = true;
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));

    expect(view.sourceToolLoading.value).toBe(true);
    expect(view.dashboardShellVisible.value).toBe(false);
    expect(route.path).toBe("/app/project/chat-test/dashboard/files");
    expect(router.replace).not.toHaveBeenCalled();
    const nextPath = destination === "Health"
      ? "/app/project/chat-test/dashboard/health"
      : "/app/project/chat-test";
    route.path = nextPath;
    props.projectPane = destination === "Health" ? "dashboard" : "preview";
    await nextTick();
    expect(view.sourceToolLoading.value).toBe(false);
    expect(view.dashboardShellVisible.value).toBe(destination === "Health");
    expect(view.rightPaneTab.value).toBe(destination === "Health" ? "dashboard" : "preview");

    props.session = {
      ...selectedSession,
      metadata: {
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      }
    };
    props.page.launchBusy = false;
    await nextTick();

    expect(view.sessionSourceRoot.value).toBe("/tmp/sessions/active/session-1/source");
    expect(route.path).toBe(nextPath);
    expect(view.sourceToolLoading.value).toBe(false);
    expect(view.rightPaneTab.value).toBe(destination === "Health" ? "dashboard" : "preview");
    expect(view.rightPaneTabMounted("editor")).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "error", "ready"])("keeps B's Files route when hidden A settles %s and reconsiders A on return", async (outcome) => {
    const propsA = viewProps();
    const sessionA = propsA.session;
    const emitA = vi.fn();
    propsA.session = null;
    propsA.page.launchBusy = true;
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const viewA = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(propsA, emitA)));
    expect(viewA.sourceToolLoading.value).toBe(true);
    expect(emitA).toHaveBeenCalledWith("project-attention");
    const pendingSelectionA = viewA.rightPaneTab.value;
    emitA.mockClear();

    propsA.active = false;
    const propsB = viewProps();
    propsB.session = {
      ...propsB.session,
      sessionId: "session-2",
      sessionRoot: "/tmp/state/session-2",
      metadata: {
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-2/source",
        source_path_authority: "managed_session_source"
      }
    };
    // The second retained host has its own scope but uses the same live route/router.
    const scopeB = scope.run(() => effectScope());
    const viewB = app.runWithContext(() => scopeB.run(() => useVibe64AutopilotView(propsB, vi.fn())));
    await nextTick();
    expect(viewB.rightPaneTabMounted("editor")).toBe(true);
    expect(viewB.sessionId.value).toBe("session-2");

    propsA.session = outcome === "error" ? null : {
      ...sessionA,
      ...(outcome === "ready" ? {
        metadata: {
          source_kind: "session_clone",
          source_path: "/tmp/sessions/active/session-1/source",
          source_path_authority: "managed_session_source"
        }
      } : {})
    };
    propsA.page.error = outcome === "error" ? "Session A could not load." : "";
    propsA.page.launchBusy = false;
    await nextTick();

    expect(route.path).toBe("/app/project/chat-test/dashboard/files");
    expect(router.replace).not.toHaveBeenCalled();
    expect(viewB.rightPaneTabMounted("editor")).toBe(true);
    expect(viewB.sessionSourceRoot.value).toBe("/tmp/sessions/active/session-2/source");
    expect(viewA.rightPaneTab.value).toBe(pendingSelectionA);
    expect(emitA).not.toHaveBeenCalledWith("project-attention");

    propsB.active = false;
    propsA.active = true;
    await nextTick();

    if (outcome !== "error") {
      expect(route.path).toBe("/app/project/chat-test/dashboard/files");
      expect(router.replace).not.toHaveBeenCalled();
      expect(viewA.rightPaneTabMounted("editor")).toBe(true);
      expect(emitA.mock.calls.filter(([event]) => event === "project-attention")).toEqual([["project-attention"]]);
    } else {
      expect(route.path).toBe("/app/project/chat-test/dashboard/env");
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/app/project/chat-test/dashboard/env");
      expect(viewA.rightPaneTab.value).toBe("dashboard");
    }
    expect(viewB.rightPaneTabMounted("editor")).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("rehydrates the session Database route when warm source state is already available", async () => {
    route.path = "/app/project/chat-test/dashboard/database";
    const props = viewProps();
    props.session = {
      ...props.session,
      metadata: {
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      },
      source: "/tmp/sessions/active/session-1/source"
    };
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));

    expect(view.rightPaneTab.value).toBe("database");

    route.path = "/app/project/chat-test/dashboard";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("dashboard");

    route.path = "/app/project/chat-test/dashboard/database";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("database");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps a directly routed AI terminal open while assistant access hydrates", async () => {
    route.path = "/app/project/chat-test/dashboard/ai-terminal";
    const accessLoading = ref(true);
    const canUseAi = ref(false);
    const props = viewProps();
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn(), {
      assistantAccessLoading: accessLoading,
      assistantCanUseAi: canUseAi
    })));

    expect(view.rightPaneTab.value).toBe("ai-terminal");
    expect(router.replace).not.toHaveBeenCalled();

    canUseAi.value = true;
    accessLoading.value = false;
    await nextTick();

    expect(view.rightPaneTab.value).toBe("ai-terminal");
    expect(router.replace).not.toHaveBeenCalled();
  });
});
