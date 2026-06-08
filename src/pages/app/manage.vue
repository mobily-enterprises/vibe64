<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "app"
    }
  }
}
</route>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
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
  readWorkspaces
} from "@/lib/vibe64WorkspaceApi.js";

const router = useRouter();
const auth = useVibe64AppAuth();
const loading = ref(true);
const loadError = ref("");
const projectsRoot = ref("");
const workspaces = ref([]);
const addProjectDialogOpen = ref(false);
const projectAccessDialogOpen = ref(false);
const projectAccessWorkspace = ref(null);
const activeManagementView = ref("workspaces");
const sortedWorkspaces = computed(() => [...workspaces.value].sort((left, right) => left.slug.localeCompare(right.slug)));
const canManageWorkspaces = computed(() => auth?.state?.user?.owner === true || auth?.state?.user?.role === "owner");
const emptyProjectsMessage = computed(() => canManageWorkspaces.value
  ? "No projects yet. Add a project to create the first one."
  : "No projects yet.");
const managementViews = Object.freeze([
  {
    label: "Projects",
    value: "workspaces"
  },
  {
    label: "Studio setup",
    value: "studio-setup"
  },
  {
    label: "AI Accounts",
    value: "accounts"
  },
  {
    label: "Users",
    value: "users"
  }
]);

useStudioShellDrawer({
  hidden: true
});

onMounted(() => {
  void loadWorkspaces();
});

async function loadWorkspaces({
  quiet = false
} = {}) {
  if (!quiet) {
    loading.value = true;
  }
  loadError.value = "";
  try {
    applyWorkspaceState(await readWorkspaces());
  } catch (error) {
    loadError.value = String(error?.message || error || "Workspaces could not load.");
  } finally {
    if (!quiet) {
      loading.value = false;
    }
  }
}

async function refreshWorkspacesAfterCreate() {
  await loadWorkspaces({
    quiet: true
  });
  addProjectDialogOpen.value = false;
}

function applyWorkspaceState(response = {}) {
  if (response.ok === false) {
    loadError.value = workspaceError(response);
    return;
  }
  projectsRoot.value = String(response.projectsRoot || "");
  workspaces.value = Array.isArray(response.workspaces) ? response.workspaces : [];
}

function workspaceError(response = {}) {
  return String(response.errors?.[0]?.message || response.error || "Vibe64 workspace request failed.");
}

function openWorkspace(workspace = {}) {
  const workspaceSlug = String(workspace.slug || "").trim();
  if (!workspaceSlug) {
    return;
  }
  void router.push(`/app/${workspaceSlug}`);
}

function workspaceRepositoryLabel(workspace = {}) {
  return workspace.githubRepository?.fullName || "No GitHub repository linked";
}

function openAddProjectDialog() {
  addProjectDialogOpen.value = true;
}

function canOpenProjectAccess(workspace = {}) {
  if (!canManageWorkspaces.value) {
    return false;
  }
  return Boolean(workspace.githubRepository?.fullName);
}

function openProjectAccess(workspace = {}) {
  projectAccessWorkspace.value = workspace;
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
        <v-btn
          v-if="activeManagementView === 'workspaces' && canManageWorkspaces"
          color="primary"
          type="button"
          variant="flat"
          @click="openAddProjectDialog"
        >
          <v-icon :icon="mdiPlus" />
          Add project
        </v-btn>
      </section>

      <nav class="vibe64-manage__tabs">
        <v-tabs
          v-model="activeManagementView"
          aria-label="Management views"
          color="primary"
          density="comfortable"
          show-arrows
        >
          <v-tab
            v-for="view in managementViews"
            :id="viewTabId(view.value)"
            :key="view.value"
            :aria-controls="viewPanelId(view.value)"
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
        <template v-if="activeManagementView === 'workspaces'">
          <v-alert v-if="loadError" type="error" variant="tonal">
            {{ loadError }}
          </v-alert>

          <div v-if="loading" class="vibe64-manage__loading">
            <v-progress-circular color="primary" indeterminate />
          </div>

          <template v-else>
            <section class="vibe64-manage__list" aria-label="Projects">
              <div class="vibe64-manage__list-heading">
                <h3>Projects</h3>
                <span>{{ sortedWorkspaces.length }}</span>
              </div>
              <article
                v-for="workspace in sortedWorkspaces"
                :key="workspace.slug"
                class="vibe64-manage__workspace"
              >
                <button
                  class="vibe64-manage__workspace-main"
                  type="button"
                  @click="openWorkspace(workspace)"
                >
                  <strong>{{ workspace.slug }}</strong>
                  <small>{{ workspace.workspaceRoot }}</small>
                  <small class="vibe64-manage__repository">
                    <v-icon :icon="mdiGithub" />
                    {{ workspaceRepositoryLabel(workspace) }}
                  </small>
                </button>
                <v-btn
                  v-if="canOpenProjectAccess(workspace)"
                  class="vibe64-manage__access"
                  size="small"
                  type="button"
                  variant="text"
                  @click="openProjectAccess(workspace)"
                >
                  <v-icon :icon="mdiShieldAccountOutline" />
                  Access
                </v-btn>
                <v-btn
                  :icon="mdiArrowRight"
                  aria-label="Open project"
                  type="button"
                  variant="text"
                  @click="openWorkspace(workspace)"
                />
              </article>
              <p v-if="sortedWorkspaces.length === 0" class="vibe64-manage__empty">
                {{ emptyProjectsMessage }}
              </p>
            </section>
          </template>
        </template>

        <StudioSetupDoctorScreen
          v-else-if="activeManagementView === 'studio-setup'"
          :continue-enabled="false"
        />

        <AIAccountsSetup
          v-else-if="activeManagementView === 'accounts'"
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
        @created="refreshWorkspacesAfterCreate"
      />
    </v-dialog>

    <v-dialog
      v-model="projectAccessDialogOpen"
      class="vibe64-manage__project-dialog"
    >
      <Vibe64ProjectAccessPanel
        v-if="projectAccessDialogOpen && projectAccessWorkspace"
        :workspace="projectAccessWorkspace"
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
  grid-template-columns: minmax(0, 1fr) auto;
}

.vibe64-manage__bar .v-btn {
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
  justify-content: space-between;
}

.vibe64-manage__list-heading h3 {
  font-size: 1rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
}

.vibe64-manage__list-heading span {
  align-items: center;
  background: #e2e8f0;
  border-radius: 999px;
  color: #334155;
  display: inline-flex;
  font-size: 0.78rem;
  font-weight: 720;
  justify-content: center;
  min-height: 1.5rem;
  min-width: 1.5rem;
  padding: 0 0.45rem;
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
.vibe64-manage__panel :deep(.accounts-setup__items) {
  margin-inline: auto;
  max-width: 54rem;
  width: 100%;
}

.vibe64-manage__workspace {
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

.vibe64-manage__workspace:focus-within,
.vibe64-manage__workspace:hover {
  border-color: rgba(var(--v-theme-primary), 0.55);
}

.vibe64-manage__workspace-main {
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  min-width: 0;
  padding: 0;
  text-align: left;
}

.vibe64-manage__workspace strong,
.vibe64-manage__workspace small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-manage__workspace strong {
  font-size: 0.98rem;
  font-weight: 720;
}

.vibe64-manage__workspace .v-btn,
.vibe64-manage__access {
  letter-spacing: 0;
  text-transform: none;
}

.vibe64-manage__workspace small {
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

  .vibe64-manage__workspace {
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
