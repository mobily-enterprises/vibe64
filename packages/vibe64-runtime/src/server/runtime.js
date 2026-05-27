import {
  VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  VIBE64_SESSION_STATUS,
  assertSafeActionId,
  createVibe64SessionStore
} from "./sessionStore.js";
import {
  TargetAdapter,
  adapterView
} from "@local/vibe64-adapters/server/adapter";
import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  promptSessionBriefing
} from "@local/vibe64-adapters/server/promptRenderer";
import {
  STUDIO_CONTEXT_END_MARKER,
  STUDIO_CONTEXT_START_MARKER,
  visibleStudioPromptText,
  wrapPromptWithStudioContext
} from "@local/vibe64-adapters/server/promptMarkers";
import {
  runtimeContainerManagedServicesPromptFacts,
  runtimeContainerPromptFacts
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  createCoreWorkflowRegistry
} from "./registerCoreWorkflowModules.js";
import {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  normalizeWorkflowDefinitionId,
  workflowDefinition,
  workflowDefinitionCreationOptions,
  workflowForDefinition
} from "./workflow.js";
import { WorkflowMachine } from "./workflowMachine.js";
import {
  applyStepMachineView,
  currentStepPromptInputInstruction,
  recordStepMachineActionFinished,
  recordStepMachineActionStarted,
  recoverStuckStepMachineExecution,
  saveStepMachineInput
} from "./workflowStepMachines.js";
import {
  applyWorkflowPresentation,
  runWorkflowIntent
} from "./workflowPresentation.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "./sessionDebugLog.js";

function metadataFlagIsOn(value) {
  return ["1", "true", "yes", "on"].includes(normalizeText(value).toLowerCase());
}

function promptActionIsBlocked(action = {}, session = {}) {
  return action.type === "prompt" && metadataFlagIsOn(session.metadata?.terminal_active);
}

function promptActionHasUnfinishedRun(action = {}, session = {}) {
  void action;
  void session;
  return false;
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
  return refreshRecommendedStateError(vibe64Error(
    `Action ${actionId} is not available on step ${session.currentStep || "(none)"}.`,
    "vibe64_action_not_available"
  ), session, "stale_operation");
}

function actionDisabledError(action, session = {}) {
  return refreshRecommendedStateError(vibe64Error(
    action.disabledReason || `Action ${action.id} is disabled.`,
    "vibe64_action_disabled"
  ), session, "state_rejected");
}

function commandActionRequiresTerminalError(action) {
  return vibe64Error(
    `Command action ${action.label || action.id} must run in the command terminal.`,
    "vibe64_command_requires_terminal"
  );
}

function refreshRecommendedStateError(error, session = {}, operationOutcome = "state_rejected") {
  error.operationOutcome = operationOutcome;
  error.refreshRecommended = true;
  error.sessionId = session.sessionId || "";
  error.revision = session.revision ?? null;
  error.currentStep = session.currentStep || "";
  error.stepRevision = session.stepRevision ?? null;
  error.stepStatus = session.stepMachine?.status || "";
  return error;
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

function actionResultRecord(action, session, input, handlerResult = {}) {
  const result = { ...(handlerResult || {}) };
  delete result.recordsConversationTurn;
  const recordsConversationTurn = action.recordsConversationTurn === true;
  return {
    ...result,
    actionLabel: action.label,
    actionType: action.type,
    input,
    message: normalizeText(result.message),
    ...(recordsConversationTurn ? { recordsConversationTurn: true } : {}),
    status: normalizeText(result.status || "completed"),
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
  const visiblePrompt = visibleStudioPromptText(renderedPrompt.prompt, renderedPrompt.visiblePrompt);
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
    throw vibe64Error("Invalid vibe64 clock value.", "vibe64_invalid_clock");
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
    schemaVersion: VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION
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

function promptWithCurrentStepInputContract({
  action = {},
  prompt = "",
  runtime = null,
  session = {}
} = {}) {
  const stepInputInstruction = currentStepPromptInputInstruction(session, action, {
    runtime
  });
  return [
    String(prompt || "").trim(),
    stepInputInstruction
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function actionInputFieldLabel(action = {}, fieldName = "") {
  return (Array.isArray(action.inputFields) ? action.inputFields : [])
    .find((field) => normalizeText(field.name) === fieldName)?.label ||
    fieldName;
}

function inputFieldEntries(action = {}, input = {}) {
  const fields = Array.isArray(action.inputFields) ? action.inputFields : [];
  return fields
    .map((field) => {
      const name = normalizeText(field.name);
      return {
        label: actionInputFieldLabel(action, name),
        name,
        value: normalizeText(input?.[name])
      };
    })
    .filter((entry) => entry.name && entry.value);
}

function scalarInputEntries(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.keys(source)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => [name, source[name]])
    .map(([name, value]) => ({
      label: normalizeText(name),
      name: normalizeText(name),
      value: typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? normalizeText(value)
        : ""
    }))
    .filter((entry) => entry.name && entry.value);
}

function inputObject(input = {}) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function inputFields(input = {}) {
  const source = inputObject(input);
  return inputObject(source.fields || {});
}

function currentStepInputText(input = {}) {
  const source = inputObject(input);
  const fields = inputFields(input);
  return normalizeText(fields.response || source.text || source.message);
}

async function recordCurrentStepConversationMessage(runtime, sessionId = "", input = {}) {
  const source = inputObject(input);
  const inputSource = normalizeText(source.source);
  const text = currentStepInputText(source);
  if (!text) {
    return null;
  }
  if (inputSource === "codex") {
    return runtime.store.writeConversationAssistantMessage(sessionId, {
      text
    });
  }
  return null;
}

function visiblePromptFromActionInput(action = {}, input = {}) {
  const entries = inputFieldEntries(action, input);
  const visibleEntries = entries.length ? entries : scalarInputEntries(input);
  if (!visibleEntries.length) {
    return "";
  }
  if (visibleEntries.length === 1) {
    return visibleEntries[0].value;
  }
  return visibleEntries
    .map((entry) => `${entry.label}:\n${entry.value}`)
    .join("\n\n");
}

class Vibe64SessionRuntime {
  constructor({
    actionReadiness = undefined,
    actionHandlers = {},
    adapter = new TargetAdapter(),
    clock = undefined,
    defaultHandler = defaultActionHandler,
    projectConfig = {},
    store = undefined,
    targetRoot = process.cwd(),
    workflow = null,
    workflowRegistry = createCoreWorkflowRegistry()
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
    this.actionReadiness = composeActionReadiness(defaultActionReadiness, actionReadiness);
    this.workflowRegistry = workflowRegistry;
    this.workflowMachine = workflow
      ? new WorkflowMachine({
          actionReadiness: this.actionReadiness,
          workflow
        })
      : null;
    this.workflowMachines = new Map();
    this.targetRoot = targetRoot;
    this.store = store || createVibe64SessionStore({
      clock,
      targetRoot
    });
    this.now = createClockNow(clock);
  }

  async createSession(input = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.createSession.start", {
      requestedInitialStep: String(input?.initialStep || ""),
      requestedSessionId: String(input?.sessionId || ""),
      requestedWorkflowDefinition: String(input?.workflowDefinition || input?.metadata?.workflow_definition || "")
    });
    try {
      const workflowDefinitionId = await this.workflowDefinitionIdForNewSession(input);
      const workflowMachine = this.workflowMachineForDefinition(workflowDefinitionId);
      const initialStep = input.initialStep
        ? workflowMachine.assertStepId(input.initialStep)
        : workflowMachine.firstStepId();
      vibe64SessionDebugLog("server.runtime.createSession.storeCreate.start", {
        initialStep,
        requestedSessionId: String(input?.sessionId || ""),
        workflowDefinition: workflowDefinitionId
      });
      const session = await this.store.createSession({
        ...input,
        metadata: this.sessionMetadataWithWorkflowDefinition(input.metadata, workflowDefinitionId),
        initialStep
      });
      vibe64SessionDebugLog("server.runtime.createSession.storeCreate.done", {
        ...vibe64SessionDebugSummary(session),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        initialStep,
        workflowDefinition: workflowDefinitionId
      });
      await this.store.mutateSession(session.sessionId, async () => {
        await this.writeInitialSessionArtifacts(session.sessionId, workflowDefinitionId);
      });
      const viewedSession = await this.getSession(session.sessionId);
      vibe64SessionDebugLog("server.runtime.createSession.done", {
        ...vibe64SessionDebugSummary(viewedSession),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        workflowDefinition: workflowDefinitionId
      });
      return viewedSession;
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.createSession.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        requestedInitialStep: String(input?.initialStep || ""),
        requestedSessionId: String(input?.sessionId || "")
      });
      throw error;
    }
  }

  async getSession(sessionId) {
    return this.sessionView(await this.store.readSession(sessionId));
  }

  async listSessions(options = {}) {
    const sessions = await this.store.listSessions(options);
    return Promise.all(sessions.map((session) => this.sessionView(session)));
  }

  async listSessionSummaries(options = {}) {
    const summaries = typeof this.store.listSessionSummaries === "function"
      ? await this.store.listSessionSummaries(options)
      : await this.store.listSessions(options);
    return summaries.map((summary) => this.sessionSummaryView(summary));
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
    const workflowDefinitionId = this.workflowDefinitionIdForSession(sessionWithConfig);
    const workflowMachine = this.workflowMachineForDefinition(workflowDefinitionId);
    const sessionView = {
      ...workflowMachine.buildSessionView(sessionWithConfig),
      workflowDefinition: workflowDefinition(workflowDefinitionId, {
        workflowRegistry: this.workflowRegistry
      })
    };
    return applyWorkflowPresentation(await applyStepMachineView(this, sessionView));
  }

  sessionSummaryView(session = {}) {
    const workflowDefinitionId = this.workflowDefinitionIdForSession(session);
    return {
      ...session,
      workflowDefinition: workflowDefinition(workflowDefinitionId, {
        workflowRegistry: this.workflowRegistry
      })
    };
  }

  workflowDefinitionIdForSession(session = {}) {
    if (this.workflowMachine) {
      return DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID;
    }
    return normalizeWorkflowDefinitionId(
      session.metadata?.workflow_definition,
      {
        workflowRegistry: this.workflowRegistry
      }
    );
  }

  workflowMachineForDefinition(definitionId = DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID) {
    if (this.workflowMachine) {
      return this.workflowMachine;
    }
    const normalizedDefinitionId = normalizeWorkflowDefinitionId(definitionId, {
      workflowRegistry: this.workflowRegistry
    });
    if (!this.workflowMachines.has(normalizedDefinitionId)) {
      this.workflowMachines.set(normalizedDefinitionId, new WorkflowMachine({
        actionReadiness: this.actionReadiness,
        workflow: workflowForDefinition(normalizedDefinitionId, {
          workflowRegistry: this.workflowRegistry
        })
      }));
    }
    return this.workflowMachines.get(normalizedDefinitionId);
  }

  workflowMachineForSession(session = {}) {
    return this.workflowMachineForDefinition(this.workflowDefinitionIdForSession(session));
  }

  workflowStepMachineForStep(stepId = "") {
    return this.workflowRegistry?.machineForStep(stepId) || null;
  }

  sessionMetadataWithWorkflowDefinition(metadata = {}, workflowDefinitionId = "") {
    if (this.workflowMachine) {
      return metadata;
    }
    const definition = workflowDefinition(workflowDefinitionId, {
      workflowRegistry: this.workflowRegistry
    });
    return {
      ...(definition.initialMetadata || {}),
      ...metadata,
      workflow_definition: normalizeWorkflowDefinitionId(workflowDefinitionId, {
        workflowRegistry: this.workflowRegistry
      })
    };
  }

  async workflowDefinitionIdForNewSession(input = {}) {
    if (this.workflowMachine) {
      return DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID;
    }
    const requestedDefinitionId = normalizeText(
      input.workflowDefinition ||
      input.metadata?.workflow_definition
    );
    const recommendedDefinitionId = await this.recommendedWorkflowDefinitionId();
    const seedRequired = recommendedDefinitionId === VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION;
    if (seedRequired) {
      if (requestedDefinitionId && requestedDefinitionId !== VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION) {
        throw vibe64Error(
          "The first Vibe64 session must seed the application before other workflow definitions can be selected.",
          "vibe64_seed_workflow_required"
        );
      }
      return VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION;
    }
    if (requestedDefinitionId === VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION) {
      throw vibe64Error(
        "The seed workflow is only available before the application has been seeded.",
        "vibe64_seed_workflow_not_available"
      );
    }
    if (requestedDefinitionId) {
      return normalizeWorkflowDefinitionId(requestedDefinitionId, {
        workflowRegistry: this.workflowRegistry
      });
    }
    return recommendedDefinitionId;
  }

  async recommendedWorkflowDefinitionId() {
    const context = {
      config: this.projectConfig,
      runtime: this,
      session: null,
      store: this.store,
      targetRoot: this.targetRoot
    };
    const detection = await this.adapter.detect(context);
    if (detection.detected === false) {
      return DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID;
    }
    const facts = await this.adapter.inspect({
      ...context,
      detection
    });
    return facts?.workflow?.seedRequired === true
      ? VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
      : DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID;
  }

  async workflowDefinitionCreationOptions() {
    const recommendedDefinitionId = await this.recommendedWorkflowDefinitionId();
    return workflowDefinitionCreationOptions({
      seedRequired: recommendedDefinitionId === VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
      workflowRegistry: this.workflowRegistry
    });
  }

  async writeInitialSessionArtifacts(sessionId = "", workflowDefinitionId = "") {
    const sessionWord = normalizeText(workflowDefinition(workflowDefinitionId, {
      workflowRegistry: this.workflowRegistry
    }).sessionWord);
    if (!sessionWord) {
      return;
    }
    await this.store.writeArtifact(sessionId, "issue_word", `${sessionWord}\n`);
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
    const prompt = promptWithCurrentStepInputContract({
      action,
      prompt: promptWithBriefing,
      runtime: this,
      session: promptSession
    });
    return {
      codexPromptHandoff: buildCodexPromptHandoff({
        ...renderedPrompt,
        prompt,
        visiblePrompt: visiblePromptFromActionInput(action, input)
      }),
      prompt,
      promptContext: renderedPrompt.context,
      promptId: renderedPrompt.promptId,
      status: "prompt_ready"
    };
  }

  async runAdapterFinishSession({
    action,
    input = {},
    session
  } = {}) {
    if (action?.type !== "finish") {
      throw vibe64Error(
        `Action ${action?.label || action?.id || "(unknown)"} is not a finish action.`,
        "vibe64_action_not_finish"
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
      sessionStatus: VIBE64_SESSION_STATUS.FINISHED
    };
  }

  async runAction(sessionId, actionId, input = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.runAction.start", {
      actionId,
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const normalizedActionId = assertSafeActionId(actionId);
        const session = await this.runActionSessionView(sessionId);
        vibe64SessionDebugLog("server.runtime.runAction.sessionLoaded", {
          ...vibe64SessionDebugSummary(session),
          actionId: normalizedActionId
        });
        const action = currentAction(session, normalizedActionId);
        if (!action) {
          vibe64SessionDebugLog("server.runtime.runAction.blocked", {
            ...vibe64SessionDebugSummary(session),
            actionId: normalizedActionId,
            reason: "action_not_available"
          });
          throw actionNotAvailableError(session, normalizedActionId);
        }
        if (!action.enabled) {
          vibe64SessionDebugLog("server.runtime.runAction.blocked", {
            ...vibe64SessionDebugSummary(session),
            actionId: normalizedActionId,
            reason: "action_disabled"
          });
          throw actionDisabledError(action, session);
        }
        if (action.type === "command") {
          vibe64SessionDebugLog("server.runtime.runAction.blocked", {
            ...vibe64SessionDebugSummary(session),
            actionId: normalizedActionId,
            reason: "command_requires_terminal"
          });
          throw commandActionRequiresTerminalError(action);
        }

        await recordStepMachineActionStarted(this, session, action.id);
        const actionSession = await this.runActionSessionView(session.sessionId);
        const actionAfterStart = currentAction(actionSession, normalizedActionId) || action;

        vibe64SessionDebugLog("server.runtime.runAction.handler.start", {
          ...vibe64SessionDebugSummary(actionSession),
          actionId: actionAfterStart.id,
          actionType: String(actionAfterStart.type || "")
        });
        const handlerResult = await this.actionHandler(actionAfterStart.id)({
          action: actionAfterStart,
          input,
          runtime: this,
          session: actionSession,
          store: this.store
        });
        const actionResult = await this.store.writeActionResult(
          actionSession.sessionId,
          actionAfterStart.id,
          actionResultRecord(actionAfterStart, actionSession, input, handlerResult)
        );
        await writeActionResultEffects(this.store, actionSession.sessionId, handlerResult);
        await this.store.appendCommandLogEntry(
          actionSession.sessionId,
          actionLogEntry(actionAfterStart, actionSession, actionResult)
        );
        await recordStepMachineActionFinished(this, actionSession, actionAfterStart.id, actionResult);

        const viewedSession = {
          ...await this.runActionSessionView(actionSession.sessionId),
          actionResult
        };
        vibe64SessionDebugLog("server.runtime.runAction.done", {
          ...vibe64SessionDebugSummary(viewedSession),
          actionId: actionAfterStart.id,
          actionResultStatus: String(actionResult.status || ""),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs)
        });
        return viewedSession;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.runAction.error", {
        actionId,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  async advance(sessionId) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.advance.start", {
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const session = await this.getSession(sessionId);
        vibe64SessionDebugLog("server.runtime.advance.loaded", {
          ...vibe64SessionDebugSummary(session),
          nextVisible: session.next?.visible !== false,
          nextDisabledReason: String(session.next?.disabledReason || "")
        });
        if (!session.next?.visible || !session.next.enabled || !session.next.stepId) {
          vibe64SessionDebugLog("server.runtime.advance.blocked", {
            ...vibe64SessionDebugSummary(session),
            nextDisabledReason: String(session.next?.disabledReason || ""),
            nextVisible: session.next?.visible !== false,
            reason: "step_not_ready"
          });
          throw refreshRecommendedStateError(vibe64Error(
            session.next?.disabledReason || "Current Vibe64 step cannot advance.",
            "vibe64_step_not_ready"
          ), session, "state_rejected");
        }
        vibe64SessionDebugLog("server.runtime.advance.transition", {
          fromStepId: session.currentStep,
          sessionId: session.sessionId,
          toStepId: session.next.stepId
        });
        await this.store.writeCompletedStep(session.sessionId, session.currentStep, {
          message: `Advanced from ${session.currentStep} to ${session.next.stepId}.`
        });
        await this.store.writeCurrentStep(session.sessionId, session.next.stepId);
        const advancedSession = await this.getSession(session.sessionId);
        vibe64SessionDebugLog("server.runtime.advance.done", {
          ...vibe64SessionDebugSummary(advancedSession),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          fromStepId: session.currentStep
        });
        return advancedSession;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.advance.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  async forceAdvance(sessionId, {
    message = "Advanced by server intent."
  } = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.forceAdvance.start", {
      message,
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const session = await this.getSession(sessionId);
        if (session.next?.visible === false || !session.next?.stepId) {
          vibe64SessionDebugLog("server.runtime.forceAdvance.blocked", {
            ...vibe64SessionDebugSummary(session),
            nextDisabledReason: String(session.next?.disabledReason || ""),
            reason: "step_not_ready"
          });
          throw vibe64Error(
            session.next?.disabledReason || "Current Vibe64 step cannot advance.",
            "vibe64_step_not_ready"
          );
        }
        vibe64SessionDebugLog("server.runtime.forceAdvance.transition", {
          fromStepId: session.currentStep,
          sessionId: session.sessionId,
          toStepId: session.next.stepId
        });
        await this.store.writeCompletedStep(session.sessionId, session.currentStep, {
          message
        });
        await this.store.writeCurrentStep(session.sessionId, session.next.stepId);
        const advancedSession = await this.getSession(session.sessionId);
        vibe64SessionDebugLog("server.runtime.forceAdvance.done", {
          ...vibe64SessionDebugSummary(advancedSession),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          fromStepId: session.currentStep
        });
        return advancedSession;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.forceAdvance.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  async rewind(sessionId, stepId) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.rewind.start", {
      requestedStepId: stepId,
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const session = await this.getSession(sessionId);
        if (session.status !== VIBE64_SESSION_STATUS.ACTIVE) {
          vibe64SessionDebugLog("server.runtime.rewind.blocked", {
            ...vibe64SessionDebugSummary(session),
            reason: "closed_session"
          });
          throw vibe64Error("Closed Vibe64 sessions cannot be rewound.", "vibe64_closed_session_rewind");
        }

        const plan = this.workflowMachineForSession(session).rewindPlanForSession(session, stepId);
        vibe64SessionDebugLog("server.runtime.rewind.plan", {
          ...vibe64SessionDebugSummary(session),
          actionResultCount: plan.actionResultIds.length,
          artifactCount: plan.artifactNames.length,
          completedStepCount: plan.completedStepIds.length,
          metadataCount: plan.metadataNames.length,
          requestedStepId: stepId,
          targetStepId: plan.targetStepId
        });
        await Promise.all([
          this.store.deleteActionResults(session.sessionId, plan.actionResultIds),
          this.store.deleteArtifacts(session.sessionId, plan.artifactNames),
          this.store.deleteCompletedSteps(session.sessionId, plan.completedStepIds),
          this.store.deleteMetadataValues(session.sessionId, plan.metadataNames),
          this.store.deleteStepStates(session.sessionId, [
            plan.targetStepId,
            session.currentStep,
            ...plan.completedStepIds
          ])
        ]);
        await this.store.writeCurrentStep(session.sessionId, plan.targetStepId);
        await this.store.appendCommandLogEntry(session.sessionId, {
          fromStepId: session.currentStep,
          kind: "rewind",
          toStepId: plan.targetStepId
        });
        const rewoundSession = await this.getSession(session.sessionId);
        vibe64SessionDebugLog("server.runtime.rewind.done", {
          ...vibe64SessionDebugSummary(rewoundSession),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          fromStepId: session.currentStep,
          requestedStepId: stepId
        });
        return rewoundSession;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.rewind.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        requestedStepId: stepId,
        sessionId
      });
      throw error;
    }
  }

  async recoverStuckStep(sessionId, {
    message = "Recovered stuck command execution. Re-run the current step."
  } = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.recoverStuckStep.start", {
      message,
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const session = await this.getSession(sessionId);
        if (session.status !== VIBE64_SESSION_STATUS.ACTIVE) {
          vibe64SessionDebugLog("server.runtime.recoverStuckStep.blocked", {
            ...vibe64SessionDebugSummary(session),
            reason: "closed_session"
          });
          throw vibe64Error("Closed Vibe64 sessions cannot be recovered.", "vibe64_closed_session_recovery");
        }
        await recoverStuckStepMachineExecution(this, session, {
          message
        });
        await this.store.appendCommandLogEntry(session.sessionId, {
          fromStatus: session.stepMachine?.status || "",
          kind: "recover-stuck-step",
          message,
          stepId: session.currentStep,
          toStatus: "ready"
        });
        const recoveredSession = await this.getSession(session.sessionId);
        vibe64SessionDebugLog("server.runtime.recoverStuckStep.done", {
          ...vibe64SessionDebugSummary(recoveredSession),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          fromStepStatus: String(session.stepMachine?.status || "")
        });
        return recoveredSession;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.recoverStuckStep.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  async submitCurrentStepInput(sessionId, input = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.submitCurrentStepInput.start", {
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        await saveStepMachineInput(this, sessionId, input);
        await recordCurrentStepConversationMessage(this, sessionId, input);
        const session = await this.getSession(sessionId);
        vibe64SessionDebugLog("server.runtime.submitCurrentStepInput.done", {
          ...vibe64SessionDebugSummary(session),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs)
        });
        return session;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.submitCurrentStepInput.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  async runIntent(sessionId, intentId, input = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.runIntent.start", {
      intentId,
      sessionId,
      stepId: String(input?.stepId || ""),
      stepStatus: String(input?.stepStatus || "")
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const session = await runWorkflowIntent(this, sessionId, intentId, input);
        vibe64SessionDebugLog("server.runtime.runIntent.done", {
          ...vibe64SessionDebugSummary(session),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          intentId
        });
        return session;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.runIntent.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        intentId,
        sessionId
      });
      throw error;
    }
  }

  async recordCommandActionStarted(sessionId, actionId) {
    return this.store.mutateSession(sessionId, async () => {
      const session = await this.getSession(sessionId);
      await recordStepMachineActionStarted(this, session, actionId);
    });
  }

  async recordCommandActionFinished(session, actionId, actionResult = {}) {
    return this.store.mutateSession(session.sessionId, async () => {
      await recordStepMachineActionFinished(this, session, actionId, actionResult);
    });
  }
}

export {
  Vibe64SessionRuntime
};
