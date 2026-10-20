<script setup>
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import Vibe64AuthSettingsButton from "@/components/studio/Vibe64AuthSettingsButton.vue";
import { ref } from "vue";
import Vibe64LearningPracticeProjectSelector from "./Vibe64LearningPracticeProjectSelector.vue";
import Vibe64SessionPanel from "@/components/studio/Vibe64SessionPanel.vue";
import Vibe64LearningLessonLauncher from "@/components/studio/Vibe64LearningLessonLauncher.vue";
import { useVibe64LearningMode } from "@/composables/useVibe64LearningMode.js";

const panel = ref(null);
const learning = useVibe64LearningMode({ onConversationOpened(identity) {
  panel.value?.selectLearningConversation(identity);
} });
const { learningMode, purposeFilter, learningResource, setLearningMode } = learning;
</script>

<template>
  <StudioAppShellLayout show-learning-mode-control :learning-mode="learningMode" :fill-viewport="learningMode" @update:learning-mode="setLearningMode">
    <template #top-left>
      <div class="vibe64-local-app-index__top">{{ learningMode ? "Courses" : "Projects" }}</div>
      <Vibe64LearningPracticeProjectSelector v-if="learningMode" :panel="panel" />
    </template>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>

    <section class="vibe64-local-app-index" :class="{ 'vibe64-local-app-index--learning': learningMode }">
      <ProjectSelectionGate
        v-show="!learningMode"
        force-picker
        navigate-on-select
        show-practice
      />
      <Vibe64SessionPanel
        v-show="learningMode"
        ref="panel"
        :active="learningMode"
        :chat-collapsed="false"
        :learning-resource="learningResource"
        learning-view="learning"
        :purpose-filter="purposeFilter"
        project-pane="dashboard"
      >
        <template #learning><Vibe64LearningLessonLauncher :learning="learning" /></template>
      </Vibe64SessionPanel>
    </section>
  </StudioAppShellLayout>
</template>

<style scoped>
.vibe64-local-app-index__top {
  color: var(--v64-on-surface);
  font: var(--v64-type-title-lg);
  font-size: 1.25rem;
  letter-spacing: -0.01em;
  min-width: 0;
  padding-inline: var(--v64-space-4) var(--v64-space-3);
}

.vibe64-local-app-index {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(1rem, 3vw, 2rem);
}

.vibe64-local-app-index--learning { display: flex; overflow: hidden; padding: 0; }
.vibe64-local-app-index--learning :deep(.studio-ai-sessions) { flex: 1 1 auto; min-height: 0; }
</style>
