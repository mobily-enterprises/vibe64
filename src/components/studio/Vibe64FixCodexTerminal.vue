<template>
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
        :disabled="!terminalSessionId || terminalExited"
        size="small"
        variant="text"
        @click="sendCtrlC"
      >
        Ctrl-C
      </v-btn>
      <v-btn
        :disabled="!terminalSessionId"
        size="small"
        variant="text"
        @click="closeTerminal"
      >
        Close
      </v-btn>
    </template>
  </Vibe64TerminalFrame>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import Vibe64TerminalFrame from "@/components/studio/Vibe64TerminalFrame.vue";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  stripStudioContextBlocksForDisplay
} from "@/lib/codexOutput.js";
import {
  closeVibe64FixCodexTerminal,
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

const jobId = computed(() => String(props.job?.id || props.terminal?.metadata?.fixJobId || ""));
const subtitle = computed(() => String(props.job?.subject || "Ephemeral repair job"));

const terminalController = useStudioTerminal({
  displayOutput: stripStudioContextBlocksForDisplay,
  webSocketUrl(terminalId) {
    return vibe64FixCodexTerminalWebSocketUrl(jobId.value, terminalId);
  }
});

const {
  applyTerminalSession,
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  sendCtrlC,
  setupTerminalUi,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalHost,
  terminalSessionId,
  terminalStatus
} = terminalController;

function setTerminalHost(element) {
  terminalHost.value = element;
}

async function attachTerminal() {
  if (!props.terminal?.id || !jobId.value) {
    return;
  }
  await setupTerminalUi();
  applyTerminalSession(props.terminal, {
    fallbackStatus: "running"
  });
  await connectTerminalSocket();
}

async function closeTerminal() {
  const currentJobId = jobId.value;
  const currentTerminalId = terminalSessionId.value;
  closeTerminalSocket();
  if (currentJobId && currentTerminalId) {
    await closeVibe64FixCodexTerminal(currentJobId, currentTerminalId).catch(() => null);
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
