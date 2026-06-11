<template>
  <section
    class="studio-ai-session-runtime"
    :data-vibe64-session-runtime-id="props.sessionId"
  >
    <Vibe64AutopilotView
      :actions="actions"
      :active="autopilotModeActive"
      :automation-enabled="autopilotAutomationEnabled"
      :autopilot-steps="autopilotNavigationSteps"
      :codex-thinking="autopilotInteractionLocked"
      :chat-collapsed="props.chatCollapsed"
      :command-runner="autopilotCommandRunner"
      :conversation-log="conversationLog"
      :diff="dialogs.diff"
      :human-input-response-preview="humanInputResponsePreview"
      :interrupt-codex-turn="interruptCodexTurn"
      :page="guardedPage"
      :refresh-session-data="sessionData.refreshSessionData"
      :report-preview="reportPreview"
      :review="review"
      :rewind-busy="Boolean(timeline.rewindCommand?.isRunning)"
      :rewind-to-step="timeline.rewindToStep"
      :session-abandon="dialogs.abandon"
      :session="selection.selectedSession"
      :sessions-api-path="sessionData.sessionsApiPath"
      :session-selection-closed="selection.isClosed"
      :session-toolbar="autopilotSessionToolbar"
      :project-pane="props.projectPane"
      @busy-change="setAutopilotBusy"
      @project-attention="emitProjectAttention"
      @project-pane-change="emitProjectPaneChange"
    >
      <template #shell-terminal="{ active: tabActive }">
        <Vibe64ShellControls
          embedded
          :session="selection.selectedSession"
          :show-activator="false"
          :window-displayed="props.active && tabActive"
        />
      </template>

      <template #ai-terminal="{ active: tabActive }">
        <Vibe64SessionTerminals
          class="studio-ai-sessions__tab-terminal"
          :allow-codex-start="tabActive && codexTerminalCanStart"
          :codex-terminal="codexTerminal"
          :codex-read-only="tabActive ? false : codexTerminalReadOnly"
          :codex-scope="codexTerminalScope"
          :codex-terminal-state="activeCodexTerminalState"
          :command-terminal="commandTerminal"
          :display-mode="tabActive ? 'full' : 'headless'"
          :headless-command-terminal="headlessCommandTerminal"
          :listen-codex-when-hidden="codexTerminalListenWhenHidden || (!tabActive && Boolean(selectedCodexTerminalId))"
          :session="selection.selectedSession"
          :show-command-output="false"
        />
      </template>

      <template #dashboard="dashboardSlotProps">
        <slot
          name="dashboard"
          :dashboard-context="dashboardSlotProps?.dashboardContext || {}"
        />
      </template>
    </Vibe64AutopilotView>

    <Vibe64SessionDialogs
      :dialogs="dialogs"
      :short-session-id="sessionData.shortSessionId"
      @update-input-values="dialogs.input.values = $event"
    />
  </section>
</template>

<script setup>
import Vibe64AutopilotView from "@/components/studio/vibe64-session/Vibe64AutopilotView.vue";
import Vibe64SessionDialogs from "@/components/studio/vibe64-session/Vibe64SessionDialogs.vue";
import {
  useVibe64SessionRuntimeHost
} from "@/composables/useVibe64SessionRuntimeHost.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";

const Vibe64SessionTerminals = defineVibe64AsyncComponent({
  label: "AI Terminal",
  loader: () => import("@/components/studio/vibe64-session/Vibe64SessionTerminals.vue"),
  minHeight: "16rem"
});
const Vibe64ShellControls = defineVibe64AsyncComponent({
  label: "Shell terminal",
  loader: () => import("@/components/studio/Vibe64ShellControls.vue"),
  minHeight: "16rem"
});

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  sessionData: {
    required: true,
    type: Object
  },
  sessionId: {
    required: true,
    type: String
  },
  projectPane: {
    default: "preview",
    type: String
  }
});

const emit = defineEmits([
  "busy-change",
  "page-error-change",
  "toolbar-controls-ready",
  "project-attention",
  "project-pane-change"
]);

const {
  actions,
  activeCodexTerminalState,
  autopilotAutomationEnabled,
  autopilotCommandRunner,
  autopilotInteractionLocked,
  autopilotModeActive,
  autopilotNavigationSteps,
  autopilotSessionToolbar,
  codexTerminal,
  codexTerminalCanStart,
  codexTerminalListenWhenHidden,
  codexTerminalReadOnly,
  codexTerminalScope,
  commandTerminal,
  conversationLog,
  dialogs,
  emitProjectAttention,
  emitProjectPaneChange,
  guardedPage,
  headlessCommandTerminal,
  humanInputResponsePreview,
  interruptCodexTurn,
  reportPreview,
  review,
  selectedCodexTerminalId,
  selection,
  setAutopilotBusy,
  timeline
} = useVibe64SessionRuntimeHost(props, emit);
</script>

<style scoped>
.studio-ai-session-runtime {
  display: grid;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.studio-ai-sessions__tab-terminal {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__tab-terminal :deep(.studio-ai-sessions__codex-terminal-shell),
.studio-ai-sessions__tab-terminal :deep(.studio-ai-sessions__codex-terminal) {
  height: 100%;
}
</style>
