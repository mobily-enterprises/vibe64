<template>
  <section class="adapter-settings-panel">
    <header class="adapter-settings-panel__header">
      <div>
        <h1>Project Settings</h1>
        <p>{{ adapterLabel }}</p>
      </div>
      <v-btn
        :loading="settingsResource.isLoading"
        size="small"
        type="button"
        variant="tonal"
        @click="settingsResource.refresh"
      >
        Refresh
      </v-btn>
    </header>

    <Vibe64AsyncModuleState
      v-if="settingsResource.isLoading || settingsResource.loadError"
      label="Project settings"
      :loading="settingsResource.isLoading"
      :message="settingsResource.loadError || 'Loading project settings.'"
      min-height="12rem"
      @reload="settingsResource.refresh"
      @retry="settingsResource.refresh"
    />

    <template v-else>
      <v-alert
        v-if="!settingsState?.projectConfig?.ready"
        border="start"
        density="comfortable"
        type="info"
        variant="tonal"
      >
        {{ settingsState?.projectConfig?.message || "Save project configuration before using adapter settings." }}
      </v-alert>

      <section
        v-for="section in sections"
        :key="section.id"
        class="adapter-settings-panel__section"
      >
        <header class="adapter-settings-panel__section-header">
          <div>
            <h2>{{ section.title }}</h2>
            <p v-if="section.description">{{ section.description }}</p>
          </div>
        </header>

        <dl
          v-if="section.fields?.length"
          class="adapter-settings-panel__fields"
        >
          <div
            v-for="field in section.fields"
            :key="field.id"
            class="adapter-settings-panel__field"
          >
            <dt>{{ field.label }}</dt>
            <dd>{{ fieldValue(field) }}</dd>
          </div>
        </dl>

        <template
          v-for="mount in section.components"
          :key="mount.id"
        >
          <component
            :is="componentForMount(mount)"
            v-if="componentForMount(mount)"
            v-bind="mount.props || {}"
          />
          <v-alert
            v-else
            border="start"
            density="comfortable"
            type="warning"
            variant="tonal"
          >
            Adapter settings component is not available: {{ mount.component || mount.id }}
          </v-alert>
        </template>
      </section>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import {
  useAdapterSettings
} from "@/composables/useAdapterSettings.js";

const settingsResource = useAdapterSettings();
const settingsState = computed(() => settingsResource.settings || null);
const sections = computed(() => Array.isArray(settingsState.value?.sections) ? settingsState.value.sections : []);
const adapterLabel = computed(() => settingsState.value?.adapter?.label || "Adapter-owned settings");

const componentRegistry = {};

function componentForMount(mount = {}) {
  return componentRegistry[mount.component] || null;
}

function fieldValue(field = {}) {
  const value = String(field.value ?? "").trim();
  return value || "Not set";
}
</script>

<style scoped>
.adapter-settings-panel {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.adapter-settings-panel__header,
.adapter-settings-panel__section-header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
}

.adapter-settings-panel__header h1,
.adapter-settings-panel__section-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
}

.adapter-settings-panel__header p,
.adapter-settings-panel__section-header p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  margin: 0.25rem 0 0;
}

.adapter-settings-panel__section {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.adapter-settings-panel__fields {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  margin: 0;
}

.adapter-settings-panel__field {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  display: grid;
  gap: 0.2rem;
  min-width: 0;
  padding: 0.75rem;
}

.adapter-settings-panel__field dt {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
  font-weight: 600;
}

.adapter-settings-panel__field dd {
  font-weight: 650;
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
