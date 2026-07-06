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
    quiet-lede="Vibe64 is checking host runtime tools before it starts."
    :actions-enabled="actionsEnabled"
    :actions-disabled-message="actionsDisabledMessage"
    :continue-label="continueLabel"
    :continue-emits="continueEnabled"
    @continue="emit('select-tab', 'project-setup')"
    @refresh="loadStudioSetup"
    @status-updated="handleStudioSetupUpdated"
  />
</template>

<script setup>
import DoctorStatusPage from "./DoctorStatusPage.vue";
import {
  studioSetupDoctorScreenEmits,
  studioSetupDoctorScreenProps,
  useStudioSetupDoctorScreen
} from "@/composables/useStudioSetupDoctorScreen.js";

const emit = defineEmits(studioSetupDoctorScreenEmits);
const props = defineProps(studioSetupDoctorScreenProps);

const {
  errorMessage,
  handleStudioSetupUpdated,
  lede,
  loadStudioSetup,
  loading,
  STUDIO_SETUP_STREAM_ENDPOINT,
  STUDIO_SETUP_TERMINAL_ENDPOINT,
  streamAutoStart,
  studioSetup
} = useStudioSetupDoctorScreen(props);
</script>
