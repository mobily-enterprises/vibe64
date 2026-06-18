<template>
  <section
    v-if="items.length"
    class="vibe64-step-input-display"
    aria-label="Review details"
  >
    <article
      v-for="item in items"
      :key="item.name"
      class="vibe64-step-input-display__item"
      :class="{ 'vibe64-step-input-display__item--long': item.long }"
    >
      <p class="vibe64-step-input-display__label">{{ item.label }}</p>
      <LongTextPreviewBlocks
        v-if="item.long && item.blocks.length"
        class="vibe64-step-input-display__blocks"
        :blocks="item.blocks"
        compact
      />
      <p
        v-else
        class="vibe64-step-input-display__value"
      >
        <LongTextInlineParts :text="item.value || 'Not set.'" />
      </p>
    </article>
  </section>
</template>

<script setup>
import { computed } from "vue";
import LongTextInlineParts from "@/components/studio/LongTextInlineParts.vue";
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import {
  parseLongTextReviewBlocks
} from "@/lib/studioLongTextBlocks.js";

const props = defineProps({
  fields: {
    default: () => [],
    type: Array
  },
  values: {
    default: () => ({}),
    type: Object
  }
});

const items = computed(() => (Array.isArray(props.fields) ? props.fields : [])
  .map((field) => {
    const name = String(field?.name || "").trim();
    const value = String(props.values?.[name] ?? field?.value ?? "").trim();
    const long = field?.kind === "textarea" || value.includes("\n");
    return {
      blocks: long ? parseLongTextReviewBlocks(value) : [],
      label: String(field?.label || name || "Value").trim(),
      long,
      name,
      value
    };
  })
  .filter((item) => item.name || item.label || item.value));
</script>

<style scoped>
.vibe64-step-input-display {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

.vibe64-step-input-display__item {
  background: rgba(var(--v-theme-surface-variant), 0.24);
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 8px;
  display: grid;
  gap: 0.18rem;
  min-width: 0;
  padding: 0.52rem 0.66rem;
}

.vibe64-step-input-display__label {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.vibe64-step-input-display__value {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.94rem;
  line-height: 1.34;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.vibe64-step-input-display__blocks {
  min-width: 0;
}
</style>
