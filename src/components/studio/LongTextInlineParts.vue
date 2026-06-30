<template>
  <template
    v-for="(part, partIndex) in parts"
    :key="partKey(part, partIndex)"
  >
    <strong v-if="part.type === 'strong'">{{ part.text }}</strong>
    <code v-else-if="part.type === 'code'">{{ part.text }}</code>
    <a
      v-else-if="part.type === 'link'"
      :href="part.href"
      @click="handleLinkClick($event, part)"
    >{{ part.text }}</a>
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
const emit = defineEmits(["link-click"]);

const parts = computed(() => parseLongTextInlineParts(props.text));

function partKey(part, partIndex) {
  return `${part.type}:${partIndex}:${part.text}`;
}

function handleLinkClick(event, part = {}) {
  emit("link-click", {
    event,
    href: part.href || "",
    text: part.text || ""
  });
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
strong,
a {
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
