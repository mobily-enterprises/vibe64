<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, toValue, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { mdiClose } from "@mdi/js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import TrainingGuideOverlay from "@local/vibe64-training/client/guide-overlay";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { modeRedirect } from "@/lib/vibe64Learning.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { useVibe64LearningCourses } from "@/composables/useVibe64LearningCourses.js";
import Vibe64LearningAttempts from "./Vibe64LearningAttempts.vue";
import Vibe64LearningCourses from "./Vibe64LearningCourses.vue";
import Vibe64LearningFinished from "./Vibe64LearningFinished.vue";
import Vibe64LearningReader from "./Vibe64LearningReader.vue";
import Vibe64LearningTeacherNotes from "./Vibe64LearningTeacherNotes.vue";

// The Courses overlay (Learn mode's Courses button), mounted once per host for
// the signed-in viewer: public App.vue and hosted AuthGate's authenticated
// content. It also keeps each address in its mode, colours the app bar in
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
// address the learner opened gets a short note; a move after a mode or
// lesson change does not. While L switches, the check waits for L's own move
// to the mode's saved place instead of cancelling it.
const route = useRoute();
const router = useRouter();
watch(() => [learning?.mode, route?.fullPath, learning?.state.modeBusy], (_value, previous) => {
  if (!route || !router || !learning || learning.state.modeBusy) return;
  const target = modeRedirect({ mode: learning.mode, slug: projectSlugFromRoute(route), path: route.path });
  if (!target || target.path === route.path) return;
  if (target.note && previous && previous[0] === learning.mode) learning.showNotice(target.note);
  void router.replace(target.path);
}, { immediate: true });
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

const courses = useVibe64LearningCourses({ authorPreview: computed(() => toValue(props.authorPreview) === true), active: open });
const surface = computed(() => learning?.state.surface || "courses");
const lessonTitle = computed(() => learning?.lesson.value?.title || learning?.lesson.value?.code || "Lesson");
const tabs = computed(() => [
  { id: "courses", label: "Courses" },
  { id: "progress", label: "In progress" },
  { id: "archived", label: "Archived" },
  ...(learning?.state.attemptId ? [{ id: "lesson", label: lessonTitle.value }] : [])
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

// One confirmation before a start archives a different lesson in progress.
const confirm = computed(() => learning?.confirmArchive || null);
async function archiveAndStart() {
  try { await learning.confirmArchiveAndStart(); }
  catch (cause) { learning.showNotice(String(cause?.message || "The lesson did not start. Try again from Courses.")); }
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
          :class="{ 'vibe64-learning__tab--lesson': tab.id === 'lesson' }"
          :aria-current="surface === tab.id ? 'page' : undefined" :data-test="`learning-${tab.id}-tab`"
          @click="learning.show({ surface: tab.id })"
        >
          {{ tab.label }}
        </button>
      </nav>
      <v-btn
        :icon="mdiClose" variant="text" min-width="48" min-height="48" aria-label="Close Courses"
        title="Close Courses (your place is kept)" data-test="learning-hide" @click="learning.closeCourses()"
      />
    </header>
    <div class="vibe64-learning__content">
      <div v-if="surface === 'courses'" class="vibe64-learning__scroll">
        <Vibe64LearningCourses :learning="courses" />
        <!-- The learner's own teacher notes (C7), below the courses. -->
        <Vibe64LearningTeacherNotes :learning="learning" />
      </div>
      <div v-else-if="surface === 'progress' || surface === 'archived'" class="vibe64-learning__scroll">
        <Vibe64LearningAttempts :learning="learning" :archived="surface === 'archived'" />
      </div>
      <!-- A completed lesson's "Lesson finished" screen (it finishes the attempt). -->
      <div v-else-if="learning.state.finished && learning.lesson.value" class="vibe64-learning__scroll">
        <Vibe64LearningFinished :learning="learning" :courses="courses" />
      </div>
      <Vibe64LearningReader v-else :learning="learning" />
    </div>
  </div>
  <v-dialog
    v-if="learning && actorKey"
    :model-value="Boolean(confirm)"
    max-width="28rem"
    @update:model-value="value => value || learning.cancelArchive()"
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
        <v-btn variant="text" min-height="48" data-test="learning-archive-cancel" @click="learning.cancelArchive()">Keep it</v-btn>
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
/* Stacking: guide overlay 3000 > Courses 2400 > Colleague drawer and launcher. */
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
/* A long lesson title takes the remaining width. */
.vibe64-learning__tab--lesson { flex: 0 1 auto; max-width: 22rem; overflow: hidden; text-overflow: ellipsis; }
.vibe64-learning__tab[aria-current="page"] { background: var(--v64-learning-container, rgba(245, 197, 24, 0.24)); color: var(--v64-on-learning-container, inherit); font-weight: 700; }
.vibe64-learning__tab:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning:focus { outline: none; }
.vibe64-learning__content { flex: 1 1 auto; min-height: 0; overflow: hidden; padding-bottom: env(safe-area-inset-bottom, 0px); }
.vibe64-learning__scroll { height: 100%; overflow-y: auto; }

/* Phone: a full-screen sheet. */
@media (max-width: 600px) {
  .vibe64-learning__bar { gap: 4px; padding-inline: var(--v64-space-2, 8px) 0; }
  .vibe64-learning__tab { padding: 0 var(--v64-space-3, 12px); }
  .vibe64-learning__tab--lesson { max-width: 9rem; }
}
</style>
