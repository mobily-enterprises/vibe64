<template>
  <section class="vibe64-setup-panel">
    <div class="vibe64-setup-panel__tabs">
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
      class="vibe64-setup-panel__body"
      role="tabpanel"
      tabindex="0"
      :aria-labelledby="tabId(activeTab)"
    >
      <StudioSetupDoctorScreen
        v-if="activeTab === 'studio-setup'"
        @select-tab="selectTab"
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
  </section>
</template>

<script setup>
import { computed } from "vue";
import AdapterSetupDoctorScreen from "@/components/studio/AdapterSetupDoctorScreen.vue";
import ProjectSetupDoctorScreen from "@/components/studio/ProjectSetupDoctorScreen.vue";
import StudioSetupDoctorScreen from "@/components/studio/StudioSetupDoctorScreen.vue";

const tabs = [
  { label: "Studio Setup", value: "studio-setup" },
  { label: "Adapter Setup", value: "adapter-setup" },
  { label: "Project Setup", value: "project-setup" }
];

const tabValues = new Set(tabs.map((tab) => tab.value));

const props = defineProps({
  modelValue: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["update:modelValue"]);

const activeTab = computed(() => normalizeTab(props.modelValue) || fallbackTab());

function normalizeTab(value) {
  return typeof value === "string" && tabValues.has(value) ? value : "";
}

function fallbackTab() {
  return "studio-setup";
}

function tabId(tab) {
  return `setup-tab-${tab}`;
}

function panelId(tab) {
  return `setup-panel-${tab}`;
}

function selectTab(value) {
  emit("update:modelValue", normalizeTab(value) || fallbackTab());
}
</script>

<style scoped>
.vibe64-setup-panel {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-setup-panel__tabs {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  overflow-x: auto;
}

.vibe64-setup-panel__body {
  min-width: 0;
}

.vibe64-setup-panel :deep(.v-tab) {
  letter-spacing: 0;
  min-height: 48px;
  text-transform: none;
}
</style>
