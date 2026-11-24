<template>
  <section class="vibe64-crashes" data-testid="vibe64-crashes">
    <Vibe64DashboardPageHeader
      description="Every time Vibe64's own server ended unexpectedly. Each one is a defect in Vibe64 to report and fix."
      icon="$error"
      title="Crashes"
    >
      <template #actions>
        <v-btn
          v-if="firstUnacknowledged"
          color="error"
          :loading="acknowledging"
          rounded="pill"
          variant="flat"
          @click="acknowledge(firstUnacknowledged.id)"
        >
          Acknowledge {{ unacknowledged === 1 ? "this crash" : `all ${unacknowledged}` }}
        </v-btn>
      </template>
    </Vibe64DashboardPageHeader>

    <v-alert v-if="loadError" border="start" type="error" variant="tonal">{{ loadError }}</v-alert>
    <v-alert v-if="actionError" border="start" type="error" variant="tonal">{{ actionError }}</v-alert>

    <v-skeleton-loader v-if="isInitialLoading" aria-label="Reading crashes" type="list-item-three-line@3" />

    <template v-else-if="!loadError">
      <p v-if="records.length === 0" class="vibe64-crashes__empty">Vibe64 has not crashed here.</p>
      <p v-if="removed.count > 0" class="vibe64-crashes__removed">
        Only the latest {{ limit }} crashes are kept: {{ removed.count }} older
        {{ removed.count === 1 ? "one was" : "ones were" }} removed{{ removed.lastRemovedAt ? `, the last on ${crashTimeText(removed.lastRemovedAt)}` : "" }}.
      </p>

      <article
        v-for="record in records"
        :key="record.id"
        class="vibe64-crashes__record"
        :class="{ 'vibe64-crashes__record--open': !record.acknowledged }"
        data-testid="vibe64-crash-record"
      >
        <header class="vibe64-crashes__record-header">
          <v-icon :color="record.acknowledged ? undefined : 'error'" icon="$error" size="20" />
          <div class="vibe64-crashes__record-copy">
            <h3 class="vibe64-crashes__record-title">{{ crashBannerHeadline(record, 1) }}</h3>
            <p v-if="crashTurnsText(record)">{{ crashTurnsText(record) }}</p>
            <p class="vibe64-crashes__facts">
              {{ facts(record) }}
            </p>
            <p v-if="record.acknowledged" class="vibe64-crashes__facts">
              Acknowledged by {{ record.acknowledged.by?.displayName || record.acknowledged.by?.username || "someone" }}
              at {{ crashTimeText(record.acknowledged.at) }}.
            </p>
            <p v-else class="vibe64-crashes__unacknowledged">Not acknowledged yet.</p>
          </div>
          <v-btn class="vibe64-crashes__copy" size="small" variant="tonal" @click="copyReport(record)">
            {{ copiedId === record.id ? "Copied" : "Copy for a bug report" }}
          </v-btn>
        </header>
        <pre v-if="record.error?.stack" class="vibe64-crashes__stack">{{ record.error.stack }}</pre>
      </article>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { crashTurnsText } from "@local/vibe64-core/shared/crashText";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
import { useVibe64CrashList } from "@/composables/useVibe64Crashes.js";
import { crashBannerHeadline, crashTimeText } from "@/lib/vibe64CrashPresentation.js";

// The Crashes page: each recorded crash, newest first, with its whole error and stack, who acknowledged it and
// when, and Copy for a bug report. Only the workspace owner reads it (everyone else is told so by the server).
const {
  acknowledge,
  acknowledging,
  actionError,
  copiedId,
  copyReport,
  isInitialLoading,
  limit,
  loadError,
  records,
  removed,
  unacknowledged
} = useVibe64CrashList();

// The newest record not yet acknowledged: acknowledging covers it and every older one.
const firstUnacknowledged = computed(() => records.value.find((record) => record.kind !== "unreadable" && !record.acknowledged));

function facts(record) {
  const parts = [
    record.version || "",
    record.pid ? `process ${record.pid}` : "",
    Number.isFinite(record.uptimeSeconds) ? `up ${uptimeText(record.uptimeSeconds)}` : "",
    record.error?.code ? `code ${record.error.code}` : "",
    record.origin ? `from ${record.origin}` : "",
    record.exit ? `exit from the host ${[record.exit.result, record.exit.code, record.exit.status].filter(Boolean).join(", ")}` : ""
  ];
  return parts.filter(Boolean).join(" · ");
}

function uptimeText(seconds) {
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}
</script>

<style scoped>
.vibe64-crashes {
  display: grid;
  gap: 0.75rem;
  margin-inline: auto;
  max-width: 64rem;
  min-width: 0;
  padding-block: 0.75rem;
}

.vibe64-crashes__empty,
.vibe64-crashes__removed {
  color: rgb(var(--v-theme-on-surface-variant));
  margin: 0;
}

.vibe64-crashes__record {
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  display: grid;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.75rem 1rem;
}

.vibe64-crashes__record--open {
  border-color: rgb(var(--v-theme-error));
}

.vibe64-crashes__record-header {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
}

.vibe64-crashes__record-copy {
  display: grid;
  flex: 1 1 20rem;
  gap: 0.25rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.vibe64-crashes__record-copy p {
  margin: 0;
}

.vibe64-crashes__record-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.vibe64-crashes__facts {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.875rem;
}

.vibe64-crashes__unacknowledged {
  color: rgb(var(--v-theme-error));
  font-size: 0.875rem;
  font-weight: 600;
}

.vibe64-crashes__stack {
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8125rem;
  margin: 0;
  max-height: 24rem;
  overflow: auto;
  padding: 0.5rem 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
