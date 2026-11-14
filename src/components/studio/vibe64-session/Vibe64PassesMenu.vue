<template>
  <component
    :is="mobile ? VBottomSheet : VMenu"
    v-model="opened"
    :close-on-content-click="false"
    :content-props="{ role: 'dialog', 'aria-label': 'Passes' }"
    location="top start"
    max-width="420"
    @update:model-value="onOpenChange"
  >
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        aria-haspopup="dialog"
        aria-label="Passes"
        class="vibe64-passes__trigger"
        icon="$checklist"
        size="small"
        title="Passes: improve your app"
        variant="text"
      />
    </template>
    <v-card class="vibe64-passes" rounded="lg" @keydown.esc.stop.prevent="opened = false">
      <v-card-item class="vibe64-passes__header">
        <v-card-title class="text-title-medium">Passes</v-card-title>
        <v-card-subtitle class="vibe64-passes__subtitle">Improve your app, one pass at a time.</v-card-subtitle>
        <template #append>
          <v-btn aria-label="Close passes" icon="$close" size="small" variant="text" @click="opened = false" />
        </template>
      </v-card-item>
      <v-card-text class="vibe64-passes__body">
        <p v-if="blockedReason" class="text-body-small vibe64-passes__note" role="status">{{ blockedReason }}</p>
        <v-alert v-if="passes.unavailable.value" class="mb-2" density="compact" type="warning" variant="tonal">{{ passes.unavailable.value }}</v-alert>
        <v-alert v-if="passes.error.value" class="mb-2" density="compact" type="error" variant="tonal">{{ passes.error.value }}</v-alert>
        <v-alert v-if="passes.loadError.value && !list.length" density="compact" type="error" variant="tonal">
          {{ passes.loadError.value }}
          <v-btn size="small" variant="text" @click="passes.reload()">Retry</v-btn>
        </v-alert>
        <v-skeleton-loader v-else-if="!list.length" type="list-item-three-line@3" />
        <ul v-else class="vibe64-passes__list">
          <li v-for="pass in list" :key="pass.id" class="vibe64-passes__row">
            <div class="vibe64-passes__text">
              <div class="text-title-small">{{ pass.title }}</div>
              <div class="text-body-small vibe64-passes__muted">{{ pass.description }}</div>
              <div class="text-label-small vibe64-passes__muted">{{ lastRunLabel(pass) }}</div>
              <div v-if="pass.unavailable && !passes.unavailable.value" class="text-body-small vibe64-passes__muted">{{ pass.unavailable }}</div>
            </div>
            <div v-if="pass.runs.length" class="vibe64-passes__runs">
              <v-btn
                v-for="passRun in pass.runs"
                :key="passRun.id"
                :aria-label="`Run ${pass.title}: ${passRun.label}`"
                class="vibe64-passes__run"
                color="primary"
                :disabled="Boolean(blockedReason) || Boolean(passes.starting.value)"
                :loading="passes.starting.value === runKey(pass, passRun)"
                size="small"
                variant="tonal"
                @click="start(pass, passRun)"
              >
                {{ passRun.label }}
              </v-btn>
            </div>
          </li>
        </ul>
      </v-card-text>
    </v-card>
  </component>
</template>

<script setup>
// The chat's Passes list: each pass Genesis offers, when it last completed in this project, and a
// button for each run Genesis offers for it, or why the project's Genesis cannot run it.
import { computed, ref } from "vue";
import { useDisplay } from "vuetify";
import { VBottomSheet, VMenu } from "vuetify/components";
import { runKey } from "@/composables/useVibe64Passes.js";

const runDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const props = defineProps({
  passes: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64Passes>} */ (Object), required: true },
  // Why Run is unavailable now, such as a running turn; empty while it can start.
  blockedReason: { type: String, default: "" }
});
const { xs: mobile } = useDisplay();
const opened = ref(false);
const list = computed(() => props.passes.passes.value);

/** @param {import("@/composables/useVibe64Passes.js").Vibe64Pass} pass */
function lastRunLabel(pass) {
  if (!pass.lastRun) return "Never completed";
  const since = pass.commitsSince === null ? "" : ` · ${pass.commitsSince} ${pass.commitsSince === 1 ? "commit" : "commits"} since`;
  return `Last completed: ${runDate.format(new Date(pass.lastRun))}${since}`;
}

function onOpenChange(value) {
  if (value) void props.passes.reload();
}

async function start(pass, passRun) {
  if (await props.passes.run(pass, passRun)) opened.value = false;
}
</script>

<style scoped>
.vibe64-passes__trigger {
  flex-shrink: 0;
}

.vibe64-passes__header {
  padding-bottom: 0;
}

.vibe64-passes__subtitle {
  white-space: normal;
}

.vibe64-passes__body {
  max-height: min(60vh, 32rem);
  overflow-y: auto;
  padding-top: 0.5rem;
}

.vibe64-passes__note {
  margin-bottom: 0.5rem;
}

.vibe64-passes__list {
  display: flex;
  flex-direction: column;
  list-style: none;
  margin: 0;
  padding: 0;
}

.vibe64-passes__row {
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem 0;
}

.vibe64-passes__row:first-child {
  border-top: 0;
}

.vibe64-passes__text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.vibe64-passes__runs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* A run's label is Genesis's, so a long one wraps instead of widening the list. */
.vibe64-passes__run {
  height: auto;
  max-width: 100%;
  min-height: var(--v-btn-height);
}

.vibe64-passes__run :deep(.v-btn__content) {
  white-space: normal;
}

.vibe64-passes__muted {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
