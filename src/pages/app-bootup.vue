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
  TARGET_APP_TERMINAL_ENDPOINT,
  readBootstrapStatus,
  readTargetAppStatus
} from "@/lib/studioApi.js";

const router = useRouter();
const bootstrap = ref(null);
const targetApp = ref(null);
const loading = ref(false);
const error = ref("");

const lede = computed(() => {
  if (targetApp.value?.ready) {
    return `Target root is ready: ${targetApp.value.targetRoot || "current directory"}`;
  }
  return `Target root: ${targetApp.value?.targetRoot || "checking"}`;
});

async function loadTargetApp() {
  loading.value = true;
  error.value = "";
  try {
    bootstrap.value = await readBootstrapStatus();
    if (bootstrap.value?.ready !== true) {
      await router.replace("/bootup");
      return;
    }
    targetApp.value = await readTargetAppStatus();
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "Target app check failed.");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
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
      :terminal-endpoint="TARGET_APP_TERMINAL_ENDPOINT"
      blocked-label="App blocked"
      ready-label="App ready"
      blocked-title="Target app blocked"
      ready-title="Target app ready"
      continue-label="Continue to home"
      continue-to="/home"
      doctor-class="target-app-doctor"
      @refresh="loadTargetApp"
    />
  </ShellLayout>
</template>
