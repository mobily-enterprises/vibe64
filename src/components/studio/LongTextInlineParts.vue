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
  background: rgba(var(--v-theme-primary), 0.07);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-radius: 3px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
  overflow-wrap: anywhere;
  padding: 0.02rem 0.2rem;
  word-break: break-word;
}

span,
strong,
a {
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
