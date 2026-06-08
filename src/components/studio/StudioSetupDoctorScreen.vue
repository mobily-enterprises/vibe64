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
    quiet-title="Checking your environment"
    quiet-lede="Vibe64 is checking Docker and runtime tools before it starts."
    :continue-label="continueLabel"
    :continue-emits="continueEnabled"
    @continue="emit('select-tab', 'project-setup')"
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
defineProps({
  continueEnabled: {
    default: true,
    type: Boolean
  },
  continueLabel: {
    default: "Continue to Project Setup",
    type: String
  }
});

const studioSetup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamAutoStart = ref(false);

const lede = computed(() => {
  if (studioSetup.value?.ready) {
    return "Environment runtime is ready.";
  }
  return "Environment runtime must be ready before Vibe64 can operate on workspaces.";
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
