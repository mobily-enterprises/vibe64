import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiArrowRight,
  mdiGithub,
  mdiPlus,
  mdiShieldAccountOutline
} from "@mdi/js";
import {
  useVibe64AppAuth
} from "@/composables/useVibe64AppAuth.js";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";
import {
  useVibe64ProjectsResource
} from "@/composables/useVibe64ProjectManagement.js";

const MANAGEMENT_DEFAULT_VIEW = "projects";
const MANAGEMENT_LOCAL_DEFAULT_VIEW = "local-project";
const allManagementViews = Object.freeze([
  {
    label: "Local project",
    path: "/app/manage/local-project",
    value: "local-project"
  },
  {
    label: "Projects",
    path: "/app/manage/projects",
    value: "projects"
  },
  {
    label: "Studio setup",
    path: "/app/manage/studio-setup",
    value: "studio-setup"
  },
  {
    label: "AI Accounts",
    path: "/app/manage/accounts",
    value: "accounts"
  },
  {
    label: "Users",
    path: "/app/manage/users",
    value: "users"
  }
]);

function useVibe64ManagementPage() {
  const route = useRoute();
  const router = useRouter();
  const auth = useVibe64AppAuth();
  const projectList = useVibe64ProjectsResource();
  const addProjectDialogOpen = ref(false);
  const projectAccessDialogOpen = ref(false);
  const projectAccessProject = ref(null);
  const runtime = computed(() => auth?.state?.runtime || null);
  const localMode = computed(() => runtime.value?.local === true || runtime.value?.mode === "local");
  const managementViews = computed(() => managementViewsForRuntime(runtime.value));
  const sortedProjects = computed(() => [...projectList.projects].sort((left, right) => left.slug.localeCompare(right.slug)));
  const isOwner = computed(() => auth?.state?.user?.owner === true || auth?.state?.user?.role === "owner");
  const canManageProjects = computed(() => isOwner.value && capabilityEnabled("managedProjectsEnabled", true));
  const canManageStudioSetup = computed(() => isOwner.value);
  const canManageUsers = computed(() => isOwner.value && capabilityEnabled("tenantUsersEnabled", true));
  const canManageProjectAccess = computed(() => isOwner.value && capabilityEnabled("projectAccessManagementEnabled", true));
  const localProject = computed(() => projectList.currentProject || null);
  const emptyProjectsMessage = computed(() => canManageProjects.value
    ? "No projects yet. Add a project to create the first one."
    : "No projects yet.");
  const activeManagementView = computed(() => {
    return normalizeManagementView(route.params.view) || defaultManagementView();
  });

  useStudioShellDrawer({
    hidden: true
  });

  watch(
    () => [
      route.path,
      route.params.view
    ],
    () => {
      ensureManagementViewRoute();
    },
    {
      immediate: true
    }
  );

  return {
    activeManagementView,
    addProjectDialogOpen,
    canManageProjects,
    canManageProjectAccess,
    canManageStudioSetup,
    canManageUsers,
    canOpenProjectAccess,
    emptyProjectsMessage,
    managementViews,
    mdiArrowRight,
    mdiGithub,
    mdiPlus,
    mdiShieldAccountOutline,
    openAddProjectDialog,
    openProject,
    openProjectAccess,
    localMode,
    localProject,
    projectAccessDialogOpen,
    projectAccessProject,
    projectList,
    projectRepositoryLabel,
    refreshProjectsAfterCreate,
    sortedProjects,
    viewPanelId,
    viewTabId
  };

  function managementViewPath(value = MANAGEMENT_DEFAULT_VIEW) {
    const normalized = normalizeManagementView(value) || defaultManagementView();
    const view = managementViews.value.find((candidate) => candidate.value === normalized);
    return view?.path || managementViews.value[0]?.path || "/app/manage/projects";
  }

  function ensureManagementViewRoute() {
    const routeView = normalizeManagementView(route.params.view);
    if (route.path === "/app/manage" || !routeView) {
      void router.replace({
        hash: route.hash,
        path: managementViewPath(MANAGEMENT_DEFAULT_VIEW),
        query: route.query
      });
    }
  }

  async function refreshProjectsAfterCreate() {
    await projectList.reload();
    addProjectDialogOpen.value = false;
  }

  function openProject(project = {}) {
    const projectSlug = String(project.slug || "").trim();
    if (!projectSlug) {
      return;
    }
    void router.push(`/app/${projectSlug}`);
  }

  function openAddProjectDialog() {
    addProjectDialogOpen.value = true;
  }

  function canOpenProjectAccess(project = {}) {
    if (!canManageProjectAccess.value) {
      return false;
    }
    return Boolean(project.githubRepository?.fullName);
  }

  function openProjectAccess(project = {}) {
    projectAccessProject.value = project;
    projectAccessDialogOpen.value = true;
  }

  function defaultManagementView() {
    return localMode.value ? MANAGEMENT_LOCAL_DEFAULT_VIEW : MANAGEMENT_DEFAULT_VIEW;
  }

  function capabilityEnabled(key = "", defaultValue = true) {
    return runtimeCapabilityEnabled(runtime.value, key, defaultValue);
  }

  function normalizeManagementView(value = "") {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const normalized = String(rawValue || "").trim().toLowerCase();
    return managementViews.value.some((view) => view.value === normalized) ? normalized : "";
  }
}

function managementViewsForRuntime(runtime = null) {
  const local = runtime?.local === true || runtime?.mode === "local";
  return allManagementViews.filter((view) => {
    if (view.value === "local-project") {
      return local;
    }
    if (view.value === "projects") {
      return runtimeCapabilityEnabled(runtime, "managedProjectsEnabled", true);
    }
    if (view.value === "users") {
      return runtimeCapabilityEnabled(runtime, "tenantUsersEnabled", true);
    }
    return true;
  });
}

function runtimeCapabilityEnabled(runtime = null, key = "", defaultValue = true) {
  const capabilities = runtime?.capabilities || {};
  return Object.hasOwn(capabilities, key) ? capabilities[key] === true : defaultValue;
}

function projectRepositoryLabel(project = {}) {
  return project.githubRepository?.fullName || "No GitHub repository linked";
}

function viewTabId(value) {
  return `manage-tab-${value}`;
}

function viewPanelId(value) {
  return `manage-panel-${value}`;
}

export {
  managementViewsForRuntime,
  runtimeCapabilityEnabled,
  useVibe64ManagementPage
};
