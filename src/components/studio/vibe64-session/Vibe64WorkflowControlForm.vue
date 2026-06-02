<template>
  <component
    :is="rootTag"
    class="vibe64-workflow-control-form"
    :class="[
      `vibe64-workflow-control-form--${layout}`,
      { 'vibe64-workflow-control-form--inline-submit': inlineSubmitActive },
      { 'vibe64-workflow-control-form--sticky-actions': stickyActions }
    ]"
    @submit.prevent="submitFromForm"
  >
    <template
      v-for="field in selectedControlFields"
      :key="field.name"
    >
      <div
        v-if="field.kind === 'textarea' && attachTextarea"
        class="vibe64-workflow-control-form__prompt-shell"
        :class="{ 'vibe64-workflow-control-form__prompt-shell--inline-submit': inlineSubmitForField(field) }"
      >
        <Vibe64AutopilotPromptTextarea
          :model-value="selectedControlValues[field.name] || ''"
          :attachments-enabled="attachmentsEnabled"
          class="vibe64-workflow-control-form__input"
          :disabled="fieldsDisabled"
          :label="field.label"
          :placeholder="field.placeholder"
          :rows="field.rows || textareaRows"
          :session-id="sessionId"
          variant="outlined"
          @update:model-value="$emit('update-value', field.name, $event)"
        />

        <v-btn
          v-if="inlineSubmitForField(field)"
          :aria-label="inlineSubmitButtonLabel"
          class="vibe64-workflow-control-form__inline-submit"
          :class="{ 'vibe64-workflow-control-form__inline-submit--interrupt': interruptVisible }"
          :color="interruptVisible ? 'error' : 'primary'"
          :disabled="inlineSubmitButtonDisabled"
          icon
          :loading="inlineSubmitButtonLoading"
          :title="inlineSubmitButtonLabel"
          type="button"
          variant="flat"
          @click="handleInlineSubmitButton"
        >
          <v-icon :icon="interruptVisible ? mdiStop : mdiSend" size="20" />
        </v-btn>
      </div>
      <v-textarea
        v-else-if="field.kind === 'textarea'"
        auto-grow
        class="vibe64-workflow-control-form__input"
        :disabled="fieldsDisabled"
        hide-details="auto"
        :label="field.label"
        :model-value="selectedControlValues[field.name] || ''"
        :placeholder="field.placeholder"
        :rows="field.rows || textareaRows"
        variant="outlined"
        @update:model-value="$emit('update-value', field.name, $event)"
      />
      <v-text-field
        v-else
        class="vibe64-workflow-control-form__input"
        :disabled="fieldsDisabled"
        hide-details="auto"
        :label="field.label"
        :model-value="selectedControlValues[field.name] || ''"
        :placeholder="field.placeholder"
        variant="outlined"
        @update:model-value="$emit('update-value', field.name, $event)"
      />
    </template>

    <div
      v-if="actionsVisible"
      class="vibe64-workflow-control-form__actions"
    >
      <div
        v-if="!inlineSubmitActive || cancelVisible"
        class="vibe64-workflow-control-form__submit-actions"
      >
        <v-btn
          v-if="!inlineSubmitActive"
          color="primary"
          :disabled="!canSubmitSelectedControl"
          :loading="running"
          :prepend-icon="mdiSend"
          size="small"
          type="button"
          variant="flat"
          @click="submitFromButton"
        >
          {{ selectedControl.label }}
        </v-btn>

        <v-btn
          v-if="cancelVisible"
          :disabled="running"
          :prepend-icon="mdiClose"
          size="small"
          type="button"
          variant="tonal"
          @click="$emit('cancel')"
        >
          Cancel
        </v-btn>
      </div>

      <div
        v-if="workflowControls.length"
        class="vibe64-workflow-control-form__workflow-actions"
      >
        <v-btn
          v-for="control in workflowControls"
          :key="control.id"
          :color="control.buttonColor"
          :disabled="control.disabled"
          :loading="control.loading"
          :prepend-icon="control.icon"
          size="small"
          :title="control.disabledReason || control.label"
          type="button"
          :variant="control.buttonVariant"
          @click="$emit('activate-control', control.sourceControl || control)"
        >
          {{ control.label }}
        </v-btn>
      </div>
    </div>
  </component>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiClose,
  mdiSend,
  mdiStop
} from "@mdi/js";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";

const emit = defineEmits([
  "activate-control",
  "cancel",
  "interrupt",
  "submit",
  "update-value"
]);

const props = defineProps({
  asForm: {
    default: false,
    type: Boolean
  },
  attachTextarea: {
    default: false,
    type: Boolean
  },
  attachmentsEnabled: {
    default: true,
    type: Boolean
  },
  cancelVisible: {
    default: true,
    type: Boolean
  },
  canSubmitSelectedControl: {
    default: false,
    type: Boolean
  },
  layout: {
    default: "start",
    validator: (value) => ["center", "split", "start"].includes(value),
    type: String
  },
  inlineSubmit: {
    default: false,
    type: Boolean
  },
  inputDisabled: {
    default: false,
    type: Boolean
  },
  interruptDisabled: {
    default: false,
    type: Boolean
  },
  interruptLabel: {
    default: "Stop Codex",
    type: String
  },
  interruptVisible: {
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
  selectedControlValues: {
    default: () => ({}),
    type: Object
  },
  sessionId: {
    default: "",
    type: String
  },
  stickyActions: {
    default: false,
    type: Boolean
  },
  textareaRows: {
    default: 4,
    type: [Number, String]
  },
  workflowControls: {
    default: () => [],
    type: Array
  }
});

const rootTag = computed(() => props.asForm ? "form" : "div");
const fieldsDisabled = computed(() => Boolean(props.running || props.inputDisabled));
const inlineSubmitActive = computed(() => Boolean(
  props.inlineSubmit &&
  props.attachTextarea &&
  !props.cancelVisible
));
const actionsVisible = computed(() => Boolean(
  !inlineSubmitActive.value ||
  props.cancelVisible ||
  props.workflowControls.length
));
const inlineSubmitButtonLabel = computed(() => (
  props.interruptVisible ? props.interruptLabel : props.selectedControl.label
));
const inlineSubmitButtonDisabled = computed(() => (
  props.interruptVisible ? props.interruptDisabled : !props.canSubmitSelectedControl
));
const inlineSubmitButtonLoading = computed(() => Boolean(
  props.running && !props.interruptVisible
));
const inlineSubmitFieldName = computed(() => {
  if (!inlineSubmitActive.value) {
    return "";
  }
  const field = props.selectedControlFields.find((candidate) => candidate?.kind === "textarea");
  return String(field?.name || "");
});

function inlineSubmitForField(field = {}) {
  return Boolean(
    inlineSubmitActive.value &&
    String(field?.name || "") === inlineSubmitFieldName.value
  );
}

function submitFromForm() {
  emit("submit");
}

function submitFromButton() {
  emit("submit");
}

function handleInlineSubmitButton() {
  if (props.interruptVisible) {
    emit("interrupt");
    return;
  }
  submitFromButton();
}
</script>

<style scoped>
.vibe64-workflow-control-form {
  display: grid;
  gap: 0.24rem;
  position: relative;
  width: 100%;
}

.vibe64-workflow-control-form__input {
  max-width: 100%;
  text-align: left;
  width: 100%;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea) {
  gap: 0.35rem;
}

.vibe64-workflow-control-form__prompt-shell {
  position: relative;
}

.vibe64-workflow-control-form--inline-submit .vibe64-workflow-control-form__prompt-shell {
  order: 2;
}

.vibe64-workflow-control-form :deep(.v-input),
.vibe64-workflow-control-form :deep(.v-field) {
  overflow: visible;
}

.vibe64-workflow-control-form :deep(.v-field__input textarea) {
  min-height: 5.4rem;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea .v-field) {
  border-radius: 18px;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea .v-field-label) {
  color: rgba(var(--v-theme-on-surface), 0.82);
  opacity: 1;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea .v-input--disabled) {
  opacity: 1;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea .v-field__field) {
  color: rgb(var(--v-theme-on-surface));
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea .v-field__input) {
  min-height: 2.9rem;
  padding-block: 0.64rem 0.56rem;
}

.vibe64-workflow-control-form__prompt-shell--inline-submit :deep(.studio-autopilot-prompt-textarea .v-field__input) {
  padding-right: 3.2rem;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea .v-field__input textarea) {
  color: rgb(var(--v-theme-on-surface));
  line-height: 1.4;
  min-height: 2rem;
  opacity: 1;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea .v-field__input textarea::placeholder) {
  color: rgba(var(--v-theme-on-surface), 0.62);
  opacity: 1;
}

.vibe64-workflow-control-form__actions,
.vibe64-workflow-control-form__submit-actions,
.vibe64-workflow-control-form__workflow-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.36rem;
}

.vibe64-workflow-control-form__actions {
  justify-content: flex-start;
  width: 100%;
}

.vibe64-workflow-control-form--inline-submit .vibe64-workflow-control-form__actions {
  order: 1;
}

.vibe64-workflow-control-form--center .vibe64-workflow-control-form__actions {
  justify-content: center;
}

.vibe64-workflow-control-form--sticky-actions {
  display: contents;
}

.vibe64-workflow-control-form--split .vibe64-workflow-control-form__actions {
  justify-content: space-between;
}

.vibe64-workflow-control-form--split .vibe64-workflow-control-form__submit-actions {
  justify-content: flex-end;
  margin-left: auto;
  order: 2;
}

.vibe64-workflow-control-form__inline-submit {
  bottom: 0.55rem;
  height: 2.15rem;
  min-height: 2.15rem;
  min-width: 2.15rem;
  position: absolute;
  right: 0.55rem;
  width: 2.15rem;
  z-index: 2;
}

.vibe64-workflow-control-form__inline-submit--interrupt {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-error), 0.14);
}

.vibe64-workflow-control-form--split .vibe64-workflow-control-form__workflow-actions {
  flex: 1 1 auto;
  justify-content: flex-start;
  order: 1;
}

.vibe64-workflow-control-form--sticky-actions .vibe64-workflow-control-form__actions {
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-theme-outline), 0.18);
  bottom: 0;
  margin-top: 0;
  padding-block: 0.55rem 0.25rem;
  position: sticky;
  z-index: 1;
}
</style>
