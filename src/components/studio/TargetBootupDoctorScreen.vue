<template>
  <DoctorStatusPage
    title="Target bootup"
    :lede="lede"
    :status="targetBootup"
    :loading="loading"
    :error="errorMessage"
    :stream-enabled="streamEnabled"
    :stream-auto-start="streamAutoStart"
    :stream-endpoint="TARGET_BOOTUP_STREAM_ENDPOINT"
    :terminal-endpoint="TARGET_BOOTUP_TERMINAL_ENDPOINT"
    blocked-label="Target blocked"
    ready-label="Target ready"
    blocked-title="Target project blocked"
    ready-title="Target project ready"
    continue-label="Continue to target setup"
    continue-emits
    doctor-class="target-bootup-doctor"
    @continue="emit('select-tab', 'target-setup')"
    @refresh="loadTargetBootup"
    @status-updated="handleTargetBootupUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  TARGET_BOOTUP_STREAM_ENDPOINT,
  TARGET_BOOTUP_TERMINAL_ENDPOINT,
  consumeStudioGate,
  readBootstrapStatus
} from "../../lib/studioGateApi.js";

const props = defineProps({
  gate: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(["select-tab"]);

const bootstrap = ref(null);
const targetBootup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Bootup before Target bootup runs.";
  }
  if (targetBootup.value?.ready) {
    return `Target root is ready: ${targetBootup.value.targetRoot || "current directory"}`;
  }
  return `Target root: ${targetBootup.value?.targetRoot || "checking"}`;
});

async function loadTargetBootup({ autoStart = true } = {}) {
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
    errorMessage.value = String(error?.message || error || "Target project check failed.");
  } finally {
    loading.value = false;
  }
}

function handleTargetBootupUpdated(status) {
  targetBootup.value = status;
}

onMounted(() => {
  const gate = props.gate ?? consumeStudioGate("/bootup-setup");

  if (gate?.bootstrap?.ready === true && gate?.targetBootup) {
    bootstrap.value = gate.bootstrap;
    targetBootup.value = gate.targetBootup;
    streamEnabled.value = true;
    streamAutoStart.value = false;
    return;
  }

  if (gate?.targetBootup && gate.targetBootup.ready !== true) {
    targetBootup.value = gate.targetBootup;
  }

  void loadTargetBootup();
});
</script>
