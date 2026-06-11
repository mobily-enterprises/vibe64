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
const managementViews = Object.freeze([
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
const managementViewValues = new Set(managementViews.map((view) => view.value));

function useVibe64ManagementPage() {
  const route = useRoute();
  const router = useRouter();
  const auth = useVibe64AppAuth();
  const projectList = useVibe64ProjectsResource();
  const addProjectDialogOpen = ref(false);
  const projectAccessDialogOpen = ref(false);
  const projectAccessProject = ref(null);
  const sortedProjects = computed(() => [...projectList.projects].sort((left, right) => left.slug.localeCompare(right.slug)));
  const isOwner = computed(() => auth?.state?.user?.owner === true || auth?.state?.user?.role === "owner");
  const canManageProjects = computed(() => isOwner.value);
  const canManageStudioSetup = computed(() => isOwner.value);
  const emptyProjectsMessage = computed(() => canManageProjects.value
    ? "No projects yet. Add a project to create the first one."
    : "No projects yet.");
  const activeManagementView = computed(() => {
    return normalizeManagementView(route.params.view) || MANAGEMENT_DEFAULT_VIEW;
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
    canManageStudioSetup,
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
    const normalized = normalizeManagementView(value) || MANAGEMENT_DEFAULT_VIEW;
    const view = managementViews.find((candidate) => candidate.value === normalized);
    return view?.path || "/app/manage/projects";
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
    if (!canManageProjects.value) {
      return false;
    }
    return Boolean(project.githubRepository?.fullName);
  }

  function openProjectAccess(project = {}) {
    projectAccessProject.value = project;
    projectAccessDialogOpen.value = true;
  }
}

function normalizeManagementView(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const normalized = String(rawValue || "").trim().toLowerCase();
  return managementViewValues.has(normalized) ? normalized : "";
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
  useVibe64ManagementPage
};
