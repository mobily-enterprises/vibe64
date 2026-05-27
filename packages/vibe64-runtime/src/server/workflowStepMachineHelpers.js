import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  questionPromptInstructionBullets
} from "@local/vibe64-adapters/server/promptQuestionPolicy";
import {
  vibe64SessionDebugLog
} from "./sessionDebugLog.js";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT
} from "./workflowArtifacts.js";

const STEP_STATE_SCHEMA_VERSION = 1;

const STEP_STATUS = Object.freeze({
  ATTEMPTING_EXECUTION: "attempting_execution",
  AWAITING_AGENT_RESULT: "awaiting_agent_result",
  CONFIRM_FILES: "confirm_files",
  DONE: "done",
  FAILED: "failed",
  READY: "ready",
  WAITING_FOR_INPUT: "waiting_for_input"
});

const STEP_INPUT_KIND = Object.freeze({
  CONFIRM_FILES: "confirm_files",
  CONSIDER_RESOLVED: "consider_resolved",
  READY: "ready",
  SKIP: "skip",
  USER_RESPONSE: "user_response",
  WAITING_FOR_INPUT: "waiting_for_input"
});

function machineState(status, details = {}) {
  return {
    ...details,
    schemaVersion: STEP_STATE_SCHEMA_VERSION,
    status
  };
}

async function readState(context = {}, machine = {}) {
  const savedState = await context.runtime.store.readStepState(context.session.sessionId, machine.stepId);
  if (savedState?.schemaVersion === STEP_STATE_SCHEMA_VERSION && normalizeText(savedState.status)) {
    return savedState;
  }
  return {
    ...machine.initialState(context),
    stepId: machine.stepId
  };
}

async function writeState(context = {}, machine = {}, state = {}) {
  const record = await context.runtime.store.writeStepState(context.session.sessionId, machine.stepId, {
    schemaVersion: STEP_STATE_SCHEMA_VERSION,
    ...state
  });
  vibe64SessionDebugLog("server.stepMachine.writeState", {
    sessionId: String(context.session?.sessionId || ""),
    status: String(record.status || ""),
    stepId: String(machine.stepId || "")
  });
  return record;
}

function publicState(machine = {}, state = {}) {
  return {
    ...state,
    stepId: machine.stepId
  };
}

function nextForSession(session = {}, {
  disabledReason = "Complete this step before continuing.",
  enabled = false,
  label = "Next step"
} = {}) {
  return {
    disabledReason: enabled ? "" : disabledReason,
    enabled,
    label: session.next?.label || label,
    stepId: session.next?.stepId || "",
    visible: session.next?.visible !== false
  };
}

function disableAction(session = {}, actionId = "", disabledReason = "") {
  return (Array.isArray(session.actions) ? session.actions : []).map((action) => {
    if (action.id !== actionId) {
      return action;
    }
    return {
      ...action,
      disabledReason,
      enabled: false
    };
  });
}

function metadataExists(session = {}, name = "") {
  return Boolean(normalizeText(session.metadata?.[name]));
}

function artifactIsReady(session = {}, name = "") {
  return session.artifactReadiness?.[name]?.nonEmpty === true;
}

function actionCompleted(actionResult = {}) {
  return normalizeText(actionResult.status) === "completed";
}

async function actionCreatedMetadata(context = {}, metadataName = "") {
  return Boolean(
    normalizeText(context.actionResult?.metadata?.[metadataName]) ||
    normalizeText(await context.runtime.store.readMetadataValue(context.session.sessionId, metadataName))
  );
}

function normalizeInputFields(input = {}) {
  const fields = input?.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
    ? input.fields
    : input;
  return Object.fromEntries(Object.entries(fields || {}).map(([name, value]) => [
    normalizeText(name),
    normalizeText(value)
  ]).filter(([name]) => Boolean(name)));
}

function normalizeMachineInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    fields: normalizeInputFields(source.fields || source),
    kind: normalizeText(source.kind || STEP_INPUT_KIND.READY),
    message: normalizeText(source.message),
    source: normalizeText(source.source),
    stepId: normalizeText(source.stepId),
    stepStatus: normalizeText(source.stepStatus),
    text: normalizeText(source.text)
  };
}

function requireInputValue(value = "", message = "") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    throw vibe64Error(message, "vibe64_step_input_required");
  }
  return normalizedValue;
}

function unsupportedInputKind(kind = "", stepId = "") {
  return vibe64Error(
    `Vibe64 step ${stepId || "(unknown)"} cannot handle input kind: ${kind || "(empty)"}`,
    "vibe64_step_input_kind_not_available"
  );
}

function stateChangedError(session = {}, input = {}) {
  const expected = [
    input.stepId || "(missing step)",
    input.stepStatus || "(missing status)"
  ].join(":");
  const actual = [
    session.currentStep || "(no current step)",
    session.stepMachine?.status || "(no machine status)"
  ].join(":");
  return vibe64Error(
    `Reload state. This input was prepared for ${expected}, but the current workflow state is ${actual}.`,
    "vibe64_step_input_state_changed"
  );
}

function inputWasSubmittedByCodex(input = {}) {
  return normalizeText(input.source) === "codex";
}

function assertAgentResultSource(session = {}, input = {}) {
  if (inputWasSubmittedByCodex(input)) {
    return;
  }

  throw vibe64Error(
    `Reload state. The current workflow state is ${session.currentStep || "(no current step)"}:${session.stepMachine?.status || "(no machine status)"}, and it is waiting for Codex to submit the next result.`,
    "vibe64_step_input_state_changed"
  );
}

function assertInputMatchesCurrentState(session = {}, input = {}) {
  if (
    input.stepId !== normalizeText(session.currentStep) ||
    input.stepStatus !== normalizeText(session.stepMachine?.status)
  ) {
    throw stateChangedError(session, input);
  }
}

function artifactText(value = "") {
  return `${normalizeText(value)}\n`;
}

function commandFailureInteraction({
  prompt = "The command failed. Explain what should happen, then retry the command.",
  title = "Command needs attention"
} = {}) {
  return {
    fields: [
      {
        kind: "textarea",
        label: "What should happen next?",
        name: "response",
        required: true,
        requiredMessage: "Explain what should happen before retrying.",
        value: ""
      }
    ],
    kind: "command_failure_response",
    prompt,
    submitKind: STEP_INPUT_KIND.USER_RESPONSE,
    submitLabel: "Save response",
    title
  };
}

function promptWaitingForInputInteraction({
  actionId = "",
  prompt = "Codex needs more information before this step can continue.",
  submitLabel = "Send to Codex",
  title = "Talk to Codex"
} = {}) {
  return {
    actionId: normalizeText(actionId),
    fields: [
      {
        kind: "textarea",
        label: "Response",
        name: "conversationRequest",
        required: true,
        requiredMessage: "Response is required.",
        value: ""
      }
    ],
    intentId: "talk_to_codex",
    kind: "conversation",
    prompt,
    submitKind: "",
    submitLabel,
    title
  };
}

function promptActionDoneInstruction({
  fields = {},
  kind = STEP_INPUT_KIND.READY,
  stepId = "{{session.currentStep}}",
  stepStatus = "{{session.stepMachine.status}}"
} = {}) {
  const payload = {
    kind,
    stepId,
    stepStatus
  };
  if (Object.keys(fields).length > 0) {
    payload.fields = fields;
  }
  return JSON.stringify(payload, null, 2);
}

function promptActionWaitingForInputInstruction({
  stepId = "{{session.currentStep}}",
  stepStatus = "{{session.stepMachine.status}}"
} = {}) {
  return JSON.stringify({
    kind: STEP_INPUT_KIND.WAITING_FOR_INPUT,
    stepId,
    stepStatus,
    message: "The question or blocker for the user"
  }, null, 2);
}

function currentStepHelperInstruction({
  doneFields = {},
  doneMeaning = "The step is complete.",
  waitingForInputMeaning = "You need more information from the user.",
  stepId = "{{session.currentStep}}",
  stepStatus = "{{session.stepMachine.status}}"
} = {}) {
  return [
    "Vibe64 step completion contract:",
    "- Do not write Vibe64 workflow artifacts directly for this step.",
    "- When this step is complete, call the current-step input helper with this JSON:",
    promptActionDoneInstruction({
      fields: doneFields,
      stepId,
      stepStatus
    }),
    `- Meaning of ready: ${doneMeaning}`,
    "",
    "- If you need user input before this step can continue, call the current-step input helper with this JSON:",
    promptActionWaitingForInputInstruction({
      stepId,
      stepStatus
    }),
    `- Meaning of waiting_for_input: ${waitingForInputMeaning}`,
    "- Before calling the helper for waiting_for_input, write the same question or blocker in normal Codex response text so Inspect users can read it directly in the terminal.",
    "- Keep the visible question text and the helper `message` equivalent; do not make the UI-only helper message more complete than the terminal-visible response.",
    ...questionPromptInstructionBullets(),
    "",
    "After the helper reports success, stop. Do not write workflow artifacts directly for this step."
  ].join("\n");
}

function promptActionIsReadyForDone(input = {}) {
  return input.kind === STEP_INPUT_KIND.READY || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED;
}

async function writePromptResponseArtifact(context = {}, artifactName = "", text = "") {
  const normalizedArtifact = normalizeText(artifactName);
  if (!normalizedArtifact) {
    return;
  }
  await context.runtime.store.writeArtifact(context.session.sessionId, normalizedArtifact, artifactText(text));
}

function promptStepDoneView(context = {}, machine = {}, state = {}) {
  return {
    next: nextForSession(context.session, {
      enabled: true
    }),
    stepMachine: publicState(machine, state)
  };
}

function promptStepWaitingForInputView(context = {}, machine = {}, state = {}) {
  return {
    interaction: promptWaitingForInputInteraction({
      actionId: machine.promptActionId,
      prompt: state.message || "Codex needs more information before this step can continue.",
      title: "Talk to Codex"
    }),
    next: nextForSession(context.session, {
      disabledReason: "Answer Codex before continuing."
    }),
    stepMachine: publicState(machine, state)
  };
}

function promptStepWaitingView(context = {}, machine = {}, state = {}, message = "Wait for Codex to finish this step.") {
  return {
    next: nextForSession(context.session, {
      disabledReason: message
    }),
    stepMachine: publicState(machine, state)
  };
}

function chatWithAiPromptInstructionOptions({
  decidedBy = "user",
  doneFields = {
    response: "Concise Markdown response describing what changed, checks run, and any blockers"
  },
  doneMeaning = "",
  enoughWhen = "",
  waitingForInputMeaning = "You need a user answer before you can complete this conversation turn."
} = {}) {
  if (normalizeText(decidedBy) === "ai") {
    const enoughCondition = normalizeText(enoughWhen || doneMeaning);
    return {
      doneFields,
      doneMeaning: enoughCondition
        ? `You decide this AI discussion turn is complete only when: ${enoughCondition}`
        : "You decide when this AI discussion turn has enough information to finish.",
      waitingForInputMeaning
    };
  }

  return {
    doneFields,
    doneMeaning: doneMeaning ||
      "The current Codex conversation turn is complete. The user decides whether to ask another question or continue.",
    waitingForInputMeaning
  };
}

function createChatWithAiMachine({
  completionPolicy = {},
  nextWhenIdle = {
    enabled: true
  },
  promptActionId = "",
  responseArtifact = HUMAN_INPUT_RESPONSE_ARTIFACT,
  stepId = "",
  waitingMessage = "Wait for Codex to finish this conversation turn."
} = {}) {
  const normalizedPromptActionId = normalizeText(promptActionId);
  const normalizedStepId = normalizeText(stepId);
  if (!normalizedPromptActionId || !normalizedStepId) {
    throw vibe64Error("Chat-with-AI step machines require a step id and prompt action id.", "vibe64_invalid_step_machine");
  }

  return {
    promptActionId: normalizedPromptActionId,
    stepId: normalizedStepId,

    initialState() {
      return machineState(STEP_STATUS.READY);
    },

    async view(context = {}) {
      const state = await readState(context, this);
      switch (state.status) {
        case STEP_STATUS.WAITING_FOR_INPUT:
          return promptStepWaitingForInputView(context, this, state);
        case STEP_STATUS.AWAITING_AGENT_RESULT:
          return promptStepWaitingView(context, this, state, waitingMessage);
        case STEP_STATUS.READY:
        case STEP_STATUS.DONE:
        case STEP_STATUS.FAILED:
        default:
          return {
            next: nextForSession(context.session, valueFromConfig(nextWhenIdle, context, state)),
            stepMachine: publicState(this, state)
          };
      }
    },

    async submitInput(context = {}) {
      return handleStandardPromptInput(context, this, {
        responseArtifact
      });
    },

    async actionStarted(context = {}) {
      return markPromptActionStarted(context, this, normalizedPromptActionId, {
        restartDone: true
      });
    },

    promptInstruction() {
      return currentStepHelperInstruction(chatWithAiPromptInstructionOptions(completionPolicy));
    }
  };
}

function valueFromConfig(valueOrFactory, ...args) {
  return typeof valueOrFactory === "function" ? valueOrFactory(...args) : valueOrFactory;
}

function optionalActionsView(context = {}, state = {}, actionConfig = null) {
  const actions = valueFromConfig(actionConfig, context, state);
  return actions === null || actions === undefined ? {} : { actions };
}

// Shared lifecycle for steps that collect or receive draft artifact fields,
// show those fields for user confirmation, then optionally wait for a command.
function createEditableArtifactReviewMachine({
  command = null,
  done,
  draftOrigin = "user",
  draftReady,
  initialDetails = {},
  interaction,
  nextWhenConfirmed = {
    enabled: true
  },
  nextWhenDone = {
    enabled: true
  },
  nextWhenDrafting = {
    disabledReason: "Finish the draft before continuing."
  },
  nextWhenWaitingForInput = null,
  nextWhenWorking = {
    disabledReason: "Complete this step before continuing."
  },
  onConfirmedActions = null,
  onDoneActions = null,
  onWaitingActions = null,
  promptInstruction = null,
  readValues,
  saveValues,
  stepId = "",
  unsupportedDoneMessage = "This step cannot accept input right now.",
  waitingInteraction = null,
  waitingForInputState = null,
  userResponseResumeStatus = null
} = {}) {
  const normalizedStepId = normalizeText(stepId);
  const commandActionId = command ? normalizeText(command.actionId) : "";
  const commandDoneMetadata = command ? normalizeText(command.doneMetadata) : "";
  if (
    !normalizedStepId ||
    typeof draftReady !== "function" ||
    typeof interaction !== "function" ||
    typeof readValues !== "function" ||
    typeof saveValues !== "function"
  ) {
    throw vibe64Error("Editable artifact review machines require a step id, interaction, and draft artifact handlers.", "vibe64_invalid_step_machine");
  }
  if (
    command &&
    (!commandActionId || (typeof command.succeeded !== "function" && !commandDoneMetadata) || typeof command.failureState !== "function")
  ) {
    throw vibe64Error("Editable artifact review command config requires an action id, success detector, and failure state.", "vibe64_invalid_step_machine");
  }
  const initialDraftStatus = normalizeText(draftOrigin) === "prompt"
    ? STEP_STATUS.AWAITING_AGENT_RESULT
    : STEP_STATUS.WAITING_FOR_INPUT;

  function isDone(context = {}) {
    return typeof done === "function" ? done(context.session, context) : false;
  }

  function hasDraft(context = {}) {
    return draftReady(context.session, context);
  }

  function normalizeInitialDetails(context = {}) {
    return valueFromConfig(initialDetails, context) || {};
  }

  function waitingForInputNextOptions(context = {}, state = {}) {
    return valueFromConfig(nextWhenWaitingForInput || nextWhenDrafting, context, state);
  }

  function normalizeWaitingForInputState(input = {}, state = {}) {
    if (typeof waitingForInputState === "function") {
      return waitingForInputState(input, state);
    }
    return {
      from: state.from || initialDraftStatus,
      message: input.message,
      source: input.source
    };
  }

  function normalizeUserResponseResumeStatus(state = {}, input = {}) {
    if (typeof userResponseResumeStatus === "function") {
      return userResponseResumeStatus(state, input);
    }
    return state.from || initialDraftStatus;
  }

  return {
    stepId: normalizedStepId,

    initialState(context = {}) {
      if (isDone(context)) {
        return machineState(STEP_STATUS.DONE);
      }
      if (hasDraft(context)) {
        return machineState(STEP_STATUS.CONFIRM_FILES);
      }
      return machineState(initialDraftStatus, normalizeInitialDetails(context));
    },

    async view(context = {}) {
      let state = await readState(context, this);
      if (isDone(context)) {
        state = machineState(STEP_STATUS.DONE);
      } else if (hasDraft(context) && state.status !== STEP_STATUS.CONFIRM_FILES && state.from !== STEP_STATUS.ATTEMPTING_EXECUTION) {
        state = machineState(STEP_STATUS.CONFIRM_FILES);
      }

      switch (state.status) {
        case STEP_STATUS.DONE:
          return {
            ...optionalActionsView(context, state, onDoneActions),
            interaction: null,
            next: nextForSession(context.session, valueFromConfig(nextWhenDone, context, state)),
            stepMachine: publicState(this, state)
          };

        case STEP_STATUS.CONFIRM_FILES: {
          const values = await readValues(context);
          return {
            ...optionalActionsView(context, state, onConfirmedActions),
            interaction: interaction(STEP_STATUS.CONFIRM_FILES, values, context),
            next: nextForSession(context.session, valueFromConfig(nextWhenConfirmed, context, state)),
            stepMachine: publicState(this, state)
          };
        }

        case STEP_STATUS.AWAITING_AGENT_RESULT:
          return {
            interaction: null,
            next: nextForSession(context.session, valueFromConfig(nextWhenDrafting, context, state)),
            stepMachine: publicState(this, state)
          };

        case STEP_STATUS.WAITING_FOR_INPUT:
          return {
            ...optionalActionsView(context, state, onWaitingActions),
            interaction: waitingInteraction
              ? waitingInteraction(state, context)
              : interaction(STEP_STATUS.WAITING_FOR_INPUT, {}, context),
            next: nextForSession(context.session, waitingForInputNextOptions(context, state)),
            stepMachine: publicState(this, state)
          };

        case STEP_STATUS.FAILED:
          return {
            ...optionalActionsView(context, state, onWaitingActions),
            interaction: waitingInteraction ? waitingInteraction(state, context) : null,
            next: nextForSession(context.session, valueFromConfig(nextWhenWorking, context, state)),
            stepMachine: publicState(this, state)
          };

        case STEP_STATUS.READY:
        case STEP_STATUS.ATTEMPTING_EXECUTION:
        default:
          return {
            interaction: null,
            next: nextForSession(context.session, valueFromConfig(nextWhenWorking, context, state)),
            stepMachine: publicState(this, state)
          };
      }
    },

    async submitInput(context = {}) {
      const state = await readState(context, this);
      const input = normalizeMachineInput(context.input);
      switch (state.status) {
        case STEP_STATUS.AWAITING_AGENT_RESULT:
        case STEP_STATUS.WAITING_FOR_INPUT:
        case STEP_STATUS.CONFIRM_FILES:
        case STEP_STATUS.FAILED:
          if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
            assertAgentResultSource(context.session, input);
          }
          if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
            await writeState(context, this, machineState(
              STEP_STATUS.WAITING_FOR_INPUT,
              normalizeWaitingForInputState(input, state)
            ));
            return;
          }
          if (input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
            await writeState(context, this, machineState(normalizeUserResponseResumeStatus(state, input), {
              response: input.text || input.fields.response,
              source: input.source
            }));
            return;
          }
          if (input.kind !== STEP_INPUT_KIND.READY && input.kind !== STEP_INPUT_KIND.CONFIRM_FILES) {
            throw unsupportedInputKind(input.kind, this.stepId);
          }
          await saveValues(context, input.fields);
          await writeState(context, this, machineState(STEP_STATUS.CONFIRM_FILES));
          return;

        case STEP_STATUS.DONE:
        case STEP_STATUS.ATTEMPTING_EXECUTION:
        default:
          throw vibe64Error(unsupportedDoneMessage, "vibe64_step_input_not_available");
      }
    },

    async actionStarted(context = {}) {
      if (!command || context.actionId !== commandActionId || command.markAttemptingOnStart === false) {
        return;
      }
      const state = await readState(context, this);
      const startStatuses = command.startStatuses || [STEP_STATUS.CONFIRM_FILES, STEP_STATUS.FAILED];
      if (startStatuses.includes(state.status)) {
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
      }
    },

    async actionFinished(context = {}) {
      if (!command || context.actionId !== commandActionId) {
        return;
      }
      const state = await readState(context, this);
      const finishStatuses = command.finishStatuses || [
        STEP_STATUS.ATTEMPTING_EXECUTION,
        STEP_STATUS.CONFIRM_FILES,
        STEP_STATUS.WAITING_FOR_INPUT,
        STEP_STATUS.FAILED
      ];
      if (!finishStatuses.includes(state.status)) {
        return;
      }
      const succeeded = typeof command.succeeded === "function"
        ? await command.succeeded(context, state)
        : await commandSucceeded(context, commandDoneMetadata);
      await writeState(context, this, succeeded
        ? machineState(STEP_STATUS.DONE)
        : command.failureState(context, state));
    },

    ...(typeof promptInstruction === "function" ? { promptInstruction } : {})
  };
}

async function handleStandardPromptInput(context = {}, machine = {}, {
  responseArtifact = ""
} = {}) {
  const state = await readState(context, machine);
  const input = normalizeMachineInput(context.input);

  switch (state.status) {
    case STEP_STATUS.AWAITING_AGENT_RESULT:
      assertAgentResultSource(context.session, input);
      break;
    case STEP_STATUS.READY:
    case STEP_STATUS.WAITING_FOR_INPUT:
    case STEP_STATUS.FAILED:
      break;
    default:
      throw vibe64Error("This step is already complete.", "vibe64_step_input_not_available");
  }

  switch (state.status) {
    case STEP_STATUS.READY:
    case STEP_STATUS.AWAITING_AGENT_RESULT:
    case STEP_STATUS.WAITING_FOR_INPUT:
    case STEP_STATUS.FAILED:
      if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
        await writeState(context, machine, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
          from: STEP_STATUS.AWAITING_AGENT_RESULT,
          message: input.message,
          source: input.source
        }));
        return;
      }
      if (promptActionIsReadyForDone(input)) {
        if (responseArtifact) {
          await writePromptResponseArtifact(context, responseArtifact, input.fields.response || input.text);
        }
        await writeState(context, machine, machineState(STEP_STATUS.DONE, {
          message: input.message,
          source: input.source
        }));
        return;
      }
      throw unsupportedInputKind(input.kind, machine.stepId);

    case STEP_STATUS.DONE:
    default:
      throw vibe64Error("This step is already complete.", "vibe64_step_input_not_available");
  }
}

async function markPromptActionStarted(context = {}, machine = {}, actionId = "", {
  restartDone = false
} = {}) {
  if (context.actionId !== actionId) {
    return;
  }

  const state = await readState(context, machine);
  switch (state.status) {
    case STEP_STATUS.READY:
    case STEP_STATUS.FAILED:
    case STEP_STATUS.WAITING_FOR_INPUT:
      await writeState(context, machine, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        response: state.response,
        source: state.source
      }));
      return;

    case STEP_STATUS.AWAITING_AGENT_RESULT:
      return;
    case STEP_STATUS.DONE:
      if (restartDone) {
        await writeState(context, machine, machineState(STEP_STATUS.AWAITING_AGENT_RESULT));
      }
      return;
    default:
      return;
  }
}

async function commandSucceeded(context = {}, metadataName = "") {
  return actionCompleted(context.actionResult) && await actionCreatedMetadata(context, metadataName);
}

function allMetadataExists(session = {}, names = []) {
  return (Array.isArray(names) ? names : []).every((name) => metadataExists(session, name));
}

async function submitCommandFailureInput(context = {}, machine = {}) {
  const state = await readState(context, machine);
  const input = normalizeMachineInput(context.input);
  switch (state.status) {
    case STEP_STATUS.WAITING_FOR_INPUT:
    case STEP_STATUS.FAILED:
      if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
        await writeState(context, machine, machineState(STEP_STATUS.READY, {
          response: input.text || input.fields.response,
          source: input.source
        }));
        return;
      }
      throw unsupportedInputKind(input.kind, machine.stepId);

    case STEP_STATUS.READY:
    case STEP_STATUS.ATTEMPTING_EXECUTION:
    case STEP_STATUS.DONE:
    default:
      throw vibe64Error("This command step cannot accept input right now.", "vibe64_step_input_not_available");
  }
}

async function markCommandActionStarted(context = {}, machine = {}, actionIds = []) {
  if (!actionIds.includes(context.actionId)) {
    return;
  }

  const state = await readState(context, machine);
  switch (state.status) {
    case STEP_STATUS.READY:
    case STEP_STATUS.FAILED:
    case STEP_STATUS.WAITING_FOR_INPUT:
      await writeState(context, machine, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        actionId: context.actionId
      }));
      return;

    case STEP_STATUS.ATTEMPTING_EXECUTION:
    case STEP_STATUS.DONE:
    default:
      return;
  }
}

async function writeCommandActionFinishedState(context = {}, machine = {}, {
  actionIds = [],
  done = false,
  failureTitle = "Command needs attention",
  incompleteState = STEP_STATUS.READY
} = {}) {
  if (!actionIds.includes(context.actionId)) {
    return;
  }

  const state = await readState(context, machine);
  switch (state.status) {
    case STEP_STATUS.ATTEMPTING_EXECUTION:
    case STEP_STATUS.READY:
    case STEP_STATUS.WAITING_FOR_INPUT:
    case STEP_STATUS.FAILED:
      if (done) {
        await writeState(context, machine, machineState(STEP_STATUS.DONE));
        return;
      }
      if (actionCompleted(context.actionResult)) {
        await writeState(context, machine, machineState(incompleteState));
        return;
      }
      await writeState(context, machine, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        from: STEP_STATUS.ATTEMPTING_EXECUTION,
        message: normalizeText(context.actionResult?.message),
        output: normalizeText(context.actionResult?.output),
        title: failureTitle
      }));
      return;

    case STEP_STATUS.DONE:
    default:
      return;
  }
}

function commandStepView(context = {}, machine = {}, state = {}, {
  disabledReason = "Complete this command step before continuing.",
  failurePrompt = "",
  failureTitle = "Command needs attention"
} = {}) {
  switch (state.status) {
    case STEP_STATUS.DONE:
      return {
        next: nextForSession(context.session, {
          enabled: true
        }),
        stepMachine: publicState(machine, state)
      };

    case STEP_STATUS.WAITING_FOR_INPUT:
      return {
        interaction: commandFailureInteraction({
          prompt: state.message || failurePrompt,
          title: state.title || failureTitle
        }),
        next: nextForSession(context.session, {
          disabledReason
        }),
        stepMachine: publicState(machine, state)
      };

    case STEP_STATUS.READY:
    case STEP_STATUS.ATTEMPTING_EXECUTION:
    case STEP_STATUS.FAILED:
    default:
      return {
        next: nextForSession(context.session, {
          disabledReason
        }),
        stepMachine: publicState(machine, state)
      };
  }
}

export {
  STEP_INPUT_KIND,
  STEP_STATUS,
  actionCompleted,
  actionCreatedMetadata,
  allMetadataExists,
  artifactIsReady,
  artifactText,
  assertAgentResultSource,
  assertInputMatchesCurrentState,
  commandFailureInteraction,
  commandStepView,
  commandSucceeded,
  createChatWithAiMachine,
  createEditableArtifactReviewMachine,
  currentStepHelperInstruction,
  disableAction,
  handleStandardPromptInput,
  machineState,
  markCommandActionStarted,
  markPromptActionStarted,
  metadataExists,
  nextForSession,
  normalizeMachineInput,
  promptStepDoneView,
  promptStepWaitingForInputView,
  promptStepWaitingView,
  publicState,
  readState,
  requireInputValue,
  submitCommandFailureInput,
  unsupportedInputKind,
  writeCommandActionFinishedState,
  writeState
};
