<script setup>
import { computed } from "vue";
import { mdiSchoolOutline } from "@mdi/js";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import Vibe64EmptySessionLayout from "@/components/studio/Vibe64EmptySessionLayout.vue";
import Vibe64SessionFrame from "@/components/studio/Vibe64SessionFrame.vue";
import Vibe64LearnWelcome from "@/components/learning/Vibe64LearnWelcome.vue";
import Vibe64LearningLessonPane from "@/components/learning/Vibe64LearningLessonPane.vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// No project selected: Learn mode without a practice project (/app/learning):
// no lesson in progress, or a lesson without one. A lesson without
// one has no coding session, so no chat column: its Lesson pane (or the
// Dashboard) fills the area, beside Colleague. With no lesson it is the
// session area a project shows with no session open: Preview shows Learn's
// welcome (on a phone the chat column shows it, since a phone opens there),
// the desktop chat column says where the teacher will talk, and the Dashboard
// offers Choose a lesson beside its section menu. Both hosts render it.
defineProps({
  chatCollapsed: { type: Boolean, default: false },
  projectPane: { type: String, default: "preview" },
  section: { type: String, default: "" }
});
defineEmits(["select"]);

const learning = useVibe64Learning();
const noLesson = computed(() => Boolean(learning?.mode) && !learning.lessonAttemptId);
const lesson = computed(() => Boolean(learning?.learnMode && learning.lessonAttemptId));
</script>

<template>
  <Vibe64SessionFrame
    class="studio-screen__no-project"
    :chat-collapsed="chatCollapsed || lesson"
    data-test="no-project-pane"
  >
    <div v-if="lesson" class="studio-screen__lesson-layout">
      <Vibe64LearningLessonPane />
    </div>
    <Vibe64EmptySessionLayout
      v-else
      :chat-collapsed="chatCollapsed"
      :dashboard="projectPane === 'dashboard'"
      :hint="noLesson ? '' : 'No project selected'"
      :preview-title="noLesson ? '' : 'No project selected'"
    >
      <template v-if="noLesson" #chat>
        <div class="studio-screen__no-lesson-chat">
          <p class="studio-screen__no-lesson-note">
            Your teacher chats with you here once a lesson starts.
          </p>
          <Vibe64LearnWelcome class="studio-screen__no-lesson-welcome" />
        </div>
      </template>
      <template v-if="noLesson" #preview>
        <Vibe64LearnWelcome />
      </template>
      <template #dashboard>
        <Vibe64DashboardShell
          no-project
          :section="section"
          @select="$emit('select', $event)"
        >
          <div class="studio-screen__no-project-text">
            <p>{{ noLesson ? "No lesson in progress" : "No project selected" }}</p>
            <v-btn
              v-if="noLesson"
              class="studio-screen__choose-lesson"
              data-test="choose-lesson"
              :prepend-icon="mdiSchoolOutline"
              variant="tonal"
              @click="learning.openCourses('courses')"
            >
              Choose a lesson
            </v-btn>
          </div>
        </Vibe64DashboardShell>
      </template>
    </Vibe64EmptySessionLayout>
  </Vibe64SessionFrame>
</template>

<style scoped>
.studio-screen__no-project {
  flex: 1 1 auto;
  min-height: 0;
}

.studio-screen__lesson-layout {
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 14px;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-screen__no-project-text {
  color: var(--v64-on-surface-variant);
  display: grid;
  gap: var(--v64-space-3);
  justify-items: start;
  padding: var(--v64-space-4);
}

.studio-screen__no-project-text p {
  margin: 0;
}

.studio-screen__choose-lesson {
  text-transform: none;
}

/* The chat column's place for a session's messages. */
.studio-screen__no-lesson-chat {
  align-items: center;
  display: grid;
  justify-items: center;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: var(--v64-space-4) var(--v64-space-2);
}

.studio-screen__no-lesson-note {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif);
  margin: 0;
  max-width: 18rem;
  text-align: center;
}

.studio-screen__no-lesson-welcome {
  display: none;
}

/* A phone opens on the chat column: the welcome is there. */
@media (max-width: 980px) {
  .studio-screen__no-lesson-note {
    display: none;
  }

  .studio-screen__no-lesson-welcome {
    display: grid;
  }
}
</style>
