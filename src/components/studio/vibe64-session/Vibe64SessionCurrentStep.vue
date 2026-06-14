<template>
  <Vibe64BackgroundTasks
    v-if="visibleBackgroundTasks.length || backgroundTaskError"
    class="studio-ai-sessions__background-tasks"
    :error="backgroundTaskError"
    :retrying-task-id="retryingBackgroundTaskId"
    :tasks="visibleBackgroundTasks"
    @retry="retryBackgroundTask"
  />

  <form
    v-if="stepInput.visible"
    class="studio-ai-sessions__step-input"
    @submit.prevent="submitStepInputForm"
  >
    <p
      v-if="stepInput.interaction?.prompt"
      class="text-body-2 text-medium-emphasis mb-0"
    >
      {{ stepInput.interaction.prompt }}
    </p>

    <template
      v-for="field in stepInput.fields"
      :key="field.name"
    >
      <v-textarea
        v-if="field.kind === 'textarea'"
        auto-grow
        class="studio-ai-sessions__issue-request-input"
        :disabled="page.busy || stepInput.saving"
        hide-details="auto"
        :label="field.label"
        :model-value="stepInput.values[field.name] || ''"
        :placeholder="field.placeholder"
        :rows="field.rows || 8"
        variant="outlined"
        @update:model-value="stepInput.updateValue(field.name, $event)"
      />
      <v-text-field
        v-else
        class="studio-ai-sessions__issue-request-input"
        :disabled="page.busy || stepInput.saving"
        hide-details="auto"
        :label="field.label"
        :model-value="stepInput.values[field.name] || ''"
        :placeholder="field.placeholder"
        variant="outlined"
        @update:model-value="stepInput.updateValue(field.name, $event)"
      />
    </template>

    <v-alert
      v-if="stepInput.error"
      type="warning"
      variant="tonal"
      density="compact"
    >
      {{ stepInput.error }}
    </v-alert>

    <Vibe64WorkflowControlForm
      v-if="selectedWorkflowControlVisible"
      :can-submit-selected-control="canSubmitSelectedControl"
      :running="workflowControlsRunning"
      :selected-control="selectedControl"
      :selected-control-fields="selectedControlFields"
      :selected-control-values="selectedControlValues"
      :workflow-controls="workflowButtonControls"
      @activate-control="activateWorkflowControl"
      @cancel="clearSelectedControl"
      @submit="submitSelectedWorkflowControl"
      @update-value="updateSelectedControlValue"
    />

    <div
      v-else
      class="studio-ai-sessions__actions"
    >
      <template v-if="workflowControlsAvailable">
        <v-btn
          v-if="workflowControlsUseActionFallback"
          color="primary"
          variant="flat"
          :disabled="page.busy || !stepInput.canSubmit"
          :loading="stepInput.saving"
          :prepend-icon="mdiCheck"
          type="submit"
        >
          {{ stepInput.interaction?.submitLabel || "Submit" }}
        </v-btn>

        <v-btn
          v-for="control in workflowButtonControls"
          :key="control.id"
          :color="control.buttonColor"
          :disabled="control.disabled"
          :loading="control.loading"
          :prepend-icon="control.icon"
          :title="control.disabledReason || control.label"
          type="button"
          :variant="control.buttonVariant"
          @click="activateWorkflowControl(control.sourceControl || control)"
        >
          {{ control.label }}
        </v-btn>
      </template>

      <template v-else>
        <v-btn
          v-if="actions.currentNext?.visible"
          class="studio-ai-sessions__next-step-button"
          color="primary"
          variant="tonal"
          :disabled="page.busy || stepInput.saving || actions.currentNext.enabled !== true"
          :loading="stepInput.saving || actions.advanceCommand.isRunning"
          :prepend-icon="mdiArrowRight"
          :title="actions.currentNext.disabledReason || actions.currentNext.label || 'Next step'"
          @click="goNextFromStepInput"
        >
          {{ actions.currentNext.label || "Next step" }}
        </v-btn>

        <v-btn
          v-if="!stepInputHasWorkflowIntents"
          color="primary"
          :variant="stepInputHasWorkflowIntents ? 'tonal' : 'flat'"
          :disabled="page.busy || !stepInput.canSubmit"
          :loading="stepInput.saving"
          :prepend-icon="mdiCheck"
          type="submit"
        >
          {{ stepInput.interaction?.submitLabel || "Submit" }}
        </v-btn>

        <Vibe64SessionActionButton
          v-for="action in actions.currentActions"
          :key="action.id"
          :action="action"
          :actions="actions"
          :before-run="runActionFromStepInput"
          :busy="page.busy || stepInput.saving"
          variant="tonal"
        />
      </template>
    </div>
  </form>

  <div
    v-else-if="workflowControlsAvailable"
    class="studio-ai-sessions__workflow-controls"
  >
    <Vibe64WorkflowControlForm
      v-if="selectedWorkflowControlVisible"
      as-form
      :can-submit-selected-control="canSubmitSelectedControl"
      :running="workflowControlsRunning"
      :selected-control="selectedControl"
      :selected-control-fields="selectedControlFields"
      :selected-control-values="selectedControlValues"
      :workflow-controls="workflowButtonControls"
      @activate-control="activateWorkflowControl"
      @cancel="clearSelectedControl"
      @submit="submitSelectedWorkflowControl"
      @update-value="updateSelectedControlValue"
    />

    <div
      v-else
      class="studio-ai-sessions__actions"
    >
      <v-btn
        v-for="control in workflowButtonControls"
        :key="control.id"
        :color="control.buttonColor"
        :disabled="control.disabled"
        :loading="control.loading"
        :prepend-icon="control.icon"
        :title="control.disabledReason || control.label"
        type="button"
        :variant="control.buttonVariant"
        @click="activateWorkflowControl(control.sourceControl || control)"
      >
        {{ control.label }}
      </v-btn>
    </div>
  </div>

  <div v-else class="studio-ai-sessions__actions">
    <v-btn
      v-if="actions.currentNext?.visible"
      class="studio-ai-sessions__next-step-button"
      color="primary"
      variant="tonal"
      :disabled="page.busy || actions.currentNext.enabled !== true"
      :loading="actions.advanceCommand.isRunning"
      :prepend-icon="mdiArrowRight"
      :title="actions.currentNext.disabledReason || actions.currentNext.label || 'Next step'"
      @click="actions.goNext"
    >
      {{ actions.currentNext.label || "Next step" }}
    </v-btn>

    <v-btn
      v-if="review.acceptChangesUtilitiesVisible"
      color="primary"
      variant="flat"
      :disabled="review.diffDisabled"
      :loading="diff.loading"
      :prepend-icon="mdiFileCompare"
      :title="review.diffTitle"
      @click="diff.openDialog"
    >
      Review diff
    </v-btn>

    <Vibe64SessionActionButton
      v-for="action in actions.currentActions"
      :key="action.id"
      :action="action"
      :actions="actions"
      :busy="page.busy"
      variant="flat"
    />
  </div>

  <v-alert
    v-if="actions.actionResultMessage"
    :type="actions.actionResultType"
    variant="tonal"
    density="compact"
    class="studio-ai-sessions__notice"
  >
    {{ actions.actionResultMessage }}
  </v-alert>

  <v-alert
    v-if="actions.currentStepDisabledReason && !workflowControlsAvailable"
    type="info"
    variant="tonal"
    density="compact"
    class="studio-ai-sessions__notice"
  >
    {{ actions.currentStepDisabledReason }}
  </v-alert>

  <v-alert
    v-if="workflowClientControlError"
    type="warning"
    variant="tonal"
    density="compact"
    class="studio-ai-sessions__notice"
  >
    {{ workflowClientControlError }}
  </v-alert>

  <p v-if="page.copyStatus" class="text-caption text-medium-emphasis mb-0">
    {{ page.copyStatus }}
  </p>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiArrowRight,
  mdiCheck,
  mdiFileCompare,
  mdiRefresh
} from "@mdi/js";
import Vibe64BackgroundTasks from "@/components/studio/vibe64-session/Vibe64BackgroundTasks.vue";
import Vibe64SessionActionButton from "@/components/studio/vibe64-session/Vibe64SessionActionButton.vue";
import Vibe64WorkflowControlForm from "@/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue";
import {
  useVibe64AutopilotComposer
} from "@/composables/useVibe64AutopilotComposer.js";
import {
  useVibe64BackgroundTasks
} from "@/composables/useVibe64BackgroundTasks.js";
import {
  useVibe64ClientControls
} from "@/composables/useVibe64ClientControls.js";
import {
  controlSavesCurrentStepInputBeforeRun,
  currentStepInputHasDecisionControls
} from "@/lib/vibe64CurrentStepInputDecision.js";
import {
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  controlHasClientAction,
  controlIconToken,
  controlStateActive
} from "@/lib/vibe64PresentationControls.js";
import {
  currentStepWorkflowControls,
  workflowControlButtonPresentation,
  workflowControlSourceAction
} from "@/lib/vibe64WorkflowControlModel.js";

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  active: {
    default: true,
    type: Boolean
  },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  diff: {
    default: () => ({}),
    type: Object
  },
  page: {
    default: () => ({}),
    type: Object
  },
  review: {
    default: () => ({}),
    type: Object
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  session: {
    default: null,
    type: Object
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  },
  stepInput: {
    default: () => ({}),
    type: Object
  }
});

const stepInputHasWorkflowIntents = computed(() => (
  currentStepInputHasDecisionControls(props.session, props.stepInput.interaction)
));
const clientControls = useVibe64ClientControls({
  sessionsApiPath: () => props.sessionsApiPath
});
const workflowClientControlError = ref("");
const workflowControls = computed(() => {
  return currentStepWorkflowControls({
    actions: props.actions?.currentActions || [],
    interaction: props.stepInput?.interaction,
    session: props.session
  });
});
const workflowControlsAvailable = computed(() => workflowControls.value.length > 0);
const workflowControlsUseActionFallback = computed(() => Boolean(
  workflowControls.value.length &&
  workflowControls.value.every((control) => workflowControlSourceAction(control))
));
const workflowControlsRunning = computed(() => Boolean(
  props.page.busy ||
  props.stepInput.saving ||
  props.actions.runIntentCommand?.isRunning
));
const primaryIntentId = computed(() => props.active
  ? String(props.session?.presentation?.screen?.primaryIntentId || "")
  : "");
const workflowButtonControls = computed(() => {
  return screenControls.value.map((control) => ({
    ...control,
    ...workflowControlButtonPresentation(control),
    disabled: workflowControlDisabled(control),
    icon: workflowControlIcon(control),
    loading: workflowControlLoading(control),
    sourceControl: control
  }));
});
const {
  activateControl,
  canSubmitSelectedControl,
  clearSelectedControl,
  screenControls,
  selectedControl,
  selectedControlFields,
  selectedControlValues,
  submitSelectedControl,
  updateSelectedControlValue
} = useVibe64AutopilotComposer({
  conversationLog: computed(() => props.conversationLog),
  controls: workflowControls,
  isControlDisabled: workflowControlDisabled,
  onRunClientControl: runWorkflowClientControl,
  onRunControl: runWorkflowIntent,
  primaryIntentId,
  running: workflowControlsRunning
});
const selectedWorkflowControlVisible = computed(() => Boolean(
  props.active &&
  workflowControlsAvailable.value &&
  selectedControl.value &&
  selectedControlFields.value.length
));

function workflowControlDisabled(control = {}) {
  return Boolean(
    workflowControlsRunning.value ||
    control.enabled !== true ||
    controlStateActive(control, "disabledWhen", {
      diff: props.diff,
      review: props.review
    })
  );
}

function workflowControlLoading(control = {}) {
  const sourceAction = workflowControlSourceAction(control);
  if (sourceAction) {
    return Boolean(
      props.actions.runActionCommand?.isRunning &&
      props.actions.activeActionId === sourceAction.id
    );
  }
  return Boolean(
    workflowControlsRunning.value ||
    controlStateActive(control, "loadingWhen", {
      diff: props.diff,
      review: props.review
    })
  );
}

function workflowControlIcon(control = {}) {
  const sourceAction = workflowControlSourceAction(control);
  if (sourceAction && typeof props.actions.actionIcon === "function") {
    return props.actions.actionIcon(sourceAction);
  }
  if (controlIconToken(control) === VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF) {
    return mdiFileCompare;
  }
  if (control.style === "primary") {
    return mdiCheck;
  }
  return mdiRefresh;
}

async function runWorkflowClientControl(control = {}) {
  workflowClientControlError.value = "";
  try {
    const result = await clientControls.runClientControl(control, {
      diff: props.diff,
      refreshSessionData: props.refreshSessionData,
      session: props.session,
      sessionId: props.session?.sessionId || ""
    });
    if (result?.ok === false) {
      workflowClientControlError.value = String(result.error || "The requested control could not run.");
      return false;
    }
    return result;
  } catch (error) {
    workflowClientControlError.value = String(error?.message || error || "The requested control could not run.");
    return false;
  }
}

async function runWorkflowIntent(control = {}, options = {}) {
  const fields = options?.fields && typeof options.fields === "object" && !Array.isArray(options.fields)
    ? options.fields
    : {};
  const sourceAction = workflowControlSourceAction(control);
  if (sourceAction) {
    return await props.actions.runAction(sourceAction, {
      input: fields
    }) !== false;
  }
  if (controlHasClientAction(control)) {
    return runWorkflowClientControl(control);
  }
  return await props.actions.runIntent(control, {
    fields
  }) !== false;
}

async function saveStepInputBeforeDecision(control = {}) {
  const nextStepControl = control?.kind === "next";
  const shouldSave = nextStepControl
    ? stepInputHasWorkflowIntents.value
    : controlSavesCurrentStepInputBeforeRun(control);
  if (
    !props.stepInput.visible ||
    !shouldSave
  ) {
    return true;
  }
  return await props.stepInput.submit();
}

async function activateWorkflowControl(control = {}) {
  if (await saveStepInputBeforeDecision(control) === false) {
    return false;
  }
  return activateControl(control);
}

async function submitSelectedWorkflowControl() {
  if (await saveStepInputBeforeDecision(selectedControl.value) === false) {
    return false;
  }
  return submitSelectedControl();
}

async function goNextFromStepInput() {
  if (await saveStepInputBeforeDecision({ kind: "next" }) === false) {
    return;
  }
  await props.actions.goNext();
}

async function runActionFromStepInput(action = {}) {
  return saveStepInputBeforeDecision(action);
}

async function submitStepInputForm() {
  if (selectedWorkflowControlVisible.value) {
    await submitSelectedWorkflowControl();
    return;
  }
  if (stepInputHasWorkflowIntents.value) {
    return;
  }
  await props.stepInput.submit();
}

const {
  backgroundTaskError,
  retryBackgroundTask,
  retryingBackgroundTaskId,
  visibleBackgroundTasks
} = useVibe64BackgroundTasks({
  refreshSessionData: () => props.refreshSessionData(),
  runClientControl: clientControls.runClientControl,
  session: computed(() => props.session)
});
</script>

<style scoped>
.studio-ai-sessions__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: flex-start;
}

.studio-ai-sessions__step-input,
.studio-ai-sessions__workflow-controls {
  display: grid;
  gap: 0.65rem;
}

.studio-ai-sessions__background-tasks {
  margin-bottom: 0.55rem;
}

.studio-ai-sessions__issue-request-input {
  max-width: 100%;
}

.studio-ai-sessions__notice {
  margin-top: 0.35rem;
}
</style>
