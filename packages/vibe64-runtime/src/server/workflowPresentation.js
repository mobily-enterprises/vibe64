import {
  vibe64Error,
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS,
  VIBE64_OPERATION_ROUTES as OPERATION_ROUTES
} from "@local/vibe64-core/shared";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "./sessionDebugLog.js";
import {
  sessionHasWorktree
} from "./sessionWorktreeState.js";
import { STEP_STATUS } from "./workflowStepMachines.js";

// Vibe64 ownership contract:
// - Durable workflow truth remains in the session files, workflow machine, step
//   machines, action results, and metadata.
// - This module is the server-owned projection from workflow truth to UI and
//   automation presentation.
// - Clients render `presentation.screen`, submit server-provided intents/input,
//   and dispatch `presentation.auto.nextOperation` by its explicit route.
// - Clients must not infer workflow meaning from step ids, action names, action
//   types, or raw step-machine statuses.
const INTENT_IDS = Object.freeze({
  CONTINUE_STEP: "continue_step",
  RUN_OPTIONAL_CHECK: "run_optional_check",
  SKIP_OPTIONAL_CHECK: "skip_optional_check"
});

const COMMAND_RECOVERY_DELAY_MS = 5000;
const CODEX_BOOTSTRAP_TASK_ID = "codex_bootstrap";
const COMMAND_LIFECYCLE_RUNNING_PHASES = Object.freeze(new Set([
  "starting",
  "started"
]));
const COMMAND_LIFECYCLE_FINALIZING_PHASES = Object.freeze(new Set([
  "terminal_exited",
  "result_writing"
]));
const COMMAND_LIFECYCLE_COMMITTED_PHASES = Object.freeze(new Set([
  "advanced",
  "done",
  "failed",
  "post_commit_running",
  "result_written"
]));
const INTENT_PRESENTATION_GROUPS = Object.freeze([
  "decision",
  "stop"
]);
const CLIENT_CONTROL_ACTIONS = Object.freeze(new Set(Object.values(VIBE64_CLIENT_CONTROL_ACTIONS)));
const CLIENT_CONTROL_ICON_TOKENS = Object.freeze(new Set(Object.values(VIBE64_CLIENT_CONTROL_ICON_TOKENS)));
const CLIENT_CONTROL_STATE_FLAGS = Object.freeze(new Set(Object.values(VIBE64_CLIENT_CONTROL_STATE_FLAGS)));
const INPUT_BEHAVIOR_KINDS = Object.freeze({
  NUMBERED_QUESTIONS: "numbered_questions"
});
const INPUT_MESSAGE_SOURCES = Object.freeze({
  LATEST_ASSISTANT_MESSAGE: "latest_assistant_message"
});

function currentStepDefinition(session = {}) {
  return isPlainObject(session.currentStepDefinition) ? session.currentStepDefinition : {};
}

function currentAutopilot(session = {}) {
  const autopilot = session.workflowAutopilot;
  return isPlainObject(autopilot) ? autopilot : {};
}

function currentStepLabel(session = {}) {
  return normalizeText(currentStepDefinition(session).label || session.currentStep || "Current step");
}

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => normalizeText(action.id) === actionId) || null;
}

function stageAction(session = {}) {
  const stage = currentAutopilot(session).stage;
  if (!isPlainObject(stage) || !stage.actionId) {
    return null;
  }
  return {
    actionId: normalizeText(stage.actionId),
    advanceOnSuccess: stage.advanceOnSuccess === true,
    label: normalizeText(stage.label || stage.actionId)
  };
}

function nextIsReady(session = {}) {
  return session.next?.visible === true && session.next?.enabled === true && Boolean(session.next?.stepId);
}

function stepMachineStatus(session = {}) {
  return normalizeText(session.stepMachine?.status);
}

function stepMachineIsWaitingForCodex(session = {}) {
  return [
    STEP_STATUS.AWAITING_AGENT_RESULT,
    STEP_STATUS.ATTEMPTING_EXECUTION
  ].includes(stepMachineStatus(session));
}

function stepMachineNeedsInput(session = {}) {
  return [
    STEP_STATUS.CONFIRM_FILES,
    STEP_STATUS.WAITING_FOR_INPUT,
    STEP_STATUS.FAILED
  ].includes(stepMachineStatus(session));
}

function screen(kind, {
  icon = "cog",
  input = null,
  message = "",
  primaryIntentId = "",
  sections = [],
  showProgress = false,
  title = "",
  variant = ""
} = {}) {
  return {
    icon,
    ...(isPlainObject(input) ? { input } : {}),
    kind,
    message: normalizeText(message),
    primaryIntentId: normalizeText(primaryIntentId),
    sections,
    showProgress,
    title: normalizeText(title),
    variant: normalizeText(variant)
  };
}

function inputPresentation(input = {}, {
  submitTarget = ""
} = {}) {
  if (!isPlainObject(input)) {
    return null;
  }
  return {
    ...input,
    submitTarget: normalizeText(submitTarget || input.submitTarget)
  };
}

function intent(id, {
  actionId = "",
  disabledReason = "",
  enabled = true,
  control = null,
  input = null,
  inputFields = [],
  label = "",
  operation = "",
  style = "secondary"
} = {}) {
  const controlPresentation = isPlainObject(control) ? normalizeControlPresentation(control) : null;
  const intentInputPresentation = isPlainObject(input) ? input : null;
  const normalizedOperation = normalizeText(operation);
  return {
    actionId: normalizeText(actionId),
    ...(controlPresentation ? { control: controlPresentation } : {}),
    disabledReason: enabled ? "" : normalizeText(disabledReason || "This action is not available right now."),
    enabled: enabled === true,
    id,
    ...(intentInputPresentation ? { input: intentInputPresentation } : {}),
    inputFields: Array.isArray(inputFields) ? inputFields : [],
    label: normalizeText(label || id),
    ...(normalizedOperation ? { operation: normalizedOperation } : {}),
    style
  };
}

function normalizeControlAction(action = "", context = "client control") {
  const normalizedAction = normalizeText(action);
  if (normalizedAction && !CLIENT_CONTROL_ACTIONS.has(normalizedAction)) {
    presentationContractError(`${context} uses unknown action: ${normalizedAction}.`);
  }
  return normalizedAction;
}

function normalizeControlIconToken(icon = "", context = "client control") {
  const normalizedIcon = normalizeText(icon);
  if (normalizedIcon && !CLIENT_CONTROL_ICON_TOKENS.has(normalizedIcon)) {
    presentationContractError(`${context} uses unknown icon token: ${normalizedIcon}.`);
  }
  return normalizedIcon;
}

function normalizeControlStateFlags(values = [], context = "client control") {
  const flags = (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const unknownFlag = flags.find((flag) => !CLIENT_CONTROL_STATE_FLAGS.has(flag));
  if (unknownFlag) {
    presentationContractError(`${context} uses unknown state flag: ${unknownFlag}.`);
  }
  return flags;
}

function normalizeControlPresentation(control = {}) {
  const action = normalizeControlAction(control.action);
  const icon = normalizeControlIconToken(control.icon);
  const disabledWhen = normalizeControlStateFlags(control.disabledWhen, "client control disabledWhen");
  const loadingWhen = normalizeControlStateFlags(control.loadingWhen, "client control loadingWhen");
  if (!action && !icon && disabledWhen.length === 0 && loadingWhen.length === 0) {
    return null;
  }
  return {
    action,
    disabledWhen,
    icon,
    loadingWhen
  };
}

function intentForAction(id, action = {}, options = {}) {
  const configuredInputFields = Array.isArray(options.inputFields) && options.inputFields.length > 0
    ? options.inputFields
    : null;
  return intent(id, {
    ...options,
    actionId: action?.id || options.actionId || "",
    disabledReason: action?.disabledReason || options.disabledReason || "",
    enabled: action?.enabled === true,
    input: options.input,
    inputFields: configuredInputFields || action?.inputFields || [],
    label: options.label || action?.label || id
  });
}

function continueIntent(session = {}, {
  id = INTENT_IDS.CONTINUE_STEP,
  label = ""
} = {}) {
  return intent(normalizeText(id) || INTENT_IDS.CONTINUE_STEP, {
    disabledReason: session.next?.disabledReason || "",
    enabled: nextIsReady(session),
    label: label || session.next?.label || "Continue",
    operation: "continue",
    style: "primary"
  });
}

function presentationSections(names = []) {
  return names.map((name) => ({ kind: name }));
}

function stepPresentationConfig(session = {}) {
  const presentation = session.workflowPresentation;
  return isPlainObject(presentation) ? presentation : {};
}

function workflowStepBehavior(session = {}) {
  return isPlainObject(session.workflowStep) ? session.workflowStep : {};
}

function rejectTargetStepId(session = {}) {
  return normalizeText(workflowStepBehavior(session).rejectTo);
}

function presentationContractError(message = "Invalid workflow presentation contract.") {
  throw vibe64Error(message, "vibe64_workflow_presentation_invalid");
}

function requiredPresentationValue(source = {}, fieldName = "", context = "workflow presentation") {
  const value = normalizeText(source[fieldName]);
  if (!value) {
    presentationContractError(`${context} requires ${fieldName}.`);
  }
  return value;
}

function screenTitleFromConfig(config = {}, session = {}) {
  const title = normalizeText(config.title);
  if (title === "current_step") {
    return currentStepLabel(session);
  }
  if (normalizeText(config.titleActionId)) {
    const action = actionById(session, normalizeText(config.titleActionId));
    return `${action?.label || currentStepLabel(session)}${normalizeText(config.titleSuffix)}`;
  }
  return title || currentStepLabel(session);
}

function screenFromConfig(config = {}, session = {}) {
  const sectionNames = Array.isArray(config.sections) ? config.sections : [];
  return screen(config.kind || "stop", {
    icon: config.icon || "cog",
    message: config.message || "",
    primaryIntentId: config.primaryIntentId || "",
    sections: presentationSections(sectionNames),
    showProgress: config.showProgress === true,
    title: screenTitleFromConfig(config, session),
    variant: config.variant || ""
  });
}

function configuredIntentEnabled(session = {}, config = {}) {
  if (normalizeText(config.enabledWhenAction)) {
    return actionById(session, config.enabledWhenAction)?.enabled === true;
  }
  if (normalizeText(config.enabledWhen) === "has_next_step") {
    return session.next?.visible !== false && Boolean(session.next?.stepId);
  }
  return config.enabled !== false;
}

function configuredIntentDisabledReason(session = {}, config = {}, enabled = true) {
  if (enabled) {
    return "";
  }
  if (normalizeText(config.disabledReason)) {
    return config.disabledReason;
  }
  if (normalizeText(config.enabledWhenAction)) {
    return actionById(session, config.enabledWhenAction)?.disabledReason || "";
  }
  if (normalizeText(config.enabledWhen) === "has_next_step" && session.next?.visible === false) {
    return "There is no next workflow step.";
  }
  return "";
}

function intentFromConfig(session = {}, config = {}) {
  const id = normalizeText(config.id);
  if (!id) {
    return null;
  }
  if (normalizeText(config.type) === "continue") {
    return continueIntent(session, {
      id,
      label: config.label
    });
  }
  if (normalizeText(config.type) === "reject") {
    const enabled = Boolean(rejectTargetStepId(session));
    return intent(id, {
      disabledReason: enabled ? "" : "This workflow does not define a rejection target for the current step.",
      enabled,
      inputFields: config.inputFields,
      label: config.label || "Reject",
      operation: "reject",
      style: config.style || "secondary"
    });
  }
  if (normalizeText(config.type) === "action") {
    const stage = stageAction(session);
    const action = actionById(session, config.actionId || stage?.actionId || "");
    return intentForAction(id, action, {
      disabledReason: config.disabledReason || "",
      inputFields: config.inputFields,
      label: config.label || "",
      style: config.style || "secondary"
    });
  }
  const action = actionById(session, config.actionId || "");
  const enabled = configuredIntentEnabled(session, config);
  return intent(id, {
    actionId: config.actionId || "",
    control: config.control,
    disabledReason: action?.disabledReason || configuredIntentDisabledReason(session, config, enabled),
    enabled: action ? action.enabled === true && enabled : enabled,
    input: config.input,
    inputFields: Array.isArray(config.inputFields) && config.inputFields.length > 0
      ? config.inputFields
      : action?.inputFields || [],
    label: config.label || action?.label || "",
    style: config.style || "secondary"
  });
}

function presentationFromConfig(session = {}, config = {}) {
  const intents = (Array.isArray(config.intents) ? config.intents : [])
    .map((intentConfig) => intentFromConfig(session, intentConfig))
    .filter(Boolean);
  return {
    intents,
    screen: screenFromConfig(isPlainObject(config.screen) ? config.screen : {}, session)
  };
}

function configuredStopIntentsExcept(session = {}, excludedIntentIds = []) {
  const excluded = new Set(excludedIntentIds.map(normalizeText).filter(Boolean));
  const stopIntents = stopScreenPresentation(session).intents
    .filter((candidate) => !excluded.has(candidate.id));
  if (stopIntents.length > 0 || session.next?.visible === false || !session.next?.stepId) {
    return stopIntents;
  }
  const fallback = continueIntent(session);
  return excluded.has(fallback.id) ? [] : [fallback];
}

function stopScreenPresentation(session = {}) {
  const configured = stepPresentationConfig(session).stop;
  if (isPlainObject(configured)) {
    return presentationFromConfig(session, configured);
  }

  return {
    intents: [],
    screen: screen("stop", {
      title: currentStepLabel(session)
    })
  };
}

function userDecisionPresentation(session = {}) {
  const configured = stepPresentationConfig(session).decision;
  if (isPlainObject(configured)) {
    return presentationFromConfig(session, configured);
  }

  const action = actionById(session, stageAction(session)?.actionId);
  return {
    intents: [
      intentForAction(INTENT_IDS.RUN_OPTIONAL_CHECK, action, {
        label: action?.label || "Run check",
        style: "primary"
      }),
      intent(INTENT_IDS.SKIP_OPTIONAL_CHECK, {
        disabledReason: session.next?.visible === false ? "There is no next workflow step." : "",
        enabled: session.next?.visible !== false && Boolean(session.next?.stepId),
        label: "Skip"
      })
    ],
    screen: screen("decision", {
      message: "This optional check can take a long time. Run it now, or skip it and continue.",
      title: action?.label ? `${action.label}?` : currentStepLabel(session)
    })
  };
}

function interactionIntents(session = {}, interaction = {}) {
  return (Array.isArray(interaction.intents) ? interaction.intents : [])
    .map((intentConfig) => intentFromConfig(session, intentConfig))
    .filter(Boolean);
}

function interactionPresentation(session = {}) {
  const interaction = currentStepDefinition(session).interaction;
  if (!isPlainObject(interaction)) {
    return null;
  }
  const conversationIntentId = normalizeText(interaction.intentId);
  if (conversationIntentId || normalizeText(interaction.kind) === "conversation") {
    if (!conversationIntentId) {
      presentationContractError("Conversation interactions require an intentId.");
    }
    const inputFields = Array.isArray(interaction.fields) ? interaction.fields : [];
    const action = actionById(session, interaction.actionId || stageAction(session)?.actionId || "");
    const primaryIntent = intentForAction(conversationIntentId, action, {
      input: conversationIntentInputPresentation(session, inputFields),
      inputFields,
      label: interaction.submitLabel || action?.label || "Send to Codex",
      style: "primary"
    });
    return {
      intents: [
        primaryIntent,
        ...configuredStopIntentsExcept(session, [conversationIntentId])
      ],
      screen: screen("conversation", {
        input: inputPresentation(interaction, {
          submitTarget: "intent"
        }),
        message: interaction.prompt || "",
        primaryIntentId: conversationIntentId,
        sections: presentationSections(["response_preview"]),
        title: interaction.title || currentStepLabel(session)
      })
    };
  }
  return {
    intents: interactionIntents(session, interaction),
    screen: screen(stepMachineStatus(session) === STEP_STATUS.CONFIRM_FILES ? "confirm_files" : "input", {
      input: inputPresentation(interaction, {
        submitTarget: "current-step-input"
      }),
      message: interaction.prompt || "",
      title: interaction.title || currentStepLabel(session)
    })
  };
}

function conversationIntentInputPresentation(session = {}, fields = []) {
  if (stepMachineStatus(session) !== STEP_STATUS.WAITING_FOR_INPUT) {
    return null;
  }
  const fieldName = "conversationRequest";
  const field = Array.isArray(fields) && fields.length === 1 ? fields[0] : null;
  if (normalizeText(field?.name) !== fieldName || normalizeText(field?.kind) !== "textarea") {
    return null;
  }
  return {
    questionSugar: {
      fieldName,
      kind: INPUT_BEHAVIOR_KINDS.NUMBERED_QUESTIONS,
      source: INPUT_MESSAGE_SOURCES.LATEST_ASSISTANT_MESSAGE
    }
  };
}

function waitingPresentation(session = {}) {
  if (!stepMachineIsWaitingForCodex(session)) {
    return null;
  }
  return {
    intents: [],
    screen: screen("codex_running", {
      icon: "progress",
      message: "Wait for Codex to finish the current step.",
      showProgress: true,
      title: "Terminal is transmitting..."
    })
  };
}

function genericPresentation(session = {}) {
  if (nextIsReady(session)) {
    return {
      intents: [continueIntent(session)],
      screen: screen("ready", {
        title: currentStepLabel(session)
      })
    };
  }
  return {
    intents: [],
    screen: screen("blocked", {
      message: session.next?.disabledReason || "",
      title: currentStepLabel(session)
    })
  };
}

function automationWaitReason(session = {}) {
  if (stepMachineIsWaitingForCodex(session)) {
    return "codex";
  }
  if (stepMachineNeedsInput(session)) {
    return "input";
  }
  if (currentAutopilot(session).stop === true) {
    return "user";
  }
  if (currentAutopilot(session).userDecision === true) {
    return "decision";
  }
  return "";
}

function timestampAgeMs(value = "", nowMs = Date.now()) {
  const timestampMs = Date.parse(normalizeText(value));
  return Number.isFinite(timestampMs) ? Math.max(0, nowMs - timestampMs) : 0;
}

function commandLifecyclePhase(lifecycle = {}) {
  return normalizeText(lifecycle?.phase || lifecycle?.status);
}

function commandLifecycle(session = {}) {
  return isPlainObject(session.currentCommandLifecycle) ? session.currentCommandLifecycle : null;
}

function unavailableCommandRecovery(reason = "") {
  return {
    available: false,
    label: "Recover step",
    reason: normalizeText(reason),
    route: "recover-stuck-step"
  };
}

function availableCommandRecovery(reason = "") {
  return {
    ...unavailableCommandRecovery(reason),
    available: true
  };
}

function commandPresentation(session = {}) {
  const lifecycle = commandLifecycle(session);
  const phase = commandLifecyclePhase(lifecycle);
  const status = stepMachineStatus(session);
  if (status !== STEP_STATUS.ATTEMPTING_EXECUTION) {
    return {
      applying: false,
      lifecyclePhase: phase,
      recovery: unavailableCommandRecovery(),
      state: "idle"
    };
  }

  if (!phase || COMMAND_LIFECYCLE_RUNNING_PHASES.has(phase)) {
    return {
      applying: true,
      lifecyclePhase: phase,
      recovery: unavailableCommandRecovery("command_running"),
      state: "applying"
    };
  }

  if (COMMAND_LIFECYCLE_FINALIZING_PHASES.has(phase)) {
    const ageMs = timestampAgeMs(lifecycle.updatedAt || lifecycle.startedAt);
    if (ageMs < COMMAND_RECOVERY_DELAY_MS) {
      return {
        applying: true,
        lifecyclePhase: phase,
        recovery: {
          ...unavailableCommandRecovery("command_finalizing"),
          availableAfterMs: COMMAND_RECOVERY_DELAY_MS - ageMs
        },
        state: "applying"
      };
    }
    return {
      applying: false,
      lifecyclePhase: phase,
      recovery: availableCommandRecovery("command_finalization_stalled"),
      state: "stalled"
    };
  }

  if (COMMAND_LIFECYCLE_COMMITTED_PHASES.has(phase)) {
    return {
      applying: false,
      lifecyclePhase: phase,
      recovery: availableCommandRecovery("workflow_state_stalled"),
      state: "stalled"
    };
  }

  return {
    applying: true,
    lifecyclePhase: phase,
    recovery: unavailableCommandRecovery("command_state_unknown"),
    state: "applying"
  };
}

function actionOperation(session = {}, stage = {}) {
  const action = actionById(session, stage.actionId);
  if (!action || action.enabled !== true) {
    return {
      executable: false,
      kind: "stop",
      reason: action?.disabledReason || `${stage.label || stage.actionId || "Action"} is not available.`
    };
  }
  const route = action.dispatchRoute === OPERATION_ROUTES.COMMAND_TERMINAL
    ? OPERATION_ROUTES.COMMAND_TERMINAL
    : OPERATION_ROUTES.SESSION_ACTION;
  return {
    actionId: action.id,
    advanceOnSuccess: stage.advanceOnSuccess === true || action.advanceOnSuccess === true,
    executable: true,
    id: `${route}:${action.id}`,
    input: {},
    kind: route === OPERATION_ROUTES.COMMAND_TERMINAL ? "command" : "action",
    label: stage.label || action.label || action.id,
    route
  };
}

function advanceOperation(session = {}) {
  return {
    executable: true,
    id: `${OPERATION_ROUTES.SESSION_ADVANCE}:${session.next?.stepId || "next"}`,
    kind: "advance",
    label: session.next?.label || "Continue",
    route: OPERATION_ROUTES.SESSION_ADVANCE
  };
}

function intentOperation(intentId = "", {
  label = ""
} = {}) {
  const normalizedIntentId = normalizeText(intentId);
  return {
    executable: Boolean(normalizedIntentId),
    id: `${OPERATION_ROUTES.SESSION_INTENT}:${normalizedIntentId}`,
    intentId: normalizedIntentId,
    kind: "intent",
    label: normalizeText(label || normalizedIntentId),
    route: OPERATION_ROUTES.SESSION_INTENT
  };
}

function waitOperation(reason = "") {
  return {
    executable: false,
    kind: "wait",
    reason: normalizeText(reason)
  };
}

function stopOperation(reason = "") {
  return {
    executable: false,
    kind: "stop",
    reason: normalizeText(reason)
  };
}

function mergeOperation(session = {}, config = {}) {
  const metadata = session.metadata || {};
  const skippedMetadataName = requiredPresentationValue(config, "skippedMetadataName", "merge automation");
  const mergedMetadataName = requiredPresentationValue(config, "mergedMetadataName", "merge automation");
  if (normalizeText(metadata[skippedMetadataName])) {
    return nextIsReady(session)
      ? advanceOperation(session)
      : stopOperation(session.next?.disabledReason || "");
  }
  if (normalizeText(metadata[mergedMetadataName])) {
    return nextIsReady(session)
      ? advanceOperation(session)
      : stopOperation(session.next?.disabledReason || "");
  }
  if (stepMachineStatus(session) === STEP_STATUS.READY && session.stepMachine?.promptComplete === true) {
    return actionOperation(session, {
      actionId: requiredPresentationValue(config, "mergeActionId", "merge automation")
    });
  }
  if (stepMachineIsWaitingForCodex(session) || stepMachineNeedsInput(session)) {
    return waitOperation(automationWaitReason(session));
  }
  return actionOperation(session, {
    actionId: requiredPresentationValue(config, "prepareActionId", "merge automation")
  });
}

function configuredAutomationOperation(session = {}) {
  const automation = stepPresentationConfig(session).automation;
  if (!isPlainObject(automation)) {
    return null;
  }
  const metadata = session.metadata || {};
  const recheck = isPlainObject(automation.recheckAfterPrompt) ? automation.recheckAfterPrompt : null;
  if (
    recheck &&
    normalizeText(metadata[recheck.metadataName]) === normalizeText(recheck.metadataValue) &&
    (Array.isArray(recheck.statuses) ? recheck.statuses : []).includes(stepMachineStatus(session)) &&
    (recheck.promptComplete !== true || session.stepMachine?.promptComplete === true)
  ) {
    return intentOperation(recheck.intentId, {
      label: recheck.label
    });
  }

  const merge = isPlainObject(automation.mergeIntent) ? automation.mergeIntent : null;
  if (
    merge &&
    normalizeText(metadata[merge.metadataName]) === normalizeText(merge.metadataValue)
  ) {
    return mergeOperation(session, merge);
  }
  return null;
}

function nextAutomationOperation(session = {}) {
  const waitReason = automationWaitReason(session);

  const configuredOperation = configuredAutomationOperation(session);
  if (configuredOperation) {
    return configuredOperation;
  }

  if (waitReason) {
    return waitOperation(waitReason);
  }

  const stage = stageAction(session);
  if (stage) {
    return actionOperation(session, stage);
  }

  if (nextIsReady(session)) {
    return advanceOperation(session);
  }

  return stopOperation(session.next?.disabledReason || "");
}

function promptPresentation(session = {}) {
  const status = stepMachineStatus(session);
  switch (status) {
    case STEP_STATUS.AWAITING_AGENT_RESULT:
    case STEP_STATUS.ATTEMPTING_EXECUTION:
      return {
        state: "waiting_for_agent",
        statusText: "Waiting for Codex."
      };
    case STEP_STATUS.CONFIRM_FILES:
    case STEP_STATUS.WAITING_FOR_INPUT:
      return {
        state: "needs_user_input",
        statusText: "Input is required."
      };
    case STEP_STATUS.FAILED:
      return {
        state: "failed",
        statusText: "The current step needs attention."
      };
    case STEP_STATUS.DONE:
      return {
        state: "complete",
        statusText: "Complete."
      };
    case STEP_STATUS.READY:
    default:
      return {
        state: "idle",
        statusText: ""
      };
  }
}

function backgroundTaskRetryPresentation(task = {}, session = {}) {
  if (
    normalizeText(task.id) === CODEX_BOOTSTRAP_TASK_ID &&
    normalizeText(task.status) === "failed" &&
    !sessionHasWorktree(session)
  ) {
    return null;
  }
  const retry = isPlainObject(task.retry) ? task.retry : null;
  if (!retry) {
    return null;
  }
  const control = normalizeControlPresentation(isPlainObject(retry.control)
    ? retry.control
    : {
        action: retry.clientAction
      });
  if (!control) {
    return null;
  }
  return {
    control,
    label: normalizeText(retry.label) || "Retry"
  };
}

function backgroundTaskPresentation(session = {}) {
  return (Array.isArray(session.backgroundTasks) ? session.backgroundTasks : [])
    .map((task) => {
      if (!isPlainObject(task)) {
        return null;
      }
      const id = normalizeText(task.id);
      const status = normalizeText(task.status);
      if (!id || !status) {
        return null;
      }
      return {
        error: normalizeText(task.error),
        finishedAt: normalizeText(task.finishedAt),
        id,
        kind: normalizeText(task.kind),
        label: normalizeText(task.label) || id,
        message: normalizeText(task.message),
        retry: backgroundTaskRetryPresentation(task, session),
        startedAt: normalizeText(task.startedAt),
        status,
        terminalSessionId: normalizeText(task.terminalSessionId),
        updatedAt: normalizeText(task.updatedAt)
      };
    })
    .filter(Boolean);
}

function buildPresentation(session = {}) {
  const interaction = interactionPresentation(session);
  const waiting = waitingPresentation(session);
  const autopilot = currentAutopilot(session);
  const kind = normalizeText(autopilot.kind);
  let base = interaction || waiting;

  if (!base && stepMachineStatus(session) === STEP_STATUS.DONE && nextIsReady(session)) {
    base = genericPresentation(session);
  }
  if (!base && autopilot.userDecision === true) {
    base = userDecisionPresentation(session);
  }
  if (!base && autopilot.stop === true) {
    base = stopScreenPresentation(session);
  }
  if (!base) {
    base = genericPresentation(session);
  }

  const nextOperation = nextAutomationOperation(session);
  const command = commandPresentation(session);
  return {
    actions: Array.isArray(session.actions) ? session.actions : [],
    auto: {
      nextOperation
    },
    backgroundTasks: backgroundTaskPresentation(session),
    command,
    intents: base.intents,
    next: session.next || null,
    prompt: promptPresentation(session),
    recovery: command.recovery,
    screen: base.screen,
    step: {
      id: normalizeText(session.currentStep),
      label: currentStepLabel(session),
      status: stepMachineStatus(session),
      workflowKind: kind
    },
    terminal: {}
  };
}

function applyWorkflowPresentation(session = {}) {
  const presentation = buildPresentation(session);
  const {
    workflowAutopilot,
    workflowStep,
    workflowPresentation,
    ...publicSession
  } = session;
  void workflowAutopilot;
  void workflowStep;
  void workflowPresentation;
  return {
    ...publicSession,
    intents: presentation.intents,
    presentation
  };
}

function assertIntentMatchesCurrentState(session = {}, input = {}) {
  const stepId = normalizeText(input.stepId);
  const stepStatus = normalizeText(input.stepStatus);
  if (!stepId && !stepStatus) {
    return;
  }
  if (stepId !== normalizeText(session.currentStep) || stepStatus !== normalizeText(session.stepMachine?.status)) {
    const error = vibe64Error(
      `Reload state. This intent was prepared for ${stepId || "(missing step)"}:${stepStatus || "(missing status)"}, but the current workflow state is ${session.currentStep || "(no current step)"}:${session.stepMachine?.status || "(no machine status)"}.`,
      "vibe64_intent_state_changed"
    );
    error.operationOutcome = "stale_operation";
    error.refreshRecommended = true;
    error.sessionId = session.sessionId || "";
    error.revision = session.revision ?? null;
    error.currentStep = session.currentStep || "";
    error.stepRevision = session.stepRevision ?? null;
    error.stepStatus = session.stepMachine?.status || "";
    throw error;
  }
}

function intentById(session = {}, intentId = "") {
  return (Array.isArray(session.intents) ? session.intents : [])
    .find((candidate) => candidate.id === intentId) || null;
}

function automationIntentById(session = {}, intentId = "") {
  const operation = session.presentation?.auto?.nextOperation;
  if (
    operation?.kind !== "intent" ||
    normalizeText(operation.intentId) !== intentId ||
    operation.executable !== true
  ) {
    return null;
  }
  return intent(intentId, {
    enabled: true,
    label: operation.label || intentId
  });
}

function selectedIntentById(session = {}, intentId = "") {
  return intentById(session, intentId) || automationIntentById(session, intentId);
}

// Public session payloads intentionally strip `workflowPresentation`; intent
// execution re-reads the current step contract from the workflow machine.
function currentStepPresentationContract(runtime, session = {}) {
  if (isPlainObject(session.workflowPresentation)) {
    return session.workflowPresentation;
  }
  const machine = typeof runtime?.workflowMachineForSession === "function"
    ? runtime.workflowMachineForSession(session)
    : null;
  const step = typeof machine?.currentStepForSession === "function"
    ? machine.currentStepForSession(session)
    : null;
  return isPlainObject(step?.presentation) ? step.presentation : {};
}

function currentWorkflowStepBehavior(runtime, session = {}) {
  if (isPlainObject(session.workflowStep)) {
    return session.workflowStep;
  }
  const machine = typeof runtime?.workflowMachineForSession === "function"
    ? runtime.workflowMachineForSession(session)
    : null;
  const step = typeof machine?.currentStepForSession === "function"
    ? machine.currentStepForSession(session)
    : null;
  return isPlainObject(step?.workflow) ? step.workflow : {};
}

function presentationIntentConfigById(presentation = {}, intentId = "") {
  for (const groupName of INTENT_PRESENTATION_GROUPS) {
    const presentationGroup = presentation[groupName];
    const found = (Array.isArray(presentationGroup?.intents) ? presentationGroup.intents : [])
      .find((candidate) => normalizeText(candidate.id) === intentId);
    if (found) {
      return found;
    }
  }
  return null;
}

function automationIntentConfigById(presentation = {}, intentId = "") {
  const recheck = presentation?.automation?.recheckAfterPrompt;
  if (normalizeText(recheck?.intentId) !== intentId) {
    return null;
  }
  return recheck;
}

function intentConfigForIntent(runtime, session = {}, intentId = "") {
  const presentation = currentStepPresentationContract(runtime, session);
  return presentationIntentConfigById(presentation, intentId) ||
    automationIntentConfigById(presentation, intentId);
}

function firstPresentField(fields = {}, names = []) {
  return normalizeText(names.map((name) => fields[name]).find(Boolean));
}

function workflowHasStep(session = {}, stepId = "") {
  const normalizedStepId = normalizeText(stepId);
  return Boolean(normalizedStepId) && workflowStepIds(session).includes(normalizedStepId);
}

function workflowRejectTargetForSession(runtime, session = {}) {
  const targetStepId = normalizeText(currentWorkflowStepBehavior(runtime, session).rejectTo);
  if (!targetStepId) {
    throw vibe64Error("This workflow does not define a rejection target for the current step.", "vibe64_reject_target_missing");
  }
  if (!workflowHasStep(session, targetStepId)) {
    throw vibe64Error(`Workflow reject target does not exist: ${targetStepId}`, "vibe64_unknown_workflow_step");
  }
  return targetStepId;
}

function workflowRecheckTargetForSession(runtime, session = {}) {
  const targetStepId = normalizeText(currentWorkflowStepBehavior(runtime, session).recheckTo);
  if (!targetStepId) {
    throw vibe64Error("This workflow does not define a recheck target for the current step.", "vibe64_recheck_target_missing");
  }
  if (!workflowHasStep(session, targetStepId)) {
    throw vibe64Error(`Workflow recheck target does not exist: ${targetStepId}`, "vibe64_unknown_workflow_step");
  }
  return targetStepId;
}

function currentAutopilotAction(runtime, session = {}) {
  const machine = typeof runtime?.workflowMachineForSession === "function"
    ? runtime.workflowMachineForSession(session)
    : null;
  const step = typeof machine?.currentStepForSession === "function"
    ? machine.currentStepForSession(session)
    : null;
  const stage = typeof machine?.autopilotStageForSession === "function"
    ? machine.autopilotStageForSession(step, session)
    : null;
  return normalizeText(stage?.actionId);
}

async function runActionIntent(runtime, session = {}, selectedIntent = {}, intentConfig = {}, fields = {}) {
  const config = isPlainObject(intentConfig) ? intentConfig : {};
  const actionId = normalizeText(config.actionId) || selectedIntent.actionId;
  if (!actionId) {
    throw vibe64Error(
      `Intent ${selectedIntent.id || "(empty)"} does not define an action.`,
      "vibe64_intent_not_handled"
    );
  }
  return runtime.runAction(session.sessionId, actionId, fields);
}

async function rejectWorkflowIntent(runtime, session = {}, fields = {}) {
  const feedback = firstPresentField(fields, ["feedback", "message", "response"]);
  if (!feedback) {
    throw vibe64Error("Describe what should change before sending the work back to Codex.", "vibe64_intent_input_required");
  }
  const rewoundSession = await runtime.rewind(
    session.sessionId,
    workflowRejectTargetForSession(runtime, session)
  );
  const actionId = currentAutopilotAction(runtime, rewoundSession);
  if (!actionId) {
    throw vibe64Error(
      `Workflow reject target ${rewoundSession.currentStep || "(none)"} does not define an autopilot action.`,
      "vibe64_reject_target_action_missing"
    );
  }
  return runtime.runAction(rewoundSession.sessionId, actionId, {
    autopilotFeedback: feedback,
    autopilotReason: "changes_rejected"
  });
}

function workflowStepIds(session = {}) {
  return (Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [])
    .map((step) => normalizeText(step.id))
    .filter(Boolean);
}

async function advanceToWorkflowStep(runtime, session = {}, targetStepId = "") {
  const startedAtMs = Date.now();
  const normalizedTargetStepId = normalizeText(targetStepId);
  if (!normalizedTargetStepId) {
    throw vibe64Error("Workflow intent target step is required.", "vibe64_operation_target_required");
  }

  let currentSession = await runtime.getSession(session.sessionId);
  const stepIds = workflowStepIds(currentSession);
  if (!stepIds.includes(normalizedTargetStepId)) {
    throw vibe64Error(`Workflow target step does not exist: ${normalizedTargetStepId}`, "vibe64_unknown_workflow_step");
  }

  vibe64SessionDebugLog("server.workflowPresentation.advanceToStep.start", {
    ...vibe64SessionDebugSummary(currentSession),
    targetStepId: normalizedTargetStepId
  });

  for (let count = 0; normalizeText(currentSession.currentStep) !== normalizedTargetStepId; count += 1) {
    if (count >= stepIds.length) {
      throw vibe64Error(`Workflow could not advance to ${normalizedTargetStepId}.`, "vibe64_advance_target_not_reached");
    }
    vibe64SessionDebugLog("server.workflowPresentation.advanceToStep.advance", {
      ...vibe64SessionDebugSummary(currentSession),
      count: count + 1,
      targetStepId: normalizedTargetStepId
    });
    currentSession = await runtime.advance(currentSession.sessionId);
  }

  vibe64SessionDebugLog("server.workflowPresentation.advanceToStep.done", {
    ...vibe64SessionDebugSummary(currentSession),
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    targetStepId: normalizedTargetStepId
  });
  return currentSession;
}

function intentFields(input = {}) {
  if (isPlainObject(input.fields)) {
    return input.fields;
  }
  if (isPlainObject(input.input)) {
    return input.input;
  }
  return {};
}

function conversationInput(fields = {}) {
  return {
    conversationRequest: normalizeText(fields.conversationRequest || fields.feedback || fields.message || fields.response)
  };
}

async function forceAdvanceCurrentStep(runtime, session = {}, message = "Advanced by server intent.") {
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.workflowPresentation.forceAdvance.start", {
    ...vibe64SessionDebugSummary(session),
    message
  });
  try {
    if (typeof runtime?.forceAdvance !== "function") {
      throw vibe64Error(
        "Vibe64 runtime force-advance is not available.",
        "vibe64_force_advance_not_available"
      );
    }
    const advancedSession = await runtime.forceAdvance(session.sessionId, {
      message
    });
    vibe64SessionDebugLog("server.workflowPresentation.forceAdvance.done", {
      ...vibe64SessionDebugSummary(advancedSession),
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      fromStepId: session.currentStep
    });
    return advancedSession;
  } catch (error) {
    vibe64SessionDebugLog("server.workflowPresentation.forceAdvance.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      sessionId: session.sessionId
    });
    throw error;
  }
}

function workflowIntentHandlerForSession(runtime, session = {}, intentId = "") {
  const machine = typeof runtime?.workflowMachineForSession === "function"
    ? runtime.workflowMachineForSession(session)
    : null;
  return typeof machine?.intentHandlerForStepIntent === "function"
    ? machine.intentHandlerForStepIntent(session.currentStep, intentId)
    : null;
}

function workflowIntentContext(runtime, session = {}, selectedIntent = {}, fields = {}) {
  return {
    conversationInput: () => conversationInput(fields),
    currentAutopilotAction: (targetSession = session) => currentAutopilotAction(runtime, targetSession),
    deleteMetadata: (name = "") => runtime.store.deleteMetadataValue(session.sessionId, name),
    fields,
    forceAdvance: (message = "Advanced by server intent.") => forceAdvanceCurrentStep(runtime, session, message),
    getSession: () => runtime.getSession(session.sessionId),
    goTo: (stepId = "") => advanceToWorkflowStep(runtime, session, stepId),
    intent: selectedIntent,
    recheckTargetStepId: () => workflowRecheckTargetForSession(runtime, session),
    rejectTargetStepId: () => workflowRejectTargetForSession(runtime, session),
    rewind: (stepId = "") => runtime.rewind(session.sessionId, stepId),
    runAction: (actionId = "", input = fields) => runtime.runAction(session.sessionId, actionId, input),
    runtime,
    session,
    writeMetadata: (name = "", value = "") => runtime.store.writeMetadataValue(session.sessionId, name, value)
  };
}

async function runWorkflowIntentHandler(runtime, session = {}, selectedIntent = {}, fields = {}) {
  const handler = workflowIntentHandlerForSession(runtime, session, selectedIntent.id);
  if (!handler) {
    return null;
  }
  const result = await handler(workflowIntentContext(runtime, session, selectedIntent, fields));
  return result || runtime.getSession(session.sessionId);
}

async function runBuiltinWorkflowIntent(runtime, session = {}, selectedIntent = {}, intentConfig = {}, fields = {}) {
  const hasIntentConfig = isPlainObject(intentConfig) && Object.keys(intentConfig).length > 0;
  const type = normalizeText(intentConfig?.type || selectedIntent.operation);
  if (type === "continue") {
    return runtime.advance(session.sessionId);
  }
  if (type === "reject") {
    return rejectWorkflowIntent(runtime, session, fields);
  }
  if (type === "action" || (!hasIntentConfig && selectedIntent.actionId)) {
    return runActionIntent(runtime, session, selectedIntent, intentConfig, fields);
  }
  throw vibe64Error(
    `Intent ${selectedIntent.id || "(empty)"} has no server handler.`,
    "vibe64_intent_not_handled"
  );
}

async function runWorkflowIntent(runtime, sessionId = "", intentId = "", input = {}) {
  const session = await runtime.getSession(sessionId);
  const normalizedIntentId = normalizeText(intentId);
  const selectedIntent = selectedIntentById(session, normalizedIntentId);
  if (!selectedIntent) {
    throw vibe64Error(
      `Intent ${normalizedIntentId || "(empty)"} is not available on step ${session.currentStep || "(none)"}.`,
      "vibe64_intent_not_available"
    );
  }
  if (selectedIntent.enabled !== true) {
    throw vibe64Error(
      selectedIntent.disabledReason || `Intent ${normalizedIntentId} is disabled.`,
      "vibe64_intent_disabled"
    );
  }
  assertIntentMatchesCurrentState(session, input);

  const fields = intentFields(input);
  const handledSession = await runWorkflowIntentHandler(runtime, session, selectedIntent, fields);
  if (handledSession) {
    return handledSession;
  }
  return runBuiltinWorkflowIntent(
    runtime,
    session,
    selectedIntent,
    intentConfigForIntent(runtime, session, normalizedIntentId),
    fields
  );
}

export {
  applyWorkflowPresentation,
  runWorkflowIntent
};
