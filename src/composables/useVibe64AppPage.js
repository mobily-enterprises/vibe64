import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight
} from "@mdi/js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
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
const projectTabs = Object.freeze([
  {
    id: "preview",
    label: "Preview"
  },
  {
    id: "dashboard",
    label: "Dashboard"
  }
]);

function useVibe64AppPage() {
  const route = useRoute();
  const router = useRouter();
  const pageTitle = ref("");
  const pageError = ref("");
  const chatCollapsed = ref(false);
  const mobilePaneLayout = ref(false);
  const savedProjectTypeReady = ref(false);
  const projectPaneNavigationReadySlug = ref("");
  let mobilePaneMediaQuery = null;
  const projectSlug = computed(() => projectSlugFromRoute(route));
  const projectSelection = useVibe64ProjectsResource({
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
  const projectLoadError = computed(() => projectSelection.loadError);
  const projects = computed(() => projectSelection.projects);
  const selfTargetAutoSelectProjectRepro = computed(() => projectSelection.selfTargetAutoSelectProjectRepro || {});
  const targetRoot = computed(() => String(projectSelection.targetRoot || "").trim());
  const targetFolderName = computed(() => projectSlug.value || finalPathSegment(targetRoot.value));
  const developmentBasePath = computed(() => projectAppPath(projectSlug.value));
  const dashboardBasePath = computed(() => `${developmentBasePath.value}/dashboard`);
  const dashboardRouteActive = computed(() => normalizedPath(route.path).startsWith(`${dashboardBasePath.value}/`));
  const projectPane = computed(() => dashboardRouteActive.value ? "dashboard" : "preview");
  const sortedProjects = computed(() => [...projects.value].sort((left, right) => left.slug.localeCompare(right.slug)));
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
  const mobileProjectAction = computed(() => (
    projectPane.value === "dashboard"
      ? {
          ariaLabel: "Go to preview",
          label: "Preview",
          pane: "preview"
        }
      : {
          ariaLabel: "Go to dashboard",
          label: "Dashboard",
          pane: "dashboard"
        }
  ));
  const projectPaneNavigationVisible = computed(() => projectPaneNavigationReady({
    projectSlug: projectSlug.value,
    projectTypeReady: savedProjectTypeReady.value,
    readyProjectSlug: projectPaneNavigationReadySlug.value
  }));
  const mobileProjectActionVisible = computed(() => projectPaneNavigationVisible.value && mobilePaneLayout.value && chatCollapsed.value);
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
    matches: ({ payload = {} } = {}) => projectRuntimeClosedPayloadMatches(payload, projectSlug.value),
    onEvent: ({ payload = {} } = {}) => {
      handleProjectRuntimeClosed(payload);
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

  watch(projectSlug, (slug) => {
    void openProjectRuntimeForSlug(slug);
  }, {
    immediate: true
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
  });

  onBeforeUnmount(() => {
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
    projectSelection.isLoading ? "loading" : "ready",
    selfTargetAutoSelectProjectRepro.value?.enabled === true ? "enabled" : "disabled",
    selfTargetAutoSelectProjectRepro.value?.selfTarget === true ? "self-target" : "normal",
    selfTargetAutoSelectProjectRepro.value?.projectSlug || "",
    sortedProjects.value.map((project) => project.slug).join("\0")
  ].join("|"), () => {
    scheduleSelfTargetProjectAutoSelect();
  }, {
    immediate: true
  });

  return {
    chatCollapsed,
    chatToggleIcon,
    chatToggleTitle,
    closeProjectRuntimeForSlug,
    dashboardRouteActive,
    emitPageTitle,
    handleProjectSelectionError,
    handleProjectSelectionMissing,
    handleProjectSelectionReady,
    handleProjectTypeError,
    handleProjectTypeMissing,
    handleProjectTypeReady,
    mdiChevronDown,
    mdiChevronRight,
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
    projectPaneNavigationVisible,
    projectSlug,
    projectTabs,
    selectProjectPane,
    setChatCollapsed,
    showProjectPane,
    sortedProjects,
    targetFolderName
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
    if (mobilePaneLayout.value) {
      setChatCollapsed(true);
    }
    if (pane === "dashboard") {
      void router.push(`${dashboardBasePath.value}/env`);
      return;
    }
    void router.push(developmentBasePath.value);
  }

  function openProject(project = {}) {
    const slug = String(project.slug || "").trim();
    if (!slug || slug === projectSlug.value) {
      return;
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
    reason = "project-open"
  } = {}) {
    const project = String(slug || "").trim();
    if (!project) {
      return null;
    }
    try {
      return await openProjectRuntimeCommand.run({
        projectSlug: project,
        reason
      });
    } catch (error) {
      vibe64SessionDebugLog("client.projectRuntime.open.error", {
        error: vibe64SessionDebugError(error),
        projectSlug: project,
        reason
      });
      return null;
    }
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
      loading: projectSelection.isLoading,
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

  function handleProjectTypeReady() {
    pageError.value = "";
    setProjectPaneNavigationReady(true);
  }

  function handleProjectSelectionReady(selection = {}) {
    pageError.value = "";
    const selectedSlug = selectedProjectSlug(selection);
    if (selectedSlug && selectedSlug !== projectSlug.value) {
      setProjectPaneNavigationReady(false);
    }
    emitPageTitle();
  }

  function handleProjectSelectionMissing() {
    pageError.value = "";
    setProjectPaneNavigationReady(false);
    emitPageTitle("Choose project");
  }

  function handleProjectSelectionError(error) {
    pageError.value = String(error || "");
    setProjectPaneNavigationReady(false);
    emitPageTitle();
  }

  function handleProjectTypeMissing(project = {}) {
    pageError.value = "";
    setProjectPaneNavigationReady(project?.projectType?.ready === true);
    emitPageTitle(project?.projectType?.ready === true ? "Project setup" : "Choose project type");
  }

  function handleProjectTypeError(error) {
    pageError.value = String(error || "");
    setProjectPaneNavigationReady(false);
    emitPageTitle();
  }

  function setProjectPaneNavigationReady(ready = false) {
    savedProjectTypeReady.value = Boolean(ready);
    projectPaneNavigationReadySlug.value = ready ? projectSlug.value : "";
  }
}

function projectRuntimeClosedPayloadMatches(payload = {}, currentSlug = "") {
  const projectSlug = String(currentSlug || "").trim();
  if (!projectSlug || String(payload?.projectSlug || "").trim() !== projectSlug) {
    return false;
  }
  return String(payload?.action || "").trim() === "runtime-closed" && payload?.runtime?.open === false;
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

function projectPaneNavigationReady({
  projectSlug = "",
  projectTypeReady = false,
  readyProjectSlug = ""
} = {}) {
  const currentSlug = String(projectSlug || "").trim();
  return Boolean(
    projectTypeReady &&
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

function finalPathSegment(pathValue = "") {
  const normalizedPath = String(pathValue || "").trim().replace(/[\\/]+$/u, "");
  if (!normalizedPath) {
    return "";
  }
  return normalizedPath.split(/[\\/]+/u).filter(Boolean).at(-1) || "";
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
  projectPaneNavigationReady,
  projectRuntimeClosedPayloadMatches,
  previewToolbarTargetVisible,
  selfTargetAutoSelectProjectTarget,
  useVibe64AppPage
};
