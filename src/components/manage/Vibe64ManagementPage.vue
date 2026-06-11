<script setup>
import ShellLayout from "@/components/ShellLayout.vue";
import Vibe64AccountMenu from "@/components/auth/Vibe64AccountMenu.vue";
import Vibe64UserManagement from "@/components/auth/Vibe64UserManagement.vue";
import Vibe64AddProjectWizard from "@/components/manage/Vibe64AddProjectWizard.vue";
import Vibe64ProjectAccessPanel from "@/components/manage/Vibe64ProjectAccessPanel.vue";
import AIAccountsSetup from "@/components/studio/AIAccountsSetup.vue";
import StudioSetupDoctorScreen from "@/components/studio/StudioSetupDoctorScreen.vue";
import { useVibe64ManagementPage } from "@/composables/useVibe64ManagementPage.js";

const {
  activeManagementView,
  addProjectDialogOpen,
  canManageProjects,
  canManageProjectAccess,
  canManageStudioSetup,
  canManageUsers,
  canOpenProjectAccess,
  emptyProjectsMessage,
  localProject,
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
} = useVibe64ManagementPage();
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
          <p v-if="projectList.projectsRoot" :title="projectList.projectsRoot">
            {{ projectList.projectsRoot }}
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
        <template v-if="activeManagementView === 'local-project'">
          <section class="vibe64-manage__local-project" aria-label="Local project">
            <div class="vibe64-manage__local-main">
              <p class="vibe64-manage__eyebrow">Local project</p>
              <h3>{{ localProject?.name || localProject?.slug || 'Current folder' }}</h3>
              <p v-if="localProject?.path" class="vibe64-manage__path" :title="localProject.path">
                {{ localProject.path }}
              </p>
              <p v-if="localProject?.githubRepository?.fullName" class="vibe64-manage__repository">
                <v-icon :icon="mdiGithub" />
                {{ localProject.githubRepository.fullName }}
              </p>
            </div>
            <v-btn
              v-if="localProject?.slug"
              color="primary"
              :append-icon="mdiArrowRight"
              type="button"
              variant="flat"
              @click="openProject(localProject)"
            >
              Open project
            </v-btn>
          </section>
        </template>

        <template v-if="activeManagementView === 'projects'">
          <v-alert v-if="projectList.loadError" type="error" variant="tonal">
            {{ projectList.loadError }}
          </v-alert>

          <div v-if="projectList.isInitialLoading" class="vibe64-manage__loading">
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

        <Vibe64UserManagement v-else-if="canManageUsers" />
      </section>
    </main>

    <v-dialog
      v-if="canManageProjects"
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
      v-if="canManageProjectAccess"
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

.vibe64-manage__local-project {
  align-items: center;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding: 1rem;
}

.vibe64-manage__local-main {
  min-width: 0;
}

.vibe64-manage__eyebrow {
  color: #64748b;
  font-size: 0.76rem;
  font-weight: 720;
  letter-spacing: 0;
  margin: 0 0 0.2rem;
  text-transform: uppercase;
}

.vibe64-manage__local-main h3 {
  font-size: 1.15rem;
  line-height: 1.2;
  margin: 0;
}

.vibe64-manage__path {
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  margin: 0.35rem 0 0;
  overflow-wrap: anywhere;
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
