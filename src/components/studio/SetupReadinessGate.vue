<template>
  <div class="setup-readiness-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Setup readiness could not load"
      :error="errorMessage"
      compact
    />

    <v-progress-linear
      v-if="loading || redirecting"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

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
import {
  readSetupReadinessStatus
} from "@/lib/studioGateApi.js";

const route = useRoute();
const router = useRouter();
const checked = ref(false);
const loading = ref(false);
const errorMessage = ref("");
const setupGate = ref({
  message: "",
  ready: false,
  tab: "studio-setup"
});

const ready = computed(() => setupGate.value.ready === true);
const needsSetup = computed(() => checked.value && !ready.value && !errorMessage.value);
const redirecting = computed(() => needsSetup.value && route.path !== "/setup");
const setupRoute = computed(() => ({
  path: "/setup",
  query: {
    tab: setupGate.value.tab || "studio-setup"
  }
}));

async function loadSetupGate() {
  checked.value = false;
  loading.value = true;
  errorMessage.value = "";

  try {
    const status = await readSetupReadinessStatus();
    setupGate.value = {
      message: status?.message || "",
      ready: status?.ready === true,
      tab: status?.currentStage?.id || ""
    };
    checked.value = true;
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Setup readiness could not load.");
    setupGate.value = {
      message: "Setup readiness could not load.",
      ready: false,
      tab: "studio-setup"
    };
    checked.value = true;
  } finally {
    loading.value = false;
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

void loadSetupGate();
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
