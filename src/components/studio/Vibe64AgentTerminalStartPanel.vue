<template>
  <div class="vibe64-agent-terminal-start-panel">
    <v-sheet class="vibe64-agent-terminal-start-panel__card" elevation="4" role="status" rounded="lg">
      <div class="vibe64-agent-terminal-start-panel__icon">
        <v-icon :icon="icon" size="30" />
      </div>
      <div class="vibe64-agent-terminal-start-panel__copy">
        <strong>{{ title }}</strong>
        <span>{{ message }}</span>
      </div>
      <v-btn
        v-if="actionVisible"
        :aria-busy="starting ? 'true' : undefined"
        class="vibe64-agent-terminal-start-panel__action"
        color="primary"
        :disabled="starting"
        :prepend-icon="icon"
        variant="flat"
        @click="$emit('start')"
      >
        {{ actionText }}
      </v-btn>
    </v-sheet>
  </div>
</template>

<script setup>
// The overlay an agent terminal shows while it is off, exited or starting.
defineProps({
  actionText: { default: "", type: String },
  actionVisible: { default: true, type: Boolean },
  icon: { required: true, type: String },
  message: { default: "", type: String },
  starting: { default: false, type: Boolean },
  title: { default: "", type: String }
});
defineEmits(["start"]);
</script>

<style scoped>
.vibe64-agent-terminal-start-panel {
  align-items: center;
  background: rgba(var(--v-theme-scrim), 0.8);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  position: absolute;
  z-index: 3;
}

.vibe64-agent-terminal-start-panel__card {
  align-items: center;
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  max-width: min(42rem, 100%);
  padding: 1rem;
  width: 100%;
}

.vibe64-agent-terminal-start-panel__icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.14);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  display: flex;
  height: 3rem;
  justify-content: center;
  width: 3rem;
}

.vibe64-agent-terminal-start-panel__copy {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.vibe64-agent-terminal-start-panel__copy strong {
  font-size: 0.95rem;
}

.vibe64-agent-terminal-start-panel__copy span {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.8rem;
  line-height: 1.35;
}

.vibe64-agent-terminal-start-panel__action {
  min-inline-size: 10rem;
}

@media (max-width: 700px) {
  .vibe64-agent-terminal-start-panel__card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .vibe64-agent-terminal-start-panel__action {
    grid-column: 1 / -1;
    width: 100%;
  }
}
</style>
