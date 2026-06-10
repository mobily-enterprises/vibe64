<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiArrowRight,
  mdiGithub,
  mdiPlus,
  mdiShieldAccountOutline
} from "@mdi/js";
import ShellLayout from "@/components/ShellLayout.vue";
import Vibe64AccountMenu from "@/components/auth/Vibe64AccountMenu.vue";
import Vibe64UserManagement from "@/components/auth/Vibe64UserManagement.vue";
import Vibe64AddProjectWizard from "@/components/manage/Vibe64AddProjectWizard.vue";
import Vibe64ProjectAccessPanel from "@/components/manage/Vibe64ProjectAccessPanel.vue";
import AIAccountsSetup from "@/components/studio/AIAccountsSetup.vue";
import StudioSetupDoctorScreen from "@/components/studio/StudioSetupDoctorScreen.vue";
import {
  useVibe64AppAuth
} from "@/composables/useVibe64AppAuth.js";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";
import {
  readProjects
} from "@/lib/vibe64ProjectApi.js";

const MANAGEMENT_DEFAULT_VIEW = "projects";

const route = useRoute();
const router = useRouter();
const auth = useVibe64AppAuth();
const loading = ref(true);
const loadError = ref("");
const projectsRoot = ref("");
const projects = ref([]);
const addProjectDialogOpen = ref(false);
const projectAccessDialogOpen = ref(false);
const projectAccessProject = ref(null);
const sortedProjects = computed(() => [...projects.value].sort((left, right) => left.slug.localeCompare(right.slug)));
const isOwner = computed(() => auth?.state?.user?.owner === true || auth?.state?.user?.role === "owner");
const canManageProjects = computed(() => isOwner.value);
const canManageStudioSetup = computed(() => isOwner.value);
const emptyProjectsMessage = computed(() => canManageProjects.value
  ? "No projects yet. Add a project to create the first one."
  : "No projects yet.");
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
const activeManagementView = computed(() => {
  return normalizeManagementView(route.params.view) || MANAGEMENT_DEFAULT_VIEW;
});

useStudioShellDrawer({
  hidden: true
});

onMounted(() => {
  void loadProjects();
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

function normalizeManagementView(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const normalized = String(rawValue || "").trim().toLowerCase();
  return managementViewValues.has(normalized) ? normalized : "";
}

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

async function loadProjects({
  quiet = false
} = {}) {
  if (!quiet) {
    loading.value = true;
  }
  loadError.value = "";
  try {
    applyProjectState(await readProjects());
  } catch (error) {
    loadError.value = String(error?.message || error || "Projects could not load.");
  } finally {
    if (!quiet) {
      loading.value = false;
    }
  }
}

async function refreshProjectsAfterCreate() {
  await loadProjects({
    quiet: true
  });
  addProjectDialogOpen.value = false;
}

function applyProjectState(response = {}) {
  if (response.ok === false) {
    loadError.value = projectError(response);
    return;
  }
  projectsRoot.value = String(response.projectsRoot || "");
  projects.value = Array.isArray(response.projects) ? response.projects : [];
}

function projectError(response = {}) {
  return String(response.errors?.[0]?.message || response.error || "Vibe64 project request failed.");
}

function openProject(project = {}) {
  const projectSlug = String(project.slug || "").trim();
  if (!projectSlug) {
    return;
  }
  void router.push(`/app/${projectSlug}`);
}

function projectRepositoryLabel(project = {}) {
  return project.githubRepository?.fullName || "No GitHub repository linked";
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

function viewTabId(value) {
  return `manage-tab-${value}`;
}

function viewPanelId(value) {
  return `manage-panel-${value}`;
}
</script>

<template>
  <ShellLayout>
    <template #top-left>
      <h1 class="vibe64-manage__title">Vibe64</h1>
    </template>
    <template #top-right>
      <Vibe64AccountMenu />
    </template>

    <main class="vibe64-manage">
      <section class="vibe64-manage__bar">
        <div class="vibe64-manage__heading">
          <h2>Management</h2>
          <p v-if="projectsRoot" :title="projectsRoot">
            {{ projectsRoot }}
          </p>
        </div>
      </section>

      <nav class="vibe64-manage__tabs">
        <v-tabs
          aria-label="Management views"
          color="primary"
          density="comfortable"
          :model-value="activeManagementView"
          show-arrows
        >
          <v-tab
            v-for="view in managementViews"
            :id="viewTabId(view.value)"
            :key="view.value"
            :aria-controls="viewPanelId(view.value)"
            :to="view.path"
            :value="view.value"
          >
            {{ view.label }}
          </v-tab>
        </v-tabs>
      </nav>

      <section
        :id="viewPanelId(activeManagementView)"
        class="vibe64-manage__panel"
        role="tabpanel"
        tabindex="0"
        :aria-labelledby="viewTabId(activeManagementView)"
      >
        <template v-if="activeManagementView === 'projects'">
          <v-alert v-if="loadError" type="error" variant="tonal">
            {{ loadError }}
          </v-alert>

          <div v-if="loading" class="vibe64-manage__loading">
            <v-progress-circular color="primary" indeterminate />
          </div>

          <template v-else>
            <section class="vibe64-manage__list" aria-label="Projects">
              <div class="vibe64-manage__list-heading">
                <div class="vibe64-manage__list-title">
                  <h3>Projects</h3>
                  <span>({{ sortedProjects.length }})</span>
                </div>
                <v-btn
                  v-if="canManageProjects"
                  class="vibe64-manage__add-project"
                  color="primary"
                  :prepend-icon="mdiPlus"
                  size="large"
                  type="button"
                  variant="flat"
                  @click="openAddProjectDialog"
                >
                  Add project
                </v-btn>
              </div>
              <article
                v-for="project in sortedProjects"
                :key="project.slug"
                class="vibe64-manage__project"
              >
                <button
                  class="vibe64-manage__project-main"
                  type="button"
                  @click="openProject(project)"
                >
                  <strong>{{ project.slug }}</strong>
                  <small>{{ project.projectRoot }}</small>
                  <small class="vibe64-manage__repository">
                    <v-icon :icon="mdiGithub" />
                    {{ projectRepositoryLabel(project) }}
                  </small>
                </button>
                <v-btn
                  v-if="canOpenProjectAccess(project)"
                  class="vibe64-manage__access"
                  size="small"
                  type="button"
                  variant="text"
                  @click="openProjectAccess(project)"
                >
                  <v-icon :icon="mdiShieldAccountOutline" />
                  Access
                </v-btn>
                <v-btn
                  :icon="mdiArrowRight"
                  aria-label="Open project"
                  type="button"
                  variant="text"
                  @click="openProject(project)"
                />
              </article>
              <p v-if="sortedProjects.length === 0" class="vibe64-manage__empty">
                {{ emptyProjectsMessage }}
              </p>
            </section>
          </template>
        </template>

        <StudioSetupDoctorScreen
          v-else-if="activeManagementView === 'studio-setup'"
          :actions-enabled="canManageStudioSetup"
          actions-disabled-message="Only the Vibe64 owner can run Studio setup actions."
          :continue-enabled="false"
        />

        <AIAccountsSetup
          v-else-if="activeManagementView === 'accounts'"
          :actions-enabled="canManageProjects"
          actions-disabled-message="Only the Vibe64 owner can manage the shared Codex account."
          :show-continue="false"
        />

        <Vibe64UserManagement v-else />
      </section>
    </main>

    <v-dialog
      v-model="addProjectDialogOpen"
      class="vibe64-manage__project-dialog"
    >
      <Vibe64AddProjectWizard
        v-if="addProjectDialogOpen"
        closable
        @cancel="addProjectDialogOpen = false"
        @created="refreshProjectsAfterCreate"
      />
    </v-dialog>

    <v-dialog
      v-model="projectAccessDialogOpen"
      class="vibe64-manage__project-dialog"
    >
      <Vibe64ProjectAccessPanel
        v-if="projectAccessDialogOpen && projectAccessProject"
        :project="projectAccessProject"
        @close="projectAccessDialogOpen = false"
      />
    </v-dialog>
  </ShellLayout>
</template>

<style scoped>
.vibe64-manage {
  align-content: start;
  background: #f6f7f9;
  color: #111827;
  display: grid;
  gap: 0.85rem;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: calc(100dvh - var(--v-layout-top, 0px));
  padding: 1rem clamp(1rem, 2vw, 2rem);
}

.vibe64-manage__title {
  font-size: 1.15rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0 0 0 1rem;
}

.vibe64-manage__bar,
.vibe64-manage__tabs,
.vibe64-manage__panel {
  margin-inline: auto;
  max-width: 82rem;
  width: 100%;
}

.vibe64-manage__bar {
  align-items: center;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr);
}

.vibe64-manage__bar .v-btn,
.vibe64-manage__list-heading .v-btn {
  letter-spacing: 0;
  text-transform: none;
}

.vibe64-manage__heading h2 {
  font-size: 1.4rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
}

.vibe64-manage__heading p {
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0.35rem 0 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.vibe64-manage__tabs {
  border-bottom: 1px solid rgba(15, 23, 42, 0.1);
}

.vibe64-manage__tabs :deep(.v-tab) {
  letter-spacing: 0;
  min-height: 42px;
  text-transform: none;
}

.vibe64-manage__panel {
  align-content: start;
  display: grid;
  gap: 0.8rem;
  min-height: 0;
  min-width: 0;
}

.vibe64-manage__loading {
  align-items: center;
  display: flex;
  justify-content: center;
  min-height: 14rem;
}

.vibe64-manage__list {
  align-content: start;
  display: grid;
  gap: 0.6rem;
  grid-auto-rows: minmax(3.6rem, auto);
}

.vibe64-manage__list-heading {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-manage__list-title {
  align-items: baseline;
  display: flex;
  gap: 0.35rem;
  min-width: 0;
}

.vibe64-manage__list-title h3 {
  font-size: 1rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
}

.vibe64-manage__list-title span {
  color: #64748b;
  font-size: 0.9rem;
  font-weight: 650;
  line-height: 1.2;
}

.vibe64-manage__add-project {
  font-size: 0.98rem;
  font-weight: 650;
  min-height: 2.65rem;
  padding-inline: 1rem 1.15rem;
}

.vibe64-manage__panel :deep(.vibe64-account-settings) {
  margin: 0;
  max-width: none;
  padding: 0;
}

.vibe64-manage__panel :deep(.accounts-setup) {
  margin: 0;
  max-width: none;
  padding: 0;
}

.vibe64-manage__panel :deep(.generated-ui-screen) {
  background: transparent;
  min-height: 0;
  padding: 0;
}

.vibe64-manage__panel :deep(.studio-screen__header),
.vibe64-manage__panel :deep(.doctor-status__quiet),
.vibe64-manage__panel :deep(.doctor-status),
.vibe64-manage__panel :deep(.accounts-setup__header),
.vibe64-manage__panel :deep(.accounts-setup__notice),
.vibe64-manage__panel :deep(.accounts-setup__items) {
  margin-inline: auto;
  max-width: 54rem;
  width: 100%;
}

.vibe64-manage__project {
  align-items: center;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  color: inherit;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) auto auto;
  min-height: 3.6rem;
  padding: 0.7rem 0.85rem;
  text-align: left;
}

.vibe64-manage__project:focus-within,
.vibe64-manage__project:hover {
  border-color: rgba(var(--v-theme-primary), 0.55);
}

.vibe64-manage__project-main {
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  min-width: 0;
  padding: 0;
  text-align: left;
}

.vibe64-manage__project strong,
.vibe64-manage__project small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-manage__project strong {
  font-size: 0.98rem;
  font-weight: 720;
}

.vibe64-manage__project .v-btn,
.vibe64-manage__access {
  letter-spacing: 0;
  text-transform: none;
}

.vibe64-manage__project small {
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.78rem;
  margin-top: 0.25rem;
}

.vibe64-manage__repository {
  align-items: center;
  display: flex !important;
  font-family: inherit !important;
  gap: 0.35rem;
}

.vibe64-manage__repository .v-icon {
  color: #334155;
  font-size: 0.95rem;
}

.vibe64-manage__empty {
  color: #64748b;
  margin: 2rem 0;
  text-align: center;
}

@media (max-width: 760px) {
  .vibe64-manage__bar {
    grid-template-columns: minmax(0, 1fr);
  }

  .vibe64-manage__list-heading {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .vibe64-manage__list-heading .v-btn {
    margin-left: auto;
  }

  .vibe64-manage__project {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .vibe64-manage__access {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

.vibe64-manage__project-dialog {
  align-items: stretch;
  justify-content: flex-end;
  margin: 0;
}

.vibe64-manage__project-dialog :deep(.v-overlay__content) {
  bottom: 0;
  height: 100dvh;
  left: auto;
  margin: 0 0 0 auto;
  max-height: 100dvh;
  max-width: min(34rem, 100vw);
  right: 0;
  top: 0;
  width: min(34rem, 100vw);
}

@media (max-width: 640px) {
  .vibe64-manage__project-dialog :deep(.v-overlay__content) {
    max-width: 100vw;
    width: 100vw;
  }
}
</style>
