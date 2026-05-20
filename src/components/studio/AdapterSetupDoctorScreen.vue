<template>
  <DoctorStatusPage
    title="Adapter Setup"
    :lede="lede"
    :status="adapterSetup"
    :loading="loading"
    :error="errorMessage"
    :stream-enabled="streamEnabled"
    auto-repair-enabled
    :stream-auto-start="streamAutoStart"
    :stream-endpoint="ADAPTER_SETUP_STREAM_ENDPOINT"
    :terminal-endpoint="ADAPTER_SETUP_TERMINAL_ENDPOINT"
    blocked-label="Adapter Setup blocked"
    ready-label="Adapter Setup ready"
    blocked-title="Adapter Setup blocked"
    ready-title="Adapter Setup ready"
    quiet-title="Checking project access"
    quiet-lede="AI Studio is checking Git, GitHub, and project access before it starts working."
    continue-label="Continue to Project Setup"
    continue-emits
    doctor-class="adapter-setup-doctor"
    @continue="emit('select-tab', 'project-setup')"
    @refresh="loadAdapterSetup"
    @status-updated="handleAdapterSetupUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  ADAPTER_SETUP_STREAM_ENDPOINT,
  ADAPTER_SETUP_TERMINAL_ENDPOINT,
  readAccountsStatus,
  readAdapterSetupStatus,
  readStudioSetupStatus
} from "../../lib/studioGateApi.js";

const emit = defineEmits(["select-tab"]);

const studioSetup = ref(null);
const adapterSetup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Studio Setup and Accounts before Adapter Setup runs.";
  }
  if (adapterSetup.value?.ready) {
    return `Adapter Setup is ready for: ${adapterSetup.value.targetRoot || "current directory"}`;
  }
  return `Checking Adapter Setup for: ${adapterSetup.value?.targetRoot || "current directory"}`;
});

async function loadAdapterSetup({
  autoStart = true,
  refresh = false
} = {}) {
  loading.value = true;
  errorMessage.value = "";
  streamEnabled.value = false;
  streamAutoStart.value = autoStart;

  try {
    studioSetup.value = await readStudioSetupStatus();

    if (studioSetup.value?.ready !== true) {
      emit("select-tab", "studio-setup");
      return;
    }

    const accounts = await readAccountsStatus();

    if (accounts?.ready !== true) {
      emit("select-tab", "accounts");
      return;
    }

    if (refresh && typeof EventSource !== "function") {
      adapterSetup.value = await readAdapterSetupStatus({
        refresh: true
      });
      return;
    }

    streamEnabled.value = true;
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Adapter Setup check failed.");
  } finally {
    loading.value = false;
  }
}

function handleAdapterSetupUpdated(status) {
  adapterSetup.value = status;
}

onMounted(() => {
  void loadAdapterSetup();
});
</script>
