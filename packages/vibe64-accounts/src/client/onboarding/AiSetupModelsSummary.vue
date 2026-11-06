<script setup>

// The overview's one-line Models summary, with Review models ("open").
defineProps({
  // [label, value] pairs: main chat's Senior and Junior, and the team's Colleague.
  rows: { type: Array, required: true }
});
const emit = defineEmits(["open"]);
</script>

<template>
  <section class="aio-models" aria-labelledby="aio-models-title">
    <div class="aio-models__text">
      <h2 id="aio-models-title" class="aio-models__title">Models</h2>
      <dl class="aio-models__list">
        <div v-for="[label, value] in rows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div>
      </dl>
    </div>
    <v-btn color="primary" variant="tonal" prepend-icon="$tune" class="aio-models__open" @click="emit('open')">Review models</v-btn>
  </section>
</template>

<style scoped>
/* Models: the overview's one-line summary of the AI setup. */
.aio-models {
  align-items: center;
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: var(--v64-shape-lg);
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-3) var(--v64-space-5);
  margin-top: var(--v64-space-6);
  padding: var(--v64-space-4) var(--v64-space-5);
}
.aio-models__text { display: grid; flex: 1 1 18rem; gap: var(--v64-space-1); min-width: 0; }
.aio-models__title { font: var(--v64-type-title-md); margin: 0; }
.aio-models__list { display: flex; flex-wrap: wrap; font: var(--v64-type-body-md); gap: var(--v64-space-1) var(--v64-space-5); margin: 0; }
.aio-models__list div { display: flex; gap: var(--v64-space-2); min-width: 0; }
.aio-models__list dt { color: rgb(var(--v-theme-on-surface-variant)); }
.aio-models__list dd { margin: 0; overflow-wrap: anywhere; }

/* Phone */
@media (max-width: 599.98px) {
  .aio-models { padding: var(--v64-space-4); }
  .aio-models__open { width: 100%; }
}
</style>
