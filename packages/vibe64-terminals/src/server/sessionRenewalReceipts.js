import { openCodeModel } from "@jskit-ai/assistant-core/server/opencode-process";
import { openCodeMessageError } from "./openCodeConversationEvents.js";
import { upstreamMessageId, writeOpenCodeSessionMetadata as writeSessionMetadata } from "./openCodeConversationStorage.js";
import { openCodeError } from "./terminalShared.js";
import {
  defineSessionRenewalApprovedHandover,
  defineSessionRenewalOperationId,
  sessionRenewalClientMessageId,
  parseSessionRenewalAcknowledgement,
  parseSessionRenewalHandoverOutput,
  prepareSessionRenewalHandoverRequest,
  prepareSessionRenewalSeedRequest,
  sessionRenewalAcknowledgementOutputSchema,
  sessionRenewalHandoverPrompt,
  sessionRenewalProtocolError,
  sessionRenewalSeedPrompt
} from "./sessionRenewalHandover.js";
import {
  codexAppServerRenewalResumePreparation,
  codexAppServerRenewalSeedPreparation,
  codexAppServerTurnSettings
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import { effectiveVibe64AgentSettings as codexEffectiveAgentSettings } from "@local/vibe64-runtime/shared";
import { codexAgentSettingsFromSession } from "./codexRuntimeHost.js";

// Original application renewal receipt, error and completion policy. This module
// consumes the existing session store and native result; it never invokes a provider.
function normalizeText(value) {
  return String(value || "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function errorMessage(value, fallback = "Codex could not be prepared.") {
  return normalizeText(value?.error || value?.message || value) || fallback;
}

function sessionRenewalErrorWithIdentity(error, identity = {}) {
  const source = error instanceof Error ? error : new Error(errorMessage(error));
  if (!normalizeText(source.code)) {
    source.code = "vibe64_session_renewal_turn_failed";
    source.retryable = true;
  }
  source.details = {
    ...(isRecord(source.details) ? source.details : {}),
    clientMessageId: normalizeText(identity.clientMessageId),
    ...(identity.handoverPromptAccepted === true
      ? { handoverPromptAccepted: true }
      : {}),
    operationId: normalizeText(identity.operationId),
    retryable: source.retryable === true,
    threadId: normalizeText(identity.threadId),
    turnId: normalizeText(identity.turnId)
  };
  return source;
}

async function writeSessionRenewalMetadata(runtime, sessionId = "", values = {}, {
  renewalInternal = false
} = {}) {
  const entries = Object.entries(isRecord(values) ? values : {})
    .map(([name, value]) => [normalizeText(name), normalizeText(value)])
    .filter(([name]) => name.startsWith("agent_renewal_"));
  if (!entries.length) {
    return;
  }
  const mutateSession = renewalInternal
    ? runtime.store.mutateSessionForRenewal?.bind(runtime.store)
    : runtime.store.mutateSession?.bind(runtime.store);
  const writeMetadataValue = renewalInternal
    ? runtime.store.writeMetadataValueForRenewal?.bind(runtime.store)
    : runtime.store.writeMetadataValue?.bind(runtime.store);
  if (typeof mutateSession !== "function" || typeof writeMetadataValue !== "function") {
    throw new TypeError(renewalInternal
      ? "Renewed assistant metadata requires explicit internal renewal access."
      : "Assistant renewal metadata access is unavailable.");
  }
  await mutateSession(sessionId, async () => {
    await Promise.all(entries.map(([name, value]) => (
      writeMetadataValue(sessionId, name, value)
    )));
  });
}

function codexSessionRenewalTurnError(reason, details = {}, providerMessage) {
  if (reason === "handover_turn_missing") {
    return sessionRenewalProtocolError(
      "vibe64_session_renewal_thread_unreadable",
      "The exact handover turn is no longer readable. Write or edit the handover manually instead.",
      { reason: "exact_handover_turn_missing" },
      { retryable: false }
    );
  }
  if (reason === "handover_history_missing") {
    return sessionRenewalProtocolError(
      "vibe64_session_renewal_thread_unreadable",
      "The old assistant thread has no readable conversation history. Write or edit the handover manually instead.",
      {},
      { retryable: false }
    );
  }
  if (reason === "seed_turn_missing") {
    return sessionRenewalProtocolError(
      "vibe64_session_renewal_turn_unreadable",
      "The exact successor acknowledgement turn is no longer readable.",
      {},
      { retryable: false }
    );
  }
  if (reason === "seed_unrelated_history") {
    return sessionRenewalProtocolError(
      "vibe64_session_renewal_fresh_thread_required",
      "The successor assistant thread contains unrelated conversation and cannot be used for renewal."
    );
  }
  if (reason === "seed_identity_missing") {
    return sessionRenewalProtocolError(
      "vibe64_session_renewal_turn_identity_missing",
      "Codex accepted the successor handover without returning its exact turn id.",
      details
    );
  }
  if (reason === "identity_missing" || reason === "handover_identity_missing") {
    return sessionRenewalProtocolError(
      "vibe64_session_renewal_turn_identity_missing",
      reason === "handover_identity_missing"
        ? "Codex accepted the handover request without returning its exact turn id."
        : "Codex did not return the exact session renewal turn identity.",
      details
    );
  }
  return sessionRenewalProtocolError(
    "vibe64_session_renewal_turn_failed",
    providerMessage || `Codex session renewal turn ${details.status}.`,
    details,
    { retryable: true }
  );
}

function sessionRenewalHandoverTurnId(input, session, operationId) {
  const metadata = session.metadata || {};
  const sameOperation = normalizeText(metadata.agent_renewal_handover_operation_id) === operationId;
  const expectedTurnId = normalizeText(input.expectedTurnId) || (
    sameOperation ? normalizeText(metadata.agent_renewal_handover_turn_id) : ""
  );
  return expectedTurnId;
}

function sessionRenewalSeedTurnId(input, session, operationId, threadId) {
  const currentSession = {
    ...session,
    metadata: {
      ...(session.metadata || {}),
      agent_identity_conversation_id: threadId,
      agent_renewal_seed_operation_id: operationId
    }
  };
  const metadata = currentSession.metadata;
  const sameOperation = normalizeText(metadata.agent_renewal_seed_operation_id) === operationId;
  const expectedTurnId = normalizeText(input.expectedTurnId) || (
    sameOperation ? normalizeText(metadata.agent_renewal_seed_turn_id) : ""
  );
  return expectedTurnId;
}

function writeSessionRenewalHandoverTurnMetadata(runtime, sessionId, values) {
  const names = {
    clientMessageId: "agent_renewal_handover_client_message_id",
    operationId: "agent_renewal_handover_operation_id",
    threadId: "agent_renewal_handover_thread_id",
    turnId: "agent_renewal_handover_turn_id"
  };
  return writeSessionRenewalMetadata(runtime, sessionId,
    Object.fromEntries(Object.entries(values).map(([name, value]) => [names[name], value])));
}

function writeSessionRenewalSeedTurnMetadata(runtime, sessionId, values) {
  const names = {
    clientMessageId: "agent_renewal_seed_client_message_id",
    operationId: "agent_renewal_seed_operation_id",
    threadId: "agent_renewal_seed_thread_id",
    turnId: "agent_renewal_seed_turn_id"
  };
  return writeSessionRenewalMetadata(runtime, sessionId,
    Object.fromEntries(Object.entries(values).map(([name, value]) => [names[name], value])),
    { renewalInternal: true });
}

async function completeSessionRenewalHandover({
  runtime, sessionId, clientMessageId, operationId, source, effectiveSettings
}, execution) {
  if (Object.hasOwn(execution, "response")) return execution.response;
  const { result, reconciled, threadId, turnId } = execution;
  let parsed = null;
  try {
    parsed = parseSessionRenewalHandoverOutput(result.text, { source });
  } catch (error) {
    error.details = {
      ...(isRecord(error.details) ? error.details : {}),
      rawOutput: normalizeText(result.text)
    };
    throw sessionRenewalErrorWithIdentity(error, {
      clientMessageId,
      operationId,
      threadId,
      turnId: result.turnId || turnId
    });
  }
  await writeSessionRenewalMetadata(runtime, sessionId, {
    agent_renewal_handover_hash: parsed.handoverHash,
    agent_renewal_handover_turn_id: result.turnId || turnId
  });
  return {
    ...parsed,
    agentSettings: effectiveSettings,
    clientMessageId,
    ok: true,
    operationId,
    reconciled,
    source,
    threadId,
    turnId: normalizeText(result.turnId || turnId),
    usage: result.usage || null
  };
}

async function completeSessionRenewalSeed({
  runtime, sessionId, clientMessageId, operationId, approved, effectiveSettings
}, execution) {
  const { result, reconciled, threadId, turnId, freshThread } = execution;
  let acknowledgement = null;
  try {
    acknowledgement = parseSessionRenewalAcknowledgement(result.text, {
      handoverHash: approved.handoverHash,
      source: approved.source
    });
  } catch (error) {
    error.details = {
      ...(isRecord(error.details) ? error.details : {}),
      rawOutput: normalizeText(result.text)
    };
    throw sessionRenewalErrorWithIdentity(error, {
      clientMessageId,
      handoverPromptAccepted: true,
      operationId,
      threadId,
      turnId: result.turnId || turnId
    });
  }
  const acknowledgedAt = new Date().toISOString();
  if (
    typeof runtime.store.mutateSessionForRenewal !== "function" ||
    typeof runtime.store.writeMetadataValueForRenewal !== "function"
  ) {
    throw new TypeError("Renewed assistant acknowledgement requires explicit internal renewal metadata access.");
  }
  await runtime.store.mutateSessionForRenewal(sessionId, async () => {
    const writeMetadataValue = runtime.store.writeMetadataValueForRenewal.bind(runtime.store);
    await Promise.all([
      writeMetadataValue(sessionId, "agent_briefing_delivered", "yes"),
      writeMetadataValue(sessionId, "agent_briefing_delivered_at", acknowledgedAt),
      writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server"),
      writeMetadataValue(sessionId, "agent_settings_model", effectiveSettings.model),
      writeMetadataValue(sessionId, "agent_settings_provider", effectiveSettings.providerId),
      writeMetadataValue(sessionId, "agent_settings_thinking", effectiveSettings.thinking),
      writeMetadataValue(sessionId, "agent_renewal_seed_acknowledged_at", acknowledgedAt),
      writeMetadataValue(sessionId, "agent_renewal_seed_handover_hash", approved.handoverHash),
      writeMetadataValue(sessionId, "agent_renewal_seed_operation_id", operationId),
      writeMetadataValue(sessionId, "agent_renewal_seed_thread_id", threadId),
      writeMetadataValue(sessionId, "agent_renewal_seed_turn_id", result.turnId || turnId)
    ]);
  });
  // The successor remains intentionally hidden until the sessions service
  // commits its renewal transition. Ordinary subscription and realtime
  // reconciliation start only after that transition exposes the session.
  return {
    acknowledgement,
    acknowledgedAt,
    agentSettings: effectiveSettings,
    clientMessageId,
    freshThread,
    handoverHash: approved.handoverHash,
    ok: true,
    operationId,
    reconciled,
    source: approved.source,
    subscriptionDeferred: true,
    threadId,
    turnId: normalizeText(result.turnId || turnId),
    usage: result.usage || null
  };
}

async function completeClaudeSessionRenewalHandover({ input, prepared, context, metadata, contextFor }, nativeResult) {
  const result = { ...nativeResult, operationId: prepared.operationId, source: input.source };
  const parsed = parseSessionRenewalHandoverOutput(result.text, { source: input.source });
  await metadata(await contextFor(context), {
    agent_renewal_handover_hash: parsed.handoverHash, agent_renewal_handover_operation_id: result.operationId,
    agent_renewal_handover_thread_id: result.threadId, agent_renewal_handover_turn_id: result.turnId
  });
  return { ...result, ...parsed, ok: true };
}

async function completeClaudeSessionRenewalSeed({ input, prepared, context, metadata, contextFor, approved, now, transport: TRANSPORT }, nativeResult) {
  const result = { ...nativeResult, operationId: prepared.operationId, source: input.source };
  let acknowledgement;
  try { acknowledgement = parseSessionRenewalAcknowledgement(result.text, approved); }
  catch (failure) {
    failure.details = { ...failure.details, clientMessageId: result.clientMessageId, handoverPromptAccepted: true,
      threadId: result.threadId, turnId: result.turnId };
    throw failure;
  }
  const acknowledgedAt = now();
  await metadata(await contextFor(context), {
    agent_briefing_delivered: "yes", agent_briefing_delivered_at: acknowledgedAt, agent_briefing_transport: TRANSPORT,
    agent_renewal_seed_acknowledged_at: acknowledgedAt, agent_renewal_seed_handover_hash: approved.handoverHash,
    agent_renewal_seed_operation_id: result.operationId, agent_renewal_seed_thread_id: result.threadId,
    agent_renewal_seed_turn_id: result.turnId
  });
  return { ...result, acknowledgement, acknowledgedAt, handoverHash: approved.handoverHash, ok: true, subscriptionDeferred: true };
}

async function completeOpenCodeSessionRenewalHandover({ input, operationId, clientMessageId, context, writeSessionMetadata }, nativeResult) {
  const result = { ...nativeResult, clientMessageId };
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

function createOpenCodeSessionRenewalSeedReceipt({ operationId, approved, clientMessageId, context, writeSessionMetadata }) {
  let acknowledgement = null;
  let acknowledgedAt = "";

  async function acknowledge(result) {
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
    acknowledgedAt = new Date().toISOString();
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
  }

  async function complete(nativeResult) {
    const result = { ...nativeResult, clientMessageId };
    const proof = result.processExitProof;
    return {
      ...result,
      acknowledgement,
      acknowledgedAt,
      freshThread: result.freshThread,
      handoverHash: approved.handoverHash,
      ok: proof?.exited !== false,
      operationId,
      processExitProof: proof,
      source: approved.source,
      subscriptionDeferred: true
    };
  }

  return { acknowledge, complete };
}

const CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS = 10 * 60_000;

// The existing application facilities are captured once; session/native facts,
// metadata and result writers are still evaluated at their original lazy phases.
function createCodexSessionRenewalPreparation({ runtimeHost, sessionRuntimeHost, sessionEnvironment }) {
  const { codexAppServerRuntimeOptionsFromSessionMetadata, codexAppServerPersistedRuntimeHost } = runtimeHost;
  const { codexAppServerRuntimeOptionsForSession } = sessionRuntimeHost;
  const { vibe64SessionContextInput } = sessionEnvironment;

  function prepareRenewalProcessExitProof(session = {}) {
    return {
      read() {
        const runtimeOptions = codexAppServerRuntimeOptionsFromSessionMetadata(session);
        if (!runtimeOptions) {
          return { value: {
            alreadyReleased: true,
            ok: true,
            released: true,
            runtimeRecorded: false
          } };
        }
        return {
          runtimeOptions,
          get persistedRuntimeHost() { return codexAppServerPersistedRuntimeHost(session, runtimeOptions); },
          complete({ sharedProcessRetained, existed, result }) {
            if (sharedProcessRetained) {
              return { ok: true, released: true, runtimeRecorded: true, sharedProcessRetained: true };
            }
            if (!existed) {
              return {
                alreadyReleased: true,
                ok: true,
                released: true,
                runtimeDir: runtimeOptions.runtimeDir,
                runtimeRecorded: true
              };
            }
            if (result.runtimeDirExists) {
              const error = new Error("The verified Codex process-exit proof could not be released.");
              error.code = "vibe64_session_renewal_process_exit_proof_release_failed";
              error.retryable = true;
              error.details = result;
              throw error;
            }
            return {
              ...result,
              alreadyReleased: false,
              ok: true,
              released: true,
              runtimeDir: runtimeOptions.runtimeDir,
              runtimeRecorded: true
            };
          }
        };
      }
    };
  }

  function codexAppServerRenewalAgentSettings(session = {}) {
    // Renewal is continuity work, never a caller-selectable low-cost task.
    // Preserve the session's recorded interactive settings and otherwise let
    // the ordinary high-quality Codex defaults apply.
    return codexAgentSettingsFromSession(session);
  }

  function prepareCodexRenewalHandover(sessionId = "", input = {}, {
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    const { operationId, source, clientMessageId } = prepareSessionRenewalHandoverRequest(input);
    return {
      context: { runtime: resolvedRuntime, session: resolvedSession },
      async turn(context) {
        const {
          executionRoot,
          provider,
          runtime,
          session,
          toolHomeSource,
          workdir
        } = context;
        const agentSettings = codexAppServerRenewalAgentSettings(session);
        const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
        const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
          runtime,
          executionRoot,
          toolHomeSource,
          workdir
        });
        return {
          input: {
            clientMessageId, operationId,
            timeoutMs: CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS,
            get prompt() { return sessionRenewalHandoverPrompt({ source }); }
          },
          context: {
            runtime,
            provider,
            providerOptions,
            executionRoot,
            workdir,
            get threadPreparation() {
              return codexAppServerRenewalResumePreparation({
                agentSettings,
                hostContext: vibe64SessionContextInput(),
                expectedThreadId: input.expectedThreadId || input.threadId,
                provider,
                session,
                workdir
              });
            },
            readExpectedTurnId() {
              return sessionRenewalHandoverTurnId(input, session, operationId);
            },
            get turnSettings() { return codexAppServerTurnSettings({ agentSettings, cwd: workdir }); },
            writeMetadata(values) {
              return writeSessionRenewalHandoverTurnMetadata(runtime, sessionId, values);
            },
            errors: { create: codexSessionRenewalTurnError, withIdentity: sessionRenewalErrorWithIdentity }
          },
          completeResult(execution) {
            return completeSessionRenewalHandover({
              runtime, sessionId, clientMessageId, operationId, source, effectiveSettings
            }, execution);
          }
        };
      }
    };
  }

  function prepareCodexRenewalSeed(sessionId = "", input = {}, {
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    const { operationId, approved, oldThreadId, clientMessageId } = prepareSessionRenewalSeedRequest(input);
    return {
      context: { runtime: resolvedRuntime, session: resolvedSession },
      turn(context) {
        const {
          provider,
          runtime,
          session,
          workdir
        } = context;
        const agentSettings = codexAppServerRenewalAgentSettings(session);
        const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
        return {
          input: {
            clientMessageId, operationId,
            timeoutMs: CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS,
            get outputSchema() {
              return sessionRenewalAcknowledgementOutputSchema({
                handoverHash: approved.handoverHash,
                source: approved.source
              });
            },
            get prompt() { return sessionRenewalSeedPrompt(approved); }
          },
          context: {
            provider,
            get threadPreparation() {
              return codexAppServerRenewalSeedPreparation({
                additionalMetadata: {
                  agent_renewal_seed_handover_hash: approved.handoverHash
                },
                agentSettings,
                hostContext: vibe64SessionContextInput(),
                expectedThreadId: input.expectedThreadId || input.threadId,
                forbiddenThreadId: oldThreadId,
                operationId,
                provider,
                readOnly: true,
                runtime,
                session,
                workdir
              });
            },
            readExpectedTurnId(threadId) {
              return sessionRenewalSeedTurnId(input, session, operationId, threadId);
            },
            get turnSettings() { return codexAppServerTurnSettings({ agentSettings, cwd: workdir }); },
            writeMetadata(values) {
              return writeSessionRenewalSeedTurnMetadata(runtime, sessionId, values);
            },
            errors: { create: codexSessionRenewalTurnError, withIdentity: sessionRenewalErrorWithIdentity }
          },
          completeResult(execution) {
            return completeSessionRenewalSeed({
              runtime, sessionId, clientMessageId, operationId, approved, effectiveSettings
            }, execution);
          }
        };
      }
    };
  }

  return { prepareCodexRenewalHandover, prepareCodexRenewalSeed, prepareRenewalProcessExitProof };
}

function createOpenCodeSessionRenewalPreparation({ mainMessagePreparation, hostPreparation, lifecyclePreparation }) {
  const text = (value = "") => String(value ?? "").trim();
  const { contextFor } = mainMessagePreparation;
  const { prepareProcess, upstreamSessionOptions } = hostPreparation;
  const { processRelease } = lifecyclePreparation;
  const OPENCODE_RENEWAL_TIMEOUT_MS = 3 * 60 * 1000;

  function prepareRenewalTurn(target = {}, input = {}, renewal = {}) {
    const { clientMessageId = "" } = input;
    return { input: {
      inputMessageId: upstreamMessageId(clientMessageId),
      get prompt() { return input.prompt; },
      agent: text(target.selection?.agentId), model: openCodeModel(target.selection),
      timeoutMs: OPENCODE_RENEWAL_TIMEOUT_MS, readError: openCodeMessageError,
      createError(reason, message, { inputAccepted, ...details }) {
        if (reason === "thread_mismatch") {
          return openCodeError("vibe64_session_renewal_thread_mismatch",
            "The OpenCode predecessor history changed before handover generation.", details);
        }
        if (reason === "fresh_thread_required") {
          return openCodeError("vibe64_session_renewal_fresh_thread_required",
            "The renewed OpenCode session does not own the expected fresh native history.", details);
        }
        if (reason === "unrelated_history") {
          return openCodeError("vibe64_session_renewal_fresh_thread_required",
            "The successor OpenCode history contains unrelated conversation and cannot be used for renewal.", details);
        }
        return openCodeError(`vibe64_session_renewal_turn_${reason}`, message || (reason === "unreadable"
          ? "The exact OpenCode renewal turn did not produce a readable result."
          : "OpenCode did not finish the session renewal turn."),
        { clientMessageId, handoverPromptAccepted: inputAccepted, ...details }, 502);
      }
    }, options: renewal };
  }

  async function prepareRenewalHandover(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const context = await contextFor(sessionId, options);
    return {
      process: () => prepareProcess(context, options),
      session: () => upstreamSessionOptions(context),
      turn(target) {
        const clientMessageId = sessionRenewalClientMessageId("handover", operationId);
        const prepared = prepareRenewalTurn(target, {
          clientMessageId,
          get prompt() { return sessionRenewalHandoverPrompt({ source: input.source }); }
        }, { expectedThreadId: text(input.expectedThreadId) });
        return { ...prepared, completeResult: nativeResult => completeOpenCodeSessionRenewalHandover({
          input, operationId, clientMessageId, context, writeSessionMetadata
        }, nativeResult) };
      }
    };
  }

  async function prepareRenewalSeed(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const approved = defineSessionRenewalApprovedHandover({
      handover: input.handover,
      handoverHash: input.handoverHash,
      source: input.source
    });
    const context = await contextFor(sessionId, options);
    return {
      process: () => prepareProcess(context, options),
      session: () => upstreamSessionOptions(context),
      turn(target) {
        const clientMessageId = sessionRenewalClientMessageId("seed", operationId);
        const receipt = createOpenCodeSessionRenewalSeedReceipt({
          operationId, approved, clientMessageId, context, writeSessionMetadata
        });
        const prepared = prepareRenewalTurn(target, {
          clientMessageId,
          get prompt() { return sessionRenewalSeedPrompt(approved); }
        }, {
          expectedThreadId: text(input.expectedThreadId),
          forbiddenThreadId: text(input.forbiddenThreadId || input.oldThreadId),
          requireFreshHistory: true,
          completeResult: receipt.acknowledge
        });
        return { ...prepared, release: processRelease, completeResult: receipt.complete };
      }
    };
  }

  return { prepareRenewalHandover, prepareRenewalSeed };
}

export {
  createOpenCodeSessionRenewalPreparation,
  createCodexSessionRenewalPreparation,
  completeClaudeSessionRenewalHandover,
  completeClaudeSessionRenewalSeed,
  completeOpenCodeSessionRenewalHandover,
  createOpenCodeSessionRenewalSeedReceipt,
  codexSessionRenewalTurnError,
  completeSessionRenewalHandover,
  completeSessionRenewalSeed,
  sessionRenewalErrorWithIdentity,
  sessionRenewalHandoverTurnId,
  sessionRenewalSeedTurnId,
  writeSessionRenewalHandoverTurnMetadata,
  writeSessionRenewalSeedTurnMetadata
};
