<script setup>
import { computed, onScopeDispose, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { VMenu } from "vuetify/components/VMenu";
import { mdiAlertCircleOutline, mdiClose, mdiInformationOutline, mdiOpenInNew, mdiStop } from "@mdi/js";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { usageRecordingEnd, usageRecordingFailure } from "./usageRecordingText.js";
import { useVibe64UsageRecording } from "./useVibe64UsageRecording.js";

// Rendered into the project header for the selected session, or on a phone
// into a full-width strip below it. Emits open-usage { recordingId } when the
// person opens the results.
const props = defineProps({
  sessionId: { type: String, required: true }
});
const emit = defineEmits(["open-usage"]);

// A finished recording stays in the header this long unless dismissed.
const READY_FOR_MS = 10 * 60 * 1000;
const WIDE_HOST_PX = 340;
// Only these changes are announced; the ticking time never is.
const ANNOUNCEMENTS = Object.freeze({
  starting: "",
  recording: "Recording started",
  stopped: "Recording stopped",
  failed: "Recording failed"
});

const feedback = useShellWebErrorRuntime();
const { width: viewportWidth } = useDisplay();
const { recording, active, elapsedMs, error, stop, dismiss } = useVibe64UsageRecording({
  sessionId: () => props.sessionId
});

// The indicator fills its host, which takes its width from the header, so
// that width decides wide or compact. A phone shows it as a strip, which has
// the full width and opens the results itself, without a menu.
const root = ref(null);
const narrowHost = ref(false);
watch(root, (element, _previous, onCleanup) => {
  if (!element || typeof ResizeObserver !== "function") return;
  const observer = new ResizeObserver(([entry]) => {
    narrowHost.value = entry.contentRect.width < WIDE_HOST_PX;
  });
  observer.observe(element);
  onCleanup(() => observer.disconnect());
});
const phone = computed(() => viewportWidth.value <= 600);
const compact = computed(() => narrowHost.value && !phone.value);

const expired = ref(false);
let expiry = null;
watch(() => ["stopped", "failed", "unavailable"].includes(recording.value?.state) ? recording.value.stoppedAt || "" : "",
  (stoppedAt) => {
    clearTimeout(expiry);
    const remaining = stoppedAt ? Date.parse(stoppedAt) + READY_FOR_MS - Date.now() : Infinity;
    expired.value = remaining <= 0;
    if (remaining > 0 && Number.isFinite(remaining)) expiry = setTimeout(() => { expired.value = true; }, remaining);
  }, { immediate: true });
onScopeDispose(() => clearTimeout(expiry));

// none | starting | recording | stopping | stopped | failed
const shown = computed(() => {
  const current = recording.value;
  if (!current || current.dismissedAt || expired.value) return "";
  return current.state === "unavailable" ? "failed" : current.state || "";
});
const busy = computed(() => ["starting", "stopping"].includes(shown.value));

function formatElapsed(ms = 0) {
  const total = Math.floor(ms / 1000);
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

const elapsedText = computed(() => formatElapsed(elapsedMs.value));
const count = computed(() => Number(recording.value?.counts?.requests) || 0);
const countText = computed(() => {
  const noun = recording.value?.target?.kind === "terminal" ? "run" : "request";
  return `${count.value.toLocaleString("en-US")} ${noun}${count.value === 1 ? "" : "s"}`;
});
const pillText = computed(() => {
  const short = compact.value;
  switch (shown.value) {
    case "starting": return short ? "Starting…" : "Starting recording…";
    case "recording": return short ? `${elapsedText.value} · ${count.value}` : `Recording ${elapsedText.value} · ${countText.value}`;
    case "stopping": return "Stopping…";
    case "stopped": return short ? `Ready · ${count.value}` : `Recording ready · ${countText.value}`;
    case "failed": return short ? "Failed" : "Recording failed";
    default: return "";
  }
});
const targetLabel = computed(() => recording.value?.target?.label || "Recording");
const failureReason = computed(() => usageRecordingFailure(recording.value));
const statusText = computed(() => ({
  starting: "Starting…",
  recording: "Recording",
  stopping: "Stopping…",
  stopped: `Ready. ${usageRecordingEnd(recording.value)}.`,
  failed: `Recording failed. ${failureReason.value}`
})[shown.value] || "");

const announcement = ref("");
watch(() => shown.value && `${recording.value.id}:${shown.value}`, () => {
  const next = ANNOUNCEMENTS[shown.value];
  if (next !== undefined) announcement.value = next;
});

const menuOpen = ref(false);
const detailsOpen = ref(false);
// The next recording's pill starts closed.
watch(shown, (state) => {
  if (state) return;
  menuOpen.value = false;
  detailsOpen.value = false;
});

function report(action) {
  if (error.value) {
    feedback.report({ source: `vibe64.usage-recording.${action}`, intent: "action-feedback",
      severity: "error", channel: "snackbar", message: error.value });
  }
}

async function stopRecording() {
  if (!await stop()) report("stop");
}

async function dismissRecording() {
  menuOpen.value = false;
  detailsOpen.value = false;
  if (!await dismiss()) report("dismiss");
}

function openResults() {
  const current = recording.value;
  if (!current) return;
  menuOpen.value = false;
  emit("open-usage", { recordingId: current.id });
  if (current.state === "stopped") void dismiss();
}

// The phone strip's own tap: the results, or why the recording failed.
function openFromStrip() {
  if (shown.value === "failed") detailsOpen.value = true;
  else openResults();
}
</script>

<template>
  <div
    ref="root"
    class="usage-recording-indicator"
    :class="{ 'usage-recording-indicator--compact': compact, 'usage-recording-indicator--strip': phone }"
  >
    <span class="usage-recording-indicator__hidden" role="status" aria-live="polite">{{ announcement }}</span>
    <div
      v-if="shown"
      class="usage-recording-indicator__pill"
      :class="`usage-recording-indicator__pill--${shown}`"
    >
      <v-menu
        v-model="menuOpen"
        :close-on-content-click="false"
        :disabled="phone"
        location="bottom end"
        max-width="360"
      >
        <template #activator="{ props: activatorProps }">
          <button
            v-bind="phone ? { onClick: openFromStrip } : activatorProps"
            class="usage-recording-indicator__body"
            type="button"
            :aria-haspopup="phone ? undefined : 'dialog'"
          >
            <v-progress-circular v-if="busy" indeterminate :size="16" :width="2" />
            <span v-else-if="shown === 'recording'" class="usage-recording-indicator__dot" aria-hidden="true" />
            <v-icon v-else-if="shown === 'failed'" :icon="mdiAlertCircleOutline" size="18" />
            <span v-if="!pillText.includes('Recording')" class="usage-recording-indicator__hidden">Recording: </span>
            <span class="usage-recording-indicator__text">{{ pillText }}</span>
            <span v-if="phone" class="usage-recording-indicator__hidden">, {{ shown === 'failed' ? 'show details' : 'open results' }}</span>
          </button>
        </template>
        <v-card class="usage-recording-indicator__menu" rounded="lg" role="dialog" aria-label="Recording">
          <v-card-title class="usage-recording-indicator__menu-title">{{ targetLabel }}</v-card-title>
          <v-card-text>
            <p class="usage-recording-indicator__menu-status">{{ statusText }}</p>
            <p v-if="shown !== 'failed'">{{ elapsedText }} · {{ countText }}</p>
          </v-card-text>
          <v-card-actions>
            <v-btn v-if="shown === 'failed'" variant="text" @click="dismissRecording">Dismiss</v-btn>
            <v-btn v-else variant="text" @click="openResults">Open results</v-btn>
            <v-btn
              v-if="active"
              color="error"
              :prepend-icon="mdiStop"
              variant="tonal"
              @click="stopRecording"
            >
              Stop recording
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>

      <template v-if="active">
        <v-btn
          v-if="compact"
          aria-label="Stop recording"
          class="usage-recording-indicator__action"
          :icon="mdiStop"
          size="small"
          variant="tonal"
          @click="stopRecording"
        />
        <v-btn
          v-else
          aria-label="Stop recording"
          class="usage-recording-indicator__action"
          :prepend-icon="mdiStop"
          rounded="pill"
          size="small"
          :variant="phone ? 'text' : 'tonal'"
          @click="stopRecording"
        >
          Stop
        </v-btn>
      </template>
      <template v-else-if="shown === 'stopped'">
        <v-btn
          v-if="compact"
          aria-label="Open results"
          class="usage-recording-indicator__action"
          :icon="mdiOpenInNew"
          size="small"
          variant="text"
          @click="openResults"
        />
        <v-btn v-else class="usage-recording-indicator__action" size="small" variant="text" @click="openResults">
          Open
        </v-btn>
      </template>
      <template v-else-if="shown === 'failed'">
        <v-btn
          v-if="compact"
          aria-label="Recording failure details"
          class="usage-recording-indicator__action"
          :icon="mdiInformationOutline"
          size="small"
          variant="text"
          @click="detailsOpen = true"
        />
        <v-btn v-else class="usage-recording-indicator__action" size="small" variant="text" @click="detailsOpen = true">
          Details
        </v-btn>
      </template>
      <v-btn
        v-if="shown === 'stopped' || shown === 'failed'"
        aria-label="Dismiss recording"
        class="usage-recording-indicator__action"
        :icon="mdiClose"
        size="small"
        variant="text"
        @click="dismissRecording"
      />

      <v-dialog v-model="detailsOpen" max-width="440">
        <v-card rounded="lg" title="Recording failed">
          <v-card-text>{{ failureReason }}</v-card-text>
          <v-card-actions>
            <v-btn variant="text" @click="detailsOpen = false">Close</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </div>
  </div>
</template>

<style scoped>
.usage-recording-indicator {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 100%;
  min-width: 0;
}

.usage-recording-indicator__hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.usage-recording-indicator__pill {
  display: flex;
  align-items: center;
  gap: var(--v64-space-1);
  min-width: 0;
  max-width: 100%;
  padding-inline: var(--v64-space-1);
  border-radius: var(--v64-shape-full);
  background: var(--v64-surface-container-high);
  color: var(--v64-on-surface);
}

.usage-recording-indicator__pill--recording,
.usage-recording-indicator__pill--failed {
  background: var(--v64-error-container);
}

.usage-recording-indicator__pill--stopped {
  background: var(--v64-secondary-container);
  color: var(--v64-on-secondary-container);
}

.usage-recording-indicator__pill--failed .v-icon {
  color: var(--v64-error);
}

.usage-recording-indicator__body {
  display: flex;
  align-items: center;
  gap: var(--v64-space-2);
  min-width: 0;
  min-height: 32px;
  padding-inline: var(--v64-space-2);
  border: 0;
  border-radius: var(--v64-shape-full);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: var(--v64-type-label-lg);
}

.usage-recording-indicator__body:hover {
  background: color-mix(in srgb, currentColor var(--v64-state-hover), transparent);
}

.usage-recording-indicator__body:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

.usage-recording-indicator__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.usage-recording-indicator__dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: var(--v64-shape-full);
  background: var(--v64-error);
  animation: usage-recording-pulse 1.6s var(--v64-ease-standard) infinite;
}

.usage-recording-indicator__menu-title {
  font: var(--v64-type-title-md);
}

.usage-recording-indicator__menu-status {
  color: var(--v64-on-surface-variant);
}

/* The phone strip: a full-width tonal band with 48 px targets; its actions
   are text buttons, as on an M3 banner. */
.usage-recording-indicator--strip .usage-recording-indicator__pill {
  flex: 1 1 auto;
  min-height: 48px;
  padding-inline: var(--v64-space-2);
  border-radius: 0;
}

.usage-recording-indicator--strip .usage-recording-indicator__body {
  flex: 1 1 auto;
  min-height: 48px;
}

.usage-recording-indicator--strip .usage-recording-indicator__action {
  min-width: 48px;
  min-height: 48px;
}

@keyframes usage-recording-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .usage-recording-indicator__dot {
    animation: none;
  }
}

@media (pointer: coarse) {
  .usage-recording-indicator__body,
  .usage-recording-indicator__action {
    min-width: 48px;
    min-height: 48px;
  }
}
</style>
