<template>
  <v-dialog
    :model-value="Boolean(names.length)"
    :aria-labelledby="titleId"
    max-width="440"
    @after-leave="$emit('closed')"
    @update:model-value="$event || $emit('choose', '')"
  >
    <v-card class="vibe64-conflict-dialog v64-focus-rings">
      <v-card-item>
        <v-card-title :id="titleId" class="vibe64-conflict-dialog__title">{{ title }}</v-card-title>
        <v-card-subtitle class="vibe64-conflict-dialog__subtitle">In {{ folderLabel }}</v-card-subtitle>
      </v-card-item>
      <v-card-text class="pb-0">
        <ul v-if="names.length > 1" class="vibe64-conflict-dialog__names">
          <li v-for="name in names.slice(0, 5)" :key="name">{{ name }}</li>
          <li v-if="names.length > 5">and {{ names.length - 5 }} more</li>
        </ul>
        <p class="vibe64-conflict-dialog__question">What should happen to {{ names.length === 1 ? "it" : "them" }}?</p>
      </v-card-text>
      <v-list class="vibe64-conflict-dialog__choices" aria-label="Choose what happens" role="group">
        <v-list-item
          v-for="choice in choices"
          :key="choice.value"
          :prepend-icon="choice.icon"
          role="button"
          :subtitle="choice.subtitle"
          :title="choice.title"
          lines="two"
          @click="$emit('choose', choice.value)"
        />
      </v-list>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('choose', '')">Cancel</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, useId } from "vue";
import { mdiContentDuplicate, mdiFileReplaceOutline, mdiSkipNext } from "@mdi/js";

// Asked once for a whole upload or move/copy when names are already taken.
// It emits "replace", "keep-both", "skip", or "" when the person cancels.
const props = defineProps({
  folderLabel: { type: String, default: "" },
  names: { type: Array, default: () => [] }
});
defineEmits(["choose", "closed"]);
const titleId = `vibe64-conflict-dialog-${useId()}`;
const title = computed(() => props.names.length === 1
  ? `“${props.names[0]}” already exists`
  : `${props.names.length} items already exist`);
// The name Keep both gives first, as the server numbers it: "brief (1).md".
function numberedName(name = "") {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (1)${name.slice(dot)}` : `${name} (1)`;
}
const choices = computed(() => {
  const one = props.names.length === 1;
  return [
    { value: "replace", icon: mdiFileReplaceOutline, title: "Replace", subtitle: one ? "Overwrite the item that is there" : "Overwrite the items that are there" },
    { value: "keep-both", icon: mdiContentDuplicate, title: "Keep both", subtitle: `Add a number to the new name, like “${numberedName(props.names[0])}”` },
    { value: "skip", icon: mdiSkipNext, title: "Skip", subtitle: one ? "Leave the item that is there" : "Leave those items and do the rest" }
  ];
});
</script>

<style scoped>
.vibe64-conflict-dialog__title {
  font: var(--v64-type-headline-sm);
  white-space: normal;
  overflow-wrap: anywhere;
}

.vibe64-conflict-dialog__subtitle,
.vibe64-conflict-dialog :deep(.v-list-item-subtitle) {
  color: var(--v64-on-surface-variant);
  opacity: 1;
}

.vibe64-conflict-dialog__subtitle {
  font: var(--v64-type-body-md);
  white-space: normal;
  overflow-wrap: anywhere;
}

.vibe64-conflict-dialog__names {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0 0 var(--v64-space-3);
  padding-inline-start: var(--v64-space-5);
}

.vibe64-conflict-dialog__names li {
  overflow-wrap: anywhere;
}

.vibe64-conflict-dialog__question {
  font: var(--v64-type-body-lg);
  margin: 0;
}

.vibe64-conflict-dialog__choices {
  background: transparent;
}
</style>
