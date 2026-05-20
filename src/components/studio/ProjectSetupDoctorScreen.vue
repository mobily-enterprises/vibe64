<template>
  <DoctorStatusPage
    title="Project Setup"
    :lede="lede"
    :status="projectSetup"
    status-items-key="stages"
    :loading="loading"
    :error="errorMessage"
    :stream-enabled="streamEnabled"
    auto-repair-enabled
    :stream-auto-start="streamAutoStart"
    :stream-endpoint="PROJECT_SETUP_STREAM_ENDPOINT"
    :terminal-endpoint="PROJECT_SETUP_TERMINAL_ENDPOINT"
    blocked-label="Project Setup blocked"
    ready-label="Project Setup ready"
    blocked-title="Project Setup blocked"
    ready-title="Project Setup ready"
    quiet-title="Preparing your project"
    quiet-lede="AI Studio is creating the starter files, installing dependencies, and checking the project before Autopilot starts."
    continue-label="Continue to home"
    continue-to="/home"
    doctor-class="project-setup-doctor"
    :always-repair-check-ids="['dependencies']"
    @refresh="loadProjectSetup"
    @status-updated="handleProjectSetupUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  PROJECT_SETUP_STREAM_ENDPOINT,
  PROJECT_SETUP_TERMINAL_ENDPOINT,
  readAccountsStatus,
  readProjectSetupStatus,
  readStudioSetupStatus,
  readAdapterSetupStatus
} from "../../lib/studioGateApi.js";

const emit = defineEmits(["select-tab"]);

const projectSetup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Studio Setup, Accounts, and Adapter Setup before Project Setup runs.";
  }
  if (projectSetup.value?.ready) {
    return `Project Setup is ready for: ${projectSetup.value.targetRoot || "current directory"}`;
  }
  return `Checking Project Setup for: ${projectSetup.value?.targetRoot || "current directory"}`;
});

async function loadProjectSetup({
  autoStart = true,
  refresh = false
} = {}) {
  loading.value = true;
  errorMessage.value = "";
  streamEnabled.value = false;
  streamAutoStart.value = autoStart;

  try {
    const studioSetup = await readStudioSetupStatus();

    if (studioSetup?.ready !== true) {
      emit("select-tab", "studio-setup");
      return;
    }

    const accounts = await readAccountsStatus();

    if (accounts?.ready !== true) {
      emit("select-tab", "accounts");
      return;
    }

    const adapterSetup = await readAdapterSetupStatus();

    if (adapterSetup?.ready !== true) {
      emit("select-tab", "adapter-setup");
      return;
    }

    if (refresh && typeof EventSource !== "function") {
      projectSetup.value = await readProjectSetupStatus({
        refresh: true
      });
      return;
    }

    streamEnabled.value = true;
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Project Setup check failed.");
  } finally {
    loading.value = false;
  }
}

function handleProjectSetupUpdated(status) {
  projectSetup.value = status;
}

onMounted(() => {
  void loadProjectSetup();
});
</script>
