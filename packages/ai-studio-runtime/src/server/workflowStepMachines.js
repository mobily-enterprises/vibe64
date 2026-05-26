import {
  aiStudioError,
  normalizeText
} from "@local/ai-studio-core/server/core";
import {
  STEP_STATUS,
  assertInputMatchesCurrentState,
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

function currentStepPromptInputInstruction(session = {}, action = {}, {
  runtime = null
} = {}) {
  const machine = workflowStepMachine(runtime, session.currentStep);
  if (!machine || typeof machine.promptInstruction !== "function") {
    return "";
  }
  return machine.promptInstruction({
    action,
    session
  })
    .replaceAll("{{session.currentStep}}", normalizeText(session.currentStep))
    .replaceAll("{{session.stepMachine.status}}", normalizeText(session.stepMachine?.status));
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
  let workflowAutopilot = session.workflowAutopilot;
  if ([STEP_STATUS.DONE, STEP_STATUS.WAITING_FOR_INPUT].includes(normalizeText(stepMachine?.status)) && workflowAutopilot) {
    workflowAutopilot = {
      ...workflowAutopilot,
      stage: null
    };
  }

  return {
    ...session,
    ...(view.actions ? { actions: view.actions } : {}),
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
    throw aiStudioError(
      `The current AI Studio step does not accept direct input: ${session.currentStep || "(none)"}`,
      "ai_studio_step_input_not_available"
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
    throw aiStudioError(
      `The current AI Studio step cannot be recovered: ${session.currentStep || "(none)"}`,
      "ai_studio_step_recovery_not_available"
    );
  }
  const state = await readState({
    runtime,
    session
  }, machine);
  if (normalizeText(state.status) !== STEP_STATUS.ATTEMPTING_EXECUTION) {
    throw aiStudioError(
      "The current AI Studio step is not waiting on an in-flight command.",
      "ai_studio_step_recovery_not_available"
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
  currentStepPromptInputInstruction,
  recordStepMachineActionFinished,
  recordStepMachineActionStarted,
  recoverStuckStepMachineExecution,
  saveStepMachineInput
};
