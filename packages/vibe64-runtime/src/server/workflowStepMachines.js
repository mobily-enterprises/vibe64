import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  STEP_STATUS,
  assertInputMatchesCurrentState,
  inputResponseText,
  machineState,
  normalizeMachineInput,
  readState,
  writeState
} from "./workflowStepMachineHelpers.js";

function workflowStepMachine(runtime = null, stepId = "") {
  return typeof runtime?.workflowStepMachineForStep === "function"
    ? runtime.workflowStepMachineForStep(stepId)
    : null;
}

function currentStepResultContractValue(value, session = {}) {
  if (typeof value === "string") {
    return value
      .replaceAll("{{session.currentStep}}", normalizeText(session.currentStep))
      .replaceAll("{{session.stepMachine.status}}", normalizeText(session.stepMachine?.status));
  }
  if (Array.isArray(value)) {
    return value.map((item) => currentStepResultContractValue(item, session));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, currentStepResultContractValue(item, session)])
    );
  }
  return value;
}

function currentStepAgentResultContract(session = {}, action = {}, {
  runtime = null
} = {}) {
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (!machine) {
    return null;
  }
  const contract = typeof machine.agentResultContract === "function"
    ? machine.agentResultContract({
        action,
        session
      })
    : null;
  return contract && typeof contract === "object"
    ? currentStepResultContractValue(contract, session)
    : null;
}

function currentStepPromptInputInstruction(session = {}, action = {}, {
  runtime = null
} = {}) {
  return normalizeText(currentStepAgentResultContract(session, action, {
    runtime
  })?.instruction);
}

function currentStepInputConversationText(runtime = null, session = {}, input = {}) {
  const normalizedInput = normalizeMachineInput(input);
  const directText = inputResponseText(normalizedInput);
  if (directText) {
    return directText;
  }

  const machine = workflowStepMachine(runtime, session.currentStep);
  if (machine && typeof machine.inputCompletionMessage === "function") {
    const machineText = normalizeText(machine.inputCompletionMessage({
      input: normalizedInput,
      runtime,
      session
    }));
    if (machineText) {
      return machineText;
    }
  }
  return normalizedInput.kind === "ready"
    ? "Completed this step."
    : "";
}

function stepMachineBusyActionDisabledReason(stepMachine = {}) {
  switch (normalizeText(stepMachine?.status)) {
    case STEP_STATUS.ATTEMPTING_EXECUTION:
      return "Wait for the current command to finish.";
    case STEP_STATUS.AWAITING_AGENT_RESULT:
      return "Wait for Codex to finish this step.";
    default:
      return "";
  }
}

function disableBusyStepActions(actions = [], disabledReason = "") {
  return (Array.isArray(actions) ? actions : []).map((action) => {
    if (normalizeText(action.type) === "link") {
      return action;
    }
    return {
      ...action,
      disabledReason,
      enabled: false
    };
  });
}

async function applyStepMachineView(runtime, session = {}) {
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (!machine) {
    return session;
  }

  const view = await machine.view({
    runtime,
    session
  });
  const stepMachine = view.stepMachine || null;
  const currentStepDefinition = {
    ...session.currentStepDefinition,
    ...(view.interaction === undefined ? {} : { interaction: view.interaction })
  };
  let workflowAutopilot = view.workflowAutopilot
    ? {
        ...(session.workflowAutopilot || {}),
        ...view.workflowAutopilot
      }
    : session.workflowAutopilot;
  if ([STEP_STATUS.DONE, STEP_STATUS.WAITING_FOR_INPUT].includes(normalizeText(stepMachine?.status)) && workflowAutopilot) {
    workflowAutopilot = {
      ...workflowAutopilot,
      stage: null
    };
  }
  const busyActionDisabledReason = view.actions ? "" : stepMachineBusyActionDisabledReason(stepMachine);
  const actions = view.actions || (busyActionDisabledReason
    ? disableBusyStepActions(session.actions, busyActionDisabledReason)
    : session.actions);

  return {
    ...session,
    actions,
    currentStepDefinition,
    ...(view.next ? { next: view.next } : {}),
    stepMachine,
    workflowAutopilot
  };
}

async function saveStepMachineInput(runtime, sessionId = "", input = {}) {
  const session = await runtime.getSession(sessionId);
  const normalizedInput = normalizeMachineInput(input);
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (!machine || typeof machine.submitInput !== "function") {
    throw vibe64Error(
      `The current Vibe64 step does not accept direct input: ${session.currentStep || "(none)"}`,
      "vibe64_step_input_not_available"
    );
  }
  try {
    assertInputMatchesCurrentState(session, normalizedInput);
    await machine.submitInput({
      input: normalizedInput,
      runtime,
      session
    });
  } catch (error) {
    error.currentStep = normalizeText(session.currentStep);
    error.expectedInput = session.currentStepDefinition?.interaction || null;
    error.stepStatus = normalizeText(session.stepMachine?.status);
    throw error;
  }
  return runtime.getSession(session.sessionId);
}

async function recoverStuckStepMachineExecution(runtime, session = {}, {
  message = "Recovered stuck command execution. Re-run the current step."
} = {}) {
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (!machine) {
    throw vibe64Error(
      `The current Vibe64 step cannot be recovered: ${session.currentStep || "(none)"}`,
      "vibe64_step_recovery_not_available"
    );
  }
  const state = await readState({
    runtime,
    session
  }, machine);
  if (normalizeText(state.status) !== STEP_STATUS.ATTEMPTING_EXECUTION) {
    throw vibe64Error(
      "The current Vibe64 step is not waiting on an in-flight command.",
      "vibe64_step_recovery_not_available"
    );
  }
  await writeState({
    runtime,
    session
  }, machine, machineState(STEP_STATUS.READY, {
    from: STEP_STATUS.ATTEMPTING_EXECUTION,
    message: normalizeText(message)
  }));
}

async function returnControlFromAgentWait(runtime, session = {}, {
  inputPrompt = "What would you like to do?"
} = {}) {
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (!machine) {
    throw vibe64Error(
      `The current Vibe64 step cannot return control: ${session.currentStep || "(none)"}`,
      "vibe64_agent_control_return_not_available"
    );
  }
  const state = await readState({
    runtime,
    session
  }, machine);
  if (normalizeText(state.status) !== STEP_STATUS.AWAITING_AGENT_RESULT) {
    return false;
  }
  const {
    at: _previousAt,
    from: _previousFrom,
    schemaVersion: _previousSchemaVersion,
    source: _previousSource,
    status: _previousStatus,
    stepId: _previousStepId,
    ...previousDetails
  } = state;
  await writeState({
    runtime,
    session
  }, machine, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
    ...previousDetails,
    from: STEP_STATUS.AWAITING_AGENT_RESULT,
    message: normalizeText(inputPrompt),
    source: "system_recovery"
  }));
  return true;
}

async function recordStepMachineActionStarted(runtime, session = {}, actionId = "") {
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (typeof machine?.actionStarted !== "function") {
    return;
  }
  await machine.actionStarted({
    actionId,
    runtime,
    session
  });
}

async function recordStepMachineActionFinished(runtime, session = {}, actionId = "", actionResult = {}) {
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (typeof machine?.actionFinished !== "function") {
    return;
  }
  await machine.actionFinished({
    actionId,
    actionResult,
    runtime,
    session
  });
}

export {
  STEP_STATUS,
  applyStepMachineView,
  currentStepAgentResultContract,
  currentStepInputConversationText,
  currentStepPromptInputInstruction,
  recordStepMachineActionFinished,
  recordStepMachineActionStarted,
  recoverStuckStepMachineExecution,
  returnControlFromAgentWait,
  saveStepMachineInput
};
