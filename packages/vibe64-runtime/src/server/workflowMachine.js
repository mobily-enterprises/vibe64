import {
  VIBE64_SESSION_STATUS
} from "./sessionStore.js";
import {
  vibe64Error,
  isPlainObject,
  normalizeText,
  plainClone
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_ACTION_DISPATCH_ROUTES as ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";
import {
  WORKFLOW_CONDITION_KINDS,
  when
} from "./workflowConditions.js";
import {
  normalizeWorkflowInputField,
  normalizeWorkflowInputFields
} from "./workflowInputFields.js";

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map(normalizeText).filter(Boolean)
    : [];
}

function workflowConditionSummary(condition) {
  if (typeof condition === "string") {
    return normalizeText(condition) || "(empty)";
  }
  if (isPlainObject(condition)) {
    const kind = normalizeText(condition.kind);
    return kind ? `kind:${kind}` : "(condition object)";
  }
  return normalizeText(condition) || "(empty)";
}

function workflowConditionContext(context = "") {
  const normalizedContext = normalizeText(context);
  return normalizedContext ? ` in ${normalizedContext}` : "";
}

function malformedWorkflowCondition(condition, context, reason) {
  throw vibe64Error(
    `Malformed Vibe64 workflow condition${workflowConditionContext(context)}: ${workflowConditionSummary(condition)}. ${reason}`,
    "vibe64_workflow_malformed_condition"
  );
}

function unknownWorkflowCondition(condition, context) {
  throw vibe64Error(
    `Unknown Vibe64 workflow condition${workflowConditionContext(context)}: ${workflowConditionSummary(condition)}.`,
    "vibe64_workflow_unknown_condition"
  );
}

function normalizeCompositeCondition(condition, conditions, context = "", label = "Composite") {
  if (!Array.isArray(conditions)) {
    malformedWorkflowCondition(condition, context, `${label} conditions require an array of conditions.`);
  }
  const normalizedConditions = [];
  for (const candidate of conditions) {
    const normalizedCandidate = normalizeWorkflowCondition(candidate, context);
    if (!normalizedCandidate) {
      malformedWorkflowCondition(condition, context, `${label} conditions require one or more non-empty conditions.`);
    }
    normalizedConditions.push(normalizedCandidate);
  }
  if (normalizedConditions.length === 0) {
    malformedWorkflowCondition(condition, context, `${label} conditions require one or more conditions.`);
  }
  return normalizedConditions;
}

function requiredStructuredValue(condition, value, context, reason) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    malformedWorkflowCondition(condition, context, reason);
  }
  return normalizedValue;
}

function requiredStructuredValues(condition, values, context, reason) {
  if (!Array.isArray(values)) {
    malformedWorkflowCondition(condition, context, reason);
  }
  const normalizedValues = values.map(normalizeText);
  if (normalizedValues.length === 0 || normalizedValues.some((entry) => !entry)) {
    malformedWorkflowCondition(condition, context, reason);
  }
  return normalizedValues;
}

function normalizeStructuredWorkflowCondition(condition, context = "") {
  if (!isPlainObject(condition)) {
    malformedWorkflowCondition(condition, context, "Condition must be a condition object.");
  }
  const kind = normalizeText(condition.kind);
  if (!kind) {
    malformedWorkflowCondition(condition, context, "Condition objects require a kind.");
  }
  switch (kind) {
    case WORKFLOW_CONDITION_KINDS.ALWAYS:
      return when.always();
    case WORKFLOW_CONDITION_KINDS.SESSION_ACTIVE:
      return when.sessionActive();
    case WORKFLOW_CONDITION_KINDS.METADATA_EXISTS:
      return when.metadataExists(requiredStructuredValue(
        condition,
        condition.metadataName,
        context,
        "Metadata conditions require a metadata name."
      ));
    case WORKFLOW_CONDITION_KINDS.ALL:
      return when.all(...normalizeCompositeCondition(condition, condition.conditions, context, "All"));
    case WORKFLOW_CONDITION_KINDS.ANY:
      return when.any(...normalizeCompositeCondition(condition, condition.conditions, context, "Any"));
    case WORKFLOW_CONDITION_KINDS.ARTIFACT_READY:
      return when.artifactReady(requiredStructuredValue(
        condition,
        condition.artifactName,
        context,
        "Artifact conditions require an artifact name."
      ));
    case WORKFLOW_CONDITION_KINDS.ALL_ARTIFACTS_READY:
      return when.allArtifactsReady(...requiredStructuredValues(
        condition,
        condition.artifactNames,
        context,
        "Artifacts conditions require one or more artifact names."
      ));
    case WORKFLOW_CONDITION_KINDS.ACTION_INPUT_EXISTS:
      return when.actionInputExists(
        requiredStructuredValue(condition, condition.actionId, context, "Action input conditions require an action id."),
        requiredStructuredValue(condition, condition.inputName, context, "Action input conditions require an input name.")
      );
    case WORKFLOW_CONDITION_KINDS.STEP_COMPLETED:
      return when.stepCompleted(requiredStructuredValue(
        condition,
        condition.stepId,
        context,
        "Completed step conditions require a step id."
      ));
    default:
      unknownWorkflowCondition(condition, context);
  }
}

function normalizeWorkflowCondition(condition, context = "") {
  return normalizeStructuredWorkflowCondition(condition, context);
}

function normalizeWorkflowConditionList(value, context = "") {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((condition) => normalizeWorkflowCondition(condition, context));
}

function workflowConditionLabel(condition) {
  const normalizedCondition = normalizeWorkflowCondition(condition);
  switch (normalizedCondition.kind) {
    case WORKFLOW_CONDITION_KINDS.ALWAYS:
      return "always";
    case WORKFLOW_CONDITION_KINDS.SESSION_ACTIVE:
      return "active session";
    case WORKFLOW_CONDITION_KINDS.METADATA_EXISTS:
      return `metadata "${normalizedCondition.metadataName}"`;
    case WORKFLOW_CONDITION_KINDS.ALL:
      return `all of (${normalizedCondition.conditions.map(workflowConditionLabel).join(", ")})`;
    case WORKFLOW_CONDITION_KINDS.ANY:
      return `any of (${normalizedCondition.conditions.map(workflowConditionLabel).join(", ")})`;
    case WORKFLOW_CONDITION_KINDS.ARTIFACT_READY:
      return `artifact "${normalizedCondition.artifactName}"`;
    case WORKFLOW_CONDITION_KINDS.ALL_ARTIFACTS_READY:
      return `artifacts ${normalizedCondition.artifactNames.map((artifactName) => `"${artifactName}"`).join(", ")}`;
    case WORKFLOW_CONDITION_KINDS.ACTION_INPUT_EXISTS:
      return `action input "${normalizedCondition.actionId}.${normalizedCondition.inputName}"`;
    case WORKFLOW_CONDITION_KINDS.STEP_COMPLETED:
      return `completed step "${normalizedCondition.stepId}"`;
    default:
      return workflowConditionSummary(normalizedCondition);
  }
}

function normalizeRewindCleanup(cleanup = {}) {
  return {
    actionResults: normalizeStringList(cleanup.actionResults),
    artifacts: normalizeStringList(cleanup.artifacts),
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

function normalizeInputFields(fields = [], actionId = "") {
  return normalizeWorkflowInputFields(fields, {
    duplicateCode: "vibe64_duplicate_workflow_input_field",
    missingNameCode: "vibe64_workflow_input_field_name_missing",
    ownerId: actionId,
    ownerLabel: "Vibe64 action"
  });
}

function sentenceFromLabel(label = "") {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) {
    return "";
  }
  return /[.!?]$/u.test(normalizedLabel) ? normalizedLabel : `${normalizedLabel}.`;
}

function defaultActionAuditMessage(action = {}, type = "") {
  if (normalizeText(type) === "link") {
    return "";
  }
  return sentenceFromLabel(action.label || action.id);
}

function normalizeActionComposerMenu(composerMenu = null) {
  if (composerMenu !== true && !isPlainObject(composerMenu)) {
    return null;
  }
  const source = composerMenu === true ? {} : composerMenu;
  if (source.visible === false) {
    return null;
  }
  return {
    group: normalizeText(source.group),
    icon: normalizeText(source.icon),
    label: normalizeText(source.label),
    mode: normalizeText(source.mode || "submit"),
    order: Number.isFinite(source.order) ? source.order : 0,
    visible: true
  };
}

function normalizeAction(action = {}, stepId = "") {
  const id = normalizeText(action.id);
  if (!id) {
    throw vibe64Error(`Vibe64 workflow step ${stepId} has an action without an id.`, "vibe64_workflow_action_id_missing");
  }
  const type = normalizeText(action.type || "command");
  const label = normalizeText(action.label || id);
  return {
    adapterCapability: normalizeText(action.adapterCapability),
    auditMessage: normalizeText(action.auditMessage) || defaultActionAuditMessage({ ...action, id, label }, type),
    advanceOnSuccess: action.advanceOnSuccess === true,
    composerMenu: normalizeActionComposerMenu(action.composerMenu),
    disabledReason: normalizeText(action.disabledReason),
    disabledWhenReason: normalizeText(action.disabledWhenReason || action.disabledReason),
    disabledWhen: normalizeWorkflowConditionList(action.disabledWhen, `step ${stepId} action ${id} disabledWhen`),
    enabledWhenReason: normalizeText(action.enabledWhenReason || action.disabledReason),
    enabledWhen: normalizeWorkflowConditionList(action.enabledWhen, `step ${stepId} action ${id} enabledWhen`),
    hrefMetadata: normalizeText(action.hrefMetadata),
    icon: normalizeText(action.icon),
    id,
    inputFields: normalizeInputFields(action.inputFields, id),
    label,
    promptId: type === "prompt" ? normalizeText(action.promptId || id) : "",
    recordsConversationTurn: action.recordsConversationTurn === true,
    saveCurrentStepInputBeforeRun: action.saveCurrentStepInputBeforeRun === true,
    type,
    visible: action.visible !== false
  };
}

function normalizeNext(next = {}, stepId = "") {
  return {
    disabledReason: normalizeText(next.disabledReason),
    enabledWhen: normalizeWorkflowConditionList(next.enabledWhen, `step ${stepId} next.enabledWhen`),
    label: normalizeText(next.label || "Next step"),
    visible: next.visible !== false,
    visibleWhen: normalizeWorkflowConditionList(next.visibleWhen, `step ${stepId} next.visibleWhen`)
  };
}

function normalizeAutopilotAction(action = {}, stepId = "", index = 0) {
  const actionId = normalizeText(action.actionId);
  return {
    actionId,
    advanceOnSuccess: action.advanceOnSuccess === true,
    completeWhen: normalizeWorkflowConditionList(
      action.completeWhen,
      `step ${stepId} autopilot action ${actionId || index + 1} completeWhen`
    ),
    label: normalizeText(action.label || action.actionId)
  };
}

function normalizeAutopilot(autopilot = {}, stepId = "") {
  const actionSequence = Array.isArray(autopilot.actionSequence)
    ? autopilot.actionSequence.map((action, index) => normalizeAutopilotAction(action, stepId, index)).filter((action) => action.actionId)
    : [];
  return {
    actionId: normalizeText(autopilot.actionId),
    actionSequence,
    advanceOnSuccess: autopilot.advanceOnSuccess === true,
    completeWhen: normalizeWorkflowConditionList(autopilot.completeWhen, `step ${stepId} autopilot.completeWhen`),
    kind: normalizeText(autopilot.kind),
    label: normalizeText(autopilot.label || autopilot.actionId),
    stop: autopilot.stop === true,
    userDecision: autopilot.userDecision === true
  };
}

function normalizeInteractionField(field = {}) {
  const name = normalizeText(field.name);
  const label = normalizeText(field.label || name);
  const normalized = normalizeWorkflowInputField(field, {
    defaultRequiredMessage: `${label || name} is required.`,
    missingNameCode: "vibe64_workflow_interaction_field_name_missing",
    ownerLabel: "Vibe64 step interaction"
  });
  return normalized;
}

function normalizeInteraction(interaction = {}) {
  const kind = normalizeText(interaction.kind);
  if (!kind) {
    return null;
  }
  return {
    fields: (Array.isArray(interaction.fields) ? interaction.fields : []).map(normalizeInteractionField),
    kind,
    primaryActionLabel: normalizeText(interaction.primaryActionLabel || "Continue"),
    prompt: normalizeText(interaction.prompt),
    submitLabel: normalizeText(interaction.submitLabel || "Submit"),
    title: normalizeText(interaction.title)
  };
}

function normalizeWorkflowStepBehavior(workflow = {}) {
  return {
    rejectTo: normalizeText(workflow.rejectTo),
    recheckTo: normalizeText(workflow.recheckTo)
  };
}

function normalizeActions(actions = [], stepId = "") {
  const seenActionIds = new Set();
  const normalizedActions = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    const normalizedAction = normalizeAction(action, stepId);
    if (seenActionIds.has(normalizedAction.id)) {
      throw vibe64Error(
        `Duplicate Vibe64 workflow action id in step ${stepId}: ${normalizedAction.id}`,
        "vibe64_duplicate_workflow_action"
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
    throw vibe64Error(`Vibe64 workflow step ${index + 1} is missing an id.`, "vibe64_workflow_step_id_missing");
  }
  if (seenStepIds.has(id)) {
    throw vibe64Error(`Duplicate Vibe64 workflow step id: ${id}`, "vibe64_duplicate_workflow_step");
  }
  seenStepIds.add(id);
  return {
    actions: normalizeActions(step.actions, id),
    autopilot: normalizeAutopilot(step.autopilot, id),
    description: normalizeText(step.description),
    id,
    index,
    interaction: normalizeInteraction(step.interaction),
    label: normalizeText(step.label || id),
    next: normalizeNext(step.next, id),
    presentation: plainClone(step.presentation || null),
    rewindCleanup: normalizeRewindCleanup(step.rewindCleanup),
    rewindable: step.rewindable !== false,
    workflow: normalizeWorkflowStepBehavior(step.workflow)
  };
}

function normalizeWorkflowIntentHandlers(intentHandlers = {}, stepIds = new Set(), workflowId = "default") {
  if (intentHandlers === undefined) {
    return {};
  }
  if (!isPlainObject(intentHandlers)) {
    throw vibe64Error(
      `Vibe64 workflow ${workflowId} intentHandlers must be an object.`,
      "vibe64_workflow_intent_handlers_invalid"
    );
  }
  const normalizedHandlers = {};
  for (const [rawStepId, stepHandlers] of Object.entries(intentHandlers)) {
    const stepId = normalizeText(rawStepId);
    if (!stepId || !stepIds.has(stepId)) {
      throw vibe64Error(
        `Vibe64 workflow ${workflowId} intentHandlers references unknown step: ${stepId || "(empty)"}.`,
        "vibe64_workflow_unknown_step"
      );
    }
    if (!isPlainObject(stepHandlers)) {
      throw vibe64Error(
        `Vibe64 workflow ${workflowId} intentHandlers.${stepId} must be an object.`,
        "vibe64_workflow_intent_handlers_invalid"
      );
    }
    normalizedHandlers[stepId] = Object.freeze(Object.fromEntries(Object.entries(stepHandlers)
      .map(([rawIntentId, handler]) => {
        const intentId = normalizeText(rawIntentId);
        if (!intentId || typeof handler !== "function") {
          throw vibe64Error(
            `Vibe64 workflow ${workflowId} intentHandlers.${stepId}.${intentId || "(empty)"} must be a function.`,
            "vibe64_workflow_intent_handlers_invalid"
          );
        }
        return [intentId, handler];
      })));
  }
  return normalizedHandlers;
}

function normalizeWorkflow(workflow = {}) {
  const workflowSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (workflowSteps.length === 0) {
    throw vibe64Error("Vibe64 workflow must contain at least one step.", "vibe64_empty_workflow");
  }
  const seenStepIds = new Set();
  const id = normalizeText(workflow.id || "default");
  const steps = workflowSteps.map((step, index) => normalizeStep(step, index, seenStepIds));
  return deepFreeze({
    id,
    intentHandlers: normalizeWorkflowIntentHandlers(workflow.intentHandlers, seenStepIds, id),
    steps
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

function publicAutopilotStage(action = null) {
  if (!action?.actionId) {
    return null;
  }
  return {
    actionId: action.actionId,
    advanceOnSuccess: action.advanceOnSuccess === true,
    label: action.label || action.actionId
  };
}

function publicAutopilotDefinition(autopilot = {}, currentStage = null) {
  const definition = {
    kind: autopilot.kind,
    stage: currentStage,
    stop: autopilot.stop,
    userDecision: autopilot.userDecision
  };
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

function publicActionDispatchRoute(action = {}) {
  if (action.type === "command") {
    return ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL;
  }
  if (action.type === "link") {
    return ACTION_DISPATCH_ROUTES.EXTERNAL_LINK;
  }
  return ACTION_DISPATCH_ROUTES.SESSION_ACTION;
}

function publicActionIcon(action = {}) {
  if (action.icon) {
    return action.icon;
  }
  if (action.type === "prompt") {
    return "codex";
  }
  if (action.type === "finish") {
    return "success";
  }
  return "code";
}

function publicActionDefinition(action) {
  const definition = {
    dispatchRoute: publicActionDispatchRoute(action),
    icon: publicActionIcon(action),
    id: action.id,
    label: action.label,
    type: action.type,
    visible: action.visible
  };
  if (action.advanceOnSuccess) {
    definition.advanceOnSuccess = true;
  }
  if (action.adapterCapability) {
    definition.adapterCapability = action.adapterCapability;
  }
  if (action.auditMessage) {
    definition.auditMessage = action.auditMessage;
  }
  if (action.composerMenu) {
    definition.composerMenu = {
      ...action.composerMenu
    };
  }
  if (action.promptId) {
    definition.promptId = action.promptId;
  }
  if (action.hrefMetadata) {
    definition.hrefMetadata = action.hrefMetadata;
  }
  if (action.recordsConversationTurn) {
    definition.recordsConversationTurn = true;
  }
  if (action.saveCurrentStepInputBeforeRun) {
    definition.saveCurrentStepInputBeforeRun = true;
  }
  if (action.inputFields.length > 0) {
    definition.inputFields = action.inputFields.map((field) => ({
      ...field
    }));
  }
  return definition;
}

function publicCurrentStepDefinition(step) {
  const definition = {
    actions: step.actions.map(publicActionDefinition),
    description: step.description,
    id: step.id,
    index: step.index,
    label: step.label,
    next: {
      label: step.next.label,
      visible: step.next.visible
    }
  };
  if (step.interaction) {
    definition.interaction = {
      ...step.interaction,
      fields: step.interaction.fields.map((field) => ({
        ...field
      }))
    };
  }
  return definition;
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
    workflow = {}
  } = {}) {
    this.workflow = normalizeWorkflow(workflow);
    this.steps = this.workflow.steps;
    this.stepById = new Map(this.steps.map((step) => [step.id, step]));
    this.intentHandlers = this.workflow.intentHandlers;
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
      throw vibe64Error(`Unknown Vibe64 workflow step: ${normalizedStepId || "(empty)"}`, "vibe64_unknown_workflow_step");
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

  intentHandlerForStepIntent(stepId = "", intentId = "") {
    const stepHandlers = this.intentHandlers[normalizeText(stepId)];
    const handler = isPlainObject(stepHandlers) ? stepHandlers[normalizeText(intentId)] : null;
    return typeof handler === "function" ? handler : null;
  }

  checkCondition(condition, session = {}) {
    const normalizedCondition = normalizeWorkflowCondition(condition);
    switch (normalizedCondition.kind) {
      case WORKFLOW_CONDITION_KINDS.ALWAYS:
        return conditionMet();
      case WORKFLOW_CONDITION_KINDS.SESSION_ACTIVE:
        return session.status === VIBE64_SESSION_STATUS.ACTIVE
          ? conditionMet()
          : conditionMissing("Session is not active.");
      case WORKFLOW_CONDITION_KINDS.METADATA_EXISTS: {
        const metadataName = normalizedCondition.metadataName;
        return normalizeText(session.metadata?.[metadataName])
          ? conditionMet()
          : conditionMissing(`Waiting for metadata: ${metadataName}.`);
      }
      case WORKFLOW_CONDITION_KINDS.ANY: {
        const conditions = normalizedCondition.conditions;
        if (conditions.some((candidate) => this.checkCondition(candidate, session).met)) {
          return conditionMet();
        }
        return conditionMissing(`Waiting for one of: ${conditions.map(workflowConditionLabel).join("; ")}.`);
      }
      case WORKFLOW_CONDITION_KINDS.ALL: {
        const conditions = normalizedCondition.conditions;
        for (const candidate of conditions) {
          const result = this.checkCondition(candidate, session);
          if (!result.met) {
            return conditionMissing(result.reason);
          }
        }
        return conditionMet();
      }
      case WORKFLOW_CONDITION_KINDS.ARTIFACT_READY: {
        const artifactName = normalizedCondition.artifactName;
        const artifact = session.artifactReadiness?.[artifactName];
        return artifact?.nonEmpty
          ? conditionMet()
          : conditionMissing(`Waiting for artifact: ${artifactName}.`);
      }
      case WORKFLOW_CONDITION_KINDS.ALL_ARTIFACTS_READY: {
        const artifactNames = normalizedCondition.artifactNames;
        const missingArtifact = artifactNames.find((artifactName) => {
          return session.artifactReadiness?.[artifactName]?.nonEmpty !== true;
        });
        return artifactNames.length > 0 && !missingArtifact
          ? conditionMet()
          : conditionMissing(`Waiting for artifacts: ${artifactNames.join(", ")}.`);
      }
      case WORKFLOW_CONDITION_KINDS.ACTION_INPUT_EXISTS: {
        const { actionId, inputName } = normalizedCondition;
        const actionResult = latestActionResult(session, actionId);
        return actionId && inputName && normalizeText(actionResult?.input?.[inputName])
          ? conditionMet()
          : conditionMissing(`Waiting for action input: ${actionId}.${inputName}.`);
      }
      case WORKFLOW_CONDITION_KINDS.STEP_COMPLETED: {
        const stepId = normalizedCondition.stepId;
        return this.completedStepIds(session).includes(stepId)
          ? conditionMet()
          : conditionMissing(`Waiting for step completion: ${stepId}.`);
      }
      default:
        return conditionMissing(`Unknown condition: ${workflowConditionLabel(normalizedCondition)}.`);
    }
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
        return disabledState(disabledReasonOverride || `Blocked by condition: ${workflowConditionLabel(condition)}.`);
      }
    }
    return enabledState();
  }

  visibleActionsForStep(step, session = {}) {
    return step.actions
      .filter((action) => action.visible)
      .map((action) => publicAction(action, this.actionStateForSession(step, action, session)));
  }

  autopilotStageForSession(step, session = {}) {
    const autopilot = step?.autopilot;
    if (!autopilot) {
      return null;
    }
    if (autopilot.actionSequence.length > 0) {
      const nextAction = autopilot.actionSequence.find((action) => {
        return !this.checkRequirements(action.completeWhen, session).enabled;
      });
      return publicAutopilotStage(nextAction);
    }
    if (!autopilot.actionId) {
      return null;
    }
    if (autopilot.completeWhen.length > 0 && this.checkRequirements(autopilot.completeWhen, session).enabled) {
      return null;
    }
    return publicAutopilotStage(autopilot);
  }

  nextStateForStep(currentStep, session = {}) {
    if (!currentStep) {
      return hiddenNext("Next step", "No current step.");
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
      workflowAutopilot: currentStep ? publicAutopilotDefinition(
        currentStep.autopilot,
        this.autopilotStageForSession(currentStep, session)
      ) : null,
      workflowStep: currentStep?.workflow || null,
      workflowPresentation: currentStep?.presentation || null,
      workflowId: this.workflow.id
    };
  }

  rewindPlanForSession(session = {}, stepId = "") {
    const targetStep = this.stepById.get(normalizeText(stepId));
    if (!targetStep) {
      throw vibe64Error(`Unknown Vibe64 rewind step: ${normalizeText(stepId) || "(empty)"}`, "vibe64_unknown_rewind_step");
    }
    if (!targetStep.rewindable) {
      throw vibe64Error(`Vibe64 step cannot be rewound: ${targetStep.label}`, "vibe64_step_not_rewindable");
    }

    const completed = new Set(this.completedStepIds(session));
    if (!completed.has(targetStep.id)) {
      throw vibe64Error(`Vibe64 step has not been completed: ${targetStep.label}`, "vibe64_rewind_step_not_completed");
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
      targetStepId: targetStep.id,
      targetStepLabel: targetStep.label
    };
  }
}

export {
  WorkflowMachine,
  normalizeWorkflowCondition,
  normalizeWorkflow
};
