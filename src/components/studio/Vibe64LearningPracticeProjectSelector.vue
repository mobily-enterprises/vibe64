<script setup>
import { computed } from "vue";
import { mdiChevronDown } from "@mdi/js";
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
/* Same shrink/ellipsis contract as the Working project selector: phone app
   bars truncate the label instead of overlapping the Workspace/Learning switch. */
.vibe64-learning-practice-selector {
  flex: 0 1 auto;
  max-width: 100%;
  min-width: 0;
  padding-inline: 0.4rem;
}

.vibe64-learning-practice-selector :deep(.v-btn__content) {
  min-width: 0;
}

.vibe64-learning-practice-selector span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
