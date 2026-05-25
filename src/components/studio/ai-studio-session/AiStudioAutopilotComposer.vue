<template>
  <form
    class="studio-autopilot__control-form"
    @submit.prevent="$emit('submit')"
  >
    <template
      v-for="field in selectedControlFields"
      :key="field.name"
    >
      <AiStudioAutopilotPromptTextarea
        v-if="field.kind === 'textarea'"
        :model-value="selectedControlValues[field.name] || ''"
        class="studio-autopilot__input"
        :disabled="running"
        :label="field.label"
        :rows="field.rows || 3"
        :session-id="sessionId"
        variant="outlined"
        @update:model-value="$emit('update-value', field.name, $event)"
      />
      <v-text-field
        v-else
        class="studio-autopilot__input"
        :disabled="running"
        :label="field.label"
        :model-value="selectedControlValues[field.name] || ''"
        :placeholder="field.placeholder"
        variant="outlined"
        @update:model-value="$emit('update-value', field.name, $event)"
      />
    </template>

    <AiStudioAutopilotComposerActions class="studio-autopilot__composer-actions-row">
      <template #submit>
        <div class="studio-autopilot__actions studio-autopilot__composer-submit-actions">
          <v-btn
            color="primary"
            :disabled="!canSubmitSelectedControl"
            :loading="running"
            :prepend-icon="mdiSend"
            type="submit"
            variant="flat"
          >
            {{ selectedControl.label }}
          </v-btn>

          <v-btn
            v-if="!selectedControlIsPrimary"
            :disabled="running"
            :prepend-icon="mdiClose"
            type="button"
            variant="tonal"
            @click="$emit('cancel')"
          >
            Cancel
          </v-btn>
        </div>
      </template>

      <template #workflow>
        <div
          v-if="workflowControls.length"
          class="studio-autopilot__actions studio-autopilot__screen-actions studio-autopilot__screen-actions--composer"
        >
          <v-btn
            v-for="control in workflowControls"
            :key="control.id"
            :color="control.buttonColor"
            :disabled="control.disabled"
            :loading="control.loading"
            :prepend-icon="control.icon"
            type="button"
            :variant="control.buttonVariant"
            @click="$emit('activate-control', control.sourceControl || control)"
          >
            {{ control.label }}
          </v-btn>
        </div>
      </template>
    </AiStudioAutopilotComposerActions>
  </form>
</template>

<script setup>
import {
  mdiClose,
  mdiSend
} from "@mdi/js";
import AiStudioAutopilotComposerActions from "@/components/studio/ai-studio-session/AiStudioAutopilotComposerActions.vue";
import AiStudioAutopilotPromptTextarea from "@/components/studio/ai-studio-session/AiStudioAutopilotPromptTextarea.vue";

defineEmits([
  "activate-control",
  "cancel",
  "submit",
  "update-value"
]);

defineProps({
  canSubmitSelectedControl: {
    default: false,
    type: Boolean
  },
  running: {
    default: false,
    type: Boolean
  },
  selectedControl: {
    default: () => ({}),
    type: Object
  },
  selectedControlFields: {
    default: () => [],
    type: Array
  },
  selectedControlIsPrimary: {
    default: false,
    type: Boolean
  },
  selectedControlValues: {
    default: () => ({}),
    type: Object
  },
  sessionId: {
    default: "",
    type: String
  },
  workflowControls: {
    default: () => [],
    type: Array
  }
});
</script>

<style scoped>
.studio-autopilot__control-form {
  display: grid;
  gap: 0.45rem;
  margin-top: 0.1rem;
  max-width: 52rem;
  width: 100%;
}

.studio-autopilot__input {
  text-align: left;
  width: 100%;
}

.studio-autopilot__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.studio-autopilot__control-form :deep(.studio-autopilot-prompt-textarea) {
  gap: 0.35rem;
}

.studio-autopilot__control-form :deep(.v-input),
.studio-autopilot__control-form :deep(.v-field) {
  overflow: visible;
}

.studio-autopilot__control-form :deep(.v-field__input textarea) {
  min-height: 5.4rem;
}

.studio-autopilot__composer-actions-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: space-between;
  width: 100%;
}

.studio-autopilot__composer-submit-actions {
  justify-content: flex-end;
  margin-left: auto;
  order: 2;
}

.studio-autopilot__screen-actions.studio-autopilot__screen-actions--composer {
  align-self: center;
  flex: 1 1 auto;
  justify-content: flex-start;
  margin-top: 0;
  order: 1;
  width: auto;
}
</style>
