<template>
  <section class="studio-autopilot__project-panel" aria-label="Project">
    <Vibe64AsyncModuleState
      v-if="sourceToolLoading"
      class="studio-autopilot__right-pane-page"
      label="session source"
      loading
    />
    <Vibe64DashboardShell
      v-if="props.projectPane === 'dashboard'"
      v-show="dashboardShellVisible"
      class="studio-autopilot__dashboard-shell"
      :dashboard-context="dashboardContext"
    >
      <div
        v-show="dashboardRouteVisible"
        class="studio-autopilot__right-pane-page"
        :data-vibe64-guide-pane="vibe64SessionToolGuideId(rightPaneTab)"
        role="tabpanel"
      >
        <slot
          v-if="dashboardRouteVisible"
          name="dashboard"
          :dashboard-context="dashboardContext"
        />
      </div>

      <div
        v-show="rightPaneTab === 'ai-terminal'"
        class="studio-autopilot__right-pane-page"
        role="tabpanel"
      >
        <slot
          v-if="rightPaneTabMounted('ai-terminal')"
          name="ai-terminal"
          :active="rightPaneTab === 'ai-terminal'"
        />
      </div>
    </Vibe64DashboardShell>

    <section
      v-if="props.projectPane === 'dashboard' && rightPaneTab === 'changes'"
      :data-vibe64-guide-pane="vibe64SessionToolGuideId('changes')"
      class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
      role="tabpanel"
    >
      <header class="studio-autopilot__session-tool-header">
        <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="backToDashboard" />
      </header>
      <div class="studio-autopilot__right-pane-page">
        <slot name="dashboard" :dashboard-context="dashboardContext" />
      </div>
    </section>

    <section
      v-show="props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
      :data-vibe64-guide-pane="vibe64SessionToolGuideId('editor')"
      class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
      role="tabpanel"
    >
      <header class="studio-autopilot__session-tool-header">
        <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="systemBackAvailable ? backToSystemFromEditor() : backToDashboard()">
          {{ systemBackAvailable ? "Back to Architecture" : "Back to dashboard" }}
        </Vibe64DashboardBackButton>
      </header>
      <Vibe64SessionFiles
        :key="assistantAccessScopeKey"
        :repo-available="Boolean(sessionSourceRoot)"
        v-if="rightPaneTabMounted('editor')"
        :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
        :agent-active="agentActive"
        :file-bookmarks="fileBookmarks"
        :assistant-available="assistantCanUsePurpose('source_explanation')"
        :assistant-unavailable-message="assistantPurposes.source_explanation?.message || 'Source explanations are unavailable.'"
        :assistant-draft-available="assistantDraftAvailable"
        class="studio-autopilot__session-tool-content"
        :open-request="sourceEditorOpenRequest"
        :project-slug="projectSlug"
        :session-id="sessionId"
        :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
        @ask-assistant-about-file="askAssistantAboutFile"
        @open-program="architectureProgramRequest = { id: $event }; selectSessionTool('system')"
      />
    </section>

    <section
      v-show="props.projectPane === 'dashboard' && rightPaneTab === 'database'"
      :data-vibe64-guide-pane="vibe64SessionToolGuideId('database')"
      class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
      role="tabpanel"
    >
      <header class="studio-autopilot__session-tool-header">
        <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="systemBackAvailable ? backToSystemFromEditor() : backToDashboard()">
          {{ systemBackAvailable ? "Back to Architecture" : "Back to dashboard" }}
        </Vibe64DashboardBackButton>
      </header>
      <Vibe64DatabaseWorkspace
        :key="assistantAccessScopeKey"
        :open-request="databaseOpenRequest"
        v-if="rightPaneTabMounted('database')"
        :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'database'"
        :assistant-available="assistantCanUsePurpose('fix')"
        class="studio-autopilot__session-tool-content"
        :project-slug="projectSlug"
        :reload-version="overviewReloadVersion"
        :session-id="sessionId"
        @request-overview-assistant="requestOverviewAssistant"
      />
    </section>

    <section
      v-show="props.projectPane === 'dashboard' && rightPaneTab === 'system'"
      :data-vibe64-guide-pane="vibe64SessionToolGuideId('system')"
      class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane studio-autopilot__architecture-pane"
      role="tabpanel"
    >
      <Vibe64ArchitectureView
        :assistant-available="assistantFixAllowed && !repositoryOperationActive && !props.sessionSelectionArchived"
        v-if="rightPaneTabMounted('system')"
        :active="props.active && props.projectPane === 'dashboard' && rightPaneTab === 'system'"
        class="studio-autopilot__session-tool-content"
        :resolve-request-url="resolveStudioRequestUrl"
        :restore-request="systemRestoreRequest"
        :open-program-request="architectureProgramRequest"
        :usage-open-request="usageOpenRequest"
        @select-preview="selectPreview"
        :project-slug="projectSlug"
        @open-table="openSubsystemTable"
        :session-id="sessionId"
        @inspect-file="architectureFileRequest = { ...$event, presentation: 'interface' }"
        @open-source-file-immersive="openSourceEditorFile"
        @open-source-file="openSourceEditorFile"
      >
        <template #navigation>
          <Vibe64DashboardBackButton data-vibe64-guide-pane="dashboard" @click="backToDashboard" />
        </template>
        <template #text="{ text, sourcePath, openSource }"><LongTextPreviewBlocks :blocks="parseLongTextReviewBlocks(text || '')" @open-link="openSubsystemTextLink($event, sourcePath, openSource)" /></template>
        <template #file-interface="{ request, active, architecture, openFile, updateLocation, openProgram }">
          <Vibe64SessionSourceEditor
            single-file :active="props.active && active" :agent-active="agentActive"
            :architecture-facts="architecture"
            :file-bookmarks="fileBookmarks"
            :assistant-draft-available="assistantDraftAvailable"
            @ask-assistant-about-file="askAssistantAboutFile"
            @open-program="openProgram"
            :open-request="request" :project-slug="projectSlug" :session-id="sessionId"
            :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
            @open-source-file="openFile"
            @interface-location="updateLocation"
            :assistant-available="assistantCanUsePurpose('source_explanation')"
            :assistant-unavailable-message="assistantPurposes.source_explanation?.message || 'Source explanations are unavailable.'"
          />
        </template>
      </Vibe64ArchitectureView>
      <v-dialog :model-value="Boolean(architectureFileRequest)" max-width="1100" @update:model-value="!$event && (architectureFileRequest = null)">
        <section class="studio-autopilot__architecture-file" aria-label="Architecture file viewer">
          <header><strong>{{ architectureFileRequest?.path }}</strong><v-btn variant="text" aria-label="Close file viewer" @click="architectureFileRequest = null">Close</v-btn></header>
          <Vibe64SessionSourceEditor
            v-if="architectureFileRequest" single-file
            :key="architectureFileRequest.path" :active="props.active" :agent-active="agentActive"
            :open-request="architectureFileRequest" :project-slug="projectSlug" :session-id="sessionId"
            :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
            @open-source-file="openSourceEditorFile"
            :assistant-available="assistantCanUsePurpose('source_explanation')"
            :assistant-unavailable-message="assistantPurposes.source_explanation?.message || 'Source explanations are unavailable.'"
          />
        </section>
      </v-dialog>
    </section>

    <!-- Learn mode's lesson, its toggle on: a sheet over Preview or Dash, which stay mounted (and running) under it. -->
    <Vibe64LessonSheet v-if="lessonShown && props.active" />
    <div
      v-show="props.projectPane === 'preview'"
      class="studio-autopilot__right-pane-page"
      data-vibe64-guide-pane="preview"
      role="tabpanel"
    >
      <Vibe64ProjectOnboarding
        :active="props.active && props.projectPane === 'preview'"
        :archived="props.sessionSelectionArchived"
        :busy="sourceOperationsSuspended || agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
        :can-ask="assistantFixAllowed"
        :session-id="selectedAssistantSessionId"
      >
        <Vibe64OutputControls
          :preview-identity-fix-allowed="assistantFixAllowed"
          :prepare-preview-file="attachPreviewFileProducer"
          :auto-start-managed-preview="!props.sessionSelectionArchived"
          button-label="Run"
          button-size="small"
          button-variant="tonal"
          :busy="agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"
          class="studio-autopilot__preview-launch"
          embedded-preview
          :preview-displayed="props.projectPane === 'preview' && !lessonShown"
          :session="props.session"
          :source-operations-suspended="sourceOperationsSuspended"
          :toolbar-teleport-target="props.projectPane === 'preview' ? props.previewToolbarTeleportTarget : ''"
          :window-displayed="props.active"
          @open-usage="openUsage"
          @preview-attachment-state="updatePreviewAttachmentState"
          @test-approval="updateTestApproval"
        />
      </Vibe64ProjectOnboarding>
    </div>
  </section>
</template>

<script setup>
import Vibe64DashboardBackButton from "../Vibe64DashboardBackButton.vue";
import { defineAsyncComponent, inject, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { VIBE64_AI_TASKS_KEY } from "@local/vibe64-ai-tasks/client";
import { AI_TASK_PHASES } from "@local/vibe64-ai-tasks/shared";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import Vibe64ProjectOnboarding from "@/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import Vibe64LessonSheet from "@/components/learning/Vibe64LessonSheet.vue";
import { vibe64SessionToolGuideId } from "@/lib/vibe64SessionToolDefinitions.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";

// The project side of a session: the Dashboard and its session tools, and
// Preview with the lesson sheet over it.
const { view } = defineProps({
  // The Autopilot view's state and actions. It is never replaced, so its
  // members are read once.
  view: { type: Object, required: true }
});
// project-attention: Preview was chosen, which a phone shows in place of the chat.
const emit = defineEmits(["project-attention"]);
/** @type {import("@/composables/useVibe64AutopilotView.js").Vibe64AutopilotViewParts} */
const {
  agentActive, askAssistantAboutFile, assistantAccessScopeKey, assistantCanUsePurpose,
  assistantDraftAvailable, assistantFixAllowed, assistantPurposes, backToDashboard, backToSystemFromEditor,
  aiTaskComposer, composerInput, dashboardContext, dashboardRouteVisible, dashboardShellVisible, databaseOpenRequest,
  fileBookmarks, lessonShown,
  openSourceEditorFile, openSubsystemTable, openUsage, prefillComposer, projectSlug, props,
  repositoryOperationActive, rightPaneTab, rightPaneTabMounted, selectedAssistantSessionId, selectSessionTool,
  sessionId, sessionSourceRoot, sourceEditorOpenRequest, sourceOperationsSuspended, sourceToolLoading,
  systemBackAvailable, systemRestoreRequest, temporaryAiWorkspace,
  updatePreviewAttachmentState, updateTestApproval, usageOpenRequest, Vibe64OutputControls
} = view;
/** @type {import("@local/vibe64-ai-tasks/client/types").AiTaskHost} */
const aiTasks = inject(VIBE64_AI_TASKS_KEY);
// Creating or reviewing the Data overview is an AI task; a person who may not use the fix assistant gets the
// request as a main chat draft instead.
function requestOverviewAssistant({ input, message }) {
  if (assistantCanUsePurpose("fix")) void aiTasks.start("database-overview", null, input);
  else prefillComposer(message, { append: true });
}
// Overview reads its source again once its task is Done.
const overviewReloadVersion = ref(0);
watch(() => aiTasks.task?.kind === "database-overview" && aiTasks.task.phase === AI_TASK_PHASES.DONE, (done) => {
  if (done) overviewReloadVersion.value += 1;
});
const architectureFileRequest = ref(null);
const architectureProgramRequest = ref(null);
watch(() => props.session?.sessionId, () => {
  architectureFileRequest.value = null;
  architectureProgramRequest.value = null;
});
function openSubsystemTextLink({ event, href }, sourcePath, openSource) {
  // Markdown links are relative to their declaration, not the dashboard URL.
  const relative = href && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(href);
  const target = sourceEditorLinkTarget({
    href: relative
      ? new URL(href, `https://source.invalid/${sourcePath}`).pathname.slice(1)
      : href
  });
  if (!target) return;
  event?.preventDefault();
  openSource(target);
}
// Files and the source viewer bring CodeMirror and the file browser (about 1.2 MB of
// script), so they load when a session first opens Files or a source file rather
// than with every project page.
const Vibe64SessionFiles = defineAsyncComponent(() => import("@/components/studio/vibe64-session/Vibe64SessionFiles.vue"));
const Vibe64SessionSourceEditor = defineAsyncComponent(() => import("@/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue"));
const Vibe64ArchitectureView = defineAsyncComponent(() => (
  import("@local/vibe64-system-graph/client").then((module) => module.loadVibe64ArchitectureView())
));
const Vibe64DatabaseWorkspace = defineAsyncComponent(() => (
  import("@local/vibe64-database-tools/client").then((module) => module.loadVibe64DatabaseWorkspace())
));
// "Go to Preview" after starting a recording: the Preview pane, on a phone
// in place of the chat.
const router = useRouter();
function selectPreview() {
  void router.push(projectAppPath(projectSlug.value));
  emit("project-attention");
}

async function attachPreviewFileProducer(options = {}) {
  const composer = aiTaskComposer.value || temporaryAiWorkspace.value?.composer || composerInput.value;
  const uploaded = await composer?.attachFileProducer(options);
  return Array.isArray(uploaded) && uploaded.length > 0 ? uploaded[0] : null;
}
</script>

<style scoped>
.studio-autopilot__project-panel,
.studio-autopilot__dashboard-shell,
.studio-autopilot__right-pane-page,
.studio-autopilot__session-tool-pane,
.studio-autopilot__session-tool-content {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__project-panel {
  contain: strict;
  overflow: hidden;
  position: relative;
}

.studio-autopilot__right-pane-page {
  overflow: auto;
}

.studio-autopilot__session-tool-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.studio-autopilot__architecture-pane {
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.studio-autopilot__session-tool-header {
  align-items: center;
  background: rgb(var(--v-theme-surface-container-low));
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  gap: 0.4rem;
  min-height: 3rem;
  padding: var(--v64-space-1) var(--v64-space-2);
}

/* Current changes renders a Dashboard page inside the tool pane: give it the page gutter. */
.studio-autopilot__session-tool-pane > .studio-autopilot__right-pane-page {
  padding: var(--v64-space-3) var(--v64-space-4) var(--v64-space-4);
}

.studio-autopilot__session-tool-content {
  overflow: hidden;
}

.studio-autopilot__preview-launch {
  height: 100%;
}
</style>

<style scoped>
.studio-autopilot__architecture-file { height: min(84dvh, 850px); min-height: 0; display: flex; flex-direction: column; background: rgb(var(--v-theme-surface)); border-radius: 12px; overflow: hidden; }
.studio-autopilot__architecture-file > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .12); }
.studio-autopilot__architecture-file > header strong { overflow-wrap: anywhere; font-size: 14px; }
.studio-autopilot__architecture-file > .vibe64-source-editor { flex: 1; min-height: 0; }
</style>
