<template>
  <article
    class="tool-row"
    :class="[`tool-row--${state}`, { 'tool-row--flat': flat, 'tool-row--optional': optional, 'tool-row--folded': folded }]"
    :data-tool-row="tool.id || tool.name"
  >
    <div class="tool-row__icon" aria-hidden="true">
      <v-progress-circular v-if="checking && state !== 'ready'" indeterminate size="18" width="2" />
      <v-icon v-else :icon="icon" size="20" />
    </div>

    <div class="tool-row__body">
      <div class="tool-row__heading">
        <strong class="tool-row__title">{{ title }}</strong>
        <span v-if="state === 'ready' && foundPath" class="tool-row__path" :title="foundPath">{{ foundPath }}</span>
        <span v-else-if="foldable" class="tool-row__aside">Not installed</span>
        <v-btn
          v-if="foldable"
          :aria-controls="fixId"
          :aria-expanded="String(open)"
          :aria-label="`How to install ${tool.name}`"
          class="tool-row__toggle"
          color="primary"
          density="comfortable"
          :append-icon="open ? mdiChevronUp : mdiChevronDown"
          variant="text"
          @click="open = !open"
        >
          {{ open ? "Hide" : "How to install" }}
        </v-btn>
      </div>

      <v-expand-transition>
        <div v-if="state !== 'ready' && (!foldable || open)" :id="fixId" class="tool-row__fix">
          <p class="tool-row__sentence" :class="{ 'tool-row__sentence--feedback': feedback }" aria-live="polite">{{ feedback || sentence }}</p>

          <Vibe64CopyCommand v-if="command" :command="command" :label="`Copy the command that installs ${tool.name}`" />
          <p v-if="tool.install?.note" class="tool-row__note">
            <v-icon :icon="mdiLockOutline" size="14" />
            {{ tool.install.note }}
          </p>

          <div class="tool-row__actions">
            <v-btn
              class="tool-row__check"
              color="primary"
              :loading="checking"
              :prepend-icon="mdiRefresh"
              rounded="pill"
              variant="tonal"
              @click="check"
            >
              Check again
            </v-btn>
            <v-btn
              v-if="tool.guideUrl"
              class="tool-row__other"
              color="primary"
              :append-icon="mdiOpenInNew"
              :href="tool.guideUrl"
              rel="noopener"
              rounded="pill"
              target="_blank"
              variant="text"
            >
              Other ways<span class="d-sr-only"> (opens in a new tab)</span>
            </v-btn>
          </div>
        </div>
      </v-expand-transition>
    </div>
  </article>
</template>

<script setup>
// One tool on this computer: what was found, or one sentence, the one command
// that installs it here, and Check again. Rows only appear where a step needs
// the tool; nothing here runs an installer.
import { computed, ref, useId, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiLockOutline,
  mdiMinusCircleOutline,
  mdiOpenInNew,
  mdiRefresh
} from "@mdi/js";
import Vibe64CopyCommand from "@/components/common/Vibe64CopyCommand.vue";

const props = defineProps({
  // { id, name, status: "ready" | "missing" | "broken", path, version, detail, install: { command, note }, guideUrl }
  tool: { type: Object, required: true },
  checking: Boolean,
  // Inside a list that already draws its own surface.
  flat: Boolean,
  // Nice to have: a missing tool reads as calm, not as a problem, and its
  // install line stays folded until the person asks for it.
  optional: Boolean
});
const fixId = `tool-row-fix-${useId()}`;
const open = ref(false);
const emit = defineEmits(["check"]);

const state = computed(() => (["ready", "broken"].includes(props.tool.status) ? props.tool.status : "missing"));
const foldable = computed(() => props.optional && state.value === "missing");
const folded = computed(() => foldable.value && !open.value);
const plural = computed(() => /s$/u.test(props.tool.name || ""));
const title = computed(() => {
  const name = props.tool.name || "This tool";
  if (state.value === "ready") return [name, props.tool.version].filter(Boolean).join(" ");
  if (state.value === "broken") return `${name} didn't start`;
  if (foldable.value) return name;
  return `${name} ${plural.value ? "aren't" : "isn't"} installed on this computer`;
});
const foundPath = computed(() => String(props.tool.path || ""));
const command = computed(() => String(props.tool.install?.command || ""));
const sentence = computed(() => {
  const lead = state.value === "broken" && foundPath.value
    ? `Vibe64 found it at ${foundPath.value}, but it didn't run.`
    : props.tool.detail || "";
  const how = command.value
    ? "Paste this into a terminal on this computer, then choose Check again."
    : "Install it the way that suits your computer, then choose Check again.";
  return [lead, how].filter(Boolean).join(" ");
});
const icon = computed(() => {
  if (state.value === "ready") return mdiCheckCircle;
  return props.optional && state.value === "missing" ? mdiMinusCircleOutline : mdiAlertCircleOutline;
});

// "Check again" always answers: either the row turns ready, or it says so here.
const feedback = ref("");
const asked = ref(false);
function check() {
  asked.value = true;
  feedback.value = "";
  emit("check");
}
watch(() => props.checking, (now, before) => {
  if (!before || now || !asked.value) return;
  asked.value = false;
  feedback.value = state.value === "ready" ? "" : "Still not found. Did the command finish without errors?";
});
</script>

<style scoped>
.tool-row {
  align-items: start;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-md, 12px);
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: 20px minmax(0, 1fr);
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  transition: background-color var(--v64-duration-medium) var(--v64-ease-standard),
    border-color var(--v64-duration-medium) var(--v64-ease-standard);
}

.tool-row--flat {
  background: transparent;
  border-block-width: 0;
  border-color: transparent;
  border-inline-width: 0;
  border-radius: 0;
  padding-inline: 0;
}

.tool-row--missing:not(.tool-row--flat),
.tool-row--broken:not(.tool-row--flat) {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 6%, rgb(var(--v-theme-surface)));
  border-color: color-mix(in srgb, rgb(var(--v-theme-warning)) 28%, transparent);
}

.tool-row__icon {
  align-items: center;
  display: flex;
  height: 24px;
  justify-content: center;
}

.tool-row--ready .tool-row__icon { color: var(--v64-success); }
.tool-row--missing .tool-row__icon,
.tool-row--broken .tool-row__icon { color: rgb(var(--v-theme-warning)); }

.tool-row__body {
  display: grid;
  gap: var(--v64-space-2, 8px);
  min-width: 0;
}

.tool-row__heading {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--v64-space-2, 8px);
  min-height: 24px;
  min-width: 0;
}

.tool-row__aside {
  color: var(--v64-on-surface-variant);
  font-size: 0.8125rem;
}

/* A folded row is one line: name, "Not installed", and the toggle at the end. */
.tool-row--optional.tool-row--missing .tool-row__heading { flex-wrap: nowrap; }
.tool-row--optional.tool-row--missing .tool-row__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The toggle's height never moves the row. */
.tool-row__toggle {
  align-self: center;
  flex: none;
  margin-block: -8px;
  margin-inline: auto -8px;
}

.tool-row__toggle,
.tool-row__other {
  font-size: 0.875rem;
  font-weight: 500;
}

@media (max-width: 599px) {
  /* Still read aloud; the folded icon shows it on a narrow screen. */
  .tool-row__aside {
    clip: rect(0 0 0 0);
    height: 1px;
    overflow: hidden;
    position: absolute;
    width: 1px;
  }
}

.tool-row__title {
  font: var(--v64-type-title-md);
  font-size: 0.9375rem;
  font-weight: 600;
}

.tool-row__path {
  color: var(--v64-on-surface-variant);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-row__fix {
  display: grid;
  gap: var(--v64-space-2, 8px);
}

.tool-row__sentence,
.tool-row__note {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.tool-row__note {
  align-items: center;
  display: flex;
  font-size: 0.8125rem;
  gap: 6px;
}

.tool-row__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px);
  padding-top: 2px;
}

.tool-row__sentence--feedback { color: var(--v64-on-surface); }

.tool-row--optional.tool-row--missing .tool-row__icon { color: var(--v64-on-surface-variant); }
</style>
