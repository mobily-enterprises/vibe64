<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, toValue, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import TrainingGuideOverlay from "@local/vibe64-training/client/guide-overlay";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { useVibe64LearningCourses } from "@/composables/useVibe64LearningCourses.js";
import Vibe64LearningCourses from "./Vibe64LearningCourses.vue";
import Vibe64LearningReader from "./Vibe64LearningReader.vue";
import Vibe64LearningTeacherNotes from "./Vibe64LearningTeacherNotes.vue";

// The Learning environment (L), mounted once per host for the signed-in
// viewer: public App.vue and hosted AuthGate's authenticated content. It also
// mounts the one global teacher guide overlay of that host.
const props = defineProps({
  // Owner-only author trial of draft lessons (hosted owner).
  authorPreview: { type: [Boolean, Object], default: false }
});
const learning = useVibe64Learning();
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, null);
const actorKey = computed(() => String(toValue(viewer)?.actorKey || ""));
watch(actorKey, value => learning?.setViewer(value), { immediate: true });
onBeforeUnmount(() => learning?.setViewer(""));

const open = computed(() => Boolean(learning?.state.open));
// Built on first open and kept while minimised, so its place stays as it was.
const built = ref(false);
watch(open, value => { if (value) built.value = true; }, { immediate: true });
watch(actorKey, () => { built.value = open.value; });
// Keyboard focus moves into L when it opens (Escape then closes it).
const layer = ref(null);
watch(open, async value => {
  if (!value) return;
  await nextTick();
  const element = layer.value;
  if (typeof element?.focus === "function" && !element.contains?.(globalThis.document?.activeElement)) element.focus({ preventScroll: true });
});

const courses = useVibe64LearningCourses({ authorPreview: computed(() => toValue(props.authorPreview) === true), active: open });
const learningRevision = computed(() => {
  const value = courses.learningResource.data.value;
  return value?.ok === true && Number.isSafeInteger(value.revision) ? value.revision : null;
});
const surface = computed(() => learning?.state.surface || "courses");
const lessonTitle = computed(() => learning?.lesson.value?.title || learning?.lesson.value?.code || "Lesson");

useRealtimeEvent({
  event: VIBE64_TRAINING_LEARNER_CHANGED_EVENT,
  enabled: computed(() => Boolean(actorKey.value)),
  onEvent: ({ payload } = {}) => {
    void learning?.learnerChanged(payload || {});
    // A notes change touches no course, attempt or practice project.
    if (open.value && payload?.reason !== "notes") void courses.learningResource.reload();
  }
});

function lessonOpened(outcome) {
  void learning.show({ surface: "lesson", attemptId: outcome.attemptId });
}
function selectSurface(value) {
  void learning.show({ surface: value });
}
function keydown(event) {
  if (event.key === "Escape" && !event.defaultPrevented) {
    event.stopPropagation();
    learning.close();
  }
}
</script>

<template>
  <TrainingGuideOverlay />
  <div
    v-if="learning && actorKey && built"
    v-show="open"
    class="vibe64-learning"
    role="dialog"
    aria-modal="true"
    aria-label="Learning"
    data-pane-swipe-ignore
    tabindex="-1"
    ref="layer"
    @keydown="keydown"
  >
    <header class="vibe64-learning__bar">
      <span class="vibe64-learning__mark" aria-hidden="true">L</span>
      <nav class="vibe64-learning__tabs" aria-label="Learning">
        <button type="button" class="vibe64-learning__tab" :aria-current="surface === 'courses' ? 'page' : undefined"
          data-test="learning-courses-tab" @click="selectSurface('courses')">Courses</button>
        <button v-if="learning.state.attemptId" type="button" class="vibe64-learning__tab"
          :aria-current="surface === 'lesson' ? 'page' : undefined" data-test="learning-lesson-tab"
          @click="selectSurface('lesson')">{{ lessonTitle }}</button>
      </nav>
      <v-btn variant="text" min-height="48" class="vibe64-learning__action" title="Minimise Learning; your place is kept"
        aria-label="Minimise Learning" data-test="learning-minimise" @click="learning.minimise()">Minimise</v-btn>
      <v-btn variant="text" min-height="48" min-width="48" icon class="vibe64-learning__action" title="Close Learning"
        aria-label="Close Learning" data-test="learning-close" @click="learning.close()">
        <span aria-hidden="true">✕</span>
      </v-btn>
    </header>
    <div class="vibe64-learning__content">
      <div v-if="surface === 'courses'" class="vibe64-learning__courses">
        <Vibe64LearningCourses :learning="courses" @opened="lessonOpened" />
        <!-- The learner's own teacher notes (C7), below the courses. -->
        <Vibe64LearningTeacherNotes :learning="learning" />
      </div>
      <Vibe64LearningReader v-else :learning="learning" :learning-revision="learningRevision" @ended="courses.learningResource.reload()" />
    </div>
  </div>
</template>

<style scoped>
/* Stacking: guide overlay 3000 > L 2400 > Colleague drawer and launcher. */
.vibe64-learning {
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
  display: flex;
  flex-direction: column;
  inset: 0;
  position: fixed;
  z-index: 2400;
}
.vibe64-learning__bar {
  align-items: center;
  background: var(--v64-learning-app-bar, rgb(var(--v-theme-surface)));
  border-bottom: 2px solid var(--v64-learning, #f5c518);
  display: flex;
  flex: 0 0 auto;
  gap: var(--v64-space-2, 8px);
  min-height: 56px;
  padding: env(safe-area-inset-top, 0px) var(--v64-space-3, 12px) 0;
}
.vibe64-learning__mark {
  align-items: center;
  background: linear-gradient(150deg, #ffe680 0%, var(--v64-learning, #f5c518) 55%, #f0b400 100%);
  border: 1.5px solid #1d1600;
  border-radius: var(--v64-shape-sm, 8px);
  color: #1d1600;
  display: inline-flex;
  flex: 0 0 auto;
  font: 850 1.05rem/1 system-ui, sans-serif;
  height: 32px;
  justify-content: center;
  width: 32px;
}
.vibe64-learning__tabs { display: flex; flex: 1 1 auto; gap: 4px; min-width: 0; overflow-x: auto; }
.vibe64-learning__tab {
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: inherit;
  cursor: pointer;
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  max-width: 22rem;
  min-height: 40px;
  overflow: hidden;
  padding: 0 var(--v64-space-4, 16px);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vibe64-learning__tab[aria-current="page"] { background: var(--v64-learning-container, rgba(245, 197, 24, 0.24)); color: var(--v64-on-learning-container, inherit); font-weight: 700; }
.vibe64-learning__tab:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning__action { flex: 0 0 auto; letter-spacing: 0; text-transform: none; }
.vibe64-learning:focus { outline: none; }
.vibe64-learning__content { flex: 1 1 auto; min-height: 0; overflow: hidden; padding-bottom: env(safe-area-inset-bottom, 0px); }
.vibe64-learning__courses { height: 100%; overflow-y: auto; }

/* Phone: a full-screen sheet; Minimise is the icon-free short label. */
@media (max-width: 600px) {
  .vibe64-learning { border-radius: 0; }
  .vibe64-learning__bar { gap: 4px; padding-inline: var(--v64-space-2, 8px); }
  .vibe64-learning__tab { max-width: 9rem; padding: 0 var(--v64-space-3, 12px); }
}
</style>
