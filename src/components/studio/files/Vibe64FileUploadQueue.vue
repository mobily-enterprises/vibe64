<template>
  <section v-if="items.length" class="vibe64-upload-queue v64-focus-rings" aria-label="Uploads" :aria-busy="active ? 'true' : 'false'">
    <header class="vibe64-upload-queue__header">
      <v-icon
        class="vibe64-upload-queue__header-icon"
        :color="active ? 'primary' : summary.failed ? 'error' : 'success'"
        :icon="active ? mdiUpload : summary.failed ? mdiAlertCircle : mdiCheckCircle"
        aria-hidden="true"
      />
      <div class="vibe64-upload-queue__heading">
        <h3>{{ summary.title }}</h3>
        <p>{{ summary.detail }}</p>
      </div>
      <v-btn v-if="active" variant="text" @click="$emit('cancel-all')">Cancel all</v-btn>
      <v-btn
        :icon="expanded ? mdiChevronDown : mdiChevronUp"
        :aria-label="expanded ? 'Hide upload list' : 'Show upload list'"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-controls="listId"
        variant="text"
        @click="expanded = !expanded"
      />
      <v-btn v-if="!active" :icon="mdiClose" aria-label="Close uploads" variant="text" @click="$emit('clear')" />
    </header>
    <v-progress-linear v-if="active" :model-value="summary.percent" :aria-label="`Uploads ${summary.percent}% complete`" color="primary" height="4" />
    <ol v-show="expanded" :id="listId" class="vibe64-upload-queue__items">
      <li v-for="item in items" :key="item.clientId" class="vibe64-upload-queue__item">
        <v-icon :icon="statusIcon(item)" :color="statusColor(item)" size="20" aria-hidden="true" />
        <div class="vibe64-upload-queue__text">
          <span class="vibe64-upload-queue__name" :title="item.fileName">{{ item.fileName }}</span>
          <span class="vibe64-upload-queue__status" :class="{ 'vibe64-upload-queue__status--error': item.phase === 'failed' }">{{ statusText(item) }}</span>
          <v-progress-linear
            v-if="item.phase === 'uploading' || item.phase === 'delivering'"
            :aria-label="`${item.fileName} upload progress`"
            :indeterminate="item.progress === null"
            :model-value="item.progress ?? 0"
            color="primary"
            height="4"
            rounded
          />
        </div>
        <v-btn v-if="ACTIVE.includes(item.phase)" :icon="mdiClose" :aria-label="`Cancel ${item.fileName}`" :title="`Cancel ${item.fileName}`" variant="text" @click="$emit('cancel', item)" />
        <template v-else>
          <v-btn v-if="item.phase === 'failed' || item.phase === 'cancelled'" :icon="mdiRefresh" :aria-label="`Try ${item.fileName} again`" :title="`Try ${item.fileName} again`" variant="text" @click="$emit('retry', item)" />
          <v-btn :icon="mdiClose" :aria-label="`Remove ${item.fileName} from the list`" :title="`Remove ${item.fileName} from the list`" variant="text" @click="$emit('remove', item)" />
        </template>
      </li>
    </ol>
    <span class="vibe64-upload-queue__announcement" aria-live="polite" role="status">{{ announcement }}</span>
  </section>
</template>

<script setup>
import { computed, ref, useId } from "vue";
import {
  mdiAlertCircle,
  mdiCancel,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiClockOutline,
  mdiClose,
  mdiRefresh,
  mdiUpload
} from "@mdi/js";
import { formatFileSize } from "@/lib/vibe64FileSize.js";

// The upload list docked under a Files area: one row per file with its own
// progress, and a summary for the whole batch.
const props = defineProps({
  active: { type: Boolean, default: false },
  items: { type: Array, default: () => [] }
});
defineEmits(["cancel", "cancel-all", "clear", "remove", "retry"]);
const ACTIVE = ["preparing", "queued", "uploading", "delivering"];
const expanded = ref(true);
const listId = useId();

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const summary = computed(() => {
  const counted = props.items.filter((item) => !["cancelled", "failed"].includes(item.phase));
  const totalBytes = counted.reduce((sum, item) => sum + (Number(item.totalBytes) || 0), 0);
  const sentBytes = counted.reduce((sum, item) => sum + (item.phase === "ready" ? Number(item.totalBytes) || 0 : Number(item.bytesSent) || 0), 0);
  const count = (phases) => props.items.filter((item) => phases.includes(item.phase)).length;
  const done = count(["ready"]);
  const failed = count(["failed"]);
  const cancelled = count(["cancelled"]);
  const waiting = count(ACTIVE);
  const percent = totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 0;
  const outcome = [done && `${done} uploaded`, failed && `${failed} failed`, cancelled && `${cancelled} cancelled`].filter(Boolean).join(" · ");
  if (waiting) {
    return {
      done, failed, percent,
      title: `Uploading ${plural(waiting, "file")}`,
      detail: `${formatFileSize(sentBytes)} of ${formatFileSize(totalBytes)} · ${percent}%${outcome ? ` · ${outcome}` : ""}`
    };
  }
  if (failed) return { done, failed, percent, title: `${plural(failed, "upload")} failed`, detail: outcome };
  if (!done) return { done, failed, percent, title: "Uploads cancelled", detail: outcome };
  return { done, failed, percent, title: `${plural(done, "file")} uploaded`, detail: outcome };
});
// Spoken only when the batch changes state, not on every progress tick.
const announcement = computed(() => props.items.length && !props.active ? `${summary.value.title}. ${summary.value.detail}` : "");

function statusText(item) {
  switch (item.phase) {
    case "queued": case "preparing": return `Waiting · ${formatFileSize(item.totalBytes)}`;
    case "uploading": return item.progress === null ? "Uploading"
      : `${formatFileSize(item.bytesSent)} of ${formatFileSize(item.totalBytes)} · ${Math.round(item.progress)}%`;
    case "delivering": return "Finishing";
    case "ready": return `Uploaded · ${formatFileSize(item.totalBytes)}`;
    case "cancelled": return "Cancelled";
    default: return item.error || "Upload failed";
  }
}

function statusIcon(item) {
  return { ready: mdiCheckCircle, failed: mdiAlertCircle, cancelled: mdiCancel, uploading: mdiUpload, delivering: mdiUpload }[item.phase] || mdiClockOutline;
}

function statusColor(item) {
  return { ready: "success", failed: "error", uploading: "primary", delivering: "primary" }[item.phase] || undefined;
}
</script>

<style scoped>
.vibe64-upload-queue {
  background: var(--v64-surface-container-high);
  border-radius: var(--v64-shape-md);
  box-shadow: var(--v64-elevation-2);
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  flex: none;
  flex-direction: column;
  inset-block-end: var(--v64-space-2);
  margin: var(--v64-space-2);
  max-block-size: min(45%, 22rem);
  min-block-size: 0;
  overflow: hidden;
  /* Stays in view at the bottom of the area while its files scroll. */
  position: sticky;
  z-index: 2;
}

.vibe64-upload-queue__header {
  align-items: center;
  display: flex;
  gap: var(--v64-space-1);
  min-block-size: 56px;
  padding-inline: var(--v64-space-4) var(--v64-space-1);
}

.vibe64-upload-queue__header-icon {
  flex: none;
  margin-inline-end: var(--v64-space-2);
}

.vibe64-upload-queue__heading {
  flex: 1;
  min-inline-size: 0;
  padding-block: var(--v64-space-2);
}

.vibe64-upload-queue__heading h3 {
  font: var(--v64-type-title-md);
  margin: 0;
}

.vibe64-upload-queue__heading p,
.vibe64-upload-queue__status {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.vibe64-upload-queue__items {
  border-block-start: 1px solid var(--v64-outline-variant);
  list-style: none;
  margin: 0;
  min-block-size: 0;
  overflow: auto;
  padding: var(--v64-space-1) 0;
}

.vibe64-upload-queue__item {
  align-items: center;
  display: flex;
  gap: var(--v64-space-3);
  min-block-size: 56px;
  padding-inline: var(--v64-space-4) var(--v64-space-1);
}

.vibe64-upload-queue__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-inline-size: 0;
  padding-block: var(--v64-space-1);
}

.vibe64-upload-queue__name {
  font: var(--v64-type-body-lg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-upload-queue__status {
  overflow-wrap: anywhere;
}

.vibe64-upload-queue__status--error {
  color: rgb(var(--v-theme-error));
}

.vibe64-upload-queue__announcement {
  block-size: 1px;
  clip-path: inset(50%);
  inline-size: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
}
</style>
