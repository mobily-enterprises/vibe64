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
import ShellLayout from "@/components/ShellLayout.vue";
import DoctorStatusPage from "@/components/studio/DoctorStatusPage.vue";
import {
  BOOTSTRAP_STREAM_ENDPOINT,
  BOOTSTRAP_TERMINAL_ENDPOINT,
  consumeStudioGate,
  readBootstrapStatus
} from "@/lib/studioApi.js";

const bootstrap = ref(null);
const loading = ref(false);
const error = ref("");
const streamAutoStart = ref(false);

const lede = computed(() => {
  if (bootstrap.value?.ready) {
    return "Machine runtime is ready. You can rerun checks or re-authenticate managed tools here.";
  }
  return "Machine runtime must be ready before Studio can operate on the target app.";
});

async function loadBootstrap() {
  loading.value = true;
  error.value = "";
  try {
    bootstrap.value = await readBootstrapStatus();
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "Bootstrap check failed.");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  const gate = consumeStudioGate("/bootup");
  if (gate?.bootstrap) {
    bootstrap.value = gate.bootstrap;
    streamAutoStart.value = false;
    return;
  }
  streamAutoStart.value = true;
});

</script>

<template>
  <ShellLayout title="JSKIT AI Studio" subtitle="Local operator">
    <DoctorStatusPage
      title="Bootup"
      :lede="lede"
      :status="bootstrap"
      :loading="loading"
      :error="error"
      :stream-enabled="true"
      :stream-endpoint="BOOTSTRAP_STREAM_ENDPOINT"
      :stream-auto-start="streamAutoStart"
      :terminal-endpoint="BOOTSTRAP_TERMINAL_ENDPOINT"
      blocked-label="Bootup blocked"
      ready-label="Bootup ready"
      blocked-title="Bootup blocked"
      ready-title="Bootup ready"
      continue-label="Continue to app bootup"
      continue-to="/app-bootup"
      :always-repair-check-ids="['gh-auth', 'codex-auth']"
      @refresh="loadBootstrap"
      @status-updated="bootstrap = $event"
    />
  </ShellLayout>
</template>
