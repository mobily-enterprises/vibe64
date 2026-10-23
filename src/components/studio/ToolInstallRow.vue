<template>
  <article
    class="tool-row"
    :class="[`tool-row--${state}`, { 'tool-row--flat': flat }]"
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
      </div>

      <v-expand-transition>
        <div v-if="state !== 'ready'" class="tool-row__fix">
          <p class="tool-row__sentence">{{ sentence }}</p>

          <div v-if="command" class="tool-row__command">
            <code><span class="tool-row__prompt" aria-hidden="true">$</span>{{ command }}</code>
            <v-btn
              :aria-label="copied ? 'Copied' : `Copy the command that installs ${tool.name}`"
              class="tool-row__copy"
              :color="copied ? 'success' : undefined"
              density="comfortable"
              :prepend-icon="copied ? mdiCheck : mdiContentCopy"
              size="small"
              variant="text"
              @click="copy"
            >
              {{ copied ? "Copied" : "Copy" }}
            </v-btn>
          </div>
          <p v-if="tool.install?.note" class="tool-row__note">
            <v-icon :icon="mdiLockOutline" size="14" />
            {{ tool.install.note }}
          </p>

          <div class="tool-row__actions">
            <v-btn
              class="tool-row__check"
              :loading="checking"
              :prepend-icon="mdiRefresh"
              rounded="pill"
              size="small"
              variant="tonal"
              @click="check"
            >
              Check again
            </v-btn>
            <a v-if="tool.guideUrl" class="tool-row__other" :href="tool.guideUrl" rel="noopener" target="_blank">
              Other ways
              <v-icon :icon="mdiOpenInNew" size="13" />
            </a>
            <span class="tool-row__feedback" aria-live="polite">{{ feedback }}</span>
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
import { computed, ref, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiCheckCircle,
  mdiContentCopy,
  mdiLockOutline,
  mdiOpenInNew,
  mdiRefresh
} from "@mdi/js";

const props = defineProps({
  // { id, name, status: "ready" | "missing" | "broken", path, version, detail, install: { command, note }, guideUrl }
  tool: { type: Object, required: true },
  checking: Boolean,
  // Inside a list that already draws its own surface.
  flat: Boolean
});
const emit = defineEmits(["check"]);

const state = computed(() => (["ready", "broken"].includes(props.tool.status) ? props.tool.status : "missing"));
const plural = computed(() => /s$/u.test(props.tool.name || ""));
const title = computed(() => {
  const name = props.tool.name || "This tool";
  if (state.value === "ready") return [name, props.tool.version].filter(Boolean).join(" ");
  if (state.value === "broken") return `${name} didn't start`;
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
const icon = computed(() => (state.value === "ready" ? mdiCheckCircle : mdiAlertCircleOutline));

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

const copied = ref(false);
let copiedTimer = 0;
watch(command, () => { copied.value = false; });
async function copy() {
  try {
    await navigator.clipboard.writeText(command.value);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    copied.value = false;
  }
}
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
  border-color: transparent;
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

.tool-row__title {
  font: var(--v64-type-title-md);
  font-size: 0.9375rem;
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

.tool-row__command {
  align-items: center;
  background: var(--v64-surface-container-highest);
  border-radius: var(--v64-shape-sm, 8px);
  display: flex;
  gap: var(--v64-space-2, 8px);
  padding: 6px 6px 6px 12px;
}

.tool-row__command code {
  background: none;
  color: var(--v64-on-surface);
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.45;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 0;
  user-select: all;
  white-space: pre-wrap;
}

.tool-row__prompt {
  color: var(--v64-on-surface-variant);
  margin-right: 0.6em;
  user-select: none;
}

.tool-row__copy { flex: none; }

.tool-row__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px) var(--v64-space-4, 16px);
  padding-top: 2px;
}

.tool-row__other {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: 4px;
  text-decoration: none;
}

.tool-row__other:hover { text-decoration: underline; }

.tool-row__feedback {
  color: var(--v64-on-surface-variant);
  font-size: 0.8125rem;
}
</style>
