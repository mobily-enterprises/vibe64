import {
  aiStudioError,
  normalizeText
} from "./core.js";

const STEP_STATE_SCHEMA_VERSION = 1;

const STEP_STATUS = Object.freeze({
  ATTEMPTING_EXECUTION: "attempting_execution",
  AWAITING_AGENT_RESULT: "awaiting_agent_result",
  CONFIRM_FILES: "confirm_files",
  DONE: "done",
  FAILED: "failed",
  NEED_INPUT: "need_input",
  READY: "ready"
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
  NEED_INPUT: "need_input",
  READY: "ready",
  SKIP: "skip",
  USER_RESPONSE: "user_response"
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
  return writeState(context, machine, machine.initialState(context));
}

async function writeState(context = {}, machine = {}, state = {}) {
  return context.runtime.store.writeStepState(context.session.sessionId, machine.stepId, {
    schemaVersion: STEP_STATE_SCHEMA_VERSION,
    ...state
  });
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
  label = "Next"
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

async function readIssueFieldValues(context = {}, filesReady = false) {
  if (!filesReady) {
    return {
      body: "",
      title: "",
      word: ""
    };
  }
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

function pullRequestFilesAreReady(session = {}) {
  return [
    PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
    PULL_REQUEST_BODY_DRAFT_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
}

async function readPullRequestFieldValues(context = {}, filesReady = false) {
  if (!filesReady) {
    return {
      body: "",
      title: ""
    };
  }
  const [title, body] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_TITLE_DRAFT_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_BODY_DRAFT_ARTIFACT)
  ]);
  return {
    body: normalizeText(body),
    title: normalizeText(title)
  };
}

function issueInputInteraction(status = STEP_STATUS.NEED_INPUT, values = {}) {
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

function promptNeedInputInteraction({
  prompt = "Codex needs more information before this step can continue.",
  submitLabel = "Save response",
  title = "Codex needs input"
} = {}) {
  return {
    fields: [
      {
        kind: "textarea",
        label: "Response",
        name: "response",
        required: true,
        requiredMessage: "Response is required.",
        value: ""
      }
    ],
    kind: "prompt_response",
    prompt,
    submitKind: STEP_INPUT_KIND.USER_RESPONSE,
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

function promptActionNeedInputInstruction({
  stepId = "{{session.currentStep}}",
  stepStatus = "{{session.stepMachine.status}}"
} = {}) {
  return JSON.stringify({
    kind: STEP_INPUT_KIND.NEED_INPUT,
    stepId,
    stepStatus,
    message: "The question or blocker for the user"
  }, null, 2);
}

function currentStepHelperInstruction({
  doneFields = {},
  doneMeaning = "The step is complete.",
  needsInputMeaning = "You need more information from the user.",
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
    promptActionNeedInputInstruction({
      stepId,
      stepStatus
    }),
    `- Meaning of need_input: ${needsInputMeaning}`,
    "- Before calling the helper for need_input, write the same question or blocker in normal Codex response text so Inspect users can read it directly in the terminal.",
    "- Keep the visible question text and the helper `message` equivalent; do not make the UI-only helper message more complete than the terminal-visible response.",
    "",
    "After the helper reports success, stop. Do not write workflow artifacts directly for this step."
  ].join("\n");
}

function standardPromptInputFields(state = {}) {
  return {
    response: normalizeText(state.response),
    source: normalizeText(state.source)
  };
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

function promptStepNeedInputView(context = {}, machine = {}, state = {}) {
  return {
    interaction: promptNeedInputInteraction({
      prompt: state.message || "Codex needs more information before this step can continue.",
      title: "Codex needs input"
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
    case STEP_STATUS.NEED_INPUT:
    case STEP_STATUS.FAILED:
      break;
    default:
      throw aiStudioError("This step is already complete.", "ai_studio_step_input_not_available");
  }

  switch (state.status) {
    case STEP_STATUS.READY:
    case STEP_STATUS.AWAITING_AGENT_RESULT:
    case STEP_STATUS.NEED_INPUT:
    case STEP_STATUS.FAILED:
      if (input.kind === STEP_INPUT_KIND.NEED_INPUT) {
        await writeState(context, machine, machineState(STEP_STATUS.NEED_INPUT, {
          from: STEP_STATUS.AWAITING_AGENT_RESULT,
          message: input.message,
          source: input.source
        }));
        return;
      }
      if (input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
        await writeState(context, machine, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
          ...standardPromptInputFields({
            response: input.text || input.fields.response,
            source: input.source
          })
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
    case STEP_STATUS.NEED_INPUT:
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
    case STEP_STATUS.NEED_INPUT:
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
    case STEP_STATUS.NEED_INPUT:
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
    case STEP_STATUS.NEED_INPUT:
    case STEP_STATUS.FAILED:
      if (done) {
        await writeState(context, machine, machineState(STEP_STATUS.DONE));
        return;
      }
      if (actionCompleted(context.actionResult)) {
        await writeState(context, machine, machineState(incompleteState));
        return;
      }
      await writeState(context, machine, machineState(STEP_STATUS.NEED_INPUT, {
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

    case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
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
      return machineState(STEP_STATUS.NEED_INPUT, {
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

      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
        await writeState(context, this, await commandSucceeded(context, "worktree_path")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.NEED_INPUT, {
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

      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
        await writeState(context, this, await commandSucceeded(context, "dependencies_installed")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.NEED_INPUT, {
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

const issueDefinitionMachine = {
  stepId: "issue_file_created",

  initialState(context = {}) {
    if (metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE);
    }
    if (issueFilesAreReady(context.session)) {
      return machineState(STEP_STATUS.CONFIRM_FILES);
    }
    return machineState(STEP_STATUS.NEED_INPUT, {
      doing: "discussion"
    });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    const existingIssueSelected = metadataExists(context.session, "issue_url");
    const filesReady = issueFilesAreReady(context.session);
    if (existingIssueSelected) {
      state = machineState(STEP_STATUS.DONE);
    } else if (filesReady && state.status !== STEP_STATUS.CONFIRM_FILES && state.from !== STEP_STATUS.ATTEMPTING_EXECUTION) {
      state = await writeState(context, this, machineState(STEP_STATUS.CONFIRM_FILES));
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "use_existing_issue", "An existing issue is already selected."),
          interaction: null,
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.CONFIRM_FILES: {
        const values = await readIssueFieldValues(context, true);
        return {
          actions: disableAction(context.session, "use_existing_issue", "Issue details are already saved."),
          interaction: issueInputInteraction(STEP_STATUS.CONFIRM_FILES, values),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };
      }

      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.FAILED:
      default:
        return {
          interaction: issueInputInteraction(STEP_STATUS.NEED_INPUT, {}),
          next: nextForSession(context.session, {
            disabledReason: "Define and save the issue before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.CONFIRM_FILES:
      case STEP_STATUS.FAILED: {
        if (input.kind === STEP_INPUT_KIND.NEED_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.NEED_INPUT, {
            doing: "discussion",
            message: input.message
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(state.from || STEP_STATUS.NEED_INPUT, {
            response: input.text,
            source: input.source
          }));
          return;
        }
        if (input.kind !== STEP_INPUT_KIND.READY && input.kind !== STEP_INPUT_KIND.CONFIRM_FILES) {
          throw unsupportedInputKind(input.kind, this.stepId);
        }
        const fields = input.fields;
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
        await writeState(context, this, machineState(STEP_STATUS.CONFIRM_FILES));
        return;
      }

      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The issue is already complete.", "ai_studio_step_input_not_available");
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "use_existing_issue") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.CONFIRM_FILES:
      case STEP_STATUS.FAILED:
        await writeState(context, this, await commandSucceeded(context, "issue_url")
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

const issueSubmittedMachine = {
  stepId: "issue_submitted",

  initialState(context = {}) {
    if (metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE);
    }
    return issueFilesAreReady(context.session)
      ? machineState(STEP_STATUS.READY)
      : machineState(STEP_STATUS.NEED_INPUT, {
          message: "Define and save the issue before creating it on GitHub."
        });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "issue_url")) {
      state = machineState(STEP_STATUS.DONE);
    } else if (issueFilesAreReady(context.session) && state.status === STEP_STATUS.NEED_INPUT && state.from !== STEP_STATUS.ATTEMPTING_EXECUTION) {
      state = await writeState(context, this, machineState(STEP_STATUS.READY));
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

      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
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
      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.FAILED:
        await writeState(context, this, await commandSucceeded(context, "issue_url")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.NEED_INPUT, {
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

const seedApplicationDefinitionMachine = {
  stepId: "seed_application_defined",

  initialState(context = {}) {
    if (issueFilesAreReady(context.session)) {
      return machineState(STEP_STATUS.CONFIRM_FILES);
    }
    return machineState(STEP_STATUS.NEED_INPUT, {
      doing: "discussion"
    });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    const filesReady = issueFilesAreReady(context.session);
    if (filesReady && state.status !== STEP_STATUS.CONFIRM_FILES) {
      state = await writeState(context, this, machineState(STEP_STATUS.CONFIRM_FILES));
    }

    switch (state.status) {
      case STEP_STATUS.CONFIRM_FILES: {
        const values = await readIssueFieldValues(context, true);
        return {
          interaction: issueInputInteraction(STEP_STATUS.CONFIRM_FILES, values),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };
      }

      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.FAILED:
      default:
        return {
          interaction: issueInputInteraction(STEP_STATUS.NEED_INPUT, {}),
          next: nextForSession(context.session, {
            disabledReason: "Define and save the seed issue before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    return issueDefinitionMachine.submitInput.call(this, context);
  }
};

const makePlanMachine = {
  stepId: "plan_made",

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.NEED_INPUT:
        return promptStepNeedInputView(context, this, state);
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
      needsInputMeaning: "You cannot make a useful plan without a user decision or clarification."
    });
  }
};

const seedPlanMadeMachine = {
  ...makePlanMachine,
  stepId: "seed_plan_made",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_seed_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The seed implementation plan has been written in the Codex response and is ready for execution.",
      needsInputMeaning: "You cannot make a useful seed plan without a user decision or clarification."
    });
  }
};

const executePlanMachine = {
  stepId: "plan_executed",

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.NEED_INPUT:
        return promptStepNeedInputView(context, this, state);
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
      needsInputMeaning: "You cannot continue implementation without a user decision or missing project detail."
    });
  }
};

const seedPlanExecutedMachine = {
  ...executePlanMachine,
  stepId: "seed_plan_executed",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_seed_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The seed implementation work is complete enough to continue.",
      needsInputMeaning: "You cannot continue seeding without a user decision or missing project detail."
    });
  }
};

const deepUiCheckMachine = {
  ...executePlanMachine,
  stepId: "deep_ui_check_run",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deep_ui_check");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The deep UI check has been completed or intentionally found no required fix.",
      needsInputMeaning: "You cannot complete the UI check without a user decision."
    });
  }
};

const reviewRunMachine = {
  ...executePlanMachine,
  stepId: "review_run",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deslop");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The review/deslop loop has completed and only acceptable low-risk findings remain.",
      needsInputMeaning: "You cannot complete review/deslop without a user decision."
    });
  }
};

const projectKnowledgeUpdatedMachine = {
  ...executePlanMachine,
  stepId: "project_knowledge_updated",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "update_project_knowledge");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "Project knowledge has been updated or there is no adapter-supported project knowledge to update.",
      needsInputMeaning: "You cannot update project knowledge without a user decision."
    });
  }
};

const reportCreatedMachine = {
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
      case STEP_STATUS.NEED_INPUT:
        return promptStepNeedInputView(context, this, state);
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
      needsInputMeaning: "You cannot write the report without a user decision or missing context."
    });
  }
};

const agentConversationMachine = {
  stepId: "agent_conversation",

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.NEED_INPUT:
        return promptStepNeedInputView(context, this, state);
      case STEP_STATUS.AWAITING_AGENT_RESULT:
        return promptStepWaitingView(context, this, state, "Wait for Codex to finish this conversation turn.");
      case STEP_STATUS.READY:
      case STEP_STATUS.DONE:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT),
            disabledReason: "Ask Codex for changes before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this, {
      responseArtifact: HUMAN_INPUT_RESPONSE_ARTIFACT
    });
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "agent_conversation", {
      restartDone: true
    });
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        response: "Concise Markdown response describing what changed, checks run, and any blockers"
      },
      doneMeaning: "The current Codex conversation turn is complete. The user decides whether to ask another question or continue.",
      needsInputMeaning: "You need a user answer before you can complete this conversation turn."
    });
  }
};

const maintenanceConversationMachine = {
  ...agentConversationMachine,
  stepId: "maintenance_conversation"
};

const implementationReviewMachine = {
  ...agentConversationMachine,
  stepId: "implementation_reviewed",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "human_review_conversation", {
      restartDone: true
    });
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.NEED_INPUT:
        return promptStepNeedInputView(context, this, state);
      case STEP_STATUS.AWAITING_AGENT_RESULT:
        return promptStepWaitingView(context, this, state, "Wait for Codex to finish this review turn.");
      case STEP_STATUS.READY:
      case STEP_STATUS.DONE:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };
    }
  }
};

const finalReviewMachine = {
  ...implementationReviewMachine,
  stepId: "changes_accepted",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "final_review_conversation", {
      restartDone: true
    });
  }
};

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

      case STEP_STATUS.NEED_INPUT:
        return promptStepNeedInputView(context, this, {
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
      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.FAILED:
        if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
          assertAgentResultSource(context.session, input);
        }
        if (input.kind === STEP_INPUT_KIND.NEED_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.NEED_INPUT, {
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
      needsInputMeaning: "The merge preparation found a blocker that needs user input."
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

const pullRequestMachine = {
  stepId: "create_pull_request",

  initialState(context = {}) {
    if (metadataExists(context.session, "pr_url")) {
      return machineState(STEP_STATUS.DONE);
    }
    if (pullRequestFilesAreReady(context.session)) {
      return machineState(STEP_STATUS.CONFIRM_FILES);
    }
    return machineState(STEP_STATUS.AWAITING_AGENT_RESULT);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    const created = metadataExists(context.session, "pr_url");
    const filesReady = pullRequestFilesAreReady(context.session);
    if (created) {
      state = machineState(STEP_STATUS.DONE);
    } else if (filesReady && state.status !== STEP_STATUS.CONFIRM_FILES && state.from !== STEP_STATUS.ATTEMPTING_EXECUTION) {
      state = await writeState(context, this, machineState(STEP_STATUS.CONFIRM_FILES));
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          interaction: null,
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.CONFIRM_FILES: {
        const values = await readPullRequestFieldValues(context, true);
        return {
          interaction: pullRequestInputInteraction(values),
          next: nextForSession(context.session, {
            disabledReason: "Create the pull request before continuing."
          }),
          stepMachine: publicState(this, state)
        };
      }

      case STEP_STATUS.AWAITING_AGENT_RESULT:
        return {
          interaction: null,
          next: nextForSession(context.session, {
            disabledReason: "Resolve the pull request content before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.NEED_INPUT:
        return {
          actions: disableAction(context.session, "create_pr_on_gh", "Resolve the pull request input request before retrying."),
          interaction: commandFailureInteraction({
            prompt: state.message || "Codex needs more information before the pull request can continue.",
            title: "Pull request needs input"
          }),
          next: nextForSession(context.session, {
            disabledReason: "Resolve the pull request input request before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.FAILED:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      default:
        return {
          interaction: null,
          next: nextForSession(context.session, {
            disabledReason: "Create the pull request before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.CONFIRM_FILES:
      case STEP_STATUS.FAILED: {
        if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
          assertAgentResultSource(context.session, input);
        }
        if (input.kind === STEP_INPUT_KIND.NEED_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.NEED_INPUT, {
            from: state.from || STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          const resumeState = state.from === STEP_STATUS.ATTEMPTING_EXECUTION
            ? STEP_STATUS.CONFIRM_FILES
            : STEP_STATUS.AWAITING_AGENT_RESULT;
          await writeState(context, this, machineState(resumeState, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        if (input.kind !== STEP_INPUT_KIND.READY && input.kind !== STEP_INPUT_KIND.CONFIRM_FILES) {
          throw unsupportedInputKind(input.kind, this.stepId);
        }
        const fields = input.fields;
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
        await writeState(context, this, machineState(STEP_STATUS.CONFIRM_FILES));
        return;
      }

      case STEP_STATUS.DONE:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      default:
        throw aiStudioError("The pull request step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "create_pr_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.CONFIRM_FILES:
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
    if (context.actionId !== "create_pr_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.CONFIRM_FILES:
      case STEP_STATUS.NEED_INPUT:
      case STEP_STATUS.FAILED:
        await writeState(context, this, await commandSucceeded(context, "pr_url")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.NEED_INPUT, {
              from: STEP_STATUS.ATTEMPTING_EXECUTION,
              message: normalizeText(context.actionResult?.message),
              output: normalizeText(context.actionResult?.output)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        body: "Markdown pull request body",
        title: "Pull request title"
      },
      doneMeaning: "The pull request title and body are ready for user confirmation.",
      needsInputMeaning: "You cannot draft the pull request without a user decision or missing repository context."
    });
  }
};

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
  if ([STEP_STATUS.DONE, STEP_STATUS.NEED_INPUT].includes(normalizeText(stepMachine?.status)) && currentStepDefinition.autopilot) {
    currentStepDefinition.autopilot = {
      ...currentStepDefinition.autopilot,
      stage: null
    };
  }

  return {
    ...session,
    ...(view.actions ? { actions: view.actions } : {}),
    currentStepDefinition,
    ...(view.next ? { next: view.next } : {}),
    stepMachine
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
  saveStepMachineInput,
  stepMachineForStep
};
