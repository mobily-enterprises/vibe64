<template>
  <section
    class="studio-ai-sessions__terminals"
    :class="{
      'studio-ai-sessions__terminals--compact': displayMode === 'compact',
      'studio-ai-sessions__terminals--headless': displayMode === 'headless'
    }"
  >
    <CodexSessionTerminal
      :display-mode="displayMode"
      :prompt-injection-request-key="codexTerminal.promptInjectionKey"
      :prompt-override="codexTerminal.promptOverride"
      :session="session"
      :visible="displayMode !== 'headless'"
      @busy-changed="codexTerminal.busyChanged"
      @output="codexTerminal.outputReceived"
      @prompt-injected="codexTerminal.promptInjected"
      @prompt-injection-failed="codexTerminal.promptInjectionFailed"
      @session-update="codexTerminal.sessionUpdate"
    />

    <div
      v-if="displayMode !== 'headless' && commandOutputVisible"
      class="studio-ai-sessions__command-overlay"
    >
      <AiStudioCommandTerminal
        v-if="commandTerminal.visible"
        class="studio-ai-sessions__command-terminal"
        :action="commandTerminal.action"
        :action-input="commandTerminal.input"
        :ai-fix-available="Boolean(codexTerminal.fixCommandFailure)"
        :session="session"
        :start-request-key="commandTerminal.startKey"
        @closed="commandTerminal.closed"
        @finished="commandTerminal.finished"
        @fix-requested="codexTerminal.fixCommandFailure"
        @running-changed="commandTerminal.runningChanged"
      />
      <AiStudioHeadlessCommandOutput
        v-else
        class="studio-ai-sessions__command-terminal"
        :action-id="headlessCommandTerminal.actionId"
        :action-label="headlessCommandTerminal.actionLabel"
        :ai-fix-available="Boolean(codexTerminal.fixCommandFailure)"
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
        @fix-requested="codexTerminal.fixCommandFailure"
      />
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import AiStudioHeadlessCommandOutput from "@/components/studio/ai-studio-session/AiStudioHeadlessCommandOutput.vue";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";

const props = defineProps({
  codexTerminal: {
    default: () => ({}),
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

const commandOutputVisible = computed(() => Boolean(
  props.showCommandOutput &&
  (props.commandTerminal.visible || props.headlessCommandTerminal.visible)
));
</script>

<style scoped>
.studio-ai-sessions__terminals {
  min-height: 0;
  min-width: 0;
  position: relative;
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

.studio-ai-sessions__command-terminal {
  flex: 1 1 auto;
  box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.28);
  height: 100%;
}

@media (min-width: 981px) {
  .studio-ai-sessions__terminals {
    align-self: stretch;
    display: grid;
    overflow: hidden;
  }
}
</style>
