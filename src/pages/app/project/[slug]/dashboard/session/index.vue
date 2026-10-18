<template>
  <section class="vibe64-session-info-page">
    <Vibe64DashboardPageHeader
      description="Paths, branch and agent identifiers for this session."
      :icon="mdiInformationOutline"
      title="Session info"
    >
      <template #actions>
        <v-btn
          v-if="copyContext"
          :prepend-icon="copied ? mdiCheck : mdiContentCopy"
          rounded="pill"
          type="button"
          variant="tonal"
          @click="copyAll"
        >
          {{ copied ? "Copied" : "Copy context" }}
        </v-btn>
      </template>
    </Vibe64DashboardPageHeader>

    <Vibe64SessionFacts
      v-if="facts.length"
      :facts="facts"
      :status-color="statusColor"
      :status-label="statusLabel"
      @copy="copyFact"
    />

    <v-sheet
      v-else
      class="vibe64-session-info-page__empty"
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
  mdiContentCopy,
  mdiInformationOutline
} from "@mdi/js";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
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
  gap: var(--v64-space-3, 12px);
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.vibe64-session-info-page__empty h2,
.vibe64-session-info-page__empty p {
  letter-spacing: 0;
  margin: 0;
}

/* M3 empty state: a quiet dashed slot, centred. */
.vibe64-session-info-page__empty {
  background: var(--v64-surface-container-low);
  border: 1px dashed var(--v64-outline, rgba(0, 0, 0, 0.24));
  border-radius: var(--v64-shape-lg, 16px);
  display: grid;
  gap: var(--v64-space-1, 4px);
  padding: var(--v64-space-6, 32px) var(--v64-space-4, 16px);
  text-align: center;
}

.vibe64-session-info-page__empty h2 {
  font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif);
}

.vibe64-session-info-page__empty p {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif);
}
</style>
