<template>
  <v-sheet
    rounded="lg"
    class="studio-ai-sessions studio-ai-sessions--autopilot studio-screen__panel"
    :class="{ 'studio-ai-sessions--resizing': chatColumnResizing }"
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

    <Transition name="studio-ai-sessions-archiving">
      <section
        v-if="selectedSessionArchiving"
        class="studio-ai-sessions__archiving-overlay"
        aria-label="Archiving session"
        aria-live="polite"
        role="status"
      >
        <div class="studio-ai-sessions__archiving-card">
          <v-icon
            color="primary"
            :icon="mdiArchiveArrowDownOutline"
            size="32"
          />
          <strong>Archiving session…</strong>
          <span>Stopping its tools and preserving its state.</span>
        </div>
      </section>
    </Transition>

    <div
      v-show="!chatCollapsed"
      ref="chatColumnSeparator"
      class="studio-ai-sessions__chat-column-separator"
      :class="{
        'studio-ai-sessions__chat-column-separator--resizing': chatColumnResizing
      }"
      aria-label="Resize chat"
      aria-orientation="vertical"
      :aria-valuemax="chatColumnBounds.max"
      :aria-valuemin="chatColumnBounds.min"
      :aria-valuenow="chatColumnWidth"
      role="separator"
      tabindex="0"
      title="Resize chat"
      @keydown="resizeChatColumnWithKeyboard"
      @pointerdown="startChatColumnResize"
    />

    <div
      v-if="emptyLayoutVisible"
      class="studio-ai-sessions__empty-layout"
      :aria-hidden="selectedSessionArchiving ? 'true' : undefined"
      :class="{
        'studio-ai-sessions__empty-layout--chat-collapsed': chatCollapsed,
        'studio-ai-sessions__empty-layout--dashboard': dashboardProjectActive
      }"
      :inert="selectedSessionArchiving"
    >
      <section
        class="studio-ai-sessions__empty-main"
        aria-label="Session chat"
      >
        <div class="studio-ai-sessions__empty-session-header">
          <Vibe64SessionToolbar
            :archive="selectedArchive"
            compact
            :create-attention="emptyCreateAttention"
            :create-visible="!emptyStateInitialLoading && toolbar.createSessionVisible"
            :max-visible-sessions="3"
            :selected-session-id="selection.selectedSessionId"
            :selection-archived="selection.isArchived"
            :toolbar="emptyToolbar"
          />
        </div>
        <div class="studio-ai-sessions__empty-chat-body">
          <div
            v-if="emptyChatHintText"
            class="studio-ai-sessions__empty-hint"
            role="status"
          >
            {{ emptyChatHintText }}
          </div>
        </div>
        <div
          class="studio-ai-sessions__empty-thinking studio-ai-sessions__empty-thinking--empty"
          aria-hidden="true"
        >
          <span class="studio-ai-sessions__empty-thinking-mark" />
          <span>Thinking...</span>
        </div>
        <div class="studio-ai-sessions__empty-runtime-status" />
        <div class="studio-ai-sessions__empty-composer" />
      </section>

      <section
        class="studio-ai-sessions__empty-project-panel"
        aria-label="Project"
      >
        <div
          v-if="dashboardProjectActive"
          class="studio-ai-sessions__dashboard-empty-pane"
        >
          <slot name="dashboard" :dashboard-context="emptyDashboardContext" />
        </div>
        <div
          v-else
          class="studio-ai-sessions__preview-empty-pane"
        >
          <div class="studio-ai-sessions__preview-empty-content">
            <p class="studio-ai-sessions__preview-empty-title">
              {{ emptyPreviewTitleText }}
            </p>
            <p
              v-if="emptyPreviewDetailText"
              class="studio-ai-sessions__preview-empty-detail"
            >
              {{ emptyPreviewDetailText }}
            </p>
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
              menu-location="bottom center"
              :toolbar="emptyToolbar"
            />
          </div>
        </div>
      </section>
    </div>

    <div
      v-show="runtimeHostSessionIds.length > 0"
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
        :github-actor-teleport-target="runtimeSessionId === selection.selectedSessionId ? props.githubActorTeleportTarget : ''"
        :project-context="props.projectContext"
        :preview-toolbar-teleport-target="runtimeSessionId === selection.selectedSessionId ? props.previewToolbarTeleportTarget : ''"
        :prompt-hint-policy="promptHintPolicy"
        :project-pane="projectPane"
        :toolbar-sessions="toolbar.sessions"
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
            :dashboard-context="dashboardSlotProps?.dashboardContext || {}"
          />
        </template>
      </Vibe64SessionRuntimeHost>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, provide } from "vue";
import { mdiArchiveArrowDownOutline } from "@mdi/js";
import Vibe64SessionRuntimeHost from "@/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64CreateSessionButton from "@/components/studio/vibe64-session/Vibe64CreateSessionButton.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useVibe64ChatColumnResize
} from "@/composables/useVibe64ChatColumnResize.js";
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

const emit = defineEmits(vibe64SessionPanelEmits);
const props = defineProps(vibe64SessionPanelProps);
const sessionTooltip = createVibe64SessionTooltipState();
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

async function createSessionForEmptyState(assistantSelection = {}) {
  const response = await toolbar.createSession?.(assistantSelection);
  if (response?.sessionId) {
    void focusCreatedVibe64SessionTab(response.sessionId);
  }
  return response;
}

const emptyToolbar = computed(() => ({
  ...toolbar,
  createSession: createSessionForEmptyState
}));

const {
  bounds: chatColumnBounds,
  resizing: chatColumnResizing,
  resizeWithKeyboard: resizeChatColumnWithKeyboard,
  separator: chatColumnSeparator,
  startResize: startChatColumnResize,
  width: chatColumnWidth
} = useVibe64ChatColumnResize();
</script>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.studio-ai-sessions--autopilot {
  background: transparent;
  border-radius: 0 !important;
  box-shadow: none;
  gap: 0;
  grid-template-rows: minmax(0, 1fr);
  padding: 0;
}

.studio-ai-sessions__empty-layout {
  display: grid;
  gap: var(--studio-home-project-gap, 0.75rem);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-ai-sessions__chat-column-separator {
  background: transparent;
  bottom: 0;
  cursor: col-resize;
  left: var(--studio-home-chat-column-width, 24rem);
  outline: none;
  position: absolute;
  top: 0;
  touch-action: none;
  user-select: none;
  width: var(--studio-home-project-gap, 0.75rem);
  z-index: 10;
}

.studio-ai-sessions__chat-column-separator::before {
  background: rgba(var(--v-theme-on-surface), 0.14);
  bottom: 0;
  content: "";
  left: 50%;
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  transition: background-color 120ms ease, width 120ms ease;
  width: 1px;
}

.studio-ai-sessions__chat-column-separator:hover::before,
.studio-ai-sessions__chat-column-separator:focus-visible::before,
.studio-ai-sessions__chat-column-separator--resizing::before {
  background: rgb(var(--v-theme-primary));
  width: 2px;
}

.studio-ai-sessions--resizing {
  cursor: col-resize !important;
  user-select: none !important;
}

.studio-ai-sessions__empty-main,
.studio-ai-sessions__empty-project-panel {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 14px;
  box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.06);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-ai-sessions__empty-main,
.studio-ai-sessions__empty-project-panel,
.studio-ai-sessions__preview-empty-pane {
  display: grid;
}

.studio-ai-sessions__empty-main {
  gap: 0.16rem;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  overflow: visible;
  padding: 0.05rem 0.65rem 0.18rem;
}

.studio-ai-sessions__empty-session-header {
  display: grid;
  gap: 0.28rem;
  min-width: 0;
}

.studio-ai-sessions__empty-chat-body {
  align-items: start;
  display: grid;
  min-height: 0;
  overflow: hidden;
  padding: 0.25rem 0.1rem 0 0;
  scrollbar-gutter: stable;
}

.studio-ai-sessions__empty-hint {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 10px;
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.86rem;
  line-height: 1.35;
  max-width: 100%;
  padding: 0.55rem 0.65rem;
}

.studio-ai-sessions__empty-thinking {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.86rem;
  gap: 0.38rem;
  min-height: 1.35rem;
}

.studio-ai-sessions__empty-thinking--empty {
  visibility: hidden;
}

.studio-ai-sessions__empty-thinking-mark {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  box-shadow: 0 0 0 0.24rem rgba(var(--v-theme-primary), 0.12);
  height: 0.48rem;
  width: 0.48rem;
}

.studio-ai-sessions__empty-runtime-status {
  display: none;
}

.studio-ai-sessions__empty-composer {
  min-height: 0.35rem;
  min-width: 0;
}

.studio-ai-sessions__dashboard-empty-pane {
  align-content: start;
  display: grid;
  gap: 0.75rem;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 0.85rem;
  scrollbar-gutter: stable;
}

.studio-ai-sessions__preview-empty-pane {
  align-items: center;
  justify-items: center;
  min-height: 0;
  min-width: 0;
  padding: 1rem;
}

.studio-ai-sessions__preview-empty-content {
  align-items: center;
  display: grid;
  gap: 0.65rem;
  justify-items: center;
  max-width: min(100%, 26rem);
  text-align: center;
}

.studio-ai-sessions__preview-empty-title {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.98rem;
  line-height: 1.35;
  margin: 0;
}

.studio-ai-sessions__preview-empty-detail {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.86rem;
  line-height: 1.35;
  margin: -0.25rem 0 0;
  max-width: 24rem;
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

.studio-ai-sessions__archiving-overlay {
  align-items: center;
  background: rgba(var(--v-theme-background), 0.92);
  display: grid;
  inset: 0;
  justify-items: center;
  padding: 1rem;
  position: absolute;
  z-index: 14;
}

.studio-ai-sessions__archiving-card {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 14px;
  box-shadow: 0 1rem 2.5rem rgba(15, 23, 42, 0.12);
  display: grid;
  gap: 0.65rem;
  justify-items: center;
  max-width: min(100%, 26rem);
  padding: 1.35rem 1.6rem;
  text-align: center;
}

.studio-ai-sessions__archiving-card strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
}

.studio-ai-sessions__archiving-card span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.86rem;
}

.studio-ai-sessions-archiving-enter-active,
.studio-ai-sessions-archiving-leave-active {
  transition: opacity 120ms ease;
}

.studio-ai-sessions-archiving-enter-from,
.studio-ai-sessions-archiving-leave-to {
  opacity: 0;
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

.studio-ai-sessions--autopilot .studio-ai-sessions__runtime-stack {
  height: 100%;
}

@media (min-width: 981px) {
  .studio-ai-sessions {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .studio-ai-sessions--autopilot {
    grid-template-rows: minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-layout {
    grid-template-columns:
      minmax(
        var(--studio-home-chat-column-min-width, 24rem),
        var(--studio-home-chat-column-width, 30rem)
      )
      minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-layout--chat-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-main {
    display: none;
  }

  .studio-ai-sessions__runtime-stack {
    min-height: 0;
  }

  .studio-ai-sessions__empty-layout--dashboard {
    align-items: stretch;
    height: 100%;
    overflow: hidden;
  }
}

@media (max-width: 980px) {
  .studio-ai-sessions__chat-column-separator {
    display: none !important;
  }

  .studio-ai-sessions__empty-layout {
    grid-template-rows: minmax(0, 1fr);
  }

  .studio-ai-sessions__empty-project-panel {
    display: none;
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-main {
    display: none;
  }

  .studio-ai-sessions__empty-layout--chat-collapsed .studio-ai-sessions__empty-project-panel {
    display: grid;
  }
}
</style>
