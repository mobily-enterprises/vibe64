import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiApps,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight
} from "@mdi/js";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";
import {
  useVibe64ProjectsResource
} from "@/composables/useVibe64ProjectManagement.js";

const HOME_SHELL_CLASS = "studio-home-shell-active";
const SELF_TARGET_AUTO_SELECT_DELAY_MS = 3000;
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
  const projectSlug = computed(() => firstRouteParam(route.params.slug));
  const projectSelection = useVibe64ProjectsResource({
    fallbackLoadError: "Project selection could not load.",
    projectSlug,
    requestRecoveryLabel: "Project selection"
  });
  const projectLoadError = computed(() => projectSelection.loadError);
  const projects = computed(() => projectSelection.projects);
  const selfTargetAutoSelectProjectRepro = computed(() => projectSelection.selfTargetAutoSelectProjectRepro || {});
  const targetRoot = computed(() => String(projectSelection.targetRoot || "").trim());
  const targetFolderName = computed(() => projectSlug.value || finalPathSegment(targetRoot.value));
  const developmentBasePath = computed(() => projectSlug.value ? `/app/${encodeURIComponent(projectSlug.value)}` : "/app/manage/projects");
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
    dashboardRouteActive,
    emitPageTitle,
    handleProjectSelectionError,
    handleProjectSelectionMissing,
    handleProjectSelectionReady,
    handleProjectTypeError,
    handleProjectTypeMissing,
    handleProjectTypeReady,
    mdiApps,
    mdiChevronDown,
    mdiChevronRight,
    mobileProjectAction,
    mobileProjectActionVisible,
    openManagement,
    openProject,
    pageError,
    pageTitle,
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

  function openManagement() {
    void router.push("/app/manage/projects");
  }

  function openProject(project = {}) {
    const slug = String(project.slug || "").trim();
    if (!slug || slug === projectSlug.value) {
      return;
    }
    void router.push(`/app/${encodeURIComponent(slug)}`);
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

function finalPathSegment(pathValue = "") {
  const normalizedPath = String(pathValue || "").trim().replace(/[\\/]+$/u, "");
  if (!normalizedPath) {
    return "";
  }
  return normalizedPath.split(/[\\/]+/u).filter(Boolean).at(-1) || "";
}

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function normalizedPath(pathValue = "") {
  const path = String(pathValue || "").trim();
  if (!path || path === "/") {
    return path || "/";
  }
  return path.replace(/\/+$/u, "");
}

export {
  SELF_TARGET_AUTO_SELECT_DELAY_MS,
  selfTargetAutoSelectProjectTarget,
  useVibe64AppPage
};
