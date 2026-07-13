<template>
  <Vibe64Terminal
    v-if="job && terminal"
    :close-label="terminalController.terminalExited.value ? 'Close' : 'Stop job'"
    :collapsible="false"
    error-title="Fix Codex needs attention"
    fill
    :show-copy="true"
    :subtitle="subtitle"
    :terminal="terminalController"
    :title="title"
    presentation="fullscreen"
    :visible="modelValue"
    @close="closeTerminal"
    @update:visible="updateVisible"
  >
    <template #footer="{ commandPreview, status }">
      <div class="vibe64-fix-codex-dialog__footer">
        <span>{{ commandPreview || "Fix Codex" }}</span>
        <v-chip v-if="status" size="x-small" variant="tonal">
          {{ status }}
        </v-chip>
        <strong v-if="terminalController.terminalExited.value">
          {{ terminalExitMessage }}
        </strong>
      </div>
    </template>
  </Vibe64Terminal>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import Vibe64Terminal from "@/components/studio/Vibe64Terminal.vue";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import {
  vibe64FixCodexTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";

const props = defineProps({
  job: {
    default: null,
    type: Object
  },
  modelValue: {
    default: false,
    type: Boolean
  },
  terminal: {
    default: null,
    type: Object
  }
});
const emit = defineEmits(["update:modelValue"]);
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
  return subject ? `${repairLocationLabel.value} · ${subject}` : repairLocationLabel.value;
});
const title = computed(() => "Fix Codex");

const terminalController = useVibe64Terminal({
  driver: createWebSocketTerminalDriver({
    closeSession(terminalSessionId) {
      return terminalCommands.closeFixCodexTerminal(jobId.value, terminalSessionId);
    },
    webSocketUrl(terminalSessionId) {
      return vibe64FixCodexTerminalWebSocketUrl(jobId.value, terminalSessionId);
    }
  }),
  initiallyVisible: false,
  policies: [{
    actions: ["show", "expand"],
    id: "show-fix-error",
    on: "error"
  }, {
    actions: ["show", "expand"],
    id: "show-fix-failure",
    on: "exit",
    when: (event) => event.exitCode !== 0
  }]
});

const terminalExitMessage = computed(() => {
  if (!terminalController.terminalExited.value) {
    return "";
  }
  if (terminalController.terminalExitCode.value === 0) {
    return "Fix Codex finished. Review the transcript, then retry the original command.";
  }
  const code = terminalController.terminalExitCode.value;
  return code === null || typeof code === "undefined"
    ? "Fix Codex exited. Review the transcript for the blocker."
    : `Fix Codex exited with code ${code}. Review the transcript for the blocker.`;
});

async function attachTerminal() {
  if (!props.terminal?.id || !jobId.value) {
    return;
  }
  await terminalController.attachTerminal(props.terminal, {
    ownership: "owned",
    preserveOutput: true,
    show: props.modelValue
  });
}

function updateVisible(visible) {
  emit("update:modelValue", visible === true);
}

async function closeTerminal() {
  await terminalController.closeTerminal({
    deleteSession: true,
    preserveOutput: terminalController.terminalExited.value
  });
  updateVisible(false);
}

watch(
  () => `${jobId.value}:${props.terminal?.id || ""}`,
  () => {
    void attachTerminal();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  terminalController.disposeTerminalUi();
});
</script>

<style scoped>
.vibe64-fix-codex-dialog__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-fix-codex-dialog__footer strong {
  margin-left: auto;
}
</style>
