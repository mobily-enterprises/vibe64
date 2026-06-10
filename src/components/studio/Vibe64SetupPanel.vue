<template>
  <section class="vibe64-setup-panel">
    <div v-if="hasMultipleTabs" class="vibe64-setup-panel__tabs">
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
      :role="hasMultipleTabs ? 'tabpanel' : undefined"
      :tabindex="hasMultipleTabs ? 0 : undefined"
      :aria-labelledby="hasMultipleTabs ? tabId(activeTab) : undefined"
    >
      <ProjectSetupDoctorScreen
        v-if="activeTab === 'project-setup'"
        @select-tab="selectTab"
      />
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import ProjectSetupDoctorScreen from "@/components/studio/ProjectSetupDoctorScreen.vue";

const tabs = [
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
const hasMultipleTabs = computed(() => tabs.length > 1);

function normalizeTab(value) {
  return typeof value === "string" && tabValues.has(value) ? value : "";
}

function fallbackTab() {
  return "project-setup";
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
