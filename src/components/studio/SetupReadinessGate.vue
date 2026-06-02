<template>
  <div class="setup-readiness-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Setup readiness could not load"
      :error="errorMessage"
      compact
    />

    <v-sheet
      v-else-if="checking"
      rounded="lg"
      border
      class="setup-readiness-gate__needed"
    >
      <div>
        <h2 class="setup-readiness-gate__title">Checking setup</h2>
        <p class="setup-readiness-gate__message">
          Studio is checking whether the local toolchain and project setup are ready.
        </p>
      </div>
      <v-progress-circular
        color="primary"
        indeterminate
        size="28"
        width="3"
      />
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

<script>
const cachedSetupReadinessStatuses = new Map();
</script>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  readSetupReadinessStatus
} from "@/lib/studioGateApi.js";

const props = defineProps({
  cacheKey: {
    default: "",
    type: String
  }
});

const route = useRoute();
const router = useRouter();
const fallbackError = ref("");
const activeCacheKey = computed(() => normalizeCacheKey(props.cacheKey));
const cachedSetupReadinessStatus = cachedSetupReadinessForKey();
const checked = ref(Boolean(cachedSetupReadinessStatus));
const setupGate = ref(cachedSetupReadinessStatus
  ? setupGateFromStatus(cachedSetupReadinessStatus)
  : emptySetupGate());

function normalizeCacheKey(value = "") {
  return String(value || "default").trim() || "default";
}

function cachedSetupReadinessForKey() {
  return cachedSetupReadinessStatuses.get(activeCacheKey.value) || null;
}

function emptySetupGate() {
  return {
    message: "",
    ready: false,
    stages: [],
    tab: "studio-setup"
  };
}

function setupGateFromStatus(status = {}) {
  return {
    message: status?.message || "",
    ready: status?.ready === true,
    stages: normalizeStages(status?.stages),
    tab: status?.currentStage?.id || ""
  };
}

const ready = computed(() => setupGate.value.ready === true);
const errorMessage = computed(() => fallbackError.value);
const checking = computed(() => !checked.value && !errorMessage.value);
const needsSetup = computed(() => checked.value && !ready.value && !errorMessage.value);
const setupPageActive = computed(() => route.path === "/setup" || route.path === "/home/setup");
const redirecting = computed(() => !setupPageActive.value && needsSetup.value);
const setupRoute = computed(() => ({
  path: route.path.startsWith("/home") ? "/home/setup" : "/setup",
  query: {
    tab: setupGate.value.tab || "studio-setup"
  }
}));

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

function applySetupReadiness(status = {}) {
  const normalizedStatus = status && typeof status === "object" ? status : null;
  if (normalizedStatus) {
    cachedSetupReadinessStatuses.set(activeCacheKey.value, normalizedStatus);
  } else {
    cachedSetupReadinessStatuses.delete(activeCacheKey.value);
  }
  setupGate.value = setupGateFromStatus(normalizedStatus || {});
  fallbackError.value = "";
  checked.value = true;
}

function applySetupReadinessError(error) {
  fallbackError.value = String(error?.message || error || "Setup readiness could not load.");
  setupGate.value = {
    ...emptySetupGate(),
    message: "Setup readiness could not load."
  };
  checked.value = true;
}

async function loadSetupGateWithRequest({
  preserveCurrent = false
} = {}) {
  if (!preserveCurrent) {
    checked.value = false;
    fallbackError.value = "";
  }
  try {
    applySetupReadiness(await readSetupReadinessStatus());
  } catch (error) {
    if (preserveCurrent && checked.value) {
      console.error("[VIBE64_SETUP_READINESS_REFRESH_ERROR]", error);
      return;
    }
    applySetupReadinessError(error);
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

watch(activeCacheKey, () => {
  const cachedStatus = cachedSetupReadinessForKey();
  fallbackError.value = "";
  if (cachedStatus) {
    setupGate.value = setupGateFromStatus(cachedStatus);
    checked.value = true;
    void loadSetupGateWithRequest({
      preserveCurrent: true
    });
    return;
  }
  setupGate.value = emptySetupGate();
  checked.value = false;
  void loadSetupGateWithRequest();
});

onMounted(() => {
  void loadSetupGateWithRequest({
    preserveCurrent: checked.value
  });
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

@media (max-width: 640px) {
  .setup-readiness-gate__needed {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
