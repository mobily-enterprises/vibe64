<script setup>
import { computed, inject, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import { mdiClose } from "@mdi/js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { VIBE64_COLLEAGUE_LAYOUT_KEY } from "@/lib/vibe64AssistantHost.js";
import Vibe64LearningLessonPane from "./Vibe64LearningLessonPane.vue";
import Vibe64LearningStepBar from "./Vibe64LearningStepBar.vue";

// The lesson's stage frame: the step bar above a Learn-capable page. A
// project shell mounts it bare (its Lesson pane is a project pane). A studio
// page (a screen outside any project) wraps its content in it with `studio`:
// the step bar's Lesson button then docks the same Lesson pane beside the
// page (?pane=lesson), over it on a phone, and the frame tells Learning and
// Colleague what is on screen.
const props = defineProps({
  studio: { type: Boolean, default: false }
});
const learning = useVibe64Learning();
const route = useRoute();
const router = useRouter();
const { smAndDown } = useDisplay();
const available = computed(() => Boolean(props.studio && learning?.learnMode && learning.lessonAttemptId));
const lessonPane = computed(() => available.value && route.query?.pane === "lesson");

function closeLesson() {
  const query = { ...route.query };
  delete query.pane;
  void router.replace({ path: route.path, query });
}

// A studio page owns the Learn layout while it shows: no project, no chat
// column, the page (or the docked Lesson pane) always visible.
const layout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY, null);
const owner = {
  studio: true,
  projectSlug: "",
  ready: true,
  projectVisible: true,
  get lessonVisible() { return lessonPane.value; },
  get lessonPane() { return lessonPane.value; },
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
  <div v-else class="vibe64-learning-stage" :class="{ 'is-docked': lessonPane, 'is-phone': smAndDown }" data-test="learning-stage">
    <Vibe64LearningStepBar class="vibe64-learning-stage__bar" />
    <div class="vibe64-learning-stage__body">
      <div v-show="!(lessonPane && smAndDown)" class="vibe64-learning-stage__page">
        <slot />
      </div>
      <aside v-if="lessonPane" class="vibe64-learning-stage__lesson" data-test="learning-stage-lesson">
        <v-btn
          class="vibe64-learning-stage__close" :icon="mdiClose" variant="text" size="small" min-width="40" min-height="40"
          aria-label="Close lesson" data-test="learning-stage-close" @click="closeLesson"
        />
        <Vibe64LearningLessonPane />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.vibe64-learning-stage { display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); min-height: 0; min-width: 0; }
.vibe64-learning-stage__bar { margin: var(--v64-space-2, 8px) var(--v64-space-3, 12px) 0; }
.vibe64-learning-stage__body { display: flex; flex: 1 1 auto; gap: var(--v64-space-3, 12px); min-height: 0; min-width: 0; }
.vibe64-learning-stage__page { flex: 1 1 auto; min-width: 0; }
.vibe64-learning-stage__lesson {
  border: 1px solid var(--v64-learning-strong, #f5c518);
  border-radius: var(--v64-shape-md, 12px);
  flex: 0 0 min(420px, 40%);
  margin: 0 var(--v64-space-3, 12px) var(--v64-space-3, 12px) 0;
  max-height: calc(100vh - 140px);
  overflow: hidden;
  position: sticky;
  top: var(--v64-space-2, 8px);
}
.vibe64-learning-stage__close { position: absolute; right: 4px; top: 4px; z-index: 1; }
.is-phone .vibe64-learning-stage__bar { margin-inline: var(--v64-space-2, 8px); }
.is-phone .vibe64-learning-stage__lesson { flex: 1 1 auto; margin: 0 var(--v64-space-2, 8px) var(--v64-space-2, 8px); max-height: none; position: static; }
</style>
