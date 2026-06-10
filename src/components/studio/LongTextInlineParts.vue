<template>
  <template
    v-for="(part, partIndex) in parts"
    :key="partKey(part, partIndex)"
  >
    <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
    <code v-else-if="part.type === 'code'">{{ part.text }}</code>
    <span v-else>{{ part.text }}</span>
  </template>
</template>

<script setup>
import { computed } from "vue";

import { parseLongTextInlineParts } from "@/lib/studioLongTextBlocks.js";

const props = defineProps({
  text: {
    default: "",
    type: String
  }
});

const parts = computed(() => parseLongTextInlineParts(props.text));

function partKey(part, partIndex) {
  return `${part.type}:${partIndex}:${part.text}`;
}
</script>

<style scoped>
code {
  background: rgba(var(--v-theme-surface-variant), 0.72);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
  overflow-wrap: anywhere;
  padding: 0.05rem 0.22rem;
  word-break: break-word;
}

span,
strong {
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
