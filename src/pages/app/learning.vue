<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "app"
    }
  }
}
</route>

<script setup>
import { computed, watch } from "vue";
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import Vibe64AuthSettingsButton from "@/components/studio/Vibe64AuthSettingsButton.vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { lessonPath } from "@/lib/vibe64Learning.js";

// The Learning page (/app/learning, both hosts): the app shell with L, the
// yellow bar and Leave lesson during a lesson, and Account settings. A lesson
// without a practice project (Lesson 0) lives here. L opens on the lesson in
// progress, otherwise on the courses.
const learning = useVibe64Learning();
const inLesson = computed(() => Boolean(learning?.inLesson));
const practicePath = computed(() => inLesson.value && learning.learningMode.practiceSlug ? lessonPath(learning.learningMode) : "");
const leaving = computed(() => learning?.state.modeBusy === "leave");

let opened = false;
async function openLearning() {
  const mode = await learning.readLearningMode();
  await learning.show(mode?.on ? { surface: "lesson", attemptId: mode.attemptId } : { surface: "courses" });
}
// L needs the signed-in viewer, which the Learning overlay binds.
watch(() => Boolean(learning?.state.actorKey), ready => {
  if (!ready || opened) return;
  opened = true;
  void openLearning().catch(() => {});
}, { immediate: true });
</script>

<template>
  <StudioAppShellLayout>
    <template #top-left>
      <div class="vibe64-learning-page__top">Learning</div>
    </template>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>
    <section class="vibe64-learning-page" data-test="learning-page">
      <template v-if="inLesson">
        <p class="vibe64-learning-page__eyebrow">Lesson in progress</p>
        <h1 class="vibe64-learning-page__title">{{ learning.lessonTitle }}</h1>
        <p v-if="!practicePath">This lesson has no practice project. Learning holds its steps.</p>
      </template>
      <template v-else>
        <h1 class="vibe64-learning-page__title">Learning</h1>
        <p>Choose a course in Learning, or go back to your projects.</p>
      </template>
      <div class="vibe64-learning-page__actions">
        <v-btn v-if="learning" color="primary" variant="flat" rounded="pill" min-height="48" data-test="learning-page-open"
          @click="openLearning">Open Learning</v-btn>
        <v-btn v-if="practicePath" variant="tonal" rounded="pill" min-height="48" :to="practicePath">Open practice project</v-btn>
        <v-btn v-if="inLesson" variant="tonal" rounded="pill" min-height="48" :loading="leaving" data-test="learning-page-leave"
          @click="learning.leaveLesson()">Leave lesson</v-btn>
        <v-btn v-else variant="text" rounded="pill" min-height="48" to="/app" data-test="learning-page-projects">Back to your projects</v-btn>
      </div>
    </section>
  </StudioAppShellLayout>
</template>

<style scoped>
.vibe64-learning-page__top {
  color: var(--v64-on-surface);
  font: var(--v64-type-title-lg);
  font-size: 1.25rem;
  min-width: 0;
  padding-inline: var(--v64-space-4) var(--v64-space-3);
}
.vibe64-learning-page {
  display: grid;
  gap: var(--v64-space-3);
  justify-items: start;
  margin: 0 auto;
  max-width: 40rem;
  padding: clamp(1rem, 3vw, 2rem);
}
.vibe64-learning-page > * { margin: 0; max-width: 100%; }
.vibe64-learning-page__eyebrow {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-label-md);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.vibe64-learning-page__title { font: var(--v64-type-headline-sm); overflow-wrap: anywhere; }
.vibe64-learning-page__actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-2); }
.vibe64-learning-page .v-btn { letter-spacing: 0; text-transform: none; }
</style>
