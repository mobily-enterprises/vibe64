<template>
  <div class="setup-readiness-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Setup readiness could not load"
      :error="errorMessage"
      compact
    />

    <v-sheet
      v-if="loading || redirecting"
      rounded="lg"
      border
      class="setup-readiness-gate__checking"
    >
      <div class="setup-readiness-gate__checking-header">
        <h2 class="setup-readiness-gate__title">Checking setup readiness</h2>
        <p class="setup-readiness-gate__message">
          {{ readinessMessage }}
        </p>
      </div>

      <v-progress-linear
        color="primary"
        height="6"
        indeterminate
        rounded
      />

      <div
        v-if="displayStages.length"
        class="setup-readiness-gate__stage-list"
        aria-label="Setup readiness checks"
      >
        <div
          v-for="stage in displayStages"
          :key="stage.id"
          class="setup-readiness-gate__stage"
        >
          <span
            :class="[
              'setup-readiness-gate__stage-dot',
              `setup-readiness-gate__stage-dot--${stageState(stage)}`
            ]"
          />
          <span class="setup-readiness-gate__stage-label">{{ stage.label || stage.id }}</span>
          <span class="setup-readiness-gate__stage-status">{{ stageStatusLabel(stage) }}</span>
        </div>
      </div>
    </v-sheet>

    <v-sheet
      v-else-if="needsSetup"
      rounded="lg"
      border
      class="setup-readiness-gate__needed"
    >
      <div>
        <h2 class="setup-readiness-gate__title">Setup needed</h2>
        <p class="setup-readiness-gate__message">
          {{ setupGate.message || "Finish setup before using project tools." }}
        </p>
      </div>
      <v-btn
        color="primary"
        variant="flat"
        :to="setupRoute"
      >
        Open setup
      </v-btn>
    </v-sheet>

    <slot v-else-if="ready" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useDoctorStream } from "@/composables/useDoctorStream.js";
import {
  readSetupReadinessStatus,
  SETUP_READINESS_STREAM_ENDPOINT
} from "@/lib/studioGateApi.js";

const route = useRoute();
const router = useRouter();
const checked = ref(false);
const fallbackError = ref("");
const fallbackLoading = ref(false);
const setupGate = ref({
  message: "",
  ready: false,
  stages: [],
  tab: "studio-setup"
});

const {
  liveStatus,
  streamError,
  streamRunning
} = useDoctorStream({
  onRefresh: loadSetupGateWithRequest,
  onStatusUpdated: applySetupReadiness,
  statusItemsKey: () => "stages",
  streamEnabled: () => true,
  streamEndpoint: () => SETUP_READINESS_STREAM_ENDPOINT
});

const ready = computed(() => setupGate.value.ready === true);
const errorMessage = computed(() => fallbackError.value || streamError.value);
const loading = computed(() => fallbackLoading.value || streamRunning.value);
const needsSetup = computed(() => checked.value && !ready.value && !errorMessage.value);
const redirecting = computed(() => needsSetup.value && route.path !== "/setup");
const setupRoute = computed(() => ({
  path: "/setup",
  query: {
    tab: setupGate.value.tab || "studio-setup"
  }
}));
const displayStages = computed(() => {
  return normalizeStages(liveStatus.value?.stages || setupGate.value.stages);
});
const runningStage = computed(() => {
  return displayStages.value.find((stage) => stage.status === "running") || null;
});
const readinessMessage = computed(() => {
  if (redirecting.value) {
    return "Opening the setup step that needs attention.";
  }
  if (runningStage.value?.label) {
    return `Checking ${runningStage.value.label}.`;
  }
  return "Checking Studio setup, accounts, adapter setup, and project setup.";
});

function normalizeStage(stage = {}) {
  return {
    ...stage,
    id: String(stage?.id || ""),
    label: String(stage?.label || stage?.id || "")
  };
}

function normalizeStages(value = []) {
  return Array.isArray(value) ? value.map(normalizeStage).filter((stage) => stage.id) : [];
}

function stageState(stage = {}) {
  if (stage.status === "running") {
    return "running";
  }
  if (stage.ready === true) {
    return "ready";
  }
  if (stage.ready === false || stage.status === "fail") {
    return "blocked";
  }
  return "pending";
}

function stageStatusLabel(stage = {}) {
  const state = stageState(stage);
  if (state === "running") {
    return "Checking";
  }
  if (state === "ready") {
    return "Ready";
  }
  if (state === "blocked") {
    return "Needs setup";
  }
  return "Pending";
}

function applySetupReadiness(status = {}) {
  setupGate.value = {
    message: status?.message || "",
    ready: status?.ready === true,
    stages: normalizeStages(status?.stages),
    tab: status?.currentStage?.id || ""
  };
  checked.value = true;
}

async function loadSetupGateWithRequest() {
  fallbackLoading.value = true;
  fallbackError.value = "";
  try {
    applySetupReadiness(await readSetupReadinessStatus());
  } catch (error) {
    fallbackError.value = String(error?.message || error || "Setup readiness could not load.");
    setupGate.value = {
      message: "Setup readiness could not load.",
      ready: false,
      stages: [],
      tab: "studio-setup"
    };
    checked.value = true;
  } finally {
    fallbackLoading.value = false;
  }
}

function redirectToSetup() {
  if (redirecting.value) {
    void router.replace(setupRoute.value);
  }
}

watch(redirecting, redirectToSetup, {
  immediate: true
});
</script>

<style scoped>
.setup-readiness-gate {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.setup-readiness-gate__needed {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
  padding: 1rem;
}

.setup-readiness-gate__checking {
  display: grid;
  gap: 0.85rem;
  padding: 1rem;
}

.setup-readiness-gate__checking-header {
  display: grid;
  gap: 0.25rem;
}

.setup-readiness-gate__title {
  font-size: 1.1rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0 0 0.25rem;
}

.setup-readiness-gate__message {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
  margin: 0;
}

.setup-readiness-gate__stage-list {
  display: grid;
  gap: 0.45rem;
}

.setup-readiness-gate__stage {
  align-items: center;
  display: grid;
  gap: 0.55rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
}

.setup-readiness-gate__stage-dot {
  background: rgba(var(--v-theme-on-surface), 0.24);
  border-radius: 999px;
  display: inline-block;
  height: 0.55rem;
  width: 0.55rem;
}

.setup-readiness-gate__stage-dot--running {
  background: rgb(var(--v-theme-primary));
}

.setup-readiness-gate__stage-dot--ready {
  background: rgb(var(--v-theme-success));
}

.setup-readiness-gate__stage-dot--blocked {
  background: rgb(var(--v-theme-warning));
}

.setup-readiness-gate__stage-label,
.setup-readiness-gate__stage-status {
  font-size: 0.86rem;
  line-height: 1.25;
}

.setup-readiness-gate__stage-label {
  overflow-wrap: anywhere;
}

.setup-readiness-gate__stage-status {
  color: rgba(var(--v-theme-on-surface), 0.62);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .setup-readiness-gate__needed {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
