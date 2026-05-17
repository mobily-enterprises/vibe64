<template>
  <DoctorStatusPage
    title="Bootup"
    :lede="lede"
    :status="bootstrap"
    :loading="loading"
    :error="errorMessage"
    stream-enabled
    :stream-endpoint="BOOTSTRAP_STREAM_ENDPOINT"
    :stream-auto-start="streamAutoStart"
    :terminal-endpoint="BOOTSTRAP_TERMINAL_ENDPOINT"
    blocked-label="Bootup blocked"
    ready-label="Bootup ready"
    blocked-title="Bootup blocked"
    ready-title="Bootup ready"
    continue-label="Continue to target bootup"
    continue-emits
    :always-repair-check-ids="['gh-auth', 'codex-auth']"
    @continue="emit('select-tab', 'target-bootup')"
    @refresh="loadBootstrap"
    @status-updated="handleBootstrapUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  BOOTSTRAP_STREAM_ENDPOINT,
  BOOTSTRAP_TERMINAL_ENDPOINT,
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
const loading = ref(false);
const errorMessage = ref("");
const streamAutoStart = ref(false);

const lede = computed(() => {
  if (bootstrap.value?.ready) {
    return "Machine runtime is ready. You can rerun checks or re-authenticate managed tools here.";
  }
  return "Machine runtime must be ready before Studio can operate on the target project.";
});

async function loadBootstrap() {
  loading.value = true;
  errorMessage.value = "";

  try {
    bootstrap.value = await readBootstrapStatus();
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Bootstrap check failed.");
  } finally {
    loading.value = false;
  }
}

function handleBootstrapUpdated(status) {
  bootstrap.value = status;
}

onMounted(() => {
  const gate = props.gate ?? consumeStudioGate("/bootup-setup");

  if (gate?.bootstrap) {
    bootstrap.value = gate.bootstrap;
    streamAutoStart.value = false;
    return;
  }

  streamAutoStart.value = true;
});
</script>
