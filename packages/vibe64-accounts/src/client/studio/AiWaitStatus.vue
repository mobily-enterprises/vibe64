<script setup>
import { onBeforeUnmount, ref, watch } from "vue";

// The one waiting line of every AI connection step: a spinner and what is
// happening, then, once the wait runs long, that it is still working and the
// slow slot (a way to start again). The busy button shows its own spinner.
const props = defineProps({
  active: Boolean,
  label: { type: String, default: "" },
  slowAfterMs: { type: Number, default: 20_000 },
  slowLabel: { type: String, default: "Still working. This is taking longer than usual." }
});
const slow = ref(false);
let timer = null;
watch(() => props.active, (active) => {
  clearTimeout(timer);
  slow.value = false;
  if (active) timer = setTimeout(() => { slow.value = true; }, props.slowAfterMs);
}, { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div v-if="active" class="ai-wait text-body-medium" role="status" data-test="ai-wait">
    <v-progress-circular indeterminate color="primary" size="20" width="2" class="ai-wait__spinner" />
    <div class="ai-wait__text">
      <span>{{ label }}</span>
      <template v-if="slow">
        <span class="ai-wait__slow">{{ slowLabel }}</span>
        <slot name="slow" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.ai-wait { align-items: flex-start; display: flex; gap: 0.75rem; min-width: 0; }
.ai-wait__spinner { flex: none; margin-top: 0.125rem; }
.ai-wait__text { display: grid; gap: 0.25rem; justify-items: start; min-width: 0; overflow-wrap: anywhere; }
.ai-wait__slow { color: rgba(var(--v-theme-on-surface), 0.7); }
</style>
