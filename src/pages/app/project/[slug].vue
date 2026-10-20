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
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import { RouterView } from "vue-router";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import Vibe64AuthSettingsButton from "@/components/studio/Vibe64AuthSettingsButton.vue";
import Vibe64LocalRemoteControls from "@/components/studio/repository/Vibe64LocalRemoteControls.vue";
import Vibe64SessionPanel from "@/components/studio/Vibe64SessionPanel.vue";
import { useVibe64AppPage } from "@/composables/useVibe64AppPage.js";
import { projectDisplayName } from "@/lib/vibe64PracticeProjectName.js";

const githubActorHostId = "studio-home-shell-github-actor";
const githubActorTeleportTarget = `#${githubActorHostId}`;

const {
  chatCollapsed,
  chatToggleIcon,
  chatToggleTitle,
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
  previewToolbarHostId,
  previewToolbarHostVisible,
  previewToolbarTeleportTarget,
  projectLoadError,
  projectPane,
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
  projectTitle
} = useVibe64AppPage();

</script>

<template>
  <StudioAppShellLayout
    :chat-collapsed="chatCollapsed"
    :mobile-pane-swipe-enabled="mobilePaneSwipeEnabled"
    @update:chat-collapsed="setChatCollapsed"
  >
    <template #top-left>
      <div
        class="studio-home-shell-heading"
        :class="{ 'studio-home-shell-heading--chat-collapsed': chatCollapsed }"
      >
        <div class="studio-home-shell-title-area">
          <div class="studio-home-shell-project-name">
            <v-menu location="bottom start">
              <template #activator="{ props: menuProps }">
                <v-btn
                  class="studio-home-shell-project-selector"
                  variant="text"
                  v-bind="menuProps"
                  :title="projectSlug && projectTitle !== projectSlug ? `${projectTitle} (${projectSlug})` : projectTitle"
                >
                  <span>{{ projectTitle || "Project" }}</span>
                  <v-icon :icon="mdiChevronDown" size="18" />
                </v-btn>
              </template>
              <v-list density="compact" min-width="240">
                <v-list-item
                  v-for="project in switcherProjects"
                  :key="project.slug"
                  :active="project.slug === projectSlug"
                  :title="projectDisplayName(project)"
                  :subtitle="project.projectRoot"
                  @click="openProject(project, $event)"
                />
                <v-list-item
                  v-if="switcherProjects.length === 0"
                  :subtitle="projectLoadError || 'No open projects found.'"
                  title="Projects"
                />
              </v-list>
            </v-menu>
          </div>
          <div
            id="studio-home-shell-create-session"
            class="studio-home-shell-create-session-host"
          />
          <div
            id="studio-home-shell-local-remotes"
            class="studio-home-shell-local-remotes-host"
          />
          <div
            :id="githubActorHostId"
            class="studio-home-shell-github-actor-host"
          />
          <!--
          <h1
            v-if="pageTitle"
            class="studio-home-shell-title"
            :title="pageTitle"
            aria-live="polite"
          >
            {{ pageTitle }}
          </h1>
          <span v-else class="studio-home-shell-surface-label">
            Sessions
          </span>
          -->
        </div>

        <div class="studio-home-shell-project-controls">
          <v-btn
            class="studio-home-shell-chat-toggle"
            data-vibe64-guide="pane-switch"
            density="comfortable"
            :icon="chatToggleIcon"
            size="small"
            :title="chatToggleTitle"
            type="button"
            variant="tonal"
            :aria-label="chatToggleTitle"
            @click="setChatCollapsed(!chatCollapsed, $event)"
          />

          <div
            v-if="projectPaneNavigationVisible"
            class="studio-home-shell-project-tabs studio-home-shell-project-tabs--desktop"
            role="tablist"
            aria-label="Project"
          >
            <button
              v-for="tab in projectTabs"
              :key="tab.id"
              class="studio-home-shell-project-tab"
              :class="{ 'studio-home-shell-project-tab--active': projectPane === tab.id }"
              role="tab"
              type="button"
              :data-vibe64-guide="tab.id"
              :aria-selected="projectPane === tab.id ? 'true' : 'false'"
              @click="selectProjectPane(tab.id, $event)"
            >
              {{ tab.label }}
            </button>
          </div>
          <div
            v-if="previewToolbarHostVisible"
            :id="previewToolbarHostId"
            class="studio-home-shell-preview-toolbar-host"
          />
          <button
            v-if="mobileProjectActionVisible && mobileProjectAction"
            class="studio-home-shell-project-mobile-action"
            data-vibe64-guide="pane-switch"
            type="button"
            :aria-label="mobileProjectAction.ariaLabel"
            :title="mobileProjectAction.label"
            @click="selectProjectPane(mobileProjectAction.pane, $event)"
          >
            <v-icon class="studio-home-shell-project-mobile-action__icon" :icon="mobileProjectAction.icon" size="18" />
            <span class="studio-home-shell-project-mobile-action__label">{{ mobileProjectAction.label }}</span>
            <v-icon class="studio-home-shell-project-mobile-action__chevron" :icon="mdiChevronRight" size="15" />
          </button>
        </div>
      </div>
    </template>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>
    <section class="generated-ui-screen generated-ui-screen--studio studio-screen d-flex flex-column ga-3">
      <v-alert
        v-if="pageError"
        type="error"
        variant="tonal"
        border="start"
        class="studio-screen__alert"
      >
        {{ pageError }}
      </v-alert>

      <div class="studio-screen__gate-scroll">
        <ProjectSelectionGate
          :runtime-ready="projectRuntimeReady"
          :runtime-error="projectRuntimeError"
          @retry-runtime="retryProjectRuntime"
          :key="projectSlug"
          scope-selection-to-current-project
          @error="handleProjectSelectionError"
          @deleted="handleProjectSelectionDeleted"
          @missing="handleProjectSelectionMissing"
          @ready="handleProjectSelectionReady"
        >
          <template #default="projectSelectionSlotProps">
            <Teleport
              v-if="projectSelectionSlotProps?.projectSelection?.currentProject?.repositoryMode === 'local_source'"
              to="#studio-home-shell-local-remotes"
              defer
            >
              <Vibe64LocalRemoteControls
                :project="projectSelectionSlotProps.projectSelection.currentProject"
              />
            </Teleport>
            <Vibe64SessionPanel
              :chat-collapsed="chatCollapsed"
              create-session-teleport-target="#studio-home-shell-create-session"
              :github-actor-teleport-target="githubActorTeleportTarget"
              :project-context="projectSelectionSlotProps?.projectSelection?.currentProject || {}"
              :preview-toolbar-teleport-target="previewToolbarTeleportTarget"
              :project-pane="projectPane"
              @title-change="emitPageTitle"
              @chat-attention="setChatCollapsed(false)"
              @project-attention="showProjectPane"
            >
              <template #dashboard="dashboardSlotProps">
                <RouterView
                  v-if="dashboardRouteActive"
                  :dashboard-context="dashboardSlotProps?.dashboardContext || {}"
                />
              </template>
            </Vibe64SessionPanel>
          </template>
        </ProjectSelectionGate>
      </div>
    </section>
  </StudioAppShellLayout>
</template>

<style scoped>
:global(body.studio-home-shell-active) {
  --studio-home-chat-column-width: 32rem;
  --studio-home-project-gap: 0.75rem;
  /* Shared studio control roles, mapped onto the Material 3 tokens. */
  --studio-control-bg: var(--v64-surface);
  --studio-control-rest-bg: var(--v64-surface-container-high);
  --studio-control-active-bg: var(--v64-secondary-container);
  --studio-control-border: var(--v64-outline-variant);
  --studio-control-border-strong: var(--v64-outline);
  --studio-control-text: var(--v64-on-surface);
  --studio-control-muted-text: var(--v64-on-surface-variant);
  --studio-control-radius: var(--v64-shape-md);
}

.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.2rem, 1.7vw, 1.55rem);
  --generated-ui-screen-panel-padding: 0;
}

.studio-screen {
  flex: 1 1 auto;
  height: 100%;
  margin-inline: 0;
  max-width: none;
  min-height: 0;
  overflow: hidden;
  width: 100%;
}

.studio-screen__panel {
  padding: var(--generated-ui-screen-panel-padding);
}

.studio-screen__gate-scroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.studio-screen__gate-scroll :deep(.project-selection-gate) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.studio-screen__gate-scroll :deep(.project-selection-gate .studio-ai-sessions) {
  flex: 1 1 auto;
  min-height: 0;
}

.studio-home-shell-heading {
  align-items: center;
  display: grid;
  gap: var(--studio-home-project-gap);
  grid-template-columns: var(--studio-home-chat-column-width) auto;
  min-width: 0;
}

.studio-home-shell-heading--chat-collapsed {
  grid-template-columns: auto auto;
}

.studio-home-shell-title-area {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  gap: 0.42rem;
  min-width: 0;
  padding-left: 1rem;
}

.studio-home-shell-project-name {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
}

.studio-home-shell-project-selector {
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-surface) !important;
  flex: 0 1 auto;
  font: var(--v64-type-title-md);
  font-size: 1.0625rem;
  justify-content: start;
  letter-spacing: -0.005em;
  max-width: 100%;
  min-width: 0;
  padding-inline: var(--v64-space-3) var(--v64-space-2);
  text-transform: none;
}

.studio-home-shell-project-selector :deep(.v-icon) {
  color: var(--v64-on-surface-variant);
  margin-inline-start: var(--v64-space-1);
}

.studio-home-shell-project-selector :deep(.v-btn__content) {
  min-width: 0;
}

.studio-home-shell-project-selector span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-github-actor-host {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  min-height: 1.65rem;
  min-width: 0;
  overflow: hidden;
}

.studio-home-shell-github-actor-host:empty {
  display: none;
}

.studio-home-shell-local-remotes-host,
.studio-home-shell-create-session-host {
  display: flex;
  flex: 0 0 auto;
}

.studio-home-shell-local-remotes-host:empty,
.studio-home-shell-create-session-host:empty {
  display: none;
}

.studio-home-shell-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.2rem;
  flex: 1 1 auto;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-surface-label {
  color: rgb(var(--v-theme-on-surface));
  display: block;
  flex: 1 1 auto;
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.2;
  max-width: 12rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-target-folder {
  color: rgb(var(--v-theme-on-surface));
  display: block;
  flex: 1 1 auto;
  font-size: 1.2rem;
  font-weight: 760;
  line-height: 1.2;
  margin: 0;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-home-shell-project-controls {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.45rem;
  min-width: 0;
}

/* M3 tonal icon button: circular, surface-container tone, state layer on
   hover/press. */
.studio-home-shell-chat-toggle {
  background: var(--v64-surface-container-high) !important;
  border: 0;
  border-radius: var(--v64-shape-full);
  box-shadow: none;
  color: var(--v64-on-surface-variant) !important;
  flex: 0 0 auto;
  height: 2.25rem;
  min-height: 2.25rem;
  min-width: 2.25rem;
  transition: background-color var(--v64-duration-short) var(--v64-ease-standard);
  width: 2.25rem;
}

.studio-home-shell-chat-toggle:hover {
  background: color-mix(in srgb, var(--v64-on-surface) 8%, var(--v64-surface-container-high)) !important;
}

/* M3 segmented button: an outlined pill of equal-width segments split by
   hairlines. The selected segment fills with the secondary container and
   gains a check that slides in. */
.studio-home-shell-project-tabs {
  border: 1px solid var(--v64-outline);
  border-radius: var(--v64-shape-full);
  display: inline-grid;
  flex: 0 0 auto;
  grid-auto-columns: minmax(5.25rem, 1fr);
  grid-auto-flow: column;
  min-width: 0;
  overflow: hidden;
}

.studio-home-shell-project-tab {
  align-items: center;
  background: transparent;
  border: 0;
  border-inline-start: 1px solid var(--v64-outline);
  color: var(--v64-on-surface);
  cursor: pointer;
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: var(--v64-space-1);
  height: 2.25rem;
  justify-content: center;
  letter-spacing: 0.01em;
  min-width: 0;
  padding: 0 var(--v64-space-3);
  position: relative;
  transition:
    background-color var(--v64-duration-short) var(--v64-ease-standard),
    color var(--v64-duration-short) var(--v64-ease-standard);
  white-space: nowrap;
}

.studio-home-shell-project-tab:first-child {
  border-inline-start: 0;
}

.studio-home-shell-project-tab::after {
  background: currentColor;
  content: "";
  inset: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transition: opacity var(--v64-duration-short) var(--v64-ease-standard);
}

.studio-home-shell-project-tab:hover:not(:disabled)::after {
  opacity: var(--v64-state-hover);
}

.studio-home-shell-project-tab:active:not(:disabled)::after {
  opacity: var(--v64-state-pressed);
}

.studio-home-shell-project-tab:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: -4px;
}

.studio-home-shell-project-tab--active {
  background: var(--v64-secondary-container);
  color: var(--v64-on-secondary-container);
  font-weight: 600;
}

.studio-home-shell-project-tab--active::before {
  animation: studio-home-shell-check-in var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate);
  background: currentColor;
  content: "";
  flex: 0 0 auto;
  height: 1.125rem;
  -webkit-mask: var(--studio-home-shell-check) center / contain no-repeat;
  mask: var(--studio-home-shell-check) center / contain no-repeat;
  width: 1.125rem;
}

.studio-home-shell-project-tabs {
  --studio-home-shell-check: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E");
}

.studio-home-shell-project-tab:disabled {
  color: color-mix(in srgb, var(--v64-on-surface) 38%, transparent);
  cursor: not-allowed;
}

@keyframes studio-home-shell-check-in {
  from { opacity: 0; width: 0; }
  to { opacity: 1; width: 1.125rem; }
}

.studio-home-shell-preview-toolbar-host {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  justify-content: flex-start;
  max-width: min(43rem, 54vw);
  min-width: 0;
}

.studio-home-shell-preview-toolbar-host:empty {
  display: none;
}

/* Phone "next pane" control: an M3 tonal pill button with a 40px target. */
.studio-home-shell-project-mobile-action {
  align-items: center;
  background: var(--v64-secondary-container);
  border: 0;
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-secondary-container);
  cursor: pointer;
  display: none;
  flex: 0 0 auto;
  font: var(--v64-type-label-lg);
  gap: var(--v64-space-1);
  justify-content: center;
  letter-spacing: 0.01em;
  min-height: 2.5rem;
  min-width: 4.5rem;
  padding: 0 var(--v64-space-2) 0 var(--v64-space-4);
  position: relative;
  transition: background-color var(--v64-duration-short) var(--v64-ease-standard);
  white-space: nowrap;
}

.studio-home-shell-project-mobile-action__icon {
  display: none !important;
}

.studio-home-shell-project-mobile-action:hover {
  background: color-mix(in srgb, var(--v64-on-secondary-container) 8%, var(--v64-secondary-container));
}

.studio-home-shell-project-mobile-action:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .studio-home-shell-project-tab--active::before {
    animation: none;
  }
}

@media (min-width: 981px) {
  .studio-screen__gate-scroll :deep(.project-selection-gate .studio-ai-sessions--autopilot) {
    padding: 0;
  }
}

@media (max-width: 980px) {
  .studio-home-shell-heading {
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
  }

  .studio-home-shell-project-controls {
    display: flex;
    justify-content: flex-end;
    margin-left: auto;
    min-width: 0;
  }

  .studio-home-shell-project-tabs--desktop {
    display: none;
  }

  .studio-home-shell-project-mobile-action {
    display: inline-flex;
  }

  .studio-home-shell-preview-toolbar-host {
    flex: 0 1 auto;
    max-width: min(26rem, 42vw);
  }

}

@media (max-width: 600px) {
  .studio-home-shell-title {
    font-size: 1.05rem;
    max-width: calc(100vw - 14rem);
  }

  .studio-home-shell-target-folder {
    font-size: 1.05rem;
    max-width: calc(100vw - 16rem);
  }

  /* Phone bar budget: the heading takes only the space the L plate and the
     account/Colleague buttons leave. The pane switch and session controls
     keep their size; the project name gives way with an ellipsis, so nothing
     overlaps and the page never scrolls sideways. */
  .studio-home-shell-heading {
    display: flex;
    flex: 1 1 auto;
    gap: var(--v64-space-1);
    min-width: 0;
    padding-left: 0;
    width: 100%;
  }

  .studio-home-shell-project-controls {
    flex: 0 0 auto;
    gap: 0.28rem;
  }

  .studio-home-shell-preview-toolbar-host {
    max-width: min(12rem, 32vw);
  }

  .studio-home-shell-project-mobile-action {
    min-width: 4rem;
    padding-inline: var(--v64-space-3) var(--v64-space-1);
  }

  /* The session controls teleported beside the name keep their size; only
     the name's own box is clipped and measured, so it gives way first. */
  .studio-home-shell-title-area {
    flex: 1 1 auto;
    padding-left: 0;
  }

  .studio-home-shell-project-name {
    container-type: inline-size;
    flex: 1 1 auto;
    overflow: hidden;
  }

  /* The GitHub actor is a status chip: on phones it shows its icon, keeping
     the account in its tooltip and accessible name, so the project name gets
     the room. */
  .studio-home-shell-github-actor-host {
    flex: 0 0 auto;
  }

  .studio-home-shell-github-actor-host :deep(.studio-home-shell-session-github-actor) {
    padding: 0;
  }

  .studio-home-shell-github-actor-host :deep(.studio-home-shell-session-github-actor span) {
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }

  /* With the project pane shown, the bar belongs to the project's controls
     (Preview's toolbar, the pane switch): the chat's session controls (new
     session, Git branch, GitHub actor) come back with the chat pane. */
  .studio-home-shell-heading--chat-collapsed .studio-home-shell-create-session-host,
  .studio-home-shell-heading--chat-collapsed .studio-home-shell-local-remotes-host,
  .studio-home-shell-heading--chat-collapsed .studio-home-shell-github-actor-host {
    display: none;
  }

  .studio-home-shell-project-selector {
    flex: 0 1 auto;
    font-size: 0.95rem;
    max-width: 100%;
    min-width: 2.25rem;
    padding-inline: 0.375rem 0.125rem;
  }

  .studio-home-shell-project-selector :deep(.v-icon) {
    margin-inline-start: 0;
  }

  /* Room for the branch count badge before the collapse arrow. */
  .studio-home-shell-local-remotes-host {
    margin-inline-end: 0.375rem;
  }

  .studio-home-shell-local-remotes-host :deep(.local-remotes__branch) {
    width: 2.5rem !important;
  }

  .studio-home-shell-title-area {
    gap: var(--v64-space-1);
  }

  .studio-home-shell-create-session-host :deep(.studio-ai-sessions__create-button) {
    height: 2.5rem;
    min-height: 2.5rem;
    min-width: 2.5rem;
    width: 2.5rem;
  }

  .studio-home-shell-chat-toggle {
    height: 2.5rem;
    min-height: 2.5rem;
    min-width: 2.5rem;
    width: 2.5rem;
  }

  .studio-home-shell-project-controls {
    gap: 0.3rem;
  }

  .studio-screen {
    max-width: 100%;
  }
}

/* Too little room for a readable name (a narrow phone showing Preview's
   controls): hide the selector rather than show a sliver of it. The chat pane
   shows it again. */
@container (max-width: 4rem) {
  .studio-home-shell-project-selector {
    visibility: hidden;
  }
}

/* Narrow phones: the next-pane button is a 40px icon button showing its
   pane's icon instead of "Dashboard ›"/"Preview ›" (its name stays "Go to
   dashboard"/"Go to preview"), which leaves the project name readable beside
   Preview's controls. */
@media (max-width: 480px) {
  .studio-home-shell-project-mobile-action {
    min-width: 2.5rem;
    padding: 0;
    width: 2.5rem;
  }

  .studio-home-shell-project-mobile-action__icon {
    display: inline-flex !important;
  }

  .studio-home-shell-project-mobile-action__label,
  .studio-home-shell-project-mobile-action__chevron {
    display: none !important;
  }
}
</style>
