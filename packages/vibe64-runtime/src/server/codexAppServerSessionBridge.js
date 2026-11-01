import path from "node:path";

import {
  ensureCodexAppServerThread,
  sendCodexAppServerPrompt,
  resumeExactCodexAppServerThread,
  startFreshCodexAppServerThread,
  defineCodexRenewalThreadIds,
  codexRenewalThreadError
} from "@jskit-ai/assistant-core/server/codex-provider";
import { codexAppServerProjectHookTrustConfig } from "@jskit-ai/assistant-core/server/codex-configuration";

import {
  CODEX_APP_SERVER_PROVIDER_ID,
  codexCliResumeCommand
} from "./codexAppServerProvider.js";
import { vibe64SessionDebugLog } from "./sessionDebugLog.js";

import {
  CODEX_SESSION_AGENT_PROVIDER,
  CODEX_SESSION_APPROVAL_POLICY,
  CODEX_SESSION_MODEL,
  CODEX_SESSION_READ_ONLY_SANDBOX,
  CODEX_SESSION_REASONING_EFFORT,
  CODEX_SESSION_REASONING_SUMMARY,
  CODEX_SESSION_SANDBOX,
  codexAppServerThreadSettings,
  codexAppServerTurnSettings,
  isPlainRecord,
  normalizeWorkdir
} from "./codexAppServerSettings.js";
import {
  assertCodexAppServerHelperCompatibility,
  assertCodexAppServerHelperOutputWithinLimit,
  codexAppServerHelperIsolation,
  codexAppServerHelperThreadResumePreparation,
  codexAppServerHelperThreadResumeSettings,
  codexAppServerHelperThreadSettings,
  codexAppServerHelperThreadStartPreparation,
  codexAppServerHelperThreadStartSettings,
  codexAppServerHelperTurnSettings,
  codexAppServerThreadStartSettings,
  prepareCodexAppServerHelperThreadResumeSettings,
  prepareCodexAppServerHelperThreadStartSettings,
  prepareCodexAppServerHelperTurn,
  resumeCodexAppServerHelperThread,
  sendCodexAppServerHelperTurn,
  startCodexAppServerHelperThread
} from "./codexAppServerHelperThreads.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./runtime.js").Vibe64SessionRuntime} Vibe64SessionRuntime */

const CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE =
  "vibe64_session_renewal_thread_unreadable";
const CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE =
  "vibe64_session_renewal_fresh_thread_required";
const CODEX_SESSION_RENEWAL_BASELINE_METADATA =
  "agent_renewal_seed_thread_baseline";
const CODEX_SESSION_RENEWAL_BASELINE_SCHEMA =
  "vibe64.codex-renewal-thread-baseline.v1";
const CODEX_SESSION_RENEWAL_THREAD_CLAIM_METADATA =
  "agent_renewal_seed_thread_claim";
const CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA =
  "vibe64.codex-renewal-thread-claim.v1";

function codexAppServerRuntimeMetadata(runtime = {}) {
  return {
    endpoint: toText(runtime.endpoint),
    runtimeDir: toText(runtime.runtimeDir),
    socketPath: toText(runtime.socketPath),
    transport: toText(runtime.transport)
  };
}

function codexAppServerIdentityMetadata({
  modelProviderId = "openai",
  appServerRuntime = {},
  capturedAt = new Date().toISOString(),
  terminalSessionId = "",
  threadId = "",
  toolSchemaIdentity,
  workdir = ""
} = {}) {
  const normalizedThreadId = toText(threadId);
  const normalizedWorkdir = normalizeWorkdir(workdir);
  if (!normalizedThreadId || !normalizedWorkdir) {
    throw new Error("Codex app-server identity requires a thread id and workdir.");
  }
  if (toolSchemaIdentity !== undefined && (typeof toolSchemaIdentity !== "string" || !/^[a-f0-9]{64}$/u.test(toolSchemaIdentity))) {
    throw new TypeError("Codex application tool schema identity must be a SHA256 hash.");
  }
  const runtimeMetadata = codexAppServerRuntimeMetadata(appServerRuntime);
  const hostCli = runtimeMetadata.endpoint
    ? codexCliResumeCommand({
        endpoint: runtimeMetadata.endpoint,
        threadId: normalizedThreadId
      }).command
    : "";
  const prefix = modelProviderId === "openai" ? "codex" : `codex_${modelProviderId}`;
  return {
    [`${prefix}_conversation_id`]: normalizedThreadId,
    [`${prefix}_conversation_workdir`]: normalizedWorkdir,
    ...(toolSchemaIdentity !== undefined ? { codex_conversation_tool_schema_identity: toolSchemaIdentity } : {}),
    agent_identity_model_provider: modelProviderId,
    agent_identity_captured_at: capturedAt,
    agent_identity_conversation_id: normalizedThreadId,
    agent_identity_error: "",
    agent_identity_provider: CODEX_SESSION_AGENT_PROVIDER,
    agent_identity_resume_strategy: "provider-native",
    agent_identity_status: "ready",
    agent_identity_terminal_session_id: toText(terminalSessionId),
    agent_identity_updated_at: capturedAt,
    agent_identity_workdir: normalizedWorkdir,
    agent_resume_command: hostCli,
    agent_transport_endpoint: runtimeMetadata.endpoint,
    agent_transport_execution_id: toText(appServerRuntime.executionId),
    agent_transport_id: CODEX_APP_SERVER_PROVIDER_ID,
    agent_transport_kind: runtimeMetadata.transport,
    agent_transport_runtime_dir: runtimeMetadata.runtimeDir,
    agent_transport_socket_path: runtimeMetadata.socketPath
  };
}

/**
 * Records a Codex app-server binding on the session and reports the runtime directory a new sign-in supersedes.
 * @param {object} request
 * @param {Vibe64SessionRuntime} request.runtime
 * @param {string} [request.sessionId]
 * @param {boolean} [request.renewalInternal] writes through the store's renewal-only metadata access
 */
async function writeCodexAppServerIdentityMetadata({
  additionalMetadata = {},
  appServerRuntime = {},
  renewalInternal = false,
  runtime,
  sessionId = "",
  terminalSessionId = "",
  threadId = "",
  toolSchemaIdentity,
  workdir = ""
} = {}) {
  if (toolSchemaIdentity !== undefined && !runtime?.learningScope) {
    throw new TypeError("Codex application tools require an admitted learning session.");
  }
  const supplemental = additionalMetadata &&
    typeof additionalMetadata === "object" &&
    !Array.isArray(additionalMetadata)
    ? Object.fromEntries(Object.entries(additionalMetadata)
        .filter(([name]) => toText(name).startsWith("agent_renewal_"))
        .map(([name, value]) => [toText(name), toText(value)]))
    : {};
  const metadata = {
    ...supplemental,
    ...codexAppServerIdentityMetadata({
      modelProviderId: appServerRuntime.modelProviderId || "openai",
      appServerRuntime,
      terminalSessionId,
      threadId,
      toolSchemaIdentity,
      workdir
    })
  };
  const { store } = runtime;
  const mutateSession = renewalInternal
    ? store.mutateSessionForRenewal.bind(store)
    : store.mutateSession.bind(store);
  const writeMetadataValue = renewalInternal
    ? store.writeMetadataValueForRenewal.bind(store)
    : store.writeMetadataValue.bind(store);
  // A new sign-in gives the session a new runtime directory; the one it
  // recorded before is reported so its owner can release it once stopped.
  const previousRuntimeDir = renewalInternal
    ? ""
    // readable-check: allow optional-call - optional operation: a store without metadata reads has no previous runtime folder
    : toText((await runtime.store.readMetadata?.(sessionId))?.agent_transport_runtime_dir);
  await mutateSession(sessionId, async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      writeMetadataValue(sessionId, name, String(value || ""))
    )));
  });
  return previousRuntimeDir && metadata.agent_transport_runtime_dir &&
    path.resolve(previousRuntimeDir) !== path.resolve(metadata.agent_transport_runtime_dir)
    ? { ...metadata, supersededRuntimeDir: previousRuntimeDir }
    : metadata;
}

function persistedCodexSessionRenewalThreadBaseline(session = {}, options = {}) {
  const {
    operationId = "",
    workdir = ""
  } = options;
  const metadata = isPlainRecord(session.metadata) ? session.metadata : {};
  const rawBaseline = toText(
    metadata[CODEX_SESSION_RENEWAL_BASELINE_METADATA]
  );
  if (!rawBaseline) {
    return null;
  }
  let baseline = null;
  try {
    baseline = JSON.parse(rawBaseline);
  } catch {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread baseline is unreadable."
    );
  }
  const persistedOperationId = toText(baseline?.operationId);
  const persistedWorkdir = normalizeWorkdir(baseline?.workdir);
  if (
    !isPlainRecord(baseline) ||
    toText(baseline.schemaVersion) !== CODEX_SESSION_RENEWAL_BASELINE_SCHEMA ||
    persistedOperationId !== toText(operationId) ||
    persistedWorkdir !== normalizeWorkdir(workdir) ||
    !Array.isArray(baseline.threadIds)
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread baseline does not belong to this exact renewal operation."
    );
  }
  return defineCodexRenewalThreadIds(baseline.threadIds, {
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
  });
}

function persistedCodexSessionRenewalThreadClaim(session = {}, options = {}) {
  const {
    operationId = "",
    workdir = ""
  } = options;
  const metadata = isPlainRecord(session.metadata) ? session.metadata : {};
  const rawClaim = toText(
    metadata[CODEX_SESSION_RENEWAL_THREAD_CLAIM_METADATA]
  );
  if (!rawClaim) {
    return null;
  }
  let claim = null;
  try {
    claim = JSON.parse(rawClaim);
  } catch {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread claim is unreadable."
    );
  }
  const claimedThreadIds = defineCodexRenewalThreadIds([claim?.threadId], {
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
  });
  const claimedOperationId = toText(claim?.operationId);
  const claimedWorkdir = normalizeWorkdir(claim?.workdir);
  if (
    !isPlainRecord(claim) ||
    toText(claim.schemaVersion) !== CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA ||
    claimedOperationId !== toText(operationId) ||
    claimedWorkdir !== normalizeWorkdir(workdir)
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread claim does not belong to this exact renewal operation."
    );
  }
  return Object.freeze({
    operationId: claimedOperationId,
    threadId: claimedThreadIds[0],
    workdir: claimedWorkdir
  });
}

/**
 * Records the threads a renewal starts from, through the store's renewal-only metadata access.
 * @param {object} request
 * @param {Vibe64SessionRuntime} request.runtime
 * @param {string} [request.sessionId]
 */
async function writeCodexSessionRenewalThreadBaseline({
  operationId = "",
  runtime,
  sessionId = "",
  threadIds = [],
  workdir = ""
} = {}) {
  const baseline = JSON.stringify({
    operationId: toText(operationId),
    schemaVersion: CODEX_SESSION_RENEWAL_BASELINE_SCHEMA,
    threadIds: defineCodexRenewalThreadIds(threadIds, {
      errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
    }),
    workdir: normalizeWorkdir(workdir)
  });
  await runtime.store.writeMetadataValueForRenewal(
    sessionId,
    CODEX_SESSION_RENEWAL_BASELINE_METADATA,
    baseline
  );
  return baseline;
}

/**
 * Records the fresh thread a renewal claimed, through the store's renewal-only metadata access.
 * @param {object} request
 * @param {Vibe64SessionRuntime} request.runtime
 * @param {string} [request.sessionId]
 */
async function writeCodexSessionRenewalThreadClaim({
  operationId = "",
  runtime,
  sessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  const [normalizedThreadId] = defineCodexRenewalThreadIds([threadId], {
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
  });
  const claim = JSON.stringify({
    operationId: toText(operationId),
    schemaVersion: CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA,
    threadId: normalizedThreadId,
    workdir: normalizeWorkdir(workdir)
  });
  await runtime.store.writeMetadataValueForRenewal(
    sessionId,
    CODEX_SESSION_RENEWAL_THREAD_CLAIM_METADATA,
    claim
  );
  return claim;
}

function codexAppServerRenewalResumePreparation({
  agentSettings = {},
  hostContext = null,
  expectedThreadId = "",
  provider,
  session = {},
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeWorkdir(workdir);
  const persistedThreadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
  const normalizedExpectedThreadId = toText(expectedThreadId) || persistedThreadId;
  if (!normalizedExpectedThreadId || persistedThreadId !== normalizedExpectedThreadId) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
      "The old assistant thread is no longer the exact readable main thread for this session.",
      {
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId
      }
    );
  }
  return {
    expectedThreadId: normalizedExpectedThreadId,
    provider,
    workdir: normalizedWorkdir,
    errorCode: CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
    projectHooks: true,
    settings(cwd, config) {
      return {
        threadSettings: codexAppServerThreadSettings({ agentSettings, config, cwd, hostContext })
      };
    }
  };
}

async function resumeExactCodexAppServerThreadForSession(options = {}) {
  return resumeExactCodexAppServerThread(codexAppServerRenewalResumePreparation(options));
}

function codexAppServerRenewalSeedPreparation({
  additionalMetadata = {},
  agentSettings = {},
  hostContext = null,
  expectedThreadId = "",
  forbiddenThreadId = "",
  operationId = "",
  provider,
  readOnly = false,
  runtime,
  session = {},
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeWorkdir(workdir);
  const normalizedExpectedThreadId = toText(expectedThreadId);
  const normalizedForbiddenThreadId = toText(forbiddenThreadId);
  const normalizedOperationId = toText(operationId);
  const persistedThreadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
  const persistedOperationId = toText(
    session.metadata?.agent_renewal_seed_operation_id
  );
  const persistedClaim = persistedCodexSessionRenewalThreadClaim(session, {
    operationId: normalizedOperationId,
    workdir: normalizedWorkdir
  });
  const claimedThreadId = toText(persistedClaim?.threadId);
  if (
    persistedOperationId &&
    normalizedOperationId &&
    persistedOperationId !== normalizedOperationId
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session already belongs to a different renewal operation.",
      {
        operationId: normalizedOperationId,
        persistedOperationId
      }
    );
  }
  if (
    (persistedThreadId || persistedOperationId || normalizedExpectedThreadId) &&
    !claimedThreadId
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session has assistant identity metadata without its atomic renewal thread claim.",
      {
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId,
        persistedOperationId
      }
    );
  }
  if (
    claimedThreadId &&
    (
      (persistedThreadId && persistedThreadId !== claimedThreadId) ||
      (normalizedExpectedThreadId && normalizedExpectedThreadId !== claimedThreadId)
    )
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session already owns a different assistant thread; Vibe64 will not reuse or replace it.",
      {
        claimedThreadId,
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId
      }
    );
  }
  return {
    provider,
    resumableThreadId: claimedThreadId,
    forbiddenThreadId: normalizedForbiddenThreadId,
    operationId: normalizedOperationId,
    workdir: normalizedWorkdir,
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
    applicationName: "Vibe64",
    projectHooks: true,
    settings(cwd, config) {
      const ordinaryThreadSettings = codexAppServerThreadSettings({ agentSettings, config, cwd, hostContext });
      const ordinaryThreadStartSettings = codexAppServerThreadStartSettings({ agentSettings, config, cwd, hostContext });
      return {
        threadSettings: readOnly
          ? { ...ordinaryThreadSettings, sandbox: CODEX_SESSION_READ_ONLY_SANDBOX }
          : ordinaryThreadSettings,
        threadStartSettings: readOnly
          ? { ...ordinaryThreadStartSettings, sandbox: CODEX_SESSION_READ_ONLY_SANDBOX }
          : ordinaryThreadStartSettings
      };
    },
    identity: {
      readBaseline: () => persistedCodexSessionRenewalThreadBaseline(session, {
        operationId: normalizedOperationId,
        workdir: normalizedWorkdir
      }),
      writeBaseline: (threadIds) => writeCodexSessionRenewalThreadBaseline({
        operationId: normalizedOperationId,
        runtime,
        sessionId: session.sessionId,
        threadIds,
        workdir: normalizedWorkdir
      }),
      async write({ appServerRuntime, threadId, workdir: threadWorkdir }) {
        if (!persistedClaim) {
          await writeCodexSessionRenewalThreadClaim({
            operationId: normalizedOperationId,
            runtime,
            sessionId: session.sessionId,
            threadId,
            workdir: threadWorkdir
          });
        }
        await writeCodexAppServerIdentityMetadata({
          additionalMetadata: {
            ...additionalMetadata,
            ...(normalizedOperationId
              ? { agent_renewal_seed_operation_id: normalizedOperationId }
              : {}),
            agent_renewal_seed_thread_id: threadId
          },
          appServerRuntime,
          renewalInternal: true,
          runtime,
          sessionId: session.sessionId,
          threadId,
          workdir: threadWorkdir
        });
      }
    }
  };
}

async function startFreshCodexAppServerThreadForSession(options = {}) {
  return startFreshCodexAppServerThread(codexAppServerRenewalSeedPreparation(options));
}

function codexAppServerThreadIdForSession(session = {}, workdir = "") {
  const metadata = session.metadata || {};
  // A session without a Codex agent identity uses the codex_conversation_id recorded for this workdir.
  if (metadata.agent_identity_provider !== CODEX_SESSION_AGENT_PROVIDER) {
    return normalizeWorkdir(workdir) && normalizeWorkdir(metadata.codex_conversation_workdir) === normalizeWorkdir(workdir)
      ? toText(metadata.codex_conversation_id) : "";
  }
  if (metadata.agent_transport_id !== CODEX_APP_SERVER_PROVIDER_ID) {
    return "";
  }
  const recordedWorkdir = normalizeWorkdir(metadata.agent_identity_workdir);
  const expectedWorkdir = normalizeWorkdir(workdir);
  if (!recordedWorkdir || !expectedWorkdir || recordedWorkdir !== expectedWorkdir) {
    return "";
  }
  if (metadata.agent_identity_status && metadata.agent_identity_status !== "ready") {
    return "";
  }
  return toText(metadata.agent_identity_conversation_id);
}

function codexAppServerToolSchemaIdentityForSession(session = {}, workdir = "") {
  if (!codexAppServerThreadIdForSession(session, workdir)) return "";
  const identity = session.metadata?.codex_conversation_tool_schema_identity;
  if (identity === undefined || identity === "") return "";
  if (typeof identity !== "string" || !/^[a-f0-9]{64}$/u.test(identity)) {
    throw new TypeError("The saved Codex application tool schema identity is invalid.");
  }
  return identity;
}

/**
 * What preparing the session's Codex app-server thread needs.
 * @param {object} request
 * @param {Vibe64SessionRuntime} request.runtime
 * @param {object} [request.session]
 */
function codexAppServerThreadPreparationForSession({
  agentSettings = {},
  hostContext = null,
  observeThread,
  provider,
  runtime,
  session = {},
  workdir = ""
} = {}) {
  return {
    observeThread,
    provider,
    workdir,
    projectHooks: true,
    settings(normalizedWorkdir, config) {
      const threadSettings = codexAppServerThreadSettings({
        agentSettings,
        config,
        cwd: normalizedWorkdir,
        hostContext
      });
      const threadStartSettings = codexAppServerThreadStartSettings({
        agentSettings,
        config,
        cwd: normalizedWorkdir,
        hostContext
      });
      return { threadSettings, threadStartSettings };
    },
    identity: {
      read: normalizedWorkdir => codexAppServerThreadIdForSession(session, normalizedWorkdir),
      async readToolSchemaIdentity(normalizedWorkdir) {
        const threadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
        if (!threadId) return "";
        const current = { metadata: await runtime.store.readMetadata(session.sessionId) };
        if (codexAppServerThreadIdForSession(current, normalizedWorkdir) !== threadId) {
          throw new Error("The prepared Codex conversation identity changed before its application tools were read.");
        }
        return codexAppServerToolSchemaIdentityForSession(current, normalizedWorkdir);
      },
      get pauseGoal() { return session.metadata?.codex_changeover_pause_goal === "yes"; },
      clearPause() { return runtime.store.writeMetadataValue(session.sessionId, "codex_changeover_pause_goal", ""); },
      write({ appServerRuntime, threadId, toolSchemaIdentity, workdir: threadWorkdir }) {
        return writeCodexAppServerIdentityMetadata({
          appServerRuntime,
          runtime,
          sessionId: session.sessionId,
          threadId,
          toolSchemaIdentity,
          workdir: threadWorkdir
        });
      }
    },
    onStage(event) {
      vibe64SessionDebugLog("server.codexAppServerSessionBridge.thread.stage", {
        durationMs: event.durationMs,
        sessionId: session.sessionId,
        stage: event.stage
      });
    }
  };
}

async function ensureCodexAppServerThreadForSession(options = {}) {
  return ensureCodexAppServerThread(codexAppServerThreadPreparationForSession(options));
}

async function sendCodexAppServerPromptForSession({
  agentSettings = {},
  attachments = [],
  clientUserMessageId = "",
  outputSchema = null,
  provider,
  prompt = "",
  threadId = "",
  readOnly = false,
  workdir = ""
} = {}) {
  return sendCodexAppServerPrompt({
    attachments,
    clientUserMessageId,
    outputSchema,
    provider,
    prompt,
    threadId,
    readOnly
  }, {
    get turnSettings() { return codexAppServerTurnSettings({ agentSettings, cwd: workdir }); }
  });
}

export {
  CODEX_SESSION_AGENT_PROVIDER,
  CODEX_SESSION_APPROVAL_POLICY,
  CODEX_SESSION_MODEL,
  CODEX_SESSION_REASONING_EFFORT,
  CODEX_SESSION_REASONING_SUMMARY,
  CODEX_SESSION_SANDBOX,
  assertCodexAppServerHelperOutputWithinLimit,
  assertCodexAppServerHelperCompatibility,
  codexAppServerHelperThreadResumeSettings,
  codexAppServerHelperThreadSettings,
  codexAppServerHelperThreadStartSettings,
  codexAppServerHelperTurnSettings,
  codexAppServerIdentityMetadata,
  codexAppServerProjectHookTrustConfig,
  codexAppServerThreadIdForSession,
  codexAppServerThreadPreparationForSession,
  codexAppServerToolSchemaIdentityForSession,
  codexAppServerThreadStartSettings,
  codexAppServerThreadSettings,
  codexAppServerTurnSettings,
  codexAppServerHelperIsolation,
  ensureCodexAppServerThreadForSession,
  codexAppServerHelperThreadResumePreparation,
  codexAppServerHelperThreadStartPreparation,
  prepareCodexAppServerHelperThreadResumeSettings,
  prepareCodexAppServerHelperThreadStartSettings,
  prepareCodexAppServerHelperTurn,
  resumeCodexAppServerHelperThread,
  codexAppServerRenewalResumePreparation,
  codexAppServerRenewalSeedPreparation,
  resumeExactCodexAppServerThreadForSession,
  sendCodexAppServerHelperTurn,
  sendCodexAppServerPromptForSession,
  startCodexAppServerHelperThread,
  startFreshCodexAppServerThreadForSession,
  writeCodexAppServerIdentityMetadata
};
