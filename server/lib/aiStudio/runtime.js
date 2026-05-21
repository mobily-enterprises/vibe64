import {
  AI_STUDIO_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  AI_STUDIO_SESSION_STATUS,
  assertSafeActionId,
  createAiStudioSessionStore
} from "./sessionStore.js";
import {
  TargetAdapter,
  adapterView
} from "./adapter.js";
import {
  aiStudioError,
  normalizeText
} from "./core.js";
import {
  promptSessionBriefing
} from "./promptRenderer.js";
import {
  STUDIO_CONTEXT_END_MARKER,
  STUDIO_CONTEXT_START_MARKER,
  visibleStudioPromptTitle,
  wrapPromptWithStudioContext
} from "./promptMarkers.js";
import {
  appendPromptRunInstruction,
  createPromptRun,
  promptRunBlocksAction
} from "./promptRun.js";
import {
  AUTOPILOT_FILE_ARTIFACTS
} from "./autopilotFiles.js";
import {
  runtimeContainerManagedServicesPromptFacts,
  runtimeContainerPromptFacts
} from "./runtimeContainers.js";
import { DEFAULT_AI_STUDIO_WORKFLOW } from "./workflow.js";
import { WorkflowMachine } from "./workflowMachine.js";

function metadataFlagIsOn(value) {
  return ["1", "true", "yes", "on"].includes(normalizeText(value).toLowerCase());
}

function promptActionIsBlocked(action = {}, session = {}) {
  return action.type === "prompt" && metadataFlagIsOn(session.metadata?.terminal_active);
}

function promptActionHasUnfinishedRun(action = {}, session = {}) {
  return action.type === "prompt" && promptRunBlocksAction(action, session);
}

function actionCapabilityIsMissing(action = {}, session = {}) {
  const capability = normalizeText(action.adapterCapability);
  return Boolean(capability) && session.adapter?.facts?.capabilities?.[capability] !== true;
}

function adapterCapabilityDisabledReason(action = {}, session = {}) {
  return `${session.adapter?.label || "Target adapter"} does not support capability: ${action.adapterCapability}.`;
}

function enabledAction() {
  return {
    disabledReason: "",
    enabled: true
  };
}

function disabledAction(disabledReason) {
  return {
    disabledReason,
    enabled: false
  };
}

function defaultActionReadiness({ action = {}, session = {} } = {}) {
  if (promptActionIsBlocked(action, session)) {
    return disabledAction("Codex terminal is active.");
  }
  if (promptActionHasUnfinishedRun(action, session)) {
    return disabledAction("Codex prompt is waiting to continue.");
  }
  if (actionCapabilityIsMissing(action, session)) {
    return disabledAction(adapterCapabilityDisabledReason(action, session));
  }
  return enabledAction();
}

async function defaultActionHandler(context = {}) {
  if (context.action?.type === "prompt") {
    return context.runtime.renderPromptAction(context);
  }
  if (context.action?.type === "command") {
    throw commandActionRequiresTerminalError(context.action);
  }
  if (context.action?.type === "finish") {
    return context.runtime.finishSessionAction(context);
  }
  if (context.action?.type === "adapter") {
    return context.runtime.runAdapterSessionAction(context);
  }
  return {
    message: `Recorded ${context.action?.label || "action"}.`,
    status: "completed"
  };
}

function actionNotAvailableError(session, actionId) {
  return aiStudioError(
    `Action ${actionId} is not available on step ${session.currentStep || "(none)"}.`,
    "ai_studio_action_not_available"
  );
}

function actionDisabledError(action) {
  return aiStudioError(
    action.disabledReason || `Action ${action.id} is disabled.`,
    "ai_studio_action_disabled"
  );
}

function commandActionRequiresTerminalError(action) {
  return aiStudioError(
    `Command action ${action.label || action.id} must run in the command terminal.`,
    "ai_studio_command_requires_terminal"
  );
}

function currentAction(session, actionId) {
  return session.actions.find((action) => action.id === actionId) || null;
}

function composeActionReadiness(defaultReadiness, extraReadiness) {
  return (context) => {
    const defaultState = defaultReadiness(context);
    if (!defaultState.enabled || typeof extraReadiness !== "function") {
      return defaultState;
    }
    return extraReadiness(context) || defaultState;
  };
}

function actionResultRecord(action, session, input, handlerResult = {}) {
  const result = handlerResult || {};
  return {
    ...result,
    actionLabel: action.label,
    actionType: action.type,
    input,
    message: normalizeText(result.message),
    status: normalizeText(result.status || "completed"),
    stepId: session.currentStep
  };
}

function actionLogEntry(action, session, actionResult) {
  return {
    actionId: action.id,
    actionLabel: action.label,
    actionType: action.type,
    kind: "action",
    status: actionResult.status,
    stepId: session.currentStep
  };
}

async function writeActionResultEffects(store, sessionId, result = {}) {
  for (const [name, value] of Object.entries(result.metadata || {})) {
    if (name === "issue_word" && typeof store.writeIssueWordMetadata === "function") {
      await store.writeIssueWordMetadata(sessionId, value);
      continue;
    }
    await store.writeMetadataValue(sessionId, name, value);
  }
  for (const [relativePath, text] of Object.entries(result.artifacts || {})) {
    await store.writeArtifact(sessionId, relativePath, text);
  }
  if (result.sessionStatus) {
    await store.writeStatus(sessionId, result.sessionStatus);
  }
}

function buildCodexPromptHandoff(renderedPrompt) {
  const visiblePrompt = visibleStudioPromptTitle(renderedPrompt.prompt, renderedPrompt.visiblePrompt);
  return {
    codex: {
      mode: "inject_prompt",
      promptField: "prompt"
    },
    kind: "codex_prompt_handoff",
    markers: {
      end: STUDIO_CONTEXT_END_MARKER,
      start: STUDIO_CONTEXT_START_MARKER
    },
    prompt: renderedPrompt.prompt,
    promptId: renderedPrompt.promptId,
    terminalInput: wrapPromptWithStudioContext(renderedPrompt.prompt, visiblePrompt)
  };
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw aiStudioError("Invalid ai-studio clock value.", "ai_studio_invalid_clock");
  }
  return date;
}

function createClockNow(clock) {
  if (typeof clock === "function") {
    return () => toDate(clock());
  }
  return () => new Date();
}

function promptContextSnapshotHasAdapter(snapshot = {}) {
  return Boolean(snapshot && typeof snapshot === "object" && snapshot.adapter && typeof snapshot.adapter === "object");
}

function createPromptContextSnapshot({
  adapter,
  now
} = {}) {
  return {
    adapter,
    createdAt: now().toISOString(),
    schemaVersion: AI_STUDIO_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION
  };
}

function sessionBriefingIsDelivered(session = {}) {
  return normalizeText(session.metadata?.codex_session_briefing_delivered) === "yes";
}

function promptSessionWithStaticContextReferences(session = {}) {
  return {
    ...session,
    promptStaticContextMode: "reference"
  };
}

function promptWithSessionBriefing({
  prompt = "",
  session = {},
  sessionBriefingIncluded = false
} = {}) {
  if (!sessionBriefingIncluded) {
    return String(prompt || "").trim();
  }
  return [
    promptSessionBriefing({
      config: session.config,
      session
    }),
    String(prompt || "").trim()
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

class AiStudioSessionRuntime {
  constructor({
    actionReadiness = undefined,
    actionHandlers = {},
    adapter = new TargetAdapter(),
    clock = undefined,
    defaultHandler = defaultActionHandler,
    projectConfig = {},
    store = undefined,
    targetRoot = process.cwd(),
    workflow = DEFAULT_AI_STUDIO_WORKFLOW
  } = {}) {
    this.actionHandlers = {
      ...actionHandlers
    };
    this.defaultHandler = typeof defaultHandler === "function"
      ? defaultHandler
      : defaultActionHandler;
    this.adapter = adapter;
    this.projectConfig = projectConfig && typeof projectConfig === "object"
      ? projectConfig
      : {};
    this.workflowMachine = new WorkflowMachine({
      actionReadiness: composeActionReadiness(defaultActionReadiness, actionReadiness),
      workflow
    });
    this.store = store || createAiStudioSessionStore({
      clock,
      targetRoot
    });
    this.now = createClockNow(clock);
  }

  async createSession(input = {}) {
    const initialStep = input.initialStep
      ? this.workflowMachine.assertStepId(input.initialStep)
      : this.workflowMachine.firstStepId();
    const session = await this.store.createSession({
      ...input,
      initialStep
    });
    return this.sessionView(session);
  }

  async getSession(sessionId) {
    return this.sessionView(await this.store.readSession(sessionId));
  }

  async listSessions() {
    const sessions = await this.store.listSessions();
    return Promise.all(sessions.map((session) => this.sessionView(session)));
  }

  actionHandler(actionId) {
    return this.actionHandlers[actionId] || this.defaultHandler;
  }

  async sessionView(session, {
    sessionAdapter = undefined
  } = {}) {
    const sessionWithConfig = {
      ...session,
      config: this.projectConfig,
      adapter: sessionAdapter || await this.adapterViewForSession(session)
    };
    return this.workflowMachine.buildSessionView(sessionWithConfig);
  }

  async promptContextSnapshotForSession(session) {
    const currentSnapshot = promptContextSnapshotHasAdapter(session.promptContextSnapshot)
      ? session.promptContextSnapshot
      : await this.store.readPromptContextSnapshot(session.sessionId);
    if (promptContextSnapshotHasAdapter(currentSnapshot)) {
      return currentSnapshot;
    }
    return this.store.writePromptContextSnapshot(session.sessionId, createPromptContextSnapshot({
      adapter: session.adapter || await this.adapterViewForSession(session),
      now: this.now
    }));
  }

  async promptSessionForAction(session) {
    const promptContextSnapshot = await this.promptContextSnapshotForSession(session);
    return {
      ...session,
      adapter: promptContextSnapshot.adapter,
      promptContextSnapshot
    };
  }

  async runActionSessionView(sessionId) {
    const session = await this.store.readSession(sessionId);
    const sessionAdapter = promptContextSnapshotHasAdapter(session.promptContextSnapshot)
      ? session.promptContextSnapshot.adapter
      : await this.adapterViewForSession(session);
    return this.sessionView(session, {
      sessionAdapter
    });
  }

  async adapterViewForSession(session) {
    const context = {
      config: this.projectConfig,
      runtime: this,
      session,
      store: this.store,
      targetRoot: session.targetRoot
    };
    const detection = await this.adapter.detect(context);
    if (detection.detected === false) {
      return adapterView({
        adapter: this.adapter,
        detection
      });
    }

    const facts = await this.adapter.inspect({
      ...context,
      detection
    });
    const commands = await this.adapter.listCommands({
      ...context,
      detection,
      facts
    });
    const runtimeContainerDescriptors = await this.adapter.listRuntimeContainers({
      ...context,
      commands,
      detection,
      facts
    });
    const runtimeContainers = await runtimeContainerPromptFacts(runtimeContainerDescriptors, {
      adapterId: this.adapter.id,
      context: {
        ...context,
        commands,
        detection,
        facts
      },
      targetRoot: session.targetRoot
    });
    const managedServices = await runtimeContainerManagedServicesPromptFacts(runtimeContainerDescriptors, {
      adapterId: this.adapter.id,
      context: {
        ...context,
        commands,
        detection,
        facts
      },
      targetRoot: session.targetRoot
    });
    const promptContext = await this.adapter.getPromptContext({
      ...context,
      commands,
      detection,
      facts
    });
    return adapterView({
      adapter: this.adapter,
      commands,
      detection,
      facts,
      managedServices,
      promptContext,
      runtimeContainers
    });
  }

  async renderPromptAction({
    action,
    input = {},
    session
  } = {}) {
    const promptSession = await this.promptSessionForAction(session);
    const sessionBriefingIncluded = !sessionBriefingIsDelivered(promptSession);
    const actionPromptSession = promptSessionWithStaticContextReferences(promptSession);
    const renderedPrompt = await this.adapter.renderPrompt({
      action,
      config: this.projectConfig,
      input,
      runtime: this,
      session: actionPromptSession,
      store: this.store
    });
    const promptWithBriefing = promptWithSessionBriefing({
      prompt: renderedPrompt.prompt,
      session: promptSession,
      sessionBriefingIncluded
    });
    const promptRun = await this.store.writePromptRun(promptSession.sessionId, createPromptRun({
      action,
      now: this.now(),
      promptId: renderedPrompt.promptId,
      sessionBriefingIncluded,
      session: promptSession
    }));
    await this.store.deleteArtifacts(promptSession.sessionId, AUTOPILOT_FILE_ARTIFACTS);
    const prompt = appendPromptRunInstruction(promptWithBriefing, promptRun, {
      artifactsRoot: promptSession.artifactsRoot
    });
    return {
      codexPromptHandoff: buildCodexPromptHandoff({
        ...renderedPrompt,
        prompt,
        visiblePrompt: visibleStudioPromptTitle(renderedPrompt.prompt)
      }),
      prompt,
      promptContext: renderedPrompt.context,
      promptId: renderedPrompt.promptId,
      promptRun,
      status: "prompt_ready"
    };
  }

  async runAdapterFinishSession({
    action,
    input = {},
    session
  } = {}) {
    if (action?.type !== "finish") {
      throw aiStudioError(
        `Action ${action?.label || action?.id || "(unknown)"} is not a finish action.`,
        "ai_studio_action_not_finish"
      );
    }
    return this.adapter.finishSession({
      action,
      input,
      runtime: this,
      session,
      store: this.store
    });
  }

  async runAdapterSessionAction({
    action,
    input = {},
    session
  } = {}) {
    return this.adapter.runSessionAction({
      action,
      config: this.projectConfig,
      input,
      runtime: this,
      session,
      store: this.store
    });
  }

  async finishSessionAction({
    action,
    input = {},
    session
  } = {}) {
    const result = await this.runAdapterFinishSession({
      action,
      input,
      session
    });
    if (result.status !== "completed") {
      return result;
    }
    return {
      ...result,
      metadata: {
        ...result.metadata,
        session_finished: "yes"
      },
      sessionStatus: AI_STUDIO_SESSION_STATUS.FINISHED
    };
  }

  async runAction(sessionId, actionId, input = {}) {
    const normalizedActionId = assertSafeActionId(actionId);
    const session = await this.runActionSessionView(sessionId);
    const action = currentAction(session, normalizedActionId);
    if (!action) {
      throw actionNotAvailableError(session, normalizedActionId);
    }
    if (!action.enabled) {
      throw actionDisabledError(action);
    }
    if (action.type === "command") {
      throw commandActionRequiresTerminalError(action);
    }

    const handlerResult = await this.actionHandler(action.id)({
      action,
      input,
      runtime: this,
      session,
      store: this.store
    });
    const actionResult = await this.store.writeActionResult(
      session.sessionId,
      action.id,
      actionResultRecord(action, session, input, handlerResult)
    );
    await writeActionResultEffects(this.store, session.sessionId, handlerResult);
    await this.store.appendCommandLogEntry(
      session.sessionId,
      actionLogEntry(action, session, actionResult)
    );

    return {
      ...await this.runActionSessionView(session.sessionId),
      actionResult
    };
  }

  async advance(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session.next.visible || !session.next.enabled || !session.next.stepId) {
      throw aiStudioError(
        session.next.disabledReason || "Current AI Studio step cannot advance.",
        "ai_studio_step_not_ready"
      );
    }
    await this.store.writeCompletedStep(session.sessionId, session.currentStep, {
      message: `Advanced from ${session.currentStep} to ${session.next.stepId}.`
    });
    await this.store.deletePromptRun(session.sessionId);
    await this.store.writeCurrentStep(session.sessionId, session.next.stepId);
    return this.getSession(session.sessionId);
  }

  async rewind(sessionId, stepId) {
    const session = await this.getSession(sessionId);
    if (session.status !== AI_STUDIO_SESSION_STATUS.ACTIVE) {
      throw aiStudioError("Closed AI Studio sessions cannot be rewound.", "ai_studio_closed_session_rewind");
    }

    const plan = this.workflowMachine.rewindPlanForSession(session, stepId);
    await Promise.all([
      this.store.deleteActionResults(session.sessionId, plan.actionResultIds),
      this.store.deleteArtifacts(session.sessionId, plan.artifactNames),
      this.store.deleteCompletedSteps(session.sessionId, plan.completedStepIds),
      this.store.deleteMetadataValues(session.sessionId, plan.metadataNames),
      this.store.deletePromptRun(session.sessionId)
    ]);
    await this.store.writeCurrentStep(session.sessionId, plan.targetStepId);
    await this.store.appendCommandLogEntry(session.sessionId, {
      fromStepId: session.currentStep,
      kind: "rewind",
      toStepId: plan.targetStepId
    });
    return this.getSession(session.sessionId);
  }
}

export {
  AiStudioSessionRuntime
};
