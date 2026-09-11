<template>
  <section
    class="studio-ai-session-runtime"
    :data-vibe64-agent-turn-active="selection.selectedSession?.agentSession?.turn?.active === true ? 'true' : 'false'"
    :data-vibe64-session-runtime-id="props.sessionId"
  >
    <Vibe64AutopilotView
      :active="autopilotModeActive"
      :agent-connection-status="agentConnectionStatus"
      :chat-collapsed="props.chatCollapsed"
      :cancel-agent-message="cancelAgentMessage"
      :conversation-log="conversationLog"
      :github-actor-teleport-target="props.githubActorTeleportTarget"
      :interrupt-agent-turn="interruptAgentTurn"
      :page="guardedPage"
      :project-context="props.projectContext"
      :preview-toolbar-teleport-target="props.previewToolbarTeleportTarget"
      :prompt-hint-policy="props.promptHintPolicy"
      :refresh-session-data="refreshSessionData"
      :refresh-session-work="refreshWorkState"
      :retry-workspace-setup="retryWorkspaceSetup"
      :save-session-work="saveSessionWork"
      :session-archive="dialogs.archive"
      :session-renewal="sessionRenewal"
      :session="selection.selectedSession"
      :sessions-api-path="sessionData.sessionsApiPath"
      :session-selection-archived="selection.isArchived"
      :session-toolbar="autopilotSessionToolbar"
      :send-agent-message="sendAgentMessage"
      :update-session-work="updateSessionWork"
      :work-state="workState"
      :project-pane="props.projectPane"
      @busy-change="setAutopilotBusy"
      @chat-attention="emitChatAttention"
      @execution-attention="emit('execution-attention', $event)"
      @project-attention="emitProjectAttention"
    >
      <template #ai-terminal="{ active: tabActive }">
        <Vibe64CodexSession
          v-if="selectedAssistantEngineId === 'codex'"
          class="studio-ai-sessions__tab-terminal"
          :allow-start="tabActive && codexTerminalCanStart"
          :display-mode="tabActive ? 'full' : 'headless'"
          :listen-when-hidden="!tabActive && Boolean(selectedAgentTerminalId)"
          :read-only="!tabActive"
          scope="session"
          :session="selection.selectedSession"
          :terminal="null"
          :visible="tabActive"
          @session-update="agentTerminal.sessionUpdate"
        />
        <Vibe64OpenCodeSession
          v-else-if="selectedAssistantEngineId === 'opencode'"
          class="studio-ai-sessions__tab-terminal"
          :allow-start="tabActive"
          :display-mode="tabActive ? 'full' : 'headless'"
          :listen-when-hidden="!tabActive && Boolean(selectedAgentTerminalId)"
          :read-only="!tabActive"
          :session="selection.selectedSession"
          :visible="tabActive"
          @session-update="agentTerminal.sessionUpdate"
        />
      </template>

      <template #dashboard="dashboardSlotProps">
        <slot
          name="dashboard"
          :dashboard-context="{
            ...(dashboardSlotProps?.dashboardContext || {}),
            sessions: props.toolbarSessions
          }"
        />
      </template>
    </Vibe64AutopilotView>

    <Vibe64SessionRenewalDialog :renewal="dialogs.renewal" />
  </section>
</template>

<script setup>
import { computed } from "vue";
import Vibe64AutopilotView from "@/components/studio/vibe64-session/Vibe64AutopilotView.vue";
import Vibe64CodexSession from "@/components/studio/Vibe64CodexSession.vue";
import Vibe64OpenCodeSession from "@/components/studio/Vibe64OpenCodeSession.vue";
import Vibe64SessionRenewalDialog from "@/components/studio/vibe64-session/Vibe64SessionRenewalDialog.vue";
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
  toolbarSessions: {
    default: () => [],
    type: Array
  },
  projectPane: {
    default: "preview",
    type: String
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  promptHintPolicy: {
    default: () => ({
      enabled: true,
      ready: false,
      revision: 0,
      version: 0
    }),
    type: Object
  },
  projectContext: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits([
  "busy-change",
  "chat-attention",
  "execution-attention",
  "page-error-change",
  "source-operations-suspension-change",
  "work-state-change",
  "toolbar-controls-ready",
  "project-attention"
]);

const {
  agentConnectionStatus,
  autopilotModeActive,
  autopilotSessionToolbar,
  agentTerminal,
  cancelAgentMessage,
  codexTerminalCanStart,
  conversationLog,
  dialogs,
  emitChatAttention,
  emitProjectAttention,
  guardedPage,
  interruptAgentTurn,
  refreshSessionData,
  refreshWorkState,
  retryWorkspaceSetup,
  saveSessionWork,
  sessionRenewal,
  selectedAgentTerminalId,
  selection,
  setAutopilotBusy,
  sendAgentMessage,
  updateSessionWork,
  workState
} = useVibe64SessionRuntimeHost(props, emit);
const selectedAssistantEngineId = computed(() => String(
  selection.selectedSession?.assistantSelection?.engineId || ""
));
</script>

<style scoped>
.studio-ai-session-runtime {
  display: grid;
  height: 100%;
  max-width: 100%;
  min-height: 0;
  min-width: 0;
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

.studio-ai-sessions__terminal-unavailable {
  align-content: center;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: grid;
  gap: 0.4rem;
  height: 100%;
  justify-items: center;
  padding: 2rem;
  text-align: center;
}

.studio-ai-sessions__terminal-unavailable strong {
  color: rgb(var(--v-theme-on-surface));
}

.studio-ai-sessions__terminal-unavailable span {
  max-width: 32rem;
}
</style>
