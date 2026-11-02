<template>
  <button
    class="vibe64-source-editor__side-rail"
    type="button"
  >
    <v-icon :icon="icon" size="22" />
    <span>{{ label }}</span>
  </button>
</template>

<script setup>
// A collapsed panel's rail: one button that shows the panel again. The host
// gives it its name, title, click and any modifier class.
defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true }
});
</script>

<style scoped>
.vibe64-source-editor__side-rail {
  align-items: center;
  appearance: none;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 0;
  color: rgba(var(--v-theme-on-surface), 0.74);
  cursor: pointer;
  display: grid;
  gap: 0.34rem;
  grid-template-rows: auto auto;
  height: 100%;
  justify-items: center;
  min-height: 0;
  min-width: 0;
  padding: 0.56rem 0.18rem;
  width: 100%;
}

.vibe64-source-editor__side-rail:hover,
.vibe64-source-editor__side-rail:focus-visible {
  background: rgba(var(--v-theme-primary), 0.14);
  outline: 0;
}

.vibe64-source-editor__side-rail span {
  font-size: 0.76rem;
  font-weight: 740;
  letter-spacing: 0;
  line-height: 1;
  transform: rotate(180deg);
  writing-mode: vertical-rl;
}

.vibe64-source-editor__side-rail--right {
  background: rgba(var(--v-theme-primary), 0.07);
}

@media (max-width: 900px) {
  .vibe64-source-editor__side-rail {
    grid-template-columns: auto auto;
    grid-template-rows: 1fr;
    justify-content: start;
    padding: 0.18rem 0.56rem;
  }

  .vibe64-source-editor__side-rail span {
    transform: none;
    writing-mode: horizontal-tb;
  }
}
</style>
