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
    quiet-title="Project Setup"
    quiet-lede=""
    :show-continue="false"
    doctor-class="project-setup-doctor"
    :always-repair-check-ids="['dependencies']"
    @refresh="loadProjectSetup"
    @status-updated="handleProjectSetupUpdated"
  />
</template>

<script setup>
import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  useProjectSetupDoctorScreen
} from "@/composables/useProjectSetupDoctorScreen.js";

const {
  errorMessage,
  handleProjectSetupUpdated,
  lede,
  loadProjectSetup,
  loading,
  PROJECT_SETUP_STREAM_ENDPOINT,
  PROJECT_SETUP_TERMINAL_ENDPOINT,
  projectSetup,
  streamAutoStart,
  streamEnabled
} = useProjectSetupDoctorScreen();
</script>
