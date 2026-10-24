<template>
  <Vibe64SessionFrame
    :chat-collapsed="chatCollapsed"
    :class="{
      'studio-ai-sessions--unavailable': sessionData.sessionList.unavailableItems.length > 0
    }"
    @pointermove="sessionTooltip.trackPointer"
    @pointerleave="sessionTooltip.resumeHover"
  >
    <Transition name="studio-ai-sessions-error">
      <div
        v-if="visiblePageError"
        class="studio-ai-sessions__error-overlay"
      >
        <StudioErrorNotice
          title="Session data could not refresh"
          :error="pageError"
          compact
          dismissible
          @dismiss="dismissPageError"
        />
      </div>
    </Transition>

    <Vibe64UnavailableSessions
      :sessions="sessionData.sessionList.unavailableItems"
      :loading="sessionData.sessionList.isLoading"
      @recheck="sessionData.refreshSessionData"
    />

    <Vibe64SessionArchiveDialog :archive="selectedArchive" :short-session-id="sessionData.shortSessionId" />

    <Vibe64EmptySessionLayout
      v-if="emptyLayoutVisible"
      :aria-hidden="selectedSessionArchiving ? 'true' : undefined"
      :chat-collapsed="chatCollapsed"
      :dashboard="dashboardProjectActive"
      :lesson="Boolean(learning?.lessonShown)"
      :hint="emptyChatHintText"
      :inert="selectedSessionArchiving"
      :preview-detail="emptyPreviewDetailText"
      :preview-title="emptyPreviewTitleText"
    >
      <template #header>
        <Vibe64SessionToolbar
          :archive="selectedArchive"
          compact
          :create-attention="emptyCreateAttention"
          :create-teleport-target="selectedSessionArchiving ? '' : props.createSessionTeleportTarget"
          :create-visible="!emptyStateInitialLoading && toolbar.createSessionVisible"
          :max-visible-sessions="3"
          :selected-session-id="selection.selectedSessionId"
          :selection-archived="selection.isArchived"
          :toolbar="emptyToolbar"
        />
      </template>
      <template #chat>
        <Vibe64TemporaryAiWorkspace
          v-if="hostConversation" class="studio-ai-sessions__empty-host-conversation" active
          @select-main-chat="hostConversation.close()"
        />
      </template>
      <template #dashboard>
        <slot name="dashboard" :dashboard-context="{ ...emptyDashboardContext, sessionToolbar: toolbar }" />
      </template>
      <template #lesson>
        <Vibe64LessonSheet />
      </template>
      <template #preview>
        <div
          v-if="emptyStateInitialLoading"
          class="studio-ai-sessions__preview-empty-loading"
          role="status"
        >
          <v-skeleton-loader
            :aria-label="emptyStateStatusText"
            class="studio-ai-sessions__preview-empty-skeleton"
            type="button"
          />
        </div>
        <Vibe64CreateSessionButton
          v-else-if="toolbar.createSessionVisible"
          aria-label="Create session"
          button-class="studio-ai-sessions__preview-create-button"
          :icon-only="false"
          label="Create session"
          :toolbar="emptyToolbar"
        />
      </template>
    </Vibe64EmptySessionLayout>

    <div
      v-show="!emptyLayoutVisible && runtimeHostSessionIds.length > 0"
      class="studio-ai-sessions__runtime-stack"
      :aria-hidden="selectedSessionArchiving ? 'true' : undefined"
      :inert="selectedSessionArchiving"
    >
      <Vibe64SessionRuntimeHost
        v-for="runtimeSessionId in runtimeHostSessionIds"
        v-show="runtimeSessionId === selection.selectedSessionId"
        :key="runtimeSessionId"
        :active="runtimeSessionId === selection.selectedSessionId"
        :session-data="sessionData"
        :session-id="runtimeSessionId"
        :chat-collapsed="chatCollapsed"
        :create-session-teleport-target="!emptyLayoutVisible && !selectedSessionArchiving && runtimeSessionId === selection.selectedSessionId ? props.createSessionTeleportTarget : ''"
        :github-actor-teleport-target="runtimeSessionId === selection.selectedSessionId ? props.githubActorTeleportTarget : ''"
        :project-context="props.projectContext"
        :preview-toolbar-teleport-target="runtimeSessionId === selection.selectedSessionId ? props.previewToolbarTeleportTarget : ''"
        :prompt-hint-policy="promptHintPolicy"
        :project-pane="projectPane"
        :toolbar-sessions="toolbar.sessions"
        :refresh-repository-state="toolbar.refreshRepositoryState"
        @busy-change="setRuntimeBusy"
        @chat-attention="emitChatAttention"
        @execution-attention="emit('execution-attention', $event)"
        @page-error-change="setRuntimePageError"
        @source-operations-suspension-change="setRuntimeSourceOperationsSuspended"
        @work-state-change="setRuntimeWorkState"
        @toolbar-controls-ready="setRuntimeToolbarControls"
        @project-attention="emitProjectAttention"
      >
        <template #dashboard="dashboardSlotProps">
          <slot
            name="dashboard"
            :dashboard-context="{ ...(dashboardSlotProps?.dashboardContext || {}), sessionToolbar: toolbar }"
          />
        </template>
      </Vibe64SessionRuntimeHost>
    </div>
  </Vibe64SessionFrame>
</template>

<script setup>
import { computed, inject, provide } from "vue";
import { VIBE64_HOST_CONVERSATION_KEY } from "@/lib/vibe64AssistantHost.js";
import Vibe64TemporaryAiWorkspace from "@/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";
import Vibe64SessionArchiveDialog from "@/components/studio/vibe64-session/Vibe64SessionArchiveDialog.vue";
import Vibe64SessionRuntimeHost from "@/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64CreateSessionButton from "@/components/studio/vibe64-session/Vibe64CreateSessionButton.vue";
import Vibe64EmptySessionLayout from "@/components/studio/Vibe64EmptySessionLayout.vue";
import Vibe64LessonSheet from "@/components/learning/Vibe64LessonSheet.vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import Vibe64SessionFrame from "@/components/studio/Vibe64SessionFrame.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64UnavailableSessions from "@/components/studio/Vibe64UnavailableSessions.vue";
import {
  useVibe64SessionPanel,
  vibe64SessionPanelEmits,
  vibe64SessionPanelProps
} from "@/composables/useVibe64SessionPanel.js";
import {
  focusCreatedVibe64SessionTab
} from "@/lib/vibe64SessionFocus.js";
import {
  createVibe64SessionTooltipState,
  VIBE64_SESSION_TOOLTIP_KEY
} from "@/lib/vibe64SessionTooltip.js";

const hostConversation = inject(VIBE64_HOST_CONVERSATION_KEY, null);
const emit = defineEmits(vibe64SessionPanelEmits);
const props = defineProps(vibe64SessionPanelProps);
const sessionTooltip = createVibe64SessionTooltipState();
const learning = useVibe64Learning();
provide(VIBE64_SESSION_TOOLTIP_KEY, sessionTooltip);

const {
  chatCollapsed,
  dashboardProjectActive,
  dismissPageError,
  emitChatAttention,
  emitProjectAttention,
  emptyChatHintText,
  emptyCreateAttention,
  emptyDashboardContext,
  emptyLayoutVisible,
  emptyPreviewDetailText,
  emptyPreviewTitleText,
  emptyStateInitialLoading,
  emptyStateStatusText,
  pageError,
  promptHintPolicy,
  projectPane,
  runtimeHostSessionIds,
  selectedArchive,
  selectedSessionArchiving,
  selection,
  sessionData,
  setRuntimeBusy,
  setRuntimePageError,
  setRuntimeSourceOperationsSuspended,
  setRuntimeWorkState,
  setRuntimeToolbarControls,
  toolbar,
  visiblePageError
} = useVibe64SessionPanel(props, emit);

async function createSessionForEmptyState(assistantSelection = {}, options = {}) {
  const response = await toolbar.createSession?.(assistantSelection, options);
  if (response?.sessionId) {
    void focusCreatedVibe64SessionTab(response.sessionId);
  }
  return response;
}

const emptyToolbar = computed(() => ({
  projectContext: props.projectContext,
  ...toolbar,
  createSession: createSessionForEmptyState
}));
</script>

<style scoped>
.studio-ai-sessions__empty-main > .studio-ai-sessions__empty-host-conversation {
  grid-row: 2 / -1;
}

.studio-ai-sessions__preview-empty-loading {
  width: 10rem;
}

.studio-ai-sessions__preview-empty-skeleton {
  width: 100%;
}

.studio-ai-sessions__error-overlay {
  left: 0.85rem;
  max-width: min(42rem, calc(100% - 1.7rem));
  position: absolute;
  top: 0.85rem;
  z-index: 12;
}

.studio-ai-sessions-error-enter-active,
.studio-ai-sessions-error-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.studio-ai-sessions-error-enter-from,
.studio-ai-sessions-error-leave-to {
  opacity: 0;
  transform: translateY(-0.35rem);
}

.studio-ai-sessions__runtime-stack {
  display: grid;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

@media (min-width: 981px) {
  .studio-ai-sessions__runtime-stack {
    min-height: 0;
  }
}
</style>
