<template>
  <section
    class="studio-ai-sessions__terminals"
    :class="{
      'studio-ai-sessions__terminals--compact': displayMode === 'compact',
      'studio-ai-sessions__terminals--headless': displayMode === 'headless'
    }"
  >
    <CodexSessionTerminal
      class="studio-ai-sessions__codex-terminal"
      :allow-start="allowCodexStart"
      :display-mode="displayMode"
      :read-only="codexReadOnly"
      :scope="codexScope"
      :session="session"
      :terminal="codexTerminalState"
      :visible="displayMode !== 'headless'"
      @session-update="handleCodexSessionUpdate"
    />

    <div
      v-if="displayMode !== 'headless' && commandOutputVisible"
      class="studio-ai-sessions__command-overlay"
      :class="{
        'studio-ai-sessions__command-overlay--minimized': commandOverlayMinimized
      }"
    >
      <Vibe64CommandTerminal
        v-if="commandTerminal.visible"
        class="studio-ai-sessions__command-terminal"
        :action="commandTerminal.action"
        :action-input="commandTerminal.input"
        :ai-fix-available="false"
        :session="session"
        :start-request-key="commandTerminal.startKey"
        @closed="commandTerminal.closed"
        @expanded-changed="handleCommandTerminalExpandedChanged"
        @finished="commandTerminal.finished"
        @running-changed="commandTerminal.runningChanged"
      />
      <Vibe64HeadlessCommandOutput
        v-else
        class="studio-ai-sessions__command-terminal"
        :action-id="headlessCommandTerminal.actionId"
        :action-label="headlessCommandTerminal.actionLabel"
        :ai-fix-available="false"
        :command-preview="headlessCommandTerminal.commandPreview"
        :error="headlessCommandTerminal.error"
        :exit-code="headlessCommandTerminal.exitCode"
        :failed="headlessCommandTerminal.failed"
        :output="headlessCommandTerminal.output"
        :running="headlessCommandTerminal.running"
        :session-id="session?.sessionId || ''"
        :status="headlessCommandTerminal.status"
        :terminal-session-id="headlessCommandTerminal.terminalSessionId"
        title="Autopilot command output"
      />
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import Vibe64CommandTerminal from "@/components/studio/Vibe64CommandTerminal.vue";
import Vibe64HeadlessCommandOutput from "@/components/studio/vibe64-session/Vibe64HeadlessCommandOutput.vue";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";

const props = defineProps({
  codexTerminal: {
    default: () => ({}),
    type: Object
  },
  allowCodexStart: {
    default: true,
    type: Boolean
  },
  codexReadOnly: {
    default: false,
    type: Boolean
  },
  codexScope: {
    default: "session",
    type: String
  },
  codexTerminalState: {
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
  }
});
const emit = defineEmits(["codex-session-update"]);

const commandTerminalExpanded = ref(true);
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
  if (typeof props.codexTerminal.sessionUpdate === "function") {
    props.codexTerminal.sessionUpdate(payload);
  }
  emit("codex-session-update", payload);
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
