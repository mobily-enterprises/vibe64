<script setup>
import { computed } from "vue";
const props = defineProps({ panel: { type: Object, default: null } });
const choices = computed(() => props.panel?.learningPracticeChoices || []);
</script>

<template>
  <v-menu v-if="choices.length" location="bottom start">
    <template #activator="{ props: menuProps }">
      <v-btn v-bind="menuProps" variant="text" aria-label="Choose practice project">Practice project</v-btn>
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
