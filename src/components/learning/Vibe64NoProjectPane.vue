<script setup>
import { computed } from "vue";
import { mdiSchoolOutline } from "@mdi/js";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import Vibe64EmptySessionLayout from "@/components/studio/Vibe64EmptySessionLayout.vue";
import Vibe64SessionFrame from "@/components/studio/Vibe64SessionFrame.vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// No project selected: Learn mode without a practice project (/app/learning):
// no lesson in progress, or a lesson without one (Lesson 0). The session area
// a project shows with no session open. With no lesson, the chat column (what
// a phone shows first), Preview and the Dashboard each say so and offer
// Choose a lesson, which opens Courses. The Dashboard keeps its section menu.
// Both hosts' project pages render it.
defineProps({
  chatCollapsed: { type: Boolean, default: false },
  projectPane: { type: String, default: "preview" },
  section: { type: String, default: "" }
});
defineEmits(["select"]);

const learning = useVibe64Learning();
const noLesson = computed(() => Boolean(learning?.mode) && !learning.mode.currentAttemptId);
const message = computed(() => noLesson.value ? "No lesson in progress" : "No project selected");
const chooseLesson = () => learning?.openCourses("courses");
</script>

<template>
  <Vibe64SessionFrame
    class="studio-screen__no-project"
    :chat-collapsed="chatCollapsed"
    data-test="no-project-pane"
  >
    <Vibe64EmptySessionLayout
      :chat-collapsed="chatCollapsed"
      :dashboard="projectPane === 'dashboard'"
      :hint="message"
      :preview-title="message"
      :preview-detail="noLesson ? 'Choose a lesson to get its practice project.' : ''"
    >
      <template v-if="noLesson" #hint>
        <v-btn
          class="studio-screen__choose-lesson studio-screen__choose-lesson--hint"
          data-test="choose-lesson"
          :prepend-icon="mdiSchoolOutline"
          size="small"
          variant="tonal"
          @click="chooseLesson"
        >
          Choose a lesson
        </v-btn>
      </template>
      <template v-if="noLesson" #preview>
        <v-btn
          class="studio-screen__choose-lesson"
          data-test="choose-lesson"
          :prepend-icon="mdiSchoolOutline"
          variant="tonal"
          @click="chooseLesson"
        >
          Choose a lesson
        </v-btn>
      </template>
      <template #dashboard>
        <Vibe64DashboardShell
          no-project
          :section="section"
          @select="$emit('select', $event)"
        >
          <div class="studio-screen__no-project-text">
            <p>{{ message }}</p>
            <v-btn
              v-if="noLesson"
              class="studio-screen__choose-lesson"
              data-test="choose-lesson"
              :prepend-icon="mdiSchoolOutline"
              variant="tonal"
              @click="chooseLesson"
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

.studio-screen__choose-lesson--hint {
  display: flex;
  margin-top: var(--v64-space-2);
}
</style>
