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
        v-if="field.kind === 'answer_choices'"
        class="vibe64-workflow-control-form__answer-choices"
        role="group"
        aria-label="Suggested answers"
      >
        <button
          v-for="choice in field.choices"
          :key="choice.value"
          class="vibe64-workflow-control-form__answer-choice"
          :disabled="fieldsDisabled || running"
          type="button"
          @click="$emit('answer-choice', choice)"
        >
          <strong>{{ choice.label }}</strong>
          <span v-if="choice.value !== choice.label">{{ choice.value }}</span>
        </button>
        <button
          class="vibe64-workflow-control-form__answer-choice vibe64-workflow-control-form__answer-choice--other"
          :disabled="fieldsDisabled || running"
          type="button"
          @click="$emit('answer-choice-other')"
        >
          <strong>Something else</strong>
          <span>Type a different answer.</span>
        </button>
      </div>
      <div
        v-else-if="field.kind === 'textarea' && !inputFieldIsPrivate(field) && attachTextarea"
        class="vibe64-workflow-control-form__prompt-shell"
        :class="{ 'vibe64-workflow-control-form__prompt-shell--inline-submit': inlineSubmitForField(field) }"
      >
        <Vibe64AutopilotPromptTextarea
          ref="promptTextareaRef"
          :model-value="selectedControlValues[field.name] || ''"
          :attachments-enabled="attachmentsEnabled && !inputFieldIsPrivate(field)"
          class="vibe64-workflow-control-form__input"
          :disabled="fieldsDisabled"
          :aria-label="field.ariaLabel || field.label || undefined"
          :label="field.label"
          :placeholder="field.placeholder"
          :rows="field.rows || textareaRows"
          :session-id="sessionId"
          variant="outlined"
          @attachments-change="updateFieldAttachments(field.name, $event)"
          @submit="submitFromForm"
          @update:model-value="$emit('update-value', field.name, $event)"
        >
          <template
            v-if="inlineSubmitForField(field)"
            #footer
          >
            <div class="vibe64-workflow-control-form__composer-footer">
              <v-btn
                v-if="inlineSubmitForField(field)"
                :aria-label="inlineSubmitButtonLabel"
                class="vibe64-workflow-control-form__inline-submit"
                :class="{ 'vibe64-workflow-control-form__inline-submit--with-label': inlineSubmitLabelVisible }"
                color="primary"
                :disabled="inlineSubmitButtonDisabled"
                :icon="!inlineSubmitLabelVisible"
                :loading="inlineSubmitButtonLoading"
                :title="inlineSubmitButtonLabel"
                type="button"
                variant="flat"
                @click="handleInlineSubmitButton"
              >
                <v-icon :icon="mdiSend" size="20" />
                <span v-if="inlineSubmitLabelVisible">{{ inlineSubmitButtonLabel }}</span>
              </v-btn>

              <div
                v-if="inlineSubmitForField(field)"
                class="vibe64-workflow-control-form__composer-toolbar"
              >
                <div class="vibe64-workflow-control-form__composer-tools">
                  <v-btn
                    v-if="interruptVisible"
                    class="vibe64-workflow-control-form__composer-interrupt"
                    color="error"
                    :disabled="interruptDisabled"
                    :prepend-icon="mdiStop"
                    size="small"
                    type="button"
                    variant="tonal"
                    @click="$emit('interrupt')"
                  >
                    {{ interruptLabel }}
                  </v-btn>

                  <v-menu
                    v-if="agentControlsVisible"
                    v-model="agentMenuOpen"
                    :close-on-content-click="false"
                    location="top start"
                    transition="scale-transition"
                  >
                    <template #activator="{ props: menuProps }">
                      <v-btn
                        v-bind="menuProps"
                        aria-label="AI parameters"
                        class="vibe64-workflow-control-form__tool-button"
                        density="comfortable"
                        :icon="mdiCogOutline"
                        size="small"
                        :title="agentControlsTitle"
                        type="button"
                        variant="flat"
                      />
                    </template>

                    <div
                      class="vibe64-workflow-control-form__ai-menu"
                      aria-label="AI controls"
                    >
                      <div class="vibe64-workflow-control-form__ai-menu-header">
                        <v-icon :icon="mdiBrain" size="20" />
                        <div class="vibe64-workflow-control-form__ai-menu-heading">
                          <strong>AI Controls</strong>
                          <span>{{ agentProviderLabel }} · {{ agentSummary }}</span>
                        </div>
                      </div>

                      <section
                        v-for="parameter in agentParameters"
                        :key="parameter.id"
                        class="vibe64-workflow-control-form__ai-menu-section"
                      >
                        <div class="vibe64-workflow-control-form__ai-menu-label">
                          {{ parameter.label }}
                        </div>
                        <div class="vibe64-workflow-control-form__ai-options">
                          <button
                            v-for="option in parameter.options"
                            :key="`${parameter.id}:${option.value}`"
                            class="vibe64-workflow-control-form__ai-option"
                            :class="{ 'vibe64-workflow-control-form__ai-option--active': agentParameterSelected(parameter.id, option.value) }"
                            type="button"
                            :aria-pressed="agentParameterSelected(parameter.id, option.value)"
                            @click="updateAgentParameter(parameter.id, option.value)"
                          >
                            <span>{{ option.label }}</span>
                            <v-icon
                              v-if="agentParameterSelected(parameter.id, option.value)"
                              :icon="mdiCheck"
                              size="15"
                            />
                          </button>
                        </div>
                      </section>
                    </div>
                  </v-menu>

                  <v-menu
                    v-if="attachmentsEnabled"
                    v-model="attachmentMenuOpen"
                    location="top start"
                    transition="scale-transition"
                  >
                    <template #activator="{ props: menuProps }">
                      <v-btn
                        v-bind="menuProps"
                        aria-label="Attachment menu"
                        class="vibe64-workflow-control-form__tool-button"
                        density="comfortable"
                        :disabled="attachmentToolDisabled"
                        :icon="mdiPlus"
                        size="small"
                        title="Attachment menu"
                        type="button"
                        variant="flat"
                      />
                    </template>

                    <div
                      class="vibe64-workflow-control-form__attachment-menu"
                      aria-label="Attachment actions"
                    >
                      <button
                        class="vibe64-workflow-control-form__attachment-menu-item"
                        :disabled="attachmentToolDisabled"
                        type="button"
                        @click="chooseAttachmentFiles"
                      >
                        <v-icon :icon="mdiFileUploadOutline" size="18" />
                        <span>Attach files</span>
                      </button>
                    </div>
                  </v-menu>

                  <div
                    v-if="toolbarWorkflowControlsVisible"
                    class="vibe64-workflow-control-form__workflow-actions vibe64-workflow-control-form__workflow-actions--toolbar"
                    :class="{ 'vibe64-workflow-control-form__workflow-actions--compact': workflowActionsCompact }"
                  >
                    <v-btn
                      v-for="control in visibleWorkflowControls"
                      :key="control.id"
                      :color="control.buttonColor"
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
              </div>
            </div>
          </template>
        </Vibe64AutopilotPromptTextarea>
      </div>
      <v-textarea
        v-else-if="field.kind === 'textarea' && !inputFieldIsPrivate(field)"
        auto-grow
        class="vibe64-workflow-control-form__input vibe64-workflow-control-form__input--textarea"
        :autocomplete="field.autocomplete || undefined"
        :density="field.density || 'compact'"
        :disabled="fieldsDisabled"
        hide-details="auto"
        :aria-label="field.ariaLabel || field.label || undefined"
        :label="field.label"
        :model-value="selectedControlValues[field.name] || ''"
        :placeholder="field.placeholder"
        :rows="field.rows || textareaRows"
        variant="outlined"
        @update:model-value="$emit('update-value', field.name, $event)"
      />
      <v-text-field
        v-else
        class="vibe64-workflow-control-form__input vibe64-workflow-control-form__input--text"
        :autocomplete="field.autocomplete || (inputFieldIsPrivate(field) ? 'off' : undefined)"
        :density="field.density || 'compact'"
        :disabled="fieldsDisabled"
        hide-details="auto"
        :aria-label="field.ariaLabel || field.label || undefined"
        :label="field.label"
        :model-value="selectedControlValues[field.name] || ''"
        :placeholder="field.placeholder"
        :type="inputFieldIsPrivate(field) ? 'password' : 'text'"
        variant="outlined"
        @update:model-value="$emit('update-value', field.name, $event)"
      />
    </template>

    <div
      v-if="actionsVisible"
      class="vibe64-workflow-control-form__actions"
    >
      <div
        v-if="submitActionsVisible"
        class="vibe64-workflow-control-form__submit-actions"
      >
        <v-btn
          v-if="submitButtonVisible"
          color="primary"
          :loading="running"
          :prepend-icon="mdiSend"
          size="small"
          type="button"
          variant="flat"
          @click="submitFromButton"
        >
          {{ selectedControlSubmitLabel }}
        </v-btn>

        <v-btn
          v-if="cancelButtonVisible"
          color="primary"
          :prepend-icon="mdiClose"
          size="small"
          type="button"
          variant="outlined"
          @click="$emit('cancel')"
        >
          Cancel
        </v-btn>
      </div>

      <div
        v-if="actionWorkflowControlsVisible"
        class="vibe64-workflow-control-form__workflow-actions"
        :class="{ 'vibe64-workflow-control-form__workflow-actions--compact': workflowActionsCompact }"
      >
        <v-btn
          v-for="control in visibleWorkflowControls"
          :key="control.id"
          :color="control.buttonColor"
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
import { computed, ref } from "vue";
import {
  mdiBrain,
  mdiCheck,
  mdiClose,
  mdiCogOutline,
  mdiFileUploadOutline,
  mdiPlus,
  mdiSend,
  mdiStop
} from "@mdi/js";
import {
  VIBE64_AGENT_PROVIDERS,
  displayVibe64AgentSetting,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import {
  actionInputFieldIsPrivate
} from "@/lib/vibe64ActionInputModel.js";

const emit = defineEmits([
  "answer-choice",
  "answer-choice-other",
  "activate-control",
  "cancel",
  "interrupt",
  "submit",
  "update-agent-setting",
  "update-value"
]);

const props = defineProps({
  agentControlsVisible: {
    default: false,
    type: Boolean
  },
  agentSettings: {
    default: () => ({}),
    type: Object
  },
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
  inlineSubmitLabelVisible: {
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

const agentMenuOpen = ref(false);
const attachmentMenuOpen = ref(false);
const fieldAttachments = ref({});
const promptTextareaRef = ref(null);
const rootTag = computed(() => props.asForm ? "form" : "div");
const fieldsDisabled = computed(() => Boolean(props.inputDisabled));
const inlineSubmitField = computed(() => {
  if (!props.inlineSubmit || !props.attachTextarea || props.cancelVisible) {
    return null;
  }
  return props.selectedControlFields.find((candidate) => (
    candidate?.kind === "textarea" &&
    !inputFieldIsPrivate(candidate)
  )) || null;
});
const inlineSubmitActive = computed(() => Boolean(
  props.inlineSubmit &&
  props.attachTextarea &&
  !props.cancelVisible &&
  inlineSubmitField.value
));
const answerChoiceMode = computed(() => props.selectedControlFields.some((field) => field?.kind === "answer_choices"));
const visibleWorkflowControls = computed(() => props.workflowControls.filter((control) => control?.disabled !== true));
const toolbarWorkflowControlsVisible = computed(() => Boolean(
  inlineSubmitActive.value &&
  visibleWorkflowControls.value.length
));
const actionWorkflowControlsVisible = computed(() => Boolean(
  !toolbarWorkflowControlsVisible.value &&
  visibleWorkflowControls.value.length
));
const submitButtonVisible = computed(() => Boolean(
  !inlineSubmitActive.value &&
  props.canSubmitSelectedControl &&
  !props.running
));
const cancelButtonVisible = computed(() => Boolean(
  props.cancelVisible &&
  !props.running
));
const submitActionsVisible = computed(() => Boolean(
  submitButtonVisible.value ||
  cancelButtonVisible.value
));
const actionsVisible = computed(() => Boolean(
  (!answerChoiceMode.value && submitActionsVisible.value) ||
  actionWorkflowControlsVisible.value
));
const workflowActionsCompact = computed(() => visibleWorkflowControls.value.length >= 4);
const inlineSubmitButtonLabel = computed(() => String(props.selectedControl.label || "Submit").trim() || "Submit");
const inlineSubmitButtonDisabled = computed(() => (
  !props.canSubmitSelectedControl
));
const inlineSubmitButtonLoading = computed(() => Boolean(
  props.running
));
const selectedControlSubmitLabel = computed(() => (
  String(props.selectedControl.submitLabel || "Submit").trim() || "Submit"
));
const inlineSubmitFieldName = computed(() => {
  if (!inlineSubmitActive.value) {
    return "";
  }
  return String(inlineSubmitField.value?.name || "");
});
const currentAgentSettings = computed(() => normalizeVibe64AgentSettings(props.agentSettings));
const agentProvider = computed(() => (
  VIBE64_AGENT_PROVIDERS.find((provider) => provider.id === currentAgentSettings.value.providerId) ||
  VIBE64_AGENT_PROVIDERS[0]
));
const agentProviderLabel = computed(() => agentProvider.value?.label || "AI");
const agentParameters = computed(() => (
  Array.isArray(agentProvider.value?.parameters) ? agentProvider.value.parameters : []
));
const agentSummary = computed(() => {
  const summary = agentParameters.value
    .map((parameter) => displayVibe64AgentSetting(
      currentAgentSettings.value.providerId,
      parameter.id,
      agentParameterValue(parameter.id)
    ))
    .filter(Boolean)
    .join(" / ");
  return summary || "Automatic";
});
const agentControlsTitle = computed(() => `AI controls: ${agentSummary.value}`);
const attachmentToolDisabled = computed(() => Boolean(
  !props.attachmentsEnabled ||
  fieldsDisabled.value
));

function inlineSubmitForField(field = {}) {
  return Boolean(
    inlineSubmitActive.value &&
    String(field?.name || "") === inlineSubmitFieldName.value
  );
}

function inputFieldIsPrivate(field = {}) {
  return actionInputFieldIsPrivate(field);
}

function submitFromForm() {
  if (!props.canSubmitSelectedControl) {
    return false;
  }
  emit("submit", submissionOptions());
  clearAttachments();
  return true;
}

function submitFromButton() {
  if (!props.canSubmitSelectedControl) {
    return false;
  }
  emit("submit", submissionOptions());
  clearAttachments();
  return true;
}

function handleInlineSubmitButton() {
  submitFromButton();
}

function agentParameterValue(parameterId = "") {
  return String(currentAgentSettings.value?.[parameterId] || "");
}

function agentParameterSelected(parameterId = "", value = "") {
  return agentParameterValue(parameterId) === String(value || "");
}

function updateAgentParameter(parameterId = "", value = "") {
  emit("update-agent-setting", parameterId, value);
}

function updateFieldAttachments(fieldName = "", attachments = []) {
  const name = String(fieldName || "").trim();
  if (!name) {
    return;
  }
  fieldAttachments.value = {
    ...fieldAttachments.value,
    [name]: Array.isArray(attachments) ? attachments : []
  };
}

function submissionOptions() {
  const attachmentFields = Object.fromEntries(Object.entries(fieldAttachments.value)
    .filter((entry) => Array.isArray(entry[1]) && entry[1].length > 0)
    .map(([fieldName, attachments]) => [fieldName, attachments]));
  if (Object.keys(attachmentFields).length < 1) {
    return {};
  }
  return {
    attachmentFields
  };
}

function promptTextareaComponents() {
  return Array.isArray(promptTextareaRef.value)
    ? promptTextareaRef.value
    : [promptTextareaRef.value].filter(Boolean);
}

function promptTextareaComponent() {
  return promptTextareaComponents()[0] || null;
}

function chooseAttachmentFiles() {
  attachmentMenuOpen.value = false;
  promptTextareaComponent()?.openFilePicker?.();
}

function clearAttachments() {
  fieldAttachments.value = {};
  for (const component of promptTextareaComponents()) {
    component?.clearAttachments?.();
  }
}

defineExpose({
  clearAttachments
});
</script>

<style scoped>
.vibe64-workflow-control-form {
  display: grid;
  gap: 0.32rem;
  position: relative;
  width: 100%;
}

.vibe64-workflow-control-form__input {
  max-width: 100%;
  text-align: left;
  width: 100%;
}

.vibe64-workflow-control-form__answer-choices {
  display: grid;
  gap: 0.42rem;
  min-width: 0;
  width: 100%;
}

.vibe64-workflow-control-form__answer-choice {
  align-items: start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 0.12rem;
  letter-spacing: 0;
  line-height: 1.28;
  min-width: 0;
  padding: 0.62rem 0.7rem;
  text-align: left;
  width: 100%;
}

.vibe64-workflow-control-form__answer-choice:hover:not(:disabled),
.vibe64-workflow-control-form__answer-choice:focus-visible:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.07);
  border-color: rgba(var(--v-theme-primary), 0.34);
  outline: none;
}

.vibe64-workflow-control-form__answer-choice:disabled {
  cursor: default;
  opacity: 0.55;
}

.vibe64-workflow-control-form__answer-choice strong {
  font-size: 0.94rem;
  font-weight: 720;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.vibe64-workflow-control-form__answer-choice span {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  line-height: 1.28;
  overflow-wrap: anywhere;
}

.vibe64-workflow-control-form__answer-choice--other {
  background: rgba(var(--v-theme-surface), 0.72);
  border-style: dashed;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea) {
  gap: 0.35rem;
}

.vibe64-workflow-control-form__prompt-shell {
  min-width: 0;
  position: relative;
}

.vibe64-workflow-control-form__prompt-shell--inline-submit {
  display: block;
}

.vibe64-workflow-control-form--inline-submit .vibe64-workflow-control-form__prompt-shell {
  margin-top: 0.72rem;
  order: 2;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea--has-footer) {
  gap: 0;
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea__input) {
  color: rgb(var(--v-theme-on-surface));
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea__input:disabled) {
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.08rem;
  font-weight: 650;
  opacity: 1;
  -webkit-text-fill-color: rgba(var(--v-theme-on-surface), 0.95);
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea__input:disabled::placeholder) {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 1.08rem;
  font-weight: 650;
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

.vibe64-workflow-control-form__composer-footer {
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
}

.vibe64-workflow-control-form__composer-toolbar {
  align-items: center;
  display: flex;
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  pointer-events: auto;
}

.vibe64-workflow-control-form__composer-tools {
  align-items: center;
  display: flex;
  gap: 0.24rem;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  pointer-events: auto;
  scrollbar-width: none;
  width: 100%;
}

.vibe64-workflow-control-form__composer-tools::-webkit-scrollbar {
  display: none;
}

.vibe64-workflow-control-form__tool-button {
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

.vibe64-workflow-control-form__tool-button:hover {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
}

.vibe64-workflow-control-form__composer-interrupt {
  border-radius: 7px;
  flex: 0 0 auto;
  font-size: 0.82rem;
  font-weight: 500;
  letter-spacing: 0;
  min-height: 2rem;
}

.vibe64-workflow-control-form__ai-menu,
.vibe64-workflow-control-form__attachment-menu {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
  color: rgb(var(--v-theme-on-surface));
  min-width: min(20rem, calc(100vw - 2rem));
  padding: 0.55rem;
}

.vibe64-workflow-control-form__ai-menu {
  display: grid;
  gap: 0.55rem;
}

.vibe64-workflow-control-form__ai-menu-header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.55rem;
  padding: 0.18rem 0.12rem 0.55rem;
}

.vibe64-workflow-control-form__ai-menu-heading {
  display: grid;
  gap: 0.08rem;
  min-width: 0;
}

.vibe64-workflow-control-form__ai-menu-heading strong {
  font-size: 0.9rem;
  font-weight: 650;
  line-height: 1.2;
}

.vibe64-workflow-control-form__ai-menu-heading span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-workflow-control-form__ai-menu-section {
  display: grid;
  gap: 0.32rem;
}

.vibe64-workflow-control-form__ai-menu-label {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.2;
  padding-inline: 0.12rem;
  text-transform: uppercase;
}

.vibe64-workflow-control-form__ai-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
}

.vibe64-workflow-control-form__ai-option,
.vibe64-workflow-control-form__attachment-menu-item {
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

.vibe64-workflow-control-form__ai-option:hover,
.vibe64-workflow-control-form__attachment-menu-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.vibe64-workflow-control-form__ai-option--active {
  background: rgba(var(--v-theme-primary), 0.09);
  border-color: rgba(var(--v-theme-primary), 0.36);
  color: rgb(var(--v-theme-primary));
  font-weight: 650;
}

.vibe64-workflow-control-form__attachment-menu {
  min-width: min(14rem, calc(100vw - 2rem));
}

.vibe64-workflow-control-form__attachment-menu-item {
  justify-content: flex-start;
  width: 100%;
}

.vibe64-workflow-control-form__attachment-menu-item:disabled {
  cursor: default;
  opacity: 0.48;
}

.vibe64-workflow-control-form__actions {
  justify-content: flex-start;
  width: 100%;
}

.vibe64-workflow-control-form__submit-actions :deep(.v-btn),
.vibe64-workflow-control-form__workflow-actions :deep(.v-btn) {
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  border-radius: var(--studio-control-radius, 8px);
  box-shadow: none !important;
  font-size: 0.9rem;
  font-weight: 400;
  letter-spacing: 0;
  line-height: 1.2;
  min-height: 2.15rem;
  opacity: 1;
  padding-inline: 0.64rem;
}

.vibe64-workflow-control-form__workflow-actions--compact {
  gap: 0.28rem;
}

.vibe64-workflow-control-form__workflow-actions--compact :deep(.v-btn) {
  font-size: 0.82rem;
  min-height: 2rem;
  padding-inline: 0.46rem;
}

.vibe64-workflow-control-form__submit-actions :deep(.v-btn:hover),
.vibe64-workflow-control-form__workflow-actions :deep(.v-btn:hover) {
  background: rgba(var(--v-theme-primary), 0.14) !important;
}

.vibe64-workflow-control-form__submit-actions :deep(.v-btn--variant-outlined:not(.v-btn--disabled)),
.vibe64-workflow-control-form__workflow-actions :deep(.v-btn--variant-outlined:not(.v-btn--disabled)) {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgba(var(--v-theme-primary), 0.32);
  color: rgb(var(--v-theme-primary)) !important;
}

.vibe64-workflow-control-form__submit-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled)),
.vibe64-workflow-control-form__workflow-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled)) {
  background: rgb(var(--v-theme-primary)) !important;
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary)) !important;
}

.vibe64-workflow-control-form__submit-actions :deep(.v-btn--disabled),
.vibe64-workflow-control-form__workflow-actions :deep(.v-btn--disabled) {
  background: rgba(var(--v-theme-on-surface), 0.04) !important;
  border-color: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.28) !important;
  opacity: 1;
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
  align-self: center;
  grid-column: 2;
  grid-row: 1;
  gap: 0.36rem;
  height: 2rem;
  justify-self: end;
  letter-spacing: 0;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.vibe64-workflow-control-form__inline-submit--with-label {
  font-size: 0.86rem;
  font-weight: 600;
  min-width: 5rem;
  padding-inline: 0.72rem;
  width: auto;
}

.vibe64-workflow-control-form__inline-submit--interrupt {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-error), 0.14);
}

.vibe64-workflow-control-form--split .vibe64-workflow-control-form__workflow-actions {
  flex: 1 1 auto;
  justify-content: flex-start;
  order: 1;
}

.vibe64-workflow-control-form__workflow-actions--toolbar {
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 0.24rem;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.vibe64-workflow-control-form__workflow-actions--toolbar::-webkit-scrollbar {
  display: none;
}

.vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn) {
  flex: 0 0 auto;
  max-width: min(10.5rem, 38vw);
  min-height: 2.15rem;
  min-width: 0;
  padding-inline: 0.64rem;
}

.vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn__prepend) {
  margin-inline-end: 0.24rem;
}

.vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
