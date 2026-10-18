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
import { computed, inject, nextTick, onBeforeUnmount, ref, watchEffect } from "vue";
import { mdiSchoolOutline } from "@mdi/js";
import Vibe64LearningPracticeProjectSelector from "@/components/studio/Vibe64LearningPracticeProjectSelector.vue";
import Vibe64LearningLessonLauncher from "@/components/studio/Vibe64LearningLessonLauncher.vue";
import { useVibe64LearningMode } from "@/composables/useVibe64LearningMode.js";
import { VIBE64_LEARNING_NAVIGATION_KEY } from "@/lib/vibe64AssistantHost.js";
import TrainingGuideOverlay from "@local/vibe64-training/client/guide-overlay";

const githubActorHostId = "studio-home-shell-github-actor";
const githubActorTeleportTarget = `#${githubActorHostId}`;
const LEARNING_TAB = Object.freeze({ id: "learning", label: "Learning", icon: mdiSchoolOutline,
  title: "Learning: courses and lesson" });

const {
  chatCollapsed,
  chatToggleIcon,
  chatToggleTitle,
  dashboardRouteActive,
  emitPageTitle,
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
  showProjectPane: showWorkingProjectPane,
  switcherProjects,
  targetFolderName
} = useVibe64AppPage();

const panel = ref(null);
const learning = useVibe64LearningMode({ onConversationOpened(identity) {
  panel.value?.selectLearningConversation(identity);
} });
const { learningMode, learningView, purposeFilter, learningResource } = learning;
const learningWorkspaceAvailable = computed(() => panel.value?.learningWorkspaceAvailable === true);
const learningPaneActive = computed(() => learningMode.value &&
  (learningView.value === "learning" || !learningWorkspaceAvailable.value));
function showProjectPane() {
  if (learningMode.value) {
    if (!learningWorkspaceAvailable.value) return;
    void learning.setLearningView("workspace");
  }
  showWorkingProjectPane();
}
// One header for both modes: Learning only adds its graduation-cap option to
// the same Preview | Dashboard group; selecting it shows the Learning panes.
const headerTabs = computed(() => learningMode.value ? [...projectTabs, LEARNING_TAB] : projectTabs);
const activeHeaderTab = computed(() => learningPaneActive.value ? "learning" : projectPane.value);
const headerTabDisabled = id => learningMode.value && id !== "learning" && !learningWorkspaceAvailable.value;
async function selectHeaderTab(id, event) {
  if (headerTabDisabled(id)) return;
  if (id === "learning") return learning.setLearningView("learning");
  if (learningMode.value && learningView.value !== "workspace") await learning.setLearningView("workspace");
  selectProjectPane(id, event);
}
// The phone header keeps Working's single "next pane" button; Learning's cap is
// one more stop in that cycle.
const mobileHeaderAction = computed(() => {
  if (!learningMode.value) return mobileProjectAction.value;
  const ids = headerTabs.value.map(tab => tab.id).filter(id => !headerTabDisabled(id));
  const next = headerTabs.value.find(tab => tab.id === ids[(ids.indexOf(activeHeaderTab.value) + 1) % ids.length]);
  return next.id === activeHeaderTab.value ? null
    : { ariaLabel: `Go to ${next.label.toLowerCase()}`, label: next.label, pane: next.id };
});

const learningNavigation = inject(VIBE64_LEARNING_NAVIGATION_KEY, null);
function waitForLearningPanel(action, isCurrent, failure) {
  return new Promise((resolve, reject) => {
    let stop;
    const timer = setTimeout(() => finish(new Error(failure)), 12000);
    function finish(error) {
      clearTimeout(timer);
      if (stop) stop();
      else queueMicrotask(() => stop?.());
      if (error) reject(error);
      else resolve();
    }
    stop = watchEffect(() => {
      if (!isCurrent()) finish(new Error("The Learning navigation target changed before it opened."));
      else if (action()) finish();
    }, { flush: "post" });
  });
}
async function navigateLearning(command, isCurrent = () => true) {
  if (command.learningMode === false) {
    if (learningMode.value) await learning.setLearningMode(false);
    return;
  }
  if (command.learningMode !== true) return;
  if (!learningMode.value) await learning.setLearningMode(true);
  if (!isCurrent()) throw new Error("The Learning navigation target changed before it opened.");
  await nextTick();
  if (command.learningContent === "picker") {
    await waitForLearningPanel(() => panel.value?.showLearningPicker() === true, isCurrent,
      "The lesson picker did not become available.");
  } else if (command.learningAttemptId || command.sessionId) {
    const identity = { attemptId: command.learningAttemptId, sessionId: command.sessionId,
      learnerId: learning.learnerId.value };
    await waitForLearningPanel(() => panel.value?.selectLearningConversation(identity) === true, isCurrent,
      "The requested Learning session did not become available.");
  }
  if (command.learningView && learningView.value !== command.learningView) {
    if (command.learningView === "workspace" && panel.value?.learningWorkspaceAvailable !== true) {
      throw new Error("This lesson has no project workspace.");
    }
    await learning.setLearningView(command.learningView);
  }
}
if (learningNavigation) learningNavigation.value = navigateLearning;
onBeforeUnmount(() => {
  if (learningNavigation?.value === navigateLearning) learningNavigation.value = null;
});

</script>

<template>
  <StudioAppShellLayout
    show-learning-mode-control
    :learning-mode="learningMode"
    @update:learning-mode="learning.setLearningMode"
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
          <Vibe64LearningPracticeProjectSelector v-if="learningMode" :panel="panel" />
          <v-menu v-else location="bottom start">
            <template #activator="{ props: menuProps }">
              <v-btn
                class="studio-home-shell-project-selector"
                variant="text"
                v-bind="menuProps"
              >
                <span>{{ targetFolderName || "Project" }}</span>
                <v-icon :icon="mdiChevronDown" size="18" />
              </v-btn>
            </template>
            <v-list density="compact" min-width="240">
              <v-list-item
                v-for="project in switcherProjects"
                :key="project.slug"
                :active="project.slug === projectSlug"
                :title="project.slug"
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
            v-if="projectPaneNavigationVisible || learningMode"
            class="studio-home-shell-project-tabs studio-home-shell-project-tabs--desktop"
            role="tablist"
            aria-label="Project"
          >
            <button
              v-for="tab in headerTabs"
              :key="tab.id"
              class="studio-home-shell-project-tab"
              :class="{ 'studio-home-shell-project-tab--active': activeHeaderTab === tab.id }"
              role="tab"
              type="button"
              :data-vibe64-guide="tab.id"
              :aria-label="tab.icon ? tab.label : undefined"
              :aria-selected="activeHeaderTab === tab.id ? 'true' : 'false'"
              :aria-disabled="headerTabDisabled(tab.id) ? 'true' : undefined"
              :disabled="headerTabDisabled(tab.id)"
              :title="headerTabDisabled(tab.id) ? 'This lesson has no project workspace' : tab.title"
              @click="selectHeaderTab(tab.id, $event)"
            >
              <v-icon v-if="tab.icon" :icon="tab.icon" size="18" />
              <template v-else>{{ tab.label }}</template>
            </button>
          </div>
          <div
            v-if="previewToolbarHostVisible"
            v-show="!learningPaneActive"
            :id="previewToolbarHostId"
            class="studio-home-shell-preview-toolbar-host"
          />
          <button
            v-if="mobileProjectActionVisible && mobileHeaderAction"
            class="studio-home-shell-project-mobile-action"
            type="button"
            :aria-label="mobileHeaderAction.ariaLabel"
            @click="selectHeaderTab(mobileHeaderAction.pane, $event)"
          >
            {{ mobileHeaderAction.label }}
            <v-icon :icon="mdiChevronRight" size="15" />
          </button>
        </div>
      </div>
    </template>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>
    <section class="generated-ui-screen generated-ui-screen--studio studio-screen d-flex flex-column ga-3">
      <TrainingGuideOverlay v-if="learningMode" />
      <v-alert
        v-if="pageError && (!learningMode || !learningPaneActive)"
        type="error"
        variant="tonal"
        border="start"
        class="studio-screen__alert"
      >
        {{ pageError }}
      </v-alert>

      <div class="studio-screen__gate-scroll">
        <ProjectSelectionGate
          retain-independent-content
          :independent-content="learningMode"
          :runtime-ready="projectRuntimeReady"
          :runtime-error="projectRuntimeError"
          @retry-runtime="retryProjectRuntime"
          :key="projectSlug"
          scope-selection-to-current-project
          @error="handleProjectSelectionError"
          @missing="handleProjectSelectionMissing"
          @ready="handleProjectSelectionReady"
        >
          <template #default="projectSelectionSlotProps">
            <Teleport
              v-if="!learningMode && projectSelectionSlotProps?.projectSelection?.currentProject?.repositoryMode === 'local_source'"
              to="#studio-home-shell-local-remotes"
              defer
            >
              <Vibe64LocalRemoteControls
                :project="projectSelectionSlotProps.projectSelection.currentProject"
              />
            </Teleport>
            <Vibe64SessionPanel
              ref="panel"
              :active="projectSelectionSlotProps.contentActive"
              :learning-resource="learningResource"
              :learning-view="learningPaneActive ? 'learning' : 'workspace'"
              :purpose-filter="purposeFilter"
              :chat-collapsed="chatCollapsed"
              create-session-teleport-target="#studio-home-shell-create-session"
              :github-actor-teleport-target="githubActorTeleportTarget"
              :project-context="projectSelectionSlotProps?.projectSelection?.currentProject || {}"
              :preview-toolbar-teleport-target="learningPaneActive ? '' : previewToolbarTeleportTarget"
              :project-pane="learningPaneActive ? 'dashboard' : projectPane"
              @title-change="emitPageTitle"
              @chat-attention="setChatCollapsed(false)"
              @project-attention="showProjectPane"
            >
              <template #learning>
                <Vibe64LearningLessonLauncher v-if="learningMode" :learning="learning" />
              </template>
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
   gains a check that slides in; the graduation cap is a full, equal segment
   whose selected state is the warm Learning container. */
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

.studio-home-shell-project-tab[data-vibe64-guide="learning"] {
  color: var(--v64-on-learning-container);
}

.studio-home-shell-project-tab--active[data-vibe64-guide="learning"] {
  background: var(--v64-learning-container);
  box-shadow: inset 0 -2px 0 var(--v64-learning-strong);
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

/* Phone "next pane" control: an M3 tonal pill button with a 40px target;
   heading to Learning it takes the warm Learning container. */
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

.studio-home-shell-project-mobile-action:hover {
  background: color-mix(in srgb, var(--v64-on-secondary-container) 8%, var(--v64-secondary-container));
}

.studio-home-shell-project-mobile-action:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

.studio-home-shell-project-mobile-action[aria-label="Go to learning"] {
  background: var(--v64-learning-container);
  color: var(--v64-on-learning-container);
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

  .studio-home-shell-heading {
    display: flex;
    gap: 0.35rem;
    padding-left: 0.65rem;
    width: 100%;
  }

  .studio-home-shell-project-controls {
    gap: 0.28rem;
  }

  .studio-home-shell-preview-toolbar-host {
    max-width: min(12rem, 32vw);
  }

  .studio-home-shell-project-mobile-action {
    min-width: 4rem;
    padding-inline: var(--v64-space-3) var(--v64-space-1);
  }

  .studio-home-shell-title-area {
    padding-left: 0;
  }

  .studio-home-shell-project-selector {
    font-size: 0.95rem;
    max-width: calc(100vw - 16rem);
    padding-inline: var(--v64-space-1);
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
</style>
