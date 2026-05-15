<template>
  <DoctorStatusPage
    title="App Setup"
    :lede="lede"
    :status="appSetup"
    status-items-key="stages"
    :loading="loading"
    :error="errorMessage"
    :stream-enabled="streamEnabled"
    :stream-auto-start="streamAutoStart"
    :stream-endpoint="APP_SETUP_STREAM_ENDPOINT"
    :terminal-endpoint="APP_SETUP_TERMINAL_ENDPOINT"
    blocked-label="Setup blocked"
    ready-label="Setup ready"
    blocked-title="App setup blocked"
    ready-title="App setup ready"
    continue-label="Continue to home"
    continue-to="/home"
    doctor-class="app-setup-doctor"
    :always-repair-check-ids="['dependencies']"
    @refresh="loadAppSetup"
    @status-updated="handleAppSetupUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  APP_SETUP_STREAM_ENDPOINT,
  APP_SETUP_TERMINAL_ENDPOINT,
  consumeStudioGate,
  readBootstrapStatus,
  readTargetAppStatus
} from "../../lib/studioApi";

const props = defineProps({
  gate: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(["select-tab"]);

const appSetup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Bootup and App Bootup before App Setup runs.";
  }
  if (appSetup.value?.ready) {
    return `Target app is setup-ready: ${appSetup.value.targetRoot || "current directory"}`;
  }
  return `Target app setup runs sequentially for: ${appSetup.value?.targetRoot || "checking"}`;
});

async function loadAppSetup({ autoStart = true } = {}) {
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

    const target = await readTargetAppStatus();

    if (target?.ready !== true) {
      emit("select-tab", "app-bootup");
      return;
    }

    streamEnabled.value = true;
  } catch (error) {
    errorMessage.value = String(error?.message || error || "App setup check failed.");
  } finally {
    loading.value = false;
  }
}

function handleAppSetupUpdated(status) {
  appSetup.value = status;
}

onMounted(() => {
  const gate = props.gate ?? consumeStudioGate("/bootup-setup");

  if (gate?.bootstrap?.ready === true && gate?.targetApp?.ready === true && gate?.appSetup) {
    appSetup.value = gate.appSetup;
    streamEnabled.value = true;
    streamAutoStart.value = false;
    return;
  }

  if (gate?.appSetup && gate.appSetup.ready !== true) {
    appSetup.value = gate.appSetup;
  }

  void loadAppSetup();
});
</script>
