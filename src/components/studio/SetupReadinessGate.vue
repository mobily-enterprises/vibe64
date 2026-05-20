<template>
  <div class="setup-readiness-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Setup readiness could not load"
      :error="errorMessage"
      compact
    />

    <v-sheet
      v-if="needsSetup && !redirecting"
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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  readSetupReadinessStatus
} from "@/lib/studioGateApi.js";

const route = useRoute();
const router = useRouter();
const checked = ref(false);
const fallbackError = ref("");
const setupGate = ref({
  message: "",
  ready: false,
  stages: [],
  tab: "studio-setup"
});

const ready = computed(() => setupGate.value.ready === true);
const errorMessage = computed(() => fallbackError.value);
const needsSetup = computed(() => checked.value && !ready.value && !errorMessage.value);
const redirecting = computed(() => needsSetup.value && route.path !== "/setup");
const setupRoute = computed(() => ({
  path: "/setup",
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
  setupGate.value = {
    message: status?.message || "",
    ready: status?.ready === true,
    stages: normalizeStages(status?.stages),
    tab: status?.currentStage?.id || ""
  };
  checked.value = true;
}

async function loadSetupGateWithRequest() {
  checked.value = false;
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

onMounted(() => {
  void loadSetupGateWithRequest();
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
