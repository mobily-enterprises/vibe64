<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, toValue, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { mdiArrowLeft, mdiArrowRight } from "@mdi/js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import TrainingGuideOverlay from "@local/vibe64-training/client/guide-overlay";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { modeRedirect, orientationSelection, withLesson } from "@/lib/vibe64Learning.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { useVibe64LearningCourses } from "@/composables/useVibe64LearningCourses.js";
import Vibe64LearningAttempts from "./Vibe64LearningAttempts.vue";
import Vibe64LearningCourses from "./Vibe64LearningCourses.vue";
import Vibe64LearningTeacherNotes from "./Vibe64LearningTeacherNotes.vue";

// The Courses overlay (Learn mode's Courses button), the catalogue where
// lessons are chosen and started (the lesson itself is read in the Learn
// page's Lesson pane), mounted once per host for the signed-in viewer: public
// App.vue and hosted AuthGate's authenticated content. It also keeps each address in its mode, colours the app bar in
// Learn mode, and mounts the one global teacher guide overlay of that host.
const props = defineProps({
  // Owner-only author trial of draft lessons (hosted owner).
  authorPreview: { type: [Boolean, Object], default: false }
});
const learning = useVibe64Learning();
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, null);
const actorKey = computed(() => String(toValue(viewer)?.actorKey || ""));
watch(actorKey, value => learning?.setViewer(value), { immediate: true });
onBeforeUnmount(() => learning?.setViewer(""));

// In Learn mode every app bar of this host is Learning yellow
// (vibe64-m3.css styles body.vibe64-learn-mode).
const LEARN_MODE_CLASS = "vibe64-learn-mode";
watch(() => Boolean(learning?.learnMode), value => globalThis.document?.body?.classList.toggle(LEARN_MODE_CLASS, value),
  { immediate: true });
onBeforeUnmount(() => globalThis.document?.body?.classList.remove(LEARN_MODE_CLASS));

// Each address stays in its mode: Learn shows only the current lesson's
// practice project (or no project selected); Develop never shows it. An
// address the learner opened, including the page's first address (a link or
// a reload), gets a short note; a move after a mode or lesson change does not.
// While L switches, the check waits for L's own move to the mode's saved place
// instead of cancelling it.
const route = useRoute();
const router = useRouter();
watch(() => [learning?.mode, route?.fullPath, learning?.state.modeBusy], (_value, previous) => {
  if (!route || !router || !learning || learning.state.modeBusy) return;
  const target = modeRedirect({ mode: learning.mode, slug: projectSlugFromRoute(route), path: route.path });
  if (!target || target.path === route.path) return;
  const modeChanged = Boolean(previous?.[0]) && previous[0] !== learning.mode;
  if (target.note && !modeChanged) learning.showNotice(target.note);
  // A Lesson finished screen whose practice project it just archived goes on
  // in the lesson shown on the mode's home.
  void router.replace(learning.state.finished && learning.mode?.on ? withLesson(target.path) : target.path);
}, { immediate: true });
// A mode's note goes when L switches to the other mode.
watch(() => learning?.mode?.on, (_on, wasOn) => {
  if (typeof wasOn === "boolean") learning.clearNotice();
});
function noticeShown(value) {
  if (!value) learning.clearNotice();
}

const open = computed(() => Boolean(learning?.state.open));
// Built on first open and kept while minimised, so its place stays as it was.
const built = ref(false);
watch(open, value => { if (value) built.value = true; }, { immediate: true });
watch(actorKey, () => { built.value = open.value; });
// Keyboard focus moves into the overlay when it opens (Escape then hides it).
const layer = ref(null);
watch(open, async value => {
  if (!value) return;
  await nextTick();
  const element = layer.value;
  if (typeof element?.focus === "function" && !element.contains?.(globalThis.document?.activeElement)) element.focus({ preventScroll: true });
});

// Courses' reads also serve a Take the tour request while Courses stays closed.
const orientationRequested = computed(() => Boolean(learning?.orientationRequested));
const courses = useVibe64LearningCourses({ authorPreview: computed(() => toValue(props.authorPreview) === true),
  active: computed(() => open.value || orientationRequested.value) });
const surface = computed(() => learning?.state.surface || "courses");
const tabs = Object.freeze([
  { id: "courses", label: "Courses" },
  { id: "progress", label: "In progress" },
  { id: "archived", label: "Archived" }
]);

useRealtimeEvent({
  event: VIBE64_TRAINING_LEARNER_CHANGED_EVENT,
  enabled: computed(() => Boolean(actorKey.value)),
  onEvent: ({ payload } = {}) => {
    void learning?.learnerChanged(payload || {});
    // A notes change touches no course, attempt or practice project.
    if (open.value && payload?.reason !== "notes") void courses.learningResource.reload();
  }
});

// Take the tour: read the courses and saved lessons afresh, then start the
// orientation lesson through the ordinary start; with none to start here,
// Courses opens instead, where a course can be installed or started.
let orientationRun = false;
watch(orientationRequested, value => { if (value) void takeOrientation(); }, { immediate: true });
async function takeOrientation() {
  if (orientationRun) return;
  orientationRun = true;
  try {
    await courses.refresh();
    const selection = orientationSelection(courses.coursesResource.data.value, courses.learningResource.data.value);
    // Courses itself says what can be installed or started (its notices sit below it).
    if (selection) await learning.startLesson(selection, courses.startLesson);
    else await learning.show({ surface: "courses" });
  } catch (cause) {
    learning.showNotice(String(cause?.message || "The tour did not start. Try again from Courses."));
  } finally {
    orientationRun = false;
    // An archive confirmation keeps the request (and Courses' reads) until answered.
    if (!learning.confirmArchive) learning.orientationAnswered();
  }
}

// One confirmation before a start archives a different lesson in progress.
const confirm = computed(() => learning?.confirmArchive || null);
async function archiveAndStart() {
  try { await learning.confirmArchiveAndStart(); }
  catch (cause) { learning.showNotice(String(cause?.message || "The lesson did not start. Try again from Courses.")); }
  finally { learning.orientationAnswered(); }
}
function keepCurrent() {
  learning.cancelArchive();
  learning.orientationAnswered();
}
// Continue lesson: the current lesson (not a finished one's screen), shown where it runs.
const continueOffered = computed(() => Boolean(learning?.mode?.on && learning.lessonAttemptId && !learning.state.finished));
function continueLesson() {
  void learning.openLesson().catch(cause => learning.showNotice(String(cause?.message || "The lesson could not open. Try again.")));
}
function keydown(event) {
  if (event.key === "Escape" && !event.defaultPrevented && !confirm.value) {
    event.stopPropagation();
    learning.closeCourses();
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
    aria-label="Courses"
    data-pane-swipe-ignore
    tabindex="-1"
    ref="layer"
    @keydown="keydown"
  >
    <header class="vibe64-learning__bar">
      <nav class="vibe64-learning__tabs" aria-label="Courses">
        <button
          v-for="tab in tabs" :key="tab.id" type="button" class="vibe64-learning__tab"
          :aria-current="surface === tab.id ? 'page' : undefined" :data-test="`learning-${tab.id}-tab`"
          @click="learning.show({ surface: tab.id })"
        >
          {{ tab.label }}
        </button>
      </nav>
      <!-- Two labelled ways out, no bare X: Back closes Courses onto the page it
           covers (your place there is kept); Continue lesson goes on with the
           current lesson where it runs (its practice project for a project lesson). -->
      <v-btn
        v-if="continueOffered" color="primary" variant="flat" rounded="pill" min-height="40" :append-icon="mdiArrowRight"
        class="vibe64-learning__exit" data-test="learning-continue-lesson" @click="continueLesson"
      >
        Continue lesson
      </v-btn>
      <v-btn
        variant="tonal" rounded="pill" min-height="40" :prepend-icon="mdiArrowLeft"
        class="vibe64-learning__exit" title="Close Courses (your place is kept)"
        data-test="learning-back" @click="learning.closeCourses()"
      >
        Back
      </v-btn>
    </header>
    <div class="vibe64-learning__content">
      <div v-if="surface === 'courses'" class="vibe64-learning__scroll">
        <Vibe64LearningCourses :learning="courses" />
        <!-- The learner's own teacher notes (C7), below the courses. -->
        <Vibe64LearningTeacherNotes :learning="learning" />
      </div>
      <div v-else class="vibe64-learning__scroll">
        <Vibe64LearningAttempts :learning="learning" :archived="surface === 'archived'" />
      </div>
    </div>
  </div>
  <!-- Above Courses (2400) by style: Vuetify stacks a dialog 10 above the topmost
       open overlay, such as the start refusal's toast (2000), ignoring z-index. -->
  <v-dialog
    v-if="learning && actorKey"
    :model-value="Boolean(confirm)"
    max-width="28rem"
    style="z-index: 2410"
    @update:model-value="value => value || keepCurrent()"
  >
    <v-card v-if="confirm" rounded="xl" data-test="learning-archive-confirm">
      <v-card-title class="text-wrap">Archive your lesson in progress?</v-card-title>
      <v-card-text>
        You can have one lesson in progress. Starting this one archives
        <strong>{{ confirm.current.lessonTitle || "the lesson in progress" }}</strong>
        with its practice project and conversation; it stays under Archived.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" min-height="48" data-test="learning-archive-cancel" @click="keepCurrent">Keep it</v-btn>
        <v-btn color="primary" variant="flat" min-height="48" data-test="learning-archive-start" @click="archiveAndStart">Archive and start</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-snackbar
    v-if="learning && actorKey"
    :model-value="Boolean(learning.notice)"
    :timeout="8000"
    location="bottom"
    data-test="learning-mode-notice"
    @update:model-value="noticeShown"
  >
    {{ learning.notice }}
  </v-snackbar>
</template>

<style scoped>
/* Stacking: guide overlay 3000 > archive confirmation 2410 > Courses 2400 > Colleague drawer and launcher. */
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
  padding: env(safe-area-inset-top, 0px) var(--v64-space-2, 8px) 0 var(--v64-space-3, 12px);
}
.vibe64-learning__tabs { display: flex; flex: 1 1 auto; gap: 4px; min-width: 0; overflow-x: auto; }
.vibe64-learning__tab {
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: inherit;
  cursor: pointer;
  flex: 0 0 auto;
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  min-height: 40px;
  padding: 0 var(--v64-space-4, 16px);
  white-space: nowrap;
}
.vibe64-learning__tab[aria-current="page"] { background: var(--v64-learning-container, rgba(245, 197, 24, 0.24)); color: var(--v64-on-learning-container, inherit); font-weight: 700; }
.vibe64-learning__tab:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning__exit { flex: 0 0 auto; font-weight: 700; text-transform: none; }
.vibe64-learning:focus { outline: none; }
.vibe64-learning__content { flex: 1 1 auto; min-height: 0; overflow: hidden; padding-bottom: env(safe-area-inset-bottom, 0px); }
.vibe64-learning__scroll { height: 100%; overflow-y: auto; }

/* Phone: a full-screen sheet. */
@media (max-width: 600px) {
  .vibe64-learning__bar { gap: 4px; padding-inline: var(--v64-space-2, 8px) 0; }
  .vibe64-learning__tab { padding: 0 var(--v64-space-3, 12px); }
}
</style>
