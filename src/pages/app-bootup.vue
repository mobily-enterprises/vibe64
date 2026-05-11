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
  TARGET_APP_STREAM_ENDPOINT,
  TARGET_APP_TERMINAL_ENDPOINT,
  consumeStudioGate,
  readBootstrapStatus,
} from "@/lib/studioApi.js";

const router = useRouter();
const bootstrap = ref(null);
const targetApp = ref(null);
const loading = ref(false);
const error = ref("");
const streamEnabled = ref(false);
const streamAutoStart = ref(true);

const lede = computed(() => {
  if (loading.value && !streamEnabled.value) {
    return "Checking Bootup before App Bootup runs.";
  }
  if (targetApp.value?.ready) {
    return `Target root is ready: ${targetApp.value.targetRoot || "current directory"}`;
  }
  return `Target root: ${targetApp.value?.targetRoot || "checking"}`;
});

async function loadTargetApp({
  autoStart = true
} = {}) {
  loading.value = true;
  error.value = "";
  try {
    streamEnabled.value = false;
    streamAutoStart.value = autoStart;
    bootstrap.value = await readBootstrapStatus();
    if (bootstrap.value?.ready !== true) {
      await router.replace("/bootup");
      return;
    }
    streamEnabled.value = true;
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "Target app check failed.");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  const gate = consumeStudioGate("/app-bootup");
  if (gate?.bootstrap?.ready === true && gate?.targetApp) {
    bootstrap.value = gate.bootstrap;
    targetApp.value = gate.targetApp;
    streamEnabled.value = true;
    streamAutoStart.value = false;
    return;
  }

  void loadTargetApp();
});
</script>

<template>
  <ShellLayout title="JSKIT AI Studio" subtitle="Local operator">
    <DoctorStatusPage
      title="App Bootup"
      :lede="lede"
      :status="targetApp"
      :loading="loading"
      :error="error"
      :stream-enabled="streamEnabled"
      :stream-endpoint="TARGET_APP_STREAM_ENDPOINT"
      :stream-auto-start="streamAutoStart"
      :terminal-endpoint="TARGET_APP_TERMINAL_ENDPOINT"
      blocked-label="App blocked"
      ready-label="App ready"
      blocked-title="Target app blocked"
      ready-title="Target app ready"
      continue-label="Continue to app setup"
      continue-to="/app-setup"
      doctor-class="target-app-doctor"
      @refresh="loadTargetApp"
      @status-updated="targetApp = $event"
    />
  </ShellLayout>
</template>
