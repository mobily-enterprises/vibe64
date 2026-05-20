<template>
  <section
    class="studio-ai-sessions__terminals"
    :class="{ 'studio-ai-sessions__terminals--headless': displayMode === 'headless' }"
  >
    <CodexSessionTerminal
      :display-mode="displayMode"
      :prompt-injection-request-key="codexTerminal.promptInjectionKey"
      :prompt-override="codexTerminal.promptOverride"
      :session="session"
      :visible="displayMode !== 'headless'"
      @busy-changed="codexTerminal.busyChanged"
      @prompt-injected="codexTerminal.promptInjected"
      @prompt-injection-failed="codexTerminal.promptInjectionFailed"
      @session-update="codexTerminal.sessionUpdate"
    />

    <div
      v-if="displayMode !== 'headless' && commandTerminal.visible"
      class="studio-ai-sessions__command-overlay"
    >
      <AiStudioCommandTerminal
        class="studio-ai-sessions__command-terminal"
        :action="commandTerminal.action"
        :action-input="commandTerminal.input"
        :session="session"
        :start-request-key="commandTerminal.startKey"
        @closed="commandTerminal.closed"
        @finished="commandTerminal.finished"
        @running-changed="commandTerminal.runningChanged"
      />
    </div>
  </section>
</template>

<script setup>
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";

defineProps({
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
  session: {
    default: null,
    type: Object
  }
});
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
