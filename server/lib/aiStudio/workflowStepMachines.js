import {
  aiStudioError,
  normalizeText
} from "./core.js";
import {
  aiStudioSessionDebugLog
} from "./sessionDebugLog.js";

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

const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const ISSUE_WORD_ARTIFACT = "issue_word";
const PULL_REQUEST_BODY_DRAFT_ARTIFACT = "tmp/create_pull_request.body.md";
const PULL_REQUEST_TITLE_DRAFT_ARTIFACT = "tmp/create_pull_request.title.txt";
const HUMAN_INPUT_RESPONSE_ARTIFACT = "response.md";
const REPORT_ARTIFACT = "report.md";
const STEP_INPUT_KIND = Object.freeze({
  CONFIRM_FILES: "confirm_files",
  CONSIDER_RESOLVED: "consider_resolved",
  READY: "ready",
  SKIP: "skip",
  USER_RESPONSE: "user_response",
  WAITING_FOR_INPUT: "waiting_for_input"
});

const sessionCreatedMachine = {
  stepId: "session_created",

  initialState() {
    return machineState(STEP_STATUS.DONE);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    return {
      next: nextForSession(context.session, {
        enabled: true
      }),
      stepMachine: publicState(this, state)
    };
  }
};

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
  aiStudioSessionDebugLog("server.stepMachine.writeState", {
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

function issueFilesAreReady(session = {}) {
  return [
    ISSUE_TITLE_ARTIFACT,
    ISSUE_WORD_ARTIFACT,
    ISSUE_BODY_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
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
    throw aiStudioError(message, "ai_studio_step_input_required");
  }
  return normalizedValue;
}

function unsupportedInputKind(kind = "", stepId = "") {
  return aiStudioError(
    `AI Studio step ${stepId || "(unknown)"} cannot handle input kind: ${kind || "(empty)"}`,
    "ai_studio_step_input_kind_not_available"
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
  return aiStudioError(
    `Reload state. This input was prepared for ${expected}, but the current workflow state is ${actual}.`,
    "ai_studio_step_input_state_changed"
  );
}

function inputWasSubmittedByCodex(input = {}) {
  return normalizeText(input.source) === "codex";
}

function assertAgentResultSource(session = {}, input = {}) {
  if (inputWasSubmittedByCodex(input)) {
    return;
  }

  throw aiStudioError(
    `Reload state. The current workflow state is ${session.currentStep || "(no current step)"}:${session.stepMachine?.status || "(no machine status)"}, and it is waiting for Codex to submit the next result.`,
    "ai_studio_step_input_state_changed"
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

async function readIssueFieldValues(context = {}) {
  const [title, body, word] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT)
  ]);
  return {
    body: normalizeText(body),
    title: normalizeText(title),
    word: normalizeText(word)
  };
}

async function writeIssueFieldValues(context = {}, fields = {}) {
  const title = requireInputValue(fields.title, "Issue title is required.");
  const body = requireInputValue(fields.body, "Issue body is required.");
  const word = requireInputValue(fields.word, "Session label is required.");

  await Promise.all([
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT, artifactText(title)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT, artifactText(body)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT, artifactText(word)),
    context.runtime.store.writeMetadataValue(context.session.sessionId, "issue_title", title),
    context.runtime.store.writeIssueWordMetadata(context.session.sessionId, word)
  ]);
}

function pullRequestFilesAreReady(session = {}) {
  return [
    PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
    PULL_REQUEST_BODY_DRAFT_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
}

async function readPullRequestFieldValues(context = {}) {
  const [title, body] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_TITLE_DRAFT_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_BODY_DRAFT_ARTIFACT)
  ]);
  return {
    body: normalizeText(body),
    title: normalizeText(title)
  };
}

async function writePullRequestFieldValues(context = {}, fields = {}) {
  const title = requireInputValue(fields.title, "Pull request title is required.");
  const body = requireInputValue(fields.body, "Pull request body is required.");
  await Promise.all([
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
      artifactText(title)
    ),
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_BODY_DRAFT_ARTIFACT,
      artifactText(body)
    )
  ]);
}

function issueInputInteraction(status = STEP_STATUS.WAITING_FOR_INPUT, values = {}) {
  return {
    fields: [
      {
        kind: "text",
        label: "Issue title",
        name: "title",
        required: true,
        requiredMessage: "Issue title is required.",
        value: values.title || ""
      },
      {
        kind: "text",
        label: "Session label",
        name: "word",
        required: true,
        requiredMessage: "Session label is required.",
        value: values.word || ""
      },
      {
        kind: "textarea",
        label: "Issue body",
        name: "body",
        required: true,
        requiredMessage: "Issue body is required.",
        value: values.body || ""
      }
    ],
    kind: "confirm_files_run_command",
    prompt: status === STEP_STATUS.CONFIRM_FILES
      ? "Review the issue details. Save changes here, or continue to create the GitHub issue."
      : "Discuss the requested change, then submit the issue title, session label, and issue body.",
    submitKind: status === STEP_STATUS.CONFIRM_FILES
      ? STEP_INPUT_KIND.CONFIRM_FILES
      : STEP_INPUT_KIND.READY,
    submitLabel: status === STEP_STATUS.CONFIRM_FILES ? "Update issue" : "Save issue",
    title: "Define issue"
  };
}

function pullRequestInputInteraction(values = {}) {
  return {
    fields: [
      {
        kind: "text",
        label: "Pull request title",
        name: "title",
        required: true,
        requiredMessage: "Pull request title is required.",
        value: values.title || ""
      },
      {
        kind: "textarea",
        label: "Pull request body",
        name: "body",
        required: true,
        requiredMessage: "Pull request body is required.",
        value: values.body || ""
      }
    ],
    kind: "collect_input_run_command",
    prompt: "Review the pull request details. Save changes here, or continue to create the GitHub pull request.",
    submitKind: STEP_INPUT_KIND.CONFIRM_FILES,
    submitLabel: "Update PR",
    title: "Create pull request"
  };
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
    "AI Studio step completion contract:",
    "- Do not write AI Studio workflow artifacts directly for this step.",
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
    "- Ask at most 3 questions at a time. If more uncertainty remains, ask the 3 highest-impact questions first.",
    "- When asking more than one question, format each question on its own line as `[1] Question text`, `[2] Question text`, and so on. Use the same numbered question text in the helper `message`.",
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
    throw aiStudioError("Chat-with-AI step machines require a step id and prompt action id.", "ai_studio_invalid_step_machine");
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
    throw aiStudioError("Editable artifact review machines require a step id, interaction, and draft artifact handlers.", "ai_studio_invalid_step_machine");
  }
  if (
    command &&
    (!commandActionId || (typeof command.succeeded !== "function" && !commandDoneMetadata) || typeof command.failureState !== "function")
  ) {
    throw aiStudioError("Editable artifact review command config requires an action id, success detector, and failure state.", "ai_studio_invalid_step_machine");
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
          throw aiStudioError(unsupportedDoneMessage, "ai_studio_step_input_not_available");
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
      throw aiStudioError("This step is already complete.", "ai_studio_step_input_not_available");
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
      throw aiStudioError("This step is already complete.", "ai_studio_step_input_not_available");
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
      throw aiStudioError("This command step cannot accept input right now.", "ai_studio_step_input_not_available");
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

const workSourceSelectedMachine = {
  stepId: "work_source_selected",

  initialState(context = {}) {
    return metadataExists(context.session, "work_source")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "work_source")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Choose a work source before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async actionFinished(context = {}) {
    if (!["use_new_branch", "use_existing_pr"].includes(context.actionId)) {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "work_source")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.FAILED, {
              message: normalizeText(context.actionResult?.message)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const worktreeCreatedMachine = {
  stepId: "worktree_created",

  initialState(context = {}) {
    if (metadataExists(context.session, "worktree_path")) {
      return machineState(STEP_STATUS.DONE);
    }
    if (!metadataExists(context.session, "work_source")) {
      return machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        message: "Choose a work source before creating the worktree."
      });
    }
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "worktree_path")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "create_worktree", "This step is already complete."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (state.from === STEP_STATUS.ATTEMPTING_EXECUTION) {
          return {
            actions: disableAction(context.session, "create_worktree", "Resolve the worktree command failure before retrying."),
            interaction: commandFailureInteraction({
              prompt: state.message || "The worktree command failed. Explain what should happen, then retry the command.",
              title: "Worktree command needs attention"
            }),
            next: nextForSession(context.session, {
              disabledReason: "Resolve the worktree command failure before continuing."
            }),
            stepMachine: publicState(this, state)
          };
        }
        return {
          next: nextForSession(context.session, {
            disabledReason: state.message || "Create the worktree before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Create the worktree before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The worktree step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "create_worktree") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "create_worktree") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "worktree_path")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
              from: STEP_STATUS.ATTEMPTING_EXECUTION,
              message: normalizeText(context.actionResult?.message),
              output: normalizeText(context.actionResult?.output)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const dependenciesInstalledMachine = {
  stepId: "dependencies_installed",

  initialState(context = {}) {
    return metadataExists(context.session, "dependencies_installed")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "dependencies_installed")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "install_dependencies", "This step is already complete."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        return {
          actions: disableAction(context.session, "install_dependencies", "Resolve the install command failure before retrying."),
          interaction: commandFailureInteraction({
            prompt: state.message || "The install command failed. Explain what should happen, then retry the command.",
            title: "Install command needs attention"
          }),
          next: nextForSession(context.session, {
            disabledReason: "Resolve the install command failure before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Install dependencies before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The dependency install step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "install_dependencies") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "install_dependencies") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "dependencies_installed")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
              from: STEP_STATUS.ATTEMPTING_EXECUTION,
              message: normalizeText(context.actionResult?.message),
              output: normalizeText(context.actionResult?.output)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const checklistItemsInstalledMachine = {
  ...dependenciesInstalledMachine,
  stepId: "checklist_items_installed"
};

const issueDefinitionMachine = createEditableArtifactReviewMachine({
  command: {
    actionId: "use_existing_issue",
    doneMetadata: "issue_url",
    failureState: (context = {}) => machineState(STEP_STATUS.FAILED, {
      message: normalizeText(context.actionResult?.message)
    }),
    finishStatuses: [
      STEP_STATUS.WAITING_FOR_INPUT,
      STEP_STATUS.CONFIRM_FILES,
      STEP_STATUS.FAILED
    ],
    markAttemptingOnStart: false
  },
  done: (session = {}) => metadataExists(session, "issue_url"),
  draftReady: issueFilesAreReady,
  initialDetails: {
    doing: "discussion"
  },
  interaction: issueInputInteraction,
  nextWhenDrafting: {
    disabledReason: "Define and save the issue before continuing."
  },
  nextWhenWorking: {
    disabledReason: "Define and save the issue before continuing."
  },
  onConfirmedActions: (context = {}) => disableAction(context.session, "use_existing_issue", "Issue details are already saved."),
  onDoneActions: (context = {}) => disableAction(context.session, "use_existing_issue", "An existing issue is already selected."),
  readValues: readIssueFieldValues,
  saveValues: writeIssueFieldValues,
  stepId: "issue_file_created",
  unsupportedDoneMessage: "The issue is already complete.",
  waitingForInputState: (input = {}) => ({
    doing: "discussion",
    message: input.message
  }),
  waitingInteraction: () => issueInputInteraction(STEP_STATUS.WAITING_FOR_INPUT, {})
});

const issueSubmittedMachine = {
  stepId: "issue_submitted",

  initialState(context = {}) {
    if (metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE);
    }
    return issueFilesAreReady(context.session)
      ? machineState(STEP_STATUS.READY)
      : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
          message: "Define and save the issue before creating it on GitHub."
        });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "issue_url")) {
      state = machineState(STEP_STATUS.DONE);
    } else if (issueFilesAreReady(context.session) && state.status === STEP_STATUS.WAITING_FOR_INPUT && state.from !== STEP_STATUS.ATTEMPTING_EXECUTION) {
      state = machineState(STEP_STATUS.READY);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "create_issue_on_gh", "The GitHub issue already exists."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        return {
          actions: disableAction(context.session, "create_issue_on_gh", "Resolve the issue command failure before retrying."),
          interaction: commandFailureInteraction({
            prompt: state.message || "The GitHub issue command failed. Explain what should happen, then retry the command.",
            title: "Issue command needs attention"
          }),
          next: nextForSession(context.session, {
            disabledReason: "Resolve the GitHub issue command failure before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Create the GitHub issue before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The GitHub issue step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "create_issue_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "create_issue_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        await writeState(context, this, await commandSucceeded(context, "issue_url")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
              from: STEP_STATUS.ATTEMPTING_EXECUTION,
              message: normalizeText(context.actionResult?.message),
              output: normalizeText(context.actionResult?.output)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const seedApplicationDefinitionMachine = createEditableArtifactReviewMachine({
  draftReady: issueFilesAreReady,
  initialDetails: {
    doing: "discussion"
  },
  interaction: issueInputInteraction,
  nextWhenDrafting: {
    disabledReason: "Define and save the seed issue before continuing."
  },
  nextWhenWorking: {
    disabledReason: "Define and save the seed issue before continuing."
  },
  readValues: readIssueFieldValues,
  saveValues: writeIssueFieldValues,
  stepId: "seed_application_defined",
  unsupportedDoneMessage: "The seed definition step cannot accept input right now.",
  waitingForInputState: (input = {}) => ({
    doing: "discussion",
    message: input.message
  }),
  waitingInteraction: () => issueInputInteraction(STEP_STATUS.WAITING_FOR_INPUT, {})
});

const makePlanMachine = {
  promptActionId: "make_plan",
  stepId: "plan_made",

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Ask Codex to make the plan before continuing.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this);
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The implementation plan has been written in the Codex response and is ready for execution.",
      waitingForInputMeaning: "You cannot make a useful plan without a user decision or clarification."
    });
  }
};

const seedPlanMadeMachine = {
  ...makePlanMachine,
  promptActionId: "make_seed_plan",
  stepId: "seed_plan_made",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_seed_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The seed implementation plan has been written in the Codex response and is ready for execution.",
      waitingForInputMeaning: "You cannot make a useful seed plan without a user decision or clarification."
    });
  }
};

const executePlanMachine = {
  promptActionId: "execute_plan",
  stepId: "plan_executed",

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Ask Codex to execute the plan before continuing.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this);
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The implementation work is complete enough to continue to review.",
      waitingForInputMeaning: "You cannot continue implementation without a user decision or missing project detail."
    });
  }
};

const seedPlanExecutedMachine = {
  ...executePlanMachine,
  promptActionId: "execute_seed_plan",
  stepId: "seed_plan_executed",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_seed_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The seed implementation work is complete enough to continue.",
      waitingForInputMeaning: "You cannot continue seeding without a user decision or missing project detail."
    });
  }
};

const deepUiCheckMachine = {
  ...executePlanMachine,
  promptActionId: "run_deep_ui_check",
  stepId: "deep_ui_check_run",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deep_ui_check");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The deep UI check has been completed or intentionally found no required fix.",
      waitingForInputMeaning: "You cannot complete the UI check without a user decision."
    });
  }
};

const reviewRunMachine = {
  ...executePlanMachine,
  promptActionId: "run_deslop",
  stepId: "review_run",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deslop");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The review/deslop loop has completed and only acceptable low-risk findings remain.",
      waitingForInputMeaning: "You cannot complete review/deslop without a user decision."
    });
  }
};

const projectKnowledgeUpdatedMachine = {
  ...executePlanMachine,
  promptActionId: "update_project_knowledge",
  stepId: "project_knowledge_updated",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "update_project_knowledge");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "Project knowledge has been updated or there is no adapter-supported project knowledge to update.",
      waitingForInputMeaning: "You cannot update project knowledge without a user decision."
    });
  }
};

const reportCreatedMachine = {
  promptActionId: "write_report",
  stepId: "report_created",

  initialState(context = {}) {
    return artifactIsReady(context.session, REPORT_ARTIFACT)
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (artifactIsReady(context.session, REPORT_ARTIFACT)) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Write the session report before updating project knowledge.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this, {
      responseArtifact: REPORT_ARTIFACT
    });
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "write_report");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        response: "Markdown session report"
      },
      doneMeaning: "The report text is complete and should be saved by Studio as the session report.",
      waitingForInputMeaning: "You cannot write the report without a user decision or missing context."
    });
  }
};

const agentConversationMachine = createChatWithAiMachine({
  completionPolicy: {
    decidedBy: "user"
  },
  nextWhenIdle: (context = {}) => ({
    disabledReason: "Ask Codex for changes before continuing.",
    enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
  }),
  promptActionId: "agent_conversation",
  stepId: "agent_conversation"
});

const maintenanceConversationMachine = createChatWithAiMachine({
  completionPolicy: {
    decidedBy: "user"
  },
  nextWhenIdle: (context = {}) => ({
    disabledReason: "Ask Codex for changes before continuing.",
    enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
  }),
  promptActionId: "agent_conversation",
  stepId: "maintenance_conversation"
});

const implementationReviewMachine = createChatWithAiMachine({
  completionPolicy: {
    decidedBy: "ai",
    enoughWhen: "the requested focused tweak has either been made and focused checks run when practical, or you can clearly report that no code change is needed.",
    waitingForInputMeaning: "You cannot complete the focused review tweak without a user decision or missing project detail."
  },
  promptActionId: "human_review_conversation",
  stepId: "implementation_reviewed",
  waitingMessage: "Wait for Codex to finish this review turn."
});

const finalReviewMachine = createChatWithAiMachine({
  completionPolicy: {
    decidedBy: "ai",
    enoughWhen: "the requested final tweak has either been made or you can clearly report the blocker; AI Studio can then rerun review and validation.",
    waitingForInputMeaning: "You cannot complete the final review tweak without a user decision or missing project detail."
  },
  promptActionId: "final_review_conversation",
  stepId: "changes_accepted",
  waitingMessage: "Wait for Codex to finish this review turn."
});

const projectValidatedMachine = {
  stepId: "project_validated",

  initialState(context = {}) {
    return allMetadataExists(context.session, ["code_index_updated", "automated_checks_passed"])
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (allMetadataExists(context.session, ["code_index_updated", "automated_checks_passed"])) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Update the code index and run automated checks successfully before continuing.",
      failurePrompt: "The project validation command failed. Explain what should happen, then retry validation.",
      failureTitle: "Validation needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["update_code_index", "run_automated_checks"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["update_code_index", "run_automated_checks"],
      done: allMetadataExists(await context.runtime.getSession(context.session.sessionId), [
        "code_index_updated",
        "automated_checks_passed"
      ]),
      failureTitle: "Validation needs attention"
    });
  }
};

const changesCommittedMachine = {
  stepId: "changes_committed",

  initialState(context = {}) {
    return metadataExists(context.session, "accepted_commit")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "accepted_commit")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Commit and push changes before continuing.",
      failurePrompt: "The commit or push command failed. Explain what should happen, then retry it.",
      failureTitle: "Commit needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["commit_changes"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["commit_changes"],
      done: await actionCreatedMetadata(context, "accepted_commit"),
      failureTitle: "Commit needs attention"
    });
  }
};

const pullRequestMergedMachine = {
  promptActionId: "prepare_for_merge",
  stepId: "pr_merged",

  initialState(context = {}) {
    return metadataExists(context.session, "pr_merged") || metadataExists(context.session, "merge_skipped")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "pr_merged") || metadataExists(context.session, "merge_skipped")) {
      state = machineState(STEP_STATUS.DONE);
    }
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);

      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, {
          ...state,
          message: state.message || "The merge step needs input before it can continue."
        });

      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Merge the pull request or choose not to merge before continuing.");
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
          assertAgentResultSource(context.session, input);
        }
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: state.status === STEP_STATUS.ATTEMPTING_EXECUTION
              ? STEP_STATUS.ATTEMPTING_EXECUTION
              : STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            message: input.message,
            promptComplete: true,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The merge step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId === "prepare_for_merge") {
      return markPromptActionStarted(context, this, "prepare_for_merge");
    }
    return markCommandActionStarted(context, this, ["merge_pr"]);
  },

  async actionFinished(context = {}) {
    if (context.actionId === "skip_merge") {
      await writeState(context, this, machineState(STEP_STATUS.DONE));
      return;
    }
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["merge_pr"],
      done: await actionCreatedMetadata(context, "pr_merged"),
      failureTitle: "Merge needs attention"
    });
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The pull request and main checkout are ready for the merge command.",
      waitingForInputMeaning: "The merge preparation found a blocker that needs user input."
    });
  }
};

const mainCheckoutSyncedMachine = {
  stepId: "main_checkout_synced",

  initialState(context = {}) {
    return metadataExists(context.session, "main_checkout_synced") || metadataExists(context.session, "merge_skipped")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "main_checkout_synced") || metadataExists(context.session, "merge_skipped")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Sync the main checkout after merging before continuing.",
      failurePrompt: "The main checkout sync command failed. Explain what should happen, then retry it.",
      failureTitle: "Main checkout sync needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["sync_main_checkout"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["sync_main_checkout"],
      done: await actionCreatedMetadata(context, "main_checkout_synced"),
      failureTitle: "Main checkout sync needs attention"
    });
  }
};

const pullRequestMachine = createEditableArtifactReviewMachine({
  command: {
    actionId: "create_pr_on_gh",
    doneMetadata: "pr_url",
    failureState: (context = {}) => machineState(STEP_STATUS.WAITING_FOR_INPUT, {
      from: STEP_STATUS.ATTEMPTING_EXECUTION,
      message: normalizeText(context.actionResult?.message),
      output: normalizeText(context.actionResult?.output)
    })
  },
  done: (session = {}) => metadataExists(session, "pr_url"),
  draftOrigin: "prompt",
  draftReady: pullRequestFilesAreReady,
  interaction: (_status, values = {}) => pullRequestInputInteraction(values),
  nextWhenConfirmed: {
    disabledReason: "Create the pull request before continuing."
  },
  nextWhenDrafting: {
    disabledReason: "Resolve the pull request content before continuing."
  },
  nextWhenWaitingForInput: {
    disabledReason: "Resolve the pull request input request before continuing."
  },
  nextWhenWorking: {
    disabledReason: "Create the pull request before continuing."
  },
  onWaitingActions: (context = {}) => disableAction(context.session, "create_pr_on_gh", "Resolve the pull request input request before retrying."),
  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        body: "Markdown pull request body",
        title: "Pull request title"
      },
      doneMeaning: "The pull request title and body are ready for user confirmation.",
      waitingForInputMeaning: "You cannot draft the pull request without a user decision or missing repository context."
    });
  },
  readValues: readPullRequestFieldValues,
  saveValues: writePullRequestFieldValues,
  stepId: "create_pull_request",
  unsupportedDoneMessage: "The pull request step cannot accept input right now.",
  userResponseResumeStatus: (state = {}) => state.from === STEP_STATUS.ATTEMPTING_EXECUTION
    ? STEP_STATUS.CONFIRM_FILES
    : STEP_STATUS.AWAITING_AGENT_RESULT,
  waitingInteraction: (state = {}) => commandFailureInteraction({
    prompt: state.message || "Codex needs more information before the pull request can continue.",
    title: "Pull request needs input"
  })
});

const sessionFinishedMachine = {
  stepId: "session_finished",

  initialState(context = {}) {
    return metadataExists(context.session, "session_finished")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "session_finished")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Archive the session when you are finished.",
      failurePrompt: "The archive action failed. Explain what should happen, then retry archive.",
      failureTitle: "Archive needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["finish_session"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["finish_session"],
      done: await actionCreatedMetadata(context, "session_finished"),
      failureTitle: "Archive needs attention"
    });
  }
};

const localSessionFinishedMachine = {
  ...sessionFinishedMachine,
  stepId: "local_session_finished"
};

const stepMachines = new Map([
  [sessionCreatedMachine.stepId, sessionCreatedMachine],
  [workSourceSelectedMachine.stepId, workSourceSelectedMachine],
  [worktreeCreatedMachine.stepId, worktreeCreatedMachine],
  [dependenciesInstalledMachine.stepId, dependenciesInstalledMachine],
  [checklistItemsInstalledMachine.stepId, checklistItemsInstalledMachine],
  [seedApplicationDefinitionMachine.stepId, seedApplicationDefinitionMachine],
  [issueDefinitionMachine.stepId, issueDefinitionMachine],
  [issueSubmittedMachine.stepId, issueSubmittedMachine],
  [seedPlanMadeMachine.stepId, seedPlanMadeMachine],
  [seedPlanExecutedMachine.stepId, seedPlanExecutedMachine],
  [makePlanMachine.stepId, makePlanMachine],
  [executePlanMachine.stepId, executePlanMachine],
  [implementationReviewMachine.stepId, implementationReviewMachine],
  [agentConversationMachine.stepId, agentConversationMachine],
  [maintenanceConversationMachine.stepId, maintenanceConversationMachine],
  [deepUiCheckMachine.stepId, deepUiCheckMachine],
  [reviewRunMachine.stepId, reviewRunMachine],
  [projectValidatedMachine.stepId, projectValidatedMachine],
  [finalReviewMachine.stepId, finalReviewMachine],
  [reportCreatedMachine.stepId, reportCreatedMachine],
  [projectKnowledgeUpdatedMachine.stepId, projectKnowledgeUpdatedMachine],
  [changesCommittedMachine.stepId, changesCommittedMachine],
  [pullRequestMachine.stepId, pullRequestMachine],
  [pullRequestMergedMachine.stepId, pullRequestMergedMachine],
  [mainCheckoutSyncedMachine.stepId, mainCheckoutSyncedMachine],
  [sessionFinishedMachine.stepId, sessionFinishedMachine],
  [localSessionFinishedMachine.stepId, localSessionFinishedMachine]
]);

function stepMachineForStep(stepId = "") {
  return stepMachines.get(normalizeText(stepId)) || null;
}

function currentStepPromptInputInstruction(session = {}, action = {}) {
  const machine = stepMachineForStep(session.currentStep);
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
  const machine = stepMachineForStep(session.currentStep);
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
  const machine = stepMachineForStep(session.currentStep);
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
  const machine = stepMachineForStep(session.currentStep);
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
  const machine = stepMachineForStep(session.currentStep);
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
  const machine = stepMachineForStep(session.currentStep);
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
  saveStepMachineInput,
  stepMachineForStep
};
