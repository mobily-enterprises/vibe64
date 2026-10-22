import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from "vue-router";
import {
  mdiApplicationOutline,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiViewDashboardOutline
} from "@mdi/js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useQueryClient } from "@tanstack/vue-query";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { vibe64RealtimePayloadFromCurrentTab } from "@/lib/vibe64BrowserTabOrigin.js";
import { VIBE64_COLLEAGUE_LAYOUT_KEY } from "@/lib/vibe64AssistantHost.js";
import { invalidateGithubIssueQueries } from "@/lib/vibe64GithubProject.js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";
import {
  useVibe64ProjectsResource
} from "@/composables/useVibe64ProjectsResource.js";
import {
  projectAppPath,
  projectSlugFromRoute
} from "@/lib/vibe64ProjectScope.js";
import {
  scopedDevelopmentApiUrl
} from "@/lib/studioUrls.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  VIBE64_PROJECT_CHANGED_EVENT
} from "@/lib/studioGateApi.js";
import { isPracticeProjectSlug, projectDisplayName } from "@/lib/vibe64PracticeProjectName.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const HOME_SHELL_CLASS = "studio-home-shell-active";
const SELF_TARGET_AUTO_SELECT_DELAY_MS = 3000;
const PREVIEW_TOOLBAR_HOST_ID = "studio-home-shell-preview-toolbar";
const PROJECT_RUNTIME_CLOSE_API_PATH = "/api/vibe64/project-runtime/close";
const PROJECT_RUNTIME_OPEN_API_PATH = "/api/vibe64/project-runtime/open";
// The project panes the header's Preview | Dash switch chooses between. Learn
// mode's Lesson pane is not one of them: the lesson step bar's Lesson button
// shows it, and while it shows neither of these is selected. A lesson without
// a practice project is the lesson alone: no switch.
const PROJECT_PANES = Object.freeze({
  preview: Object.freeze({ id: "preview", label: "Preview", name: "Preview", icon: mdiApplicationOutline }),
  dashboard: Object.freeze({ id: "dashboard", label: "Dash", name: "Dashboard", icon: mdiViewDashboardOutline })
});

function projectPaneTabs({ projectSlug = "", lesson = false } = {}) {
  const { preview, dashboard } = PROJECT_PANES;
  return !projectSlug && lesson ? [] : [preview, dashboard];
}

// The phone's "next pane" pill: the pane after the shown one, in tab order
// (from the Lesson pane, the first).
function nextProjectPane(tabs = [], pane = "") {
  const index = tabs.findIndex(tab => tab.id === pane);
  const next = tabs[(index + 1) % tabs.length] || null;
  return next && { ariaLabel: `Go to ${next.name.toLowerCase()}`, icon: next.icon, label: next.label, name: next.name, pane: next.id };
}

function useVibe64AppPage() {
  const route = useRoute();
  const router = useRouter();
  const pageTitle = ref("");
  const pageError = ref("");
  const chatCollapsed = ref(false);
  const mobilePaneLayout = ref(false);
  const projectSelectionReady = ref(false);
  const projectPaneNavigationReadySlug = ref("");
  const lastDashboardRoutePath = ref("");
  let mobilePaneMediaQuery = null;
  const projectSlug = computed(() => projectSlugFromRoute(route));
  const queryClient = useQueryClient();
  const feedback = useShellWebErrorRuntime();
  const projectOpenRevision = ref(0);
  const projectOpenKey = computed(() => `${projectSlug.value}:${projectOpenRevision.value}`);
  const openedProjectKey = ref("");
  const projectOpenFailure = ref(null);
  const projectRuntimeReady = computed(() => !projectSlug.value || openedProjectKey.value === projectOpenKey.value);
  const projectRuntimeError = computed(() => projectOpenFailure.value?.key === projectOpenKey.value
    ? projectOpenFailure.value.message : "");
  let attemptedProjectOpenKey = "";
  const projectSelection = useVibe64ProjectsResource({
    // No project open (a lesson without a practice project): nothing to read.
    enabled: computed(() => Boolean(projectSlug.value)),
    fallbackLoadError: "Project selection could not load.",
    projectSlug,
    requestRecoveryLabel: "Project selection"
  });
  const closeProjectRuntimeCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/project-runtime/close",
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: scopedDevelopmentApiUrl(PROJECT_RUNTIME_CLOSE_API_PATH, context?.projectSlug)
    }),
    buildRawPayload: (_model, { context }) => ({
      reason: String(context?.reason || "project-close")
    }),
    clearOnRouteChange: false,
    fallbackRunError: "Project runtime could not close.",
    messages: {
      error: "Project runtime could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.project-runtime.close",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const openProjectRuntimeCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/project-runtime/open",
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: scopedDevelopmentApiUrl(PROJECT_RUNTIME_OPEN_API_PATH, context?.projectSlug)
    }),
    buildRawPayload: (_model, { context }) => ({
      reason: String(context?.reason || "project-open")
    }),
    clearOnRouteChange: false,
    fallbackRunError: "Project runtime could not be marked open.",
    messages: {
      error: "Project runtime could not be marked open."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.project-runtime.open",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const projectLoadError = projectSelection.loadError;
  const projects = projectSelection.projects;
  const selfTargetAutoSelectProjectRepro = projectSelection.selfTargetAutoSelectProjectRepro;
  const learning = useVibe64Learning();
  // A practice project is named by its lesson (the current lesson, or the
  // read lesson when it owns this project), never by its training-<id> slug.
  const projectTitle = computed(() => {
    const slug = projectSlug.value;
    // No slug: Learn mode without a practice project (/app/learning).
    if (!slug) return "No project selected";
    const mode = learning?.mode;
    const lesson = learning?.lesson?.value;
    return projectDisplayName({ slug }, {
      lessonTitle: mode?.practiceSlug === slug ? mode.lessonTitle : lesson?.practiceProjectSlug === slug ? lesson.title : ""
    });
  });
  const developmentBasePath = computed(() => projectAppPath(projectSlug.value));
  const dashboardBasePath = computed(() => `${developmentBasePath.value}/dashboard`);
  const dashboardRouteActive = computed(() => normalizedPath(route.path).startsWith(`${dashboardBasePath.value}/`));
  // Learn mode's current lesson has a Lesson pane (?pane=lesson on the
  // project's base path, shown by the step bar's Lesson button; the only pane
  // without a project).
  const lessonPaneAvailable = computed(() => Boolean(learning?.learnMode && learning.lessonAttemptId));
  // Without a project the panes are empty and switch in place; the pane and
  // the dashboard section live in the address, so Learn mode's place keeps them.
  const emptyPane = computed(() => lessonPaneAvailable.value ? "lesson"
    : route.query?.pane === "dashboard" ? "dashboard" : "preview");
  const emptySection = computed(() => typeof route.query?.section === "string" ? route.query.section : "");
  const projectPane = computed(() => !projectSlug.value ? emptyPane.value
    : dashboardRouteActive.value ? "dashboard"
      : route.query?.pane === "lesson" && lessonPaneAvailable.value ? "lesson" : "preview");
  const projectTabs = computed(() => projectPaneTabs({ projectSlug: projectSlug.value, lesson: lessonPaneAvailable.value }));
  // A lesson without a practice project has no coding session, so no chat column.
  const chatColumnVisible = computed(() => Boolean(projectSlug.value) || !lessonPaneAvailable.value);
  const sortedProjects = computed(() => [...projects.value].sort((left, right) => left.slug.localeCompare(right.slug)));
  // Learn lists only the current lesson's practice project, beside Courses.
  const learnMode = computed(() => Boolean(learning?.learnMode));
  const switcherProjects = computed(() => {
    const open = openProjectSwitcherProjects(projects.value);
    return learnMode.value ? open.filter(project => project.slug === learning.mode?.practiceSlug) : open;
  });
  const chatToggleIcon = computed(() => {
    if (mobilePaneLayout.value) {
      return chatCollapsed.value ? mdiChevronLeft : mdiChevronRight;
    }
    return chatCollapsed.value ? mdiChevronRight : mdiChevronLeft;
  });
  const chatToggleTitle = computed(() => {
    if (mobilePaneLayout.value) {
      return chatCollapsed.value ? "Show chat" : "Show project";
    }
    return chatCollapsed.value ? "Show chat" : "Collapse chat";
  });
  const mobileProjectAction = computed(() => nextProjectPane(projectTabs.value, projectPane.value));
  const projectPaneNavigationVisible = computed(() => projectTabs.value.length > 1 && (!projectSlug.value || projectPaneNavigationReady({
    selectionReady: projectSelectionReady.value,
    projectSlug: projectSlug.value,
    readyProjectSlug: projectPaneNavigationReadySlug.value
  })));
  const mobileProjectActionVisible = computed(() => projectPaneNavigationVisible.value && mobilePaneLayout.value &&
    (chatCollapsed.value || !chatColumnVisible.value));
  const mobilePaneSwipeEnabled = computed(() => projectPaneNavigationVisible.value && mobilePaneLayout.value &&
    chatColumnVisible.value);
  const projectVisible = computed(() => !mobilePaneLayout.value || chatCollapsed.value || !chatColumnVisible.value);
  const colleagueLayout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY, null);
  const layoutOwner = {
    get projectSlug() { return projectSlug.value; },
    get ready() { return projectPaneNavigationVisible.value; },
    get projectVisible() { return projectVisible.value; },
    // The Lesson pane is on screen (Colleague's focus reports pane=lesson).
    get lessonVisible() { return projectVisible.value && projectPane.value === "lesson"; },
    // The project side shows the Lesson pane (the step bar's Lesson button is pressed).
    get lessonPane() { return projectPane.value === "lesson"; },
    get chatVisible() { return chatColumnVisible.value && !chatCollapsed.value; },
    showProject: showProjectPane,
    showChat() { setChatCollapsed(false); }
  };
  const previewToolbarHostVisible = computed(() => previewToolbarTargetVisible({
    chatCollapsed: chatCollapsed.value,
    mobilePaneLayout: mobilePaneLayout.value,
    projectPane: projectPane.value,
    projectPaneNavigationVisible: projectPaneNavigationVisible.value
  }));
  const previewToolbarTeleportTarget = computed(() => (
    previewToolbarHostVisible.value ? `#${PREVIEW_TOOLBAR_HOST_ID}` : ""
  ));
  let selfTargetAutoSelectTimer = 0;
  let selfTargetAutoSelectAttemptKey = "";

  useStudioShellDrawer({
    hidden: true
  });

  useRealtimeEvent({
    enabled: computed(() => Boolean(projectSlug.value)),
    event: VIBE64_PROJECT_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => projectRuntimeClosedPayloadMatches(payload, projectSlug.value, {
      practice: isPracticeProjectSlug(projectSlug.value)
    }),
    onEvent: ({ payload = {} } = {}) => {
      handleProjectRuntimeClosed(payload);
    }
  });

  useRealtimeEvent({
    event: VIBE64_PROJECT_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value && payload.githubRefresh === true,
    onEvent: async () => {
      const issuesPath = scopedDevelopmentApiUrl("/api/vibe64/issues", projectSlug.value);
      const labelsPath = scopedDevelopmentApiUrl("/api/vibe64/issue-labels", projectSlug.value);
      const mentionsPath = scopedDevelopmentApiUrl("/api/vibe64/issue-mentions", projectSlug.value);
      const prsPath = scopedDevelopmentApiUrl("/api/vibe64/pull-requests", projectSlug.value);
      const incomingPath = scopedDevelopmentApiUrl("/api/vibe64/incoming", projectSlug.value);
      await queryClient.invalidateQueries({
        predicate: ({ queryKey }) => {
          if (!Array.isArray(queryKey)) return false;
          const [resource, path] = queryKey;
          return (resource === "vibe64.issues" && path === issuesPath) ||
          (resource === "vibe64.issue" && path?.startsWith(`${issuesPath}/`)) ||
          (resource === "vibe64.issueLabels" && path === labelsPath) ||
          (resource === "vibe64.issueMentions" && path === mentionsPath) ||
          (["vibe64.pullRequests", "vibe64.pullRequest"].includes(resource) && path === prsPath) ||
          (resource === "vibe64.incoming" && path === incomingPath);
        }
      });
    }
  });

  useRealtimeEvent({
    event: VIBE64_PROJECT_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value &&
      Number.isSafeInteger(payload.issueComment?.number) && payload.issueComment.number > 0 &&
      !vibe64RealtimePayloadFromCurrentTab(payload),
    onEvent: async ({ payload }) => {
      const comment = payload.issueComment;
      const basePath = scopedDevelopmentApiUrl("/api/vibe64/issues", projectSlug.value);
      feedback.report({
        source: "vibe64.issues.activity",
        message: `${comment.author || 'Someone'} commented on issue #${comment.number}.`,
        intent: "action-feedback",
        severity: "info",
        channel: "snackbar",
        dedupeKey: `vibe64.issueComment:${payload.projectSlug}:${comment.id}`
      });
      await invalidateGithubIssueQueries(queryClient, basePath, `${basePath}/${comment.number}`);
    }
  });

  watch(
    () => route.path,
    (path) => {
      if (normalizedPath(path) !== normalizedPath(developmentBasePath.value)) {
        setPageTitle();
      }
    },
    { immediate: true }
  );

  watch(projectSlug, retryProjectRuntime, { flush: "sync" });
  // A phone shows one surface: opening the Lesson pane (a started lesson,
  // Colleague) shows the project side.
  watch(projectPane, pane => {
    if (pane === "lesson" && mobilePaneLayout.value) setChatCollapsed(true);
  });
  watch(
    [projectOpenKey, () => openProjectRuntimeCommand.canRun, () => openProjectRuntimeCommand.isRunning],
    ([key, canRun, running]) => {
      if (!projectSlug.value || !canRun || running || attemptedProjectOpenKey === key) return;
      attemptedProjectOpenKey = key;
      void openProjectRuntimeForSlug(projectSlug.value, { key });
    },
    { immediate: true }
  );
  const removeProjectNavigation = router.afterEach((to, _from, failure) => {
    if (projectRuntimeError.value &&
        isNavigationFailure(failure, NavigationFailureType.duplicated) &&
        projectSlugFromRoute(to) === projectSlug.value) {
      retryProjectRuntime();
    }
  });

  onMounted(() => {
    setHomeShellActive(true);
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      mobilePaneMediaQuery = window.matchMedia("(max-width: 980px)");
      syncMobilePaneLayout();
      if (typeof mobilePaneMediaQuery.addEventListener === "function") {
        mobilePaneMediaQuery.addEventListener("change", syncMobilePaneLayout);
      } else {
        mobilePaneMediaQuery.addListener?.(syncMobilePaneLayout);
      }
    }
    if (colleagueLayout) colleagueLayout.value = layoutOwner;
  });

  onBeforeUnmount(() => {
    if (colleagueLayout?.value === layoutOwner) colleagueLayout.value = null;
    removeProjectNavigation();
    clearSelfTargetAutoSelectTimer();
    setHomeShellActive(false);
    if (typeof mobilePaneMediaQuery?.removeEventListener === "function") {
      mobilePaneMediaQuery.removeEventListener("change", syncMobilePaneLayout);
    } else {
      mobilePaneMediaQuery?.removeListener?.(syncMobilePaneLayout);
    }
    mobilePaneMediaQuery = null;
  });

  watch(() => [
    projectSlug.value,
    projectSelection.isLoading.value ? "loading" : "ready",
    selfTargetAutoSelectProjectRepro.value?.enabled === true ? "enabled" : "disabled",
    selfTargetAutoSelectProjectRepro.value?.selfTarget === true ? "self-target" : "normal",
    selfTargetAutoSelectProjectRepro.value?.projectSlug || "",
    sortedProjects.value.map((project) => project.slug).join("\0")
  ].join("|"), () => {
    scheduleSelfTargetProjectAutoSelect();
  }, {
    immediate: true
  });

  watch(() => [
    dashboardBasePath.value,
    route.path
  ].join("|"), () => {
    if (dashboardRouteActive.value) {
      lastDashboardRoutePath.value = normalizedPath(route.path);
    }
  }, {
    immediate: true
  });

  return {
    chatCollapsed,
    chatColumnVisible,
    chatToggleIcon,
    chatToggleTitle,
    closeProjectRuntimeForSlug,
    dashboardRouteActive,
    emitPageTitle,
    handleProjectSelectionDeleted,
    handleProjectSelectionError,
    handleProjectSelectionMissing,
    handleProjectSelectionReady,
    mdiChevronDown,
    mdiChevronRight,
    mobilePaneSwipeEnabled,
    mobileProjectAction,
    mobileProjectActionVisible,
    openProject,
    pageError,
    pageTitle,
    previewToolbarHostId: PREVIEW_TOOLBAR_HOST_ID,
    previewToolbarHostVisible,
    previewToolbarTeleportTarget,
    projectLoadError,
    projectPane,
    emptySection,
    selectEmptySection: section => void router.replace({ query: { ...route.query, pane: "dashboard", section } }),
    projectPaneNavigationVisible,
    projectRuntimeError,
    projectRuntimeReady,
    projectSlug,
    projectTabs,
    retryProjectRuntime,
    selectProjectPane,
    setChatCollapsed,
    showProjectPane,
    switcherProjects,
    learnMode,
    projectTitle
  };

  function setHomeShellActive(active) {
    if (typeof document === "undefined") {
      return;
    }
    document.body.classList.toggle(HOME_SHELL_CLASS, Boolean(active));
  }

  function setPageTitle(title = "") {
    pageTitle.value = String(title || "").trim();
  }

  function emitPageTitle(title = "") {
    setPageTitle(title);
  }

  function selectProjectPane(pane = "") {
    const known = pane === "lesson" && lessonPaneAvailable.value ? pane
      : projectTabs.value.some(tab => tab.id === pane) ? pane : "preview";
    if (!projectSlug.value) {
      void router.replace({ query: { ...route.query, pane: known } });
      return;
    }
    if (mobilePaneLayout.value) {
      setChatCollapsed(true);
    }
    if (known === "lesson") {
      void router.push({ path: developmentBasePath.value, query: { pane: "lesson" } });
      return;
    }
    if (known === "dashboard") {
      void router.push(dashboardReturnPath({
        dashboardBasePath: dashboardBasePath.value,
        lastDashboardRoutePath: lastDashboardRoutePath.value
      }));
      return;
    }
    void router.push(developmentBasePath.value);
  }

  function openProject(project = {}) {
    const slug = String(project.slug || "").trim();
    if (!slug) {
      return;
    }
    if (slug === projectSlug.value && route.path !== projectAppPath(slug)) {
      retryProjectRuntime();
    }
    void router.push(projectAppPath(slug));
  }

  async function closeProjectRuntimeForSlug(slug = "", {
    reason = "project-close"
  } = {}) {
    const project = String(slug || "").trim();
    if (!project) {
      return null;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.projectRuntime.close.start", {
      projectSlug: project,
      reason
    });
    try {
      const result = await closeProjectRuntimeCommand.run({
        projectSlug: project,
        reason
      });
      vibe64SessionDebugLog("client.projectRuntime.close.done", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        ok: result?.ok !== false,
        projectSlug: project,
        reason
      });
      return result;
    } catch (error) {
      vibe64SessionDebugLog("client.projectRuntime.close.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        projectSlug: project,
        reason
      });
      return null;
    }
  }

  async function openProjectRuntimeForSlug(slug = "", {
    reason = "project-open",
    key = projectOpenKey.value
  } = {}) {
    const project = String(slug || "").trim();
    if (!project) {
      return null;
    }
    try {
      const result = await openProjectRuntimeCommand.run({
        projectSlug: project,
        reason
      });
      if (result?.ok !== true || result?.runtime?.open !== true) {
        throw new Error(result?.error || "Project could not open. Try again.");
      }
      if (key === projectOpenKey.value) openedProjectKey.value = key;
      return result;
    } catch (error) {
      if (key === projectOpenKey.value) {
        projectOpenFailure.value = { key, message: String(error?.message || "Project could not open. Try again.") };
      }
      vibe64SessionDebugLog("client.projectRuntime.open.error", {
        error: vibe64SessionDebugError(error),
        projectSlug: project,
        reason
      });
      return null;
    }
  }

  function retryProjectRuntime() {
    projectOpenRevision.value += 1;
  }

  function handleProjectRuntimeClosed(payload = {}) {
    const closedSlug = String(payload.projectSlug || projectSlug.value || "").trim();
    pageError.value = String(payload.message || "Project is closed.");
    void router.push({
      path: "/app/manage/projects",
      query: {
        projectClosed: closedSlug
      }
    });
  }

  function scheduleSelfTargetProjectAutoSelect() {
    clearSelfTargetAutoSelectTimer();
    const targetProject = selfTargetAutoSelectProjectTarget({
      currentSlug: projectSlug.value,
      loading: projectSelection.isLoading.value,
      projects: sortedProjects.value,
      repro: selfTargetAutoSelectProjectRepro.value
    });
    if (!targetProject) {
      return;
    }
    const targetSlug = String(targetProject.slug || "").trim();
    const attemptKey = `${projectSlug.value}->${targetSlug}`;
    if (selfTargetAutoSelectAttemptKey === attemptKey || typeof globalThis.setTimeout !== "function") {
      return;
    }
    selfTargetAutoSelectTimer = globalThis.setTimeout(() => {
      selfTargetAutoSelectTimer = 0;
      selfTargetAutoSelectAttemptKey = attemptKey;
      openProject(targetProject);
    }, SELF_TARGET_AUTO_SELECT_DELAY_MS);
  }

  function clearSelfTargetAutoSelectTimer() {
    if (!selfTargetAutoSelectTimer || typeof globalThis.clearTimeout !== "function") {
      selfTargetAutoSelectTimer = 0;
      return;
    }
    globalThis.clearTimeout(selfTargetAutoSelectTimer);
    selfTargetAutoSelectTimer = 0;
  }

  function showProjectPane() {
    if (mobilePaneLayout.value) {
      setChatCollapsed(true);
    }
  }

  function setChatCollapsed(collapsed = false) {
    chatCollapsed.value = Boolean(collapsed);
  }

  function syncMobilePaneLayout() {
    mobilePaneLayout.value = Boolean(mobilePaneMediaQuery?.matches);
  }

  function handleProjectSelectionReady(selection = {}) {
    pageError.value = "";
    const selectedSlug = selectedProjectSlug(selection);
    setProjectPaneNavigationReady(Boolean(selectedSlug && selectedSlug === projectSlug.value));
    emitPageTitle();
  }

  function handleProjectSelectionMissing() {
    pageError.value = "";
    setProjectPaneNavigationReady(false);
    emitPageTitle("Choose project");
  }

  // The gate shows the deleted practice project's own notice; no page alert.
  function handleProjectSelectionDeleted() {
    pageError.value = "";
    setProjectPaneNavigationReady(false);
    emitPageTitle();
  }

  function handleProjectSelectionError(error) {
    pageError.value = String(error || "");
    setProjectPaneNavigationReady(false);
    emitPageTitle();
  }

  function setProjectPaneNavigationReady(ready = false) {
    projectSelectionReady.value = Boolean(ready);
    projectPaneNavigationReadySlug.value = ready ? projectSlug.value : "";
  }
}

function projectRuntimeClosedPayloadMatches(payload = {}, currentSlug = "", { practice = false } = {}) {
  const projectSlug = String(currentSlug || "").trim();
  if (!projectSlug || String(payload?.projectSlug || "").trim() !== projectSlug) {
    return false;
  }
  // Deleting an open practice project closes its runtime first. The project
  // page's selection gate then shows "This practice project is gone", so
  // the page must not leave for the hosted Projects page (absent locally).
  if (practice && String(payload?.runtimeCloseReason || "").trim() === "project-delete") {
    return false;
  }
  return String(payload?.action || "").trim() === "runtime-closed" && payload?.runtime?.open === false;
}

function openProjectSwitcherProjects(projects = []) {
  if (!Array.isArray(projects)) {
    return [];
  }
  return projects
    .filter((project) => project?.runtime?.open === true)
    .sort((left, right) => String(left?.slug || "").localeCompare(String(right?.slug || "")));
}

function selfTargetAutoSelectProjectTarget({
  currentSlug = "",
  loading = false,
  projects = [],
  repro = {}
} = {}) {
  const targetSlug = String(repro?.projectSlug || "").trim();
  if (
    repro?.enabled !== true ||
    repro?.selfTarget !== true ||
    !targetSlug ||
    loading ||
    String(currentSlug || "").trim() === targetSlug ||
    !Array.isArray(projects)
  ) {
    return null;
  }
  return projects.find((project) => project?.slug === targetSlug) || null;
}

function previewToolbarTargetVisible({
  chatCollapsed = false,
  mobilePaneLayout = false,
  projectPane = "",
  projectPaneNavigationVisible = false
} = {}) {
  return Boolean(
    projectPaneNavigationVisible &&
    projectPane === "preview" &&
    (!mobilePaneLayout || chatCollapsed)
  );
}

function dashboardReturnPath({
  dashboardBasePath = "",
  lastDashboardRoutePath = ""
} = {}) {
  const normalizedDashboardBasePath = normalizedPath(dashboardBasePath);
  const normalizedLastDashboardRoutePath = normalizedPath(lastDashboardRoutePath);
  const defaultDashboardPath = `${normalizedDashboardBasePath}/env`;
  if (
    normalizedLastDashboardRoutePath &&
    (
      normalizedLastDashboardRoutePath === normalizedDashboardBasePath ||
      normalizedLastDashboardRoutePath.startsWith(`${normalizedDashboardBasePath}/`)
    )
  ) {
    return normalizedLastDashboardRoutePath === normalizedDashboardBasePath
      ? defaultDashboardPath
      : normalizedLastDashboardRoutePath;
  }
  return defaultDashboardPath;
}

function projectPaneNavigationReady({
  selectionReady = false,
  projectSlug = "",
  readyProjectSlug = ""
} = {}) {
  const currentSlug = String(projectSlug || "").trim();
  return Boolean(
    selectionReady &&
    currentSlug &&
    String(readyProjectSlug || "").trim() === currentSlug
  );
}

function selectedProjectSlug(selection = {}) {
  const currentProject = selection?.currentProject && typeof selection.currentProject === "object" && !Array.isArray(selection.currentProject)
    ? selection.currentProject
    : {};
  return String(
    currentProject.slug ||
    selection?.projectSlug ||
    selection?.slug ||
    ""
  ).trim();
}

function normalizedPath(pathValue = "") {
  const path = String(pathValue || "").trim();
  if (!path || path === "/") {
    return path || "/";
  }
  return path.replace(/\/+$/u, "");
}

export {
  PREVIEW_TOOLBAR_HOST_ID,
  SELF_TARGET_AUTO_SELECT_DELAY_MS,
  dashboardReturnPath,
  nextProjectPane,
  openProjectSwitcherProjects,
  projectPaneTabs,
  projectPaneNavigationReady,
  projectRuntimeClosedPayloadMatches,
  previewToolbarTargetVisible,
  selfTargetAutoSelectProjectTarget,
  useVibe64AppPage
};
