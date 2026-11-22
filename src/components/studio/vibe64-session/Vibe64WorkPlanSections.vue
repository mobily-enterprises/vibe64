<script setup>
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";

// One run of a plan document in reading order: prose blocks and checklist items, each item with its recorded mark.
// A built item ([~]) is the indeterminate checkbox, a proven one ([x]) the checked one.
defineProps({ sections: { type: Array, required: true } });

/** What the checkbox says to assistive technology: the item's state, not just that it has a mark. */
function markLabel(section) {
  if (section.checked) return "Proven";
  return section.built ? "Built, not yet proven" : "Not done yet";
}
</script>

<template>
  <div v-for="(section, index) in sections" :key="index" :class="{ 'work-plan-item': section.checked !== undefined }">
    <input
      v-if="section.checked !== undefined" type="checkbox" :checked="section.checked"
      :indeterminate="section.built && !section.checked" disabled :aria-label="markLabel(section)"
    >
    <LongTextPreviewBlocks :blocks="section.blocks" />
  </div>
</template>

<style scoped>
.work-plan-item { display: flex; align-items: flex-start; gap: 0.75rem; margin-block: 0.5rem; }
.work-plan-item input { flex: none; width: 1.1rem; height: 1.1rem; margin-top: 0.25rem; opacity: 1; accent-color: rgb(var(--v-theme-primary)); }
.work-plan-item > :last-child { min-width: 0; flex: 1; }
</style>
