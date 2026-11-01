import {
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
import { effectiveVibe64AgentSettings } from "@local/vibe64-runtime/shared";
import { codexAgentSettingsFromSession } from "./codexRuntimeHost.js";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

// Session renewal receipts, errors and completion for Codex and Claude, and Codex's renewal turn preparation. This
// module consumes the session store and the native result; it never invokes a provider.

/**
 * The renewal turn's failure as an Error carrying its turn identity in details.
 * @param {unknown} error
 * @param {object} [identity]
 */
function sessionRenewalErrorWithIdentity(error, identity = {}) {
  const source = error instanceof Error
    ? error
    : new Error(normalizeText(error?.error || error?.message || error) || "Codex could not be prepared.");
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

/**
 * Writes the agent_renewal_* entries of values in one session mutation, through the given store access.
 * @param {string} sessionId
 * @param {object} values
 * @param {Vibe64SessionStore["mutateSession"]} mutateSession
 * @param {Vibe64SessionStore["writeMetadataValue"]} writeMetadataValue
 */
async function writeRenewalMetadataEntries(sessionId, values, mutateSession, writeMetadataValue) {
  const entries = Object.entries(isRecord(values) ? values : {})
    .map(([name, value]) => [normalizeText(name), normalizeText(value)])
    .filter(([name]) => name.startsWith("agent_renewal_"));
  if (!entries.length) {
    return;
  }
  await mutateSession(sessionId, async () => {
    await Promise.all(entries.map(([name, value]) => (
      writeMetadataValue(sessionId, name, value)
    )));
  });
}

/**
 * Writes renewal metadata on a visible predecessor session.
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {object} values
 */
function writeSessionRenewalMetadata(runtime, sessionId, values) {
  const { store } = runtime;
  return writeRenewalMetadataEntries(sessionId, values,
    (id, operation) => store.mutateSession(id, operation),
    (id, name, value) => store.writeMetadataValue(id, name, value));
}

/**
 * Writes renewal metadata on a hidden successor session, through the store's internal renewal access.
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {object} values
 */
function writeRenewedSessionMetadata(runtime, sessionId, values) {
  const { store } = runtime;
  return writeRenewalMetadataEntries(sessionId, values,
    (id, operation) => store.mutateSessionForRenewal(id, operation),
    (id, name, value) => store.writeMetadataValueForRenewal(id, name, value));
}

/**
 * The renewal error for a reason the shared native runtime reports. It passes this function by reference and
 * omits details and the provider's message for most reasons.
 * @param {string} reason
 * @param {object} [details]
 * @param {string} [providerMessage]
 */
function codexSessionRenewalTurnError(reason, details = {}, providerMessage = "") {
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

/**
 * The renewed conversation's acknowledgement also delivers its session briefing.
 */
function sessionRenewalSeedAcknowledgementMetadata({ acknowledgedAt, handoverHash, operationId, threadId, transport, turnId }) {
  return {
    agent_briefing_delivered: "yes",
    agent_briefing_delivered_at: acknowledgedAt,
    agent_briefing_transport: transport,
    agent_renewal_seed_acknowledged_at: acknowledgedAt,
    agent_renewal_seed_handover_hash: handoverHash,
    agent_renewal_seed_operation_id: operationId,
    agent_renewal_seed_thread_id: threadId,
    agent_renewal_seed_turn_id: turnId
  };
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
  const metadata = session.metadata || {};
  // A stored seed turn belongs to one operation on one successor thread.
  const sameSeed = normalizeText(metadata.agent_renewal_seed_operation_id) === operationId &&
    normalizeText(metadata.agent_renewal_seed_thread_id) === normalizeText(threadId);
  return normalizeText(input.expectedTurnId) || (
    sameSeed ? normalizeText(metadata.agent_renewal_seed_turn_id) : ""
  );
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
  return writeRenewedSessionMetadata(runtime, sessionId,
    Object.fromEntries(Object.entries(values).map(([name, value]) => [names[name], value])));
}

async function completeSessionRenewalHandover({
  runtime,
  sessionId,
  clientMessageId,
  operationId,
  source,
  effectiveSettings
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
  runtime,
  sessionId,
  clientMessageId,
  operationId,
  approved,
  effectiveSettings
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
  await runtime.store.mutateSessionForRenewal(sessionId, async () => {
    const writeMetadataValue = runtime.store.writeMetadataValueForRenewal.bind(runtime.store);
    await Promise.all([
      ...Object.entries(sessionRenewalSeedAcknowledgementMetadata({
        acknowledgedAt,
        handoverHash: approved.handoverHash,
        operationId,
        threadId,
        transport: "codex_app_server",
        turnId: result.turnId || turnId
      })).map(([name, value]) => writeMetadataValue(sessionId, name, value)),
      writeMetadataValue(sessionId, "agent_settings_model", effectiveSettings.model),
      writeMetadataValue(sessionId, "agent_settings_provider", effectiveSettings.providerId),
      writeMetadataValue(sessionId, "agent_settings_thinking", effectiveSettings.thinking)
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
    agent_renewal_handover_hash: parsed.handoverHash,
    agent_renewal_handover_operation_id: result.operationId,
    agent_renewal_handover_thread_id: result.threadId,
    agent_renewal_handover_turn_id: result.turnId
  });
  return { ...result, ...parsed, ok: true };
}

async function completeClaudeSessionRenewalSeed({
  input,
  prepared,
  context,
  metadata,
  contextFor,
  approved,
  now,
  transport: TRANSPORT
}, nativeResult) {
  const result = { ...nativeResult, operationId: prepared.operationId, source: input.source };
  let acknowledgement;
  try { acknowledgement = parseSessionRenewalAcknowledgement(result.text, approved); }
  catch (failure) {
    failure.details = {
      ...failure.details,
      clientMessageId: result.clientMessageId,
      handoverPromptAccepted: true,
      threadId: result.threadId,
      turnId: result.turnId
    };
    throw failure;
  }
  const acknowledgedAt = now();
  await metadata(await contextFor(context), sessionRenewalSeedAcknowledgementMetadata({
    acknowledgedAt,
    handoverHash: approved.handoverHash,
    operationId: result.operationId,
    threadId: result.threadId,
    transport: TRANSPORT,
    turnId: result.turnId
  }));
  return { ...result, acknowledgement, acknowledgedAt, handoverHash: approved.handoverHash, ok: true, subscriptionDeferred: true };
}

const CODEX_SESSION_RENEWAL_TURN_TIMEOUT_MS = 10 * 60_000;

/**
 * The existing application facilities are captured once; session/native facts,
 * metadata and result writers are still evaluated at their original lazy phases.
 */
function createCodexSessionRenewalPreparation({
  runtimeHost,
  sessionRuntimeHost,
  sessionEnvironment
}) {
  const { codexAppServerRuntimeOptionsFromSessionMetadata, codexAppServerPersistedRuntimeHost } = runtimeHost;
  const { codexAppServerRuntimeOptionsForSession } = sessionRuntimeHost;
  const { vibe64SessionContextInput } = sessionEnvironment;

  function prepareRenewalProcessExitProof(session = {}) {
    return {
      read() {
        const runtimeOptions = codexAppServerRuntimeOptionsFromSessionMetadata(session);
        if (!runtimeOptions) {
          return {
            value: {
              alreadyReleased: true,
              ok: true,
              released: true,
              runtimeRecorded: false
            }
          };
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

  function prepareCodexRenewalHandover(sessionId = "", input = {}, options = {}) {
    const {
      runtime: resolvedRuntime = null,
      session: resolvedSession = null
    } = options;
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
        const effectiveSettings = effectiveVibe64AgentSettings(agentSettings);
        const providerOptions = await codexAppServerRuntimeOptionsForSession(session, {
          runtime,
          executionRoot,
          toolHomeSource,
          workdir
        });
        return {
          input: {
            clientMessageId,
            operationId,
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
              runtime,
              sessionId,
              clientMessageId,
              operationId,
              source,
              effectiveSettings
            }, execution);
          }
        };
      }
    };
  }

  function prepareCodexRenewalSeed(sessionId = "", input = {}, options = {}) {
    const {
      runtime: resolvedRuntime = null,
      session: resolvedSession = null
    } = options;
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
        const effectiveSettings = effectiveVibe64AgentSettings(agentSettings);
        return {
          input: {
            clientMessageId,
            operationId,
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
              runtime,
              sessionId,
              clientMessageId,
              operationId,
              approved,
              effectiveSettings
            }, execution);
          }
        };
      }
    };
  }

  return Object.freeze({
    prepareCodexRenewalHandover,
    prepareCodexRenewalSeed,
    prepareRenewalProcessExitProof
  });
}

export {
  createCodexSessionRenewalPreparation,
  completeClaudeSessionRenewalHandover,
  completeClaudeSessionRenewalSeed,
  sessionRenewalSeedAcknowledgementMetadata,
  sessionRenewalSeedTurnId
};
