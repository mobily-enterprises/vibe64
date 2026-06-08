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
    quiet-lede="Vibe64 is creating the starter files, installing dependencies, and checking the project before Autopilot starts."
    continue-label="Continue to project"
    :continue-to="continueTo"
    doctor-class="project-setup-doctor"
    :always-repair-check-ids="['dependencies']"
    @refresh="loadProjectSetup"
    @status-updated="handleProjectSetupUpdated"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  PROJECT_SETUP_STREAM_ENDPOINT,
  PROJECT_SETUP_TERMINAL_ENDPOINT,
  readProjectSetupStatus,
  readStudioSetupStatus
} from "../../lib/studioGateApi.js";

const route = useRoute();

const projectSetup = ref(null);
const loading = ref(false);
const errorMessage = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);
const projectSlug = computed(() => firstRouteParam(route.params.slug));
const continueTo = computed(() => projectSlug.value ? `/app/${encodeURIComponent(projectSlug.value)}` : "/app/manage");

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Studio Setup before Project Setup runs.";
  }
  if (projectSetup.value?.ready) {
    return `Project Setup is ready for: ${projectSetup.value.targetRoot || "selected project"}`;
  }
  return `Checking Project Setup for: ${projectSetup.value?.targetRoot || "selected project"}`;
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
      errorMessage.value = "Studio Setup is not ready. Open Management mode to complete Studio Setup.";
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

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

onMounted(() => {
  void loadProjectSetup();
});
</script>
