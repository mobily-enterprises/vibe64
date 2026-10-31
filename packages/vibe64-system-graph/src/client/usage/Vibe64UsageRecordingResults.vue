<template>
  <section class="usage-recordings" aria-label="Recordings">
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mx-1">
      {{ error }}
      <template #append><v-btn variant="text" size="small" @click="emit('retry')">Retry</v-btn></template>
    </v-alert>
    <div v-else-if="loading && !recordings.length" aria-busy="true" aria-label="Loading recordings">
      <v-skeleton-loader v-for="row in 4" :key="row" type="list-item-two-line" />
    </div>
    <div v-else-if="!recordings.length" class="usage-recordings__empty" role="status">
      <p v-if="unavailable.length" class="text-body-medium">
        Recording not available for this project's runtimes (<code>{{ unavailable.join('`, `') }}</code>). Imports and Calls still work.
      </p>
      <p v-else class="text-body-medium">No recordings yet. Use Record to capture what runs, then pick a request here.</p>
    </div>
    <template v-else>
      <v-select
        :model-value="recordingId"
        :items="recordingItems"
        label="Recording"
        variant="outlined"
        density="comfortable"
        hide-details
        class="usage-recordings__select"
        @update:model-value="emit('update:recordingId', $event)"
      />
      <Vibe64UsageRecordingSummary v-if="selectedRecording && sessionId" :recording="selectedRecording" :session-id="sessionId" @deleted="emit('deleted', $event)" />
      <v-text-field
        :model-value="search"
        label="Search requests"
        :prepend-inner-icon="mdiMagnify"
        variant="outlined"
        density="comfortable"
        maxlength="80"
        clearable
        hide-details
        @update:model-value="emit('update:search', $event || '')"
      />
      <v-switch
        :model-value="includeEmpty"
        color="primary"
        density="compact"
        inset
        hide-details
        label="Show requests that ran no project code"
        class="usage-recordings__switch"
        @update:model-value="emit('update:includeEmpty', Boolean($event))"
      />
      <p v-if="selectedRecording?.state === 'recording'" class="usage-recordings__live text-body-small" role="status">Recording now. New requests appear as they finish.</p>
      <v-alert v-if="selectedRecording?.requestLog?.full" type="warning" variant="tonal" density="compact">
        Request log full; later requests not recorded
      </v-alert>
      <p v-if="includeEmpty && selectedRecording?.requestLog?.assets" class="usage-recordings__live text-body-small">
        {{ countLabel(selectedRecording.requestLog.assets, 'script, style, image or font load') }} counted, not listed.
      </p>
      <v-alert v-if="selectedRecording?.target?.kind === 'web' && onlyBackground(requests)" type="info" variant="tonal" density="compact" class="usage-recordings__shared">
        {{ BACKGROUND_TEXT }}: its requests share one process, so this recording shows everything that ran while it recorded.
      </v-alert>
      <div v-if="requestsLoading && !groups.length" aria-busy="true" aria-label="Loading requests">
        <v-skeleton-loader v-for="row in 4" :key="row" type="list-item-two-line" />
      </div>
      <p v-else-if="!groups.length" class="usage-recordings__empty text-body-medium" role="status">{{ search ? 'No requests match.' : 'No requests ran project code yet.' }}</p>
      <v-list v-else class="usage-recordings__list" density="comfortable" aria-label="Requests" role="listbox">
        <template v-for="(group, position) in groups" :key="group.key">
          <v-list-subheader v-if="group.interaction || position > 0" class="usage-recordings__interaction">{{ group.interaction ? interactionTitle(group.interaction) : 'Other requests' }}</v-list-subheader>
          <v-list-item
            v-for="request in group.requests"
            :key="request.id"
            :active="request.id === requestId"
            role="option"
            :aria-selected="request.id === requestId"
            color="primary"
            rounded="xl"
            lines="two"
            :class="['usage-recordings__request', { 'usage-recordings__request--secondary': isReadinessRequest(request) }]"
            @click="emit('update:requestId', request.id)"
          >
            <template #prepend>
              <v-chip size="small" variant="tonal" label class="usage-recordings__method" :title="markOf(request)?.label">
                <template v-if="markOf(request)">
                  <v-icon :icon="markOf(request).icon" size="small" /><span class="d-sr-only">{{ markOf(request).label }}</span>
                </template>
                <template v-else>{{ request.method || '–' }}</template>
              </v-chip>
            </template>
            <v-list-item-title class="text-body-medium"><template v-for="(part, index) in pathParts(requestTitle(request, routes, requests))" :key="index">{{ part }}<wbr></template></v-list-item-title>
            <v-list-item-subtitle>{{ subtitle(request) }}</v-list-item-subtitle>
          </v-list-item>
        </template>
      </v-list>
      <div v-if="groups.length && (hasMore || newestFirst)" class="usage-recordings__footer">
        <p class="text-body-small">{{ footerText }}</p>
        <v-btn v-if="hasMore" variant="text" size="small" :loading="requestsLoading" @click="emit('more')">Show more</v-btn>
      </div>
    </template>
  </section>
</template>

<script setup>
import { Vibe64UsageRecordingSummary } from "@local/vibe64-usage-recording/client";
import { computed } from "vue";
import { mdiCogOutline, mdiConsoleLine, mdiHeartPulse, mdiMagnify } from "@mdi/js";

import { BACKGROUND_TEXT, countLabel, interactionTitle, isBackgroundRequest, isReadinessRequest, onlyBackground, pathParts, requestGroups, requestTitle } from "./usageModel.js";

const props = defineProps({
  recordings: { type: Array, default: () => [] },
  recordingId: { type: String, default: "" },
  requests: { type: Array, default: () => [] },
  interactions: { type: Array, default: () => [] },
  // Matching requests on the server (null: not known); requests holds the pages read so far.
  total: { type: Number, default: null },
  hasMore: { type: Boolean, default: false },
  newestFirst: { type: Boolean, default: false },
  requestId: { type: String, default: "" },
  search: { type: String, default: "" },
  includeEmpty: { type: Boolean, default: false },
  routes: { type: Array, default: () => [] },
  unavailable: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  requestsLoading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  sessionId: { type: String, default: "" }
});
const emit = defineEmits(["update:recordingId", "update:requestId", "update:search", "update:includeEmpty", "more", "retry", "deleted"]);

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const recordingItems = computed(() => props.recordings.map((recording) => ({
  value: recording.id,
  title: `${recording.target?.label || "Recording"} · ${recording.startedAt ? timeFormat.format(new Date(recording.startedAt)) : ""} · ${countLabel(recording.counts?.requests, "request")}${recording.state === "recording" ? " · recording" : ""}`
})));
const selectedRecording = computed(() => props.recordings.find((recording) => recording.id === props.recordingId) || null);
const groups = computed(() => requestGroups(props.requests, props.interactions));
const footerText = computed(() => {
  if (!props.hasMore) return "Newest requests first";
  const shown = props.total == null ? `Showing ${countLabel(props.requests.length, "request")}`
    : `Showing ${props.requests.length.toLocaleString()} of ${countLabel(Math.max(props.total, props.requests.length), "request")}`;
  return props.newestFirst ? `${shown}, newest first` : shown;
});
// The method column shows a labelled icon where there is no method: a
// process's start-up and other work outside requests, the launch readiness
// check, and a command's run.
const MARKS = {
  background: { icon: mdiCogOutline, label: "Start-up" },
  readiness: { icon: mdiHeartPulse, label: "Readiness check" },
  run: { icon: mdiConsoleLine, label: "Command run" }
};
const markOf = (request) => (isBackgroundRequest(request) ? MARKS.background : isReadinessRequest(request) ? MARKS.readiness
  : /^run_/u.test(String(request.id)) ? MARKS.run : null);

function subtitle(request) {
  const what = isBackgroundRequest(request) ? (onlyBackground(props.requests) ? "Everything that ran while recording" : "Outside any request")
    : isReadinessRequest(request) ? "Vibe64 checking that the launch started" : request.status;
  return [what, countLabel(request.fileCount, "file"), countLabel(request.functionCount, "function")].filter(Boolean).join(" · ");
}

</script>

<style scoped>
/* The rail gives the section its height; the request list scrolls inside it. */
.usage-recordings { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; overflow-y: auto; padding: 12px 8px; }
.usage-recordings > :not(.usage-recordings__list) { flex: none; }
.usage-recordings__empty { margin: 0; padding: 4px; }
.usage-recordings__empty p { margin: 0; }
.usage-recordings__switch { flex: none; }
.usage-recordings__switch :deep(.v-label) { white-space: normal; }
.usage-recordings__live { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); }
.usage-recordings__list { flex: 1 1 auto; min-height: 160px; overflow-y: auto; padding: 0; background: transparent; }
.usage-recordings__interaction { height: auto; min-height: 40px; }
.usage-recordings__interaction :deep(.v-list-subheader__text) { white-space: normal; overflow: visible; overflow-wrap: break-word; }
.usage-recordings__request :deep(.v-list-item-title) { overflow-wrap: break-word; white-space: normal; hyphens: manual; }
.usage-recordings__request :deep(.v-list-item-subtitle) { -webkit-line-clamp: 3; }
.usage-recordings__method { min-width: 64px; justify-content: center; margin-right: 12px; font-family: ui-monospace, monospace; }
.usage-recordings__request--secondary { color: rgb(var(--v-theme-on-surface-variant)); }
.usage-recordings__footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 8px; padding: 0 4px; }
.usage-recordings__footer p { margin: 0; color: var(--v64-on-surface-variant); }
</style>
