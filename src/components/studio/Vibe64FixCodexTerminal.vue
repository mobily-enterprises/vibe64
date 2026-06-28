<template>
  <div class="vibe64-fix-codex-terminal">
    <Vibe64TerminalFrame
      :command-preview="terminalCommandPreview"
      :error="terminalError"
      :status="terminalStatus"
      :subtitle="subtitle"
      :terminal-host-ref="setTerminalHost"
      title="Fix Codex"
    >
      <template #actions>
        <v-btn
          :disabled="!terminalSessionId"
          size="small"
          variant="text"
          @click="closeTerminal"
        >
          {{ terminalExited ? "Close" : "Stop job" }}
        </v-btn>
      </template>
    </Vibe64TerminalFrame>

    <v-alert
      v-if="terminalExited"
      class="vibe64-fix-codex-terminal__exit"
      :color="terminalExitCode === 0 ? 'success' : 'warning'"
      variant="tonal"
    >
      {{ terminalExitMessage }}
    </v-alert>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import Vibe64TerminalFrame from "@/components/studio/Vibe64TerminalFrame.vue";
import { useCodexTerminalElement } from "@/composables/useCodexTerminalElement.js";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import {
  vibe64FixCodexTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";

const props = defineProps({
  job: {
    default: null,
    type: Object
  },
  terminal: {
    default: null,
    type: Object
  }
});
const emit = defineEmits(["closed"]);
const terminalCommands = useVibe64TerminalCommands();

const jobId = computed(() => String(props.job?.id || props.terminal?.metadata?.fixJobId || ""));
const repairLocationLabel = computed(() => {
  switch (String(props.job?.repairTarget || "")) {
    case "main_checkout":
      return "Main checkout";
    case "session_worktree":
      return "Session clone";
    case "repair_worktree":
      return "Repair source";
    default:
      return "Ephemeral repair job";
  }
});
const subtitle = computed(() => {
  const subject = String(props.job?.subject || "").trim();
  return subject
    ? `${repairLocationLabel.value} - ${subject}`
    : repairLocationLabel.value;
});

const terminalController = useCodexTerminalElement({
  webSocketUrl(terminalId) {
    return vibe64FixCodexTerminalWebSocketUrl(jobId.value, terminalId);
  }
});

const {
  applyCodexTerminalSession,
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  setupTerminalUi,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalExitCode,
  terminalHost,
  terminalSessionId,
  terminalStatus
} = terminalController;

const terminalExitMessage = computed(() => {
  if (!terminalExited.value) {
    return "";
  }
  if (terminalExitCode.value === 0) {
    return "Fix Codex finished. Review the transcript, close this terminal, then retry the original command to verify the repair.";
  }
  const code = terminalExitCode.value === null || typeof terminalExitCode.value === "undefined"
    ? ""
    : ` with exit code ${terminalExitCode.value}`;
  return `Fix Codex exited${code}. Review the transcript for the blocker before closing.`;
});

function setTerminalHost(element) {
  terminalHost.value = element;
}

async function attachTerminal() {
  if (!props.terminal?.id || !jobId.value) {
    return;
  }
  await setupTerminalUi();
  applyCodexTerminalSession(props.terminal, {
    fallbackStatus: "running"
  });
  await connectTerminalSocket();
}

async function closeTerminal() {
  const currentJobId = jobId.value;
  const currentTerminalId = terminalSessionId.value;
  closeTerminalSocket();
  if (currentJobId && currentTerminalId) {
    await terminalCommands.closeFixCodexTerminal(currentJobId, currentTerminalId).catch(() => null);
  }
  emit("closed");
}

watch(() => [jobId.value, props.terminal?.id || ""].join(":"), attachTerminal, {
  immediate: true
});

onBeforeUnmount(() => {
  disposeTerminalUi();
});
</script>

<style scoped>
.vibe64-fix-codex-terminal {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.vibe64-fix-codex-terminal__exit {
  font-weight: 600;
}
</style>
