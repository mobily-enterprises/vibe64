import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight
} from "@mdi/js";
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
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const HOME_SHELL_CLASS = "studio-home-shell-active";
const SELF_TARGET_AUTO_SELECT_DELAY_MS = 3000;
const PREVIEW_TOOLBAR_HOST_ID = "studio-home-shell-preview-toolbar";
const PROJECT_RUNTIME_CLOSE_API_PATH = "/api/vibe64/project-runtime/close";
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
      reason: String(context?.reason || "project-route-leave")
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
  const projectPaneNavigationVisible = computed(() => savedProjectTypeReady.value);
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

  watch(
    () => route.path,
    (path) => {
      if (normalizedPath(path) !== normalizedPath(developmentBasePath.value)) {
        setPageTitle();
      }
    },
    { immediate: true }
  );

  onMounted(() => {
    setHomeShellActive(true);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", closeProjectRuntimeOnPageHide);
    }
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
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", closeProjectRuntimeOnPageHide);
    }
    if (typeof mobilePaneMediaQuery?.removeEventListener === "function") {
      mobilePaneMediaQuery.removeEventListener("change", syncMobilePaneLayout);
    } else {
      mobilePaneMediaQuery?.removeListener?.(syncMobilePaneLayout);
    }
    mobilePaneMediaQuery = null;
  });

  onBeforeRouteLeave(async (to, from) => {
    if (!projectRuntimeShouldCloseOnRouteLeave({ from, to })) {
      return true;
    }
    await closeProjectRuntimeForSlug(routeOnlyProjectSlug(from), {
      reason: "project-route-leave"
    });
    return true;
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
      void router.push(`${dashboardBasePath.value}/configure`);
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

  function closeProjectRuntimeOnPageHide() {
    const project = String(projectSlug.value || "").trim();
    if (!project || typeof navigator === "undefined") {
      return;
    }
    const payload = JSON.stringify({
      reason: "project-pagehide"
    });
    const url = scopedDevelopmentApiUrl(PROJECT_RUNTIME_CLOSE_API_PATH, project);
    if (typeof navigator.sendBeacon === "function" && typeof Blob !== "undefined") {
      navigator.sendBeacon(url, new Blob([payload], {
        type: "application/json"
      }));
      return;
    }
    if (typeof fetch === "function") {
      void fetch(url, {
        body: payload,
        headers: {
          "content-type": "application/json"
        },
        keepalive: true,
        method: "POST"
      }).catch((error) => {
        vibe64SessionDebugLog("client.projectRuntime.close.pagehide.error", {
          error: vibe64SessionDebugError(error),
          projectSlug: project
        });
      });
    }
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
    savedProjectTypeReady.value = true;
  }

  function handleProjectSelectionReady() {
    pageError.value = "";
    savedProjectTypeReady.value = false;
    emitPageTitle();
  }

  function handleProjectSelectionMissing() {
    pageError.value = "";
    savedProjectTypeReady.value = false;
    emitPageTitle("Choose project");
  }

  function handleProjectSelectionError(error) {
    pageError.value = String(error || "");
    savedProjectTypeReady.value = false;
    emitPageTitle();
  }

  function handleProjectTypeMissing(project = {}) {
    pageError.value = "";
    savedProjectTypeReady.value = project?.projectType?.ready === true;
    emitPageTitle(project?.projectType?.ready === true ? "Project setup" : "Choose project type");
  }

  function handleProjectTypeError(error) {
    pageError.value = String(error || "");
    savedProjectTypeReady.value = false;
    emitPageTitle();
  }
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

function routeOnlyProjectSlug(route = {}) {
  const rawValue = Array.isArray(route?.params?.slug) ? route.params.slug[0] : route?.params?.slug;
  return String(rawValue || "").trim();
}

function projectRuntimeShouldCloseOnRouteLeave({
  from = {},
  to = {}
} = {}) {
  const fromSlug = routeOnlyProjectSlug(from);
  if (!fromSlug) {
    return false;
  }
  return routeOnlyProjectSlug(to) !== fromSlug;
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
  projectRuntimeShouldCloseOnRouteLeave,
  previewToolbarTargetVisible,
  routeOnlyProjectSlug,
  selfTargetAutoSelectProjectTarget,
  useVibe64AppPage
};
