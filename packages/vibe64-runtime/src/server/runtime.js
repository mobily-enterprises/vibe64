import {
  VIBE64_AGENT_RUN_STATE,
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
  isPlainObject,
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  resolveVibe64ProjectLocalRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  sessionHasSource,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  promptSessionBriefing
} from "@local/vibe64-adapters/server/promptRenderer";
import {
  missingInformationPolicyInstruction
} from "@local/vibe64-adapters/server/promptQuestionPolicy";
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
  currentStepInputConversationText,
  currentStepPromptInputInstruction,
  recordStepMachineActionFinished,
  recordStepMachineActionStarted,
  recoverStuckStepMachineExecution,
  returnControlFromAgentWait,
  saveStepMachineInput
} from "./workflowStepMachines.js";
import {
  applyWorkflowPresentation,
  runWorkflowIntent
} from "./workflowPresentation.js";
import {
  preparePrivateInputSubmission
} from "./privateInputSubmissions.js";
import {
  VIBE64_SESSION_CLOSING_AT_METADATA,
  VIBE64_SESSION_CLOSING_REASON_METADATA,
  sessionClosingMetadata
} from "./sessionLifecycle.js";
import {
  archiveSessionSource,
  recoverSessionSource
} from "./sessionWorktreeArchive.js";
import {
  PLAN_SUMMARY_ARTIFACT,
  PLAN_TECHNICAL_ARTIFACT
} from "./workflowArtifacts.js";
import {
  coreComposerTemplates
} from "./composerMenuTemplates.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "./sessionDebugLog.js";

function metadataFlagIsOn(value) {
  return ["1", "true", "yes", "on"].includes(normalizeText(value).toLowerCase());
}

function sessionStatusIsClosed(status = "") {
  return [
    VIBE64_SESSION_STATUS.ABANDONED,
    VIBE64_SESSION_STATUS.FINISHED
  ].includes(normalizeText(status));
}

function promptActionIsBlocked(action = {}, session = {}) {
  return action.type === "prompt" && metadataFlagIsOn(session.metadata?.terminal_active);
}

function promptActionMissingSource(action = {}, session = {}) {
  return action.type === "prompt" && !sessionHasSource(session);
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
  if (promptActionMissingSource(action, session)) {
    return disabledAction("Create the session clone before asking Codex.");
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

function assertAdvanceMatchesCurrentState(session = {}, expected = {}) {
  const expectedStepId = normalizeText(expected.stepId);
  const expectedStepStatus = normalizeText(expected.stepStatus);
  if (!expectedStepId && !expectedStepStatus) {
    return;
  }
  if (
    expectedStepId !== normalizeText(session.currentStep) ||
    expectedStepStatus !== normalizeText(session.stepMachine?.status)
  ) {
    throw refreshRecommendedStateError(vibe64Error(
      `Reload state. This advance was prepared for ${expectedStepId || "(missing step)"}:${expectedStepStatus || "(missing status)"}, but the current workflow state is ${session.currentStep || "(no current step)"}:${session.stepMachine?.status || "(no machine status)"}.`,
      "vibe64_advance_state_changed"
    ), session, "stale_operation");
  }
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

function actionResultCompleted(actionResult = {}) {
  return normalizeText(actionResult.status || "completed") === "completed";
}

function actionCanAdvanceOnSuccess(action = {}, actionResult = {}, session = {}) {
  return action.advanceOnSuccess === true &&
    actionResultCompleted(actionResult) &&
    session.next?.visible !== false &&
    session.next?.enabled === true &&
    Boolean(session.next?.stepId);
}

function actionResultRecord(action, session, input, handlerResult = {}) {
  const result = { ...(handlerResult || {}) };
  delete result.recordsConversationTurn;
  const recordsConversationTurn = action.recordsConversationTurn === true;
  const auditMessage = normalizeText(action.auditMessage);
  return {
    ...result,
    actionLabel: action.label,
    actionType: action.type,
    ...(auditMessage ? { auditMessage } : {}),
    input,
    message: normalizeText(result.message),
    ...(recordsConversationTurn ? { recordsConversationTurn: true } : {}),
    status: normalizeText(result.status || "completed"),
    stepId: session.currentStep
  };
}

async function writeActionResultEffects(store, sessionId, result = {}) {
  for (const [name, value] of Object.entries(result.metadata || {})) {
    if ((name === "issue_word" || name === "work_word") && typeof store.writeIssueWordMetadata === "function") {
      await store.writeIssueWordMetadata(sessionId, value);
      if (name === "work_word") {
        await store.writeMetadataValue(sessionId, name, value);
      }
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

function actionResultHasCodexPromptHandoff(result = {}) {
  return normalizeText(result.codexPromptHandoff?.kind) === "codex_prompt_handoff";
}

async function markCodexPromptHandoffRunStarting(store, session = {}, actionResult = {}) {
  if (!actionResultHasCodexPromptHandoff(actionResult) || typeof store?.writeAgentRunEvent !== "function") {
    return null;
  }
  const updatedAt = new Date().toISOString();
  return store.writeAgentRunEvent(session.sessionId, "codex_app_server", {
    event: {
      kind: "codex-prompt-handoff-ready",
      message: "",
      state: VIBE64_AGENT_RUN_STATE.STARTING
    },
    patch: {
      error: "",
      provider: "codex",
      providerInterface: "app-server",
      providerStatus: "prompt_ready",
      providerThreadId: normalizeText(session.agentThreadId || session.codexThreadId),
      providerTurnId: "",
      state: VIBE64_AGENT_RUN_STATE.STARTING,
      stepId: normalizeText(session.currentStep),
      stepStatus: normalizeText(session.stepMachine?.status),
      updatedAt
    }
  });
}

function buildCodexPromptHandoff(renderedPrompt) {
  return {
    codex: {
      mode: "inject_prompt",
      promptField: "prompt"
    },
    kind: "codex_prompt_handoff",
    prompt: renderedPrompt.prompt,
    promptId: renderedPrompt.promptId,
    terminalInput: renderedPrompt.prompt
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

function composerTemplateInput(value = {}) {
  return isPlainObject(value) ? value : {};
}

function normalizeComposerTemplate(template = {}, {
  source = "adapter"
} = {}) {
  const item = isPlainObject(template) ? template : {};
  const prompt = isPlainObject(item.prompt) ? item.prompt : {};
  const id = normalizeText(item.id);
  const label = normalizeText(item.label || id);
  const promptId = normalizeText(item.promptId || prompt.promptId);
  if (item.visible === false || !id || !label || (!promptId && !normalizeText(item.text))) {
    return null;
  }
  return {
    disabledReason: normalizeText(item.disabledReason),
    enabled: item.enabled !== false,
    group: normalizeText(item.group || "Ask Codex"),
    icon: normalizeText(item.icon),
    id,
    input: composerTemplateInput(item.input || prompt.input),
    kind: "template",
    label,
    mode: normalizeText(item.mode || "prefill"),
    order: Number.isFinite(item.order) ? item.order : 0,
    promptId,
    source: normalizeText(item.source || source),
    systemPromptId: normalizeText(item.systemPromptId || prompt.systemPromptId),
    text: normalizeText(item.text),
    visible: true,
    ...(isPlainObject(item.when) ? { when: item.when } : {})
  };
}

function composerTemplateAction(template = {}) {
  return {
    id: normalizeText(template.id),
    label: normalizeText(template.label),
    promptId: normalizeText(template.promptId),
    systemPromptId: normalizeText(template.systemPromptId),
    type: "prompt"
  };
}

function sortedObjectEntries(value = {}) {
  return Object.entries(isPlainObject(value) ? value : {})
    .sort(([left], [right]) => left.localeCompare(right));
}

function promptContextScalarText(value) {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function promptContextScalarLines({
  indent = "",
  label = "",
  value = undefined
} = {}) {
  const text = promptContextScalarText(value);
  const normalizedLabel = normalizeText(label);
  if (!text.includes("\n")) {
    return [`${indent}- ${normalizedLabel ? `${normalizedLabel}: ` : ""}${text || "(empty)"}`];
  }
  return [
    `${indent}- ${normalizedLabel ? `${normalizedLabel}:` : ""}`.trimEnd(),
    ...text.split(/\r?\n/u).map((line) => `${indent}  ${line}`)
  ];
}

function promptContextEntryLines({
  indent = "",
  label = "",
  value = undefined
} = {}) {
  const normalizedLabel = normalizeText(label);
  if (Array.isArray(value)) {
    if (!value.length) {
      return [`${indent}- ${normalizedLabel ? `${normalizedLabel}: ` : ""}(none)`];
    }
    return [
      `${indent}- ${normalizedLabel}:`,
      ...value.flatMap((entry) => {
        if (isPlainObject(entry) || Array.isArray(entry)) {
          return promptContextValueLines(entry, `${indent}  `);
        }
        return promptContextScalarLines({
          indent: `${indent}  `,
          value: entry
        });
      })
    ];
  }
  if (isPlainObject(value)) {
    return [
      `${indent}- ${normalizedLabel}:`,
      ...promptContextValueLines(value, `${indent}  `)
    ];
  }
  return promptContextScalarLines({
    indent,
    label: normalizedLabel,
    value
  });
}

function promptContextValueLines(value = {}, indent = "") {
  const entries = sortedObjectEntries(value);
  if (!entries.length) {
    return [`${indent}- (none)`];
  }
  return entries.flatMap(([label, entryValue]) => promptContextEntryLines({
    indent,
    label,
    value: entryValue
  }));
}

function promptContextSection(title = "", value = {}) {
  return [
    `${title}:`,
    ...promptContextValueLines(value)
  ].join("\n");
}

const HIDDEN_WORKFLOW_METADATA_PREFIXES = Object.freeze([
  "codex_",
  "terminal_"
]);
const HIDDEN_WORKFLOW_METADATA_NAMES = new Set([
  "launch_target_restart_baseline",
  "launch_target_terminal_id"
]);

const WORKFLOW_METADATA_CONTEXT_REPLACEMENTS = new Set([
  "dependencies_path",
  "source_path"
]);
const AGENT_CONVERSATION_ACTION_ID = "agent_conversation";
const CONVERSATION_WORKFLOW_FACT_NAMES = new Set([
  "code_index_path",
  "dependencies_installed",
  "dependencies_package_manager",
  "github_issue_mode",
  "issue_source",
  "project_type",
  "workflow_definition"
]);
const CONVERSATION_WORKFLOW_FACT_PREFIXES = Object.freeze([
  "launch_target_",
  "work_"
]);
const LAUNCH_TARGET_AGENT_HREF_METADATA = "launch_target_agent_href";
const LAUNCH_TARGET_OPEN_HREF_METADATA = "launch_target_open_href";
const LAUNCH_TARGET_LABEL_METADATA = "launch_target_label";

function workflowMetadataIsPromptRelevant(name = "", value = undefined) {
  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    return false;
  }
  if (HIDDEN_WORKFLOW_METADATA_NAMES.has(normalizedName)) {
    return false;
  }
  if (HIDDEN_WORKFLOW_METADATA_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))) {
    return false;
  }
  if (WORKFLOW_METADATA_CONTEXT_REPLACEMENTS.has(normalizedName)) {
    return false;
  }
  if (typeof value === "string" && !normalizeText(value)) {
    return false;
  }
  if (Array.isArray(value) && !value.length) {
    return false;
  }
  if (isPlainObject(value) && !Object.keys(value).length) {
    return false;
  }
  return value !== null && value !== undefined;
}

function promptWorkflowFacts(metadata = {}) {
  const workTitle = normalizeText(metadata.work_title);
  const workWord = normalizeText(metadata.work_word);
  return Object.fromEntries(
    sortedObjectEntries(metadata)
      .filter(([name, value]) => workflowMetadataIsPromptRelevant(name, value))
      .filter(([name, value]) => {
        if (name === "issue_title" && workTitle && normalizeText(value) === workTitle) {
          return false;
        }
        if (name === "issue_word" && workWord && normalizeText(value) === workWord) {
          return false;
        }
        return true;
      })
  );
}

function promptLaunchTargetContext(metadata = {}) {
  const source = isPlainObject(metadata) ? metadata : {};
  const agentHref = normalizeText(source[LAUNCH_TARGET_AGENT_HREF_METADATA]);
  const browserHref = normalizeText(source[LAUNCH_TARGET_OPEN_HREF_METADATA]);
  if (!agentHref && !browserHref) {
    return "";
  }
  const label = normalizeText(source[LAUNCH_TARGET_LABEL_METADATA]);
  return [
    "Existing app launch target:",
    label ? `- launch target: ${label}` : "",
    agentHref ? `- Codex/app-server URL: ${agentHref}` : "",
    browserHref && browserHref !== agentHref ? `- browser URL: ${browserHref}` : "",
    "- Use the existing launched app above for browser/UI checks.",
    "- If you changed server-side routes, resources, providers, actions, repositories, migrations, or generated server metadata before browser/UI verification, run `vibe64-preview restart --wait` first, then rerun the browser check.",
    "- Do not start another dev server (`npm run dev`, `vite`, `next dev`, `jskit ... server`, etc.) unless the user explicitly asks you to replace or restart the launch target.",
    "- If `vibe64-preview` is unavailable, report that the managed preview cannot be restarted from the agent instead of starting a duplicate server.",
    "- If the URL is missing, still starting, or unreachable, report that the Vibe64 launch target is not ready/reachable instead of starting a duplicate server."
  ].filter(Boolean).join("\n");
}

function agentConversationAction(action = {}) {
  return normalizeText(action.id || action.promptId) === AGENT_CONVERSATION_ACTION_ID;
}

function executePlanAction(action = {}) {
  return ["execute_plan", "execute_seed_plan"].includes(normalizeText(action.promptId || action.id));
}

function conversationWorkflowMetadataIsPromptRelevant(name = "", value = undefined) {
  const normalizedName = normalizeText(name);
  return workflowMetadataIsPromptRelevant(normalizedName, value) &&
    (
      CONVERSATION_WORKFLOW_FACT_NAMES.has(normalizedName) ||
      CONVERSATION_WORKFLOW_FACT_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))
    );
}

function promptConversationWorkflowFacts(metadata = {}) {
  return Object.fromEntries(
    sortedObjectEntries(metadata)
      .filter(([name, value]) => conversationWorkflowMetadataIsPromptRelevant(name, value))
  );
}

function workflowContextLine(label = "", value = "") {
  const text = normalizeText(value);
  return text ? `- ${label}: ${text}` : "";
}

function promptWorkflowContext({
  action = {},
  includeSessionPaths = true,
  session = {}
} = {}) {
  const promptId = normalizeText(action.promptId || action.id);
  return [
    "Vibe64 workflow context:",
    workflowContextLine("action", action.label || action.id),
    workflowContextLine("action id", action.id),
    workflowContextLine("prompt", promptId),
    workflowContextLine("session id", session.sessionId || session.id),
    workflowContextLine("current step", session.currentStep),
    workflowContextLine("step status", session.stepMachine?.status),
    workflowContextLine("session status", session.status),
    ...(includeSessionPaths
      ? [
        workflowContextLine("target root", session.targetRoot),
        workflowContextLine(
          "source path",
          sessionSourcePath(session)
        ),
        workflowContextLine("artifacts root", session.artifactsRoot)
      ]
      : [])
  ]
    .filter(Boolean)
    .join("\n");
}

function promptWithWorkflowContext({
  action = {},
  includeSessionPaths = true,
  input = {},
  prompt = "",
  session = {}
} = {}) {
  return [
    promptWorkflowContext({
      action,
      includeSessionPaths,
      session
    }),
    promptContextSection("User/request input", input),
    promptContextSection("Relevant workflow facts", promptWorkflowFacts(session.metadata)),
    promptLaunchTargetContext(session.metadata),
    "Missing information policy:\n" + missingInformationPolicyInstruction(),
    String(prompt || "").trim()
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

async function inputWithAcceptedPlanForAction(store, session = {}, action = {}, input = {}) {
  if (!executePlanAction(action)) {
    return input;
  }
  const [planSummary, technicalPlan] = await Promise.all([
    store.readArtifact(session.sessionId, PLAN_SUMMARY_ARTIFACT),
    store.readArtifact(session.sessionId, PLAN_TECHNICAL_ARTIFACT)
  ]);
  const acceptedPlan = Object.fromEntries([
    ["acceptedPlanSummary", normalizeText(planSummary)],
    ["acceptedTechnicalPlan", normalizeText(technicalPlan)]
  ].filter(([, value]) => Boolean(value)));
  if (Object.keys(acceptedPlan).length === 0) {
    return input;
  }
  return {
    ...input,
    ...acceptedPlan
  };
}

function promptWithConversationTurnContext({
  action = {},
  input = {},
  prompt = "",
  session = {},
  sessionBriefingIncluded = false
} = {}) {
  const promptId = normalizeText(action.promptId || action.id);
  const workflowFacts = promptConversationWorkflowFacts(session.metadata);
  return [
    [
      "Vibe64 interactive conversation turn:",
      "VIBE64_ROUTED_TURN: yes",
      workflowContextLine("action", action.label || action.id),
      workflowContextLine("action id", action.id),
      workflowContextLine("prompt", promptId),
      workflowContextLine("session id", session.sessionId || session.id),
      workflowContextLine("current step", session.currentStep),
      workflowContextLine("step status", session.stepMachine?.status),
      workflowContextLine("session status", session.status)
    ].filter(Boolean).join("\n"),
    sessionBriefingIncluded
      ? ""
      : "Session briefing: Use the Vibe64 session briefing already provided for static setup facts, fixed paths, adapter contracts, managed services, project config, and missing-information policy.",
    promptContextSection("User/request input", input),
    Object.keys(workflowFacts).length > 0
      ? promptContextSection("Current dynamic workflow facts", workflowFacts)
      : "",
    promptLaunchTargetContext(session.metadata),
    [
      "Response routing:",
      "- Finish this routed workflow turn with the Vibe64 agent result envelope described in the completion contract.",
      "- A terminal-only answer is incomplete for routed workflow turns.",
      "- If the current state no longer matches this prompt, say that Vibe64 state changed and stop.",
      "- Direct terminal input routing: if a later user prompt does not include `VIBE64_ROUTED_TURN`, answer normally. Direct terminal input does not advance Vibe64 workflow state unless Vibe64 explicitly routes the turn."
    ].join("\n"),
    String(prompt || "").trim()
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
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

function inputObject(input = {}) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function currentStepSubmissionInputFields(session = {}) {
  const screenFields = session.presentation?.screen?.input?.fields;
  if (Array.isArray(screenFields) && screenFields.length > 0) {
    return screenFields;
  }
  const interactionFields = session.currentStepDefinition?.interaction?.fields;
  return Array.isArray(interactionFields) ? interactionFields : [];
}

async function privateSafeActionInput(runtime, session = {}, action = {}, input = {}) {
  const prepared = await preparePrivateInputSubmission({
    fields: input,
    inputFields: action.inputFields,
    owner: {
      actionId: action.id,
      id: action.id,
      kind: "action",
      stepId: session.currentStep,
      stepStatus: session.stepMachine?.status
    },
    session,
    store: runtime.store
  });
  return prepared.fields;
}

async function privateSafeCurrentStepInput(runtime, session = {}, input = {}) {
  const source = inputObject(input);
  const inputSource = normalizeText(source.source);
  if (inputSource === "agent" || inputSource === "codex") {
    return source;
  }
  const prepared = await preparePrivateInputSubmission({
    fields: source.fields,
    inputFields: currentStepSubmissionInputFields(session),
    owner: {
      id: session.currentStep || "current_step",
      kind: "current_step",
      stepId: session.currentStep,
      stepStatus: session.stepMachine?.status
    },
    session,
    store: runtime.store
  });
  return {
    ...source,
    fields: prepared.fields
  };
}

async function recordCurrentStepConversationMessage(runtime, session = {}, input = {}) {
  const source = inputObject(input);
  const inputSource = normalizeText(source.source);
  const text = currentStepInputConversationText(runtime, session, source);
  if (!text) {
    return null;
  }
  if (inputSource === "codex") {
    return runtime.store.writeConversationAssistantMessage(session.sessionId, {
      text
    });
  }
  if (inputSource === "ui") {
    return runtime.store.writeConversationUserMessage(session.sessionId, {
      text
    });
  }
  return null;
}

function visiblePromptFromActionInput(action = {}, input = {}) {
  const entries = inputFieldEntries(action, input);
  if (!entries.length) {
    return "";
  }
  if (entries.length === 1) {
    return entries[0].value;
  }
  return entries
    .map((entry) => `${entry.label}:\n${entry.value}`)
    .join("\n\n");
}

function visiblePromptForPromptAction(action = {}, input = {}) {
  return visiblePromptFromActionInput(action, input) ||
    normalizeText(action.label || action.promptId || action.id);
}

class Vibe64SessionRuntime {
  constructor({
    actionReadiness = undefined,
    actionHandlers = {},
    adapter = new TargetAdapter(),
    clock = undefined,
    defaultHandler = defaultActionHandler,
    onlineProjectRecordPath = "",
    projectConfig = {},
    projectLocalRoot = "",
    projectSharedRoot = "",
    stateRoot = "",
    store = undefined,
    targetRoot = process.cwd(),
    workflow = null,
    workflowCreationBaseline = null,
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
    this.stateRoot = projectLocalRoot || stateRoot || resolveVibe64ProjectLocalRoot(targetRoot);
    this.onlineProjectRecordPath = normalizeText(onlineProjectRecordPath);
    this.projectSharedRoot = normalizeText(projectSharedRoot);
    this.targetRoot = targetRoot;
    this.workflowCreationBaseline = isPlainObject(workflowCreationBaseline)
      ? workflowCreationBaseline
      : null;
    this.store = store || createVibe64SessionStore({
      clock,
      projectLocalRoot: this.stateRoot,
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

  async compactClosedSessionIfNeeded(session = {}) {
    if (!sessionStatusIsClosed(session.status) || typeof this.store.compactClosedSession !== "function") {
      return null;
    }
    await this.store.compactClosedSession(session.sessionId);
    return this.getSession(session.sessionId);
  }

  actionHandler(actionId) {
    return this.actionHandlers[actionId] || this.defaultHandler;
  }

  async sessionView(session, {
    sessionAdapter = undefined
  } = {}) {
    const workflowDefinitionId = this.workflowDefinitionIdForSession(session);
    const sessionWithWorkflowMetadata = this.sessionWithWorkflowInitialMetadata(session, workflowDefinitionId);
    const sessionWithConfig = {
      ...sessionWithWorkflowMetadata,
      config: this.projectConfig,
      adapter: sessionAdapter || await this.adapterViewForSession(sessionWithWorkflowMetadata)
    };
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
      ...this.sessionWithWorkflowInitialMetadata(session, workflowDefinitionId),
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

  sessionWithWorkflowInitialMetadata(session = {}, workflowDefinitionId = "") {
    if (this.workflowMachine) {
      return session;
    }
    return {
      ...session,
      metadata: this.sessionMetadataWithWorkflowDefinition(session.metadata, workflowDefinitionId)
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
    if (this.workflowCreationBaseline && typeof this.workflowCreationBaseline.seedRequired === "boolean") {
      return this.workflowCreationBaseline.seedRequired
        ? VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
        : DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID;
    }
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
    await Promise.all([
      this.store.writeArtifact(sessionId, "issue_word", `${sessionWord}\n`),
      this.store.writeArtifact(sessionId, "work_word", `${sessionWord}\n`)
    ]);
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

  async renderComposerTemplate(template = {}, {
    config = {},
    session = {}
  } = {}) {
    const normalizedTemplate = normalizeComposerTemplate(template);
    if (!normalizedTemplate) {
      return null;
    }
    if (normalizedTemplate.text) {
      return normalizedTemplate;
    }
    const renderedPrompt = await this.adapter.renderPrompt({
      action: composerTemplateAction(normalizedTemplate),
      config,
      input: normalizedTemplate.input,
      runtime: this,
      session: promptSessionWithStaticContextReferences(session),
      store: this.store
    });
    return {
      ...normalizedTemplate,
      text: renderedPrompt.prompt
    };
  }

  async composerMenuItemsForSession({
    context = {},
    session = {}
  } = {}) {
    const coreTemplates = coreComposerTemplates();
    const adapterTemplates = await this.adapter.listComposerTemplates(context);
    const renderedTemplates = await Promise.all([
      ...coreTemplates.map((template) => this.renderComposerTemplate({
        ...template,
        source: "core"
      }, {
        config: this.projectConfig,
        session
      })),
      ...(Array.isArray(adapterTemplates) ? adapterTemplates : []).map((template) => this.renderComposerTemplate({
        ...template,
        source: "adapter"
      }, {
        config: this.projectConfig,
        session
      }))
    ]);
    const explicitItems = await this.adapter.listComposerMenuItems(context);
    return [
      ...renderedTemplates.filter(Boolean),
      ...(Array.isArray(explicitItems) ? explicitItems : [])
    ];
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
    const promptAdapterView = adapterView({
      adapter: this.adapter,
      commands,
      detection,
      facts,
      managedServices,
      promptContext,
      runtimeContainers
    });
    const adapterSession = {
      ...session,
      adapter: promptAdapterView
    };
    const composerMenuItems = await this.composerMenuItemsForSession({
      context: {
        ...context,
        session: adapterSession,
        commands,
        detection,
        facts,
        managedServices,
        promptContext,
        runtimeContainers
      },
      session: adapterSession
    });
    return adapterView({
      adapter: this.adapter,
      ...context,
      commands,
      detection,
      facts,
      managedServices,
      composerMenuItems,
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
    const promptInput = await inputWithAcceptedPlanForAction(this.store, promptSession, action, input);
    const sessionBriefingIncluded = !sessionBriefingIsDelivered(promptSession);
    const actionPromptSession = promptSessionWithStaticContextReferences(promptSession);
    const renderedPrompt = await this.adapter.renderPrompt({
      action,
      config: this.projectConfig,
      input: promptInput,
      runtime: this,
      session: actionPromptSession,
      store: this.store
    });
    const promptWithActionContext = agentConversationAction(action)
      ? promptWithConversationTurnContext({
          action,
          input: promptInput,
          prompt: renderedPrompt.prompt,
          session: promptSession,
          sessionBriefingIncluded
        })
      : promptWithWorkflowContext({
          action,
          includeSessionPaths: !sessionBriefingIncluded,
          input: promptInput,
          prompt: renderedPrompt.prompt,
          session: promptSession
        });
    const promptWithBriefing = promptWithSessionBriefing({
      prompt: promptWithActionContext,
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
        visiblePrompt: visiblePromptForPromptAction(action, input)
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
    try {
      const result = await this.runAdapterFinishSession({
        action,
        input,
        session
      });
      if (result.status !== "completed") {
        return result;
      }
      await this.markSessionClosing(session.sessionId, {
        reason: "finished"
      });
      await this.archiveSessionSource(session, {
        reason: "finished"
      });
      return {
        ...result,
        metadata: {
          ...result.metadata,
          session_finished: "yes"
        },
        sessionStatus: VIBE64_SESSION_STATUS.FINISHED
      };
    } catch (error) {
      await this.recoverFailedFinishSessionAction(session, error);
      throw error;
    }
  }

  async recoverFailedFinishSessionAction(session = {}, error = null) {
    const sessionId = normalizeText(session.sessionId || session.id);
    if (!sessionId) {
      return;
    }
    try {
      await this.clearSessionClosing(sessionId);
      const currentSession = await this.getSession(sessionId);
      if (currentSession.status !== VIBE64_SESSION_STATUS.ACTIVE) {
        return;
      }
      const message = "Archive failed. Resolve the failure, then retry archive.";
      await recoverStuckStepMachineExecution(this, currentSession, {
        message
      });
      await this.store.appendCommandLogEntry(sessionId, {
        error: error ? String(error.message || error) : "",
        fromStatus: currentSession.stepMachine?.status || "",
        kind: "recover-failed-finish-session",
        message,
        stepId: currentSession.currentStep,
        toStatus: "ready"
      });
    } catch (recoveryError) {
      vibe64SessionDebugLog("server.runtime.finishSessionAction.recovery.error", {
        error: vibe64SessionDebugError(recoveryError),
        originalError: vibe64SessionDebugError(error),
        sessionId
      });
    }
  }

  async archiveSessionSource(session = {}, {
    reason = "archive"
  } = {}) {
    return this.store.mutateSession(session.sessionId, async () => {
      const latestSession = await this.getSession(session.sessionId);
      return archiveSessionSource({
        adapter: this.adapter,
        reason,
        session: latestSession,
        store: this.store
      });
    });
  }

  async markSessionClosing(sessionId = "", {
    reason = "closing"
  } = {}) {
    return this.store.mutateSession(sessionId, async () => {
      const metadata = sessionClosingMetadata(reason);
      await Promise.all(Object.entries(metadata).map(([name, value]) => (
        this.store.writeMetadataValue(sessionId, name, value)
      )));
      return this.getSession(sessionId);
    });
  }

  async clearSessionClosing(sessionId = "") {
    return this.store.mutateSession(sessionId, async () => {
      await this.store.deleteMetadataValues(sessionId, [
        VIBE64_SESSION_CLOSING_AT_METADATA,
        VIBE64_SESSION_CLOSING_REASON_METADATA
      ]);
      return this.getSession(sessionId);
    });
  }

  async recoverSessionSource(sessionId = "") {
    return this.store.mutateSession(sessionId, async () => {
      const session = await this.getSession(sessionId);
      await recoverSessionSource({
        session,
        store: this.store
      });
      await this.store.deleteMetadataValues(sessionId, [
        VIBE64_SESSION_CLOSING_AT_METADATA,
        VIBE64_SESSION_CLOSING_REASON_METADATA
      ]);
      return this.getSession(sessionId);
    });
  }

  async runAction(sessionId, actionId, input = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.runAction.start", {
      actionId,
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId
    });
    try {
      const viewedSession = await this.store.mutateSession(sessionId, async () => {
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
        const actionInput = await privateSafeActionInput(this, actionSession, actionAfterStart, input);
        const handlerResult = await this.actionHandler(actionAfterStart.id)({
          action: actionAfterStart,
          input: actionInput,
          runtime: this,
          session: actionSession,
          store: this.store
        });
        const actionResult = await this.store.writeActionResult(
          actionSession.sessionId,
          actionAfterStart.id,
          actionResultRecord(actionAfterStart, actionSession, actionInput, handlerResult)
        );
        await markCodexPromptHandoffRunStarting(this.store, actionSession, actionResult);
        await writeActionResultEffects(this.store, actionSession.sessionId, handlerResult);
        await this.store.appendCommandLogEntry(
          actionSession.sessionId,
          actionLogEntry(actionAfterStart, actionSession, actionResult)
        );
        await recordStepMachineActionFinished(this, actionSession, actionAfterStart.id, actionResult);

        const actionCompletedSession = await this.runActionSessionView(actionSession.sessionId);
        const finalSession = actionCanAdvanceOnSuccess(actionAfterStart, actionResult, actionCompletedSession)
          ? await this.advance(actionSession.sessionId)
          : actionCompletedSession;
        const viewedSession = {
          ...finalSession,
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
      const compactedSession = await this.compactClosedSessionIfNeeded(viewedSession);
      return compactedSession
        ? {
            ...compactedSession,
            actionResult: viewedSession.actionResult
          }
        : viewedSession;
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

  async advance(sessionId, expected = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.advance.start", {
      expectedStepId: String(expected?.stepId || ""),
      expectedStepStatus: String(expected?.stepStatus || ""),
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
        assertAdvanceMatchesCurrentState(session, expected);
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
        await this.store.writeConversationSystemMessage(session.sessionId, {
          text: `Rewind to ${plan.targetStepLabel || plan.targetStepId}.`
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

  async returnControlFromAgentWait(sessionId, {
    inputPrompt = "What would you like to do?",
    message = "Control back to the user."
  } = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.returnControlFromAgentWait.start", {
      message,
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const session = await this.getSession(sessionId);
        if (session.status !== VIBE64_SESSION_STATUS.ACTIVE) {
          vibe64SessionDebugLog("server.runtime.returnControlFromAgentWait.blocked", {
            ...vibe64SessionDebugSummary(session),
            reason: "closed_session"
          });
          throw vibe64Error("Closed Vibe64 sessions cannot return Codex control.", "vibe64_closed_session_agent_control");
        }
        const changed = await returnControlFromAgentWait(this, session, {
          inputPrompt
        });
        if (changed && typeof this.store.writeConversationSystemMessage === "function") {
          await this.store.writeConversationSystemMessage(session.sessionId, {
            text: message
          });
        }
        const updatedSession = await this.getSession(session.sessionId);
        vibe64SessionDebugLog("server.runtime.returnControlFromAgentWait.done", {
          ...vibe64SessionDebugSummary(updatedSession),
          changed,
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          fromStepStatus: String(session.stepMachine?.status || "")
        });
        return updatedSession;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.returnControlFromAgentWait.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  async appendTerminalChatExchange(sessionId, input = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.appendTerminalChatExchange.start", {
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const session = await this.getSession(sessionId);
        const requestText = normalizeText(input.request || input.prompt || input.user || input.text);
        const responseText = normalizeText(input.response || input.answer || input.assistant);
        if (requestText) {
          await this.store.writeConversationUserMessage(session.sessionId, {
            text: requestText
          });
        }
        if (responseText) {
          await this.store.writeConversationAssistantMessage(session.sessionId, {
            text: responseText
          });
        }
        const updatedSession = await this.getSession(session.sessionId);
        vibe64SessionDebugLog("server.runtime.appendTerminalChatExchange.done", {
          ...vibe64SessionDebugSummary(updatedSession),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          mirroredRequest: Boolean(requestText),
          mirroredResponse: Boolean(responseText)
        });
        return updatedSession;
      });
    } catch (error) {
      vibe64SessionDebugLog("server.runtime.appendTerminalChatExchange.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId
      });
      throw error;
    }
  }

  async submitCurrentStepInput(sessionId, input = {}, options = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.runtime.submitCurrentStepInput.start", {
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId
    });
    try {
      return await this.store.mutateSession(sessionId, async () => {
        const currentSession = await this.getSession(sessionId);
        const safeInput = await privateSafeCurrentStepInput(this, currentSession, input);
        await saveStepMachineInput(this, sessionId, safeInput);
        const savedSession = await this.getSession(sessionId);
        if (options?.recordConversationMessage !== false) {
          await recordCurrentStepConversationMessage(this, savedSession, safeInput);
        }
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
