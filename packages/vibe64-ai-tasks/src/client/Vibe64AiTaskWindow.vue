<template>
  <v-dialog
    :aria-labelledby="titleId"
    :fullscreen="fit.fullscreen"
    :height="fit.height"
    :model-value="source.open"
    no-click-animation
    persistent
    :width="fit.width"
    :transition="reducedMotion ? false : undefined"
    @after-enter="focusTitle"
    @after-leave="returnFocus"
    @keydown.esc.stop.prevent="escape"
  >
    <section
      :aria-labelledby="titleId"
      class="ai-task"
      :class="{ 'ai-task--fullscreen': fit.fullscreen, 'ai-task--ended': projection.ended }"
      data-vibe64-ai-task
      :data-vibe64-ai-task-phase="task.phase"
      :data-vibe64-ai-task-reason="task.reason"
    >
      <header class="ai-task__header">
        <v-btn
          v-if="fit.phone && !projection.ended"
          :aria-label="WORDS.actions.hide"
          class="ai-task__back"
          data-vibe64-ai-task-hide
          :icon="mdiArrowLeft"
          variant="text"
          @click="source.hide"
        />
        <span class="ai-task__glyph" :class="`ai-task__glyph--${projection.glyph}`" aria-hidden="true">
          <v-progress-circular v-if="projection.glyph === 'working'" :indeterminate="!reducedMotion" :model-value="reducedMotion ? 60 : undefined" size="20" width="2" />
          <v-icon v-else :icon="glyphIcons[projection.glyph]" size="22" />
        </span>
        <div class="ai-task__heading">
          <h2 :id="titleId" ref="title" tabindex="-1">{{ projection.ended ? projection.outcome.heading : task.title }}</h2>
          <p aria-live="polite" class="ai-task__status" data-vibe64-ai-task-status>
            {{ projection.ended ? task.title : projection.status }}
          </p>
        </div>
        <Vibe64AiTaskRename v-if="renamable" :title="task.title" @rename="rename" />
        <div v-if="!projection.ended" class="ai-task__commands">
          <v-btn v-if="!fit.phone" data-vibe64-ai-task-hide variant="text" @click="source.hide">{{ WORDS.actions.hide }}</v-btn>
          <v-btn
            :aria-busy="cancelling ? 'true' : undefined"
            data-vibe64-ai-task-cancel
            variant="text"
            @click="requestCancel"
          >
            {{ cancelling ? WORDS.actions.cancelling : WORDS.actions.cancel }}
          </v-btn>
        </div>
      </header>

      <template v-if="!projection.ended">
        <div class="ai-task__problem">
          <span class="ai-task__problem-line" :title="task.problem.summary">{{ task.problem.summary }}</span>
          <button
            v-if="task.problem.details"
            :aria-expanded="detailsOpen ? 'true' : 'false'"
            :aria-label="WORDS.actions.details"
            class="ai-task__details-toggle"
            data-vibe64-ai-task-details
            type="button"
            @click="detailsOpen = !detailsOpen"
          >
            <span class="ai-task__details-word">{{ WORDS.actions.details }}</span>
            <v-icon :icon="detailsOpen ? mdiChevronUp : mdiChevronDown" size="18" aria-hidden="true" />
          </button>
        </div>
        <pre v-if="detailsOpen" class="ai-task__details" data-vibe64-ai-task-details-text tabindex="0">{{ task.problem.details }}</pre>

        <div
          :aria-label="WORDS.views.label"
          class="ai-task__views"
          role="tablist"
          @keydown="moveBetweenViews"
        >
          <button
            v-for="tab in tabs"
            :id="`${titleId}-${tab.id}-tab`"
            :key="tab.id"
            :ref="element => setTab(tab.id, element)"
            :aria-controls="`${titleId}-${tab.id}`"
            :aria-selected="source.view === tab.id ? 'true' : 'false'"
            class="ai-task__view"
            :class="{ 'ai-task__view--selected': source.view === tab.id }"
            :data-vibe64-ai-task-view="tab.id"
            role="tab"
            :tabindex="source.view === tab.id ? 0 : -1"
            type="button"
            @click="source.setView(tab.id)"
          >
            {{ tab.label }}
            <span v-if="tab.id === 'chat' && projection.chatDot" class="ai-task__dot" role="img" :aria-label="WORDS.views.waiting" />
          </button>
        </div>
      </template>

      <div class="ai-task__body">
        <template v-if="!projection.ended">
          <section
            v-show="source.view === 'progress'"
            :id="`${titleId}-progress`"
            :aria-labelledby="`${titleId}-progress-tab`"
            class="ai-task__panel"
            role="tabpanel"
          >
            <Vibe64AiTaskProgress :commentary="commentary" :output="output" :projection="projection" :task="task">
              <template #check-output><slot name="check-output" /></template>
            </Vibe64AiTaskProgress>
          </section>
        </template>
        <Vibe64AiTaskOutcome
          v-else-if="!source.transcriptOpen"
          :projection="projection"
          :task="task"
          @see-conversation="source.setTranscript(true)"
        />
        <section
          v-show="!projection.ended ? source.view === 'chat' : source.transcriptOpen"
          :id="`${titleId}-chat`"
          :aria-labelledby="projection.ended ? undefined : `${titleId}-chat-tab`"
          class="ai-task__panel"
          :role="projection.ended ? undefined : 'tabpanel'"
        >
          <slot name="chat" :visible="source.open && (projection.ended ? source.transcriptOpen : source.view === 'chat')" />
        </section>
      </div>

      <p v-if="source.error" class="ai-task__error" role="alert">{{ source.error }}</p>

      <footer v-if="confirmingCancel" class="ai-task__footer ai-task__footer--question">
        <p>{{ projection.cancelQuestion }}</p>
        <div class="ai-task__actions">
          <v-btn data-vibe64-ai-task-keep-going variant="text" @click="confirmingCancel = false">{{ WORDS.actions.keepGoing }}</v-btn>
          <v-btn color="error" data-vibe64-ai-task-cancel-confirm variant="flat" @click="cancel">{{ WORDS.cancelConfirm(task.noun) }}</v-btn>
        </div>
      </footer>
      <footer v-else-if="projection.ended" class="ai-task__footer">
        <div class="ai-task__actions">
          <v-btn v-if="source.transcriptOpen" variant="text" @click="source.setTranscript(false)">{{ WORDS.outcome.backToResult }}</v-btn>
          <v-btn
            :aria-busy="source.closing ? 'true' : undefined"
            color="primary"
            data-vibe64-ai-task-close
            variant="flat"
            @click="source.close"
          >
            {{ source.closing ? WORDS.actions.closing : WORDS.actions.close }}
          </v-btn>
        </div>
      </footer>
      <footer v-else-if="footerActions.length" class="ai-task__footer">
        <div class="ai-task__actions">
          <v-btn
            v-for="item in footerActions"
            :key="item.id"
            :color="item.primary ? 'primary' : undefined"
            :data-vibe64-ai-task-action="item.id"
            :variant="item.primary ? 'flat' : 'text'"
            @click="source.run(item.id)"
          >
            {{ item.label }}
          </v-btn>
        </div>
      </footer>
    </section>
  </v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, useId, watch } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiAlertCircle,
  mdiArrowLeft,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiCircleOutline,
  mdiCloseCircle
} from "@mdi/js";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";
import { aiTaskFit } from "./aiTaskFit.js";
import { aiTaskFooterActions, aiTaskOffersRename } from "./aiTaskProjection.js";
import { useAiTaskFocus } from "./useAiTaskFocus.js";
import Vibe64AiTaskOutcome from "./Vibe64AiTaskOutcome.vue";
import Vibe64AiTaskProgress from "./Vibe64AiTaskProgress.vue";
import Vibe64AiTaskRename from "./Vibe64AiTaskRename.vue";

const props = defineProps({
  source: {
    required: true,
    type: /** @type {import("vue").PropType<import("./types.js").AiTaskSource>} */ (Object)
  },
  commentary: {
    required: true,
    type: /** @type {import("vue").PropType<{ at: string, text: string }[]>} */ (Array)
  },
  // Whether the task has check output to show under Progress.
  output: {
    required: true,
    type: Boolean
  }
});

const glyphIcons = {
  attention: mdiAlertCircle,
  done: mdiCheckCircle,
  "not-done": mdiCloseCircle,
  turn: mdiCircleOutline
};
const titleId = useId();
const title = ref(null);
const task = computed(() => props.source.task);
const projection = computed(() => props.source.projection);
const footerActions = computed(() => aiTaskFooterActions(projection.value.actions, props.source.view));
const { width, height } = useDisplay();
const fit = computed(() => aiTaskFit(width.value, height.value));
const detailsOpen = ref(false);
const confirmingCancel = ref(false);
const cancelling = computed(() => props.source.cancelRequested || task.value.phase === "cancelling");
const renamable = computed(() => aiTaskOffersRename(projection.value, props.source));
const tabs = [{ id: "progress", label: WORDS.views.progress }, { id: "chat", label: WORDS.views.chat }];
const { focusTitle, moveBetweenViews, reducedMotion, returnFocus, setTab } = useAiTaskFocus({
  title,
  views: tabs.map(tab => tab.id),
  selectedView: () => props.source.view,
  setView: view => props.source.setView(view),
  returnFocusTarget: () => props.source.returnFocusTarget()
});

/** Cancel asks once. While a cancel is already on its way, pressing it again repeats the request. */
function requestCancel() {
  if (cancelling.value) void props.source.cancel();
  else confirmingCancel.value = true;
}

function cancel() {
  confirmingCancel.value = false;
  void props.source.cancel();
}

/** @param {string} name */
function rename(name) {
  void props.source.rename(name);
}

function escape() {
  if (projection.value.ended) void props.source.close();
  else props.source.hide();
}

// The outcome replaces the views and takes focus, because everything the person was on has gone.
watch(() => projection.value.ended, async (ended) => {
  if (!ended) return;
  confirmingCancel.value = false;
  await nextTick();
  focusTitle();
});
</script>

<style scoped src="./Vibe64AiTaskWindow.css"></style>
