<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { mdiBookOpenPageVariantOutline, mdiChevronDown, mdiChevronLeft, mdiChevronRight, mdiChevronUp, mdiMenu, mdiPause, mdiPlay } from "@mdi/js";
import { aiOnboardingAvailable, aiOnboardingNeeded, requestVibe64AiOnboarding } from "@local/vibe64-accounts/client";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import Vibe64LearningStep from "./Vibe64LearningStep.vue";

// The current lesson's step bar, at the top of the project page in Learn
// mode (also with no project selected): the lesson companion. It names the
// lesson and its current step. A step with beats plays them here one line at
// a time (dots show where), pointing at the real places; Back/Next move by
// beat into the neighbouring steps, and after the last beat the step's own
// verdict control and Next step appear. A step without beats shows its title
// and status, with Show me when it declares a guide. ≡ Step drops the
// whole step (the reader's own step view, with every control) open under the
// bar, in place. Courses, always on it, is the way out to the catalogue. It
// collapses to its position and dots. While the lesson waits for the
// learner's AI (its practice project could not be prepared without one), the
// line says so instead and offers Set up your AI.
const learning = useVibe64Learning();
const lesson = computed(() => learning?.lesson.value || null);
const steps = computed(() => lesson.value?.steps || []);
const step = computed(() => learning?.currentStep.value || null);
const player = computed(() => learning?.player || null);
const index = computed(() => steps.value.findIndex(value => value.id === step.value?.id));
const visible = computed(() => Boolean(learning?.stepBarVisible));
const collapsed = computed(() => Boolean(learning?.stepBarCollapsed));
const ended = computed(() => Boolean(lesson.value?.attempt?.ended));
const aiRequired = computed(() => Boolean(learning?.aiRequired));
const busy = computed(() => learning?.state.busy || "");
const statusLabel = Object.freeze({ passed: "Passed", "not-yet-passed": "Not yet passed", "not-started": "Not checked yet" });
const status = computed(() => step.value ? learning.stepStatus(step.value.id) : "not-started");
const beats = computed(() => player.value?.beats.value || []);
const beat = computed(() => player.value?.beat.value || null);
const beatIndex = computed(() => player.value?.index.value || 0);
// A step without beats is in its final state at once (its verdict control shows).
const final = computed(() => beats.value.length ? Boolean(player.value?.final) : true);
const kind = computed(() => step.value?.check?.kind || "none");
// The step's own verdict control in its final beat state (its check beat, or after its last beat).
const verdict = computed(() => {
  if (!final.value || ended.value || status.value === "passed") return null;
  const stepId = step.value.id;
  if (kind.value === "self") return { label: "Done", run: () => learning.done(stepId), busy: `done:${stepId}` };
  if (kind.value === "none") return { label: "Mark as done", run: () => learning.done(stepId), busy: `done:${stepId}` };
  if (kind.value === "auto") return { label: "Check my work", run: check, busy: `check:${stepId}` };
  if (kind.value === "review") return { label: note.value ? "Check again" : "Check my work", run: checkReview, busy: `review:${stepId}` };
  if (kind.value === "choice") return { label: "Answer in Step", run: () => learning.setStepText(true), busy: "" };
  return null;
});
const beatText = computed(() => {
  if (player.value?.confirmed) return player.value.confirmed;
  if (reviewing.value) return "Checking your work with your AI…";
  if (final.value && status.value === "passed" && kind.value === "review") return learning.reviewNote(learning.savedReview(step.value.id)) || "Passed ✓";
  // A review check's line is the step's rubric.
  if (beat.value?.kind === "check" && beat.value.target === "review") return step.value?.check?.rubric || "";
  if (beat.value && !(final.value && status.value === "passed")) return beat.value.text;
  if (status.value === "passed") return kind.value === "none" || kind.value === "self" ? "Done ✓" : "Passed ✓";
  return step.value?.title || "";
});
// A check that did not pass, or a Show me that could not show, says why until the step changes.
const note = ref("");
watch(() => step.value?.id, () => { note.value = ""; });
// A lesson message Do it for me could not send for lack of AI: Set up your AI shows beside it.
const NOT_SENT_NO_AI = "No AI is connected yet, so nothing was sent. Set up your AI, or press Next.";
const setUpAiOffered = computed(() => Boolean(aiOnboardingAvailable.value && (aiRequired.value || note.value === NOT_SENT_NO_AI)));
async function check() {
  const stepId = step.value.id;
  note.value = "";
  const result = await learning.runCheck(stepId);
  if (step.value?.id === stepId && result?.outcome === "not-yet-passed" && result.reason) note.value = `Not yet: ${result.reason}`;
}
// Check my work on a review step: the reviewer's verdict, or why it could not review.
const reviewing = computed(() => Boolean(step.value && busy.value === `review:${step.value.id}`));
async function checkReview() {
  const stepId = step.value.id;
  note.value = "";
  const result = await learning.review(stepId);
  // A pass on a step with beats is said on the beat's line itself.
  if (step.value?.id !== stepId || (result?.outcome === "passed" && beats.value.length)) return;
  note.value = result ? learning.reviewNote(result) : learning.state.error || "Your work could not be checked. Try again.";
}
async function showMe() {
  note.value = "";
  try {
    const result = await learning.showMe(step.value.id);
    if (result?.guide && result.guide.shown === false) note.value = "That place is not visible on this page.";
  } catch (cause) { note.value = String(cause?.message || "That place could not be shown."); }
}
// I'm stuck: Colleague helps on a do beat, or with a step its own check decides.
const stuckOffered = computed(() => Boolean(!ended.value && status.value !== "passed" && !player.value?.confirmed &&
  (beat.value?.kind === "do" || (final.value && ["auto", "review"].includes(kind.value)))));
function askStuck() {
  note.value = "";
  try { learning.stuck(step.value.id); } catch (cause) { note.value = String(cause?.message || "Colleague could not be asked."); }
}
// A do beat the page can do for the learner (not Save, which it only points at).
const canDoIt = computed(() => Boolean(beat.value?.kind === "do" && !player.value?.confirmed && !ended.value &&
  learning.doItForMeKind(beat.value)));
const doing = ref(false);
async function doItForMe() {
  note.value = "";
  doing.value = true;
  try {
    if (await learning.doItForMe() === false) {
      const send = beat.value?.target === "send-message";
      note.value = send && aiOnboardingNeeded.value ? NOT_SENT_NO_AI
        : send ? "That could not be sent here. Send it yourself, or press Next." : "That could not be done here. Do it yourself, or press Next.";
    }
  } catch (cause) {
    note.value = String(cause?.message || "That could not be done here. Do it yourself, or press Next.");
  } finally { doing.value = false; }
}
watch(beat, () => { note.value = ""; });
const go = offset => {
  const next = steps.value[index.value + offset];
  if (next) learning.selectStep(next.id);
};
// ≡ Step: open while the bar is expanded; Escape closes it.
const stepTextShown = computed(() => Boolean(learning?.stepTextOpen && !collapsed.value));
const stepError = ref("");
function closeOnEscape(event) {
  if (event.key === "Escape" && stepTextShown.value) learning.setStepText(false);
}
watch(stepTextShown, open => {
  if (open) globalThis.document?.addEventListener("keydown", closeOnEscape);
  else globalThis.document?.removeEventListener("keydown", closeOnEscape);
}, { immediate: true });
onBeforeUnmount(() => globalThis.document?.removeEventListener("keydown", closeOnEscape));
const back = () => beats.value.length ? player.value.back() : go(-1);
const forward = () => beats.value.length ? player.value.next() : go(1);
</script>

<template>
  <div
    v-if="visible" class="vibe64-learning-step-bar-host"
    @pointerenter="player?.hold(true)" @pointerleave="player?.hold(false)"
    @focusin="player?.hold(true)" @focusout="player?.hold(false)"
  >
    <section
      class="vibe64-learning-step-bar"
      :class="{ 'vibe64-learning-step-bar--collapsed': collapsed, 'vibe64-learning-step-bar--beats': beats.length }"
      aria-label="Lesson steps"
      data-test="learning-step-bar"
      data-vibe64-guide="lesson-bar"
    >
      <button
        type="button" class="vibe64-learning-step-bar__toggle" :aria-expanded="!collapsed"
        :aria-label="collapsed ? 'Show the lesson step' : 'Hide the lesson step'" data-test="learning-step-bar-toggle"
        @click="learning.toggleStepBar()"
      >
        <v-icon :icon="collapsed ? mdiChevronDown : mdiChevronUp" size="20" />
      </button>
      <div class="vibe64-learning-step-bar__position">
        <span class="vibe64-learning-step-bar__lesson">{{ lesson.title || lesson.code }}</span>
        <span class="vibe64-learning-step-bar__step">
          <template v-if="beats.length">{{ index + 1 }}/{{ steps.length }}</template>
          <template v-else>Step {{ index + 1 }} of {{ steps.length }}<template v-if="!collapsed">: {{ step.title }}</template></template>
        </span>
        <span
          v-if="beats.length" class="vibe64-learning-step-bar__dots" role="img"
          :aria-label="`Part ${Math.min(beatIndex + 1, beats.length)} of ${beats.length}`" data-test="learning-step-bar-dots"
        >
          <span
            v-for="(item, position) in beats" :key="position" class="vibe64-learning-step-bar__dot"
            :class="{ 'is-done': position < beatIndex, 'is-current': position === beatIndex }"
          />
        </span>
      </div>
      <div v-if="!collapsed && aiRequired" class="vibe64-learning-step-bar__line">
        <span class="vibe64-learning-step-bar__beat" role="status" data-test="learning-step-bar-ai-required">{{ lesson.attempt.preparation.failure.message }}</span>
        <v-btn
          v-if="setUpAiOffered" color="primary" variant="flat" rounded="pill" min-height="40" data-test="learning-step-bar-set-up-ai"
          @click="requestVibe64AiOnboarding()"
        >
          Set up your AI
        </v-btn>
      </div>
      <div v-else-if="!collapsed" class="vibe64-learning-step-bar__line">
        <span v-if="beats.length" class="vibe64-learning-step-bar__beat" aria-live="polite" data-test="learning-step-bar-beat">{{ beatText }}</span>
        <span v-else-if="step.required || status === 'passed'" class="vibe64-learning-step-bar__status" :class="`is-${status}`">
          {{ step.required ? statusLabel[status] : "Done" }}
        </span>
        <v-btn
          v-if="canDoIt" color="primary" variant="flat" rounded="pill" min-height="40" data-test="learning-step-bar-do-it"
          :loading="doing" @click="doItForMe"
        >
          {{ learning.doItForMeKind(beat) === "point" ? "Show me" : "Do it for me" }}
        </v-btn>
        <v-btn
          v-if="verdict" color="primary" variant="flat" rounded="pill" min-height="40" data-test="learning-step-bar-verdict"
          :disabled="Boolean(busy)" :loading="Boolean(verdict.busy) && busy === verdict.busy" @click="verdict.run()"
        >
          {{ verdict.label }}
        </v-btn>
        <v-btn
          v-if="stuckOffered" variant="tonal" rounded="pill" min-height="40" data-test="learning-step-bar-stuck"
          :class="{ 'vibe64-learning-step-bar__stuck--beside': canDoIt }"
          @click="askStuck"
        >
          I'm stuck
        </v-btn>
        <v-btn
          v-else-if="final && !verdict && index < steps.length - 1" color="primary" variant="tonal" rounded="pill" min-height="40"
          data-test="learning-step-bar-next-step" @click="forward"
        >
          Next step
        </v-btn>
        <v-btn
          v-if="!beats.length && step.guide && !ended" variant="tonal" rounded="pill" min-height="40"
          data-test="learning-step-bar-show-me" @click="showMe"
        >
          Show me
        </v-btn>
        <span v-if="reviewing && !beats.length" class="vibe64-learning-step-bar__note" role="status">Checking your work with your AI…</span>
        <span v-if="note" class="vibe64-learning-step-bar__note" role="status" data-test="learning-step-bar-note">{{ note }}</span>
        <v-btn
          v-if="setUpAiOffered" color="primary" variant="flat" rounded="pill" min-height="40" data-test="learning-step-bar-set-up-ai"
          @click="requestVibe64AiOnboarding()"
        >
          Set up your AI
        </v-btn>
      </div>
      <div v-if="!collapsed" class="vibe64-learning-step-bar__controls">
        <v-btn
          v-if="beat?.kind === 'show' && !aiRequired" :icon="player.paused ? mdiPlay : mdiPause" variant="text" size="small" min-width="40" min-height="40"
          :aria-label="player.paused ? 'Play' : 'Pause'" data-test="learning-step-bar-pause" @click="player.togglePause()"
        />
        <v-btn
          :icon="mdiChevronLeft" variant="text" size="small" min-width="40" min-height="40" :aria-label="beats.length ? 'Back' : 'Previous step'"
          :disabled="beats.length ? player.atStart : index <= 0" data-test="learning-step-bar-previous" @click="back"
        />
        <v-btn
          :icon="mdiChevronRight" variant="text" size="small" min-width="40" min-height="40" :aria-label="beats.length ? 'Next' : 'Next step'"
          :disabled="beats.length ? player.atEnd : index >= steps.length - 1" data-test="learning-step-bar-next" @click="forward"
        />
        <v-btn
          variant="tonal" rounded="pill" min-height="40" min-width="40" :prepend-icon="mdiMenu"
          class="vibe64-learning-step-bar__step-text" aria-controls="vibe64-learning-step-text" :aria-expanded="stepTextShown"
          aria-label="Step" data-test="learning-step-bar-step" @click="learning.setStepText(!learning.stepTextOpen)"
        >
          <span class="vibe64-learning-step-bar__step-text-label">Step</span>
          <v-icon class="vibe64-learning-step-bar__step-text-chevron" :icon="stepTextShown ? mdiChevronUp : mdiChevronDown" size="18" />
        </v-btn>
      </div>
      <v-btn
        variant="tonal" rounded="pill" min-height="40" min-width="40" :prepend-icon="mdiBookOpenPageVariantOutline"
        class="vibe64-learning-step-bar__courses" aria-label="Courses" data-test="learning-step-bar-courses" data-vibe64-guide="courses"
        @click="learning.openCourses('courses')"
      >
        <span class="vibe64-learning-step-bar__courses-label">Courses</span>
      </v-btn>
      <span
        v-if="!collapsed && beat?.kind === 'show' && !aiRequired" class="vibe64-learning-step-bar__progress" aria-hidden="true"
        :style="{ transform: `scaleX(${player.progress})` }"
      />
    </section>
    <section
      v-if="stepTextShown" id="vibe64-learning-step-text" class="vibe64-learning-step-bar__text-panel"
      aria-label="Step text" data-test="learning-step-bar-text"
    >
      <Vibe64LearningStep v-model:error="stepError" :learning="learning" />
    </section>
  </div>
</template>

<style scoped>
.vibe64-learning-step-bar-host { flex: 0 0 auto; min-width: 0; position: relative; }
.vibe64-learning-step-bar__text-panel {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--v64-learning-strong, #f5c518);
  border-radius: var(--v64-shape-md, 12px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  color: rgb(var(--v-theme-on-surface));
  left: 0;
  max-height: 60vh;
  overflow-y: auto;
  padding: var(--v64-space-4, 16px) var(--v64-space-5, 24px);
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
}
.vibe64-learning-step-bar {
  align-items: center;
  background: var(--v64-learning-container, rgba(245, 197, 24, 0.16));
  border: 1px solid var(--v64-learning-strong, #f5c518);
  border-radius: var(--v64-shape-md, 12px);
  color: var(--v64-on-learning-container, inherit);
  display: flex;
  flex: 0 0 auto;
  gap: var(--v64-space-2, 8px);
  min-width: 0;
  overflow: hidden;
  padding: 2px var(--v64-space-2, 8px) 2px 2px;
  position: relative;
}
.vibe64-learning-step-bar__toggle {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: 40px;
  justify-content: center;
  width: 40px;
}
.vibe64-learning-step-bar__toggle:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.vibe64-learning-step-bar__position {
  align-items: baseline;
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 0 var(--v64-space-2, 8px);
  min-width: 0;
}
.vibe64-learning-step-bar__lesson { font-weight: 700; max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-learning-step-bar__step { min-width: 0; overflow-wrap: anywhere; }
.vibe64-learning-step-bar__dots { align-self: center; display: inline-flex; gap: 4px; }
.vibe64-learning-step-bar__dot { border: 1.5px solid currentColor; border-radius: 50%; height: 8px; opacity: 0.55; width: 8px; }
.vibe64-learning-step-bar__dot.is-done { background: currentColor; }
.vibe64-learning-step-bar__dot.is-current { background: currentColor; opacity: 1; }
.vibe64-learning-step-bar__line { align-items: center; display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 2px var(--v64-space-2, 8px); min-width: 0; }
.vibe64-learning-step-bar__beat { flex: 1 1 12rem; font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
.vibe64-learning-step-bar__status { font-size: 0.8125rem; opacity: 0.8; }
.vibe64-learning-step-bar__status.is-passed { color: rgb(var(--v-theme-success)); opacity: 1; }
.vibe64-learning-step-bar__note { flex-basis: 100%; font-size: 0.8125rem; }
.vibe64-learning-step-bar__controls { align-items: center; display: flex; flex: 0 0 auto; gap: 2px; }
.vibe64-learning-step-bar__progress {
  background: var(--v64-learning-strong, #f5c518);
  bottom: 0;
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
  transform-origin: left center;
  transition: transform 100ms linear;
}
.vibe64-learning-step-bar .v-btn { letter-spacing: 0; text-transform: none; }

@media (prefers-reduced-motion: reduce) {
  .vibe64-learning-step-bar__progress { transition: none; }
}

/* A phone: line 1 is the position and controls, line 2 the beat and its one action. */
@media (max-width: 600px) {
  .vibe64-learning-step-bar { column-gap: 4px; flex-wrap: wrap; row-gap: 0; }
  .vibe64-learning-step-bar__step-text-chevron { display: none; }
  /* One action on the beat's line: I'm stuck stays in Step beside Do it for me. */
  .vibe64-learning-step-bar__stuck--beside { display: none; }
  .vibe64-learning-step-bar__lesson { display: none; }
  .vibe64-learning-step-bar--beats .vibe64-learning-step-bar__position { flex: 1 1 auto; }
  .vibe64-learning-step-bar--beats .vibe64-learning-step-bar__line { flex-basis: 100%; order: 3; padding: 0 0 6px 8px; }
  .vibe64-learning-step-bar__courses { padding-inline: 0; }
  .vibe64-learning-step-bar__courses :deep(.v-btn__prepend) { margin-inline: 0; }
  .vibe64-learning-step-bar__courses-label, .vibe64-learning-step-bar__step-text-label { display: none; }
  .vibe64-learning-step-bar__step-text { padding-inline: 4px; }
  .vibe64-learning-step-bar__step-text :deep(.v-btn__prepend) { margin-inline: 0; }
  .vibe64-learning-step-bar__text-panel { padding: var(--v64-space-3, 12px); }
}
</style>
