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
    <section class="setup" aria-labelledby="setup-title">
      <header class="setup__header">
        <p class="setup__eyebrow">Studio readiness</p>
        <h1 id="setup-title" class="setup__title">Setup</h1>
      </header>

      <ProjectSelectionGate>
        <ProjectTypeGate>
          <template #default>
            <div class="setup__tabs">
              <v-tabs
                :model-value="activeTab"
                aria-label="Setup sections"
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
              class="setup__panel"
              role="tabpanel"
              tabindex="0"
              :aria-labelledby="tabId(activeTab)"
            >
              <StudioSetupDoctorScreen
                v-if="activeTab === 'studio-setup'"
                @select-tab="selectTab"
              />
              <AccountsSetup
                v-else-if="activeTab === 'accounts'"
                @continue="selectTab('adapter-setup')"
              />
              <AdapterSetupDoctorScreen
                v-else-if="activeTab === 'adapter-setup'"
                @select-tab="selectTab"
              />
              <ProjectSetupDoctorScreen
                v-else-if="activeTab === 'project-setup'"
                @select-tab="selectTab"
              />
            </div>
          </template>
        </ProjectTypeGate>
      </ProjectSelectionGate>
    </section>
  </ShellLayout>
</template>

<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellLayout from "@/components/ShellLayout.vue";
import AccountsSetup from "@/components/studio/AccountsSetup.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";

import AdapterSetupDoctorScreen from "../components/studio/AdapterSetupDoctorScreen.vue";
import ProjectSetupDoctorScreen from "../components/studio/ProjectSetupDoctorScreen.vue";
import StudioSetupDoctorScreen from "../components/studio/StudioSetupDoctorScreen.vue";

const tabs = [
  { label: "Studio Setup", value: "studio-setup" },
  { label: "Accounts", value: "accounts" },
  { label: "Adapter Setup", value: "adapter-setup" },
  { label: "Project Setup", value: "project-setup" }
];

const tabValues = new Set(tabs.map((tab) => tab.value));

const route = useRoute();
const router = useRouter();

function normalizeTab(value) {
  return typeof value === "string" && tabValues.has(value) ? value : "";
}

function fallbackTab() {
  return "studio-setup";
}

const activeTab = computed(() => normalizeTab(route.query.tab) || fallbackTab());

function tabId(tab) {
  return `setup-tab-${tab}`;
}

function panelId(tab) {
  return `setup-panel-${tab}`;
}

function tabRoute(tab) {
  return {
    path: "/setup",
    query: {
      ...route.query,
      tab
    }
  };
}

function selectTab(value, { replace = false } = {}) {
  const tab = normalizeTab(value) || "studio-setup";

  if (route.path === "/setup" && route.query.tab === tab) {
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
.setup {
  width: min(100%, 68rem);
  min-width: 0;
  margin: 0 auto;
  padding: clamp(1rem, 2vw, 1.5rem);
}

.setup__header {
  display: grid;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.setup__eyebrow {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.setup__title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}

.setup__tabs {
  margin-bottom: 0.75rem;
  overflow-x: auto;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.setup__panel {
  min-width: 0;
}

:deep(.v-tab) {
  min-height: 48px;
  letter-spacing: 0;
  text-transform: none;
}
</style>
