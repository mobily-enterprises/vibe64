<template>
  <section class="vibe64-session-info-page">
    <header class="vibe64-session-info-page__header">
      <div>
        <h1 class="text-headline-small font-weight-bold ma-0">Session info</h1>
      </div>
      <v-btn
        v-if="copyContext"
        :prepend-icon="copied ? mdiCheck : mdiContentCopy"
        size="small"
        type="button"
        variant="tonal"
        @click="copyAll"
      >
        {{ copied ? "Copied" : "Copy context" }}
      </v-btn>
    </header>

    <Vibe64SessionFacts
      v-if="facts.length"
      :facts="facts"
      :status-color="statusColor"
      :status-label="statusLabel"
      @copy="copyFact"
    />

    <v-sheet
      v-else
      border
      class="vibe64-session-info-page__empty"
      rounded="lg"
    >
      <h2>No active session</h2>
      <p>Create or select a session to see its paths, branch, and agent identifiers.</p>
    </v-sheet>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import {
  mdiCheck,
  mdiContentCopy
} from "@mdi/js";
import Vibe64SessionFacts from "@/components/studio/vibe64-session/Vibe64SessionFacts.vue";
import {
  vibe64SessionInfoFacts,
  vibe64SessionInfoText
} from "@/lib/vibe64SessionInfo.js";

const props = defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  }
});

const copied = ref(false);
let copiedTimer = null;
const dashboard = computed(() => props.dashboardContext || {});
const facts = computed(() => vibe64SessionInfoFacts(
  dashboard.value.session,
  dashboard.value.projectContext
));
const statusColor = computed(() => String(dashboard.value.statusColor || "default"));
const statusLabel = computed(() => String(dashboard.value.statusLabel || ""));
const copyContext = computed(() => vibe64SessionInfoText(facts.value, {
  status: dashboard.value.session?.status
}));

function copyText(value = "") {
  return typeof dashboard.value.copyText === "function"
    ? dashboard.value.copyText(value)
    : false;
}

function copyFact(value) {
  return copyText(value);
}

async function copyAll() {
  if (!copyContext.value || await copyText(copyContext.value) === false) {
    return false;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 1800);
  return true;
}

onBeforeUnmount(() => {
  clearTimeout(copiedTimer);
});
</script>

<style scoped>
.vibe64-session-info-page {
  align-content: start;
  display: grid;
  gap: 0.75rem;
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.vibe64-session-info-page__header {
  align-items: start;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
  padding-bottom: 0.65rem;
}

.vibe64-session-info-page__header h1,
.vibe64-session-info-page__header p,
.vibe64-session-info-page__empty h2,
.vibe64-session-info-page__empty p {
  letter-spacing: 0;
  margin: 0;
}

.vibe64-session-info-page__header p,
.vibe64-session-info-page__empty p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
  line-height: 1.35;
  margin-top: 0.18rem;
}

.vibe64-session-info-page__empty {
  display: grid;
  gap: 0.25rem;
  padding: 1rem;
}

.vibe64-session-info-page__empty h2 {
  font-size: 1rem;
  font-weight: 700;
}

@media (max-width: 520px) {
  .vibe64-session-info-page__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
