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

function normalizeAction(action = {}, stepId = "") {
  const id = normalizeText(action.id);
  if (!id) {
    throw aiStudioError(`AI Studio workflow step ${stepId} has an action without an id.`, "ai_studio_workflow_action_id_missing");
  }
  const type = normalizeText(action.type || "command");
  return {
    adapterCapability: normalizeText(action.adapterCapability),
    disabledReason: normalizeText(action.disabledReason),
    enabledWhen: normalizeConditionList(action.enabledWhen),
    id,
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
    visible: next.visible !== false
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
    description: normalizeText(step.description),
    id,
    index,
    label: normalizeText(step.label || id),
    next: normalizeNext(step.next)
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
    status
  };
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
  if (action.adapterCapability) {
    definition.adapterCapability = action.adapterCapability;
  }
  if (action.promptId) {
    definition.promptId = action.promptId;
  }
  return definition;
}

function publicCurrentStepDefinition(step) {
  return {
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
    const workflowState = this.checkRequirements(action.enabledWhen, session, action.disabledReason);
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
}

export {
  WorkflowMachine,
  normalizeWorkflow
};
