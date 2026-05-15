<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<template>
  <ShellLayout>
    <section class="bootup-setup" aria-labelledby="bootup-setup-title">
      <header class="bootup-setup__header">
        <p class="bootup-setup__eyebrow">Studio readiness</p>
        <h1 id="bootup-setup-title" class="bootup-setup__title">Bootup/Setup</h1>
      </header>

      <div class="bootup-setup__tabs">
        <v-tabs
          :model-value="activeTab"
          aria-label="Bootup setup sections"
          color="primary"
          density="comfortable"
          show-arrows
          @update:model-value="selectTab"
        >
          <v-tab
            v-for="tab in tabs"
            :id="tabId(tab.value)"
            :key="tab.value"
            :aria-controls="panelId(tab.value)"
            :value="tab.value"
          >
            {{ tab.label }}
          </v-tab>
        </v-tabs>
      </div>

      <div
        :id="panelId(activeTab)"
        class="bootup-setup__panel"
        role="tabpanel"
        tabindex="0"
        :aria-labelledby="tabId(activeTab)"
      >
        <BootupDoctorScreen
          v-if="activeTab === 'bootup'"
          :gate="initialGate"
          @select-tab="selectTab"
        />
        <AppBootupDoctorScreen
          v-else-if="activeTab === 'app-bootup'"
          :gate="initialGate"
          @select-tab="selectTab"
        />
        <AppSetupDoctorScreen
          v-else-if="activeTab === 'app-setup'"
          :gate="initialGate"
          @select-tab="selectTab"
        />
      </div>
    </section>
  </ShellLayout>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellLayout from "@/components/ShellLayout.vue";

import AppBootupDoctorScreen from "../components/studio/AppBootupDoctorScreen.vue";
import AppSetupDoctorScreen from "../components/studio/AppSetupDoctorScreen.vue";
import BootupDoctorScreen from "../components/studio/BootupDoctorScreen.vue";
import { consumeStudioGate } from "../lib/studioApi";

const tabs = [
  { label: "Bootup", value: "bootup" },
  { label: "App Bootup", value: "app-bootup" },
  { label: "App setup", value: "app-setup" }
];

const tabValues = new Set(tabs.map((tab) => tab.value));

const route = useRoute();
const router = useRouter();
const initialGate = ref(consumeStudioGate("/bootup-setup"));

function normalizeTab(value) {
  return typeof value === "string" && tabValues.has(value) ? value : "";
}

function fallbackTab() {
  return normalizeTab(initialGate.value?.tab) || "bootup";
}

const activeTab = computed(() => normalizeTab(route.query.tab) || fallbackTab());

function tabId(tab) {
  return `bootup-setup-tab-${tab}`;
}

function panelId(tab) {
  return `bootup-setup-panel-${tab}`;
}

function tabRoute(tab) {
  return {
    path: "/bootup-setup",
    query: {
      ...route.query,
      tab
    }
  };
}

function selectTab(value, { replace = false } = {}) {
  const tab = normalizeTab(value) || "bootup";

  if (route.path === "/bootup-setup" && route.query.tab === tab) {
    return undefined;
  }

  return replace ? router.replace(tabRoute(tab)) : router.push(tabRoute(tab));
}

watch(
  () => route.query.tab,
  (tab) => {
    if (!normalizeTab(tab)) {
      void selectTab(fallbackTab(), { replace: true });
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.bootup-setup {
  width: min(100%, 68rem);
  min-width: 0;
  margin: 0 auto;
  padding: clamp(1rem, 2vw, 1.5rem);
}

.bootup-setup__header {
  display: grid;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.bootup-setup__eyebrow {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bootup-setup__title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}

.bootup-setup__tabs {
  margin-bottom: 0.75rem;
  overflow-x: auto;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.bootup-setup__panel {
  min-width: 0;
}

:deep(.v-tab) {
  min-height: 48px;
  letter-spacing: 0;
  text-transform: none;
}
</style>
