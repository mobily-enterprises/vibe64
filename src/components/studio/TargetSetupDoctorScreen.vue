<template>
  <DoctorStatusPage
    title="Target setup"
    :lede="lede"
    :status="targetSetup"
    status-items-key="stages"
    :loading="loading"
    :error="errorMessage"
    :stream-enabled="streamEnabled"
    :stream-auto-start="streamAutoStart"
    :stream-endpoint="TARGET_SETUP_STREAM_ENDPOINT"
    :terminal-endpoint="TARGET_SETUP_TERMINAL_ENDPOINT"
    blocked-label="Setup blocked"
    ready-label="Setup ready"
    blocked-title="Target setup blocked"
    ready-title="Target setup ready"
    continue-label="Continue to home"
    continue-to="/home"
    doctor-class="target-setup-doctor"
    :always-repair-check-ids="['dependencies']"
    @refresh="loadTargetSetup"
    @status-updated="handleTargetSetupUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  TARGET_SETUP_STREAM_ENDPOINT,
  TARGET_SETUP_TERMINAL_ENDPOINT,
  readBootstrapStatus,
  readTargetBootupStatus
} from "../../lib/studioGateApi.js";

const emit = defineEmits(["select-tab"]);

const targetSetup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Bootup and Target bootup before Target setup runs.";
  }
  if (targetSetup.value?.ready) {
    return `Target project is setup-ready: ${targetSetup.value.targetRoot || "current directory"}`;
  }
  return `Target setup runs sequentially for: ${targetSetup.value?.targetRoot || "checking"}`;
});

async function loadTargetSetup({ autoStart = true } = {}) {
  loading.value = true;
  errorMessage.value = "";
  streamEnabled.value = false;
  streamAutoStart.value = autoStart;

  try {
    const bootstrap = await readBootstrapStatus();

    if (bootstrap?.ready !== true) {
      emit("select-tab", "bootup");
      return;
    }

    const target = await readTargetBootupStatus();

    if (target?.ready !== true) {
      emit("select-tab", "target-bootup");
      return;
    }

    streamEnabled.value = true;
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Target setup check failed.");
  } finally {
    loading.value = false;
  }
}

function handleTargetSetupUpdated(status) {
  targetSetup.value = status;
}

onMounted(() => {
  void loadTargetSetup();
});
</script>
