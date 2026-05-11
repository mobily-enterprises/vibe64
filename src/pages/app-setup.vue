<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import ShellLayout from "@/components/ShellLayout.vue";
import DoctorStatusPage from "@/components/studio/DoctorStatusPage.vue";
import {
  APP_SETUP_STREAM_ENDPOINT,
  APP_SETUP_TERMINAL_ENDPOINT,
  consumeStudioGate,
  readBootstrapStatus,
  readTargetAppStatus
} from "@/lib/studioApi.js";

const router = useRouter();
const appSetup = ref(null);
const loading = ref(false);
const error = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Bootup and App Bootup before App Setup runs.";
  }
  if (appSetup.value?.ready) {
    return `Target app is setup-ready: ${appSetup.value.targetRoot || "current directory"}`;
  }
  return `Target app setup runs sequentially for: ${appSetup.value?.targetRoot || "checking"}`;
});

async function loadAppSetup({
  autoStart = true
} = {}) {
  loading.value = true;
  error.value = "";
  try {
    streamEnabled.value = false;
    streamAutoStart.value = autoStart;
    const bootstrap = await readBootstrapStatus();
    if (bootstrap?.ready !== true) {
      await router.replace("/bootup");
      return;
    }
    const targetApp = await readTargetAppStatus();
    if (targetApp?.ready !== true) {
      await router.replace("/app-bootup");
      return;
    }
    streamEnabled.value = true;
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "App setup check failed.");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  const gate = consumeStudioGate("/app-setup");
  if (gate?.bootstrap?.ready === true && gate?.targetApp?.ready === true && gate?.appSetup) {
    appSetup.value = gate.appSetup;
    streamEnabled.value = true;
    streamAutoStart.value = false;
    return;
  }

  void loadAppSetup();
});
</script>

<template>
  <ShellLayout title="JSKIT AI Studio" subtitle="Local operator">
    <DoctorStatusPage
      title="App Setup"
      :lede="lede"
      :status="appSetup"
      :loading="loading"
      :error="error"
      :stream-enabled="streamEnabled"
      :stream-endpoint="APP_SETUP_STREAM_ENDPOINT"
      :stream-auto-start="streamAutoStart"
      status-items-key="stages"
      :terminal-endpoint="APP_SETUP_TERMINAL_ENDPOINT"
      blocked-label="Setup blocked"
      ready-label="Setup ready"
      blocked-title="App setup blocked"
      ready-title="App setup ready"
      continue-label="Continue to home"
      continue-to="/home"
      doctor-class="app-setup-doctor"
      :always-repair-check-ids="['dependencies']"
      @refresh="loadAppSetup"
      @status-updated="appSetup = $event"
    />
  </ShellLayout>
</template>
