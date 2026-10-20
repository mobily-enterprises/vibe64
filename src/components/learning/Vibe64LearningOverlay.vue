<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, toValue, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import TrainingGuideOverlay from "@local/vibe64-training/client/guide-overlay";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { isPracticeProjectSlug } from "@/lib/vibe64PracticeProjectName.js";
import { VIBE64_LEARNING_MODE_NOTE, VIBE64_LEARNING_PAGE_PATH, learningModeRedirect } from "@/lib/vibe64Learning.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { useVibe64LearningCourses } from "@/composables/useVibe64LearningCourses.js";
import Vibe64LearningCourses from "./Vibe64LearningCourses.vue";
import Vibe64LearningFinished from "./Vibe64LearningFinished.vue";
import Vibe64LearningPractice from "./Vibe64LearningPractice.vue";
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

// While learning mode is on (server-backed: a lesson in progress, not left or
// finished), every app bar of this host stays Learning yellow, with L open
// or hidden (vibe64-m3.css styles body.vibe64-in-lesson).
const IN_LESSON_CLASS = "vibe64-in-lesson";
watch(() => Boolean(learning?.inLesson), value => globalThis.document?.body?.classList.toggle(IN_LESSON_CLASS, value),
  { immediate: true });
onBeforeUnmount(() => globalThis.document?.body?.classList.remove(IN_LESSON_CLASS));

// Learning mode keeps the learner in the learning space: any other project URL
// goes to the lesson's practice project (or the Learning page without one),
// with a short note. The server refuses those projects' requests anyway.
const route = useRoute();
const router = useRouter();
watch(() => [learning?.learningMode, route?.fullPath], () => {
  if (!route || !router || !learning) return;
  const target = learningModeRedirect({ mode: learning.learningMode, slug: projectSlugFromRoute(route) });
  if (!target || target.path === route.path) return;
  learning.showNotice(VIBE64_LEARNING_MODE_NOTE);
  void router.replace(target.path);
}, { immediate: true });

const leaving = computed(() => learning?.state.modeBusy === "leave");
// When the lesson ends (left or finished, here or elsewhere) the projects come
// back: a practice project page, or the Learning page that held a lesson
// without one, returns to /app.
watch(() => Boolean(learning?.inLesson), (value, previous) => {
  if (!previous || value || !router) return;
  if (isPracticeProjectSlug(projectSlugFromRoute(route)) || route?.path === VIBE64_LEARNING_PAGE_PATH) void router.replace("/app");
});
async function leaveLesson() {
  if (await learning.leaveLesson()) learning.minimise();
}
function noticeShown(value) {
  if (!value) learning.clearNotice();
}

const open = computed(() => Boolean(learning?.state.open));
// Built on first open and kept while minimised, so its place stays as it was.
const built = ref(false);
watch(open, value => { if (value) built.value = true; }, { immediate: true });
watch(actorKey, () => { built.value = open.value; });
// Keyboard focus moves into L when it opens (Escape then hides it, like L).
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
  // Starting or continuing a lesson turns learning mode on.
  void learning.readLearningMode();
}
function selectSurface(value) {
  void learning.show({ surface: value });
}
function keydown(event) {
  if (event.key === "Escape" && !event.defaultPrevented) {
    event.stopPropagation();
    learning.minimise("learner");
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
      <!-- L covers the app bar, so its own L (same plate, same place) hides it. -->
      <button
        type="button" class="vibe64-learning__mark" aria-label="Hide Learning" title="Hide Learning (your place is kept)"
        data-test="learning-hide" @click="learning.toggle()"
      >
        <span class="vibe64-learning__plate" aria-hidden="true">L</span>
      </button>
      <nav class="vibe64-learning__tabs" aria-label="Learning">
        <button
          type="button" class="vibe64-learning__tab vibe64-learning__tab--courses" :aria-current="surface === 'courses' ? 'page' : undefined"
          data-test="learning-courses-tab" @click="selectSurface('courses')"
        >
          Courses
        </button>
        <button
          type="button" class="vibe64-learning__tab vibe64-learning__tab--practice" :aria-current="surface === 'practice' ? 'page' : undefined"
          data-test="learning-practice-tab" @click="selectSurface('practice')"
        >
          Practice
        </button>
        <button
          v-if="learning.state.attemptId" type="button" class="vibe64-learning__tab"
          :aria-current="surface === 'lesson' ? 'page' : undefined" data-test="learning-lesson-tab"
          @click="selectSurface('lesson')"
        >
          {{ lessonTitle }}
        </button>
      </nav>
      <button
        v-if="learning.inLesson" type="button" class="vibe64-learning__leave" :disabled="leaving"
        title="End this lesson (results and practice project kept) and get back to your projects" data-test="learning-header-leave"
        @click="leaveLesson"
      >
        Leave lesson
      </button>
    </header>
    <div class="vibe64-learning__content">
      <div v-if="surface === 'courses'" class="vibe64-learning__courses">
        <Vibe64LearningCourses :learning="courses" @opened="lessonOpened" />
        <!-- The learner's own teacher notes (C7), below the courses. -->
        <Vibe64LearningTeacherNotes :learning="learning" />
      </div>
      <!-- The learner's practice projects in the learning space. -->
      <div v-else-if="surface === 'practice'" class="vibe64-learning__courses">
        <Vibe64LearningPractice :learning="learning" :learning-revision="learningRevision" />
      </div>
      <!-- A completed lesson's "Lesson finished" screen (it ends the attempt). -->
      <div v-else-if="learning.state.finished && learning.lesson.value" class="vibe64-learning__courses">
        <Vibe64LearningFinished :learning="learning" :courses="courses" :learning-revision="learningRevision" @ended="courses.learningResource.reload()" />
      </div>
      <Vibe64LearningReader v-else :learning="learning" />
    </div>
  </div>
  <v-snackbar
    v-if="learning && actorKey"
    :model-value="Boolean(learning.notice)"
    :timeout="8000"
    location="bottom"
    data-test="learning-mode-notice"
    @update:model-value="noticeShown"
  >
    {{ learning.notice }}
    <template #actions>
      <v-btn
        v-if="learning.inLesson" variant="text" :loading="leaving" data-test="learning-notice-leave"
        @click="leaveLesson"
      >
        Leave lesson
      </v-btn>
    </template>
  </v-snackbar>
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
/* The open app-bar L plate, in the same place: L is one button that opens and
   hides Learning. A 48px target around the plate, which stays where the app
   bar's plate is. */
.vibe64-learning__mark {
  --v64-plate-size: 28px;
  align-items: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: 48px;
  justify-content: center;
  margin-inline: calc((var(--v64-plate-size) - 48px) / 2);
  padding: 0;
  width: 48px;
}
.vibe64-learning__plate {
  align-items: center;
  background: linear-gradient(150deg, #ffe680 0%, var(--v64-learning, #f5c518) 55%, #f0b400 100%);
  border: 1.5px solid #1d1600;
  border-radius: var(--v64-shape-sm, 8px);
  box-shadow: 0 0 0 3px var(--v64-learning-glow, rgba(245, 197, 24, 0.35));
  color: #1d1600;
  display: inline-flex;
  font: 850 1.05rem/1 system-ui, sans-serif;
  height: var(--v64-plate-size);
  justify-content: center;
  transition: transform var(--v64-duration-short, 100ms) var(--v64-ease-standard, ease);
  width: var(--v64-plate-size);
}
.vibe64-learning__mark:active .vibe64-learning__plate { transform: scale(0.94); }
.vibe64-learning__mark:focus-visible { outline: none; }
.vibe64-learning__mark:focus-visible .vibe64-learning__plate {
  outline: var(--v64-focus-ring-width, 2px) solid var(--v64-focus-ring-color, rgb(var(--v-theme-primary)));
  outline-offset: 3px;
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
/* "Courses" and "Practice" never shrink; a long lesson title takes the remaining width. */
.vibe64-learning__tab--courses, .vibe64-learning__tab--practice { flex: 0 0 auto; }
.vibe64-learning__tab[aria-current="page"] { background: var(--v64-learning-container, rgba(245, 197, 24, 0.24)); color: var(--v64-on-learning-container, inherit); font-weight: 700; }
.vibe64-learning__tab:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning__leave {
  background: transparent;
  border: 1px solid var(--v64-learning-strong, #b88a00);
  border-radius: 999px;
  color: inherit;
  cursor: pointer;
  flex: 0 0 auto;
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  min-height: 40px;
  padding: 0 var(--v64-space-4, 16px);
  white-space: nowrap;
}
.vibe64-learning__leave:disabled { cursor: progress; opacity: 0.6; }
.vibe64-learning__leave:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning:focus { outline: none; }
.vibe64-learning__content { flex: 1 1 auto; min-height: 0; overflow: hidden; padding-bottom: env(safe-area-inset-bottom, 0px); }
.vibe64-learning__courses { height: 100%; overflow-y: auto; }

/* Phone: a full-screen sheet; the plate matches the phone app-bar L (40px). */
@media (max-width: 600px) {
  .vibe64-learning { border-radius: 0; }
  .vibe64-learning__bar { gap: 4px; padding-inline: var(--v64-space-2, 8px); }
  .vibe64-learning__mark { --v64-plate-size: 2.5rem; }
  .vibe64-learning__tab { max-width: 9rem; padding: 0 var(--v64-space-3, 12px); }
  .vibe64-learning__leave { padding: 0 var(--v64-space-3, 12px); }
}
</style>
