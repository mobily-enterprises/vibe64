<template>
  <v-menu
    v-if="showWorkflowDefinitionMenu"
    v-model="workflowDefinitionMenuOpen"
    :location="menuLocation"
    transition="scale-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :aria-label="buttonAriaLabel"
        :block="block"
        :class="buttonClass"
        :disabled="!toolbar.canCreateSession"
        :icon="iconOnly ? true : undefined"
        :loading="toolbar.createSessionCommand.isRunning"
        :prepend-icon="iconOnly ? undefined : mdiPlus"
        :size="size"
        :title="toolbar.createSessionTitle"
        :variant="variant"
      >
        <v-icon v-if="iconOnly" :icon="mdiPlus" />
        <template v-if="!iconOnly">{{ label }}</template>
      </v-btn>
    </template>

    <v-list
      class="studio-ai-sessions__definition-menu"
      density="comfortable"
      lines="two"
      nav
    >
      <v-list-subheader>Session type</v-list-subheader>
      <v-list-item
        v-for="definition in workflowDefinitions"
        :key="definition.id"
        :disabled="toolbar.createSessionCommand.isRunning"
        :subtitle="definition.description"
        :title="definition.label"
        @click="createSessionFromDefinition(definition.id)"
      />
    </v-list>
  </v-menu>

  <v-btn
    v-else
    :aria-label="buttonAriaLabel"
    :block="block"
    :class="buttonClass"
    :disabled="!toolbar.canCreateSession"
    :icon="iconOnly ? true : undefined"
    :loading="toolbar.createSessionCommand.isRunning"
    :prepend-icon="iconOnly ? undefined : mdiPlus"
    :size="size"
    :title="toolbar.createSessionTitle"
    :variant="variant"
    @click="toolbar.createSession()"
  >
    <v-icon v-if="iconOnly" :icon="mdiPlus" />
    <template v-if="!iconOnly">{{ label }}</template>
  </v-btn>
</template>

<script setup>
import { computed, ref } from "vue";
import { mdiPlus } from "@mdi/js";

const props = defineProps({
  ariaLabel: {
    default: "",
    type: String
  },
  block: {
    default: false,
    type: Boolean
  },
  buttonClass: {
    default: "",
    type: [Array, Object, String]
  },
  iconOnly: {
    default: true,
    type: Boolean
  },
  label: {
    default: "New session",
    type: String
  },
  menuLocation: {
    default: "bottom end",
    type: String
  },
  size: {
    default: "small",
    type: String
  },
  toolbar: {
    default: () => ({}),
    type: Object
  },
  variant: {
    default: "flat",
    type: String
  }
});

const workflowDefinitionMenuOpen = ref(false);
const workflowDefinitions = computed(() => {
  return Array.isArray(props.toolbar.workflowDefinitions) ? props.toolbar.workflowDefinitions : [];
});
const showWorkflowDefinitionMenu = computed(() => {
  return props.toolbar.createSessionMode === "select" && workflowDefinitions.value.length > 0;
});
const buttonAriaLabel = computed(() => {
  return String(props.ariaLabel || props.label || "New session").trim();
});

function createSessionFromDefinition(definitionId = "") {
  workflowDefinitionMenuOpen.value = false;
  props.toolbar.createSession?.(definitionId);
}
</script>

<style scoped>
.studio-ai-sessions__create-button {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: none !important;
  color: #1a73e8 !important;
  height: 2rem;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.studio-ai-sessions__create-button:hover {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
}

.studio-ai-sessions__create-button :deep(.v-icon) {
  color: currentColor;
  font-size: 1.15rem;
}

.studio-ai-sessions__create-button--attention:not(.v-btn--disabled) {
  animation: studio-ai-session-create-pulse 1.7s ease-in-out infinite;
}

.studio-ai-sessions__preview-create-button {
  background: var(--studio-control-active-bg, #e7e7e7) !important;
  border: 1px solid transparent;
  border-radius: var(--studio-control-radius, 7px);
  box-shadow: none !important;
  color: var(--studio-control-text, #202124) !important;
  font-weight: 500;
  letter-spacing: 0;
  min-height: 2rem;
}

.studio-ai-sessions__preview-create-button:hover {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
}

@keyframes studio-ai-session-create-pulse {
  0%,
  100% {
    outline: 0 solid rgba(26, 115, 232, 0.34);
    outline-offset: 0;
    transform: scale(1);
  }

  45% {
    outline: 0.38rem solid rgba(26, 115, 232, 0);
    outline-offset: 0.08rem;
    transform: scale(1.08);
  }
}

.studio-ai-sessions__definition-menu {
  max-width: min(28rem, calc(100vw - 2rem));
  min-width: min(22rem, calc(100vw - 2rem));
}

.studio-ai-sessions__definition-menu :deep(.v-list-item-subtitle) {
  white-space: normal;
}
</style>
