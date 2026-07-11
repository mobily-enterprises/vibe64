<template>
  <section
    v-show="!compactTerminalHidden"
    class="studio-ai-sessions__terminals"
    :class="{
      'studio-ai-sessions__terminals--compact': displayMode === 'compact',
      'studio-ai-sessions__terminals--compact-collapsed': compactTerminalCollapsed,
      'studio-ai-sessions__terminals--headless': displayMode === 'headless'
    }"
    :style="terminalRootStyle"
  >
    <div
      class="studio-ai-sessions__codex-terminal-shell"
      :class="{
        'studio-ai-sessions__codex-attention': compactMode,
        'studio-ai-sessions__codex-attention--collapsed': compactMode && compactTerminalCollapsed
      }"
    >
      <header v-if="compactMode" class="studio-ai-sessions__codex-attention-header">
        <div class="studio-ai-sessions__codex-attention-icon">
          <v-icon :icon="mdiRobotOutline" size="28" />
        </div>
        <div class="studio-ai-sessions__codex-attention-copy">
          <strong>Your agent needs attention</strong>
          <span>Check the terminal for a prompt, stalled command, or other reason it stopped moving.</span>
        </div>
        <div class="studio-ai-sessions__codex-attention-actions">
          <v-btn
            v-if="compactTerminalCollapsed"
            class="studio-ai-sessions__codex-attention-action"
            :prepend-icon="mdiConsoleLine"
            size="small"
            type="button"
            variant="tonal"
            @click="showCompactTerminal"
          >
            Show terminal
          </v-btn>
          <v-btn
            v-else
            class="studio-ai-sessions__codex-attention-action"
            :icon="mdiClose"
            size="small"
            title="Hide agent terminal"
            type="button"
            variant="text"
            @click="hideCompactTerminal"
          />
        </div>
      </header>
      <Vibe64CodexSession
        class="studio-ai-sessions__codex-terminal"
        ref="codexTerminalComponent"
        :class="{
          'studio-ai-sessions__codex-terminal--attention': compactMode
        }"
        :allow-start="allowAgentStart"
        :auto-focus="codexAutoFocus"
        :display-mode="codexTerminalDisplayMode"
        :listen-when-hidden="agentListenWhenHidden"
        :read-only="agentReadOnly"
        :scope="agentScope"
        :session="session"
        :terminal="agentTerminalState"
        :visible="codexTerminalVisible"
        @activity-change="handleCodexActivityChange"
        @session-update="handleCodexSessionUpdate"
      />
    </div>

    <div
      v-if="displayMode !== 'headless' && commandOutputVisible"
      class="studio-ai-sessions__command-overlay"
      :class="{
        'studio-ai-sessions__command-overlay--minimized': commandOverlayMinimized
      }"
    >
      <Vibe64Terminal
        v-if="commandTerminal.visible"
        class="studio-ai-sessions__command-terminal"
        :expanded="commandTerminalController.expanded.value"
        fill
        :retryable="commandTerminalController.canRetry.value"
        :show-copy="true"
        :subtitle="commandTerminalController.terminalSubtitle.value"
        :terminal="commandTerminalController.terminal"
        :title="commandTerminalController.terminalTitle.value"
        :visible="commandTerminal.visible"
        @close="commandTerminalController.closeTerminal"
        @retry="commandTerminalController.restartTerminal"
        @update:expanded="commandTerminalController.toggleExpanded"
      >
        <template #actions-before>
          <v-btn
            v-if="commandTerminalController.canRequestAiFix.value"
            color="primary"
            size="small"
            variant="tonal"
            @click="commandTerminalController.requestAiFix"
          >
            Get AI to fix it
          </v-btn>
        </template>
      </Vibe64Terminal>
      <Vibe64Terminal
        v-else
        class="studio-ai-sessions__command-terminal"
        :command-preview="headlessCommandTerminal.commandPreview"
        :error="headlessCommandTerminal.error"
        fill
        :output="headlessCommandTerminal.output"
        :retryable="false"
        :show-close="false"
        :show-copy="true"
        :show-interrupt="false"
        :subtitle="headlessCommandTerminal.error || headlessCommandTerminal.commandPreview"
        :terminal="headlessCommandTerminal.terminal"
        title="Autopilot command output"
        :visible="headlessCommandTerminal.visible"
      >
        <template #actions-before>
          <v-btn
            v-if="headlessCommandTerminal.failed"
            color="primary"
            size="small"
            variant="tonal"
            @click="requestHeadlessCommandFix"
          >
            Get AI to fix it
          </v-btn>
        </template>
      </Vibe64Terminal>
    </div>

    <Vibe64FixCodexDialog
      v-model="fixDialogOpen"
      :job="fixJob"
      :terminal="fixTerminal"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import {
  mdiClose,
  mdiConsoleLine,
  mdiRobotOutline
} from "@mdi/js";
import Vibe64FixCodexDialog from "@/components/studio/Vibe64FixCodexDialog.vue";
import Vibe64Terminal from "@/components/studio/Vibe64Terminal.vue";
import Vibe64CodexSession from "@/components/studio/Vibe64CodexSession.vue";
import {
  useVibe64FixCodexDialog
} from "@/composables/useVibe64FixCodexDialog.js";
import {
  useVibe64CommandTerminalController
} from "@/composables/useVibe64CommandTerminalController.js";
import {
  useVibe64TerminalFailureFixCommand
} from "@/composables/useVibe64TerminalFailureFixCommand.js";

const props = defineProps({
  agentTerminal: {
    default: () => ({}),
    type: Object
  },
  allowAgentStart: {
    default: true,
    type: Boolean
  },
  agentReadOnly: {
    default: false,
    type: Boolean
  },
  listenAgentWhenHidden: {
    default: false,
    type: Boolean
  },
  agentScope: {
    default: "session",
    type: String
  },
  agentTerminalState: {
    default: null,
    type: Object
  },
  displayMode: {
    default: "full",
    type: String
  },
  commandTerminal: {
    default: () => ({}),
    type: Object
  },
  headlessCommandTerminal: {
    default: () => ({}),
    type: Object
  },
  showCommandOutput: {
    default: true,
    type: Boolean
  },
  session: {
    default: null,
    type: Object
  },
  sessionsApiPath: {
    default: "",
    type: String
  }
});
const emit = defineEmits(["codex-activity-change", "codex-session-update"]);

const commandTerminalExpanded = ref(true);
const compactTerminalCollapsed = ref(false);
const compactTerminalHidden = ref(false);
const codexTerminalComponent = ref(null);
const {
  fixDialogOpen,
  fixJob,
  fixTerminal,
  openFixCodexDialog
} = useVibe64FixCodexDialog();

const commandTerminalProps = reactive({
  get action() {
    return props.commandTerminal.action || null;
  },
  get actionInput() {
    return props.commandTerminal.input || {};
  },
  aiFixAvailable: true,
  closeOnUnmount: true,
  finishedHoldMs: 500,
  initialExpanded: true,
  initialTerminalSessionId: "",
  launchTarget: null,
  get session() {
    return props.session;
  },
  get sessionsApiPath() {
    return props.sessionsApiPath;
  },
  showInterrupt: true,
  get startRequestKey() {
    return props.commandTerminal.startKey || "";
  },
  terminalApiPath: "",
  terminalKind: "command",
  title: "",
  vibe64ApiPath: ""
});

function handleCommandTerminalEvent(eventName, payload) {
  switch (eventName) {
    case "closed":
      props.commandTerminal.closed?.(payload);
      break;
    case "expanded-changed":
      handleCommandTerminalExpandedChanged(payload);
      break;
    case "finished":
      props.commandTerminal.finished?.(payload);
      break;
    case "fix-requested":
      openFixCodexDialog(payload);
      break;
    case "running-changed":
      props.commandTerminal.runningChanged?.(payload);
      break;
    case "state-stale":
      props.commandTerminal.stale?.(payload);
      break;
    default:
      break;
  }
}

const commandTerminalController = useVibe64CommandTerminalController(
  commandTerminalProps,
  handleCommandTerminalEvent
);
const terminalFailureFix = useVibe64TerminalFailureFixCommand({
  sessionsApiPath: () => props.sessionsApiPath
});

async function requestHeadlessCommandFix() {
  if (!props.headlessCommandTerminal.failed) {
    return;
  }
  openFixCodexDialog(await terminalFailureFix.request({
    actionId: props.headlessCommandTerminal.actionId,
    actionLabel: props.headlessCommandTerminal.actionLabel,
    attemptedCommand: props.headlessCommandTerminal.attemptedCommand,
    closeError: props.headlessCommandTerminal.error,
    commandPreview: props.headlessCommandTerminal.commandPreview,
    exitCode: props.headlessCommandTerminal.exitCode,
    output: props.headlessCommandTerminal.output,
    sessionId: props.session?.sessionId || "",
    terminalKind: "command",
    terminalSessionId: props.headlessCommandTerminal.terminalSessionId,
    terminalStatus: props.headlessCommandTerminal.status
  }));
}
const compactMode = computed(() => props.displayMode === "compact");
const compactTerminalDisplayMode = computed(() => compactTerminalCollapsed.value || compactTerminalHidden.value
  ? "headless"
  : "compact");
const codexTerminalDisplayMode = computed(() => compactMode.value ? compactTerminalDisplayMode.value : props.displayMode);
const codexTerminalVisible = computed(() => compactMode.value
  ? !compactTerminalCollapsed.value && !compactTerminalHidden.value
  : props.displayMode !== "headless");
const codexAutoFocus = computed(() => Boolean(
  !props.agentReadOnly &&
  (
    props.displayMode === "full" ||
    compactMode.value
  )
));
const agentListenWhenHidden = computed(() => Boolean(
  props.listenAgentWhenHidden ||
  (
    compactMode.value &&
    (
      compactTerminalCollapsed.value ||
      compactTerminalHidden.value
    )
  )
));
const terminalRootStyle = computed(() => {
  return compactMode.value && compactTerminalCollapsed.value
    ? { height: "auto" }
    : null;
});
const commandOutputVisible = computed(() => Boolean(
  props.showCommandOutput &&
  (props.commandTerminal.visible || props.headlessCommandTerminal.visible)
));
const commandOverlayMinimized = computed(() => Boolean(
  props.commandTerminal.visible && !commandTerminalExpanded.value
));

function handleCommandTerminalExpandedChanged(expanded) {
  commandTerminalExpanded.value = expanded === true;
}

function handleCodexSessionUpdate(payload = {}) {
  if (
    compactMode.value &&
    String(payload.agentTerminalStatus || "") === "exited"
  ) {
    hideCompactTerminal();
  }
  if (typeof props.agentTerminal.sessionUpdate === "function") {
    props.agentTerminal.sessionUpdate(payload);
  }
  emit("codex-session-update", payload);
}

function handleCodexActivityChange(payload = {}) {
  emit("codex-activity-change", payload);
}

function hideCompactTerminal() {
  compactTerminalCollapsed.value = true;
  compactTerminalHidden.value = true;
}

function showCompactTerminal() {
  compactTerminalHidden.value = false;
  compactTerminalCollapsed.value = false;
  focusCodexTerminalSoon();
}

async function interruptCodexTerminal() {
  const terminal = codexTerminalComponent.value;
  if (!terminal || typeof terminal.sendEscape !== "function") {
    return false;
  }
  return await terminal.sendEscape();
}

function focusCodexTerminalSoon() {
  void nextTick(async () => {
    const terminal = codexTerminalComponent.value;
    if (!terminal || typeof terminal.focusTerminal !== "function") {
      return;
    }
    terminal.focusTerminal();
    for (const delayMs of [50, 150, 300]) {
      globalThis.setTimeout(() => {
        if (codexTerminalVisible.value && codexAutoFocus.value && !props.agentReadOnly) {
          terminal.focusTerminal();
        }
      }, delayMs);
    }
  });
}

watch(() => props.commandTerminal.startKey, () => {
  if (props.commandTerminal.visible) {
    commandTerminalExpanded.value = true;
  }
});

watch(() => props.commandTerminal.visible, (visible) => {
  if (!visible) {
    commandTerminalExpanded.value = true;
  }
});

watch(() => props.session?.sessionId || "", () => {
  commandTerminalExpanded.value = true;
  compactTerminalHidden.value = false;
  compactTerminalCollapsed.value = false;
});

watch(() => props.displayMode, (displayMode) => {
  if (displayMode !== "compact") {
    compactTerminalHidden.value = false;
    compactTerminalCollapsed.value = false;
  }
});

watch(() => [
  codexTerminalDisplayMode.value,
  codexTerminalVisible.value ? "visible" : "hidden",
  codexAutoFocus.value ? "autofocus" : "manual",
  props.agentReadOnly ? "readonly" : "writable"
].join("|"), () => {
  if (codexTerminalVisible.value && codexAutoFocus.value && !props.agentReadOnly) {
    focusCodexTerminalSoon();
  }
}, {
  flush: "post",
  immediate: true
});

defineExpose({
  interruptCodexTerminal
});
</script>

<style scoped>
.studio-ai-sessions__terminals {
  min-height: 0;
  min-width: 0;
  position: relative;
}

.studio-ai-sessions__codex-terminal {
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__codex-terminal-shell {
  display: grid;
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__terminals--headless {
  height: 0;
  min-height: 0;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  width: 0;
}

.studio-ai-sessions__terminals--compact {
  height: 36rem;
  max-width: 72rem;
  width: 100%;
}

.studio-ai-sessions__terminals--compact-collapsed {
  max-width: min(42rem, 100%);
}

.studio-ai-sessions__codex-attention {
  background: rgba(var(--v-theme-surface), 0.98);
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  border-radius: 8px;
  box-shadow: 0 1rem 2.8rem rgba(22, 31, 44, 0.22);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.studio-ai-sessions__codex-attention--collapsed {
  height: auto;
}

.studio-ai-sessions__codex-attention-header {
  align-items: center;
  background:
    linear-gradient(90deg, rgba(var(--v-theme-primary), 0.13), rgba(var(--v-theme-surface), 0.98) 72%);
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.18);
  display: flex;
  gap: 0.75rem;
  min-height: 4.2rem;
  padding: 0.65rem 0.8rem;
}

.studio-ai-sessions__codex-attention-icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: flex;
  flex: 0 0 auto;
  height: 2.7rem;
  justify-content: center;
  width: 2.7rem;
}

.studio-ai-sessions__codex-attention-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.studio-ai-sessions__codex-attention-copy strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.06rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.2;
}

.studio-ai-sessions__codex-attention-copy span {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.9rem;
  line-height: 1.3;
}

.studio-ai-sessions__codex-attention-action {
  flex: 0 0 auto;
}

.studio-ai-sessions__codex-attention-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: flex-end;
}

.studio-ai-sessions__codex-attention-error {
  background: rgba(var(--v-theme-error), 0.08);
  border-bottom: 1px solid rgba(var(--v-theme-error), 0.18);
  color: rgb(var(--v-theme-error));
  font-size: 0.88rem;
  line-height: 1.35;
  padding: 0.5rem 0.85rem;
}

.studio-ai-sessions__codex-terminal--attention {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0.55rem;
}

.studio-ai-sessions__command-overlay {
  background: rgba(var(--v-theme-surface), 0.94);
  border-radius: 8px;
  display: flex;
  inset: 0;
  padding: 0.5rem;
  position: absolute;
  z-index: 2;
}

.studio-ai-sessions__command-overlay--minimized {
  background: transparent;
  border-radius: 0;
  inset: auto 0.75rem 0.75rem auto;
  max-width: calc(100vw - 1.5rem);
  padding: 0;
  width: min(30rem, calc(100vw - 1.5rem));
}

.studio-ai-sessions__command-terminal {
  flex: 1 1 auto;
  box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.28);
  height: 100%;
}

.studio-ai-sessions__command-overlay--minimized .studio-ai-sessions__command-terminal {
  flex: 0 1 auto;
  height: auto;
  width: 100%;
}

@media (min-width: 981px) {
  .studio-ai-sessions__terminals {
    align-self: stretch;
    display: grid;
    gap: 0.75rem;
    overflow: hidden;
  }
}
</style>
