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
          :focus-submit-on-tab="inlineSubmitForField(field) && !inlineSubmitButtonDisabled"
          :aria-label="field.ariaLabel || field.label || undefined"
          :label="field.label"
          :placeholder="promptFieldPlaceholder(field)"
          :rows="field.rows || textareaRows"
          :session-id="sessionId"
          variant="outlined"
          @attachments-change="updateFieldAttachments(field.name, $event)"
          @focus-submit="focusInlineSubmitButton"
          @submit="submitFromForm"
          @update:model-value="$emit('update-value', field.name, $event)"
        >
          <template
            v-if="inlineSubmitForField(field)"
            #footer
          >
            <div
              class="vibe64-workflow-control-form__composer-footer"
              :class="{ 'vibe64-workflow-control-form__composer-footer--with-cancel': inlineCancelButtonVisible }"
            >
              <div class="vibe64-workflow-control-form__inline-actions">
                <v-btn
                  v-if="inlineSubmitForField(field)"
                  ref="inlineSubmitButtonRef"
                  :aria-label="inlineSubmitButtonLabel"
                  class="vibe64-workflow-control-form__inline-submit"
                  :class="{ 'vibe64-workflow-control-form__inline-submit--with-label': inlineSubmitLabelVisible }"
                  color="primary"
                  :disabled="inlineSubmitButtonDisabled"
                  :icon="!inlineSubmitLabelVisible"
                  :loading="inlineSubmitButtonLoading"
                  :title="inlineSubmitButtonTitle"
                  type="button"
                  variant="flat"
                  @click="handleInlineSubmitButton"
                >
                  <v-icon :icon="mdiSend" size="20" />
                  <span v-if="inlineSubmitLabelVisible">{{ inlineSubmitButtonLabel }}</span>
                </v-btn>

                <v-btn
                  v-if="inlineCancelButtonVisible"
                  class="vibe64-workflow-control-form__inline-cancel"
                  :prepend-icon="mdiClose"
                  type="button"
                  variant="outlined"
                  @click="$emit('cancel')"
                >
                  Cancel
                </v-btn>
              </div>

              <div
                v-if="toolbarWorkflowControlsVisible || inputDisabledStatusVisible || interruptVisible || agentControlsVisible || composerToolsVisible"
                class="vibe64-workflow-control-form__composer-toolbar"
              >
                <div class="vibe64-workflow-control-form__composer-tools">
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

                  <div
                    v-if="inputDisabledStatusVisible"
                    class="vibe64-workflow-control-form__composer-status"
                    role="status"
                    aria-live="polite"
                  >
                    <span class="vibe64-workflow-control-form__composer-status-dot" />
                    <span>{{ inputDisabledReason }}</span>
                  </div>

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

                  <Vibe64AgentSettingsMenu
                    v-if="agentControlsVisible"
                    :agent-settings="agentSettings"
                    @update-setting="updateAgentParameter"
                  />

                  <v-menu
                    v-if="composerToolsVisible"
                    v-model="attachmentMenuOpen"
                    :close-on-content-click="false"
                    location="top start"
                    transition="scale-transition"
                  >
                    <template #activator="{ props: menuProps }">
                      <v-btn
                        v-bind="menuProps"
                        aria-label="Composer menu"
                        class="vibe64-workflow-control-form__tool-button"
                        density="comfortable"
                        :disabled="composerToolDisabled"
                        :icon="mdiPlus"
                        size="small"
                        title="Composer menu"
                        type="button"
                        variant="flat"
                      />
                    </template>

                    <div
                      class="vibe64-workflow-control-form__attachment-menu"
                      aria-label="Composer actions"
                    >
                      <button
                        v-if="attachmentsEnabled"
                        class="vibe64-workflow-control-form__attachment-menu-item"
                        :disabled="attachmentToolDisabled"
                        type="button"
                        @click="chooseAttachmentFiles"
                      >
                        <v-icon :icon="mdiFileUploadOutline" size="18" />
                        <span>Attach files</span>
                      </button>

                      <v-menu
                        v-if="composerMenuGroups.length"
                        v-model="promptMenuOpen"
                        :close-on-content-click="false"
                        location="end top"
                        transition="scale-transition"
                      >
                        <template #activator="{ props: promptMenuProps }">
                          <button
                            v-bind="promptMenuProps"
                            class="vibe64-workflow-control-form__attachment-menu-item vibe64-workflow-control-form__attachment-menu-item--submenu"
                            :disabled="promptMenuDisabled"
                            type="button"
                          >
                            <v-icon :icon="mdiFileDocumentOutline" size="18" />
                            <span>Prompts</span>
                            <v-icon
                              class="vibe64-workflow-control-form__attachment-menu-chevron"
                              :icon="mdiChevronRight"
                              size="18"
                            />
                          </button>
                        </template>

                        <div
                          class="vibe64-workflow-control-form__attachment-menu vibe64-workflow-control-form__attachment-menu--prompts"
                          aria-label="Prompt templates"
                        >
                          <template
                            v-for="group in composerMenuGroups"
                            :key="group.label"
                          >
                            <div class="vibe64-workflow-control-form__attachment-menu-group">
                              {{ group.label }}
                            </div>
                            <button
                              v-for="item in group.items"
                              :key="item.id"
                              class="vibe64-workflow-control-form__attachment-menu-item"
                              :disabled="composerMenuItemDisabled(item)"
                              type="button"
                              :title="item.disabledReason || item.label"
                              @click="selectComposerMenuItem(item)"
                            >
                              <v-icon :icon="composerMenuItemIcon(item)" size="18" />
                              <span>{{ item.label }}</span>
                            </button>
                          </template>
                        </div>
                      </v-menu>
                    </div>
                  </v-menu>
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
  mdiChevronRight,
  mdiClose,
  mdiFileDocumentOutline,
  mdiFileUploadOutline,
  mdiPlus,
  mdiSend,
  mdiStop
} from "@mdi/js";
import {
  presentationIconForToken
} from "@/lib/vibe64PresentationControls.js";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import {
  actionInputFieldIsPrivate
} from "@/lib/vibe64ActionInputModel.js";
import {
  visibleWorkflowButtonControls
} from "@/lib/vibe64WorkflowControlModel.js";

const emit = defineEmits([
  "answer-choice",
  "answer-choice-other",
  "activate-control",
  "cancel",
  "composer-menu-item",
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
  composerMenuItems: {
    default: () => [],
    type: Array
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
  inputDisabledReason: {
    default: "",
    type: String
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
  },
  workflowControlsWithOpenForm: {
    default: false,
    type: Boolean
  }
});

const attachmentMenuOpen = ref(false);
const fieldAttachments = ref({});
const promptMenuOpen = ref(false);
const promptTextareaRef = ref(null);
const inlineSubmitButtonRef = ref(null);
const rootTag = computed(() => props.asForm ? "form" : "div");
const fieldsDisabled = computed(() => Boolean(props.inputDisabled));
const inputDisabledReason = computed(() => (
  fieldsDisabled.value ? String(props.inputDisabledReason || "").trim() : ""
));
const inlineSubmitField = computed(() => {
  if (!props.inlineSubmit || !props.attachTextarea) {
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
  inlineSubmitField.value
));
const answerChoiceMode = computed(() => props.selectedControlFields.some((field) => field?.kind === "answer_choices"));
const selectedControlFormOpen = computed(() => Boolean(
  props.cancelVisible &&
  !answerChoiceMode.value &&
  props.selectedControlFields.length > 0
));
const visibleWorkflowControls = computed(() => visibleWorkflowButtonControls(props.workflowControls));
const toolbarWorkflowControlsVisible = computed(() => Boolean(
  (!selectedControlFormOpen.value || props.workflowControlsWithOpenForm) &&
  inlineSubmitActive.value &&
  visibleWorkflowControls.value.length
));
const actionWorkflowControlsVisible = computed(() => Boolean(
  (!selectedControlFormOpen.value || props.workflowControlsWithOpenForm) &&
  !toolbarWorkflowControlsVisible.value &&
  visibleWorkflowControls.value.length
));
const submitButtonVisible = computed(() => Boolean(
  !inlineSubmitActive.value &&
  props.canSubmitSelectedControl &&
  !props.running
));
const inlineCancelButtonVisible = computed(() => Boolean(
  inlineSubmitActive.value &&
  props.cancelVisible &&
  !props.running
));
const cancelButtonVisible = computed(() => Boolean(
  props.cancelVisible &&
  !inlineSubmitActive.value &&
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
const inlineSubmitButtonTitle = computed(() => (
  inlineSubmitButtonDisabled.value && inputDisabledReason.value
    ? inputDisabledReason.value
    : inlineSubmitButtonLabel.value
));
const inputDisabledStatusVisible = computed(() => Boolean(
  inlineSubmitActive.value &&
  inputDisabledReason.value
));
const selectedControlSubmitLabel = computed(() => (
  String(props.selectedControl.submitLabel || props.selectedControl.label || "Submit").trim() || "Submit"
));
const inlineSubmitFieldName = computed(() => {
  if (!inlineSubmitActive.value) {
    return "";
  }
  return String(inlineSubmitField.value?.name || "");
});
const composerMenuItems = computed(() => (Array.isArray(props.composerMenuItems) ? props.composerMenuItems : [])
  .filter((item) => item && item.visible !== false && item.id && item.label));
const composerMenuGroups = computed(() => {
  const groups = [];
  const byLabel = new Map();
  for (const item of composerMenuItems.value) {
    const label = String(item.group || "Ask Codex").trim() || "Ask Codex";
    if (!byLabel.has(label)) {
      const group = {
        items: [],
        label
      };
      byLabel.set(label, group);
      groups.push(group);
    }
    byLabel.get(label).items.push(item);
  }
  return groups;
});
const composerToolsVisible = computed(() => Boolean(
  props.attachmentsEnabled ||
  composerMenuItems.value.length
));
const composerToolDisabled = computed(() => Boolean(
  (!props.attachmentsEnabled || attachmentToolDisabled.value) &&
  !composerMenuItems.value.some((item) => !composerMenuItemDisabled(item))
));
const promptMenuDisabled = computed(() => Boolean(
  !composerMenuItems.value.some((item) => !composerMenuItemDisabled(item))
));
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

function promptFieldPlaceholder(field = {}) {
  return inputDisabledReason.value || field.placeholder;
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

function focusInlineSubmitButton() {
  if (!inlineSubmitForField(inlineSubmitField.value)) {
    return false;
  }
  const button = Array.isArray(inlineSubmitButtonRef.value)
    ? inlineSubmitButtonRef.value[0]
    : inlineSubmitButtonRef.value;
  const target = button?.$el || button;
  if (target?.disabled) {
    return false;
  }
  if (typeof target?.focus === "function") {
    target.focus();
    return true;
  }
  return false;
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
  promptMenuOpen.value = false;
  promptTextareaComponent()?.openFilePicker?.();
}

function composerMenuItemDisabled(item = {}) {
  if (item.enabled === false) {
    return true;
  }
  return String(item.kind || "") === "template" && fieldsDisabled.value;
}

function composerMenuItemIcon(item = {}) {
  return presentationIconForToken(item.icon, mdiFileDocumentOutline);
}

function selectComposerMenuItem(item = {}) {
  if (composerMenuItemDisabled(item)) {
    return false;
  }
  promptMenuOpen.value = false;
  attachmentMenuOpen.value = false;
  emit("composer-menu-item", item);
  return true;
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
  opacity: 1;
  -webkit-text-fill-color: rgba(var(--v-theme-on-surface), 0.95);
}

.vibe64-workflow-control-form :deep(.studio-autopilot-prompt-textarea__input:disabled::placeholder) {
  color: rgba(var(--v-theme-on-surface), 0.9);
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
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-workflow-control-form__composer-footer--with-cancel {
  align-items: center;
}

.vibe64-workflow-control-form__composer-toolbar {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  order: 1;
  pointer-events: auto;
  width: auto;
}

.vibe64-workflow-control-form__composer-tools {
  align-items: center;
  align-content: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 0.24rem;
  min-width: 0;
  overflow: visible;
  pointer-events: auto;
  width: 100%;
}

.vibe64-workflow-control-form__composer-status {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.66);
  display: inline-flex;
  flex: 0 1 auto;
  font-size: 0.78rem;
  gap: 0.34rem;
  line-height: 1.2;
  min-width: 0;
  overflow: hidden;
  padding-inline: 0.14rem;
  white-space: nowrap;
}

.vibe64-workflow-control-form__composer-status span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}

.vibe64-workflow-control-form__composer-status-dot {
  animation: vibe64-workflow-control-status-pulse 1s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  flex: 0 0 0.44rem;
  height: 0.44rem;
  width: 0.44rem;
}

.vibe64-workflow-control-form__inline-actions {
  align-items: center;
  display: flex;
  gap: 0.42rem;
  justify-content: flex-end;
  margin-left: auto;
  min-width: 0;
  order: 2;
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

.vibe64-workflow-control-form__attachment-menu {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
  color: rgb(var(--v-theme-on-surface));
  min-width: min(20rem, calc(100vw - 2rem));
  padding: 0.55rem;
}

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

.vibe64-workflow-control-form__attachment-menu-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.vibe64-workflow-control-form__attachment-menu {
  display: grid;
  gap: 0.28rem;
  min-width: min(14rem, calc(100vw - 2rem));
}

.vibe64-workflow-control-form__attachment-menu--prompts {
  min-width: min(15rem, calc(100vw - 2rem));
}

.vibe64-workflow-control-form__attachment-menu-group {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 680;
  line-height: 1.2;
  padding: 0.3rem 0.18rem 0.02rem;
  text-transform: uppercase;
}

.vibe64-workflow-control-form__attachment-menu-item {
  justify-content: flex-start;
  width: 100%;
}

.vibe64-workflow-control-form__attachment-menu-item--submenu span {
  flex: 1 1 auto;
}

@keyframes vibe64-workflow-control-status-pulse {
  0%,
  100% {
    opacity: 0.42;
    transform: scale(0.86);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.vibe64-workflow-control-form__attachment-menu-chevron {
  margin-left: auto;
  opacity: 0.62;
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

.vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn) {
  flex: 0 0 auto;
  max-width: 100%;
  min-width: max-content;
  width: max-content;
}

.vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn__content) {
  min-width: max-content;
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
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

.vibe64-workflow-control-form__submit-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):hover),
.vibe64-workflow-control-form__submit-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):focus-visible),
.vibe64-workflow-control-form__workflow-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):hover),
.vibe64-workflow-control-form__workflow-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):focus-visible) {
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

.vibe64-workflow-control-form :deep(.v-btn.vibe64-workflow-control-form__inline-submit) {
  align-self: center;
  border-radius: 8px !important;
  flex: 0 0 5.4rem;
  gap: 0.36rem;
  height: 2.4rem !important;
  justify-self: end;
  letter-spacing: 0;
  min-height: 2.4rem !important;
  min-width: 5.4rem !important;
  order: 2;
  padding-inline: 0.72rem;
  width: 5.4rem !important;
}

.vibe64-workflow-control-form :deep(.v-btn.vibe64-workflow-control-form__inline-cancel) {
  background: var(--studio-control-bg, #fff) !important;
  border: 1px solid var(--studio-control-border, rgba(17, 24, 39, 0.12));
  border-radius: 8px !important;
  color: var(--studio-control-text, #202124) !important;
  flex: 0 0 auto;
  font-size: 0.86rem;
  font-weight: 500;
  height: 2.4rem !important;
  letter-spacing: 0;
  min-height: 2.4rem !important;
  order: 1;
  padding-inline: 0.68rem;
}

.vibe64-workflow-control-form :deep(.v-btn.vibe64-workflow-control-form__inline-cancel:hover) {
  background: var(--studio-control-rest-bg, #f7f7f8) !important;
}

.vibe64-workflow-control-form :deep(.v-btn.vibe64-workflow-control-form__inline-submit--with-label) {
  font-size: 0.86rem;
  font-weight: 600;
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
  flex-wrap: wrap;
  gap: 0.24rem;
  min-width: 0;
  overflow: visible;
}

.vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn) {
  flex: 0 1 auto;
  max-width: min(10.5rem, 100%);
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
