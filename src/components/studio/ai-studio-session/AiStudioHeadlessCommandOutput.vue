<template>
  <v-sheet
    rounded="lg"
    color="surface"
    class="studio-headless-command-output"
    :class="{ 'studio-headless-command-output--compact': compact }"
  >
    <div class="studio-headless-command-output__bar">
      <div>
        <div class="studio-headless-command-output__title">{{ title }}</div>
        <div class="studio-headless-command-output__subtitle">{{ subtitle }}</div>
      </div>
      <v-chip
        v-if="statusLabel"
        :color="failed ? 'warning' : 'primary'"
        size="x-small"
        variant="tonal"
      >
        {{ statusLabel }}
      </v-chip>
      <v-btn
        v-if="canRequestAiFix"
        color="primary"
        :prepend-icon="mdiRobotOutline"
        size="small"
        variant="tonal"
        @click="requestAiFix"
      >
        Get AI to fix it
      </v-btn>
    </div>

    <pre ref="outputElement" class="studio-headless-command-output__text">{{ terminalText }}</pre>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  mdiRobotOutline
} from "@mdi/js";
import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  terminalFailureFixRequest
} from "@/lib/aiStudioTerminalFailurePrompt.js";

const props = defineProps({
  actionId: {
    default: "",
    type: String
  },
  actionLabel: {
    default: "",
    type: String
  },
  aiFixAvailable: {
    default: false,
    type: Boolean
  },
  commandPreview: {
    default: "",
    type: String
  },
  compact: {
    default: false,
    type: Boolean
  },
  error: {
    default: "",
    type: String
  },
  exitCode: {
    default: null,
    type: [Number, String]
  },
  failed: {
    default: false,
    type: Boolean
  },
  output: {
    default: "",
    type: String
  },
  running: {
    default: false,
    type: Boolean
  },
  status: {
    default: "",
    type: String
  },
  sessionId: {
    default: "",
    type: String
  },
  terminalSessionId: {
    default: "",
    type: String
  },
  title: {
    default: "Command output",
    type: String
  }
});
const emit = defineEmits(["fix-requested"]);

const outputElement = ref(null);
const terminalText = computed(() => {
  const output = stripTerminalControlSequences(props.output);
  const preview = stripTerminalControlSequences(props.commandPreview);
  const error = stripTerminalControlSequences(props.error);
  return tailText(output || error || preview || "Waiting for command output...");
});
const subtitle = computed(() => props.error || props.commandPreview || "Autopilot command");
const statusLabel = computed(() => {
  if (props.failed) {
    return "failed";
  }
  if (props.running) {
    return "running";
  }
  return props.status || "finished";
});
const canRequestAiFix = computed(() => Boolean(
  props.aiFixAvailable &&
  props.failed &&
  (props.output || props.error || props.commandPreview)
));

function tailText(value = "") {
  const text = String(value || "");
  const maxLength = 12000;
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(text.length - maxLength);
}

function requestAiFix() {
  if (!canRequestAiFix.value) {
    return;
  }
  emit("fix-requested", terminalFailureFixRequest({
    actionId: props.actionId,
    actionLabel: props.actionLabel,
    closeError: props.error,
    commandPreview: props.commandPreview,
    exitCode: props.exitCode,
    output: props.output || props.error || props.commandPreview,
    sessionId: props.sessionId,
    terminalKind: "command",
    terminalSessionId: props.terminalSessionId,
    terminalStatus: props.status
  }));
}

watch(terminalText, async () => {
  await nextTick();
  if (outputElement.value) {
    outputElement.value.scrollTop = outputElement.value.scrollHeight;
  }
}, {
  immediate: true
});
</script>

<style scoped>
.studio-headless-command-output {
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.5rem;
  min-height: 0;
  min-width: 0;
  padding: 0.75rem;
}

.studio-headless-command-output__bar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-headless-command-output__title {
  font-size: 0.85rem;
  font-weight: 700;
}

.studio-headless-command-output__subtitle {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.75rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-headless-command-output__text {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  color: #eef3ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.45;
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 0.65rem;
  white-space: pre-wrap;
}

.studio-headless-command-output--compact {
  background: transparent;
  border: 0;
  height: 100%;
  padding: 0;
}

.studio-headless-command-output--compact .studio-headless-command-output__bar {
  display: none;
}

.studio-headless-command-output--compact .studio-headless-command-output__text {
  height: 100%;
}
</style>
