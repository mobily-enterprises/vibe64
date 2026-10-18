<script setup>
import { computed } from "vue";
import { mdiChevronDown, mdiSchoolOutline } from "@mdi/js";
const props = defineProps({ panel: { type: Object, default: null } });
const choices = computed(() => props.panel?.learningPracticeChoices || []);
</script>

<template>
  <v-menu v-if="choices.length" location="bottom start">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        class="vibe64-learning-practice-selector"
        variant="text"
        aria-label="Choose practice project"
        title="Choose practice project"
      >
        <v-icon class="vibe64-learning-practice-selector__lead" :icon="mdiSchoolOutline" size="18" />
        <span>Practice project</span>
        <v-icon :icon="mdiChevronDown" size="18" />
      </v-btn>
    </template>
    <v-list density="compact">
      <v-list-item
        v-for="choice in choices"
        :key="choice.attemptId"
        :title="choice.projectSlug"
        subtitle="Saved lesson workspace"
        @click="panel.selectLearningPracticeProject(choice, $event)"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
/* A warm tonal pill that marks the Learning header. Same shrink/ellipsis
   contract as the Working project selector: phone app bars truncate the label
   instead of overlapping the pane controls. */
.vibe64-learning-practice-selector {
  background: var(--v64-learning-container);
  border: 1px solid color-mix(in srgb, var(--v64-learning-strong) 45%, transparent);
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-learning-container) !important;
  flex: 0 1 auto;
  font: var(--v64-type-label-lg);
  height: 2.25rem;
  letter-spacing: 0.01em;
  max-width: 100%;
  min-width: 0;
  padding-inline: var(--v64-space-3) var(--v64-space-2);
  text-transform: none;
}

.vibe64-learning-practice-selector :deep(.v-btn__content) {
  gap: var(--v64-space-1);
  min-width: 0;
}

.vibe64-learning-practice-selector__lead {
  flex: 0 0 auto;
}

.vibe64-learning-practice-selector span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-learning-practice-selector:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}
</style>
