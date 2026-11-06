<template>
  <div class="vibe64-agent-terminal-drop-overlay" aria-live="polite" role="status">
    <v-sheet class="vibe64-agent-terminal-drop-overlay__card" elevation="4" rounded="lg">
      <v-icon icon="$attachFile" size="28" />
      <span>{{ label }}</span>
    </v-sheet>
  </div>
</template>

<script setup>

// Shown over an agent terminal while files are dragged onto it.
defineProps({
  label: { required: true, type: String }
});
</script>

<style scoped>
.vibe64-agent-terminal-drop-overlay {
  align-items: center;
  background: rgb(0 0 0 / 0.68);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  pointer-events: none;
  position: absolute;
  z-index: 5;
}

.vibe64-agent-terminal-drop-overlay__card {
  align-items: center;
  display: flex;
  gap: 0.7rem;
  padding: 1rem 1.15rem;
}
</style>
