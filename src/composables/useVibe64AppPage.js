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
import { invalidateGithubIssueQueries, invalidateGithubProjectQueries } from "@/lib/vibe64GithubProject.js";
import { normalizeRoutePath, routePathContainsSection } from "@/lib/routeActiveState.js";
import { vibe64SessionToolIdFromDashboardPath } from "@/lib/vibe64SessionToolDefinitions.js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";
import {
  useVibe64ProjectsResource
} from "@/composables/useVibe64ProjectsResource.js";
import {
  projectAppPath,
  projectListPath,
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
import { lessonShownIn, withoutLesson } from "@/lib/vibe64Learning.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const HOME_SHELL_CLASS = "studio-home-shell-active";
const PREVIEW_TOOLBAR_HOST_ID = "studio-home-shell-preview-toolbar";
// The selected session's recording indicator: in the header whenever a
// project is open, whichever pane or chat layout is showing.
const USAGE_RECORDING_HOST_ID = "studio-home-shell-usage-recording";
const PROJECT_RUNTIME_OPEN_API_PATH = "/api/vibe64/project-runtime/open";
// The project panes the header's Preview | Dash switch chooses between. Learn
// mode's lesson is not one of them: it is its own on/off flag (the Lesson
// toggle beside the switch, ?lesson=1), a sheet covering whichever of these
// is selected, which stays mounted under it. A lesson without a practice
// project is the lesson alone: no switch.
const PROJECT_PANES = Object.freeze({
  preview: Object.freeze({ id: "preview", label: "Preview", name: "Preview", icon: mdiApplicationOutline }),
  dashboard: Object.freeze({ id: "dashboard", label: "Dash", name: "Dashboard", icon: mdiViewDashboardOutline })
});

// A practice project is named by its lesson (the current lesson, or the read
// lesson when it owns this project), never by its training-<id> slug.
function projectHeaderTitle(slug = "", { mode = null, lesson = null } = {}) {
  // No slug: Learn mode without a practice project (/app/learning).
  if (!slug) return "No project selected";
  return projectDisplayName({ slug }, mode?.practiceSlug === slug ? { lessonTitle: mode.lessonTitle, lessonCode: mode.lessonCode }
    : lesson?.practiceProjectSlug === slug ? { lessonTitle: lesson.title, lessonCode: lesson.code } : {});
}

function projectPaneTabs({ projectSlug = "", lesson = false } = {}) {
  const { preview, dashboard } = PROJECT_PANES;
  return !projectSlug && lesson ? [] : [preview, dashboard];
}

// The phone's "next pane" pill: the pane after the selected one, in tab order.
function nextProjectPane(tabs = [], pane = "") {
  const index = tabs.findIndex(tab => tab.id === pane);
  const next = tabs[(index + 1) % tabs.length] || null;
  return next && { ariaLabel: `Go to ${next.name.toLowerCase()}`, icon: next.icon, label: next.label, name: next.name, pane: next.id };
}

function useVibe64AppPage() {
  const route = useRoute();
  const router = useRouter();
  const pageError = ref("");
  const chatCollapsed = ref(false);
  const mobilePaneLayout = ref(false);
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
  const learning = useVibe64Learning();
  const projectTitle = computed(() => projectHeaderTitle(projectSlug.value, {
    mode: learning?.mode, lesson: learning?.lesson?.value
  }));
  const developmentBasePath = computed(() => projectAppPath(projectSlug.value));
  const dashboardBasePath = computed(() => `${developmentBasePath.value}/dashboard`);
  const dashboardRouteActive = computed(() => routePathContainsSection(route.path, dashboardBasePath.value) &&
    normalizeRoutePath(route.path) !== normalizeRoutePath(dashboardBasePath.value));
  // Learn mode's current lesson has a Lesson sheet: over a practice project's
  // Preview or Dash while its flag is on (?lesson=1, the Lesson toggle); the
  // whole area without a project.
  const lessonPaneAvailable = computed(() => Boolean(learning?.learnMode && learning.lessonAttemptId));
  const lessonShown = computed(() => lessonPaneAvailable.value && (!projectSlug.value || lessonShownIn(route.query)));
  // Without a project the panes are empty and switch in place; the pane and
  // the dashboard section live in the address, so Learn mode's place keeps them.
  const emptyPane = computed(() => route.query?.pane === "dashboard" ? "dashboard" : "preview");
  const emptySection = computed(() => typeof route.query?.section === "string" ? route.query.section : "");
  const projectPane = computed(() => !projectSlug.value ? emptyPane.value
    : dashboardRouteActive.value ? "dashboard" : "preview");
  const projectTabs = computed(() => projectPaneTabs({ projectSlug: projectSlug.value, lesson: lessonPaneAvailable.value }));
  // A lesson without a practice project has no coding session, so no chat column.
  const chatColumnVisible = computed(() => Boolean(projectSlug.value) || !lessonPaneAvailable.value);
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
  const projectPaneNavigationVisible = computed(() => projectTabs.value.length > 1 &&
    (!projectSlug.value || projectPaneNavigationReadySlug.value === projectSlug.value));
  const mobileProjectActionVisible = computed(() => projectPaneNavigationVisible.value && mobilePaneLayout.value &&
    (chatCollapsed.value || !chatColumnVisible.value));
  const mobilePaneSwipeEnabled = computed(() => projectPaneNavigationVisible.value && mobilePaneLayout.value &&
    chatColumnVisible.value);
  const projectVisible = computed(() => !mobilePaneLayout.value || chatCollapsed.value || !chatColumnVisible.value);
  // Shown one side at a time (a phone), the header has room only for the
  // project name with that side's controls, so the Lesson toggle is on the
  // step bar there (`lessonToggleOnBar`), on both sides.
  const lessonToggleVisible = computed(() => Boolean(projectSlug.value) && lessonPaneAvailable.value && !mobilePaneLayout.value);
  const colleagueLayout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY, null);
  const layoutOwner = {
    get projectSlug() { return projectSlug.value; },
    get ready() { return projectPaneNavigationVisible.value; },
    get projectVisible() { return projectVisible.value; },
    // The lesson is on screen (Colleague's focus reports pane=lesson).
    get lessonVisible() { return projectVisible.value && lessonShown.value; },
    // The lesson's flag is on (the Lesson toggle is pressed).
    get lessonShown() { return lessonShown.value; },
    get lessonToggleOnBar() { return mobilePaneLayout.value; },
    hideLesson,
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
  const usageRecordingTeleportTarget = computed(() => (projectSlug.value ? `#${USAGE_RECORDING_HOST_ID}` : ""));

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
    onEvent: () => invalidateGithubProjectQueries(queryClient,
      scopedDevelopmentApiUrl("/api/vibe64/issues", projectSlug.value))
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

  watch(projectSlug, retryProjectRuntime, { flush: "sync" });
  // A phone shows one surface: showing the lesson (a started lesson,
  // Colleague) shows the project side.
  watch(lessonShown, shown => {
    if (shown && mobilePaneLayout.value) setChatCollapsed(true);
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
      // Opened at a session tool's address (a link, reload or Back to Files),
      // a phone shows that tool's side from its first frame. The tool asks for
      // it once its session loads; until then the phone would show the chat.
      if (mobilePaneLayout.value && vibe64SessionToolIdFromDashboardPath(route.path, dashboardBasePath.value)) {
        setChatCollapsed(true);
      }
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
    setHomeShellActive(false);
    if (typeof mobilePaneMediaQuery?.removeEventListener === "function") {
      mobilePaneMediaQuery.removeEventListener("change", syncMobilePaneLayout);
    } else {
      mobilePaneMediaQuery?.removeListener?.(syncMobilePaneLayout);
    }
    mobilePaneMediaQuery = null;
  });

  watch(() => [
    dashboardBasePath.value,
    route.path
  ].join("|"), () => {
    if (dashboardRouteActive.value) {
      lastDashboardRoutePath.value = normalizeRoutePath(route.path);
    }
  }, {
    immediate: true
  });

  return {
    chatCollapsed,
    chatColumnVisible,
    chatToggleIcon,
    chatToggleTitle,
    dashboardRouteActive,
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
    previewToolbarHostId: PREVIEW_TOOLBAR_HOST_ID,
    previewToolbarHostVisible,
    previewToolbarTeleportTarget,
    usageRecordingHostId: USAGE_RECORDING_HOST_ID,
    usageRecordingTeleportTarget,
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
    lessonShown,
    lessonToggleVisible,
    projectTitle
  };

  function setHomeShellActive(active) {
    if (typeof document === "undefined") {
      return;
    }
    document.body.classList.toggle(HOME_SHELL_CLASS, Boolean(active));
  }

  // The Lesson toggle pressed again: the flag goes off, uncovering the
  // Preview or Dash view underneath as it was.
  function hideLesson() {
    if (lessonShownIn(route.query)) void router.replace({ path: route.path, query: withoutLesson(route.query) });
  }

  // Preview or Dash: that pane, uncovered (the lesson's flag goes off).
  function selectProjectPane(pane = "") {
    const known = projectTabs.value.some(tab => tab.id === pane) ? pane : "preview";
    if (!projectSlug.value) {
      void router.replace({ query: { ...route.query, pane: known } });
      return;
    }
    if (mobilePaneLayout.value) {
      setChatCollapsed(true);
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
    // The host's project list says which project closed; without one, /app
    // resolves the project again.
    const listPath = projectListPath();
    void router.push(listPath ? { path: listPath, query: { projectClosed: closedSlug } } : "/app");
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
  }

  function handleProjectSelectionMissing() {
    pageError.value = "";
    setProjectPaneNavigationReady(false);
  }

  // The gate shows the deleted practice project's own notice; no page alert.
  function handleProjectSelectionDeleted() {
    pageError.value = "";
    setProjectPaneNavigationReady(false);
  }

  function handleProjectSelectionError(error) {
    pageError.value = String(error || "");
    setProjectPaneNavigationReady(false);
  }

  function setProjectPaneNavigationReady(ready = false) {
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
  // the page must not leave for the host's project list or /app.
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
  const base = normalizeRoutePath(dashboardBasePath);
  const last = normalizeRoutePath(lastDashboardRoutePath);
  return routePathContainsSection(last, base) && last !== base ? last : `${base}/env`;
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

export {
  PREVIEW_TOOLBAR_HOST_ID,
  dashboardReturnPath,
  nextProjectPane,
  openProjectSwitcherProjects,
  projectHeaderTitle,
  projectPaneTabs,
  projectRuntimeClosedPayloadMatches,
  previewToolbarTargetVisible,
  useVibe64AppPage
};
