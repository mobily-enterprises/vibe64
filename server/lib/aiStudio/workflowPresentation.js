import {
  aiStudioError,
  normalizeText
} from "./core.js";
import { STEP_STATUS } from "./workflowStepMachines.js";

// Presentation is derived view state. Durable workflow truth remains in the
// session files, workflow machine, step machines, action results, and metadata.
const ACTION_IDS = Object.freeze({
  AGENT_CONVERSATION: "agent_conversation",
  FINAL_REVIEW_CONVERSATION: "final_review_conversation",
  FINISH_SESSION: "finish_session",
  HUMAN_REVIEW_CONVERSATION: "human_review_conversation",
  MAKE_PLAN: "make_plan",
  MAKE_SEED_PLAN: "make_seed_plan",
  MERGE_PR: "merge_pr",
  PREPARE_FOR_MERGE: "prepare_for_merge",
  RUN_DEEP_UI_CHECK: "run_deep_ui_check",
  SKIP_MERGE: "skip_merge"
});

const INTENT_IDS = Object.freeze({
  ACCEPT_REVIEW: "accept_review",
  ARCHIVE_SESSION: "archive_session",
  CONTINUE_STEP: "continue_step",
  MERGE_AND_SYNC: "merge_and_sync",
  RECHECK_AFTER_FINAL_TWEAK: "recheck_after_final_tweak",
  REJECT_AND_REPLAN: "reject_and_replan",
  REQUEST_REVIEW_TWEAK: "request_review_tweak",
  RUN_OPTIONAL_CHECK: "run_optional_check",
  SKIP_MERGE: "skip_merge",
  SKIP_OPTIONAL_CHECK: "skip_optional_check",
  TALK_TO_CODEX: "talk_to_codex"
});

const METADATA_KEYS = Object.freeze({
  FINAL_REVIEW_FOLLOWUP: "autopilot_final_review_followup",
  MERGE_INTENT: "autopilot_merge_intent"
});

const STEP_IDS = Object.freeze({
  CHANGES_ACCEPTED: "changes_accepted",
  MAIN_CHECKOUT_SYNCED: "main_checkout_synced",
  PLAN_MADE: "plan_made",
  PR_MERGED: "pr_merged",
  PROJECT_VALIDATED: "project_validated",
  REVIEW_RUN: "review_run",
  SEED_PLAN_MADE: "seed_plan_made"
});

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function currentStepDefinition(session = {}) {
  return isObject(session.currentStepDefinition) ? session.currentStepDefinition : {};
}

function currentAutopilot(session = {}) {
  const autopilot = currentStepDefinition(session).autopilot;
  return isObject(autopilot) ? autopilot : {};
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
  if (!isObject(stage) || !stage.actionId) {
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
    ...(isObject(input) ? { input } : {}),
    kind,
    message: normalizeText(message),
    primaryIntentId: normalizeText(primaryIntentId),
    sections,
    showProgress,
    title: normalizeText(title),
    variant: normalizeText(variant)
  };
}

function intent(id, {
  actionId = "",
  clientAction = "",
  disabledReason = "",
  enabled = true,
  inputFields = [],
  label = "",
  style = "secondary"
} = {}) {
  return {
    actionId: normalizeText(actionId),
    clientAction: normalizeText(clientAction),
    disabledReason: enabled ? "" : normalizeText(disabledReason || "This action is not available right now."),
    enabled: enabled === true,
    id,
    inputFields: Array.isArray(inputFields) ? inputFields : [],
    label: normalizeText(label || id),
    style
  };
}

function intentForAction(id, action = {}, options = {}) {
  return intent(id, {
    ...options,
    actionId: action?.id || options.actionId || "",
    disabledReason: action?.disabledReason || options.disabledReason || "",
    enabled: action?.enabled === true,
    inputFields: options.inputFields || action?.inputFields || [],
    label: options.label || action?.label || id
  });
}

function continueIntent(session = {}, {
  label = ""
} = {}) {
  return intent(INTENT_IDS.CONTINUE_STEP, {
    disabledReason: session.next?.disabledReason || "",
    enabled: nextIsReady(session),
    label: label || session.next?.label || "Continue",
    style: "primary"
  });
}

function presentationSections(names = []) {
  return names.map((name) => ({ kind: name }));
}

function stopScreenPresentation(session = {}) {
  const autopilot = currentAutopilot(session);
  const kind = normalizeText(autopilot.kind);
  const label = currentStepLabel(session);

  if (kind === "agent_conversation") {
    const action = actionById(session, autopilot.stage?.actionId || autopilot.actionId || ACTION_IDS.AGENT_CONVERSATION);
    return {
      intents: [
        intentForAction(INTENT_IDS.TALK_TO_CODEX, action, {
          style: "primary"
        }),
        continueIntent(session)
      ],
      screen: screen("conversation", {
        message: "Ask Codex for changes. Continue when the work is ready for the next workflow step.",
        primaryIntentId: INTENT_IDS.TALK_TO_CODEX,
        sections: presentationSections(["response_preview"]),
        title: label
      })
    };
  }

  if (kind === "implementation_review" || kind === "final_review") {
    const finalReview = kind === "final_review";
    const actionId = finalReview
      ? ACTION_IDS.FINAL_REVIEW_CONVERSATION
      : ACTION_IDS.HUMAN_REVIEW_CONVERSATION;
    const tweakAction = actionById(session, actionId);
    const intents = [
      intent("open_diff", {
        clientAction: "open_diff",
        enabled: true,
        label: "Review diff"
      }),
      intent(INTENT_IDS.ACCEPT_REVIEW, {
        disabledReason: session.next?.disabledReason || "",
        enabled: nextIsReady(session),
        label: finalReview ? "Accept and finalize" : "Looks good, continue",
        style: "primary"
      }),
      intentForAction(INTENT_IDS.REQUEST_REVIEW_TWEAK, tweakAction, {
        style: "secondary"
      })
    ];
    if (finalReview) {
      intents.push(intent(INTENT_IDS.REJECT_AND_REPLAN, {
        enabled: true,
        inputFields: [
          {
            kind: "textarea",
            label: "What should change in the plan?",
            name: "feedback",
            requiredMessage: "Describe what should change before sending the work back to Codex."
          }
        ],
        label: "Reject, replan"
      }));
    }
    return {
      intents,
      screen: screen("review", {
        message: finalReview
          ? "Review the validated work before Autopilot writes the report and commits."
          : "Try the work now. Ask Codex for small tweaks, or continue when it looks right.",
        sections: presentationSections(["launch_controls", "report_preview", "response_preview"]),
        title: finalReview ? "Final review" : "Human review",
        variant: finalReview ? "final" : "implementation"
      })
    };
  }

  if (kind === "merge_review") {
    return {
      intents: [
        intent(INTENT_IDS.MERGE_AND_SYNC, {
          enabled: actionById(session, ACTION_IDS.PREPARE_FOR_MERGE)?.enabled === true,
          label: "Merge and update main checkout",
          style: "primary"
        }),
        intentForAction(INTENT_IDS.SKIP_MERGE, actionById(session, ACTION_IDS.SKIP_MERGE), {
          label: "Do not merge"
        })
      ],
      screen: screen("merge", {
        message: "The pull request is ready. Merge it and update the main checkout, or finish without merging.",
        sections: presentationSections(["report_preview"]),
        title: "Merge pull request?"
      })
    };
  }

  if (kind === "finished") {
    return {
      intents: [
        intentForAction(INTENT_IDS.ARCHIVE_SESSION, actionById(session, ACTION_IDS.FINISH_SESSION), {
          label: "Archive",
          style: "primary"
        })
      ],
      screen: screen("finished", {
        icon: "success",
        message: "The session is complete.",
        sections: presentationSections(["report_preview"]),
        title: "Congratulations!"
      })
    };
  }

  return {
    intents: [],
    screen: screen("stop", {
      title: label
    })
  };
}

function userDecisionPresentation(session = {}) {
  const action = actionById(session, ACTION_IDS.RUN_DEEP_UI_CHECK) || actionById(session, stageAction(session)?.actionId);
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

function interactionPresentation(session = {}) {
  const interaction = currentStepDefinition(session).interaction;
  if (!isObject(interaction)) {
    return null;
  }
  if (normalizeText(interaction.intentId) === INTENT_IDS.TALK_TO_CODEX || normalizeText(interaction.kind) === "conversation") {
    const action = actionById(session, interaction.actionId || stageAction(session)?.actionId || ACTION_IDS.AGENT_CONVERSATION);
    return {
      intents: [
        intentForAction(INTENT_IDS.TALK_TO_CODEX, action, {
          inputFields: interaction.fields,
          label: interaction.submitLabel || action?.label || "Send to Codex",
          style: "primary"
        })
      ],
      screen: screen("conversation", {
        input: interaction,
        message: interaction.prompt || "",
        primaryIntentId: INTENT_IDS.TALK_TO_CODEX,
        sections: presentationSections(["response_preview"]),
        title: interaction.title || currentStepLabel(session)
      })
    };
  }
  return {
    intents: [],
    screen: screen("input", {
      input: interaction,
      message: interaction.prompt || "",
      title: interaction.title || currentStepLabel(session)
    })
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

function actionOperation(session = {}, stage = {}) {
  const action = actionById(session, stage.actionId);
  if (!action || action.enabled !== true) {
    return {
      kind: "stop",
      reason: action?.disabledReason || `${stage.label || stage.actionId || "Action"} is not available.`
    };
  }
  return {
    actionId: action.id,
    advanceOnSuccess: stage.advanceOnSuccess === true || action.advanceOnSuccess === true,
    input: {},
    kind: "action",
    label: stage.label || action.label || action.id
  };
}

function mergeOperation(session = {}) {
  const metadata = session.metadata || {};
  if (normalizeText(metadata.merge_skipped)) {
    return nextIsReady(session)
      ? { kind: "advance", label: session.next.label || "Continue" }
      : { kind: "stop", reason: session.next?.disabledReason || "" };
  }
  if (normalizeText(metadata.pr_merged)) {
    return nextIsReady(session)
      ? { kind: "advance", label: session.next.label || "Continue" }
      : { kind: "stop", reason: session.next?.disabledReason || "" };
  }
  if (stepMachineStatus(session) === STEP_STATUS.READY && session.stepMachine?.promptComplete === true) {
    return actionOperation(session, {
      actionId: ACTION_IDS.MERGE_PR,
      label: "Merge"
    });
  }
  if (stepMachineIsWaitingForCodex(session) || stepMachineNeedsInput(session)) {
    return {
      kind: "wait",
      reason: automationWaitReason(session)
    };
  }
  return actionOperation(session, {
    actionId: ACTION_IDS.PREPARE_FOR_MERGE,
    label: "Prepare for merge"
  });
}

function nextAutomationOperation(session = {}) {
  const waitReason = automationWaitReason(session);
  const metadata = session.metadata || {};

  if (
    normalizeText(session.currentStep) === STEP_IDS.CHANGES_ACCEPTED &&
    normalizeText(metadata[METADATA_KEYS.FINAL_REVIEW_FOLLOWUP]) === "recheck" &&
    [STEP_STATUS.READY, STEP_STATUS.DONE].includes(stepMachineStatus(session)) &&
    session.stepMachine?.promptComplete === true
  ) {
    return {
      intentId: INTENT_IDS.RECHECK_AFTER_FINAL_TWEAK,
      kind: "intent",
      label: "Recheck changes"
    };
  }

  if (
    normalizeText(session.currentStep) === STEP_IDS.PR_MERGED &&
    normalizeText(metadata[METADATA_KEYS.MERGE_INTENT]) === "merge_and_sync"
  ) {
    return mergeOperation(session);
  }

  if (waitReason) {
    return {
      kind: "wait",
      reason: waitReason
    };
  }

  if (stepMachineStatus(session) === STEP_STATUS.DONE && nextIsReady(session)) {
    return {
      kind: "advance",
      label: session.next.label || "Continue"
    };
  }

  const stage = stageAction(session);
  if (stage) {
    return actionOperation(session, stage);
  }

  if (nextIsReady(session)) {
    return {
      kind: "advance",
      label: session.next.label || "Continue"
    };
  }

  return {
    kind: "stop",
    reason: session.next?.disabledReason || ""
  };
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

function buildPresentation(session = {}) {
  const interaction = interactionPresentation(session);
  const waiting = waitingPresentation(session);
  const autopilot = currentAutopilot(session);
  const kind = normalizeText(autopilot.kind);
  let base = interaction || waiting;

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
  return {
    actions: Array.isArray(session.actions) ? session.actions : [],
    auto: {
      canResume: ["action", "advance", "intent"].includes(nextOperation.kind),
      canStart: ["action", "advance", "intent"].includes(nextOperation.kind),
      nextOperation
    },
    intents: base.intents,
    next: session.next || null,
    prompt: promptPresentation(session),
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
  return {
    ...session,
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
    throw aiStudioError(
      `Reload state. This intent was prepared for ${stepId || "(missing step)"}:${stepStatus || "(missing status)"}, but the current workflow state is ${session.currentStep || "(no current step)"}:${session.stepMachine?.status || "(no machine status)"}.`,
      "ai_studio_intent_state_changed"
    );
  }
}

function intentById(session = {}, intentId = "") {
  return (Array.isArray(session.intents) ? session.intents : [])
    .find((candidate) => candidate.id === intentId) || null;
}

function intentFields(input = {}) {
  if (isObject(input.fields)) {
    return input.fields;
  }
  if (isObject(input.input)) {
    return input.input;
  }
  return {};
}

function conversationInput(fields = {}) {
  return {
    conversationRequest: normalizeText(fields.conversationRequest || fields.feedback || fields.message || fields.response)
  };
}

function replanStepIdForSession(session = {}) {
  const stepDefinitions = Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [];
  return stepDefinitions.some((step) => step.id === STEP_IDS.SEED_PLAN_MADE)
    ? STEP_IDS.SEED_PLAN_MADE
    : STEP_IDS.PLAN_MADE;
}

function finalReviewRecheckStepIdForSession(session = {}) {
  const stepDefinitions = Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [];
  return stepDefinitions.some((step) => step.id === STEP_IDS.REVIEW_RUN)
    ? STEP_IDS.REVIEW_RUN
    : STEP_IDS.PROJECT_VALIDATED;
}

async function continueAfterSkipMerge(runtime, sessionId = "") {
  let session = await runtime.getSession(sessionId);
  for (let count = 0; count < 3 && nextIsReady(session); count += 1) {
    session = await runtime.advance(sessionId);
  }
  if (
    normalizeText(session.currentStep) === STEP_IDS.MAIN_CHECKOUT_SYNCED &&
    normalizeText(session.metadata?.merge_skipped) &&
    session.next?.visible !== false &&
    session.next?.stepId
  ) {
    return forceAdvanceCurrentStep(runtime, session, "Skipped main checkout sync after merge was skipped.");
  }
  return session;
}

async function forceAdvanceCurrentStep(runtime, session = {}, message = "Advanced by server intent.") {
  if (session.next?.visible === false || !session.next?.stepId) {
    throw aiStudioError(
      session.next?.disabledReason || "Current AI Studio step cannot advance.",
      "ai_studio_step_not_ready"
    );
  }
  await runtime.store.writeCompletedStep(session.sessionId, session.currentStep, {
    message
  });
  await runtime.store.writeCurrentStep(session.sessionId, session.next.stepId);
  return runtime.getSession(session.sessionId);
}

async function runWorkflowIntent(runtime, sessionId = "", intentId = "", input = {}) {
  const session = await runtime.getSession(sessionId);
  const normalizedIntentId = normalizeText(intentId);
  const selectedIntent = intentById(session, normalizedIntentId);
  if (!selectedIntent) {
    throw aiStudioError(
      `Intent ${normalizedIntentId || "(empty)"} is not available on step ${session.currentStep || "(none)"}.`,
      "ai_studio_intent_not_available"
    );
  }
  if (selectedIntent.enabled !== true) {
    throw aiStudioError(
      selectedIntent.disabledReason || `Intent ${normalizedIntentId} is disabled.`,
      "ai_studio_intent_disabled"
    );
  }
  assertIntentMatchesCurrentState(session, input);

  const fields = intentFields(input);
  switch (normalizedIntentId) {
    case INTENT_IDS.ACCEPT_REVIEW:
    case INTENT_IDS.CONTINUE_STEP:
      return runtime.advance(sessionId);

    case INTENT_IDS.SKIP_OPTIONAL_CHECK:
      return forceAdvanceCurrentStep(runtime, session, "Skipped optional check.");

    case INTENT_IDS.RUN_OPTIONAL_CHECK:
      return runtime.runAction(sessionId, selectedIntent.actionId || ACTION_IDS.RUN_DEEP_UI_CHECK, {});

    case INTENT_IDS.TALK_TO_CODEX:
      return runtime.runAction(sessionId, selectedIntent.actionId || ACTION_IDS.AGENT_CONVERSATION, conversationInput(fields));

    case INTENT_IDS.REQUEST_REVIEW_TWEAK: {
      if (normalizeText(session.currentStep) === STEP_IDS.CHANGES_ACCEPTED) {
        await runtime.store.writeMetadataValue(sessionId, METADATA_KEYS.FINAL_REVIEW_FOLLOWUP, "recheck");
      }
      return runtime.runAction(sessionId, selectedIntent.actionId, conversationInput(fields));
    }

    case INTENT_IDS.REJECT_AND_REPLAN: {
      const feedback = normalizeText(fields.feedback || fields.message || fields.response);
      if (!feedback) {
        throw aiStudioError("Describe what should change before sending the work back to Codex.", "ai_studio_intent_input_required");
      }
      const targetStepId = replanStepIdForSession(session);
      await runtime.rewind(sessionId, targetStepId);
      const actionId = targetStepId === STEP_IDS.SEED_PLAN_MADE ? ACTION_IDS.MAKE_SEED_PLAN : ACTION_IDS.MAKE_PLAN;
      return runtime.runAction(sessionId, actionId, {
        autopilotFeedback: feedback,
        autopilotReason: "changes_rejected"
      });
    }

    case INTENT_IDS.RECHECK_AFTER_FINAL_TWEAK: {
      await runtime.store.deleteMetadataValue(sessionId, METADATA_KEYS.FINAL_REVIEW_FOLLOWUP);
      return runtime.rewind(sessionId, finalReviewRecheckStepIdForSession(session));
    }

    case INTENT_IDS.MERGE_AND_SYNC:
      await runtime.store.writeMetadataValue(sessionId, METADATA_KEYS.MERGE_INTENT, "merge_and_sync");
      return runtime.getSession(sessionId);

    case INTENT_IDS.SKIP_MERGE:
      await runtime.runAction(sessionId, selectedIntent.actionId || ACTION_IDS.SKIP_MERGE, {});
      await runtime.store.writeMetadataValue(sessionId, "merge_skipped", "yes");
      return continueAfterSkipMerge(runtime, sessionId);

    case INTENT_IDS.ARCHIVE_SESSION:
      return runtime.runAction(sessionId, selectedIntent.actionId || ACTION_IDS.FINISH_SESSION, {});

    default:
      throw aiStudioError(
        `Intent ${normalizedIntentId || "(empty)"} has no server handler.`,
        "ai_studio_intent_not_handled"
      );
  }
}

export {
  INTENT_IDS,
  METADATA_KEYS,
  applyWorkflowPresentation,
  runWorkflowIntent
};
