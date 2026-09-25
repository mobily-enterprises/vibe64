import { createHash, randomUUID } from "node:crypto";
import { checkpointSessionTurn } from "./sessionTurnCheckpoint.js";
import { requireCompletedNativeConversationReplacement } from "./assistantChangeover.js";
import { retireNativeConversation } from "./nativeConversationRetirement.js";
import { openCodeAssistantMessageText as assistantMessageText } from "@jskit-ai/assistant-core/server/opencode-client";
import { createNativeHistoryExport } from "@local/vibe64-runtime/server/nativeHistoryExport";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";

import {
  codexAppServerRuntimeBaseDir,
  VIBE64_AGENT_RUN_STATE,
  vibe64AgentRunStateIsActive
} from "@local/vibe64-runtime/server";
import {
  genesisCommandShimDirectory,
  vibe64HostContextResolverPath
} from "@local/vibe64-genesis/server";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  defineVibe64AssistantSelection,
  vibe64AgentExecutionProfileAuditSnapshot,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  resizeTerminalSession,
  subscribeTerminalSession,
  terminalNamespaceAdmissionFailure,
  writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";

import {
  openCodeAssistantCapabilities,
  openCodeConfiguredAssistantCapabilities
} from "./agent/providers/opencodeAssistantCatalog.js";
import { conversationActorMetadata } from "./conversationActor.js";
import {
  prepareAgentSessionCommandEnvironment
} from "./agentCommandEnvironment.js";
import {
  OPENCODE_ECONOMY_AGENT_ID,
  OPENCODE_EPHEMERAL_AGENT_ID,
  createOpenCodeServerProcess,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  verifyOpenCodeApiKey
} from "./opencodeServerProcess.js";
import {
  defineSessionRenewalApprovedHandover,
  defineSessionRenewalOperationId,
  parseSessionRenewalAcknowledgement,
  parseSessionRenewalHandoverOutput,
  sessionRenewalClientMessageId,
  sessionRenewalHandoverPrompt,
  sessionRenewalSeedPrompt
} from "./sessionRenewalHandover.js";
import { recordSessionGitCommandActor } from "./sessionGitCommandActor.js";
import {
  opencodeTerminalNamespace,
  terminalSessionSourceRoot,
  vibe64Result
} from "./terminalShared.js";

const OPENCODE_AGENT_RUN_ID = "opencode_server";
const OPENCODE_CATALOG_CACHE_MS = 10 * 60 * 1000;
const OPENCODE_MESSAGE_POLL_MS = 250;
// A cold project event route initializes OpenCode plugins before replying.
const OPENCODE_EVENT_READY_TIMEOUT_MS = 120_000;
const OPENCODE_INTERRUPT_TIMEOUT_MS = 5_000;
const OPENCODE_PROGRESS_PUBLISH_INTERVAL_MS = 1_000;
const OPENCODE_REASONING_HEADLINE_MAX_CHARS = 120;
const OPENCODE_REASONING_SUMMARY_TIMEOUT_MS = 12_000;
const OPENCODE_REASONING_SUMMARY_MAX_INPUT_CHARS = 1_200;
const OPENCODE_REASONING_SUMMARY_MIN_INPUT_CHARS = 40;
const OPENCODE_RENEWAL_TIMEOUT_MS = 3 * 60 * 1000;
const OPENCODE_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH = 256 * 1024;

function text(value = "") {
  return String(value ?? "").trim();
}

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function openCodeError(code, message, details = {}, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details };
  error.statusCode = statusCode;
  return error;
}

function safeSessionId(value = "") {
  const sessionId = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(sessionId)) {
    throw new TypeError("OpenCode operations require a valid Vibe64 session id.");
  }
  return sessionId;
}

function fingerprint(...values) {
  return createHash("sha256").update(values.map((value) => String(value ?? "")).join("\0")).digest("hex");
}

function upstreamMessageId(value = "") {
  return `msg_vibe64_${fingerprint(value || randomUUID()).slice(0, 40)}`;
}

function conversationMessageId(...values) {
  return `oc_${fingerprint(...values).slice(0, 48)}`;
}

function openCodeReasoningHeadline(value = "") {
  const normalized = String(value ?? "").replace(/\r\n?/gu, " ").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }
  const sentence = normalized.split(/(?<=[.!?])\s+/u)[0] || normalized;
  if (sentence.length <= OPENCODE_REASONING_HEADLINE_MAX_CHARS) {
    return sentence;
  }
  const words = sentence.slice(0, OPENCODE_REASONING_HEADLINE_MAX_CHARS).split(/\s+/u);
  words.pop();
  return words.length ? `${words.join(" ")}…` : sentence;
}

function openCodeModel(selection = {}, executionProfile = null) {
  const modelId = text(executionProfile?.model) || text(selection.modelId);
  const variantId = executionProfile
    ? text(executionProfile.thinking)
    : text(selection.variantId);
  return {
    id: modelId,
    providerID: text(selection.modelProviderId),
    ...(variantId ? { variant: variantId } : {})
  };
}

function sameOpenCodeSelection(left = {}, right = {}) {
  return ["agentId", "modelId", "modelProviderId", "variantId"]
    .every((name) => text(left?.[name]) === text(right?.[name]));
}

function openCodeExecutionProfile(input = {}) {
  if (!input?.executionProfile) {
    return null;
  }
  const profile = vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile);
  if (profile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY) {
    throw openCodeError(
      "vibe64_opencode_execution_profile_unsupported",
      `OpenCode does not support execution profile ${profile.profileId}.`
    );
  }
  return profile;
}

function openCodeAgent(selection = {}, executionProfile = null, assistantScope = null) {
  if (executionProfile) return OPENCODE_ECONOMY_AGENT_ID;
  return assistantScope ? OPENCODE_EPHEMERAL_AGENT_ID : text(selection.agentId);
}

function openCodeDetachedPrompt(input = {}) {
  const prompt = text(input.prompt || input.message);
  if (!input.outputSchema) {
    return prompt;
  }
  return [
    prompt,
    "",
    "Return only one JSON value matching this JSON Schema. Do not wrap it in Markdown code fences:",
    JSON.stringify(input.outputSchema)
  ].join("\n");
}

function openCodeStructuredOutput(value = "") {
  const original = String(value ?? "");
  const match = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(original.trim());
  return match ? match[1].trim() : original;
}

function boundedOpenCodeExecutionInput(prompt = "", executionProfile = null) {
  if (!executionProfile) {
    return;
  }
  if (prompt.length > executionProfile.limits.maxInputCharacters) {
    throw openCodeError(
      "vibe64_opencode_execution_input_too_large",
      "The bounded OpenCode helper input exceeded its execution-profile limit.",
      { maximum: executionProfile.limits.maxInputCharacters },
      413
    );
  }
}

function boundedOpenCodeExecutionOutput(result = {}, executionProfile = null) {
  if (
    executionProfile &&
    String(result.text || "").length > executionProfile.limits.maxOutputCharacters
  ) {
    throw openCodeError(
      "vibe64_opencode_execution_output_too_large",
      "The bounded OpenCode helper output exceeded its execution-profile limit.",
      { maximum: executionProfile.limits.maxOutputCharacters },
      502
    );
  }
  return result;
}

function openCodeExecutionTimeout(input = {}, executionProfile = null) {
  const requested = Number(input.timeoutMs);
  const requestedTimeout = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  if (!executionProfile) {
    return requestedTimeout;
  }
  return requestedTimeout
    ? Math.min(requestedTimeout, executionProfile.limits.timeoutMs)
    : executionProfile.limits.timeoutMs;
}

function openCodeSelection(session = {}) {
  const selection = vibe64AssistantSelectionFromMetadata(session?.metadata, {
    required: false
  });
  if (!selection || selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
    throw openCodeError(
      "vibe64_opencode_selection_required",
      "This session does not have a durable OpenCode selection."
    );
  }
  return selection;
}

function connectionIdentity(connection = {}, apiKey = "") {
  const value = text(connection.fingerprint);
  return /^sha256:[a-f0-9]{64}$/u.test(value)
    ? value
    : `sha256:${fingerprint(apiKey)}`;
}

function requireOpenCodeConnection(value = null, modelProviderId = "") {
  const connection = record(value);
  const apiKey = String(connection.apiKey || connection.key || "");
  const actualProviderId = text(
    connection.modelProviderId || connection.providerId || connection.id || modelProviderId
  );
  if (!apiKey || actualProviderId !== text(modelProviderId)) {
    throw openCodeError(
      "vibe64_assistant_connection_required",
      `Connect ${text(modelProviderId) || "this provider"} with an API key before using OpenCode.`,
      { modelProviderId: text(modelProviderId) }
    );
  }
  const canonicalUrl = text(connection.canonicalUrl);
  const endpointCode = text(connection.endpointCode);
  if (
    endpointCode &&
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(endpointCode)
  ) {
    throw openCodeError(
      "vibe64_assistant_connection_route_invalid",
      "The selected OpenCode connection has an invalid billing endpoint.",
      { modelProviderId: actualProviderId }
    );
  }
  return {
    apiKey,
    canonicalUrl,
    economyModelId: text(connection.economyModelId),
    endpointCode,
    fingerprint: connectionIdentity(connection, apiKey),
    modelProviderId: actualProviderId
  };
}

function openCodeMessageRows(value = null) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows
    .map((message, index) => ({ index, message }))
    .sort((left, right) => (
      (Number(left.message?.time?.created) || 0) - (Number(right.message?.time?.created) || 0) ||
      left.index - right.index
    ))
    .map(({ message }) => message);
}

function openCodeRowsForInput(value = null, inputMessageId = "") {
  const rows = openCodeMessageRows(value);
  const index = rows.findIndex((message) => text(message?.id) === text(inputMessageId));
  if (index < 0) {
    return [];
  }
  const turnRows = [];
  let compactionFollowup = false;
  for (const message of rows.slice(index + 1)) {
    if (message?.type === "user") {
      if (message.content?.some((part) => part.type === "compaction" && part.auto === true)) {
        compactionFollowup = true;
      } else {
        // Native automatic compaction emits one continuation or replays the
        // original prompt. Both remain part of this already admitted request.
        if (!compactionFollowup) break;
        compactionFollowup = false;
      }
    }
    turnRows.push(message);
  }
  return turnRows;
}

function openCodeMessageResultForInput(value = null, inputMessageId = "") {
  const rows = openCodeRowsForInput(value, inputMessageId);
  if (!rows.length && !openCodeMessageRows(value).some((message) => (
    text(message?.id) === text(inputMessageId)
  ))) {
    return null;
  }
  if (rows.at(-1)?.type !== "assistant") {
    return { admitted: true, complete: false, error: "", text: "", turnId: "" };
  }
  const result = lastAssistantResult(rows);
  return {
    admitted: true,
    complete: Boolean(result.error || (!result.message?.summary &&
      (result.message?.time?.completed || result.message?.finish))),
    error: result.error,
    text: result.text,
    turnId: text(result.message?.id)
  };
}

function openCodeMessageError(message = {}) {
  const failure = text(
    message?.error?.message ||
    message?.error?.data?.message ||
    message?.error?.name ||
    message?.error
  );
  const hook = /GENESIS_HOOK_FAILURE (\{[^\n]*\})/u.exec(failure);
  if (hook) {
    try {
      const diagnostic = JSON.parse(hook[1]);
      const scope = ["session", "turn"].includes(diagnostic.scope) ? diagnostic.scope : "context";
      const seconds = Number.isFinite(diagnostic.elapsedMs) ? (diagnostic.elapsedMs / 1000).toFixed(1) : "unknown";
      let reason = "failed";
      if (diagnostic.outcome === "timeout") reason = "timed out";
      else if (diagnostic.outcome === "unavailable") reason = "could not start because the Genesis executable was unavailable";
      const detail = [
        diagnostic.code != null ? `exit/code ${String(diagnostic.code).slice(0, 60)}` : "",
        diagnostic.signal ? `signal ${String(diagnostic.signal).slice(0, 30)}` : ""
      ].filter(Boolean).join(", ");
      return [
        `Project guidance could not load: the Genesis ${scope} hook ${reason} after ${seconds}s${detail ? ` (${detail})` : ""}.`,
        text(diagnostic.stderr).slice(0, 1500) || "The command returned no diagnostic output.",
        "The assistant stopped before it could continue. Check the project's Genesis hook and installed runtime, then send your message again."
      ].join("\n\n");
    } catch {
      // Preserve the ordinary provider failure when no valid hook diagnostic exists.
    }
  }
  if (/Command failed: genesis hook (?:turn|session)\b/u.test(failure)) {
    return "Project guidance could not load: the Genesis hook command failed. This hook version did not report an exit code, termination signal or stderr, so a timeout is unconfirmed. Update the project's Genesis guidance adapter and check the installed runtime, then send your message again.";
  }
  return failure;
}

function openCodeCredentialFailure(value = "") {
  const failure = text(value);
  return (
    /\b(?:401|403)\b/u.test(failure) ||
    (
      /(?:api[-_\s]?key|authentication|authorization|credential|access[-_\s]?token|unauthori[sz]ed|forbidden)/iu.test(failure) &&
      /(?:denied|expired|failed|forbidden|incorrect|invalid|missing|rejected|revoked|unauthori[sz]ed)/iu.test(failure)
    )
  );
}

function openCodeProviderApiFailure(error = {}) {
  return text(error?.name) === "APIError";
}

function openCodeCredentialFailureNoticeMessage() {
  return "OpenCode needs attention: the selected provider rejected its API key, which may have expired or been revoked. [Open AI Accounts](/app/manage/accounts) to replace and verify the key, then return here and send your message again. Saved project changes remain.";
}

function openCodeProviderApiFailureNoticeMessage(failure = "") {
  return `OpenCode could not finish: ${text(failure)} Saved project changes remain. [Manage AI accounts](/app/manage/accounts)`;
}

function openCodeFailureNoticeMessage(failure = "") {
  const detail = text(failure);
  return detail
    ? `OpenCode could not finish.\n\n${detail}\n\nSaved project changes remain.`
    : "OpenCode could not finish. Saved project changes remain.";
}

function lastAssistantResult(value = null) {
  const message = [...openCodeMessageRows(value)]
    .reverse()
    .find((candidate) => candidate?.type === "assistant");
  return {
    error: openCodeMessageError(message),
    message,
    text: message?.summary ? "" : assistantMessageText(message)
  };
}

function latestOpenCodeMessageResult(value = null) {
  const result = lastAssistantResult(value);
  if (!result.message) {
    return null;
  }
  return {
    admitted: true,
    complete: Boolean(result.error || (!result.message.summary &&
      (result.message.time?.completed || result.message.finish))),
    error: result.error,
    text: result.text,
    turnId: text(result.message.id)
  };
}

async function waitForOpenCodeMessages(client, conversationId = "", inputMessageId = "", {
  onMessages = null,
  readFailure = () => null,
  signal
} = {}) {
  const resolveInputMessageId = typeof inputMessageId === "function"
    ? inputMessageId
    : () => text(inputMessageId);
  let completedInputMessageId = null;
  while (true) {
    signal?.throwIfAborted();
    const expectedInputMessageId = text(resolveInputMessageId());
    const messages = await client.messages(conversationId, {
      limit: 100,
      order: "desc"
    }, { signal });
    signal?.throwIfAborted();
    if (expectedInputMessageId !== text(resolveInputMessageId())) continue;
    if (typeof onMessages === "function") {
      await onMessages(messages, expectedInputMessageId);
    }
    const result = expectedInputMessageId
      ? openCodeMessageResultForInput(messages, expectedInputMessageId)
      : latestOpenCodeMessageResult(messages);
    const failure = readFailure();
    if (failure && (await client.sessionStatus(conversationId, { signal })).type === "idle") {
      throw failure;
    }
    if (result?.complete) {
      if (completedInputMessageId === expectedInputMessageId) {
        return { messages, result };
      }
      completedInputMessageId = expectedInputMessageId;
    } else {
      completedInputMessageId = null;
    }
    await delay(OPENCODE_MESSAGE_POLL_MS, undefined, { signal });
  }
}

function eventSummary(event = {}) {
  const payload = record(event.data);
  const properties = record(payload.properties);
  const data = Object.keys(properties).length ? properties : record(payload.data);
  const info = record(data.info);
  const part = record(data.part);
  const model = record(info.model || data.model);
  return {
    agent: text(info.agent || data.agent),
    at: Number(data.timestamp || part.time?.start || part.time?.created) || Date.now(),
    eventId: text(event.id || payload.id || part.id),
    messageId: text(part.messageID || data.messageID || info.id),
    modelId: text(model.id || model.modelID || info.modelID),
    modelProviderId: text(model.providerID || info.providerID),
    partId: text(part.id || data.partID),
    partType: text(part.type) || (
      text(payload.type) === "session.next.reasoning.ended"
        ? "reasoning"
        : text(payload.type) === "session.next.text.ended"
          ? "text"
          : ""
    ),
    text: ["reasoning", "text"].includes(text(part.type))
      ? text(part.text || data.delta).slice(0, 32_000)
      : ["session.next.text.ended", "session.next.reasoning.ended"].includes(text(payload.type))
        ? text(data.text).slice(0, 32_000)
        : "",
    tool: text(part.tool || data.tool),
    type: text(payload.type || event.event)
  };
}

function openCodeRunRealtimePayload(run = {}) {
  const state = text(run.state);
  const active = run.active === true || vibe64AgentRunStateIsActive(state);
  const turnState = state === VIBE64_AGENT_RUN_STATE.STARTING
    ? "starting"
    : state === VIBE64_AGENT_RUN_STATE.FINALIZING
      ? "finalizing"
      : active
        ? "active"
        : "idle";
  const threadId = text(run.threadId);
  const turnId = text(run.turnId);
  const updatedAt = text(run.updatedAt);
  return {
    agentRun: {
      active,
      id: OPENCODE_AGENT_RUN_ID,
      provider: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      providerInterface: OPENCODE_AGENT_RUN_ID,
      providerStatus: run.observationError ? "observation_lost" : state,
      providerThreadId: threadId,
      providerTurnId: turnId,
      state,
      updatedAt
    },
    agentSession: {
      providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      thread: {
        id: threadId
      },
      transportId: OPENCODE_AGENT_RUN_ID,
      turn: {
        active,
        completedAt: text(run.finishedAt),
        error: text(run.error),
        id: turnId,
        phase: active && !run.observationError ? text(run.phase) : "",
        runState: state,
        startedAt: text(run.startedAt),
        state: turnState,
        status: run.observationError ? "observation_lost" : state,
        updatedAt
      }
    }
  };
}

function openCodeTurnSnapshot(turn = null, threadId = "") {
  const source = record(turn);
  const active = source.active === true;
  return active || text(source.id)
    ? {
        active,
        error: text(source.error),
        id: text(source.id),
        phase: active && !source.observationError ? text(source.phase) : "",
        startedAt: text(source.startedAt),
        state: text(source.state) || (active ? "active" : "completed"),
        status: source.observationError ? "observation_lost" : text(source.state) || (active ? "active" : "completed"),
        threadId: text(source.threadId || threadId),
        updatedAt: text(source.updatedAt)
      }
    : null;
}

function createOpenCodeTerminalController({
  agentDatabaseCommand = null,
  agentEnvCommand = null,
  agentPreviewCommand = null,
  agentSessionCommand = null,
  codexGitCommand = null,
  command = "opencode",
  createServerProcess = createOpenCodeServerProcess,
  env = process.env,
  getAssistantManager = () => null,
  listConnections = async () => [],
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  projectService,
  publishSessionChanged = async () => null,
  readCatalogCommand = readOpenCodeCatalog,
  readZenModelsCommand = readOpenCodeZenModelIds,
  recordGitActor = recordSessionGitCommandActor,
  resolveConnection = async () => null,
  verifyConnectionCommand = verifyOpenCodeApiKey
} = {}) {
  if (!projectService) {
    throw new TypeError("OpenCode terminal controllers require vibe64.project.");
  }
  const processes = new Map();
  const processStarts = new Map();
  const monitors = new Map();
  const turns = new Map();
  const temporaryConversations = new Map();
  const processExitProofs = new Map();
  const sessionEnvironments = new Map();
  let catalogRead = null;
  let catalogSnapshot = null;
  let closed = false;
  let sharedProcess = null;
  let sharedProcessStart = null;
  let sharedProcessStop = null;
  const progressPublishes = new Map();
  const progressPublishedAt = new Map();

  function reasoningSummaryInstruction(value = "") {
    const trimmed = String(value ?? "").trim().slice(0, OPENCODE_REASONING_SUMMARY_MAX_INPUT_CHARS);
    return [
      "Summarize the assistant's private reasoning below as ONE short present-tense sentence",
      "(at most 12 words) describing what it is doing or concluded.",
      "Reply with only that sentence and no quotation marks.",
      "",
      "Reasoning:",
      trimmed
    ].join("\n");
  }

  async function requestReasoningSummary(state, value = "") {
    const agent = getAssistantManager();
    if (!agent || !state.actorKnown) return "";
    const context = state.context;
    for (const previous of temporaryConversations.values()) {
      if (previous.reasoningSummary && previous !== state && previous.context.key === context.key) {
        await disposeReasoningSummary(previous);
      }
    }
    await cleanupReasoningSummary(context);
    const signal = AbortSignal.any([
      state.target.abortController.signal,
      state.abortController.signal,
      AbortSignal.timeout(OPENCODE_REASONING_SUMMARY_TIMEOUT_MS)
    ]);
    signal.throwIfAborted();
    const workflowEngineId = assistantRoutingFromMetadata(context.session.metadata)?.workflowEngineId || context.selection.engineId;
    const decision = await agent.resolveAssistantPurpose({ purpose: "conversation_summary", workflowEngineId }, context);
    if (!decision.available) return "";
    signal.throwIfAborted();
    const id = `reasoning_${randomUUID()}`;
    const root = path.join(context.runtime.stateRoot, "assistant-helpers", id);
    const helper = { selection: decision.effectiveSelection, connectionIdentity: decision.connectionIdentity,
      conversationId: "", runId: "", executionId: "",
      scope: { id, environment: {}, workdir: path.join(root, "workdir"), runtimeRoot: path.join(root, "runtime"),
        stableContext: "Return only a short progress summary of the supplied text. You have no tools or project access." } };
    const retain = () => context.runtime.store.writeAgentRunEvent(context.sessionId, OPENCODE_AGENT_RUN_ID, {
      event: { kind: "reasoning-helper" }, patch: { reasoningSummaryHelper: helper }
    });
    await retain();
    const options = { assistantSelection: helper.selection, vibe64User: context.vibe64User,
      expectedConnectionIdentity: helper.connectionIdentity, signal,
      async onEvent(event) {
        if (event.type === "thread") helper.conversationId = text(event.threadId);
        else if (event.type === "turn") helper.runId = text(event.turnId);
        else if (event.type === "helper-execution") helper.executionId = text(event.executionId);
        else return;
        await retain();
      } };
    let result;
    let failure;
    try {
      await mkdir(helper.scope.workdir, { recursive: true });
      await mkdir(helper.scope.runtimeRoot, { recursive: true });
      const executionProfile = await agent.resolveEphemeralExecutionProfile(helper.scope, {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY, workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.CONVERSATION_SUMMARY
      }, options);
      helper.executionProfile = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
      await retain();
      result = await agent.runEphemeralChatTurn(helper.scope, {
        executionProfile, prompt: reasoningSummaryInstruction(value), promptLabel: "Summarize progress"
      }, options);
      if (result?.ok !== true) throw new Error(result?.error || "The progress summary did not complete.");
    } catch (error) { failure = error; }
    try { await cleanupReasoningSummary(context); }
    catch (error) { if (failure && error !== failure) error.cause = failure; failure = error; }
    if (failure) throw failure;
    return text(result.text);
  }

  async function cleanupReasoningSummary(context) {
    const agent = getAssistantManager();
    if (!agent) return;
    const helper = (await context.runtime.store.readAgentRun(context.sessionId, OPENCODE_AGENT_RUN_ID))?.reasoningSummaryHelper;
    if (!helper) return;
    const root = path.join(context.runtime.stateRoot, "assistant-helpers", helper.scope.id);
    if (!/^reasoning_[a-f0-9-]+$/u.test(helper.scope.id) || helper.scope.workdir !== path.join(root, "workdir") ||
        helper.scope.runtimeRoot !== path.join(root, "runtime")) throw new Error("The progress summary has invalid cleanup paths.");
    const result = await agent.deleteEphemeralConversation(helper.scope, {
      conversationId: helper.conversationId, cleanupExecutionId: helper.executionId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
    }, { assistantSelection: helper.selection, vibe64User: context.vibe64User });
    if (result?.ok !== true) throw new Error(result?.error || "The progress summary could not be closed.");
    await context.runtime.store.writeAgentRunEvent(context.sessionId, OPENCODE_AGENT_RUN_ID, {
      event: { kind: "reasoning-helper-closed" }, patch: { reasoningSummaryHelper: null }
    });
    await rm(root, { recursive: true, force: true });
  }

  function disposeReasoningSummary(state) {
    if (state.disposal) return state.disposal;
    state.closed = true;
    state.abortController.abort();
    state.disposal = Promise.resolve().then(async () => {
      await state.completion;
      await cleanupReasoningSummary(state.context);
      state.entries.clear();
      temporaryConversations.delete(state.key);
    }).finally(() => { state.disposal = null; });
    return state.disposal;
  }

  function publishOpenCodeProgress(sessionId, summary) {
    const now = Date.now();
    const last = progressPublishedAt.get(sessionId) || 0;
    if (!progressPublishes.has(sessionId) && now - last >= OPENCODE_PROGRESS_PUBLISH_INTERVAL_MS) {
      progressPublishedAt.set(sessionId, now);
      void publishSessionChanged(sessionId, {
        payload: { assistantProgress: summary },
        reason: "opencode-server-progress"
      }).catch(() => {});
      return;
    }
    if (progressPublishes.has(sessionId)) {
      progressPublishes.get(sessionId).summary = summary;
      return;
    }
    const timer = setTimeout(() => {
      const pending = progressPublishes.get(sessionId);
      progressPublishes.delete(sessionId);
      if (pending) {
        progressPublishedAt.set(sessionId, Date.now());
        void publishSessionChanged(sessionId, {
          payload: { assistantProgress: pending.summary },
          reason: "opencode-server-progress"
        }).catch(() => {});
      }
    }, OPENCODE_PROGRESS_PUBLISH_INTERVAL_MS - (now - last));
    progressPublishes.set(sessionId, { summary, timer });
  }

  function dropOpenCodeProgress(sessionId) {
    const pending = progressPublishes.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      progressPublishes.delete(sessionId);
    }
    progressPublishedAt.delete(sessionId);
  }

  function promptContext(conversationKind = "main", assistantScope = null) {
    if (assistantScope) {
      return {
        scope: "ephemeral",
        stableContext: assistantScope.stableContext
      };
    }
    return {
      conversationKind,
      scope: "session",
      session: {
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedGit: Boolean(codexGitCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    };
  }

  async function contextFor(sessionId = "", options = {}) {
    const id = safeSessionId(sessionId);
    const assistantScope = options.assistantScope || null;
    if (assistantScope) {
      if (text(assistantScope.id) !== id) {
        throw openCodeError(
          "vibe64_ephemeral_scope_mismatch",
          "OpenCode ephemeral conversation scope does not match its provider binding."
        );
      }
      const selection = defineVibe64AssistantSelection(options.assistantSelection || {});
      if (selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
        throw openCodeError(
          "vibe64_opencode_selection_required",
          "The ephemeral conversation does not have an OpenCode selection."
        );
      }
      return {
        assistantScope,
        key: `ephemeral\0${id}`,
        runtime: {
          projectContextRoot: assistantScope.workdir,
          stateRoot: assistantScope.runtimeRoot
        },
        session: null,
        sessionId: id,
        selection,
        workdir: path.resolve(assistantScope.workdir)
      };
    }
    const runtime = options.runtime || await projectService.createRuntime({
      inspectSource: false
    });
    const session = options.session?.sessionId === id
      ? options.session
      : await runtime.getSession(id, { inspectSource: false });
    if (!session) {
      throw openCodeError("vibe64_session_not_found", "Vibe64 session is not available.", {
        sessionId: id
      }, 404);
    }
    const workdir = terminalSessionSourceRoot(session);
    if (!workdir || !text(session.sessionRoot) || !text(runtime.stateRoot)) {
      throw openCodeError(
        "vibe64_opencode_session_roots_missing",
        "OpenCode cannot start until the session workspace and state roots are ready.",
        { sessionId: id }
      );
    }
    return {
      key: `${path.resolve(runtime.stateRoot)}\0${id}`,
      runtime,
      session,
      sessionId: id,
      selection: openCodeSelection(session),
      workdir: path.resolve(workdir)
    };
  }

  function storedUpstreamSessionId(context) {
    return text(context.session?.metadata?.opencode_conversation_id) ||
      text(processes.get(context.key)?.upstreamSessionId);
  }

  function sharedRoots() {
    const root = path.join(codexAppServerRuntimeBaseDir({ env }), "opencode");
    const serviceDataRoot = text(projectService.currentServiceDataRoot());
    if (!serviceDataRoot) {
      throw new TypeError("OpenCode requires a persistent service data root.");
    }
    return {
      cacheRoot: path.join(root, "cache"),
      dbPath: path.join(serviceDataRoot, "opencode", "opencode.db"),
      registryPath: path.join(root, "session-environments.json"),
      root,
      workdir: path.join(root, "workspace")
    };
  }

  async function writeSessionEnvironmentRegistry() {
    const { registryPath } = sharedRoots();
    await mkdir(path.dirname(registryPath), { mode: 0o700, recursive: true });
    const temporaryPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
    const temporaryEnvironments = [...temporaryConversations.values()]
      .filter((entry) => entry.promptContext && text(entry.conversationId))
      .map((entry) => {
        const environment = sessionEnvironments.get(entry.target?.key);
        return environment
          ? {
              ...environment,
              promptContext: entry.promptContext,
              upstreamSessionId: entry.conversationId
            }
          : null;
      })
      .filter(Boolean);
    await writeFile(temporaryPath, `${JSON.stringify({
      sessions: [
        ...sessionEnvironments.values(),
        ...temporaryEnvironments
      ]
    })}\n`, {
      mode: 0o600
    });
    await rename(temporaryPath, registryPath);
  }

  async function configuredConnections(context = {}, options = {}, selected = null) {
    const listed = await listConnections({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      vibe64User: options.vibe64User || null
    });
    const providerIds = new Set((Array.isArray(listed) ? listed : [])
      .map((connection) => text(connection?.modelProviderId || connection?.id))
      .filter(Boolean));
    if (selected?.modelProviderId) {
      providerIds.add(selected.modelProviderId);
    }
    const resolved = await Promise.all([...providerIds].map(async (modelProviderId) => {
      try {
        return requireOpenCodeConnection(await resolveConnection({
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          modelProviderId,
          sessionId: context.sessionId,
          vibe64User: options.vibe64User || null
        }), modelProviderId);
      } catch (error) {
        if (modelProviderId === selected?.modelProviderId) {
          throw error;
        }
        return null;
      }
    }));
    return resolved.filter(Boolean);
  }

  function openCodeServerForDirectory(server = {}, workdir = "") {
    return Object.freeze({
      ...server,
      client: typeof server.client?.forDirectory === "function"
        ? server.client.forDirectory(workdir)
        : server.client
    });
  }

  function boundedHelperTarget(target = {}, executionProfile = null) {
    if (!executionProfile) {
      return target;
    }
    const workdir = sharedRoots().workdir;
    return {
      ...target,
      server: openCodeServerForDirectory(target.server, workdir),
      workdir
    };
  }

  async function stopSharedProcess(reason = "opencode-last-session-closed") {
    if (sharedProcessStop) {
      return sharedProcessStop;
    }
    const target = sharedProcess;
    if (!target) {
      return { exited: true, reason };
    }
    vibe64SessionDebugLog("server.opencode.shared-process.stop", {
      reason, sessions: processes.size, startingSessions: processStarts.size
    });
    const stopping = (async () => {
      const proof = await target.server.stop();
      if (proof?.exited !== true) {
        throw openCodeError("vibe64_opencode_stop_unverified", "OpenCode process exit could not be verified.", {}, 503);
      }
      if (sharedProcess === target) sharedProcess = null;
      return proof;
    })();
    sharedProcessStop = stopping;
    try {
      return await stopping;
    } finally {
      if (sharedProcessStop === stopping) sharedProcessStop = null;
    }
  }

  async function ensureSharedProcess(context = {}, options = {}, selected = null, shimDirs = []) {
    await sharedProcessStop;
    if (sharedProcess) {
      const currentConnection = sharedProcess.connections.get(selected?.modelProviderId);
      if (
        !selected ||
        (
          currentConnection?.canonicalUrl === selected.canonicalUrl &&
          currentConnection?.fingerprint === selected.fingerprint &&
          currentConnection?.endpointCode === selected.endpointCode
        )
      ) {
        try {
          await sharedProcess.server.client.health({ signal: AbortSignal.timeout(1_000) });
          return sharedProcess;
        } catch {
          await stopSharedProcess("opencode-health-check-failed");
        }
      } else {
        await stopSharedProcess("opencode-connection-changed");
      }
    }
    if (sharedProcessStart) {
      return sharedProcessStart;
    }
    sharedProcessStart = Promise.resolve().then(async () => {
      const connections = await configuredConnections(context, options, selected);
      const roots = sharedRoots();
      await writeSessionEnvironmentRegistry();
      const server = await createServerProcess({
        cacheRoot: roots.cacheRoot,
        command,
        dbPath: roots.dbPath,
        env,
        execution: {
          label: "OpenCode assistant",
          operationId: "opencode-server",
          ownerId: "opencode"
        },
        privateRoot: path.join(roots.root, `private-${randomUUID()}`),
        hostContextResolver: vibe64HostContextResolverPath(),
        providerConnections: connections,
        sessionEnvironmentRegistry: roots.registryPath,
        shimDirs,
        workdir: roots.workdir
      });
      sharedProcess = {
        connections: new Map(connections.map((connection) => [
          connection.modelProviderId,
          {
            canonicalUrl: connection.canonicalUrl,
            endpointCode: connection.endpointCode,
            fingerprint: connection.fingerprint
          }
        ])),
        server
      };
      for (const target of processes.values()) {
        target.server = openCodeServerForDirectory(server, target.workdir);
        target.upstream = null;
        target.upstreamSelection = null;
      }
      return sharedProcess;
    });
    try {
      return await sharedProcessStart;
    } finally {
      sharedProcessStart = null;
    }
  }

  async function readCatalog() {
    if (catalogSnapshot && Date.now() - catalogSnapshot.readAt < OPENCODE_CATALOG_CACHE_MS) {
      return catalogSnapshot;
    }
    if (catalogRead) {
      return catalogRead;
    }
    catalogRead = Promise.resolve().then(async () => {
      const roots = sharedRoots();
      // The managed process changes model defaults and output limits. Always
      // fingerprint the same credential-free catalogue used during connection setup.
      const [catalog, zenModelIds] = await Promise.all([
        readCatalogCommand({
          cacheRoot: roots.cacheRoot,
          command,
          createServerProcess,
          env,
          privateRoot: path.join(roots.root, `catalog-${randomUUID()}`),
          workdir: roots.workdir
        }),
        readZenModelsCommand()
      ]);
      catalogSnapshot = {
        agents: catalog.agents,
        providers: catalog.providers,
        readAt: Date.now(),
        zenModelIds
      };
      return catalogSnapshot;
    });
    try {
      return await catalogRead;
    } finally {
      catalogRead = null;
    }
  }

  async function capabilities(input = {}, options = {}) {
    if (text(input.configuredOnly).toLowerCase() === "true") {
      return openCodeConfiguredAssistantCapabilities({
        connections: await listConnections({
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          vibe64User: options.vibe64User || null
        })
      });
    }
    const [catalog, connections] = await Promise.all([
      readCatalog(),
      listConnections({
        engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        vibe64User: options.vibe64User || null
      })
    ]);
    return openCodeAssistantCapabilities({
      agents: catalog.agents,
      connections,
      input,
      providers: catalog.providers,
      zenModelIds: catalog.zenModelIds
    });
  }

  async function verifyConnection(input = {}) {
    if (text(input.engineId) !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
      throw openCodeError(
        "vibe64_assistant_engine_invalid",
        "OpenCode connection verification requires the OpenCode engine.",
        { engineId: text(input.engineId) },
        400
      );
    }
    const modelProviderId = text(input.modelProviderId);
    const modelId = text(input.modelId);
    const catalog = await readCatalog();
    const provider = (Array.isArray(catalog.providers?.all) ? catalog.providers.all : [])
      .find((candidate) => text(candidate?.id) === modelProviderId);
    const providerModels = record(provider?.models);
    const model = Object.hasOwn(providerModels, modelId) ? providerModels[modelId] : null;
    const currentZenModelIds = new Set(Array.isArray(catalog.zenModelIds)
      ? catalog.zenModelIds
      : []);
    const currentZenModel = modelProviderId === "opencode" && currentZenModelIds.has(modelId);
    if (
      !provider ||
      (modelProviderId === "opencode"
        ? !currentZenModel
        : !model || text(model.status) === "deprecated")
    ) {
      throw openCodeError(
        "vibe64_assistant_catalog_stale",
        "The selected OpenCode provider model is no longer available. Refresh the provider catalogue and try again.",
        { modelId, modelProviderId },
        409
      );
    }
    const roots = sharedRoots();
    return verifyConnectionCommand({
      apiKey: String(input.apiKey || ""),
      cacheRoot: roots.cacheRoot,
      command,
      env,
      modelId,
      modelProviderId,
      privateRoot: path.join(roots.root, `verify-${randomUUID()}`),
      workdir: roots.workdir
    });
  }

  function renewalSession(context = {}) {
    return Boolean(text(context.session?.metadata?.renewed_from));
  }

  async function writeSessionMetadata(context = {}, values = {}) {
    const store = context.runtime?.store;
    const entries = Object.entries(values)
      .filter(([name, value]) => text(name) && value !== undefined && value !== null);
    if (!entries.length) {
      return;
    }
    const internal = renewalSession(context) &&
      typeof store?.writeMetadataValueForRenewal === "function";
    const write = internal
      ? store.writeMetadataValueForRenewal.bind(store)
      : store?.writeMetadataValue?.bind(store);
    const mutate = internal
      ? store?.mutateSessionForRenewal?.bind(store)
      : store?.mutateSession?.bind(store);
    if (typeof write !== "function") {
      throw new TypeError("OpenCode requires writable Vibe64 session metadata.");
    }
    const operation = async () => {
      await Promise.all(entries.map(([name, value]) => (
        write(context.sessionId, name, String(value))
      )));
    };
    if (typeof mutate === "function") {
      await mutate(context.sessionId, operation);
    } else {
      await operation();
    }
  }

  async function managedCommandEnvironment(context = {}) {
    if (context.assistantScope) {
      return {
        env: context.assistantScope.environment || {},
        shimDirs: []
      };
    }
    if (!codexGitCommand) {
      return { env: {}, shimDirs: [] };
    }
    const project = typeof projectService?.readCurrentProject === "function"
      ? await projectService.readCurrentProject()
      : projectService?.selectedProject || {};
    const prepared = await prepareCommandEnvironment({
      agentDatabaseCommand,
      agentEnvCommand,
      agentPreviewCommand,
      agentSessionCommand,
      env,
      gitCommand: codexGitCommand,
      project,
      runtime: context.runtime,
      sessionId: context.sessionId,
      worktreePath: context.workdir
    });
    if (prepared?.ok !== true) {
      throw openCodeError(
        "vibe64_opencode_command_boundary_unavailable",
        "Vibe64 could not prepare session-scoped Git commands for OpenCode.",
        {},
        503
      );
    }
    return {
      env: record(prepared.env),
      shimDirs: prepared.shimDirs
    };
  }

  async function stopProcessRecord(target = null, { retainSharedProcess = false } = {}) {
    if (!target) {
      return { exited: true };
    }
    await closeTerminalSessionsForNamespace(
      opencodeTerminalNamespace(target.sessionId)
    );
    for (const entry of temporaryConversations.values()) {
      if (entry.reasoningSummary && entry.target?.abortController === target.abortController) {
        await disposeReasoningSummary(entry);
      }
    }
    const activeThreads = new Set();
    if (turns.get(target.key)?.active) activeThreads.add(target.upstreamSessionId);
    for (const entry of temporaryConversations.values()) {
      if (entry.active && entry.target?.abortController === target.abortController) {
        activeThreads.add(entry.conversationId);
      }
    }
    for (const threadId of activeThreads) await stopUnobservedOpenCodeSession(target, threadId);
    target.abortController.abort();
    turns.get(target.key)?.admission?.resolve();
    await monitors.get(target.key)?.catch(() => null);
    await Promise.all([...temporaryConversations.values()]
      .filter((entry) => entry.target?.abortController === target.abortController)
      .map((entry) => entry.completion?.catch(() => null)));
    if (processes.get(target.key) === target) {
      processes.delete(target.key);
      sessionEnvironments.delete(target.key);
      await writeSessionEnvironmentRegistry();
    }
    const proof = !retainSharedProcess && processes.size === 0 && processStarts.size === 0
      ? await stopSharedProcess()
      : {
          exited: true,
          sharedProcessRetained: true
        };
    if (target.sessionId) {
      processExitProofs.set(target.sessionId, proof);
    }
    return proof;
  }

  async function ensureProcess(context = {}, options = {}) {
    requireCompletedNativeConversationReplacement(context.session);
    if (closed) {
      throw openCodeError("vibe64_opencode_closed", "The OpenCode bridge is shutting down.", {}, 503);
    }
    const connection = requireOpenCodeConnection(await resolveConnection({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      modelProviderId: context.selection.modelProviderId,
      sessionId: context.sessionId,
      vibe64User: options.vibe64User || null
    }), context.selection.modelProviderId);
    const pending = processStarts.get(context.key);
    if (pending) {
      return pending;
    }
    const projectContextRoot = path.resolve(context.runtime.projectContextRoot);
    const start = Promise.resolve().then(async () => {
      let economyModelId = "";
      if (!context.assistantScope && getAssistantManager()) {
        const workflowEngineId = assistantRoutingFromMetadata(context.session.metadata)?.workflowEngineId || context.selection.engineId;
        const economy = await getAssistantManager().resolveAssistantPurpose({ purpose: "economy", workflowEngineId }, {
          ...context, vibe64User: options.vibe64User || null
        }).catch(() => null);
        if (economy?.available && economy.effectiveSelection.engineId === VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE &&
            economy.effectiveSelection.modelProviderId === context.selection.modelProviderId) {
          economyModelId = economy.effectiveSelection.modelId;
        }
      }
      const commands = await managedCommandEnvironment(context);
      sessionEnvironments.set(context.key, {
        economyModelId,
        modelProviderId: context.selection.modelProviderId,
        env: commands.env,
        pathEntries: commands.shimDirs,
        projectContextRoot: path.resolve(context.runtime.projectContextRoot),
        promptContext: promptContext("main", context.assistantScope),
        sessionId: context.sessionId,
        upstreamSessionId: storedUpstreamSessionId(context),
        workdir: context.workdir
      });
      await writeSessionEnvironmentRegistry();
      const shared = await ensureSharedProcess(
        context,
        options,
        connection,
        [genesisCommandShimDirectory()]
      );
      const current = processes.get(context.key);
      const nativeId = storedUpstreamSessionId(context);
      if (current && current.upstreamSessionId !== nativeId) {
        current.upstreamSessionId = nativeId;
        current.upstream = null;
      }
      if (
        current && !current.abortController.signal.aborted &&
        current.canonicalUrl === connection.canonicalUrl &&
        current.connectionFingerprint === connection.fingerprint &&
        current.endpointCode === connection.endpointCode &&
        current.modelProviderId === connection.modelProviderId &&
        current.projectContextRoot === projectContextRoot &&
        current.workdir === context.workdir &&
        text(current.selection?.catalogRevision) === text(context.selection.catalogRevision) &&
        sameOpenCodeSelection(current.selection, context.selection)
      ) {
        current.economyModelId = economyModelId;
        current.server = openCodeServerForDirectory(shared.server, context.workdir);
        return current;
      }
      const server = openCodeServerForDirectory(shared.server, context.workdir);
      const created = (current && !current.abortController.signal.aborted ? current : null) || {
        abortController: new AbortController(),
        key: context.key,
        sessionId: context.sessionId,
        upstreamSessionId: nativeId
      };
      Object.assign(created, {
        economyModelId,
        canonicalUrl: connection.canonicalUrl,
        connectionFingerprint: connection.fingerprint,
        endpointCode: connection.endpointCode,
        modelProviderId: connection.modelProviderId,
        projectContextRoot,
        selection: context.selection,
        server,
        workdir: context.workdir
      });
      processes.set(context.key, created);
      return created;
    }).catch(async (error) => {
      if (processStarts.get(context.key) === start) {
        processStarts.delete(context.key);
      }
      if (!processes.has(context.key)) {
        sessionEnvironments.delete(context.key);
        await writeSessionEnvironmentRegistry().catch(() => null);
        if (processes.size === 0 && processStarts.size === 0) {
          await stopSharedProcess("opencode-session-start-failed").catch(() => null);
        }
      }
      throw error;
    });
    processStarts.set(context.key, start);
    try {
      return await start;
    } finally {
      if (processStarts.get(context.key) === start) {
        processStarts.delete(context.key);
      }
    }
  }

  async function ensureUpstreamSession(context = {}, options = {}) {
    const target = await ensureProcess(context, options);
    if (target.upstreamStart) {
      return target.upstreamStart;
    }
    const start = Promise.resolve().then(async () => {
      let upstream = (
        target.upstream &&
        sameOpenCodeSelection(target.upstreamSelection, context.selection)
      ) ? target.upstream : null;
      if (!upstream && target.upstreamSessionId) {
        upstream = await target.server.client.readSession(target.upstreamSessionId);
        await target.server.client.switchModel(target.upstreamSessionId, openCodeModel(context.selection));
        await target.server.client.switchAgent(target.upstreamSessionId, context.selection.agentId);
      } else if (!upstream) {
        upstream = await target.server.client.createSession({
          agent: context.selection.agentId,
          location: { directory: context.workdir },
          model: openCodeModel(context.selection)
        });
      }
      const nativeId = text(upstream?.id);
      if (!nativeId) {
        throw openCodeError("vibe64_opencode_session_id_invalid", "OpenCode did not return a native conversation ID.");
      }
      if (
        text(context.session?.metadata?.opencode_conversation_id) !== nativeId ||
        text(context.session?.metadata?.agent_identity_conversation_id) !== nativeId ||
        text(context.session?.metadata?.agent_identity_provider) !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE ||
        text(context.session?.metadata?.agent_transport_id) !== "opencode_server"
      ) {
        const capturedAt = new Date().toISOString();
        await writeSessionMetadata(context, {
          opencode_conversation_id: nativeId,
          agent_identity_captured_at: capturedAt,
          agent_identity_conversation_id: nativeId,
          agent_identity_provider: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          agent_identity_resume_strategy: "provider-native",
          agent_identity_status: "ready",
          agent_identity_updated_at: capturedAt,
          agent_identity_workdir: context.workdir,
          agent_transport_id: "opencode_server",
          agent_transport_kind: "loopback-http"
        });
        context.session.metadata.opencode_conversation_id = nativeId;
      }
      target.upstreamSessionId = nativeId;
      target.upstream = upstream;
      target.upstreamSelection = { ...context.selection };
      sessionEnvironments.get(context.key).upstreamSessionId = nativeId;
      await writeSessionEnvironmentRegistry();
      return target;
    });
    target.upstreamStart = start;
    try {
      return await start;
    } finally {
      if (target.upstreamStart === start) {
        delete target.upstreamStart;
      }
    }
  }

  function terminalSnapshot(sessionId = "", terminalSessionId = "") {
    const id = text(terminalSessionId);
    return id
      ? readTerminalSession(id, {
          namespace: opencodeTerminalNamespace(sessionId),
          outputLimit: OPENCODE_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
        })
      : null;
  }

  async function startTerminal(sessionId = "", input = {}, options = {}) {
    void input;
    return vibe64Result(async () => {
      const context = await contextFor(sessionId, options);
      const target = await ensureUpstreamSession(context, options);
      const existing = terminalSnapshot(context.sessionId, target.terminalSessionId);
      if (existing?.ok === true && existing.status !== "exited") {
        return existing;
      }
      const terminal = await target.server.startAttachedTerminal({
        metadata: {
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          sessionId: context.sessionId
        },
        namespace: opencodeTerminalNamespace(context.sessionId),
        session: context.session,
        upstreamSessionId: target.upstreamSessionId,
        workdir: context.workdir
      });
      if (terminal?.ok === true && text(terminal.id)) {
        target.terminalSessionId = text(terminal.id);
      }
      return terminal;
    });
  }

  function readTerminal(sessionId = "", terminalSessionId = "") {
    return vibe64Result(async () => terminalSnapshot(sessionId, terminalSessionId));
  }

  async function closeTerminal(sessionId = "", terminalSessionId = "") {
    return vibe64Result(async () => {
      const id = text(terminalSessionId);
      const result = await closeTerminalSession(id, {
        namespace: opencodeTerminalNamespace(sessionId)
      });
      for (const target of processes.values()) {
        if (target.sessionId === sessionId && target.terminalSessionId === id) {
          target.terminalSessionId = "";
        }
      }
      return result;
    });
  }

  function subscribeTerminal(sessionId = "", terminalSessionId = "", subscriber = null) {
    return vibe64Result(async () => subscribeTerminalSession(terminalSessionId, subscriber, {
      namespace: opencodeTerminalNamespace(sessionId),
      outputLimit: OPENCODE_TERMINAL_OUTPUT_SNAPSHOT_MAX_LENGTH
    }));
  }

  function resizeTerminal(sessionId = "", terminalSessionId = "", size = {}) {
    return resizeTerminalSession(terminalSessionId, size, {
      namespace: opencodeTerminalNamespace(sessionId)
    });
  }

  async function writeTerminal(sessionId = "", terminalSessionId = "", data = "", input = {}, options = {}) {
    const namespace = opencodeTerminalNamespace(sessionId);
    const admissionFailure = terminalNamespaceAdmissionFailure(namespace);
    if (admissionFailure) {
      return admissionFailure;
    }
    if (input?.trackGitActor) {
      const context = await contextFor(sessionId, options);
      const target = processes.get(context.key);
      const actor = await recordGitActor({
        env,
        overwrite: false,
        reason: "opencode-terminal-input",
        runtime: context.runtime,
        session: context.session,
        sourceRoot: terminalSessionSourceRoot(context.session),
        threadId: target?.upstreamSessionId || storedUpstreamSessionId(context),
        vibe64User: options.vibe64User || null,
        workdir: context.workdir
      });
      if (actor?.ok === false) {
        return actor;
      }
    }
    return writeTerminalSessionText(terminalSessionId, data, { namespace });
  }

  async function publishConversationTurn(context = {}, turn = null, reason = "") {
    if (!turn) {
      return;
    }
    await publishSessionChanged(context.sessionId, {
      payload: {
        conversationStream: context.runtime.store.readConversationStream(context.sessionId),
        conversationLogPatch: {
          turn,
          type: "upsert-turn"
        }
      },
      reason
    });
  }

  async function writeReasoningMessage(context, entry, headline) {
    if (entry.writing) return entry.writing;
    if (entry.written || !headline) return;
    entry.writing = Promise.resolve().then(async () => {
      const turn = await context.runtime.store.writeConversationThinkingMessage(context.sessionId, {
        at: entry.at,
        messageId: entry.id,
        text: headline
      });
      entry.written = true;
      if (turn) await publishConversationTurn(context, turn, "opencode-server-reasoning");
    }).finally(() => { entry.writing = null; });
    return entry.writing;
  }

  async function projectReasoning(context, message, { complete = false, flush = false } = {}) {
    const state = turns.get(context.key)?.reasoning;
    if (!state || state.closed) return;
    for (const part of (message.content || []).filter((part) => part.type === "reasoning" && text(part.text))) {
      const id = conversationMessageId(message.id, part.id, "reasoning");
      let entry = state.entries.get(id);
      if (!entry) {
        entry = { id, at: message.time?.created ? new Date(message.time.created).toISOString() : "", written: false, queued: false };
        state.entries.set(id, entry);
      }
      entry.value = part.text;
      if (entry.written) continue;
      if (flush) {
        await writeReasoningMessage(context, entry, openCodeReasoningHeadline(entry.value));
        continue;
      }
      const partialHeadline = openCodeReasoningHeadline(entry.value);
      if (entry.queued || !(complete || part.time?.end || /[.!?…]$/u.test(partialHeadline))) continue;
      entry.queued = true;
      state.completion = state.completion.then(async () => {
        if (state.closed || entry.written) return;
        let headline = "";
        if (text(entry.value).length >= OPENCODE_REASONING_SUMMARY_MIN_INPUT_CHARS) {
          try {
            headline = openCodeReasoningHeadline(await requestReasoningSummary(state, entry.value));
          } catch (error) {
            if (!state.abortController.signal.aborted) {
              vibe64SessionDebugLog("server.opencode.reasoning-summary.error", {
                error: vibe64SessionDebugError(error), sessionId: context.sessionId
              });
            }
          }
        }
        if (!state.closed) {
          await writeReasoningMessage(context, entry, headline || openCodeReasoningHeadline(entry.value));
        }
      }).catch((error) => {
        vibe64SessionDebugLog("server.opencode.reasoning-summary.error", {
          error: vibe64SessionDebugError(error), sessionId: context.sessionId
        });
      });
    }
  }

  async function writeConversationProjection(context = {}, messages = null, {
    inputMessageId = "",
    streaming = false
  } = {}) {
    let failure = "";
    let providerApiFailure = false;
    const rows = (inputMessageId
      ? openCodeRowsForInput(messages, inputMessageId)
      : openCodeMessageRows(messages)).filter((message) => message?.type === "assistant");
    for (const [index, message] of rows.entries()) {
      failure ||= openCodeMessageError(message);
      providerApiFailure ||= openCodeProviderApiFailure(message.error);
      if (message.summary === true) continue;
      const assistantText = assistantMessageText(message);
      const messageId = assistantText ? conversationMessageId(message.id, "assistant") : "";
      const inFlight = streaming && index === rows.length - 1;
      await projectReasoning(context, message, {
        complete: !inFlight || Boolean(message.time?.completed || message.finish),
        flush: !streaming || Boolean(assistantText && !inFlight)
      });
      if (streaming && assistantText && !inFlight) {
        // A completed round persists as soon as the next one starts, so
        // superseded narration never evaporates from the transcript.
        const turn = await context.runtime.store.writeConversationAssistantMessage(context.sessionId, {
          messageId,
          text: assistantText
        });
        context.runtime.store.completeConversationStreamMessage(context.sessionId, messageId);
        await publishConversationTurn(context, turn, "opencode-server-assistant-message");
        continue;
      }
      if (streaming && assistantText && inFlight) {
        const conversationStream = context.runtime.store.updateConversationStream(context.sessionId, {
          turnId: inputMessageId,
          messageId,
          text: assistantText
        });
        if (conversationStream) {
          await publishSessionChanged(context.sessionId, {
            payload: { conversationStream },
            reason: "assistant-stream"
          });
        }
        continue;
      }
      if (assistantText && !streaming) {
        const turn = await context.runtime.store.writeConversationAssistantMessage(context.sessionId, {
          messageId,
          text: assistantText
        });
        context.runtime.store.completeConversationStreamMessage(context.sessionId, messageId);
        await publishConversationTurn(context, turn, "opencode-server-assistant-message");
      }
    }
    return { failure, providerApiFailure };
  }

  async function writeOpenCodeFailureNotice(context = {}, turn = {}, {
    message = "",
    reason = "opencode-provider-failure"
  } = {}) {
    if (typeof context.runtime.store?.writeConversationSystemMessage !== "function") {
      return null;
    }
    const written = await context.runtime.store.writeConversationSystemMessage(context.sessionId, {
      messageId: `${reason}-${fingerprint(
        context.sessionId,
        turn.threadId,
        turn.id,
        turn.startedAt
      )}`,
      text: message
    });
    await publishConversationTurn(context, written, reason);
    return written;
  }

  async function writeRun(context = {}, turn = {}, state = VIBE64_AGENT_RUN_STATE.ACTIVE, error = "") {
    if (typeof context.runtime.store?.writeAgentRunEvent !== "function") {
      return null;
    }
    if (!vibe64AgentRunStateIsActive(state) && turn.id && !context.assistantScope) {
      await checkpointSessionTurn({
        projectService, runtime: context.runtime, session: context.session, sessionId: context.sessionId,
        outerTurnId: `opencode:${turn.threadId}:${turn.id}`,
        outcome: ["completed", "interrupted", "cancelled"].includes(state) ? state : "failed",
        timestamp: turn.updatedAt || new Date().toISOString(), publishSessionChanged
      });
    }
    let written = null;
    const write = () => context.runtime.store.writeAgentRunEvent(
      context.sessionId,
      OPENCODE_AGENT_RUN_ID,
      {
        event: {
          kind: `opencode-${state}`,
          message: error,
          state
        },
        patch: {
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          ...(Object.hasOwn(turn, "submittedBy") ? { submittedBy: turn.submittedBy } : {}),
          error,
          observationError: text(turn.observationError),
          phase: vibe64AgentRunStateIsActive(state) && !turn.observationError ? text(turn.phase) : "",
          model: context.selection.modelId,
          modelProviderId: context.selection.modelProviderId,
          ...(vibe64AgentRunStateIsActive(state)
            ? { finishedAt: "", startedAt: text(turn.startedAt) }
            : { finishedAt: text(turn.updatedAt) }),
          state,
          threadId: text(turn.threadId),
          turnId: text(turn.id),
          updatedAt: text(turn.updatedAt)
        }
      }
    ).then((run) => {
      written = run;
      return run;
    });
    const updatedSession = (
      typeof context.runtime.store.mutateSession === "function" &&
      typeof context.runtime.getSession === "function"
    )
      ? await context.runtime.store.mutateSession(context.sessionId, async () => {
          await write();
          return context.runtime.getSession(context.sessionId, { inspectSource: false });
        })
      : (await write(), context.session);
    await publishSessionChanged(context.sessionId, {
      payload: {
        ...(!vibe64AgentRunStateIsActive(state)
          ? { conversationStream: context.runtime.store.clearConversationStream(context.sessionId) }
          : {}),
        ...openCodeRunRealtimePayload(written || {
          active: vibe64AgentRunStateIsActive(state),
          error,
          id: OPENCODE_AGENT_RUN_ID,
          state,
          threadId: text(turn.threadId),
          turnId: text(turn.id),
          updatedAt: new Date().toISOString()
        })
      },
      reason: vibe64AgentRunStateIsActive(state)
        ? "opencode-server-turn-active"
        : "opencode-server-turn-idle",
      session: updatedSession
    });
    return written;
  }

  async function consumeEvents(target = {}, context = {}, turn = null, {
    onEvent = null,
    onError = null,
    onReady = null,
    publish = true,
    signal
  } = {}) {
    try {
      for await (const event of target.server.client.events(target.upstreamSessionId, {
        onReady,
        signal
      })) {
        signal?.throwIfAborted();
        const summary = eventSummary(event);
        const current = !turn || Number(summary.at) >= Number(turn.eventStartedAt);
        if (
          current && summary.type === "session.error" &&
          text(event.data?.properties?.sessionID) === target.upstreamSessionId &&
          typeof onError === "function"
        ) {
          const failure = record(event.data?.properties?.error);
          onError(Object.assign(new Error(openCodeMessageError({ error: failure }) || "OpenCode turn failed."), {
            name: text(failure.name) || "Error"
          }));
        }
        if (summary.type && current && typeof onEvent === "function") {
          await onEvent({
            ...summary,
            threadId: target.upstreamSessionId,
            turnId: turns.get(context.key)?.id || ""
          });
        }
        if (summary.type && current && publish) {
          publishOpenCodeProgress(context.sessionId, summary);
        }
      }
    } catch (error) {
      dropOpenCodeProgress(context.sessionId);
      throw error;
    }
    dropOpenCodeProgress(context.sessionId);
    throw openCodeError("vibe64_opencode_observation_lost", "OpenCode's event connection ended before observation was closed.", {}, 503);
  }

  async function stopUnobservedOpenCodeSession(target, threadId) {
    const signal = AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS);
    try {
      const confirmed = await target.server.client.interrupt(threadId, { signal });
      const status = await target.server.client.sessionStatus(threadId, { signal });
      if (confirmed !== true || status?.type !== "idle") {
        throw new Error("OpenCode did not confirm that the session stopped.");
      }
    } catch (error) {
      // The process owns the final stop proof when its control channel cannot.
      // Stop this exact server, even if another connection has since replaced it.
      const server = target.server;
      const proof = sharedProcess?.server.stop === server.stop
        ? await stopSharedProcess("opencode-observation-lost")
        : await server.stop();
      if (proof?.exited !== true) {
        throw new Error("OpenCode observation was lost and process exit could not be verified.", { cause: error });
      }
      for (const affected of processes.values()) {
        if (affected.server.stop === server.stop) {
          affected.abortController.abort(new Error("OpenCode's shared service was stopped after observation failed. Send a message to continue."));
        }
      }
    }
  }

  function beginMonitor(target = {}, context = {}, admitted = {}, options = {}) {
    target = { ...target };
    const existing = monitors.get(context.key);
    if (existing) {
      return existing;
    }
    const previous = context.session?.agentRuns?.find((run) => run.id === OPENCODE_AGENT_RUN_ID && run.turnId === admitted.id);
    const route = JSON.parse(context.session?.metadata?.assistant_routing_request || "null");
    const routed = route && [route.messageId, route.reviewMessageId].filter(Boolean).some((id) => upstreamMessageId(id) === admitted.id);
    const actorKnown = !admitted.restored || Object.hasOwn(previous || {}, "submittedBy") || routed;
    const actor = Object.hasOwn(previous || {}, "submittedBy") ? previous.submittedBy : routed ? route.submittedBy : options.vibe64User;
    const submittedBy = actor ? Object.fromEntries(["id", "username", "role"].filter((key) => actor[key] !== undefined)
      .map((key) => [key, actor[key]])) : null;
    const eventStartedAt = Number(admitted.eventStartedAt) || Date.now();
    const startedAt = text(admitted.startedAt) || new Date(eventStartedAt).toISOString();
    const turn = {
      abortController: new AbortController(),
      admission: options.admission,
      active: true,
      error: "",
      eventStartedAt,
      id: text(admitted.id),
      inputMessageId: text(admitted.id),
      startedAt,
      state: options.admission ? VIBE64_AGENT_RUN_STATE.STARTING : VIBE64_AGENT_RUN_STATE.ACTIVE,
      ...(actorKnown ? { submittedBy } : {}),
      threadId: target.upstreamSessionId,
      updatedAt: startedAt
    };
    const reasoning = {
      abortController: new AbortController(),
      actorKnown,
      closed: false,
      completion: Promise.resolve(),
      context: { ...context, vibe64User: submittedBy },
      entries: new Map(),
      key: `${context.key}\0reasoning:${turn.id}`,
      reasoningSummary: true,
      target
    };
    turn.reasoning = reasoning;
    temporaryConversations.set(reasoning.key, reasoning);
    turns.set(context.key, turn);
    const signal = AbortSignal.any([target.abortController.signal, turn.abortController.signal]);
    const monitor = Promise.resolve().then(async () => {
      const eventAbort = new AbortController();
      let eventFailure = null;
      const events = consumeEvents(target, context, turn, {
        onEvent: options.onEvent,
        onError: (error) => { eventFailure = error; },
        onReady: options.eventReady?.resolve,
        signal: AbortSignal.any([signal, eventAbort.signal])
      }).catch((error) => {
        options.eventReady?.reject(error);
        if (!eventAbort.signal.aborted && !signal.aborted) {
          eventFailure = error;
          turn.abortController.abort(error);
        }
      });
      let finalState = VIBE64_AGENT_RUN_STATE.COMPLETED;
      let failure = "";
      let credentialFailure = false;
      let providerApiFailure = false;
      try {
        await turn.admission?.promise;
        signal.throwIfAborted();
        turn.state = VIBE64_AGENT_RUN_STATE.ACTIVE;
        await writeRun(context, turn, VIBE64_AGENT_RUN_STATE.ACTIVE);
        const waitForCompletion = () => waitForOpenCodeMessages(
          target.server.client,
          target.upstreamSessionId,
          () => turn.inputMessageId,
          {
            onMessages: async (messages, inputMessageId) => {
              const latest = lastAssistantResult(messages).message;
              const phase = latest?.summary === true && Number(latest.time?.created) >= turn.eventStartedAt &&
                !latest.time?.completed && !latest.finish && !latest.error ? "compacting" : "";
              if (turn.active && !signal.aborted && text(turn.phase) !== phase) {
                turn.phase = phase;
                turn.updatedAt = new Date().toISOString();
                await writeRun(context, turn, turn.state);
              }
              return writeConversationProjection(context, messages, { inputMessageId, streaming: true });
            },
            readFailure: () => eventFailure,
            signal
          }
        );
        let completion = await waitForCompletion();
        // Work around https://github.com/anomalyco/opencode/issues/37073. Some
        // reasoning models finish successfully without emitting a text part.
        if (
          !turn.interruptRequested &&
          !completion.result?.error &&
          !text(completion.result?.text)
        ) {
          // The recovery prompt replaces the input, so the reasoning-only
          // completion falls outside later projections. Persist its
          // headlines now; a replayed write is a no-op.
          await writeConversationProjection(context, completion.messages, {
            inputMessageId: turn.inputMessageId
          });
          const recoveryMessageId = upstreamMessageId(`${turn.id}:final-response`);
          const admitted = await target.server.client.prompt(target.upstreamSessionId, {
            agent: context.selection.agentId,
            delivery: "queue",
            id: recoveryMessageId,
            model: openCodeModel(context.selection),
            prompt: {
              text: "Your previous response ended without a user-facing final answer. Do not call tools or repeat your reasoning. Return the concise final answer to the user's latest request now."
            },
            resume: true
          }, { signal });
          turn.inputMessageId = text(admitted?.id) || recoveryMessageId;
          turn.updatedAt = new Date().toISOString();
          completion = await waitForCompletion();
        }
        const projection = await writeConversationProjection(context, completion.messages, {
          inputMessageId: turn.inputMessageId
        });
        signal.throwIfAborted();
        failure = projection.failure || text(eventFailure?.message);
        providerApiFailure = projection.providerApiFailure || openCodeProviderApiFailure(eventFailure);
        if (!failure && !turn.interruptRequested && !text(completion.result?.text)) {
          failure = "OpenCode finished without a user-facing final response. Please send your message again.";
          finalState = VIBE64_AGENT_RUN_STATE.FAILED;
        } else if (failure) {
          credentialFailure = openCodeCredentialFailure(failure);
          finalState = VIBE64_AGENT_RUN_STATE.FAILED;
        } else if (turn.interruptRequested) {
          finalState = VIBE64_AGENT_RUN_STATE.INTERRUPTED;
        }
      } catch (error) {
        if (turn.interruptAcknowledged) {
          finalState = VIBE64_AGENT_RUN_STATE.INTERRUPTED;
        } else {
          const cause = signal.aborted ? signal.reason : error;
          failure = text(cause?.message) || "OpenCode turn failed.";
          credentialFailure = openCodeCredentialFailure(failure);
          providerApiFailure = openCodeProviderApiFailure(cause);
          finalState = target.abortController.signal.aborted
            ? VIBE64_AGENT_RUN_STATE.CANCELLED
            : VIBE64_AGENT_RUN_STATE.FAILED;
          if (!target.abortController.signal.aborted) {
            turn.observationError = failure;
            try {
              await writeRun(context, turn, turn.state, failure);
            } catch {
              // A failed store must not prevent stopping native work.
            }
            try {
              await stopUnobservedOpenCodeSession(target, turn.threadId);
            } catch (stopError) {
              failure = `${failure} ${stopError.message}`;
              finalState = VIBE64_AGENT_RUN_STATE.ACTIVE;
            }
          }
        }
      } finally {
        eventAbort.abort();
        await events;
        if (credentialFailure) {
          failure = openCodeCredentialFailureNoticeMessage();
          await writeOpenCodeFailureNotice(context, turn, {
            message: failure,
            reason: "opencode-credential-failure"
          }).catch((error) => {
            vibe64SessionDebugLog("server.opencode.credential-notice.error", {
              error: vibe64SessionDebugError(error),
              sessionId: context.sessionId
            });
          });
        } else if (providerApiFailure && finalState === VIBE64_AGENT_RUN_STATE.FAILED) {
          await writeOpenCodeFailureNotice(context, turn, {
            message: openCodeProviderApiFailureNoticeMessage(failure)
          }).catch((error) => {
            vibe64SessionDebugLog("server.opencode.provider-notice.error", {
              error: vibe64SessionDebugError(error),
              sessionId: context.sessionId
            });
          });
        } else if (finalState === VIBE64_AGENT_RUN_STATE.FAILED) {
          await writeOpenCodeFailureNotice(context, turn, {
            message: openCodeFailureNoticeMessage(failure)
          }).catch((error) => {
            vibe64SessionDebugLog("server.opencode.failure-notice.error", {
              error: vibe64SessionDebugError(error),
              sessionId: context.sessionId
            });
          });
        }
        turn.active = vibe64AgentRunStateIsActive(finalState);
        turn.error = failure;
        turn.state = finalState;
        turn.updatedAt = new Date().toISOString();
        await writeRun(context, turn, finalState, failure).catch(() => null);
      }
      return openCodeTurnSnapshot(turn, target.upstreamSessionId);
    }).finally(() => {
      if (monitors.get(context.key) === monitor) {
        monitors.delete(context.key);
      }
      void disposeReasoningSummary(reasoning).catch((error) => {
        vibe64SessionDebugLog("server.opencode.reasoning-cleanup.error", {
          error: vibe64SessionDebugError(error), sessionId: context.sessionId
        });
      });
    });
    monitors.set(context.key, monitor);
    void monitor.catch((error) => {
      vibe64SessionDebugLog("server.opencode.turn.error", {
        error: vibe64SessionDebugError(error),
        sessionId: context.sessionId
      });
    });
    return monitor;
  }

  async function inspectMessageAdmission(sessionId = "", input = {}, options = {}) {
    const messageId = text(input.messageId);
    if (!messageId) {
      throw openCodeError("vibe64_opencode_message_id_required", "Admission inspection requires a message ID.");
    }
    const context = await contextFor(sessionId, options);
    const threadId = storedUpstreamSessionId(context);
    if (text(input.threadId) !== threadId) {
      throw openCodeError("vibe64_opencode_thread_mismatch", "Admission inspection requires the original assistant thread.");
    }
    const target = await ensureProcess(context, options);
    try {
      // Do not create a missing native session or submit another prompt. Absence
      // from bounded history is uncertainty, not proof of non-admission.
      const messages = await target.server.client.messages(threadId, { limit: 100, order: "desc" }, {
        signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
      });
      const accepted = openCodeMessageRows(messages).some((message) =>
        message.type === "user" && text(message.id) === upstreamMessageId(messageId));
      return { ok: true, admission: accepted ? "accepted" : "unknown", messageId, threadId,
        turnId: accepted ? upstreamMessageId(messageId) : "" };
    } catch {
      return { ok: true, admission: "unknown", messageId, threadId };
    }
  }

  async function sendMessage(sessionId = "", input = {}, options = {}) {
    const message = text(input.message);
    if (!message) {
      return {
        code: "vibe64_opencode_message_empty",
        delivered: false,
        error: "OpenCode message input is empty.",
        ok: false
      };
    }
    const context = await contextFor(sessionId, options);
    const messageId = text(input.messageId) || randomUUID();
    if (
      typeof context.runtime.store?.conversationMessageIdExists === "function" &&
      await context.runtime.store.conversationMessageIdExists(context.sessionId, messageId)
    ) {
      const currentTurn = openCodeTurnSnapshot(turns.get(context.key));
      return {
        delivered: true,
        duplicate: true,
        ok: true,
        thread: { id: currentTurn?.threadId || storedUpstreamSessionId(context) },
        turn: currentTurn
      };
    }
    const currentTurn = turns.get(context.key);
    if (currentTurn?.observationError) {
      await monitors.get(context.key);
    }
    if (currentTurn?.active && currentTurn.observationError) {
      // An explicit Send may retry stopping uncertain work, but cannot overlap it.
      await stopUnobservedOpenCodeSession(processes.get(context.key), currentTurn.threadId);
      currentTurn.active = false;
      currentTurn.state = VIBE64_AGENT_RUN_STATE.INTERRUPTED;
      await writeRun(context, currentTurn, VIBE64_AGENT_RUN_STATE.INTERRUPTED, currentTurn.observationError);
    }
    const currentMonitor = monitors.get(context.key);
    let currentThreadId = storedUpstreamSessionId(context);
    const ownershipMatchesTurn = Boolean(
      currentMonitor &&
      options.turnOwnership &&
      text(options.turnOwnership.threadId) === currentThreadId &&
      text(options.turnOwnership.turnId) === text(currentTurn?.id)
    );
    if (ownershipMatchesTurn && options.turnOwnership.reusable !== true) {
      return {
        code: "vibe64_agent_turn_owner_conflict",
        delivered: false,
        error: "This assistant turn belongs to another user. Your message will be sent when that turn finishes.",
        ok: false,
        refreshRecommended: true,
        retryable: true,
        thread: { id: currentThreadId },
        turn: openCodeTurnSnapshot(currentTurn, currentThreadId)
      };
    }
    const eventStartedAt = Date.now();
    const startedAt = new Date(eventStartedAt).toISOString();
    const providerMessageId = upstreamMessageId(messageId);
    const startingTurn = currentMonitor
      ? null
      : {
          active: true,
          error: "",
          eventStartedAt,
          id: providerMessageId,
          inputMessageId: providerMessageId,
          startedAt,
          state: VIBE64_AGENT_RUN_STATE.STARTING,
          threadId: currentThreadId,
          updatedAt: startedAt
        };
    if (startingTurn) {
      turns.set(context.key, startingTurn);
      await writeRun(context, startingTurn, VIBE64_AGENT_RUN_STATE.STARTING);
    }
    let actor = null;
    let actorFailure = null;
    let actorMetadata = null;
    let admitted = null;
    let target = null;
    let admission = null;
    try {
      actor = await recordGitActor({
        env,
        overwrite: !currentMonitor,
        reason: "agent-message",
        runtime: context.runtime,
        session: context.session,
        sourceRoot: terminalSessionSourceRoot(context.session),
        threadId: currentThreadId,
        vibe64User: options.vibe64User || null,
        workdir: context.workdir
      });
      if (actor?.ok === false) {
        actorFailure = {
          code: actor.code || "vibe64_opencode_git_actor_unavailable",
          delivered: false,
          error: actor.error || "GitHub identity is not available for this OpenCode message.",
          ok: false,
          refreshRecommended: true,
          retryable: true
        };
        throw new Error(actorFailure.error);
      }
      target = await ensureUpstreamSession(context, options);
      currentThreadId = target.upstreamSessionId;
      if (startingTurn) {
        startingTurn.threadId = currentThreadId;
      }
      actorMetadata = { ...input.turnMetadata, ...await conversationActorMetadata({
        vibe64User: options.vibe64User || null
      }), ...(input.turnMetadata?.assistantRouting?.resolvedMode === "review" ? { actorId: "app", actorDisplayName: "Automatic review" } : {}) };
      const genesisTask = text(input.genesisTask);
      const conversation = genesisTask
        ? null
        : await context.runtime.store.readConversationLogPage(context.sessionId, { limit: 1 });
      const needsOpeningPrompt = Boolean(
        genesisTask || (
          !conversation?.pagination?.totalTurnCount &&
          text(context.session?.metadata?.agent_briefing_delivered) !== "yes" &&
          !text(context.session?.metadata?.renewal_handover_delivered_at)
        )
      );
      const rendered = needsOpeningPrompt
        ? await context.runtime.renderPrompt(context.sessionId, {
            input,
            request: message,
            task: genesisTask || "start"
          })
        : { prompt: message };
      const renderedPrompt = text(rendered?.prompt) || message;
      if (!currentMonitor) {
        admission = Promise.withResolvers();
        const eventReady = Promise.withResolvers();
        beginMonitor(target, context, { id: providerMessageId, eventStartedAt, startedAt }, {
          ...options, admission, eventReady
        });
        const timeout = setTimeout(() => eventReady.reject(openCodeError(
          "vibe64_opencode_events_timeout", "OpenCode's event connection did not become ready. Try sending again.", {}, 504
        )), OPENCODE_EVENT_READY_TIMEOUT_MS);
        try {
          await eventReady.promise;
        } finally {
          clearTimeout(timeout);
        }
      }
      const signal = AbortSignal.any([
        target.abortController.signal,
        turns.get(context.key).abortController.signal
      ]);
      signal.throwIfAborted();
      await input.onPromptSending?.({ threadId: target.upstreamSessionId, displayAttachments: input.displayAttachments, turnMetadata: actorMetadata });
      admitted = await target.server.client.prompt(target.upstreamSessionId, {
        agent: context.selection.agentId,
        delivery: currentMonitor ? "steer" : "queue",
        id: providerMessageId,
        model: openCodeModel(context.selection),
        prompt: { text: renderedPrompt },
        attachments: input.attachments,
        resume: true
      }, { signal });
    } catch (error) {
      if (error?.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) {
        await input.onPromptRejected?.();
      }
      admission?.reject(error);
      if (admission) await monitors.get(context.key);
      if (startingTurn && !admission && !monitors.has(context.key)) {
        startingTurn.active = false;
        startingTurn.error = text(error?.message) || "OpenCode prompt delivery failed.";
        startingTurn.state = VIBE64_AGENT_RUN_STATE.FAILED;
        startingTurn.updatedAt = new Date().toISOString();
        await writeRun(
          context,
          startingTurn,
          VIBE64_AGENT_RUN_STATE.FAILED,
          startingTurn.error
        ).catch(() => null);
      }
      if (actorFailure) {
        return actorFailure;
      }
      const failureCode = text(error?.code).replace(/^assistant_opencode_/u, "vibe64_opencode_");
      if (failureCode.startsWith("vibe64_opencode_")) {
        return {
          code: failureCode,
          delivered: false,
          error: text(error?.message) || "OpenCode prompt delivery failed.",
          ok: false,
          refreshRecommended: true,
          retryable: error?.retryable === true || ["vibe64_opencode_start_timeout", "vibe64_opencode_events_timeout"].includes(failureCode),
          thread: { id: currentThreadId },
          turn: openCodeTurnSnapshot(turns.get(context.key) || startingTurn, currentThreadId)
        };
      }
      throw error;
    }
    let conversationTurn;
    try {
      conversationTurn = await context.runtime.store.writeConversationUserMessage(
        context.sessionId,
        {
          attachments: input.displayAttachments,
          messageId,
          text: text(input.displayMessage) || message,
          turnMetadata: {
            ...input.turnMetadata,
            assistantSelection: context.selection,
            ...actorMetadata,
            engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
            upstreamMessageId: text(admitted?.id)
          }
        }
      );
      await publishConversationTurn(context, conversationTurn, "opencode-server-message-delivered");
    } catch (error) {
      admission?.reject(error);
      throw error;
    }
    const activeMonitor = monitors.get(context.key);
    if (activeMonitor) {
      const activeTurn = turns.get(context.key);
      activeTurn.inputMessageId = text(admitted.id);
      activeTurn.updatedAt = new Date().toISOString();
    } else {
      beginMonitor(target, context, {
        ...admitted,
        eventStartedAt,
        startedAt
      }, options);
    }
    admission?.resolve();
    const turn = openCodeTurnSnapshot(turns.get(context.key), target.upstreamSessionId);
    return {
      conversationTurn,
      delivered: true,
      deliveryMode: currentMonitor ? "steer" : "new_turn",
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn,
      workdir: context.workdir
    };
  }

  async function readDetachedConversation(target = {}, conversationId = "", tracked = null, options = {}) {
    const messages = await target.server.client.messages(conversationId, {
      limit: 100,
      order: "desc"
    }, options);
    options.signal?.throwIfAborted();
    const result = lastAssistantResult(messages);
    return {
      conversationId,
      error: text(tracked?.error?.message) || result.error,
      ok: !tracked?.error && !result.error,
      runId: tracked?.runId || "",
      status: tracked?.active ? "inProgress"
        : tracked?.interrupted ? "interrupted"
        : tracked?.error || result.error ? "failed" : "completed",
      text: result.text
    };
  }

  async function createConversation(sessionId = "", input = {}, options = {}) {
    const context = await contextFor(sessionId, options);
    const executionProfile = openCodeExecutionProfile(input);
    const target = boundedHelperTarget(
      await ensureProcess(context, options),
      executionProfile
    );
    // The shared process keeps main chat's configuration; only this chat changes model.
    context.selection = options.assistantSelection || context.selection;
    const conversation = await target.server.client.createSession({
      agent: openCodeAgent(context.selection, executionProfile, context.assistantScope),
      location: { directory: target.workdir },
      model: openCodeModel(context.selection, executionProfile)
    });
    temporaryConversations.set(`${context.key}\0${conversation.id}`, {
      active: false,
      executionProfile,
      target
    });
    return {
      conversationId: conversation.id,
      ephemeral: input.ephemeral === true,
      ok: true,
      status: "ready"
    };
  }

  async function detachedTarget(sessionId = "", input = {}, options = {}, {
    createIfMissing = true
  } = {}) {
    const context = await contextFor(sessionId, options);
    const executionProfile = openCodeExecutionProfile(input);
    const target = boundedHelperTarget(
      await ensureProcess(context, options),
      executionProfile
    );
    context.selection = options.assistantSelection || context.selection;
    const agent = openCodeAgent(context.selection, executionProfile, context.assistantScope);
    let conversationId = text(input.conversationId || input.threadId);
    const previous = conversationId ? temporaryConversations.get(`${context.key}\0${conversationId}`) : null;
    if (context.assistantScope && previous && JSON.stringify(previous.executionProfile || null) !== JSON.stringify(executionProfile)) {
      throw openCodeError("vibe64_opencode_execution_profile_changed", "The scoped helper profile changed. Start a new helper.", {}, 409);
    }
    if (!conversationId) {
      if (!createIfMissing) {
        throw openCodeError(
          "vibe64_opencode_conversation_id_required",
          "OpenCode conversation id is required.",
          {},
          400
        );
      }
      const created = await target.server.client.createSession({
        agent,
        location: { directory: target.workdir },
        model: openCodeModel(context.selection, executionProfile)
      });
      conversationId = created.id;
    } else {
      await target.server.client.switchModel(
        conversationId,
        openCodeModel(context.selection, executionProfile)
      );
      await target.server.client.switchAgent(conversationId, agent);
    }
    const key = `${context.key}\0${conversationId}`;
    const tracked = temporaryConversations.get(key) || { active: false, target };
    tracked.target = target;
    tracked.executionProfile = executionProfile;
    tracked.conversationId = conversationId;
    tracked.promptContext = executionProfile
      ? null
      : promptContext("temporary", context.assistantScope);
    temporaryConversations.set(key, tracked);
    await writeSessionEnvironmentRegistry();
    return { context, conversationId, executionProfile, key, target, tracked };
  }

  async function existingDetachedTarget(sessionId = "", input = {}, options = {}) {
    const context = await contextFor(sessionId, options);
    const conversationId = text(input.conversationId || input.threadId);
    if (!conversationId) {
      throw openCodeError(
        "vibe64_opencode_conversation_id_required",
        "OpenCode conversation id is required.",
        {},
        400
      );
    }
    const key = `${context.key}\0${conversationId}`;
    let tracked = temporaryConversations.get(key) || null;
    let target = tracked?.target || processes.get(context.key) || null;
    if (input.persistent && (!target || target.abortController.signal.aborted)) {
      temporaryConversations.delete(key);
      tracked = null;
      target = await ensureProcess(context, options);
    }
    return { context, conversationId, key, tracked, target };
  }

  function openCodeReadUnavailable() {
    return openCodeError(
      "vibe64_opencode_process_not_running",
      "The OpenCode conversation is not connected. Reading it must not start AI infrastructure.",
      {},
      409
    );
  }

  async function runDetachedChatTurn(sessionId = "", input = {}, options = {}, {
    waitForCompletion = true
  } = {}) {
    const prompt = openCodeDetachedPrompt(input);
    if (!prompt) {
      throw openCodeError("vibe64_opencode_prompt_empty", "OpenCode prompt input is empty.", {}, 400);
    }
    boundedOpenCodeExecutionInput(prompt, openCodeExecutionProfile(input));
    const {
      context,
      conversationId,
      executionProfile,
      target,
      tracked
    } = await detachedTarget(sessionId, input, options);
    if (tracked.active && tracked.error) {
      await stopUnobservedOpenCodeSession(tracked.target, conversationId);
      tracked.active = false;
    }
    if (tracked.active && input.steer === true) {
      const messageId = upstreamMessageId(input.messageId || randomUUID());
      const previousMessageId = tracked.runId;
      // The existing observer follows the latest admitted prompt in this conversation.
      tracked.runId = messageId;
      try {
        await target.server.client.prompt(conversationId, {
          agent: openCodeAgent(context.selection, executionProfile, context.assistantScope),
          delivery: "steer",
          id: messageId,
          model: openCodeModel(context.selection, executionProfile),
          prompt: { text: prompt },
          attachments: input.attachments,
          resume: true
        }, { signal: AbortSignal.any([target.abortController.signal, tracked.abortController.signal]) });
      } catch (error) {
        tracked.runId = previousMessageId;
        throw error;
      }
      return {
        conversationId,
        ok: true,
        runId: tracked.runId,
        status: "inProgress",
        deliveryMode: "steer"
      };
    }
    if (tracked.active) {
      throw openCodeError("vibe64_opencode_conversation_busy", "This conversation is still working.", {}, 409);
    }
    tracked.active = true;
    tracked.error = null;
    tracked.interrupted = false;
    const turnAbort = new AbortController();
    tracked.abortController = turnAbort;
    const inputMessageId = upstreamMessageId(input.messageId || input.operationId || randomUUID());
    const observedTarget = { ...target, upstreamSessionId: conversationId };
    const eventAbort = new AbortController();
    const signal = AbortSignal.any([target.abortController.signal, turnAbort.signal, ...(options.signal ? [options.signal] : [])]);
    const eventReady = Promise.withResolvers();
    const events = consumeEvents(observedTarget, context, null, {
      onEvent: options.onEvent,
      onReady: eventReady.resolve,
      publish: false,
      signal: AbortSignal.any([signal, eventAbort.signal])
    }).catch((error) => {
      eventReady.reject(error);
      if (!eventAbort.signal.aborted && !signal.aborted) turnAbort.abort(error);
    });
    const readyTimeout = setTimeout(() => eventReady.reject(openCodeError(
      "vibe64_opencode_events_timeout", "OpenCode's event connection did not become ready.", {}, 504
    )), OPENCODE_EVENT_READY_TIMEOUT_MS);
    let admitted;
    let promptAttempted = false;
    try {
      await eventReady.promise;
      signal.throwIfAborted();
      await options.onEvent?.({ threadId: conversationId, type: "thread" });
      await input.onPromptSending?.({ threadId: conversationId });
      promptAttempted = true;
      admitted = await target.server.client.prompt(conversationId, {
        agent: openCodeAgent(context.selection, executionProfile, context.assistantScope),
        delivery: "queue",
        id: inputMessageId,
        model: openCodeModel(context.selection, executionProfile),
        prompt: { text: prompt },
        attachments: input.attachments,
        resume: true
      }, { signal });
    } catch (error) {
      eventAbort.abort();
      await events;
      tracked.error = error;
      if (promptAttempted) await stopUnobservedOpenCodeSession(observedTarget, conversationId);
      tracked.active = false;
      throw error;
    } finally {
      clearTimeout(readyTimeout);
    }
    tracked.runId = text(admitted.id);
    tracked.completion = (async () => {
      let stopped = true;
      let checkpointOutcome = "completed";
      try {
        const timeoutMs = openCodeExecutionTimeout(input, executionProfile);
        await waitForOpenCodeMessages(target.server.client, conversationId, () => tracked.runId, {
          signal: AbortSignal.any([
            signal,
            ...(timeoutMs ? [AbortSignal.timeout(timeoutMs)] : [])
          ])
        });
        const conversation = boundedOpenCodeExecutionOutput(
          await readDetachedConversation(target, conversationId, null, { signal }),
          executionProfile
        );
        return {
          ...conversation,
          runId: tracked.runId,
          threadId: conversationId,
          turnId: tracked.runId,
          text: input.outputSchema
            ? openCodeStructuredOutput(conversation.text)
            : conversation.text
        };
      } catch (error) {
        const failure = signal.aborted ? signal.reason : error;
        checkpointOutcome = tracked.interrupted ? "interrupted" : "failed";
        if (tracked.interrupted) {
          return { conversationId, ok: true, runId: tracked.runId, status: "interrupted", text: "" };
        }
        if (!target.abortController.signal.aborted) {
          try {
            await stopUnobservedOpenCodeSession(observedTarget, conversationId);
          } catch (stopError) {
            stopped = false;
            throw new Error(`${failure.message} ${stopError.message}`, { cause: failure });
          }
        }
        throw failure;
      } finally {
        eventAbort.abort();
        await events;
        if (tracked.abortController === turnAbort) tracked.active = !stopped;
        if (stopped && !executionProfile && !context.assistantScope) {
          await checkpointSessionTurn({
            projectService, runtime: context.runtime, session: context.session, sessionId,
            outerTurnId: `opencode:${conversationId}:${tracked.runId}`,
            outcome: checkpointOutcome,
            publishSessionChanged
          });
        }
      }
    })();
    // Keep a failed admitted turn observable to the client's conversation reads.
    void tracked.completion.catch((error) => {
      if (tracked.abortController === turnAbort) tracked.error = error;
    });
    if (input.persistent) {
      void tracked.completion.then((result) => publishSessionChanged(sessionId, {
        reason: "temporary-agent-turn-idle", payload: { conversationId,
          temporaryRun: { active: false, state: result.status || "completed", providerTurnId: tracked.runId } }
      }), () => publishSessionChanged(sessionId, {
        reason: "temporary-agent-turn-idle", payload: { conversationId,
          temporaryRun: { active: false, state: tracked.interrupted ? "interrupted" : "failed", providerTurnId: tracked.runId } }
      })).catch(() => {});
    }
    return waitForCompletion ? tracked.completion : {
      conversationId,
      ok: true,
      runId: tracked.runId,
      status: "inProgress",
      threadId: conversationId,
      turnId: tracked.runId
    };
  }

  async function runRenewalTurn(target = {}, {
    clientMessageId = "",
    prompt = ""
  } = {}) {
    const inputMessageId = upstreamMessageId(clientMessageId);
    let messages = await target.server.client.messages(target.upstreamSessionId, {
      limit: 100,
      order: "desc"
    });
    let result = openCodeMessageResultForInput(messages, inputMessageId);
    let admitted = null;
    if (!result) {
      admitted = await target.server.client.prompt(target.upstreamSessionId, {
        agent: text(target.selection?.agentId),
        delivery: "queue",
        id: inputMessageId,
        model: openCodeModel(target.selection),
        prompt: { text: String(prompt || "") },
        resume: true
      });
    }
    if (!result?.complete) {
      try {
        const completion = await waitForOpenCodeMessages(
          target.server.client,
          target.upstreamSessionId,
          inputMessageId,
          {
            signal: AbortSignal.timeout(OPENCODE_RENEWAL_TIMEOUT_MS)
          }
        );
        messages = completion.messages;
        result = completion.result;
      } catch (error) {
        let handoverPromptAccepted = Boolean(result);
        if (!handoverPromptAccepted && admitted) {
          try {
            handoverPromptAccepted = Boolean(openCodeMessageResultForInput(
              await target.server.client.messages(target.upstreamSessionId, {
                limit: 100,
                order: "desc"
              }),
              inputMessageId
            ));
          } catch {
            // The exact provider history remains the admission proof. If it
            // cannot be read, renewal must leave the predecessor available.
          }
        }
        throw openCodeError(
          "vibe64_session_renewal_turn_failed",
          text(error?.message) || "OpenCode did not finish the session renewal turn.",
          {
            clientMessageId,
            handoverPromptAccepted,
            threadId: target.upstreamSessionId
          },
          502
        );
      }
    }
    if (!result?.complete || (!result.text && !result.error)) {
      throw openCodeError(
        "vibe64_session_renewal_turn_unreadable",
        "The exact OpenCode renewal turn did not produce a readable result.",
        {
          clientMessageId,
          handoverPromptAccepted: true,
          threadId: target.upstreamSessionId
        },
        502
      );
    }
    if (result.error) {
      throw openCodeError(
        "vibe64_session_renewal_turn_failed",
        result.error,
        {
          clientMessageId,
          handoverPromptAccepted: true,
          threadId: target.upstreamSessionId,
          turnId: result.turnId
        },
        502
      );
    }
    return {
      admitted,
      clientMessageId,
      reconciled: !admitted,
      text: result.text,
      threadId: target.upstreamSessionId,
      turnId: result.turnId || text(admitted?.id)
    };
  }

  async function generateSessionRenewalHandover(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const context = await contextFor(sessionId, options);
    const target = await ensureUpstreamSession(context, options);
    const expectedThreadId = text(input.expectedThreadId);
    if (expectedThreadId && expectedThreadId !== target.upstreamSessionId) {
      throw openCodeError(
        "vibe64_session_renewal_thread_mismatch",
        "The OpenCode predecessor history changed before handover generation.",
        { actualThreadId: target.upstreamSessionId, expectedThreadId }
      );
    }
    const clientMessageId = sessionRenewalClientMessageId("handover", operationId);
    const result = await runRenewalTurn(target, {
      clientMessageId,
      prompt: sessionRenewalHandoverPrompt({ source: input.source })
    });
    const parsed = parseSessionRenewalHandoverOutput(result.text, {
      source: input.source
    });
    await writeSessionMetadata(context, {
      agent_renewal_handover_hash: parsed.handoverHash,
      agent_renewal_handover_operation_id: operationId,
      agent_renewal_handover_thread_id: result.threadId,
      agent_renewal_handover_turn_id: result.turnId
    });
    return {
      ...parsed,
      ...result,
      ok: true,
      operationId,
      source: input.source
    };
  }

  async function seedSessionRenewalHandover(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const approved = defineSessionRenewalApprovedHandover({
      handover: input.handover,
      handoverHash: input.handoverHash,
      source: input.source
    });
    const context = await contextFor(sessionId, options);
    const target = await ensureUpstreamSession(context, options);
    const expectedThreadId = text(input.expectedThreadId);
    const forbiddenThreadId = text(input.forbiddenThreadId || input.oldThreadId);
    if (
      (expectedThreadId && expectedThreadId !== target.upstreamSessionId) ||
      (forbiddenThreadId && forbiddenThreadId === target.upstreamSessionId)
    ) {
      throw openCodeError(
        "vibe64_session_renewal_fresh_thread_required",
        "The renewed OpenCode session does not own the expected fresh native history.",
        {
          actualThreadId: target.upstreamSessionId,
          expectedThreadId,
          forbiddenThreadId
        }
      );
    }
    const clientMessageId = sessionRenewalClientMessageId("seed", operationId);
    const inputMessageId = upstreamMessageId(clientMessageId);
    const existingMessages = openCodeMessageRows(await target.server.client.messages(
      target.upstreamSessionId,
      { limit: 100, order: "desc" }
    ));
    const unrelatedUserMessage = existingMessages.find((message) => (
      message?.type === "user" && text(message.id) !== inputMessageId
    ));
    if (unrelatedUserMessage) {
      throw openCodeError(
        "vibe64_session_renewal_fresh_thread_required",
        "The successor OpenCode history contains unrelated conversation and cannot be used for renewal.",
        { threadId: target.upstreamSessionId }
      );
    }
    const result = await runRenewalTurn(target, {
      clientMessageId,
      prompt: sessionRenewalSeedPrompt(approved)
    });
    let acknowledgement = null;
    try {
      acknowledgement = parseSessionRenewalAcknowledgement(result.text, {
        handoverHash: approved.handoverHash,
        source: approved.source
      });
    } catch (error) {
      error.details = {
        ...(record(error.details)),
        clientMessageId,
        handoverPromptAccepted: true,
        threadId: result.threadId,
        turnId: result.turnId
      };
      throw error;
    }
    const acknowledgedAt = new Date().toISOString();
    await writeSessionMetadata(context, {
      agent_briefing_delivered: "yes",
      agent_briefing_delivered_at: acknowledgedAt,
      agent_briefing_transport: "opencode_server",
      agent_renewal_seed_acknowledged_at: acknowledgedAt,
      agent_renewal_seed_handover_hash: approved.handoverHash,
      agent_renewal_seed_operation_id: operationId,
      agent_renewal_seed_thread_id: result.threadId,
      agent_renewal_seed_turn_id: result.turnId
    });
    const proof = await stopProcessRecord(target);
    return {
      ...result,
      acknowledgement,
      acknowledgedAt,
      freshThread: existingMessages.length === 0,
      handoverHash: approved.handoverHash,
      ok: proof?.exited !== false,
      operationId,
      processExitProof: proof,
      source: approved.source,
      subscriptionDeferred: true
    };
  }

  async function closeAllForSession(sessionId = "", options = {}) {
    const id = safeSessionId(sessionId);
    const terminalClose = await closeTerminalSessionsForNamespace(
      opencodeTerminalNamespace(id)
    );
    const pending = [...processStarts.entries()]
      .filter(([key]) => key.endsWith(`\0${id}`))
      .map(([, start]) => start.catch(() => null));
    await Promise.all(pending);
    const targets = [...processes.values()].filter((target) => target.sessionId === id);
    // Helpers release their own context; the project runtime owns the shared
    // service so the next Router or suggestion does not repeat cold startup.
    const proofs = await Promise.all(targets.map((target) => stopProcessRecord(target, {
      retainSharedProcess: Boolean(options.assistantScope)
    })));
    if (getAssistantManager() && !options.assistantScope) {
      const runtime = options.runtime || await projectService.createRuntime({ inspectSource: false });
      await cleanupReasoningSummary({ sessionId: id, runtime, vibe64User: options.vibe64User || null });
    }
    for (const key of [...turns.keys()]) {
      if (key.endsWith(`\0${id}`)) {
        turns.delete(key);
      }
    }
    for (const key of [...temporaryConversations.keys()]) {
      if (temporaryConversations.get(key)?.target?.sessionId === id) {
        temporaryConversations.delete(key);
      }
    }
    return {
      closed: targets.length + Number(terminalClose?.closed || 0),
      ok: terminalClose?.ok !== false && proofs.every((proof) => proof?.exited !== false),
      processExitProof: proofs.at(-1) || processExitProofs.get(id) || { exited: true },
      processExitProofs: proofs
    };
  }

  async function closeAllForProject(input = {}) {
    await Promise.all([...processStarts.values()].map((start) => start.catch(() => null)));
    const projectContextRoot = text(input.projectContextRoot);
    const targets = [...processes.values()].filter((target) => (
      !projectContextRoot || target.projectContextRoot === path.resolve(projectContextRoot)
    ));
    const results = await Promise.all(targets.map((target) => stopProcessRecord(target)));
    if (processes.size === 0 && sharedProcess) {
      results.push(await stopSharedProcess(text(input.reason) || "opencode-project-close"));
    }
    return {
      closed: results.length,
      ok: results.every((result) => result?.exited !== false)
    };
  }

  function releaseProcessExitProof(sessionId = "") {
    const id = safeSessionId(sessionId);
    const proof = processExitProofs.get(id) || null;
    processExitProofs.delete(id);
    return {
      ok: Boolean(proof?.exited),
      processExitProof: proof,
      released: Boolean(proof?.exited)
    };
  }

  return Object.freeze({
    capabilities,
    closeAllForProject,
    closeAllForSession,
    closeTerminal,
    createConversation,
    async listNativeConversationStorage(sessionId, binding, options = {}) {
      const target = await ensureSharedProcess({ sessionId, runtime: options.runtime, session: options.session }, options);
      return (await target.server.listConversationsForDirectory(binding.workdir, { signal: options.signal })).map((row) => ({ ...binding, conversationId: row.id }));
    },
    async retireConversationHistory(sessionId, binding, options = {}) {
      const target = await ensureSharedProcess({ sessionId, runtime: options.runtime, session: options.session }, options);
      // Native status is scoped to a project instance. The control server's
      // own directory cannot establish whether this saved conversation is idle.
      const client = openCodeServerForDirectory(target.server, binding.workdir).client;
      const inspect = async () => {
        const queue = [binding.conversationId];
        const seen = new Set();
        const records = [];
        for (let index = 0; index < queue.length; index += 1) {
          options.signal?.throwIfAborted();
          const conversationId = queue[index];
          if (seen.has(conversationId) || queue.length > 1000) throw new Error("OpenCode native family is cyclic or exceeds its inventory limit.");
          seen.add(conversationId);
          let native;
          try { native = await target.server.readConversationStorage(conversationId, { signal: options.signal }); }
          catch (error) { if (error.statusCode === 404 && index === 0) return []; throw error; }
          if (native?.id !== conversationId || native?.directory !== binding.workdir ||
              (await client.sessionStatus(conversationId, { signal: options.signal })).type !== "idle") {
            throw new Error("OpenCode retirement requires an idle native family in the exact saved directory.");
          }
          records.push({ conversationId, workdir: native.directory,
            ...(Number.isFinite(native.time?.created) ? { createdAt: new Date(native.time.created).toISOString() } : {}),
            ...(Number.isFinite(native.time?.updated) ? { updatedAt: new Date(native.time.updated).toISOString() } : {}) });
          const children = await target.server.listConversationChildren(conversationId, { signal: options.signal });
          for (const child of children) {
            if (child.directory !== binding.workdir) throw new Error("OpenCode child directory differs from its saved owner.");
            queue.push(child.id);
          }
        }
        return records.sort((left, right) => left.conversationId.localeCompare(right.conversationId));
      };
      return retireNativeConversation({ binding, inspect, beforeDelete: options.beforeDelete,
        readConversation: async (id) => ({ info: await target.server.readConversationStorage(id), messages: (await client.messages(id)).data }),
        exportConversation: async (id, onRecord) => {
          const deadline = AbortSignal.timeout(300_000);
          const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
          const output = createNativeHistoryExport(onRecord, { signal });
          const info = await target.server.readConversationStorage(id, { signal });
          if (info?.id !== id || (await client.sessionStatus(id, { signal })).type !== "idle") {
            throw new Error("OpenCode native export requires the exact idle conversation.");
          }
          await output.emit({ type: "thread", thread: info, text: [] });
          const messageIds = new Set();
          const cursors = new Set();
          let before = "";
          let pages = 0;
          while (true) {
            signal.throwIfAborted();
            if (++pages > 20_000) throw new Error("OpenCode native export exceeded its page limit; history was not retired.");
            const response = await target.server.readConversationStoragePage(id, { before, signal });
            if (!Array.isArray(response?.data) || response.data.length > 1 ||
                (response.nextCursor !== null && (typeof response.nextCursor !== "string" || !response.nextCursor || response.nextCursor.length > 8192)) ||
                (response.data.length === 0 && response.nextCursor !== null)) {
              throw new Error("OpenCode returned an incomplete or invalid native message page.");
            }
            for (const message of response.data) {
              const info = message?.info;
              if (!/^msg_[a-zA-Z0-9]{1,256}$/u.test(info?.id) || info.sessionID !== id ||
                  !["user", "assistant"].includes(info.role) || !Array.isArray(message.parts) || messageIds.has(info.id)) {
                throw new Error("OpenCode returned an invalid or duplicate native message.");
              }
              messageIds.add(info.id);
              const content = assistantMessageText({ content: message.parts });
              await output.emit({ type: "message", message, text: content ? [{ role: info.role, text: content,
                branchId: id, messageId: info.id,
                ...(info.parentID ? { parentMessageId: info.parentID } : {}),
                ...(Number.isFinite(info.time?.created) ? { createdAt: new Date(info.time.created).toISOString() } : {}),
                ...(Number.isFinite(info.time?.completed) ? { completedAt: new Date(info.time.completed).toISOString() } : {}),
                ...(info.modelID || info.model?.modelID ? { modelId: info.modelID || info.model.modelID } : {}),
                ...(info.providerID || info.model?.providerID ? { modelProviderId: info.providerID || info.model.providerID } : {}),
                ...(info.agent ? { agent: info.agent } : {}) }] : [] });
            }
            if (response.nextCursor === null) break;
            if (cursors.has(response.nextCursor)) throw new Error("OpenCode repeated a native history cursor.");
            cursors.add(response.nextCursor);
            before = response.nextCursor;
          }
          return output.complete();
        },
        remove: () => client.deleteSession(binding.conversationId) });
    },
    async deleteConversation(sessionId, input = {}, options = {}) {
      const { context, conversationId, target, tracked } = await existingDetachedTarget(
        sessionId,
        { ...input, persistent: input.persistent || Boolean(options.assistantScope) },
        options
      );
      if (!target) {
        temporaryConversations.delete(`${context.key}\0${conversationId}`);
        await writeSessionEnvironmentRegistry();
        return { conversationId, deleted: false, ok: true };
      }
      try {
        await target.server.client.deleteSession(conversationId);
      } catch (error) {
        if ((!input.persistent && !context.assistantScope) || error.statusCode !== 404) throw error;
      }
      if (tracked) {
        tracked.interrupted = true;
        tracked.abortController?.abort();
        await tracked.completion?.catch(() => null);
      }
      temporaryConversations.delete(`${context.key}\0${conversationId}`);
      await writeSessionEnvironmentRegistry();
      const providerExit = context.assistantScope
        ? await closeAllForSession(context.sessionId, context)
        : null;
      return {
        conversationId,
        deleted: true,
        ok: providerExit?.ok !== false,
        ...(providerExit ? { providerExit } : {})
      };
    },
    async describeProvider(sessionId, options = {}) {
      const context = await contextFor(sessionId, options);
      const connection = requireOpenCodeConnection(await resolveConnection({
        engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        modelProviderId: context.selection.modelProviderId,
        sessionId: context.sessionId,
        vibe64User: options.vibe64User || null
      }), context.selection.modelProviderId);
      return {
        accountIdentitySignature: connection.fingerprint,
        providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        transportId: "opencode_server"
      };
    },
    async ensureSession(sessionId, options = {}) {
      let context = await contextFor(sessionId, { ...options, session: null });
      const admissionFailure = terminalNamespaceAdmissionFailure(opencodeTerminalNamespace(sessionId));
      if (admissionFailure) {
        return admissionFailure;
      }
      let target = processes.get(context.key);
      const connection = requireOpenCodeConnection(await resolveConnection({
        engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        modelProviderId: context.selection.modelProviderId,
        sessionId,
        vibe64User: options.vibe64User || null
      }), context.selection.modelProviderId);
      let ready = false;
      let unhealthyProcess = null;
      let missingUpstream = false;
      if (
        target?.upstream &&
        sameOpenCodeSelection(target.upstreamSelection, context.selection) &&
        target.workdir === context.workdir &&
        text(target.selection?.catalogRevision) === text(context.selection.catalogRevision) &&
        target.connectionFingerprint === connection.fingerprint &&
        target.canonicalUrl === connection.canonicalUrl &&
        target.endpointCode === connection.endpointCode
      ) {
        const observedProcess = sharedProcess;
        const observedServer = target.server;
        let healthy = false;
        try {
          await target.server.client.health({ signal: AbortSignal.timeout(1_000) });
          healthy = true;
          ready = Boolean(await target.server.client.readSession(target.upstreamSessionId));
        } catch (error) {
          if (healthy && error?.statusCode !== 404) {
            throw error;
          }
          if (!healthy) {
            unhealthyProcess = observedProcess;
          }
        }
        context = await contextFor(sessionId, { ...options, session: null });
        if (
          closed ||
          processes.get(context.key) !== target ||
          sessionIsClosing(context.session) ||
          context.session.status === "archived" ||
          target.abortController.signal.aborted ||
          target.server !== observedServer ||
          target.workdir !== context.workdir ||
          !sameOpenCodeSelection(target.upstreamSelection, context.selection) ||
          text(target.selection?.catalogRevision) !== text(context.selection.catalogRevision)
        ) {
          throw openCodeError("vibe64_agent_session_changed",
            "The assistant session changed while its connection was being checked.", {}, 409);
        }
        missingUpstream = healthy && !ready;
      }
      if (!ready) {
        const { value: prepared } = await runVibe64AgentWriteExclusive(context.runtime, sessionId, async () => {
          context = await contextFor(sessionId, { ...options, session: null });
          const failure = terminalNamespaceAdmissionFailure(opencodeTerminalNamespace(sessionId));
          if (failure) {
            return failure;
          }
          if (closed || sessionIsClosing(context.session) || context.session.status === "archived") {
            throw openCodeError("vibe64_session_closing", "This session cannot prepare its assistant now.", {}, 409);
          }
          if (unhealthyProcess && sharedProcess === unhealthyProcess) {
            await stopSharedProcess("opencode-health-check-failed");
          }
          if (missingUpstream && processes.get(context.key) === target) {
            target.upstream = null;
          }
          return ensureUpstreamSession(context, options);
        }, { operation: "prepare-agent-session", waitMs: 10_000 });
        if (prepared?.ok === false) {
          return prepared;
        }
        target = prepared;
      }
      const savedRun = (context.session.agentRuns || []).find(run => run.id === OPENCODE_AGENT_RUN_ID);
      if (savedRun?.active && savedRun.observationError && !monitors.has(context.key)) {
        await runVibe64AgentWriteExclusive(context.runtime, sessionId, async () => {
          context = await contextFor(sessionId, { ...options, session: null });
          const run = (context.session.agentRuns || []).find(run => run.id === OPENCODE_AGENT_RUN_ID);
          if (!run?.active || !run.observationError || monitors.has(context.key)) return;
          const threadId = text(run.threadId) || target.upstreamSessionId;
          if (threadId !== target.upstreamSessionId) return;
          const status = await target.server.client.sessionStatus(threadId, {
            signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
          });
          if (status?.type !== "idle") return;
          await context.runtime.store.mutateSession(sessionId, async () => {
            const latest = await context.runtime.getSession(sessionId, { inspectSource: false });
            const currentRun = (latest.agentRuns || []).find(value => value.id === OPENCODE_AGENT_RUN_ID);
            if (JSON.stringify(currentRun) !== JSON.stringify(run)) return;
            const stopped = {
              ...turns.get(context.key),
              ...run,
              id: text(run.turnId),
              threadId,
              active: false,
              state: VIBE64_AGENT_RUN_STATE.INTERRUPTED,
              updatedAt: new Date().toISOString()
            };
            await writeRun(context, stopped, VIBE64_AGENT_RUN_STATE.INTERRUPTED, run.observationError);
            turns.set(context.key, stopped);
          });
        }, { operation: "recover-opencode-observation", waitMs: 10_000 });
      }
      return {
        ok: true,
        thread: { id: target.upstreamSessionId },
        turn: openCodeTurnSnapshot(turns.get(context.key), target.upstreamSessionId),
        workdir: context.workdir
      };
    },
    generateSessionRenewalHandover,
    hasActiveTemporaryConversation(sessionId = "") {
      const id = safeSessionId(sessionId);
      return [...temporaryConversations.values()].some((entry) => (
        !entry.reasoningSummary && entry.active === true && entry.target?.sessionId === id
      ));
    },
    async rewindConversation(sessionId, input = {}, options = {}) {
      const context = await contextFor(sessionId, options);
      const threadId = storedUpstreamSessionId(context);
      if (!threadId) throw openCodeError("vibe64_conversation_rewind_unavailable", "This session has no OpenCode conversation to undo.");
      const target = await ensureProcess(context, options);
      const client = target.server.client;
      if (turns.get(context.key)?.active || (await client.sessionStatus(threadId)).type !== "idle") {
        throw openCodeError("vibe64_conversation_rewind_unavailable", "Stop OpenCode before undoing a turn.");
      }
      const rows = openCodeMessageRows(await client.messages(threadId));
      const users = rows.filter((row) => row.type === "user");
      if (!input.checkpoint) {
        const messageId = upstreamMessageId(input.messageId);
        if (users.at(-1)?.id !== messageId || users.at(-2)?.id !== upstreamMessageId(input.previousMessageId)) {
          throw openCodeError("vibe64_conversation_rewind_unavailable", "OpenCode's last turn changed. Refresh before undoing.");
        }
        const index = rows.findIndex((row) => row.id === messageId);
        return { ok: true, checkpoint: { threadId, keepLastId: rows[index - 1].id,
          previousMessageId: users.at(-2).id,
          messageIds: rows.slice(index).map((row) => row.id) } };
      }
      const checkpoint = input.checkpoint;
      const kept = rows.findIndex((row) => row.id === checkpoint.keepLastId);
      const remaining = rows.slice(kept + 1);
      if (checkpoint.threadId !== threadId || kept < 0 || remaining.some((row) => !checkpoint.messageIds.includes(row.id))) {
        throw openCodeError("vibe64_conversation_rewind_unavailable", "The OpenCode conversation changed. Refresh before undoing.");
      }
      // Delete answers/tools before their prompt. Each exact ID is safe to
      // inspect and retry after a partial failure, without reverting files.
      for (const row of remaining.reverse()) {
        if (await client.deleteMessage(threadId, row.id) !== true) {
          throw openCodeError("vibe64_conversation_rewind_unconfirmed", "OpenCode did not confirm Undo. Retry Undo last turn to check it.");
        }
      }
      turns.delete(context.key);
      await context.runtime.store.writeAgentRunEvent(sessionId, OPENCODE_AGENT_RUN_ID, {
        event: { kind: "conversation-rewound", state: VIBE64_AGENT_RUN_STATE.COMPLETED },
        patch: { state: VIBE64_AGENT_RUN_STATE.COMPLETED, error: "", turnId: checkpoint.previousMessageId }
      });
      return { ok: true };
    },

    async interruptTurn(sessionId, input = {}, options = {}) {
      void input;
      const context = await contextFor(sessionId, options);
      const target = processes.get(context.key) || null;
      const turn = turns.get(context.key);
      if (!target) {
        return {
          interrupted: false,
          ok: true,
          thread: { id: storedUpstreamSessionId(context) },
          turn: openCodeTurnSnapshot(turn)
        };
      }
      if (turn?.observationError) {
        await monitors.get(context.key);
        if (turn.active) {
          await stopUnobservedOpenCodeSession(target, turn.threadId);
          turn.active = false;
          turn.state = VIBE64_AGENT_RUN_STATE.INTERRUPTED;
          await writeRun(context, turn, turn.state, turn.observationError);
        }
        return { ok: true, interrupted: true, thread: { id: turn.threadId }, turn: openCodeTurnSnapshot(turn) };
      }
      if (turn) {
        turn.interruptRequested = true;
      }
      const interrupted = Boolean(turn?.active);
      try {
        const confirmed = await target.server.client.interrupt(target.upstreamSessionId, {
          signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
        });
        if (confirmed !== true) {
          throw openCodeError("vibe64_opencode_interrupt_unconfirmed", "OpenCode did not confirm Stop. Try Stop again.", {}, 502);
        }
      } catch (error) {
        if (turn) turn.interruptRequested = false;
        if (error?.name === "TimeoutError") {
          throw openCodeError("vibe64_opencode_interrupt_timeout", "OpenCode did not confirm Stop within 5 seconds. Try Stop again.", {}, 504);
        }
        throw error;
      }
      if (turn?.active && turn.abortController) {
        turn.interruptAcknowledged = true;
        turn.abortController.abort();
        turn.admission?.resolve();
        await monitors.get(context.key);
      }
      return {
        interrupted,
        ok: true,
        thread: { id: target.upstreamSessionId },
        turn: openCodeTurnSnapshot(turn, target.upstreamSessionId)
      };
    },
    async invalidateRuntimes(input = {}) {
      if (text(input.reason) === "server-shutdown") {
        closed = true;
      }
      await Promise.all([...processStarts.values()].map((start) => start.catch(() => null)));
      const targets = [...processes.values()];
      const results = await Promise.all(targets.map((target) => stopProcessRecord(target)));
      if (targets.length === 0 && sharedProcess) {
        results.push(await stopSharedProcess(text(input.reason) || "opencode-runtime-invalidation"));
      }
      return {
        closed: results.length,
        ok: results.every((result) => result?.exited !== false)
      };
    },
    async readConversation(sessionId, input = {}, options = {}) {
      const { conversationId, target, tracked } = await existingDetachedTarget(sessionId, input, options);
      if (!target) {
        throw openCodeReadUnavailable();
      }
      if (!input.persistent) return boundedOpenCodeExecutionOutput(
        await readDetachedConversation(target, conversationId, tracked), tracked?.executionProfile);
      let status = await target.server.client.sessionStatus(conversationId);
      if (!tracked && status.type !== "idle") {
        await stopUnobservedOpenCodeSession(target, conversationId);
        status = { type: "idle" };
      }
      const rows = openCodeMessageRows(await target.server.client.messages(conversationId));
      const result = lastAssistantResult(rows);
      const messages = rows.filter((row) => row.type === "assistant").flatMap((row) => {
        const complete = Boolean(row.time?.completed || row.finish || row.error);
        const reasoning = (row.content || []).filter((part) => part.type === "reasoning" && text(part.text))
          .map((part, index) => ({ id: conversationMessageId(row.id, part.id || index, "reasoning"), role: "thinking", text: part.text, complete }));
        const answer = assistantMessageText(row);
        return [...reasoning, ...(answer ? [{ id: conversationMessageId(row.id, "assistant"), role: "assistant", text: answer, complete }] : [])];
      });
      let conversationStatus = "completed";
      if (status.type !== "idle" || tracked?.active) conversationStatus = "inProgress";
      else if (tracked?.interrupted) conversationStatus = "interrupted";
      else if (tracked?.error || result.error) conversationStatus = "failed";
      return {
        conversationId,
        ok: true,
        messages,
        text: result.text,
        admitted: Boolean(input.messageId && rows.some((row) => row.id === upstreamMessageId(input.messageId))),
        error: text(tracked?.error?.message) || result.error,
        runId: tracked?.runId || [...rows].reverse().find((row) => row.type === "user")?.id || "",
        status: conversationStatus
      };
    },
    readTerminal,
    async reconcileSessions(sessions = [], options = {}) {
      const results = [];
      for (const session of sessions) {
        const sessionId = text(session?.sessionId || session?.id);
        try {
          const context = await contextFor(sessionId, { ...options, session });
          const activeRun = (Array.isArray(session?.agentRuns) ? session.agentRuns : [])
            .find((run) => run?.id === OPENCODE_AGENT_RUN_ID && run.active === true);
          const target = await ensureUpstreamSession(context, options);
          if (activeRun?.observationError) {
            await stopUnobservedOpenCodeSession(target, activeRun.threadId);
            await writeRun(context, { ...activeRun, id: activeRun.turnId }, VIBE64_AGENT_RUN_STATE.INTERRUPTED, activeRun.observationError);
          } else if (activeRun) {
            beginMonitor(target, context, {
              restored: true,
              eventStartedAt: Date.parse(text(activeRun.startedAt)) || Date.now(),
              id: text(activeRun.turnId) || upstreamMessageId(randomUUID()),
              startedAt: text(activeRun.startedAt)
            }, options);
          }
          results.push({ ok: true, resumed: Boolean(activeRun && !activeRun.observationError), sessionId });
        } catch (error) {
          results.push({ error: text(error?.message), ok: false, sessionId });
        }
      }
      return {
        failed: results.filter((result) => result.ok === false),
        ok: results.every((result) => result.ok),
        results,
        sessionCount: results.length
      };
    },
    releaseProcessExitProof,
    runDetachedChatTurn,
    seedSessionRenewalHandover,
    sendMessage,
    inspectMessageAdmission,
    async sessionState(sessionId, options = {}) {
      const context = await contextFor(sessionId, options);
      const target = processes.get(context.key);
      const threadId = target?.upstreamSessionId ||
        storedUpstreamSessionId(context);
      return {
        ok: true,
        terminal: terminalSnapshot(context.sessionId, target?.terminalSessionId),
        thread: { id: threadId },
        turn: openCodeTurnSnapshot(turns.get(context.key), threadId),
        workdir: context.workdir
      };
    },
    async startConversationTurn(sessionId, input = {}, options = {}) {
      return runDetachedChatTurn(sessionId, input, options, { waitForCompletion: false });
    },
    startTerminal,
    async stopConversation(sessionId, input = {}, options = {}) {
      const { conversationId, target, tracked } = await existingDetachedTarget(sessionId, input, options);
      if (!target) {
        return { conversationId, ok: true, stopped: false };
      }
      try {
        if (tracked?.active && tracked.error) {
          await stopUnobservedOpenCodeSession(target, conversationId);
        } else {
          const confirmed = await target.server.client.interrupt(conversationId, {
            signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
          });
          const status = input.persistent ? await target.server.client.sessionStatus(conversationId, {
            signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
          }) : null;
          if (confirmed !== true || status && status.type !== "idle") {
            throw openCodeError("vibe64_opencode_interrupt_unconfirmed", "OpenCode did not confirm Stop. Try Stop again.", {}, 502);
          }
        }
      } catch (error) {
        if (input.persistent && error.statusCode === 404) return { conversationId, ok: true, stopped: true };
        if (error?.name === "TimeoutError") {
          throw openCodeError("vibe64_opencode_interrupt_timeout", "OpenCode did not confirm Stop within 5 seconds. Try Stop again.", {}, 504);
        }
        throw error;
      }
      if (tracked) {
        tracked.interrupted = true;
        tracked.abortController?.abort();
        await tracked.completion?.catch(() => null);
        tracked.active = false;
      }
      return { conversationId, ok: true, stopped: true };
    },
    streamDetachedChatTurn: runDetachedChatTurn,
    subscribeTerminal,
    async waitForConversationTurn(sessionId, input = {}, options = {}) {
      const { conversationId, target, tracked } = await existingDetachedTarget(sessionId, input, options);
      if (!target) {
        throw openCodeReadUnavailable();
      }
      if (tracked?.completion && (tracked.executionProfile || !input.timeoutMs)) {
        return tracked.completion;
      }
      await waitForOpenCodeMessages(target.server.client, conversationId, tracked?.runId || "", {
        signal: input.timeoutMs ? AbortSignal.timeout(Number(input.timeoutMs)) : undefined
      });
      return readDetachedConversation(target, conversationId);
    },
    async waitForTurn(sessionId = "", options = {}) {
      const context = await contextFor(sessionId, options);
      return monitors.get(context.key) || openCodeTurnSnapshot(turns.get(context.key));
    },
    verifyConnection,
    resizeTerminal,
    writeTerminal
  });
}

export {
  OPENCODE_AGENT_RUN_ID,
  OPENCODE_CATALOG_CACHE_MS,
  createOpenCodeTerminalController,
  upstreamMessageId
};
