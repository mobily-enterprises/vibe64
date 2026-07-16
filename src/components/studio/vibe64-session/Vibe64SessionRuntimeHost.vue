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
      :chat-collapsed="props.chatCollapsed"
      :cancel-agent-message="cancelAgentMessage"
      :command-runner="autopilotCommandRunner"
      :conversation-log="conversationLog"
      :diff="dialogs.diff"
      :human-input-response-preview="humanInputResponsePreview"
      :github-actor-teleport-target="props.githubActorTeleportTarget"
      :interrupt-agent-turn="interruptAgentTurn"
      :page="guardedPage"
      :project-context="props.projectContext"
      :preview-toolbar-teleport-target="props.previewToolbarTeleportTarget"
      :refresh-session-data="sessionData.refreshSessionData"
      :report-preview="reportPreview"
      :review="review"
      :rewind-busy="Boolean(timeline.rewindCommand?.isRunning)"
      :rewind-to-step="timeline.rewindToStep"
      :session-abandon="dialogs.abandon"
      :session="selection.selectedSession"
      :session-detail-state="selection.selectedSessionDetailState"
      :sessions-api-path="sessionData.sessionsApiPath"
      :session-selection-closed="selection.isClosed"
      :session-toolbar="autopilotSessionToolbar"
      :save-project-config="props.saveProjectConfig"
      :saving-project-config="props.savingProjectConfig"
      :send-agent-message="sendAgentMessage"
      :project-pane="props.projectPane"
      @busy-change="setAutopilotBusy"
      @project-attention="emitProjectAttention"
      @project-pane-change="emitProjectPaneChange"
    >
      <template #ai-terminal="{ active: tabActive }">
        <Vibe64SessionTerminals
          class="studio-ai-sessions__tab-terminal"
          :allow-agent-start="tabActive && codexTerminalCanStart"
          :agent-terminal="agentTerminal"
          :agent-read-only="tabActive ? false : codexTerminalReadOnly"
          :agent-scope="codexTerminalScope"
          :agent-terminal-state="activeCodexTerminalState"
          :command-terminal="commandTerminal"
          :display-mode="tabActive ? 'full' : 'headless'"
          :headless-command-terminal="headlessCommandTerminal"
          :listen-agent-when-hidden="codexTerminalListenWhenHidden || (!tabActive && Boolean(selectedAgentTerminalId))"
          :session="selection.selectedSession"
          :sessions-api-path="sessionData.sessionsApiPath"
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
import Vibe64SessionTerminals from "@/components/studio/vibe64-session/Vibe64SessionTerminals.vue";
import {
  useVibe64SessionRuntimeHost
} from "@/composables/useVibe64SessionRuntimeHost.js";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
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
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  saveProjectConfig: {
    default: null,
    type: Function
  },
  savingProjectConfig: {
    default: false,
    type: Boolean
  },
  toolbarSessions: {
    default: () => [],
    type: Array
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
  autopilotModeActive,
  autopilotNavigationSteps,
  autopilotSessionToolbar,
  agentTerminal,
  cancelAgentMessage,
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
  interruptAgentTurn,
  reportPreview,
  review,
  selectedAgentTerminalId,
  selection,
  setAutopilotBusy,
  sendAgentMessage,
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
