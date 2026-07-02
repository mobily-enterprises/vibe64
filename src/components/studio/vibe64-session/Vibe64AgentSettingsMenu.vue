<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    :location="location"
    transition="scale-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        aria-label="AI parameters"
        class="vibe64-agent-settings-menu__button"
        density="comfortable"
        :disabled="disabled"
        :icon="mdiCogOutline"
        size="small"
        :title="controlsTitle"
        type="button"
        variant="flat"
      />
    </template>

    <div
      class="vibe64-agent-settings-menu"
      aria-label="AI controls"
    >
      <div class="vibe64-agent-settings-menu__header">
        <v-icon :icon="mdiBrain" size="20" />
        <div class="vibe64-agent-settings-menu__heading">
          <strong>AI Controls</strong>
          <span>{{ providerLabel }} - {{ summary }}</span>
        </div>
      </div>

      <section
        v-for="parameter in parameters"
        :key="parameter.id"
        class="vibe64-agent-settings-menu__section"
      >
        <div class="vibe64-agent-settings-menu__label">
          {{ parameter.label }}
        </div>
        <div class="vibe64-agent-settings-menu__options">
          <button
            v-for="option in parameter.options"
            :key="`${parameter.id}:${option.value}`"
            class="vibe64-agent-settings-menu__option"
            :class="{ 'vibe64-agent-settings-menu__option--active': parameterSelected(parameter.id, option.value) }"
            type="button"
            :aria-pressed="parameterSelected(parameter.id, option.value)"
            @click="updateParameter(parameter.id, option.value)"
          >
            <span>{{ option.label }}</span>
            <v-icon
              v-if="parameterSelected(parameter.id, option.value)"
              :icon="mdiCheck"
              size="15"
            />
          </button>
        </div>
      </section>
    </div>
  </v-menu>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiBrain,
  mdiCheck,
  mdiCogOutline
} from "@mdi/js";
import {
  VIBE64_AGENT_PROVIDERS,
  displayVibe64AgentSetting,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";

const props = defineProps({
  agentSettings: {
    default: () => ({}),
    type: Object
  },
  disabled: {
    default: false,
    type: Boolean
  },
  location: {
    default: "top start",
    type: String
  }
});

const emit = defineEmits([
  "update-setting"
]);

const menuOpen = ref(false);
const currentSettings = computed(() => normalizeVibe64AgentSettings(props.agentSettings));
const provider = computed(() => (
  VIBE64_AGENT_PROVIDERS.find((candidate) => candidate.id === currentSettings.value.providerId) ||
  VIBE64_AGENT_PROVIDERS[0]
));
const providerLabel = computed(() => provider.value?.label || "AI");
const parameters = computed(() => (
  Array.isArray(provider.value?.parameters) ? provider.value.parameters : []
));
const summary = computed(() => {
  const text = parameters.value
    .map((parameter) => displayVibe64AgentSetting(
      currentSettings.value.providerId,
      parameter.id,
      parameterValue(parameter.id)
    ))
    .filter(Boolean)
    .join(" / ");
  return text || "Automatic";
});
const controlsTitle = computed(() => `AI controls: ${summary.value}`);

function parameterValue(parameterId = "") {
  return String(currentSettings.value?.[parameterId] || "");
}

function parameterSelected(parameterId = "", value = "") {
  return parameterValue(parameterId) === String(value || "");
}

function updateParameter(parameterId = "", value = "") {
  emit("update-setting", parameterId, value);
}
</script>

<style scoped>
.vibe64-agent-settings-menu__button {
  background: var(--studio-control-bg, #fff) !important;
  border: 1px solid var(--studio-control-border, rgba(17, 24, 39, 0.12));
  border-radius: 7px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08) !important;
  color: var(--studio-control-text, #202124) !important;
  flex: 0 0 2rem;
  height: 2rem;
  letter-spacing: 0;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.vibe64-agent-settings-menu__button:hover {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
}

.vibe64-agent-settings-menu {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.55rem;
  min-width: min(20rem, calc(100vw - 2rem));
  padding: 0.55rem;
}

.vibe64-agent-settings-menu__header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.55rem;
  padding: 0.18rem 0.12rem 0.55rem;
}

.vibe64-agent-settings-menu__heading {
  display: grid;
  gap: 0.08rem;
  min-width: 0;
}

.vibe64-agent-settings-menu__heading strong {
  font-size: 0.9rem;
  font-weight: 650;
  line-height: 1.2;
}

.vibe64-agent-settings-menu__heading span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-agent-settings-menu__section {
  display: grid;
  gap: 0.32rem;
}

.vibe64-agent-settings-menu__label {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.2;
  padding-inline: 0.12rem;
  text-transform: uppercase;
}

.vibe64-agent-settings-menu__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
}

.vibe64-agent-settings-menu__option {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.16);
  border-radius: 7px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.82rem;
  gap: 0.34rem;
  letter-spacing: 0;
  line-height: 1.2;
  min-height: 2rem;
  padding: 0.34rem 0.52rem;
  text-align: left;
}

.vibe64-agent-settings-menu__option:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.vibe64-agent-settings-menu__option--active {
  background: rgba(var(--v-theme-primary), 0.09);
  border-color: rgba(var(--v-theme-primary), 0.36);
  color: rgb(var(--v-theme-primary));
  font-weight: 650;
}
</style>
