<script setup>
// The routing screen's plain question: build with the newly connected provider
// ("use"), or keep the Senior model in use ("keep").
defineProps({
  // The connected provider.
  name: { type: String, required: true },
  // The provider of the Senior model in use.
  currentName: { type: String, default: "" },
  busy: Boolean,
  // The routing suggestions are being saved.
  saving: Boolean
});
const emit = defineEmits(["use", "keep"]);
</script>

<template>
  <div class="aio-options" role="group" aria-label="Your main AI">
    <button type="button" class="aio-option aio-option--primary" :disabled="busy" @click="emit('use')">
      <span class="aio-option__title">Use {{ name }} for building</span>
      <span class="aio-option__body">Vibe64 uses {{ name }} for its main work. {{ currentName }} stays connected.</span>
      <v-progress-circular v-if="saving" indeterminate size="20" width="2" class="aio-option__busy" />
    </button>
    <button type="button" class="aio-option" :disabled="busy" @click="emit('keep')">
      <span class="aio-option__title">Keep {{ currentName }} for building</span>
      <span class="aio-option__body">{{ name }} stays connected and ready in AI Accounts.</span>
    </button>
  </div>
</template>

<style scoped>
.aio-options { display: grid; gap: var(--v64-space-3); }
.aio-option {
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: var(--v64-shape-lg);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 2px;
  padding: var(--v64-space-4) var(--v64-space-5);
  position: relative;
  text-align: left;
  transition: border-color var(--v64-duration-short) var(--v64-ease-standard), background-color var(--v64-duration-short) var(--v64-ease-standard);
}
.aio-option--primary { background: color-mix(in srgb, rgb(var(--v-theme-primary-container)) 55%, rgb(var(--v-theme-surface))); border-color: rgb(var(--v-theme-primary)); }
@media (hover: hover) {
  .aio-option:hover:not(:disabled) { border-color: rgb(var(--v-theme-primary)); }
}
.aio-option:focus-visible { outline: var(--v64-focus-ring-width) solid rgb(var(--v-theme-primary)); outline-offset: var(--v64-focus-ring-offset); }
.aio-option:disabled { cursor: default; opacity: 0.6; }
.aio-option__title { font: var(--v64-type-title-md); }
.aio-option__body { color: rgb(var(--v-theme-on-surface-variant)); font: var(--v64-type-body-md); }
.aio-option__busy { position: absolute; right: var(--v64-space-4); top: var(--v64-space-4); }

@media (prefers-reduced-motion: reduce) {
  .aio-option { transition: none; }
}
</style>
