<script setup>
import { computed, inject, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { VIBE64_COLLEAGUE_LAYOUT_KEY } from "@/lib/vibe64AssistantHost.js";
import { lessonShownIn, withoutLesson } from "@/lib/vibe64Learning.js";
import Vibe64LessonSheet from "./Vibe64LessonSheet.vue";
import Vibe64LearningStepBar from "./Vibe64LearningStepBar.vue";

// The lesson's stage frame: the step bar above a Learn-capable page. A
// project shell mounts it bare (its lesson is a sheet over Preview or Dash).
// A studio page (a screen outside any project) wraps its content in it with
// `studio`: the step bar's Lesson toggle (?lesson=1) then lays the same
// Lesson sheet over the page's right side (the whole page on a phone),
// without reflowing the page under it, and the frame tells Learning and
// Colleague what is on screen.
const props = defineProps({
  studio: { type: Boolean, default: false }
});
const learning = useVibe64Learning();
const route = useRoute();
const router = useRouter();
const { smAndDown } = useDisplay();
const available = computed(() => Boolean(props.studio && learning?.learnMode && learning.lessonAttemptId));
const lessonShown = computed(() => available.value && lessonShownIn(route.query));

function hideLesson() {
  if (lessonShownIn(route.query)) void router.replace({ path: route.path, query: withoutLesson(route.query) });
}

// The lesson stays shown while the learner moves between the views this
// frame shows (a tab, a place a step or Colleague opens) until they hide it.
// A phone shows the page they moved to instead; a page without this frame (a
// project) has its own panes.
watch(() => [route.path, lessonShownIn(route.query)], ([path, shown], [previousPath, wasShown] = []) => {
  if (path === previousPath || !wasShown || shown || !available.value || smAndDown.value) return;
  void router.replace({ path, query: { ...route.query, lesson: "1" } });
}, { flush: "post" });

// A studio page owns the Learn layout while it shows: no project, no chat
// column, the page (or the lesson over it) always visible.
const layout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY, null);
const owner = {
  studio: true,
  projectSlug: "",
  ready: true,
  projectVisible: true,
  get lessonVisible() { return lessonShown.value; },
  get lessonShown() { return lessonShown.value; },
  hideLesson,
  chatVisible: false,
  showProject() {},
  showChat() {}
};
if (props.studio && layout) {
  watch(() => props.studio, () => { layout.value = owner; }, { immediate: true });
  onBeforeUnmount(() => { if (layout.value === owner) layout.value = null; });
}
</script>

<template>
  <Vibe64LearningStepBar v-if="!studio" />
  <div v-else class="vibe64-learning-stage" :class="{ 'is-covered': lessonShown, 'is-phone': smAndDown }" data-test="learning-stage">
    <Vibe64LearningStepBar class="vibe64-learning-stage__bar" />
    <div class="vibe64-learning-stage__body">
      <div class="vibe64-learning-stage__page" :inert="lessonShown && smAndDown ? true : undefined">
        <slot />
      </div>
      <!-- A zero-width sticky anchor: the sheet floats over the page, which keeps its own width. -->
      <div v-if="lessonShown" class="vibe64-learning-stage__anchor">
        <aside class="vibe64-learning-stage__lesson" data-test="learning-stage-lesson">
          <Vibe64LessonSheet />
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vibe64-learning-stage { display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); min-height: 0; min-width: 0; }
.vibe64-learning-stage__bar { margin: var(--v64-space-2, 8px) var(--v64-space-3, 12px) 0; }
.vibe64-learning-stage__body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.vibe64-learning-stage__page { flex: 1 1 auto; min-width: 0; }
.vibe64-learning-stage__anchor {
  align-self: flex-start;
  flex: 0 0 0;
  height: 0;
  position: sticky;
  top: var(--v64-space-2, 8px);
  width: 0;
  z-index: 5;
}
.vibe64-learning-stage__lesson {
  height: calc(100dvh - 140px);
  position: absolute;
  right: var(--v64-space-3, 12px);
  top: 0;
  width: min(440px, calc(100vw - 24px));
}
.is-phone .vibe64-learning-stage__bar { margin-inline: var(--v64-space-2, 8px); }
.is-phone .vibe64-learning-stage__lesson { height: calc(100dvh - 150px); right: var(--v64-space-2, 8px); width: calc(100vw - 16px); }
</style>
