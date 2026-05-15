<template>
  <DoctorStatusPage
    title="App Bootup"
    :lede="lede"
    :status="targetApp"
    :loading="loading"
    :error="errorMessage"
    :stream-enabled="streamEnabled"
    :stream-auto-start="streamAutoStart"
    :stream-endpoint="TARGET_APP_STREAM_ENDPOINT"
    :terminal-endpoint="TARGET_APP_TERMINAL_ENDPOINT"
    blocked-label="App blocked"
    ready-label="App ready"
    blocked-title="Target app blocked"
    ready-title="Target app ready"
    continue-label="Continue to app setup"
    continue-emits
    doctor-class="target-app-doctor"
    @continue="emit('select-tab', 'app-setup')"
    @refresh="loadTargetApp"
    @status-updated="handleTargetUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  TARGET_APP_STREAM_ENDPOINT,
  TARGET_APP_TERMINAL_ENDPOINT,
  consumeStudioGate,
  readBootstrapStatus
} from "../../lib/studioApi";

const props = defineProps({
  gate: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(["select-tab"]);

const bootstrap = ref(null);
const targetApp = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Bootup before App Bootup runs.";
  }
  if (targetApp.value?.ready) {
    return `Target root is ready: ${targetApp.value.targetRoot || "current directory"}`;
  }
  return `Target root: ${targetApp.value?.targetRoot || "checking"}`;
});

async function loadTargetApp({ autoStart = true } = {}) {
  loading.value = true;
  errorMessage.value = "";
  streamEnabled.value = false;
  streamAutoStart.value = autoStart;

  try {
    bootstrap.value = await readBootstrapStatus();

    if (bootstrap.value?.ready !== true) {
      emit("select-tab", "bootup");
      return;
    }

    streamEnabled.value = true;
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Target app check failed.");
  } finally {
    loading.value = false;
  }
}

function handleTargetUpdated(status) {
  targetApp.value = status;
}

onMounted(() => {
  const gate = props.gate ?? consumeStudioGate("/bootup-setup");

  if (gate?.bootstrap?.ready === true && gate?.targetApp) {
    bootstrap.value = gate.bootstrap;
    targetApp.value = gate.targetApp;
    streamEnabled.value = true;
    streamAutoStart.value = false;
    return;
  }

  if (gate?.targetApp && gate.targetApp.ready !== true) {
    targetApp.value = gate.targetApp;
  }

  void loadTargetApp();
});
</script>
