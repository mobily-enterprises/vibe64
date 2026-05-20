<template>
  <DoctorStatusPage
    title="Studio Setup"
    :lede="lede"
    :status="studioSetup"
    :loading="loading"
    :error="errorMessage"
    stream-enabled
    auto-repair-enabled
    :stream-endpoint="STUDIO_SETUP_STREAM_ENDPOINT"
    :stream-auto-start="streamAutoStart"
    :terminal-endpoint="STUDIO_SETUP_TERMINAL_ENDPOINT"
    blocked-label="Studio Setup blocked"
    ready-label="Studio Setup ready"
    blocked-title="Studio Setup blocked"
    ready-title="Studio Setup ready"
    quiet-title="Checking your machine"
    quiet-lede="AI Studio is checking Docker and local tools before it starts."
    continue-label="Continue to Accounts"
    continue-emits
    @continue="emit('select-tab', 'accounts')"
    @refresh="loadStudioSetup"
    @status-updated="handleStudioSetupUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  STUDIO_SETUP_STREAM_ENDPOINT,
  STUDIO_SETUP_TERMINAL_ENDPOINT,
  readStudioSetupStatus
} from "../../lib/studioGateApi.js";

const emit = defineEmits(["select-tab"]);

const studioSetup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamAutoStart = ref(false);

const lede = computed(() => {
  if (studioSetup.value?.ready) {
    return "Machine runtime is ready. Continue to connect Codex and GitHub.";
  }
  return "Machine runtime must be ready before Studio can operate on the target project.";
});

async function loadStudioSetup({
  refresh = false
} = {}) {
  loading.value = true;
  errorMessage.value = "";

  try {
    studioSetup.value = await readStudioSetupStatus({
      refresh
    });
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Studio Setup check failed.");
  } finally {
    loading.value = false;
  }
}

function handleStudioSetupUpdated(status) {
  studioSetup.value = status;
}

onMounted(() => {
  streamAutoStart.value = true;
});
</script>
