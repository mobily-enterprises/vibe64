<script>
// An in-page button to a named place, such as the Dashboard from a session tool or the issue list from an
// issue. It is labelled with that place and shows the place's own icon, from this closed list, so it never
// reads as Back; the browser owns going back.
const PLACES = Object.freeze({
  architecture: { icon: "$hub", label: "Architecture" },
  dashboard: { icon: "$dashboard", label: "Dashboard" },
  "issue-list": { icon: "$viewList", label: "All issues" },
  "pull-request-list": { icon: "$viewList", label: "All pull requests" }
});
</script>

<script setup>
import { computed } from "vue";

const props = defineProps({
  place: { type: String, required: true, validator: (value) => Object.hasOwn(PLACES, value) }
});
const destination = computed(() => PLACES[props.place]);
</script>

<template>
  <v-btn
    class="destination-button"
    color="primary"
    :prepend-icon="destination.icon"
    rounded="pill"
    type="button"
    variant="text"
  >
    {{ destination.label }}
  </v-btn>
</template>

<style scoped>
.destination-button {
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  font-size: 0.95rem;
  letter-spacing: 0;
  padding-inline: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  text-transform: none;
}

.destination-button :deep(.v-btn__prepend) {
  margin-inline-end: var(--v64-space-2, 8px);
}

.destination-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
