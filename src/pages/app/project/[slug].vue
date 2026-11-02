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
import Vibe64LearningStage from "@/components/learning/Vibe64LearningStage.vue";
import Vibe64NoProjectPane from "@/components/learning/Vibe64NoProjectPane.vue";
import Vibe64LearningCoursesItem from "@/components/learning/Vibe64LearningCoursesItem.vue";
import Vibe64ProjectPaneControls from "@/components/studio/Vibe64ProjectPaneControls.vue";
import { useVibe64AppPage } from "@/composables/useVibe64AppPage.js";
import { projectDisplayName, projectSubtitle } from "@/lib/vibe64PracticeProjectName.js";

const githubActorHostId = "studio-home-shell-github-actor";
const githubActorTeleportTarget = `#${githubActorHostId}`;

const {
  chatCollapsed,
  chatColumnVisible,
  chatToggleIcon,
  chatToggleTitle,
  dashboardRouteActive,
  emptySection,
  handleProjectSelectionDeleted,
  handleProjectSelectionError,
  handleProjectSelectionMissing,
  handleProjectSelectionReady,
  learnMode,
  lessonToggleVisible,
  mdiChevronDown,
  mobilePaneSwipeEnabled,
  mobileProjectAction,
  mobileProjectActionVisible,
  openProject,
  pageError,
  previewToolbarHostId,
  previewToolbarHostVisible,
  previewToolbarTeleportTarget,
  usageRecordingHostId,
  usageRecordingStripHostId,
  usageRecordingTeleportTarget,
  projectLoadError,
  projectPane,
  projectPaneNavigationVisible,
  projectRuntimeError,
  projectRuntimeReady,
  projectSlug,
  projectTabs,
  retryProjectRuntime,
  selectEmptySection,
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
                  :disabled="!projectSlug && !learnMode"
                  variant="text"
                  v-bind="menuProps"
                  :title="projectSlug && projectTitle !== projectSlug ? `${projectTitle} (${projectSlug})` : projectTitle"
                >
                  <span>{{ projectTitle || "Project" }}</span>
                  <v-icon :icon="mdiChevronDown" size="18" />
                </v-btn>
              </template>
              <v-list density="compact" min-width="240">
                <Vibe64LearningCoursesItem />
                <v-list-item
                  v-for="project in switcherProjects"
                  :key="project.slug"
                  :active="project.slug === projectSlug"
                  :title="projectDisplayName(project)"
                  :subtitle="projectSubtitle(project)"
                  @click="openProject(project)"
                />
                <v-list-item
                  v-if="switcherProjects.length === 0 && !learnMode"
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
        </div>

        <Vibe64ProjectPaneControls
          :chat-collapsed="chatCollapsed"
          :chat-column-visible="chatColumnVisible"
          :chat-toggle-icon="chatToggleIcon"
          :chat-toggle-title="chatToggleTitle"
          :lesson-toggle-visible="lessonToggleVisible"
          :mobile-project-action="mobileProjectAction"
          :mobile-project-action-visible="mobileProjectActionVisible"
          :preview-toolbar-host-id="previewToolbarHostId"
          :preview-toolbar-host-visible="previewToolbarHostVisible"
          :project-pane="projectPane"
          :project-pane-navigation-visible="projectPaneNavigationVisible"
          :project-slug="projectSlug"
          :project-tabs="projectTabs"
          :usage-recording-host-id="usageRecordingHostId"
          @select-pane="selectProjectPane"
          @update:chat-collapsed="setChatCollapsed"
        />
      </div>
    </template>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>
    <!-- A phone's recording indicator: a strip below the header, which keeps
         its room for the pane controls. -->
    <div
      v-if="projectSlug"
      :id="usageRecordingStripHostId"
      class="studio-home-shell-usage-recording-strip"
    />
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

      <!-- The current lesson's steps, in Learn mode. -->
      <Vibe64LearningStage />
      <!-- No slug: Learn mode without a practice project (/app/learning). -->
      <Vibe64NoProjectPane
        v-if="!projectSlug"
        :chat-collapsed="chatCollapsed"
        :project-pane="projectPane"
        :section="emptySection"
        @select="selectEmptySection"
      />
      <div v-else class="studio-screen__gate-scroll">
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
              :usage-recording-teleport-target="usageRecordingTeleportTarget"
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

/* The heading takes the bar's room left of the account/Colleague buttons.
   Its title area lines up with the chat column and gives way first when the
   bar is short of room (a lesson's L plate, Preview's controls, the Set up AI
   pill); then Preview's address shortens. On a bar still too narrow the
   heading is clipped, so nothing overlaps the account/Colleague buttons or
   runs past the right edge. */
.studio-home-shell-heading {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  gap: var(--studio-home-project-gap);
  min-width: 0;
  overflow-x: clip;
  overflow-clip-margin: 4px;
}

.studio-home-shell-title-area {
  align-items: center;
  display: flex;
  flex: 0 1000 var(--studio-home-chat-column-width);
  gap: 0.42rem;
  min-width: 0;
  padding-left: 1rem;
}

.studio-home-shell-heading--chat-collapsed .studio-home-shell-title-area {
  flex-basis: auto;
}

/* Desktop: the project controls (the chat toggle, then the pane switch) start
   where the chat column ends, whatever sits beside the project name. */
@media (min-width: 981px) {
  .studio-home-shell-heading:not(.studio-home-shell-heading--chat-collapsed) .studio-home-shell-title-area {
    flex: 0 1000 auto;
    width: calc(var(--studio-home-chat-column-edge, var(--studio-home-chat-column-width)) - var(--studio-home-project-gap) - 2.7rem);
  }
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

/* A phone's indicator strip runs the full width below the header. With
   nothing to show it stays out of the flow; its live region still announces. */
.studio-home-shell-usage-recording-strip {
  flex: 0 0 auto;
  position: absolute;
  width: 0;
}

.studio-home-shell-usage-recording-strip:has(.usage-recording-indicator__pill) {
  position: static;
  width: 100%;
}

@media (min-width: 981px) {
  .studio-screen__gate-scroll :deep(.project-selection-gate .studio-ai-sessions--autopilot) {
    padding: 0;
  }
}

@media (max-width: 980px) {
  .studio-home-shell-heading {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
  }
}

@media (max-width: 600px) {
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
</style>
