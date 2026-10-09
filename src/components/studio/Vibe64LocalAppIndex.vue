<script setup>
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import Vibe64AuthSettingsButton from "@/components/studio/Vibe64AuthSettingsButton.vue";
import { inject, ref } from "vue";
import { mdiBookOpenPageVariant, mdiMessageTextOutline } from "@mdi/js";
import Vibe64LearningPracticeProjectSelector from "./Vibe64LearningPracticeProjectSelector.vue";
import { VIBE64_TRAINING_LEARNER_GESTURE_KEY } from "@/lib/vibe64AssistantHost.js";
import Vibe64SessionPanel from "@/components/studio/Vibe64SessionPanel.vue";
import Vibe64LearningLessonLauncher from "@/components/studio/Vibe64LearningLessonLauncher.vue";
import { useVibe64LearningMode } from "@/composables/useVibe64LearningMode.js";

const panel = ref(null);
const chatCollapsed = ref(true);
const learnerGestures = inject(VIBE64_TRAINING_LEARNER_GESTURE_KEY, null);
function toggleChat(event) {
  const owner = learnerGestures?.value;
  const ticket = chatCollapsed.value ? owner?.begin(event, "chat-show") : null;
  chatCollapsed.value = !chatCollapsed.value;
  if (ticket) void owner.finish(ticket);
}
const learning = useVibe64LearningMode({ onConversationOpened(identity) {
  if (panel.value?.selectLearningConversation(identity)) chatCollapsed.value = false;
} });
const { learningMode, purposeFilter, learningResource, setLearningMode } = learning;
</script>

<template>
  <StudioAppShellLayout show-learning-mode-control :learning-mode="learningMode" :fill-viewport="learningMode" @update:learning-mode="setLearningMode">
    <template #top-left>
      <div class="vibe64-local-app-index__top">{{ learningMode ? "Lessons" : "Projects" }}</div>
      <Vibe64LearningPracticeProjectSelector v-if="learningMode" :panel="panel" />
      <v-btn
        v-if="learningMode"
        class="studio-app-shell-layout__learning-pane-toggle"
        :aria-label="chatCollapsed ? 'Show chat' : 'Show lessons'"
        :title="chatCollapsed ? 'Show chat' : 'Show lessons'"
        variant="text"
        @click="toggleChat($event)"
      >
        <span class="studio-app-shell-layout__learning-pane-label">{{ chatCollapsed ? "Show chat" : "Show lessons" }}</span>
        <v-icon class="studio-app-shell-layout__learning-pane-icon" :icon="chatCollapsed ? mdiMessageTextOutline : mdiBookOpenPageVariant" aria-hidden="true" />
      </v-btn>
    </template>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>

    <section class="vibe64-local-app-index" :class="{ 'vibe64-local-app-index--learning': learningMode }">
      <ProjectSelectionGate
        v-show="!learningMode"
        force-picker
        navigate-on-select
      />
      <Vibe64SessionPanel
        v-show="learningMode"
        ref="panel"
        :active="learningMode"
        :chat-collapsed="chatCollapsed"
        :learning-resource="learningResource"
        :purpose-filter="purposeFilter"
        project-pane="dashboard"
        @chat-attention="chatCollapsed = false"
        @project-attention="chatCollapsed = true"
      >
        <template #dashboard><Vibe64LearningLessonLauncher :learning="learning" /></template>
      </Vibe64SessionPanel>
    </section>
  </StudioAppShellLayout>
</template>

<style scoped>
.vibe64-local-app-index__top {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
  font-weight: 720;
  min-width: 0;
  padding-left: 1rem;
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
