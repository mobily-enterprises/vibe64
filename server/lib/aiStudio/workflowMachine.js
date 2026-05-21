import {
  AI_STUDIO_SESSION_STATUS
} from "./sessionStore.js";
import {
  aiStudioError,
  normalizeText
} from "./core.js";
import { deepFreeze } from "./deepFreeze.js";
import {
  DEFAULT_AI_STUDIO_WORKFLOW
} from "./workflow.js";

function normalizeConditionList(value) {
  return Array.isArray(value)
    ? value.map(normalizeText).filter(Boolean)
    : [];
}

function normalizeRewindCleanup(cleanup = {}) {
  return {
    actionResults: normalizeConditionList(cleanup.actionResults),
    artifacts: normalizeConditionList(cleanup.artifacts),
    metadata: normalizeRewindMetadataCleanup(cleanup.metadata)
  };
}

function normalizeRewindMetadataCleanup(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          name: normalizeText(entry),
          unlessMetadataName: "",
          unlessMetadataValue: ""
        };
      }
      return {
        name: normalizeText(entry?.name),
        unlessMetadataName: normalizeText(entry?.unlessMetadata?.name),
        unlessMetadataValue: normalizeText(entry?.unlessMetadata?.value)
      };
    })
    .filter((entry) => entry.name);
}

function metadataCleanupApplies(entry = {}, session = {}) {
  if (!entry.unlessMetadataName) {
    return true;
  }
  return normalizeText(session.metadata?.[entry.unlessMetadataName]) !== entry.unlessMetadataValue;
}

function normalizeArtifactField(field = {}, actionId = "") {
  const name = normalizeText(field.name);
  if (!name) {
    throw aiStudioError(
      `AI Studio editor action ${actionId} has an artifact field without a name.`,
      "ai_studio_workflow_artifact_field_name_missing"
    );
  }
  const kind = normalizeText(field.kind || "textarea");
  return {
    kind: kind === "text" ? "text" : "textarea",
    label: normalizeText(field.label || name),
    metadataName: normalizeText(field.metadataName),
    name,
    required: field.required !== false,
    requiredMessage: normalizeText(field.requiredMessage)
  };
}

function normalizeArtifactFields(fields = [], actionId = "") {
  const seenFieldNames = new Set();
  const normalizedFields = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    const normalizedField = normalizeArtifactField(field, actionId);
    if (seenFieldNames.has(normalizedField.name)) {
      throw aiStudioError(
        `Duplicate AI Studio artifact field in action ${actionId}: ${normalizedField.name}`,
        "ai_studio_duplicate_workflow_artifact_field"
      );
    }
    seenFieldNames.add(normalizedField.name);
    normalizedFields.push(normalizedField);
  }
  return normalizedFields;
}

function normalizeInputField(field = {}, actionId = "") {
  const name = normalizeText(field.name);
  if (!name) {
    throw aiStudioError(
      `AI Studio action ${actionId} has an input field without a name.`,
      "ai_studio_workflow_input_field_name_missing"
    );
  }
  return {
    label: normalizeText(field.label || name),
    name,
    placeholder: normalizeText(field.placeholder),
    required: field.required !== false,
    requiredMessage: normalizeText(field.requiredMessage)
  };
}

function normalizeInputFields(fields = [], actionId = "") {
  const seenFieldNames = new Set();
  const normalizedFields = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    const normalizedField = normalizeInputField(field, actionId);
    if (seenFieldNames.has(normalizedField.name)) {
      throw aiStudioError(
        `Duplicate AI Studio input field in action ${actionId}: ${normalizedField.name}`,
        "ai_studio_duplicate_workflow_input_field"
      );
    }
    seenFieldNames.add(normalizedField.name);
    normalizedFields.push(normalizedField);
  }
  return normalizedFields;
}

function normalizeAction(action = {}, stepId = "") {
  const id = normalizeText(action.id);
  if (!id) {
    throw aiStudioError(`AI Studio workflow step ${stepId} has an action without an id.`, "ai_studio_workflow_action_id_missing");
  }
  const type = normalizeText(action.type || "command");
  return {
    adapterCapability: normalizeText(action.adapterCapability),
    allowRepeatedPromptRuns: action.allowRepeatedPromptRuns === true,
    advanceOnSuccess: action.advanceOnSuccess === true,
    artifactFields: type === "editor" ? normalizeArtifactFields(action.artifactFields, id) : [],
    disabledReason: normalizeText(action.disabledReason),
    disabledWhenReason: normalizeText(action.disabledWhenReason || action.disabledReason),
    disabledWhen: normalizeConditionList(action.disabledWhen),
    enabledWhenReason: normalizeText(action.enabledWhenReason || action.disabledReason),
    enabledWhen: normalizeConditionList(action.enabledWhen),
    hrefMetadata: normalizeText(action.hrefMetadata),
    id,
    inputFields: normalizeInputFields(action.inputFields, id),
    label: normalizeText(action.label || id),
    promptId: type === "prompt" ? normalizeText(action.promptId || id) : "",
    type,
    visible: action.visible !== false
  };
}

function normalizeNext(next = {}) {
  return {
    disabledReason: normalizeText(next.disabledReason),
    enabledWhen: normalizeConditionList(next.enabledWhen),
    label: normalizeText(next.label || "Next"),
    visible: next.visible !== false,
    visibleWhen: normalizeConditionList(next.visibleWhen)
  };
}

function normalizeAutopilotAction(action = {}) {
  return {
    actionId: normalizeText(action.actionId),
    advanceOnSuccess: action.advanceOnSuccess === true,
    completeWhen: normalizeConditionList(action.completeWhen),
    label: normalizeText(action.label || action.actionId)
  };
}

function normalizeAutopilot(autopilot = {}) {
  const actionSequence = Array.isArray(autopilot.actionSequence)
    ? autopilot.actionSequence.map(normalizeAutopilotAction).filter((action) => action.actionId)
    : [];
  return {
    actionId: normalizeText(autopilot.actionId),
    actionSequence,
    advanceOnSuccess: autopilot.advanceOnSuccess === true,
    completeWhen: normalizeConditionList(autopilot.completeWhen),
    kind: normalizeText(autopilot.kind),
    label: normalizeText(autopilot.label || autopilot.actionId),
    stop: autopilot.stop === true,
    userDecision: autopilot.userDecision === true
  };
}

function normalizeActions(actions = [], stepId = "") {
  const seenActionIds = new Set();
  const normalizedActions = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    const normalizedAction = normalizeAction(action, stepId);
    if (seenActionIds.has(normalizedAction.id)) {
      throw aiStudioError(
        `Duplicate AI Studio workflow action id in step ${stepId}: ${normalizedAction.id}`,
        "ai_studio_duplicate_workflow_action"
      );
    }
    seenActionIds.add(normalizedAction.id);
    normalizedActions.push(normalizedAction);
  }
  return normalizedActions;
}

function normalizeStep(step = {}, index = 0, seenStepIds = new Set()) {
  const id = normalizeText(step.id);
  if (!id) {
    throw aiStudioError(`AI Studio workflow step ${index + 1} is missing an id.`, "ai_studio_workflow_step_id_missing");
  }
  if (seenStepIds.has(id)) {
    throw aiStudioError(`Duplicate AI Studio workflow step id: ${id}`, "ai_studio_duplicate_workflow_step");
  }
  seenStepIds.add(id);
  return {
    actions: normalizeActions(step.actions, id),
    autopilot: normalizeAutopilot(step.autopilot),
    description: normalizeText(step.description),
    id,
    index,
    label: normalizeText(step.label || id),
    next: normalizeNext(step.next),
    rewindCleanup: normalizeRewindCleanup(step.rewindCleanup),
    rewindable: step.rewindable !== false
  };
}

function normalizeWorkflow(workflow = DEFAULT_AI_STUDIO_WORKFLOW) {
  const workflowSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (workflowSteps.length === 0) {
    throw aiStudioError("AI Studio workflow must contain at least one step.", "ai_studio_empty_workflow");
  }
  const seenStepIds = new Set();
  return deepFreeze({
    id: normalizeText(workflow.id || "default"),
    steps: workflowSteps.map((step, index) => normalizeStep(step, index, seenStepIds))
  });
}

function publicStepDefinition(step, status) {
  return {
    description: step.description,
    done: status === "done",
    id: step.id,
    index: step.index,
    label: step.label,
    rewindable: step.rewindable,
    status
  };
}

function publicAutopilotDefinition(autopilot = {}) {
  const definition = {
    actionSequence: autopilot.actionSequence.map((action) => ({
      ...action
    })),
    completeWhen: [...autopilot.completeWhen],
    kind: autopilot.kind,
    stop: autopilot.stop,
    userDecision: autopilot.userDecision
  };
  if (autopilot.actionId) {
    definition.actionId = autopilot.actionId;
  }
  if (autopilot.advanceOnSuccess) {
    definition.advanceOnSuccess = true;
  }
  if (autopilot.label) {
    definition.label = autopilot.label;
  }
  return definition;
}

function stepStatusForSession(step, currentStep, completedSteps) {
  if (completedSteps.has(step.id)) {
    return "done";
  }
  if (step.id === currentStep?.id) {
    return "current";
  }
  return "pending";
}

function publicAction(action, state) {
  return {
    ...publicActionDefinition(action),
    disabledReason: state.disabledReason,
    enabled: state.enabled
  };
}

function publicActionDefinition(action) {
  const definition = {
    id: action.id,
    label: action.label,
    type: action.type,
    visible: action.visible
  };
  if (action.advanceOnSuccess) {
    definition.advanceOnSuccess = true;
  }
  if (action.allowRepeatedPromptRuns) {
    definition.allowRepeatedPromptRuns = true;
  }
  if (action.adapterCapability) {
    definition.adapterCapability = action.adapterCapability;
  }
  if (action.promptId) {
    definition.promptId = action.promptId;
  }
  if (action.hrefMetadata) {
    definition.hrefMetadata = action.hrefMetadata;
  }
  if (action.artifactFields.length > 0) {
    definition.artifactFields = action.artifactFields.map((field) => ({
      ...field
    }));
  }
  if (action.inputFields.length > 0) {
    definition.inputFields = action.inputFields.map((field) => ({
      ...field
    }));
  }
  return definition;
}

function publicCurrentStepDefinition(step) {
  return {
    actions: step.actions.map(publicActionDefinition),
    autopilot: publicAutopilotDefinition(step.autopilot),
    description: step.description,
    id: step.id,
    index: step.index,
    label: step.label,
    next: {
      label: step.next.label,
      visible: step.next.visible
    }
  };
}

function conditionMet() {
  return {
    met: true,
    reason: ""
  };
}

function conditionMissing(reason) {
  return {
    met: false,
    reason
  };
}

function latestActionResult(session = {}, actionId = "") {
  const normalizedActionId = normalizeText(actionId);
  if (!normalizedActionId) {
    return null;
  }
  const actionResults = Array.isArray(session.actionResults) ? session.actionResults : [];
  return actionResults
    .filter((result) => normalizeText(result.actionId) === normalizedActionId)
    .slice()
    .sort((left, right) => normalizeText(left.at).localeCompare(normalizeText(right.at)))
    .at(-1) || null;
}

function actionInputConditionParts(conditionName = "") {
  const separatorIndex = conditionName.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === conditionName.length - 1) {
    return {
      actionId: "",
      inputName: ""
    };
  }
  return {
    actionId: normalizeText(conditionName.slice(0, separatorIndex)),
    inputName: normalizeText(conditionName.slice(separatorIndex + 1))
  };
}

function conditionValueList(value = "") {
  return normalizeText(value)
    .split(",")
    .map(normalizeText)
    .filter(Boolean);
}

function enabledState() {
  return {
    disabledReason: "",
    enabled: true
  };
}

function disabledState(reason) {
  return {
    disabledReason: normalizeText(reason),
    enabled: false
  };
}

function hiddenNext(label, disabledReason) {
  return {
    disabledReason,
    enabled: false,
    label,
    stepId: "",
    visible: false
  };
}

function defaultActionReadiness() {
  return enabledState();
}

class WorkflowMachine {
  constructor({
    actionReadiness = defaultActionReadiness,
    workflow = DEFAULT_AI_STUDIO_WORKFLOW
  } = {}) {
    this.workflow = normalizeWorkflow(workflow);
    this.steps = this.workflow.steps;
    this.stepById = new Map(this.steps.map((step) => [step.id, step]));
    this.actionReadiness = typeof actionReadiness === "function"
      ? actionReadiness
      : defaultActionReadiness;
  }

  firstStepId() {
    return this.steps[0].id;
  }

  assertStepId(stepId) {
    const normalizedStepId = normalizeText(stepId);
    if (!this.stepById.has(normalizedStepId)) {
      throw aiStudioError(`Unknown AI Studio workflow step: ${normalizedStepId || "(empty)"}`, "ai_studio_unknown_workflow_step");
    }
    return normalizedStepId;
  }

  stepAfter(stepId) {
    const step = this.stepById.get(normalizeText(stepId));
    return step ? this.steps[step.index + 1] || null : null;
  }

  stepsFrom(stepId) {
    const step = this.stepById.get(normalizeText(stepId));
    return step ? this.steps.slice(step.index) : [];
  }

  completedStepIds(session = {}) {
    const completed = new Set((Array.isArray(session.completedSteps) ? session.completedSteps : []).map(normalizeText));
    return this.steps
      .filter((step) => completed.has(step.id))
      .map((step) => step.id);
  }

  currentStepForSession(session = {}) {
    const completed = new Set(this.completedStepIds(session));
    const storedStepId = normalizeText(session.currentStep);
    if (this.stepById.has(storedStepId) && !completed.has(storedStepId)) {
      return this.stepById.get(storedStepId);
    }
    return this.steps.find((step) => !completed.has(step.id)) || null;
  }

  checkCondition(condition, session = {}) {
    const name = normalizeText(condition);
    if (!name || name === "always") {
      return conditionMet();
    }
    if (name === "session:active") {
      return session.status === AI_STUDIO_SESSION_STATUS.ACTIVE
        ? conditionMet()
        : conditionMissing("Session is not active.");
    }
    if (name.startsWith("metadata:")) {
      const metadataName = name.slice("metadata:".length);
      return normalizeText(session.metadata?.[metadataName])
        ? conditionMet()
        : conditionMissing(`Waiting for metadata: ${metadataName}.`);
    }
    if (name.startsWith("any:")) {
      const conditions = name
        .slice("any:".length)
        .split(";")
        .map(normalizeText)
        .filter(Boolean);
      if (conditions.some((candidate) => this.checkCondition(candidate, session).met)) {
        return conditionMet();
      }
      return conditionMissing(`Waiting for one of: ${conditions.join("; ")}.`);
    }
    if (name.startsWith("artifact:")) {
      const artifactName = name.slice("artifact:".length);
      const artifact = session.artifactReadiness?.[artifactName];
      return artifact?.nonEmpty
        ? conditionMet()
        : conditionMissing(`Waiting for artifact: ${artifactName}.`);
    }
    if (name.startsWith("artifacts:")) {
      const artifactNames = conditionValueList(name.slice("artifacts:".length));
      const missingArtifact = artifactNames.find((artifactName) => {
        return session.artifactReadiness?.[artifactName]?.nonEmpty !== true;
      });
      return artifactNames.length > 0 && !missingArtifact
        ? conditionMet()
        : conditionMissing(`Waiting for artifacts: ${artifactNames.join(", ")}.`);
    }
    if (name.startsWith("action-input:")) {
      const {
        actionId,
        inputName
      } = actionInputConditionParts(name.slice("action-input:".length));
      const actionResult = latestActionResult(session, actionId);
      return actionId && inputName && normalizeText(actionResult?.input?.[inputName])
        ? conditionMet()
        : conditionMissing(`Waiting for action input: ${actionId}.${inputName}.`);
    }
    if (name.startsWith("completed:")) {
      const stepId = name.slice("completed:".length);
      return this.completedStepIds(session).includes(stepId)
        ? conditionMet()
        : conditionMissing(`Waiting for step completion: ${stepId}.`);
    }
    return conditionMissing(`Unknown condition: ${name}.`);
  }

  checkRequirements(requirements = [], session = {}, disabledReasonOverride = "") {
    for (const requirement of requirements) {
      const result = this.checkCondition(requirement, session);
      if (!result.met) {
        return disabledState(disabledReasonOverride || result.reason);
      }
    }
    return enabledState();
  }

  actionStateForSession(step, action, session = {}) {
    const disabledStateForAction = this.checkBlockingConditions(action.disabledWhen, session, action.disabledWhenReason);
    if (!disabledStateForAction.enabled) {
      return disabledStateForAction;
    }
    const workflowState = this.checkRequirements(action.enabledWhen, session, action.enabledWhenReason);
    if (!workflowState.enabled) {
      return workflowState;
    }
    const runtimeState = this.actionReadiness({
      action,
      session,
      step
    }) || {};
    if (runtimeState.enabled === false) {
      return disabledState(runtimeState.disabledReason || "Action is not available.");
    }
    return enabledState();
  }

  checkBlockingConditions(conditions = [], session = {}, disabledReasonOverride = "") {
    for (const condition of conditions) {
      const result = this.checkCondition(condition, session);
      if (result.met) {
        return disabledState(disabledReasonOverride || `Blocked by condition: ${condition}.`);
      }
    }
    return enabledState();
  }

  visibleActionsForStep(step, session = {}) {
    return step.actions
      .filter((action) => action.visible)
      .map((action) => publicAction(action, this.actionStateForSession(step, action, session)));
  }

  nextStateForStep(currentStep, session = {}) {
    if (!currentStep) {
      return hiddenNext("Next", "No current step.");
    }
    const followingStep = this.stepAfter(currentStep.id);
    if (!followingStep) {
      return hiddenNext(currentStep.next.label, "No next step.");
    }
    if (!currentStep.next.visible) {
      return hiddenNext(currentStep.next.label, "");
    }

    const visibilityState = this.checkRequirements(currentStep.next.visibleWhen, session, currentStep.next.disabledReason);
    if (!visibilityState.enabled) {
      return hiddenNext(currentStep.next.label, visibilityState.disabledReason);
    }

    const state = this.checkRequirements(currentStep.next.enabledWhen, session, currentStep.next.disabledReason);
    return {
      disabledReason: state.disabledReason,
      enabled: state.enabled,
      label: currentStep.next.label,
      stepId: followingStep.id,
      visible: true
    };
  }

  stepDefinitionsForSession(currentStep, completedSteps) {
    const completed = new Set(completedSteps);
    return this.steps.map((step) => {
      const status = stepStatusForSession(step, currentStep, completed);
      return publicStepDefinition(step, status);
    });
  }

  buildSessionView(session = {}) {
    const completedSteps = this.completedStepIds(session);
    const currentStep = this.currentStepForSession(session);
    return {
      ...session,
      actions: currentStep ? this.visibleActionsForStep(currentStep, session) : [],
      completedSteps,
      currentStep: currentStep?.id || "",
      currentStepDefinition: currentStep ? publicCurrentStepDefinition(currentStep) : null,
      next: this.nextStateForStep(currentStep, session),
      stepDefinitions: this.stepDefinitionsForSession(currentStep, completedSteps),
      workflowId: this.workflow.id
    };
  }

  rewindPlanForSession(session = {}, stepId = "") {
    const targetStep = this.stepById.get(normalizeText(stepId));
    if (!targetStep) {
      throw aiStudioError(`Unknown AI Studio rewind step: ${normalizeText(stepId) || "(empty)"}`, "ai_studio_unknown_rewind_step");
    }
    if (!targetStep.rewindable) {
      throw aiStudioError(`AI Studio step cannot be rewound: ${targetStep.label}`, "ai_studio_step_not_rewindable");
    }

    const completed = new Set(this.completedStepIds(session));
    if (!completed.has(targetStep.id)) {
      throw aiStudioError(`AI Studio step has not been completed: ${targetStep.label}`, "ai_studio_rewind_step_not_completed");
    }

    const affectedSteps = this.stepsFrom(targetStep.id);
    const completedStepIds = affectedSteps
      .map((step) => step.id)
      .filter((affectedStepId) => completed.has(affectedStepId));
    const cleanup = affectedSteps.reduce((plan, step) => {
      plan.actionResults.push(...step.rewindCleanup.actionResults);
      plan.artifacts.push(...step.rewindCleanup.artifacts);
      plan.metadata.push(...step.rewindCleanup.metadata.filter((entry) => metadataCleanupApplies(entry, session)));
      return plan;
    }, {
      actionResults: [],
      artifacts: [],
      metadata: []
    });

    return {
      actionResultIds: Array.from(new Set(cleanup.actionResults)),
      artifactNames: Array.from(new Set(cleanup.artifacts)),
      completedStepIds,
      metadataNames: Array.from(new Set(cleanup.metadata.map((entry) => entry.name))),
      targetStepId: targetStep.id
    };
  }
}

export {
  WorkflowMachine,
  normalizeWorkflow
};
