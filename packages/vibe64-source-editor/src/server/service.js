import crypto from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { copyFile, link, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isMissingPathError,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  pathInsideOrEqual
} from "@local/vibe64-core/server/studioProjectContext";
import {
  vibe64ErrorResponse
} from "@local/vibe64-core/server/serverResponses";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  sourceEditorFilePolicy,
  sourceEditorSourceContractPathExcluded
} from "./filePolicy.js";
import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileRequest,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import {
  runVibe64AgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  sessionClosingReason
} from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  createSourceEditorFileObserver
} from "./sourceChangeObserver.js";
import { readStarredFiles, setStarredFile, starredFilesPath } from "./starredFiles.js";

const SOURCE_EDITOR_CONFLICT_CODE = "vibe64_source_editor_conflict";
const SOURCE_EDITOR_FILE_MATCH_LIMIT = 80;
const SOURCE_EDITOR_SEARCH_RESULT_LIMIT = 120;
const SOURCE_EDITOR_SEARCH_TIMEOUT_MS = 6000;
const SOURCE_EDITOR_QUERY_MAX_LENGTH = 240;
const SOURCE_EDITOR_TREE_PAGE_LIMIT = 20;
const SOURCE_EDITOR_RESOLVE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".md"
];
const SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES = 6;
const SOURCE_EDITOR_EXPLANATION_CONTEXT_MAX_CHARS = 12_000;
const SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS = 60_000;
const SOURCE_EDITOR_EXPLANATION_MAX_LINES = 240;
const SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS = 5_000;
const SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS = 4_000;
const SOURCE_EDITOR_FOLLOWUP_CONTEXT_MAX_CHARS = 8_000;
const SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH = 2000;
const SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS = 180_000;
const SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION = "source-explanation-chat-v3";
const SOURCE_EDITOR_EXPLANATION_CLEANUP_FILE = "source-editor-explanation-cleanup.json";
const SOURCE_EDITOR_EXPLANATION_CLEANUP_MAX_AGE_MS = 30 * 60 * 1000;
const SOURCE_EDITOR_EXPLANATION_CACHE_MAX_ENTRIES = 64;
const SOURCE_EDITOR_EXPLANATION_CACHE_TTL_MS = 5 * 60 * 1000;
const SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE = defineVibe64AgentExecutionProfileRequest({
  profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
  workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION
});
const SOURCE_EDITOR_EXPLANATION_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    answer: {
      maxLength: SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS,
      minLength: 1,
      type: "string"
    }
  },
  required: ["answer"],
  type: "object"
});
const SOURCE_EDITOR_FOLLOWUP_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    answer: {
      maxLength: SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS,
      minLength: 1,
      type: "string"
    }
  },
  required: ["answer"],
  type: "object"
});
const sourceEditorExplanationCleanupQueues = new Map();

function isPlainObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sourceEditorExecutionProfileSnapshot(value = null) {
  try {
    return vibe64AgentExecutionProfileAuditSnapshot(value);
  } catch {
    return null;
  }
}

function sourceEditorExecutionProfileFromFailure(value = null) {
  return sourceEditorExecutionProfileSnapshot(value?.executionProfile) ||
    sourceEditorExecutionProfileSnapshot(value?.sourceEditorRejectedThread?.executionProfile) ||
    sourceEditorExecutionProfileSnapshot(value?.details?.executionProfile) ||
    sourceEditorExecutionProfileSnapshot(value?.details?.details?.executionProfile);
}

function requiredSourceEditorExecutionProfile(value = null) {
  const snapshot = sourceEditorExecutionProfileSnapshot(value);
  if (
    !snapshot ||
    snapshot.profileId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.profileId ||
    snapshot.workloadId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.workloadId ||
    !snapshot.providerId ||
    !snapshot.revision ||
    !snapshot.model
  ) {
    throw sourceEditorError(
      "The low-cost assistant required for source explanations did not provide a verified execution profile. Check the selected assistant provider and retry.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      503
    );
  }
  return snapshot;
}

function resolvedSourceEditorExecutionProfile(value = null) {
  requiredSourceEditorExecutionProfile(value);
  // Keep the manager's in-memory provenance object intact until execution.
  // Persistence, cache identity, events, and responses use sanitized snapshots.
  return value;
}

function sourceEditorExecutionProfileRequest() {
  return { ...SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE };
}

function sourceEditorExecutionProfileIdentity(value = null) {
  const snapshot = sourceEditorExecutionProfileSnapshot(value);
  if (
    !snapshot ||
    snapshot.profileId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.profileId ||
    snapshot.workloadId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.workloadId
  ) {
    return "";
  }
  return JSON.stringify([
    snapshot.providerId,
    snapshot.profileId,
    snapshot.workloadId,
    snapshot.revision,
    snapshot.model,
    snapshot.thinking
  ]);
}

function sourceEditorVibe64UserIdentity(vibe64User = null) {
  if (!isPlainObject(vibe64User)) {
    return "";
  }
  const identity = normalizeText(
    vibe64User.username ||
    vibe64User.osUsername ||
    vibe64User.email ||
    vibe64User.id
  ).toLowerCase();
  return identity
    ? crypto.createHash("sha256").update(identity).digest("hex")
    : "";
}

function sourceEditorAgentOperationOptions(context = {}, options = {}, {
  providerId = ""
} = {}) {
  return {
    ...options,
    providerId: normalizeText(providerId || context.agentProviderId),
    runtime: context.runtime || null,
    session: context.session || null,
    vibe64User: context.vibe64User || null
  };
}

async function describeSourceEditorAgentProvider(terminalService = null, context = {}) {
  if (typeof terminalService?.describeAgentProvider !== "function") {
    return null;
  }
  return terminalService.describeAgentProvider({
    runtime: context.runtime || null,
    session: context.session || null,
    vibe64User: context.vibe64User || null
  });
}

async function resolveSourceEditorAgentExecutionProfile(terminalService = null, context = {}) {
  if (typeof terminalService?.resolveAgentExecutionProfile !== "function") {
    throw sourceEditorError(
      "The selected assistant provider cannot resolve the low-cost profile required for source explanations.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      503
    );
  }
  const resolved = await terminalService.resolveAgentExecutionProfile(
    context.sessionId || context.session?.sessionId || context.session?.id,
    sourceEditorExecutionProfileRequest(),
    sourceEditorAgentOperationOptions(context)
  );
  const executionProfile = requiredSourceEditorExecutionProfile(resolved);
  if (executionProfile.providerId !== normalizeText(context.agentProviderId)) {
    throw sourceEditorError(
      "The selected assistant provider returned a low-cost profile for a different provider.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      503
    );
  }
  return resolved;
}

async function sourceEditorCompletedCacheIdentityUnchanged(
  terminalService = null,
  context = {},
  template = null
) {
  const expectedProviderId = normalizeText(context.agentProviderId);
  const expectedAccountIdentitySignature = normalizeText(context.agentAccountIdentitySignature);
  const expectedExecutionProfileIdentity = sourceEditorExecutionProfileIdentity(
    context.agentExecutionProfile
  );
  if (
    !expectedProviderId ||
    !expectedAccountIdentitySignature ||
    !expectedExecutionProfileIdentity ||
    sourceEditorExecutionProfileIdentity(template?.executionProfile) !== expectedExecutionProfileIdentity
  ) {
    return false;
  }
  try {
    const current = await describeSourceEditorAgentProvider(terminalService, context);
    return normalizeText(current?.providerId) === expectedProviderId &&
      normalizeText(current?.accountIdentitySignature) === expectedAccountIdentitySignature &&
      sourceEditorExecutionProfileIdentity(
        await resolveSourceEditorAgentExecutionProfile(terminalService, context)
      ) === expectedExecutionProfileIdentity;
  } catch {
    return false;
  }
}

function sourceEditorFollowupThreadError(error = null) {
  const message = normalizeText(error?.message || error?.error);
  if (!/thread/iu.test(message) || /regenerate this explanation/iu.test(message)) {
    return error;
  }
  return sourceEditorError(
    `${message} Regenerate this explanation before asking another follow-up.`,
    normalizeText(error?.code) || "vibe64_source_explanation_agent_thread_unavailable",
    isPlainObject(error?.details) ? error.details : {},
    Number(error?.statusCode) || 409
  );
}

function sourceEditorFailureWithFollowupThreadRetirement(error = null, retirement = {}) {
  let failure = error;
  if (!failure || typeof failure !== "object" || !Object.isExtensible(failure)) {
    const response = sourceEditorErrorResponse(error);
    failure = sourceEditorError(
      response.error || "The agent could not answer this source explanation follow-up.",
      response.code || "vibe64_source_explanation_agent_failed",
      isPlainObject(response.details) ? response.details : {},
      response.statusCode || 502
    );
  }
  failure.sourceEditorFollowupThreadRetirement = Object.freeze({
    cleanupSucceeded: retirement.cleanupSucceeded === true,
    executionProfile: sourceEditorExecutionProfileSnapshot(retirement.executionProfile),
    threadId: normalizeText(retirement.threadId),
    turnId: normalizeText(retirement.turnId)
  });
  return failure;
}

function sourceEditorFailureWithRejectedThread(error = null, rejectedThread = null) {
  if (!normalizeText(rejectedThread?.threadId)) {
    return error;
  }
  let failure = error;
  if (!failure || typeof failure !== "object" || !Object.isExtensible(failure)) {
    const response = sourceEditorErrorResponse(error);
    failure = sourceEditorError(
      response.error || "The agent could not answer this source explanation chat.",
      response.code || "vibe64_source_explanation_agent_failed",
      isPlainObject(response.details) ? response.details : {},
      response.statusCode || 502
    );
  }
  failure.sourceEditorRejectedThread = Object.freeze({
    executionProfile: sourceEditorExecutionProfileSnapshot(rejectedThread.executionProfile),
    threadId: normalizeText(rejectedThread.threadId),
    turnId: normalizeText(rejectedThread.turnId)
  });
  return failure;
}

function sourceEditorStructuredAnswer(value = "", {
  code = "vibe64_source_explanation_agent_invalid",
  maxChars = SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS
} = {}) {
  let envelope = value;
  if (typeof value === "string") {
    try {
      envelope = JSON.parse(value);
    } catch {
      throw sourceEditorError(
        "The assistant returned an invalid structured explanation.",
        code,
        {},
        502
      );
    }
  }
  const keys = isPlainObject(envelope) ? Object.keys(envelope) : [];
  const answer = keys.length === 1 && keys[0] === "answer" && typeof envelope.answer === "string"
    ? envelope.answer.trim()
    : "";
  if (!answer || answer.length > maxChars) {
    throw sourceEditorError(
      "The assistant returned an invalid structured explanation.",
      code,
      { maxChars },
      502
    );
  }
  return answer;
}

function sourceEditorExplanationCacheKey(context = {}, explanationInput = {}) {
  const range = explanationInput.range || {};
  const executionProfile = requiredSourceEditorExecutionProfile(context.agentExecutionProfile);
  return JSON.stringify([
    normalizeText(context.sessionId),
    normalizeText(context.agentProviderId),
    normalizeText(context.agentAccountIdentitySignature),
    normalizeText(context.agentAccountIdentity),
    sourceEditorExecutionProfileIdentity(executionProfile),
    normalizeText(range.path),
    normalizeText(range.scope),
    positiveInteger(range.startLine, 1),
    positiveInteger(range.startColumn, 1),
    positiveInteger(range.endLine, 1),
    positiveInteger(range.endColumn, 1),
    normalizeText(range.fileHash),
    normalizeText(range.selectedTextHash),
    normalizeText(explanationInput.promptVersion)
  ]);
}

function sourceEditorExplanationCacheTemplate(explanation = {}) {
  const source = normalizeSourceEditorExplanation(explanation);
  const executionProfile = sourceEditorExecutionProfileSnapshot(source.executionProfile);
  if (
    source.status !== "ready" ||
    !source.body.trim() ||
    executionProfile?.profileId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.profileId ||
    executionProfile?.workloadId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.workloadId
  ) {
    return null;
  }
  return Object.freeze({
    body: source.body,
    executionProfile,
    model: executionProfile.model,
    summary: source.summary || sourceEditorExplanationSummary(source.body),
    title: source.title
  });
}

function createSourceEditorExplanationCache({
  now = Date.now
} = {}) {
  const completed = new Map();
  const generations = new Map();
  const inFlight = new Map();
  const currentTime = typeof now === "function" ? now : Date.now;
  let closed = false;

  const forgetGenerationWhenUnused = (key) => {
    if (!completed.has(key) && !inFlight.has(key)) {
      generations.delete(key);
    }
  };
  const deleteCompleted = (key) => {
    completed.delete(key);
    forgetGenerationWhenUnused(key);
  };
  const prune = (nowMs = currentTime()) => {
    for (const [key, record] of completed.entries()) {
      if (record.expiresAt <= nowMs) {
        deleteCompleted(key);
      }
    }
  };
  const remember = (key, token, template) => {
    if (closed || !template || generations.get(key) !== token) {
      return;
    }
    completed.delete(key);
    completed.set(key, {
      expiresAt: currentTime() + SOURCE_EDITOR_EXPLANATION_CACHE_TTL_MS,
      template,
      token
    });
    while (completed.size > SOURCE_EDITOR_EXPLANATION_CACHE_MAX_ENTRIES) {
      deleteCompleted(completed.keys().next().value);
    }
  };
  const read = (key) => {
    prune();
    const record = completed.get(key);
    if (!record || generations.get(key) !== record.token) {
      return null;
    }
    completed.delete(key);
    completed.set(key, record);
    return record.template;
  };

  const run = async (key = "", {
    completedCache = true,
    force = false,
    generate,
    reuse,
    validateCompleted = null
  } = {}) => {
    if (closed) {
      throw sourceEditorError(
        "Source explanation cache is closed.",
        "vibe64_source_explanation_cache_closed",
        {},
        503
      );
    }
    if (typeof generate !== "function" || typeof reuse !== "function") {
      throw new TypeError("Source explanation caching requires generate() and reuse().");
    }

    prune();
    let token = generations.get(key);
    if (force || !token) {
      token = Object.freeze({});
      generations.set(key, token);
    }
    if (force) {
      completed.delete(key);
    } else if (completedCache) {
      const template = read(key);
      if (template) {
        const completedIdentityValid = typeof validateCompleted !== "function" ||
          await validateCompleted(template) === true;
        if (completedIdentityValid) {
          return reuse(template, {
            cacheHit: true,
            coalesced: false
          });
        }
        deleteCompleted(key);
        token = Object.freeze({});
        generations.set(key, token);
      }
    }
    if (!force) {
      const active = inFlight.get(key);
      if (active?.token === token) {
        const template = await active.promise;
        if (template) {
          const completedIdentityValid = !completedCache || typeof validateCompleted !== "function" ||
            await validateCompleted(template) === true;
          if (completedIdentityValid) {
            return reuse(template, {
              cacheHit: true,
              coalesced: true
            });
          }
        }
        return run(key, {
          completedCache,
          force: true,
          generate,
          reuse,
          validateCompleted
        });
      }
    }

    let generated = null;
    const promise = Promise.resolve()
      .then(async () => {
        generated = await generate();
        const template = sourceEditorExplanationCacheTemplate(generated);
        const completedIdentityValid = completedCache && (
          typeof validateCompleted !== "function" || await validateCompleted(generated) === true
        );
        if (completedIdentityValid) {
          remember(key, token, template);
        }
        return template;
      });
    const pending = {
      promise,
      token
    };
    inFlight.set(key, pending);
    try {
      await promise;
      return generated;
    } finally {
      if (inFlight.get(key) === pending) {
        inFlight.delete(key);
        forgetGenerationWhenUnused(key);
      }
    }
  };

  return Object.freeze({
    close() {
      closed = true;
      completed.clear();
      generations.clear();
      inFlight.clear();
    },
    run
  });
}

function createService({
  explanationCacheNow = Date.now,
  explanationFollowupGenerator = null,
  explanationGenerator = null,
  logger = console,
  projectService,
  sourceFileObserver = null,
  terminalService = null,
  temporaryRoot = tmpdir()
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires the Vibe64 Project API.");
  }
  const sourceExplanationGenerator = typeof explanationGenerator === "function"
    ? explanationGenerator
    : (input, options = {}) => generateSourceEditorExplanationWithAgentService(input, {
      ...options,
      terminalService
    });
  const sourceExplanationFollowupGenerator = typeof explanationFollowupGenerator === "function"
    ? explanationFollowupGenerator
    : (explanation, message, options = {}) => generateSourceEditorExplanationFollowupWithAgentService(explanation, message, {
      ...options,
      terminalService
    });
  const explanationChats = new Map();
  const explanationTurns = new Map();
  const explanationCache = createSourceEditorExplanationCache({
    now: explanationCacheNow
  });
  const fileObserver = sourceFileObserver || createSourceEditorFileObserver({
    logger
  });

  async function sourceEditorContext(sessionId = "", {
    agentOperation = false,
    runtime: existingRuntime = null,
    vibe64User = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }

    const runtime = existingRuntime || await projectService.createRuntime({
      sessionId: normalizedSessionId
    });
    const session = await runtime.getSession(normalizedSessionId);
    const closingReason = sessionClosingReason(session);
    if (agentOperation && closingReason) {
      throw sourceEditorError(
        closingReason === "renewing"
          ? "Source explanations are unavailable while this session is renewing."
          : "Source explanations are unavailable while this session is closing.",
        closingReason === "renewing"
          ? "vibe64_session_renewal_quiesced"
          : "vibe64_session_closing",
        {
          reason: closingReason,
          sessionId: normalizedSessionId
        },
        409
      );
    }
    const sourceRoot = sessionSourcePath(session);
    let sourceRootStats = null;
    if (sourceRoot) {
      try {
        sourceRootStats = await sourceEditorPathStats(sourceRoot);
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
    }
    if (!sourceRootStats?.isDirectory()) {
      throw sourceEditorError(
        "Create the session source before opening the editor.",
        "vibe64_source_editor_source_unavailable",
        { sessionId: normalizedSessionId },
        409
      );
    }

    let agentAccountIdentitySignature = "";
    let agentExecutionProfile = null;
    let agentProviderId = "";
    if (agentOperation) {
      if (typeof terminalService?.requireAssistantAccess !== "function") {
        throw sourceEditorError(
          "Assistant authorization is unavailable for source explanations.",
          "vibe64_source_explanation_authorization_unavailable",
          {},
          503
        );
      }
      await terminalService.requireAssistantAccess(normalizedSessionId, {
        runtime,
        session,
        vibe64User
      });
      let provider;
      try {
        provider = await describeSourceEditorAgentProvider(terminalService, {
          runtime,
          session,
          vibe64User
        });
      } catch (error) {
        const causeCode = normalizeText(error?.code);
        const providerError = normalizeText(error?.message);
        const authenticationRequired = /auth|credential|sign.?in|unauthor/iu.test(
          `${causeCode} ${providerError}`
        );
        throw sourceEditorError(
          authenticationRequired
            ? "Source explanations need a verified assistant account. Sign in to or reconnect the selected assistant provider, then retry."
            : "The selected assistant provider could not be verified for source explanations. Check its availability and selected account, then retry.",
          authenticationRequired
            ? "vibe64_source_explanation_agent_auth_required"
            : "vibe64_source_explanation_provider_identity_unavailable",
          {
            causeCode,
            providerError
          },
          503
        );
      }
      agentProviderId = normalizeText(
        provider?.providerId ||
        session?.agentSession?.providerId ||
        session?.metadata?.agent_identity_provider
      );
      agentAccountIdentitySignature = normalizeText(provider?.accountIdentitySignature);
      agentExecutionProfile = await resolveSourceEditorAgentExecutionProfile(terminalService, {
        agentAccountIdentitySignature,
        agentProviderId,
        runtime,
        session,
        sessionId: normalizedSessionId,
        vibe64User
      });
    }

    return {
      agentAccountIdentity: sourceEditorVibe64UserIdentity(vibe64User),
      agentAccountIdentitySignature,
      agentExecutionProfile,
      agentProviderId,
      policy: sourceEditorFilePolicy(),
      runtime,
      session,
      sessionId: normalizedSessionId,
      sourceEditorTempRoot: sourceEditorTempRoot(temporaryRoot, normalizedSessionId),
      sourceRoot,
      vibe64User
    };
  }

  async function runSourceEditorWriteExclusive(input = {}, operation, {
    agentOperation = false
  } = {}) {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const runtime = await projectService.createRuntime({ sessionId });
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      async () => operation(await sourceEditorContext(sessionId, {
        agentOperation,
        runtime,
        vibe64User: input.vibe64User
      })),
      { operation: "source-editor-write" }
    );
    if (!exclusive.acquired) {
      throw sourceEditorError(
        normalizeText(exclusive.value?.error) || "Another source-changing operation is starting. Try again in a moment.",
        normalizeText(exclusive.value?.code) || "vibe64_source_editor_write_busy",
        {},
        409
      );
    }
    return exclusive.value;
  }

  async function runSourceEditorAgentOperation(input = {}, operation) {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const runtime = await projectService.createRuntime({ sessionId });
    const run = async () => operation(await sourceEditorContext(sessionId, {
      agentOperation: true,
      runtime,
      vibe64User: input.vibe64User
    }));
    if (typeof runtime?.store?.runSessionExclusive !== "function") {
      return run();
    }
    // Only turns in the same explanation share mutable conversation state.
    // The session store still checks renewal admission before starting work.
    const conversationKey = crypto.createHash("sha256")
      .update(normalizeText(input.explanationId) || crypto.randomUUID())
      .digest("hex");
    const exclusive = await runtime.store.runSessionExclusive(
      sessionId,
      `source-explanation-${conversationKey}`,
      run
    );
    if (!exclusive.acquired) {
      throw sourceEditorError(
        "This explanation is already answering a question. Try again when it finishes.",
        "vibe64_source_explanation_busy",
        {},
        409
      );
    }
    return exclusive.value;
  }

  // Every Files request enters here inside the trusted project request context.
  // Operations receive a resolved root; neither HTTP bodies nor callers select it.
  async function fileArea(input, operation, { readUpload = null } = {}) {
    return runSourceEditorOperation(async () => {
      const requestContext = currentProjectRequestContext();
      if (!requestContext) {
        throw sourceEditorError("Files require a project request.", "vibe64_files_access_required", {}, 403);
      }
      const owner = !requestContext.vibe64User || requestContext.vibe64User.role === "owner";
      const area = String(input.area || "");
      const writable = area === "drop-zone";
      const reads = ["tree", "file", "download", "archive"];
      const writes = ["upload", "save", "rename", "delete", "mkdir"];
      const writing = writes.includes(operation);
      if (operation !== "areas" && (
        !["session", "drop-zone"].includes(area) || (!reads.includes(operation) && !writing)
      )) {
        throw sourceEditorError("Unknown file area or operation.", "vibe64_files_invalid_area", {}, 404);
      }
      if (area === "session" && !owner) {
        throw sourceEditorError("Only the workspace owner can read Session files.", "vibe64_files_owner_required", {}, 403);
      }
      if (writing && !writable) {
        throw sourceEditorError("Session files are read only.", "vibe64_files_read_only", {}, 403);
      }
      const sessionId = normalizeText(input.sessionId);
      const runtime = await projectService.createRuntime({ sessionId });
      // This store belongs to the URL's project, so IDs from another project do
      // not resolve. Reading the summary also enforces renewal visibility.
      const session = await runtime.store.readSessionSummary(sessionId);
      if (operation === "areas") {
        return { ok: true, areas: ["repo", "drop-zone", ...(owner ? ["session"] : [])] };
      }
      const policy = {
        ...sourceEditorFilePolicy(),
        exclude: [],
        protectSourceContract: false,
        maxTreeDepth: Infinity,
        maxTreeEntries: Infinity
      };
      if (operation === "archive") {
        if (area !== "session" || !session.archivePath) {
          throw sourceEditorError("This session has no published archive.", "vibe64_files_archive_unavailable", {}, 404);
        }
        return downloadSessionFile({ sourceRoot: path.dirname(session.archivePath), policy }, path.basename(session.archivePath));
      }
      const perform = async (sessionPaths) => {
        const sourceRoot = writable ? sessionPaths.dropZoneRoot : sessionPaths.sessionRoot;
        const context = { policy, sourceRoot, sourceEditorTempRoot: sourceRoot };
        await sourceEditorPathStats(sourceRoot);
        const relativePath = normalizeSourceEditorRelativePath(input.path);
        if (["mkdir", "delete", "rename"].includes(operation) && !relativePath) {
          throw sourceEditorError("Choose an item inside the Drop Zone.", "vibe64_invalid_source_editor_path");
        }
        switch (operation) {
          case "tree":
            return {
              ok: true,
              location: writable ? sourceRoot : "",
              tree: await sourceEditorDirectoryPage(context, {
                path: relativePath,
                offset: sourceEditorResultOffset(input.offset)
              })
            };
          case "file":
            return { ok: true, file: await readSourceEditorFile(context, relativePath) };
          case "download":
            return downloadSessionFile(context, relativePath);
          case "save":
            return { ok: true, file: { ...await saveSourceEditorFile(context, input), text: String(input.text ?? "") } };
          case "upload":
            return uploadDropZoneFile(context, input, readUpload);
          case "mkdir":
            await ensureSourceEditorParentDirectory(context, relativePath);
            return { ok: true };
          case "delete":
            await sourceEditorPathStats(sourceRoot, relativePath);
            await rm(absoluteSourceEditorPath(sourceRoot, relativePath), { recursive: true });
            return { ok: true };
          case "rename": {
            await sourceEditorPathStats(sourceRoot, relativePath);
            const destination = normalizeNewSourceEditorFilePath(input.destination);
            const parent = path.posix.dirname(destination);
            await sourceEditorPathStats(sourceRoot, parent === "." ? "" : parent);
            const target = absoluteSourceEditorPath(sourceRoot, destination);
            try {
              await lstat(target);
              throw sourceEditorError("An item already exists at that path.", "vibe64_files_exists", {}, 409);
            } catch (error) {
              if (!isMissingPathError(error)) throw error;
            }
            await rename(absoluteSourceEditorPath(sourceRoot, relativePath), target);
            return { ok: true };
          }
        }
      };
      const livePaths = session.sessionRoot ? {
        sessionRoot: session.sessionRoot,
        dropZoneRoot: path.join(session.sessionRoot, "drop-zone")
      } : null;
      if (!writable) {
        return livePaths ? perform(livePaths) : runtime.store.withReadableSessionPaths(sessionId, perform);
      }
      if (!session.sessionRoot) {
        if (operation === "tree") return { ok: true, expired: true, tree: directoryNode("", [], { loaded: true }) };
        throw sourceEditorError("This session's Drop Zone has expired.", "vibe64_files_expired", {}, 410);
      }
      if (!writing) {
        // Normal reads do not mutate session metadata. Older live sessions get
        // their missing Drop Zone once, under the same archival mutation lease.
        try {
          await lstat(livePaths.dropZoneRoot);
          return perform(livePaths);
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
      return runtime.store.mutateSession(sessionId, async (sessionPaths) => {
        const current = await runtime.store.readSessionSummary(sessionId);
        if (sessionClosingReason(current) || current.status === "archived") {
          throw sourceEditorError("The Drop Zone is unavailable while this session closes.", "vibe64_session_closing", {}, 409);
        }
        await mkdir(sessionPaths.dropZoneRoot, { recursive: true });
        return perform(sessionPaths);
      });
    });
  }

  return Object.freeze({
    fileArea,
    async readTree(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          policy: publicSourceEditorPolicy(context.policy),
          root: "",
          tree: await sourceEditorDirectoryPage(context, {
            limit: input.limit,
            offset: sourceEditorResultOffset(input.offset),
            // Preserve the tree API's two-pass path normalization, including "./ src".
            path: normalizeSourceEditorRelativePath(input.path)
          })
        };
      });
    },

    async readFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        const file = await readSourceEditorFile(context, input.path);
        return {
          file,
          revealTree: await sourceEditorFileRevealTree(context, file.path),
          ok: true
        };
      });
    },

    async downloadFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return downloadSessionFile(context, input.path);
      });
    },

    async readStarredFiles(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        const paths = await readStarredFiles(starredFilesPath(context.runtime.stateRoot, input.vibe64User));
        const files = [];
        // Only inspect explicitly bookmarked paths, never scan or watch the tree.
        for (const filePath of paths) {
          try {
            await sourceEditorExistingFile(context, filePath, { maxFileBytes: Infinity });
            files.push({ path: filePath, available: true });
          } catch (error) {
            files.push({
              path: filePath,
              available: false,
              reason: isMissingPathError(error) ? "Not found in this session" : "Unavailable in this session"
            });
          }
        }
        return { ok: true, files };
      });
    },

    async setStarredFile(input = {}) {
      return runSourceEditorOperation(async () => {
        if (typeof input.starred !== "boolean") {
          throw sourceEditorError("Choose whether to star the file.", "vibe64_invalid_starred_file");
        }
        const context = await sourceEditorContext(input.sessionId);
        const filePath = normalizeSourceEditorRelativePath(input.path);
        if (!filePath) {
          throw sourceEditorError("Choose a file to star.", "vibe64_invalid_source_editor_path");
        }
        if (input.starred) {
          await sourceEditorExistingFile(context, filePath, { maxFileBytes: Infinity });
        }
        const paths = await setStarredFile(starredFilesPath(context.runtime.stateRoot, input.vibe64User), filePath, input.starred);
        return { ok: true, paths };
      });
    },

    async streamFileChanges(input = {}, stream = {}) {
      const context = await sourceEditorContext(input.sessionId);
      const file = await sourceEditorExistingFile(context, input.path);
      return streamSourceEditorFileChanges(context, file, stream, fileObserver);
    },

    async saveFile(input = {}) {
      return runSourceEditorOperation(async () => {
        return runSourceEditorWriteExclusive(input, async (context) => {
          const file = await saveSourceEditorFile(context, input);
          return {
            file,
            fileChange: sourceEditorFileChange(context, input, file),
            ok: true
          };
        });
      });
    },

    async createFile(input = {}) {
      return runSourceEditorOperation(async () => {
        return runSourceEditorWriteExclusive(input, async (context) => {
          const file = await createSourceEditorFile(context, input);
          return {
            file,
            fileChange: sourceEditorFileChange(context, input, file),
            revealTree: await sourceEditorFileRevealTree(context, file.path),
            ok: true
          };
        });
      });
    },

    async listFiles(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...await sourceEditorFileMatches(context, input)
        };
      });
    },

    async search(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...await sourceEditorSearch(context, input)
        };
      });
    },

    async resolvePath(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...await resolveSourceEditorPath(context, input)
        };
      });
    },

    async explainSelection(input = {}) {
      return runSourceEditorOperation(async () => {
        return runSourceEditorAgentOperation(input, async (context) => {
          const explanationInput = await sourceEditorExplanationInput(context, input);
          const cacheKey = sourceEditorExplanationCacheKey(context, explanationInput);
          return {
            explanation: await explanationCache.run(cacheKey, {
              completedCache: Boolean(context.agentAccountIdentitySignature),
              force: input.force === true,
              generate: () => createSourceEditorExplanation(context, input, {
                explanationChats,
                explanationGenerator: sourceExplanationGenerator,
                explanationInput
              }),
              reuse: (template, cacheState) => createCachedSourceEditorExplanation(
                context,
                input,
                explanationInput,
                template,
                {
                  cacheState,
                  explanationChats
                }
              ),
              validateCompleted: (template) => sourceEditorCompletedCacheIdentityUnchanged(
                terminalService,
                context,
                template
              )
            }),
            ok: true
          };
        });
      });
    },

    async streamExplanation(input = {}, stream = {}) {
      await streamSourceEditorOperation(async () => {
        await runSourceEditorAgentOperation(input, async (context) => {
          const explanationInput = await sourceEditorExplanationInput(context, input);
          const cacheKey = sourceEditorExplanationCacheKey(context, explanationInput);
          await explanationCache.run(cacheKey, {
            completedCache: Boolean(context.agentAccountIdentitySignature),
            force: input.force === true,
            generate: () => streamSourceEditorExplanation(context, input, {
              emit: stream.emit,
              explanationChats,
              explanationInput,
              explanationTurns,
              isClosed: stream.isClosed,
              terminalService
            }),
            reuse: (template, cacheState) => createCachedSourceEditorExplanation(
              context,
              input,
              explanationInput,
              template,
              {
                cacheState,
                emit: stream.emit,
                explanationChats,
                isClosed: stream.isClosed
              }
            ),
            validateCompleted: (template) => sourceEditorCompletedCacheIdentityUnchanged(
              terminalService,
              context,
              template
            )
          });
        });
      }, stream);
    },

    async addExplanationFollowup(input = {}) {
      return runSourceEditorOperation(async () => {
        return runSourceEditorAgentOperation(input, async (context) => ({
          explanation: await addSourceEditorExplanationFollowup(context, input, {
            explanationChats,
            explanationFollowupGenerator: sourceExplanationFollowupGenerator
          }),
          ok: true
        }));
      });
    },

    async streamExplanationFollowup(input = {}, stream = {}) {
      await streamSourceEditorOperation(async () => {
        await runSourceEditorAgentOperation(input, (context) => (
          streamSourceEditorExplanationFollowup(context, input, {
            emit: stream.emit,
            explanationChats,
            explanationTurns,
            isClosed: stream.isClosed,
            terminalService
          })
        ));
      }, stream);
    },

    async stopExplanation(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId, {
          vibe64User: input.vibe64User
        });
        return {
          explanation: await stopSourceEditorExplanation(context, input.explanationId, {
            explanationChats,
            explanationTurns,
            terminalService
          }),
          ok: true
        };
      });
    },

    async deleteExplanation(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId, {
          vibe64User: input.vibe64User
        });
        return {
          ...await deleteSourceEditorExplanation(context, input.explanationId, {
            explanationChats,
            explanationTurns,
            terminalService
          }),
          ok: true
        };
      });
    },

    async cleanupExplanations(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId, {
          vibe64User: input.vibe64User
        });
        return {
          ...await cleanupSourceEditorExplanations(context, input, {
            explanationChats,
            explanationTurns,
            terminalService
          }),
          ok: true
        };
      });
    },

    close() {
      for (const pendingTurn of explanationTurns.values()) {
        pendingTurn.close();
      }
      explanationCache.close();
      fileObserver.close();
    }
  });
}

function streamSourceEditorFileChanges(context, file, stream, fileObserver) {
  const {
    emit,
    isClosed,
    onClose
  } = stream;
  if (
    typeof emit !== "function" ||
    typeof isClosed !== "function" ||
    typeof onClose !== "function"
  ) {
    throw new TypeError("Source file change streams require emit(), isClosed(), and onClose().");
  }
  if (isClosed()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let finished = false;
    let unsubscribe = null;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      unsubscribe?.();
      resolve();
    };
    onClose(finish);
    unsubscribe = fileObserver.subscribe({
      relativePath: file.relativePath,
      sourceRoot: context.sourceRoot
    }, (event = {}) => {
      if (finished || isClosed()) {
        return;
      }
      const payload = {
        path: file.relativePath,
        sessionId: context.sessionId
      };
      switch (event.kind) {
        case "ready":
          emit(VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT, payload);
          break;
        case "change":
          emit(VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT, {
            ...payload,
            originId: "filesystem",
            updatedAt: normalizeText(event.updatedAt) || new Date().toISOString()
          });
          break;
        case "error":
          try {
            emit(VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT, {
              ...payload,
              error: normalizeText(event.error) || "Source file observation failed.",
              fatal: false
            });
          } finally {
            finish();
          }
          break;
        case "closed":
          finish();
          break;
        default:
          break;
      }
    });
    if (finished) {
      unsubscribe();
    }
  });
}

async function uploadDropZoneFile(context, input, readUpload) {
  if (typeof readUpload !== "function") throw sourceEditorError("Choose a file to upload.", "vibe64_files_upload_required");
  const relativePath = normalizeNewSourceEditorFilePath(input.path);
  const parent = path.posix.dirname(relativePath);
  await sourceEditorPathStats(context.sourceRoot, parent === "." ? "" : parent);
  const target = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  const staged = path.join(context.sourceRoot, `.upload-${crypto.randomUUID()}`);
  try {
    let count = 0;
    for await (const part of readUpload()) {
      if (++count !== 1 || part.type !== "file" || part.fieldname !== "file") {
        part.file?.resume();
        throw sourceEditorError("Upload exactly one file.", "vibe64_files_invalid_upload");
      }
      await pipeline(part.file, createWriteStream(staged, { flags: "wx", mode: 0o660 }));
      if (part.file.truncated) throw sourceEditorError("Upload exceeds the 100 MiB limit.", "vibe64_files_upload_too_large", {}, 413);
    }
    if (count !== 1) throw sourceEditorError("Choose a file to upload.", "vibe64_files_upload_required");
    // Publish without overwriting or making another temporary copy.
    try {
      await link(staged, target);
    } catch (error) {
      if (error.code === "EEXIST") throw sourceEditorError("An item already exists at that path. Rename it or delete it before uploading again.", "vibe64_files_exists", {}, 409);
      throw error;
    }
    return { ok: true, path: relativePath };
  } finally {
    await rm(staged, { force: true });
  }
}

async function downloadSessionFile(context, relativePath) {
  const file = await sourceEditorExistingFile(context, relativePath, { maxFileBytes: Infinity });
  const handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.dev !== file.stats.dev || stats.ino !== file.stats.ino) {
      throw sourceEditorError("The file changed while opening. Try downloading again.", "vibe64_source_editor_file_changed", {}, 409);
    }
    return { ok: true, fileHandle: handle, name: path.posix.basename(file.relativePath) };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function runSourceEditorOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    return sourceEditorErrorResponse(error);
  }
}

async function streamSourceEditorOperation(operation, {
  emit = null
} = {}) {
  try {
    await operation();
  } catch (error) {
    const response = sourceEditorErrorResponse(error);
    if (typeof emit === "function") {
      emit({
        ...response,
        type: "source-explanation.error"
      });
    }
  }
}

function sourceEditorError(message, code, details = {}, statusCode = 400) {
  const error = vibe64Error(message, code);
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function sourceEditorErrorResponse(error) {
  return {
    ...vibe64ErrorResponse(error, {
      fallbackCode: "vibe64_source_editor_failed",
      fallbackMessage: "Source editor operation failed."
    }),
    statusCode: error?.statusCode || 400
  };
}

function publicSourceEditorPolicy(policy = {}) {
  return {
    defaultOpenFiles: Array.isArray(policy.defaultOpenFiles) ? policy.defaultOpenFiles : [],
    exclude: Array.isArray(policy.exclude) ? policy.exclude : [],
    maxFileBytes: policy.maxFileBytes,
    maxTreeDepth: policy.maxTreeDepth,
    maxTreeEntries: policy.maxTreeEntries,
    preexpandedDirectories: Array.isArray(policy.preexpandedDirectories) ? policy.preexpandedDirectories : [],
    preloadDirectories: Array.isArray(policy.preloadDirectories) ? policy.preloadDirectories : []
  };
}

function normalizeSourceEditorRelativePath(value = "") {
  const raw = normalizeText(value).replaceAll("\\", "/");
  if (!raw || raw === "." || raw === "/") {
    return "";
  }
  if (raw.startsWith("/") || /^[A-Za-z]:\//u.test(raw)) {
    throw sourceEditorError("Source editor paths must be relative to the session source.", "vibe64_invalid_source_editor_path");
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/u, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw sourceEditorError("Source editor path escapes the session source.", "vibe64_invalid_source_editor_path");
  }
  return normalized;
}

function absoluteSourceEditorPath(sourceRoot = "", relativePath = "") {
  const absolutePath = path.resolve(sourceRoot, relativePath);
  if (!pathInsideOrEqual(sourceRoot, absolutePath)) {
    throw sourceEditorError("Source editor path escapes the session source.", "vibe64_invalid_source_editor_path");
  }
  return absolutePath;
}

async function sourceEditorPathStats(sourceRoot = "", relativePath = "") {
  const absolutePath = absoluteSourceEditorPath(sourceRoot, relativePath);
  let currentPath = path.resolve(sourceRoot);
  let stats;
  for (const segment of ["", ...path.relative(currentPath, absolutePath).split(path.sep).filter(Boolean)]) {
    currentPath = path.join(currentPath, segment);
    stats = await lstat(currentPath);
    if (stats.isSymbolicLink()) {
      throw sourceEditorError("Source editor does not access paths containing symbolic links.", "vibe64_source_editor_symlink", {
        path: relativePath
      }, 403);
    }
  }
  return stats;
}

function normalizeSourceEditorPolicyPath(value = "") {
  return normalizeText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
}

function wildcardPattern(pattern = "") {
  let source = "^";
  const text = String(pattern || "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "*") {
      if (text[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += character.replace(/[\\^$+?.()|{}[\]]/gu, "\\$&");
  }
  source += "$";
  return new RegExp(source, "u");
}

function pathMatchesPolicyPattern(relativePath = "", pattern = "") {
  const normalizedPath = normalizeSourceEditorPolicyPath(relativePath);
  const normalizedPattern = normalizeSourceEditorPolicyPath(pattern);
  if (!normalizedPath || !normalizedPattern) {
    return false;
  }
  if (!normalizedPattern.includes("/") && !normalizedPattern.includes("*")) {
    return normalizedPath.split("/").includes(normalizedPattern);
  }
  if (!normalizedPattern.includes("/") && normalizedPattern.includes("*")) {
    const segmentPattern = wildcardPattern(normalizedPattern);
    return normalizedPath.split("/").some((segment) => segmentPattern.test(segment));
  }
  const subtreePattern = normalizedPattern.endsWith("/**")
    ? normalizedPattern.slice(0, -3)
    : normalizedPattern;
  if (
    !subtreePattern.includes("*") &&
    (normalizedPath === subtreePattern || normalizedPath.startsWith(`${subtreePattern}/`))
  ) {
    return true;
  }
  return wildcardPattern(normalizedPattern).test(normalizedPath);
}

function sourceEditorPathExcluded(policy = {}, relativePath = "") {
  if (policy.protectSourceContract !== false && sourceEditorSourceContractPathExcluded(relativePath)) {
    return true;
  }
  return (Array.isArray(policy.exclude) ? policy.exclude : [])
    .some((pattern) => pathMatchesPolicyPattern(relativePath, pattern));
}

function normalizeSourceEditorQuery(value = "") {
  return normalizeText(value).slice(0, SOURCE_EDITOR_QUERY_MAX_LENGTH);
}

function sourceEditorFileQueryTokens(value = "") {
  return normalizeSourceEditorQuery(value)
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

function sourceEditorResultLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }
  return Math.min(number, fallback);
}

function sourceEditorResultOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function sourceEditorPolicyExcludeGlobs(policy = {}) {
  const globs = [];
  const seen = new Set();
  function add(pattern = "") {
    const normalized = normalizeSourceEditorPolicyPath(pattern);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    globs.push("--glob", `!${normalized}`);
  }

  for (const pattern of Array.isArray(policy.exclude) ? policy.exclude : []) {
    const normalized = normalizeSourceEditorPolicyPath(pattern);
    if (!normalized) {
      continue;
    }
    add(normalized);
    if (!normalized.includes("/")) {
      add(`**/${normalized}`);
      add(`**/${normalized}/**`);
    } else if (!normalized.endsWith("/**")) {
      add(`${normalized}/**`);
    }
  }
  return globs;
}

function sourceEditorRipgrepBaseArgs(policy = {}) {
  return [
    "--hidden",
    "--no-ignore",
    "--no-messages",
    "--sort",
    "path",
    ...sourceEditorPolicyExcludeGlobs(policy)
  ];
}

function normalizeRipgrepPath(value = "") {
  return normalizeSourceEditorPolicyPath(value);
}

function orderedTokenIndexes(text = "", tokens = []) {
  const normalizedText = String(text || "").toLowerCase();
  const indexes = [];
  let cursor = 0;
  for (const token of tokens) {
    const index = normalizedText.indexOf(token, cursor);
    if (index < 0) {
      return null;
    }
    indexes.push(index);
    cursor = index + token.length;
  }
  return indexes;
}

function fuzzyCharacterIndexes(text = "", token = "") {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedToken = String(token || "").toLowerCase();
  const indexes = [];
  let cursor = 0;
  for (const character of normalizedToken) {
    const index = normalizedText.indexOf(character, cursor);
    if (index < 0) {
      return null;
    }
    indexes.push(index);
    cursor = index + 1;
  }
  return indexes;
}

function textTokenMatchScore(text = "", token = "") {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedToken = String(token || "").toLowerCase();
  if (!normalizedToken) {
    return 0;
  }
  if (normalizedText === normalizedToken) {
    return 0;
  }
  if (normalizedText.startsWith(normalizedToken)) {
    return 1;
  }
  const substringIndex = normalizedText.indexOf(normalizedToken);
  if (substringIndex >= 0) {
    return 2 + substringIndex / 1000;
  }
  const fuzzyIndexes = fuzzyCharacterIndexes(normalizedText, normalizedToken);
  if (!fuzzyIndexes) {
    return null;
  }
  const span = fuzzyIndexes.at(-1) - fuzzyIndexes[0];
  return 6 + fuzzyIndexes[0] / 1000 + span / 1000000;
}

function filePathTokenMatchScore(filePath = "", token = "") {
  const lowerPath = filePath.toLowerCase();
  const lowerName = path.posix.basename(lowerPath);
  const lowerStem = lowerName.replace(/\.[^.]*$/u, "");
  const nameScore = Math.min(
    textTokenMatchScore(lowerName, token) ?? Number.POSITIVE_INFINITY,
    textTokenMatchScore(lowerStem, token) ?? Number.POSITIVE_INFINITY
  );
  if (Number.isFinite(nameScore)) {
    return nameScore;
  }
  const pathScore = textTokenMatchScore(lowerPath, token);
  return pathScore === null ? null : 10 + pathScore;
}

function filePathMatchesQuery(filePath = "", tokens = []) {
  return !tokens.length || tokens.every((token) => filePathTokenMatchScore(filePath, token) !== null);
}

function fileMatchScore(filePath = "", queryTokens = []) {
  const tokens = Array.isArray(queryTokens)
    ? queryTokens
    : sourceEditorFileQueryTokens(queryTokens);
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = tokens.join(" ");
  const lowerName = path.posix.basename(lowerPath);
  if (!tokens.length) {
    return 5;
  }
  if (tokens.length > 1) {
    const tokenScores = tokens.map((token) => filePathTokenMatchScore(lowerPath, token));
    if (tokenScores.some((score) => score === null)) {
      return 99;
    }
    const pathIndexes = orderedTokenIndexes(lowerPath, tokens);
    const nameIndexes = orderedTokenIndexes(lowerName, tokens);
    const allInName = tokens.every((token) => textTokenMatchScore(lowerName, token) !== null);
    const basenameTokenCount = tokens
      .filter((token) => textTokenMatchScore(lowerName, token) !== null)
      .length;
    const firstIndex = pathIndexes?.[0] ?? Math.min(...tokens
      .map((token) => lowerPath.indexOf(token))
      .filter((index) => index >= 0));
    const lastIndex = pathIndexes?.at(-1) ?? Math.max(...tokens
      .map((token) => lowerPath.indexOf(token))
      .filter((index) => index >= 0));
    const span = Number.isFinite(firstIndex) && Number.isFinite(lastIndex)
      ? lastIndex - firstIndex
      : lowerPath.length;
    if (nameIndexes?.[0] === 0) {
      return 1 + span / 1000;
    }
    if (nameIndexes) {
      return 2 + span / 1000;
    }
    if (allInName) {
      return 2.5 + tokenScores.reduce((sum, score) => sum + score, 0) / 100;
    }
    if (pathIndexes && firstIndex === 0) {
      return 3 + span / 1000;
    }
    if (pathIndexes) {
      return 4 + firstIndex / 1000 + span / 1000000;
    }
    return 6 - basenameTokenCount + tokenScores.reduce((sum, score) => sum + score, 0) / 100;
  }
  if (lowerName === lowerQuery) {
    return 0;
  }
  if (lowerName.startsWith(lowerQuery)) {
    return 1;
  }
  if (lowerName.includes(lowerQuery)) {
    return 2;
  }
  if (lowerPath.startsWith(lowerQuery)) {
    return 3;
  }
  return lowerPath.includes(lowerQuery) ? 4 : 99;
}

function sortFileMatches(matches = [], query = "") {
  const queryTokens = sourceEditorFileQueryTokens(query);
  return [...matches].sort((left, right) => {
    const scoreDiff = fileMatchScore(left.path, queryTokens) - fileMatchScore(right.path, queryTokens);
    return scoreDiff || left.path.localeCompare(right.path);
  });
}

async function sourceEditorFileMatches(context = {}, input = {}) {
  const query = normalizeSourceEditorQuery(input.query || input.q);
  const queryTokens = sourceEditorFileQueryTokens(query);
  const limit = sourceEditorResultLimit(input.limit, SOURCE_EDITOR_FILE_MATCH_LIMIT);
  const matches = [];
  let truncated = false;
  const ripgrepRun = await runRipgrepLines([
    "--files",
    ...sourceEditorRipgrepBaseArgs(context.policy)
  ], {
    cwd: context.sourceRoot,
    onLine(line = "") {
      const relativePath = normalizeRipgrepPath(line);
      if (
        !relativePath ||
        sourceEditorPathExcluded(context.policy, relativePath) ||
        !filePathMatchesQuery(relativePath, queryTokens)
      ) {
        return true;
      }
      matches.push({
        language: sourceEditorLanguageForPath(relativePath),
        name: path.posix.basename(relativePath),
        path: relativePath
      });
      if (!queryTokens.length && matches.length >= limit + 1) {
        truncated = true;
        return false;
      }
      return true;
    }
  });
  truncated ||= ripgrepRun.truncated || ripgrepRun.timedOut;
  truncated ||= matches.length > limit;
  return {
    files: sortFileMatches(matches, query).slice(0, limit),
    query,
    truncated
  };
}

async function sourceEditorSearch(context = {}, input = {}) {
  const query = normalizeSourceEditorQuery(input.query || input.q);
  const limit = sourceEditorResultLimit(input.limit, SOURCE_EDITOR_SEARCH_RESULT_LIMIT);
  const results = [];
  let truncated = false;
  if (!query) {
    return {
      query,
      results,
      truncated
    };
  }

  const ripgrepRun = await runRipgrepLines([
    "--json",
    "--fixed-strings",
    "--smart-case",
    "--line-number",
    "--column",
    "--max-columns",
    "240",
    "--max-columns-preview",
    ...sourceEditorRipgrepBaseArgs(context.policy),
    "--",
    query
  ], {
    cwd: context.sourceRoot,
    onLine(line = "") {
      const match = sourceEditorSearchMatchFromRipgrepLine(line);
      if (!match || sourceEditorPathExcluded(context.policy, match.path)) {
        return true;
      }
      results.push(match);
      if (results.length >= limit + 1) {
        truncated = true;
        return false;
      }
      return true;
    }
  });
  truncated ||= ripgrepRun.truncated || ripgrepRun.timedOut;

  return {
    query,
    results: results.slice(0, limit),
    truncated
  };
}

function normalizeSourceEditorImportTarget(value = "") {
  const target = normalizeText(value)
    .replaceAll("\\", "/")
    .split(/[?#]/u)[0]
    .trim();
  if (!target || target.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) {
    return "";
  }
  if (target.startsWith("./") || target.startsWith("../") || target.startsWith("/")) {
    return target;
  }
  return "";
}

function resolveSourceEditorTargetPath(fromPath = "", target = "") {
  const fromRelativePath = normalizeSourceEditorRelativePath(fromPath);
  const normalizedTarget = normalizeSourceEditorImportTarget(target);
  if (!fromRelativePath || !normalizedTarget) {
    return "";
  }
  const baseDirectory = path.posix.dirname(fromRelativePath);
  const joined = normalizedTarget.startsWith("/")
    ? normalizedTarget.slice(1)
    : path.posix.join(baseDirectory === "." ? "" : baseDirectory, normalizedTarget);
  return normalizeSourceEditorRelativePath(joined);
}

function sourceEditorResolveCandidates(relativePath = "") {
  const normalizedPath = normalizeSourceEditorRelativePath(relativePath);
  if (!normalizedPath) {
    return [];
  }
  const extension = path.posix.extname(normalizedPath);
  const candidates = [normalizedPath];
  if (!extension) {
    candidates.push(...SOURCE_EDITOR_RESOLVE_EXTENSIONS.map((suffix) => `${normalizedPath}${suffix}`));
  }
  const directoryPath = normalizedPath.replace(/\/+$/u, "");
  candidates.push(...SOURCE_EDITOR_RESOLVE_EXTENSIONS.map((suffix) => `${directoryPath}/index${suffix}`));
  return [...new Set(candidates)];
}

async function sourceEditorResolvableFile(context = {}, relativePath = "") {
  if (sourceEditorPathExcluded(context.policy, relativePath)) {
    return null;
  }
  let stats = null;
  try {
    stats = await sourceEditorPathStats(context.sourceRoot, relativePath);
  } catch (error) {
    if (isMissingPathError(error) || error?.code === "vibe64_source_editor_symlink") {
      return null;
    }
    throw error;
  }
  if (stats.isFile()) {
    return {
      language: sourceEditorLanguageForPath(relativePath),
      path: relativePath
    };
  }
  return null;
}

async function resolveSourceEditorPath(context = {}, input = {}) {
  let basePath = "";
  try {
    basePath = resolveSourceEditorTargetPath(input.fromPath, input.target);
  } catch {
    return {
      resolved: false,
      target: normalizeText(input.target)
    };
  }
  if (!basePath) {
    return {
      resolved: false,
      target: normalizeText(input.target)
    };
  }
  for (const candidatePath of sourceEditorResolveCandidates(basePath)) {
    const file = await sourceEditorResolvableFile(context, candidatePath);
    if (file) {
      return {
        file,
        path: file.path,
        resolved: true,
        target: normalizeText(input.target)
      };
    }
  }
  return {
    resolved: false,
    target: normalizeText(input.target)
  };
}

function sourceEditorSearchMatchFromRipgrepLine(line = "") {
  let event = null;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type !== "match") {
    return null;
  }
  const data = event.data || {};
  const relativePath = normalizeRipgrepPath(data.path?.text || "");
  if (!relativePath) {
    return null;
  }
  const firstSubmatch = Array.isArray(data.submatches) ? data.submatches[0] : null;
  return {
    column: Math.max(1, Number(firstSubmatch?.start || 0) + 1),
    line: Math.max(1, Number(data.line_number || 1)),
    path: relativePath,
    preview: String(data.lines?.text || "").replace(/\r?\n$/u, "")
  };
}

async function runRipgrepLines(args = [], {
  cwd = "",
  onLine = () => true,
  timeoutMs = SOURCE_EDITOR_SEARCH_TIMEOUT_MS
} = {}) {
  const result = await runVibe64Command({
    actor: "app",
    allowedRoots: [
      cwd
    ],
    args,
    command: "rg",
    cwd,
    mode: "capture",
    purpose: "source-editor",
    runtimes: ["ripgrep"],
    timeout: timeoutMs
  });

  const output = String(result.stdout || "");
  let stopped = false;
  const lines = output.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (index === lines.length - 1 && rawLine === "") {
      continue;
    }
    const line = rawLine.replace(/\r$/u, "");
    if (onLine(line) === false) {
      stopped = true;
      break;
    }
  }

  if (stopped || result.ok || result.exitCode === 1 || result.timedOut) {
    return {
      timedOut: result.timedOut === true,
      truncated: stopped || result.timedOut === true
    };
  }

  const failureText = [result.error, result.output, result.stderr].filter(Boolean).join("\n");
  if (/\b(?:ENOENT|not found|No such file or directory)\b/iu.test(failureText)) {
    throw sourceEditorError("Source search requires ripgrep (rg) on the Vibe64 host.", "vibe64_source_editor_rg_missing", {}, 500);
  }
  throw sourceEditorError(
    result.stderr || result.output || "Source search failed.",
    "vibe64_source_editor_rg_failed",
    { exitCode: result.exitCode },
    500
  );
}

async function sourceEditorDirectoryPage(context = {}, {
  limit = SOURCE_EDITOR_TREE_PAGE_LIMIT,
  offset = 0,
  path: relativePathValue = ""
} = {}) {
  const {
    policy,
    sourceRoot
  } = context;
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (relativePath && sourceEditorPathExcluded(policy, relativePath)) {
    throw sourceEditorError("The selected directory is excluded from source editing.", "vibe64_source_editor_directory_excluded", {
      path: relativePath
    }, 403);
  }
  const absolutePath = absoluteSourceEditorPath(sourceRoot, relativePath);
  if (relativePath) {
    const stats = await sourceEditorPathStats(sourceRoot, relativePath);
    if (!stats.isDirectory()) {
      throw sourceEditorError("Choose a source directory.", "vibe64_invalid_source_editor_path", {
        path: relativePath
      });
    }
  }

  const depth = relativePath ? relativePath.split("/").length : 0;
  const normalizedLimit = sourceEditorResultLimit(limit, SOURCE_EDITOR_TREE_PAGE_LIMIT);
  const normalizedOffset = sourceEditorResultOffset(offset);
  if (depth >= policy.maxTreeDepth) {
    return directoryNode(relativePath, [], {
      hasMore: false,
      limit: normalizedLimit,
      loaded: true,
      nextOffset: normalizedOffset,
      offset: normalizedOffset,
      total: 0,
      truncated: true
    });
  }

  const entries = await readdir(absolutePath, {
    withFileTypes: true
  });
  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  const visibleEntries = [];
  for (const entry of entries) {
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (sourceEditorPathExcluded(policy, childRelativePath) || entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory() || entry.isFile()) {
      visibleEntries.push({
        entry,
        relativePath: childRelativePath
      });
    }
  }

  const total = Math.min(visibleEntries.length, policy.maxTreeEntries);
  const pageEntries = visibleEntries.slice(normalizedOffset, Math.min(total, normalizedOffset + normalizedLimit));
  const children = await Promise.all(pageEntries.map(async ({ entry, relativePath: childRelativePath }) => {
    if (entry.isDirectory()) {
      return directoryNode(childRelativePath, [], {
        loaded: false
      });
    }
    return sourceEditorFileNode(sourceRoot, childRelativePath);
  }));
  const nextOffset = Math.min(total, normalizedOffset + children.length);
  return directoryNode(relativePath, children, {
    hasMore: nextOffset < total,
    limit: normalizedLimit,
    loaded: true,
    nextOffset,
    offset: normalizedOffset,
    total,
    truncated: visibleEntries.length > total
  });
}

function directoryNode(relativePath = "", children = [], metadata = {}) {
  return {
    children,
    hasMore: metadata.hasMore === true,
    limit: Number.isInteger(metadata.limit) ? metadata.limit : SOURCE_EDITOR_TREE_PAGE_LIMIT,
    loaded: metadata.loaded === true,
    name: relativePath ? path.posix.basename(relativePath) : "",
    nextOffset: Number.isInteger(metadata.nextOffset) ? metadata.nextOffset : children.length,
    offset: Number.isInteger(metadata.offset) ? metadata.offset : 0,
    path: relativePath,
    total: Number.isInteger(metadata.total) ? metadata.total : children.length,
    truncated: metadata.truncated === true,
    type: "directory"
  };
}

async function sourceEditorFileNode(sourceRoot = "", relativePath = "") {
  const stats = await lstat(absoluteSourceEditorPath(sourceRoot, relativePath));
  return {
    language: sourceEditorLanguageForPath(relativePath),
    name: path.posix.basename(relativePath),
    path: relativePath,
    size: stats.size,
    type: "file"
  };
}

async function sourceEditorFileRevealTree(context = {}, relativePathValue = "") {
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (!relativePath) {
    return null;
  }
  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }
  let node = await sourceEditorFileNode(context.sourceRoot, relativePath);
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const directoryPath = segments.slice(0, index).join("/");
    node = directoryNode(directoryPath, [node], {
      hasMore: false,
      loaded: false,
      nextOffset: 1,
      total: 1
    });
  }
  return directoryNode("", [node], {
    hasMore: false,
    loaded: false,
    nextOffset: 1,
    total: 1
  });
}

function normalizeNewSourceEditorFilePath(value = "") {
  const raw = normalizeText(value).replaceAll("\\", "/");
  if (/\/$/u.test(raw)) {
    throw sourceEditorError("Choose a file path, not a directory path.", "vibe64_invalid_source_editor_path");
  }
  if (raw.split("/").some((segment) => segment === "." || segment === "..")) {
    throw sourceEditorError("New source file paths cannot include current- or parent-directory segments.", "vibe64_invalid_source_editor_path");
  }
  const relativePath = normalizeSourceEditorRelativePath(raw);
  if (!relativePath || relativePath.endsWith("/")) {
    throw sourceEditorError("Choose a file path before creating a file.", "vibe64_invalid_source_editor_path");
  }
  const basename = path.posix.basename(relativePath);
  if (!basename || basename === "." || basename === "..") {
    throw sourceEditorError("Choose a valid file name before creating a file.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }
  return relativePath;
}

async function ensureSourceEditorParentDirectory(context = {}, parentRelativePath = "") {
  const parentPath = normalizeSourceEditorPolicyPath(parentRelativePath);
  if (parentPath && sourceEditorPathExcluded(context.policy, parentPath)) {
    throw sourceEditorError("The selected directory is excluded from source editing.", "vibe64_source_editor_directory_excluded", {
      path: parentPath
    }, 403);
  }
  let currentPath = path.resolve(context.sourceRoot);
  for (const segment of parentPath.split("/").filter(Boolean)) {
    currentPath = absoluteSourceEditorPath(currentPath, segment);
    try {
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw sourceEditorError("Source editor does not write through symbolic links.", "vibe64_source_editor_symlink", {
          path: parentPath
        }, 403);
      }
      if (!stats.isDirectory()) {
        throw sourceEditorError("Choose a source directory.", "vibe64_invalid_source_editor_path", {
          path: parentPath
        });
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      await mkdir(currentPath);
      const stats = await lstat(currentPath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw sourceEditorError("Choose a source directory.", "vibe64_invalid_source_editor_path", {
          path: parentPath
        });
      }
    }
  }
  return currentPath;
}

async function createSourceEditorFile(context = {}, input = {}) {
  const relativePath = normalizeNewSourceEditorFilePath(input.path);
  const content = Buffer.from(String(input.text ?? ""), "utf8");
  if (content.byteLength > context.policy.maxFileBytes) {
    throw sourceEditorError("The new file is too large for the source editor.", "vibe64_source_editor_file_too_large");
  }
  assertTextBuffer(content, relativePath);
  if (sourceEditorPathExcluded(context.policy, relativePath)) {
    throw sourceEditorError("The selected file is excluded from source editing.", "vibe64_source_editor_file_excluded", {
      path: relativePath
    }, 403);
  }

  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  await ensureSourceEditorParentDirectory(context, path.posix.dirname(relativePath) === "."
    ? ""
    : path.posix.dirname(relativePath));
  try {
    await writeFile(absolutePath, content, {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw sourceEditorError("A source file already exists at that path.", "vibe64_source_editor_file_exists", {
        path: relativePath
      }, 409);
    }
    throw error;
  }
  const savedBuffer = await readFile(absolutePath);
  const savedStats = await lstat(absolutePath);
  if (!savedStats.isFile() || savedStats.isSymbolicLink()) {
    throw sourceEditorError("Source editor created path is not a regular file.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }
  return sourceEditorFilePayload(relativePath, savedBuffer, savedStats);
}

async function sourceEditorExistingFile(context = {}, relativePathValue = "", {
  maxFileBytes = context.policy.maxFileBytes
} = {}) {
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (!relativePath) {
    throw sourceEditorError("Choose a file before editing.", "vibe64_invalid_source_editor_path");
  }
  if (sourceEditorPathExcluded(context.policy, relativePath)) {
    throw sourceEditorError("The selected file is excluded from source editing.", "vibe64_source_editor_file_excluded", {
      path: relativePath
    }, 403);
  }

  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  const stats = await sourceEditorPathStats(context.sourceRoot, relativePath);
  if (!stats.isFile()) {
    throw sourceEditorError("Choose a source file, not a directory.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }
  if (stats.size > maxFileBytes) {
    throw sourceEditorError("The selected file is too large for the source editor.", "vibe64_source_editor_file_too_large", {
      maxFileBytes: context.policy.maxFileBytes,
      path: relativePath,
      size: stats.size
    }, 413);
  }
  return {
    absolutePath,
    relativePath,
    stats
  };
}

async function readSourceEditorFile(context = {}, relativePathValue = "") {
  const file = await sourceEditorExistingFile(context, relativePathValue);
  const buffer = await readFile(file.absolutePath);
  assertTextBuffer(buffer, file.relativePath);
  return sourceEditorFilePayload(file.relativePath, buffer, file.stats);
}

function normalizeSourceEditorExplanationId(value = "") {
  const id = normalizeText(value);
  if (!/^[a-z0-9_-]+$/u.test(id)) {
    throw sourceEditorError("Invalid source explanation id.", "vibe64_source_explanation_id_invalid");
  }
  return id;
}

function sourceEditorExplanationMemoryKey(context = {}, explanationId = "") {
  return `${normalizeText(context.sessionId)}:${normalizeSourceEditorExplanationId(explanationId)}`;
}

function sourceEditorExplanationStore(explanationChats = null) {
  return explanationChats instanceof Map ? explanationChats : new Map();
}

function sourceEditorExplanationCleanupPath(context = {}) {
  return path.join(context.sourceEditorTempRoot, SOURCE_EDITOR_EXPLANATION_CLEANUP_FILE);
}

function normalizeSourceEditorCleanupRecord(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  let id = "";
  try {
    id = normalizeSourceEditorExplanationId(source.id);
  } catch {
    return null;
  }
  const agentThreadId = normalizeText(source.agentThreadId);
  if (!agentThreadId) {
    return null;
  }
  return {
    agentThreadId,
    agentTurnId: normalizeText(source.agentTurnId),
    createdAt: normalizeText(source.createdAt),
    id,
    originId: normalizeText(source.originId),
    sessionId: normalizeText(source.sessionId),
    sourcePath: normalizeText(source.sourcePath),
    status: normalizeText(source.status || "ready"),
    updatedAt: normalizeText(source.updatedAt)
  };
}

function sourceEditorCleanupRecordFromExplanation(context = {}, explanation = {}) {
  const record = normalizeSourceEditorExplanation(explanation);
  return normalizeSourceEditorCleanupRecord({
    agentThreadId: record.agentThreadId,
    agentTurnId: record.agentTurnId,
    createdAt: record.createdAt,
    id: record.id,
    originId: record.ownerOriginId,
    sessionId: context.sessionId,
    sourcePath: record.sourceRange.path,
    status: record.status,
    updatedAt: record.updatedAt
  });
}

function sourceEditorCleanupLedgerPayload(records = []) {
  const byId = new Map();
  for (const record of records) {
    const normalized = normalizeSourceEditorCleanupRecord(record);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  }
  return {
    records: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    version: 1
  };
}

async function readSourceEditorExplanationCleanupRecords(context = {}) {
  const ledgerPath = sourceEditorExplanationCleanupPath(context);
  if (!ledgerPath) {
    return [];
  }
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8"));
    const rawRecords = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.records) ? parsed.records : []);
    return sourceEditorCleanupLedgerPayload(rawRecords).records;
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function writeSourceEditorExplanationCleanupRecords(context = {}, records = []) {
  const ledgerPath = sourceEditorExplanationCleanupPath(context);
  if (!ledgerPath) {
    return [];
  }
  const payload = sourceEditorCleanupLedgerPayload(records);
  if (!payload.records.length) {
    await rm(ledgerPath, {
      force: true
    });
    return payload.records;
  }
  await mkdir(path.dirname(ledgerPath), {
    recursive: true
  });
  const temporaryPath = `${ledgerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temporaryPath, ledgerPath);
  return payload.records;
}

function mutateSourceEditorExplanationCleanupRecords(context = {}, transform = (records) => records) {
  const ledgerPath = sourceEditorExplanationCleanupPath(context);
  if (!ledgerPath) {
    return Promise.resolve([]);
  }
  const previous = sourceEditorExplanationCleanupQueues.get(ledgerPath) || Promise.resolve();
  const queued = previous
    .catch(() => null)
    .then(async () => {
      const records = await readSourceEditorExplanationCleanupRecords(context);
      const nextRecords = await transform(records);
      return writeSourceEditorExplanationCleanupRecords(context, Array.isArray(nextRecords) ? nextRecords : records);
    });
  const stored = queued
    .catch(() => null)
    .finally(() => {
      if (sourceEditorExplanationCleanupQueues.get(ledgerPath) === stored) {
        sourceEditorExplanationCleanupQueues.delete(ledgerPath);
      }
    });
  sourceEditorExplanationCleanupQueues.set(ledgerPath, stored);
  return queued;
}

async function upsertSourceEditorExplanationCleanupRecord(context = {}, explanation = {}) {
  const cleanupRecord = sourceEditorCleanupRecordFromExplanation(context, explanation);
  if (!cleanupRecord) {
    return;
  }
  await mutateSourceEditorExplanationCleanupRecords(context, (records) => [
    ...records.filter((record) => record.id !== cleanupRecord.id),
    cleanupRecord
  ]);
}

async function removeSourceEditorExplanationCleanupRecord(context = {}, explanationId = "") {
  let normalizedId = "";
  try {
    normalizedId = normalizeSourceEditorExplanationId(explanationId);
  } catch {
    return;
  }
  await mutateSourceEditorExplanationCleanupRecords(
    context,
    (records) => records.filter((record) => record.id !== normalizedId)
  );
}

async function readSourceEditorExplanationCleanupRecord(context = {}, explanationId = "") {
  const normalizedId = normalizeSourceEditorExplanationId(explanationId);
  return (await readSourceEditorExplanationCleanupRecords(context))
    .find((record) => record.id === normalizedId) || null;
}

async function deleteSourceEditorExplanationAgentThread(context = {}, record = {}, {
  terminalService = null
} = {}) {
  const threadId = normalizeText(record.agentThreadId);
  if (!threadId) {
    return {
      ok: true,
      status: "notFound",
      threadId
    };
  }
  if (typeof terminalService?.deleteDetachedAgentChatThread !== "function") {
    throw sourceEditorError(
      "Agent chat cleanup is not available.",
      "vibe64_source_explanation_agent_cleanup_unavailable",
      { threadId },
      409
    );
  }
  const agentCleanup = await terminalService.deleteDetachedAgentChatThread(context.sessionId, {
    executionProfile: sourceEditorExecutionProfileSnapshot(record.executionProfile) ||
      sourceEditorExecutionProfileRequest(),
    threadId
  }, sourceEditorAgentOperationOptions(context, {}, {
    providerId: record.executionProfile?.providerId
  }));
  if (agentCleanup?.ok !== true) {
    throw sourceEditorError(
      agentCleanup?.error || "The agent service did not confirm that the temporary source explanation chat was deleted.",
      agentCleanup?.code || "vibe64_source_explanation_agent_cleanup_unconfirmed",
      isPlainObject(agentCleanup) ? agentCleanup : { cleanupResult: agentCleanup ?? null },
      agentCleanup?.statusCode || 502
    );
  }
  return agentCleanup;
}

async function readSourceEditorExplanationRecord(context = {}, explanationId = "", {
  explanationChats = null
} = {}) {
  const store = sourceEditorExplanationStore(explanationChats);
  const record = store.get(sourceEditorExplanationMemoryKey(context, explanationId));
  if (!record) {
    throw sourceEditorError("Source explanation was not found.", "vibe64_source_explanation_not_found", {
      explanationId
    }, 404);
  }
  return normalizeSourceEditorExplanation(record);
}

async function writeSourceEditorExplanation(context = {}, explanation = {}, {
  explanationChats = null
} = {}) {
  const store = sourceEditorExplanationStore(explanationChats);
  const record = normalizeSourceEditorExplanation({
    ...explanation,
    updatedAt: new Date().toISOString()
  });
  store.set(sourceEditorExplanationMemoryKey(context, record.id), record);
  await upsertSourceEditorExplanationCleanupRecord(context, record);
  return record;
}

async function readStoppedSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null
} = {}) {
  try {
    const record = await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    });
    return record.status === "stopped" ? record : null;
  } catch {
    return null;
  }
}

function normalizeSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceRange = source.sourceRange && typeof source.sourceRange === "object" && !Array.isArray(source.sourceRange)
    ? source.sourceRange
    : {};
  return {
    agentThreadId: normalizeText(source.agentThreadId),
    agentSettings: null,
    agentTurnId: normalizeText(source.agentTurnId),
    body: String(source.body || ""),
    createdAt: normalizeText(source.createdAt),
    engine: normalizeText(source.engine || (source.agentThreadId ? "agent-chat" : "")),
    error: String(source.error || ""),
    executionProfile: sourceEditorExecutionProfileSnapshot(source.executionProfile),
    followups: normalizeSourceEditorFollowups(source.followups),
    id: normalizeSourceEditorExplanationId(source.id),
    messages: normalizeSourceEditorMessages(source.messages),
    model: normalizeText(source.model || "agent-chat"),
    ownerOriginId: normalizeText(source.ownerOriginId || source.originId),
    promptVersion: normalizeText(source.promptVersion || SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION),
    sourceRange: {
      endColumn: positiveInteger(sourceRange.endColumn, 1),
      endLine: positiveInteger(sourceRange.endLine, 1),
      fileHash: normalizeText(sourceRange.fileHash),
      language: normalizeText(sourceRange.language || sourceEditorLanguageForPath(sourceRange.path)),
      path: normalizeSourceEditorRelativePath(sourceRange.path),
      scope: normalizeText(sourceRange.scope || "selection"),
      selectedTextHash: normalizeText(sourceRange.selectedTextHash),
      startColumn: positiveInteger(sourceRange.startColumn, 1),
      startLine: positiveInteger(sourceRange.startLine, 1)
    },
    stale: source.stale === true,
    staleReason: normalizeText(source.staleReason),
    status: normalizeText(source.status || "ready"),
    summary: String(source.summary || ""),
    title: normalizeText(source.title || "Code explanation"),
    updatedAt: normalizeText(source.updatedAt)
  };
}

function normalizeSourceEditorFollowups(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const role = normalizeText(entry?.role);
      const text = String(entry?.text || "");
      if (!["assistant", "user"].includes(role) || !text.trim()) {
        return null;
      }
      return {
        createdAt: normalizeText(entry.createdAt),
        id: normalizeText(entry.id) || sourceEditorExplanationMessageId(),
        role,
        text
      };
    })
    .filter(Boolean);
}

function normalizeSourceEditorMessages(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const role = normalizeText(entry?.role);
      const text = String(entry?.text || "");
      const status = normalizeText(entry.status || "complete");
      if (!["assistant", "user"].includes(role) || (!text.trim() && status === "complete")) {
        return null;
      }
      return {
        createdAt: normalizeText(entry.createdAt),
        id: normalizeText(entry.id) || sourceEditorExplanationMessageId(),
        role,
        status,
        text
      };
    })
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function sourceEditorExplanationId() {
  return `exp_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function sourceEditorExplanationMessageId() {
  return `msg_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function sourceEditorTextHash(text = "") {
  return sourceEditorHash(Buffer.from(String(text ?? ""), "utf8"));
}

function normalizeSourceEditorLineRange(input = {}, lineCount = 1) {
  const boundedLineCount = Math.max(1, Number(lineCount || 1));
  const startLine = Math.min(boundedLineCount, positiveInteger(input.startLine, 1));
  const endLine = Math.min(boundedLineCount, positiveInteger(input.endLine, startLine));
  return {
    endColumn: positiveInteger(input.endColumn, 1),
    endLine: Math.max(startLine, endLine),
    startColumn: positiveInteger(input.startColumn, 1),
    startLine
  };
}

function sourceEditorRangeWithSelectionColumns(range = {}, input = {}, lines = []) {
  const lastLine = lines[range.endLine - 1] || "";
  const hasEndColumn = Number.isSafeInteger(Number(input.endColumn)) && Number(input.endColumn) > 0;
  const hasStartColumn = Number.isSafeInteger(Number(input.startColumn)) && Number(input.startColumn) > 0;
  const startColumn = hasStartColumn ? range.startColumn : 1;
  const endColumn = hasEndColumn ? range.endColumn : lastLine.length + 1;
  return {
    ...range,
    endColumn: range.startLine === range.endLine
      ? Math.max(startColumn, endColumn)
      : endColumn,
    startColumn
  };
}

function sourceEditorLines(text = "") {
  return String(text ?? "").split(/\r?\n/u);
}

function sourceEditorSelectionForRange(text = "", range = {}) {
  const lines = sourceEditorLines(text);
  const selectedLines = lines
    .slice(range.startLine - 1, range.endLine)
    .map((line, index, selected) => {
      const firstLine = index === 0;
      const lastLine = index === selected.length - 1;
      const startIndex = firstLine
        ? sourceEditorColumnIndex(line, range.startColumn, 0)
        : 0;
      const endIndex = lastLine
        ? sourceEditorColumnIndex(line, range.endColumn, line.length)
        : line.length;
      return line.slice(startIndex, Math.max(startIndex, endIndex));
    });
  return selectedLines.join("\n");
}

function sourceEditorColumnIndex(line = "", column = 1, fallback = 0) {
  const index = positiveInteger(column, fallback + 1) - 1;
  return Math.min(String(line || "").length, Math.max(0, index));
}

function sourceEditorContextWindow(text = "", range = {}) {
  const lines = sourceEditorLines(text);
  const startLine = Math.max(1, range.startLine - SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES);
  const endLine = Math.min(lines.length, range.endLine + SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES);
  return boundedSourceEditorPromptText(lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n"), SOURCE_EDITOR_EXPLANATION_CONTEXT_MAX_CHARS);
}

function boundedSourceEditorPromptText(value = "", maxChars = 0) {
  const text = String(value || "");
  const limit = Math.max(1, Number(maxChars || 0));
  if (text.length <= limit) {
    return text;
  }
  const marker = `\n\n... ${text.length - limit} characters omitted ...\n\n`;
  const available = Math.max(2, limit - marker.length);
  const headLength = Math.ceil(available * 0.6);
  const tailLength = available - headLength;
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function sourceEditorExplanationPromptCode({
  range = {},
  selectedText = ""
} = {}) {
  const text = String(selectedText || "");
  const lines = sourceEditorLines(text);
  if (
    (range.scope !== "file" || lines.length <= SOURCE_EDITOR_EXPLANATION_MAX_LINES) &&
    text.length <= SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS
  ) {
    return {
      label: range.scope === "file" ? "File contents" : "Selected code",
      note: "",
      text
    };
  }

  const excerptedByLines = lines.length > SOURCE_EDITOR_EXPLANATION_MAX_LINES;
  const headLineCount = excerptedByLines
    ? Math.ceil(SOURCE_EDITOR_EXPLANATION_MAX_LINES * 0.6)
    : lines.length;
  const tailLineCount = excerptedByLines
    ? SOURCE_EDITOR_EXPLANATION_MAX_LINES - headLineCount
    : 0;
  const omittedLineCount = Math.max(0, lines.length - headLineCount - tailLineCount);
  const excerpt = excerptedByLines
    ? [
        ...lines.slice(0, headLineCount),
        "",
        `... ${omittedLineCount} lines omitted from the middle ...`,
        "",
        ...lines.slice(-tailLineCount)
      ].join("\n")
    : text;
  return {
    label: "File excerpt",
    note: `The whole file has ${lines.length} lines and ${text.length} characters, so this bounded excerpt may omit content. Explain only what the supplied excerpt supports and state any resulting uncertainty.`,
    text: boundedSourceEditorPromptText(excerpt, SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS)
  };
}

async function sourceEditorExplanationInput(context = {}, input = {}) {
  const file = await readSourceEditorFile(context, input.path);
  const lines = sourceEditorLines(file.text);
  const scope = normalizeText(input.scope) === "file" ? "file" : "selection";
  const range = sourceEditorRangeWithSelectionColumns(
    normalizeSourceEditorLineRange(input, lines.length),
    input,
    lines
  );
  const selectedText = sourceEditorSelectionForRange(file.text, range);
  if (!selectedText.trim()) {
    throw sourceEditorError("Select code before asking for an explanation.", "vibe64_source_explanation_empty_selection");
  }
  const selectedLineCount = range.endLine - range.startLine + 1;
  if (scope !== "file" && selectedLineCount > SOURCE_EDITOR_EXPLANATION_MAX_LINES) {
    throw sourceEditorError("Select a smaller code range before asking for an explanation.", "vibe64_source_explanation_selection_too_large", {
      maxLines: SOURCE_EDITOR_EXPLANATION_MAX_LINES,
      selectedLineCount
    }, 413);
  }
  if (scope !== "file" && selectedText.length > SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS) {
    throw sourceEditorError("Select a smaller code range before asking for an explanation.", "vibe64_source_explanation_selection_too_large", {
      maxChars: SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS,
      selectedChars: selectedText.length
    }, 413);
  }
  const selectedTextHash = sourceEditorTextHash(selectedText);
  const promptVersion = SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION;
  const promptCode = sourceEditorExplanationPromptCode({
    range: {
      ...range,
      scope
    },
    selectedText
  });
  return {
    contextWindow: scope === "file" ? "" : sourceEditorContextWindow(file.text, range),
    file,
    promptCode,
    promptVersion,
    range: {
      ...range,
      fileHash: file.hash,
      language: file.language,
      path: file.path,
      scope,
      selectedTextHash
    },
    selectedText
  };
}

async function createCachedSourceEditorExplanation(
  context = {},
  input = {},
  explanationInput = {},
  template = {},
  {
    cacheState = {},
    emit = null,
    explanationChats = null,
    isClosed = null
  } = {}
) {
  const createdAt = new Date().toISOString();
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || sourceEditorExplanationId();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  const executionProfile = requiredSourceEditorExecutionProfile(template.executionProfile);
  const explanation = await withSourceEditorExplanationFreshness(
    context,
    await writeSourceEditorExplanation(context, {
      agentThreadId: "",
      agentSettings: null,
      agentTurnId: "",
      body: String(template.body || ""),
      createdAt,
      engine: "agent-cache",
      error: "",
      executionProfile,
      followups: [],
      id: explanationId,
      messages: [
        sourceEditorExplanationMessage(
          "user",
          sourceEditorExplanationDisplayPrompt(explanationInput),
          createdAt,
          { id: userMessageId }
        ),
        sourceEditorExplanationMessage("assistant", String(template.body || ""), createdAt, {
          id: assistantMessageId
        })
      ],
      model: executionProfile.model,
      ownerOriginId: input.originId,
      promptVersion: explanationInput.promptVersion,
      sourceRange: explanationInput.range,
      status: "ready",
      summary: String(template.summary || sourceEditorExplanationSummary(template.body)),
      title: normalizeText(template.title) || sourceEditorExplanationTitle(explanationInput)
    }, {
      explanationChats
    })
  );
  const eventContext = {
    cacheHit: cacheState.cacheHit === true,
    coalesced: cacheState.coalesced === true,
    explanation
  };
  emitSourceEditorExplanationEvent(emit, isClosed, "source-explanation.started", {
    ...eventContext,
    assistantMessageId,
    userMessageId
  });
  emitSourceEditorExplanationEvent(emit, isClosed, "source-explanation.execution-profile", {
    ...eventContext,
    executionProfile
  });
  emitSourceEditorExplanationEvent(emit, isClosed, "source-explanation.finished", eventContext);
  return explanation;
}

async function createSourceEditorExplanation(context = {}, input = {}, {
  explanationChats = null,
  explanationGenerator = generateSourceEditorExplanationWithAgentService,
  explanationInput = null
} = {}) {
  const preparedInput = explanationInput || await sourceEditorExplanationInput(context, input);
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || sourceEditorExplanationId();
  let generated;
  try {
    generated = normalizeGeneratedSourceEditorExplanation(
      await explanationGenerator(preparedInput, {
        context
      })
    );
  } catch (error) {
    const ownership = isPlainObject(error?.sourceEditorCleanupOwnership)
      ? error.sourceEditorCleanupOwnership
      : null;
    if (normalizeText(ownership?.threadId)) {
      const createdAt = new Date().toISOString();
      const message = normalizeText(error?.message) || "Source explanation failed.";
      const executionProfile = sourceEditorExecutionProfileSnapshot(ownership.executionProfile);
      await writeSourceEditorExplanation(context, {
        agentThreadId: ownership.threadId,
        agentSettings: null,
        agentTurnId: ownership.turnId,
        body: "",
        createdAt,
        engine: "agent-chat",
        error: message,
        executionProfile,
        followups: [],
        id: explanationId,
        messages: [
          sourceEditorExplanationMessage("user", sourceEditorExplanationDisplayPrompt(preparedInput), createdAt),
          sourceEditorExplanationMessage("assistant", message, createdAt, {
            status: "failed"
          })
        ],
        model: executionProfile?.model || "",
        ownerOriginId: input.originId,
        promptVersion: preparedInput.promptVersion,
        sourceRange: preparedInput.range,
        status: "failed",
        title: sourceEditorExplanationTitle(preparedInput)
      }, {
        explanationChats
      });
      error.details = {
        ...(isPlainObject(error.details) ? error.details : {}),
        cleanupExplanationId: explanationId,
        cleanupRequired: true,
        cleanupThreadId: ownership.threadId
      };
    }
    throw error;
  }
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...generated,
    agentSettings: null,
    agentThreadId: generated.agentThreadId,
    agentTurnId: generated.agentTurnId,
    createdAt: new Date().toISOString(),
    engine: generated.engine,
    executionProfile: generated.executionProfile,
    followups: [],
    id: explanationId,
    messages: generated.messages,
    model: generated.executionProfile?.model || generated.model,
    ownerOriginId: input.originId,
    promptVersion: preparedInput.promptVersion,
    sourceRange: preparedInput.range,
    status: "ready"
  }, {
    explanationChats
  }));
}

function normalizeGeneratedSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    agentThreadId: normalizeText(source.agentThreadId),
    agentTurnId: normalizeText(source.agentTurnId),
    body: String(source.body || ""),
    engine: normalizeText(source.engine),
    executionProfile: sourceEditorExecutionProfileSnapshot(source.executionProfile),
    messages: normalizeSourceEditorMessages(source.messages),
    model: normalizeText(source.model),
    summary: String(source.summary || ""),
    title: normalizeText(source.title || "Code explanation")
  };
}

async function readSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null
} = {}) {
  return withSourceEditorExplanationFreshness(
    context,
    await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    })
  );
}

async function withSourceEditorExplanationFreshness(context = {}, explanation = {}) {
  const record = normalizeSourceEditorExplanation(explanation);
  try {
    const file = await readSourceEditorFile(context, record.sourceRange.path);
    const range = normalizeSourceEditorLineRange(record.sourceRange, sourceEditorLines(file.text).length);
    const selectedTextHash = sourceEditorTextHash(sourceEditorSelectionForRange(file.text, range));
    const sameFileHash = file.hash === record.sourceRange.fileHash;
    const sameSelectionHash = selectedTextHash === record.sourceRange.selectedTextHash;
    return {
      ...record,
      stale: !sameFileHash || !sameSelectionHash,
      staleReason: sameFileHash && sameSelectionHash
        ? ""
        : (sameSelectionHash ? "The file changed around this explanation." : "The selected code changed.")
    };
  } catch {
    return {
      ...record,
      stale: true,
      staleReason: "The source file is no longer available."
    };
  }
}

async function generateSourceEditorExplanationWithAgentService(explanationInput = {}, {
  context = {},
  terminalService = null
} = {}) {
  if (!terminalService || typeof terminalService.runDetachedAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat is not available for source explanations.", "vibe64_source_explanation_agent_unavailable", {}, 409);
  }
  const displayPrompt = sourceEditorExplanationDisplayPrompt(explanationInput);
  let observedExecutionProfile = null;
  let observedThreadId = "";
  let observedTurnId = "";
  let result;
  let body;
  let executionProfile;
  try {
    result = await terminalService.runDetachedAgentChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
      executionProfile: resolvedSourceEditorExecutionProfile(context.agentExecutionProfile),
      expectedAccountIdentitySignature: normalizeText(context.agentAccountIdentitySignature),
      outputSchema: SOURCE_EDITOR_EXPLANATION_OUTPUT_SCHEMA,
      prompt: sourceEditorExplanationPrompt(explanationInput),
      promptLabel: "Source code explanation",
      timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
    }, sourceEditorAgentOperationOptions(context, {
      onEvent(event = {}) {
        observedExecutionProfile ||= sourceEditorExecutionProfileSnapshot(event.executionProfile);
        observedThreadId = normalizeText(event.threadId) || observedThreadId;
        observedTurnId = normalizeText(event.turnId) || observedTurnId;
      }
    }));
    observedExecutionProfile ||= sourceEditorExecutionProfileSnapshot(result?.executionProfile);
    observedThreadId = normalizeText(result?.threadId) || observedThreadId;
    observedTurnId = normalizeText(result?.turnId) || observedTurnId;
    if (result?.ok === false) {
      throw sourceEditorError(
        result.error || "The agent could not explain this code.",
        result.code || "vibe64_source_explanation_agent_failed",
        result,
        result.statusCode || 502
      );
    }
    body = sourceEditorStructuredAnswer(result?.text);
    executionProfile = requiredSourceEditorExecutionProfile(result?.executionProfile);
  } catch (error) {
    let failure = error;
    if (observedThreadId) {
      const cleanup = await cleanupRejectedSourceEditorExplanationThread(
        context,
        observedThreadId,
        terminalService,
        observedExecutionProfile
      );
      if (cleanup.ok === false) {
        failure = sourceEditorFailureWithRejectedThread(error, {
          executionProfile: observedExecutionProfile,
          threadId: observedThreadId,
          turnId: observedTurnId
        });
        failure.sourceEditorCleanupOwnership = Object.freeze({
          executionProfile: observedExecutionProfile,
          threadId: observedThreadId,
          turnId: observedTurnId
        });
        failure.details = {
          ...(isPlainObject(failure.details) ? failure.details : {}),
          cleanupError: normalizeText(cleanup.error),
          cleanupRequired: true,
          cleanupThreadId: observedThreadId
        };
      }
    }
    throw failure;
  }
  const createdAt = new Date().toISOString();
  return {
    agentThreadId: normalizeText(result.threadId),
    agentTurnId: normalizeText(result.turnId),
    body,
    engine: "agent-chat",
    executionProfile,
    messages: [
      sourceEditorExplanationMessage("user", displayPrompt, createdAt),
      sourceEditorExplanationMessage("assistant", body)
    ],
    model: executionProfile.model,
    summary: sourceEditorExplanationSummary(body),
    title: sourceEditorExplanationTitle(explanationInput)
  };
}

async function cleanupRejectedSourceEditorExplanationThread(
  context = {},
  threadId = "",
  terminalService = null,
  executionProfile = null
) {
  if (typeof terminalService?.deleteDetachedAgentChatThread !== "function") {
    return {
      error: "Agent chat cleanup is not available.",
      ok: false
    };
  }
  try {
    const cleanup = await terminalService.deleteDetachedAgentChatThread(
      context.sessionId || context.session?.sessionId || context.session?.id,
      {
        executionProfile: sourceEditorExecutionProfileSnapshot(executionProfile) ||
          sourceEditorExecutionProfileRequest(),
        threadId
      },
      sourceEditorAgentOperationOptions(context)
    );
    return cleanup?.ok === true
      ? cleanup
      : {
          ...(isPlainObject(cleanup) ? cleanup : {}),
          error: normalizeText(cleanup?.error) || "Agent chat cleanup did not confirm that the thread was deleted.",
          ok: false
        };
  } catch (error) {
    return {
      error: normalizeText(error?.message) || "Agent chat cleanup failed.",
      ok: false
    };
  }
}

function sourceEditorExplanationTitle({
  file = {},
  range = {}
} = {}) {
  if (range.scope === "file") {
    return `${path.posix.basename(file.path || "Source")} full file`;
  }
  return `${path.posix.basename(file.path || "Source")} lines ${range.startLine}-${range.endLine}`;
}

function sourceEditorExplanationSummary(text = "") {
  const firstParagraph = String(text || "")
    .split(/\n\s*\n/u)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return firstParagraph.slice(0, 280);
}

function sourceEditorExplanationDisplayPrompt({
  file = {},
  range = {}
} = {}) {
  if (range.scope === "file") {
    return `Explain the whole file ${file.path}.`;
  }
  return `Explain ${file.path}:${range.startLine}-${range.endLine}.`;
}

function sourceEditorExplanationMessage(role = "", text = "", createdAt = new Date().toISOString(), options = {}) {
  const source = isPlainObject(options) ? options : {};
  return {
    createdAt,
    id: normalizeText(source.id) || sourceEditorExplanationMessageId(),
    role,
    status: normalizeText(source.status || "complete"),
    text: String(text || "")
  };
}

function sourceEditorExplanationMessagesForAppend(explanation = {}) {
  const existing = normalizeSourceEditorMessages(explanation.messages);
  if (existing.length) {
    return existing;
  }
  return normalizeSourceEditorMessages([
    ...(explanation.body
      ? [{
          id: "body",
          role: "assistant",
          text: explanation.body
        }]
      : []),
    ...normalizeSourceEditorFollowups(explanation.followups)
  ]);
}

function sourceEditorClientExplanationId(value = "") {
  if (!normalizeText(value)) {
    return "";
  }
  try {
    return normalizeSourceEditorExplanationId(value);
  } catch {
    return "";
  }
}

function sourceEditorClientMessageId(value = "") {
  const id = normalizeText(value);
  return /^[a-z0-9_-]{1,100}$/u.test(id) ? id : "";
}

function sourceEditorExplanationWithMessage(explanation = {}, messageId = "", patch = {}) {
  const normalizedMessageId = normalizeText(messageId);
  const messages = normalizeSourceEditorMessages(explanation.messages);
  const index = messages.findIndex((message) => message.id === normalizedMessageId);
  if (index === -1) {
    return {
      ...explanation,
      messages
    };
  }
  const nextMessages = [...messages];
  nextMessages[index] = normalizeSourceEditorMessages([{
    ...nextMessages[index],
    ...patch
  }])[0] || nextMessages[index];
  return {
    ...explanation,
    messages: nextMessages
  };
}

function emitSourceEditorExplanationEvent(emit = null, isClosed = null, type = "", payload = {}) {
  if (typeof emit !== "function" || (typeof isClosed === "function" && isClosed())) {
    return;
  }
  emit({
    ...payload,
    type
  });
}

async function streamSourceEditorAgentTurn(context = {}, {
  onText = null,
  onExecutionProfile = null,
  onThread = null,
  onTurn = null,
  prompt = "",
  promptLabel = "",
  terminalService = null,
  threadId = "",
  outputSchema = SOURCE_EDITOR_EXPLANATION_OUTPUT_SCHEMA,
  answerMaxChars = SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS
} = {}) {
  if (!terminalService || typeof terminalService.streamDetachedAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat streaming is not available for source explanations.", "vibe64_source_explanation_agent_stream_unavailable", {}, 409);
  }
  let latestText = "";
  let latestExecutionProfile = null;
  let latestThreadId = normalizeText(threadId);
  let latestTurnId = "";
  let result = null;
  try {
    result = await terminalService.streamDetachedAgentChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
      executionProfile: resolvedSourceEditorExecutionProfile(context.agentExecutionProfile),
      expectedAccountIdentitySignature: normalizeText(context.agentAccountIdentitySignature),
      outputSchema,
      prompt,
      promptLabel,
      threadId,
      timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
    }, sourceEditorAgentOperationOptions(context, {
      onEvent(event = {}) {
        const eventExecutionProfile = sourceEditorExecutionProfileSnapshot(event.executionProfile);
        if (eventExecutionProfile && !latestExecutionProfile) {
          latestExecutionProfile = eventExecutionProfile;
          onExecutionProfile?.(eventExecutionProfile);
        }
        if (event.type === "thread") {
          latestThreadId = normalizeText(event.threadId) || latestThreadId;
          onThread?.({
            replacedThreadId: normalizeText(event.replacedThreadId),
            threadId: latestThreadId
          });
          return;
        }
        if (event.type === "turn") {
          latestThreadId = normalizeText(event.threadId) || latestThreadId;
          latestTurnId = normalizeText(event.turnId) || latestTurnId;
          onTurn?.({
            status: normalizeText(event.status),
            threadId: latestThreadId,
            turnId: latestTurnId
          });
          return;
        }
        const classification = isPlainObject(event.classification) ? event.classification : {};
        if (!["final_assistant_result", "live_progress"].includes(classification.kind) || !classification.text) {
          return;
        }
        latestText = String(classification.text || "");
      }
    }));
    latestThreadId = normalizeText(result?.threadId) || latestThreadId;
    latestTurnId = normalizeText(result?.turnId) || latestTurnId;
    if (result?.ok === false) {
      const failure = threadId ? sourceEditorFollowupThreadError(result) : result;
      throw sourceEditorError(
        failure.error || failure.message || "The agent could not answer this source explanation chat.",
        failure.code || "vibe64_source_explanation_agent_failed",
        failure,
        failure.statusCode || 502
      );
    }
    const executionProfile = requiredSourceEditorExecutionProfile(result?.executionProfile);
    if (!latestExecutionProfile) {
      latestExecutionProfile = executionProfile;
      onExecutionProfile?.(executionProfile);
    }
    const text = sourceEditorStructuredAnswer(result?.text || latestText, {
      maxChars: answerMaxChars
    });
    onText?.({
      kind: "final_assistant_result",
      text,
      threadId: latestThreadId,
      turnId: latestTurnId
    });
    return {
      executionProfile,
      replacedThreadId: normalizeText(result.replacedThreadId),
      text,
      threadId: latestThreadId,
      turnId: latestTurnId
    };
  } catch (error) {
    const failureProfile = sourceEditorExecutionProfileFromFailure(error) ||
      sourceEditorExecutionProfileSnapshot(result?.executionProfile) ||
      latestExecutionProfile;
    if (failureProfile && !latestExecutionProfile) {
      latestExecutionProfile = failureProfile;
      onExecutionProfile?.(failureProfile);
    }
    const failure = sourceEditorFailureWithRejectedThread(
      threadId ? sourceEditorFollowupThreadError(error) : error,
      latestThreadId
        ? {
            executionProfile: latestExecutionProfile,
            threadId: latestThreadId,
            turnId: latestTurnId
          }
        : null
    );
    throw failure;
  }
}

function sourceEditorAgentStreamHandlers({
  assistantMessageId = "",
  currentExplanation = () => ({}),
  emitEvent = () => {},
  onTurnIdentity = null,
  remember = async () => {},
  setExplanation = () => {}
} = {}) {
  const updateExplanation = (patch = {}) => {
    const next = {
      ...currentExplanation(),
      ...patch
    };
    setExplanation(next);
    void remember(patch).catch(() => null);
    return next;
  };

  return {
    onExecutionProfile(executionProfile) {
      updateExplanation({
        executionProfile,
        model: executionProfile.model
      });
      emitEvent("source-explanation.execution-profile", {
        executionProfile
      });
    },
    onThread({ threadId }) {
      updateExplanation({
        agentThreadId: threadId
      });
      emitEvent("source-explanation.thread", {
        threadId
      });
    },
    onTurn({ threadId, turnId }) {
      updateExplanation({
        agentThreadId: threadId,
        agentTurnId: turnId
      });
      onTurnIdentity?.({ threadId, turnId });
      emitEvent("source-explanation.turn", {
        threadId,
        turnId
      });
    },
    onText({ text }) {
      const next = sourceEditorExplanationWithMessage(currentExplanation(), assistantMessageId, {
        status: "thinking",
        text
      });
      setExplanation(next);
      void remember({
        messages: next.messages
      }).catch(() => null);
      emitEvent("source-explanation.message", {
        messageId: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text
      });
    }
  };
}

function createSourceEditorExplanationStreamState(context = {}, initialExplanation = {}, {
  assistantMessageId = "",
  emit = null,
  explanationChats = null,
  explanationTurns,
  isClosed = null
} = {}) {
  let explanation = initialExplanation;
  const key = sourceEditorExplanationMemoryKey(context, explanation.id);
  const identity = Promise.withResolvers();
  const pendingTurn = {
    assistantMessageId,
    identity: identity.promise,
    close() {
      identity.resolve(null);
      if (explanationTurns.get(key) === pendingTurn) {
        explanationTurns.delete(key);
      }
    }
  };
  explanationTurns.get(key)?.close();
  explanationTurns.set(key, pendingTurn);
  let writeQueue = Promise.resolve(explanation);
  const currentExplanation = () => explanation;
  const setExplanation = (value) => {
    explanation = value;
  };
  const remember = (patch = {}) => {
    const store = sourceEditorExplanationStore(explanationChats);
    const stored = store.get(sourceEditorExplanationMemoryKey(context, explanation.id));
    if (stored?.status === "stopped") {
      explanation = stored;
      return Promise.resolve(explanation);
    }
    explanation = normalizeSourceEditorExplanation({
      ...explanation,
      ...patch,
      updatedAt: new Date().toISOString()
    });
    store.set(
      sourceEditorExplanationMemoryKey(context, explanation.id),
      explanation
    );
    const write = async () => {
      const stopped = await readStoppedSourceEditorExplanation(context, explanation.id, {
        explanationChats
      });
      if (stopped) {
        explanation = stopped;
        return explanation;
      }
      explanation = await writeSourceEditorExplanation(context, {
        ...explanation,
        ...patch
      }, {
        explanationChats
      });
      return explanation;
    };
    writeQueue = writeQueue.then(write, write);
    return writeQueue;
  };
  const emitEvent = (type, payload = {}) => {
    emitSourceEditorExplanationEvent(emit, isClosed, type, {
      explanation,
      ...payload
    });
  };
  const finish = async (body = "", patch = {}) => {
    explanation = sourceEditorExplanationWithMessage(explanation, assistantMessageId, {
      status: "complete",
      text: body
    });
    explanation = await remember({
      body,
      error: "",
      messages: explanation.messages,
      status: "ready",
      ...patch
    });
    explanation = await withSourceEditorExplanationFreshness(context, explanation);
    emitEvent("source-explanation.finished", {
      explanation
    });
    return explanation;
  };

  return {
    currentExplanation,
    emitEvent,
    finish,
    finishPendingTurn: pendingTurn.close,
    remember,
    setExplanation,
    streamHandlers: sourceEditorAgentStreamHandlers({
      assistantMessageId,
      currentExplanation,
      emitEvent,
      onTurnIdentity({ threadId, turnId }) {
        if (threadId && turnId) {
          identity.resolve({ threadId, turnId });
        }
      },
      remember,
      setExplanation
    })
  };
}

async function runTrackedSourceEditorAgentTurn(context = {}, {
  assistantMessageId = "",
  currentExplanation = () => ({}),
  emitEvent = () => {},
  explanationChats = null,
  fallbackError = "Source explanation failed.",
  remember = async () => ({}),
  run = async () => ({}),
  terminalService = null
} = {}) {
  const finishStoppedExplanation = async (executionProfile = null) => {
    let stopped = await readStoppedSourceEditorExplanation(context, currentExplanation().id, {
      explanationChats
    });
    if (!stopped) {
      return null;
    }
    const profile = sourceEditorExecutionProfileSnapshot(executionProfile);
    if (profile && !stopped.executionProfile) {
      stopped = await writeSourceEditorExplanation(context, {
        ...stopped,
        executionProfile: profile,
        model: profile.model,
        status: "stopped"
      }, {
        explanationChats
      });
    }
    const explanation = await withSourceEditorExplanationFreshness(context, stopped);
    emitEvent("source-explanation.finished", {
      explanation
    });
    return explanation;
  };

  try {
    const result = await run();
    const stoppedExplanation = await finishStoppedExplanation(result.executionProfile);
    return stoppedExplanation
      ? { explanation: stoppedExplanation, stopped: true }
      : { result, stopped: false };
  } catch (error) {
    const executionProfile = sourceEditorExecutionProfileFromFailure(error) ||
      sourceEditorExecutionProfileSnapshot(currentExplanation().executionProfile);
    const stoppedExplanation = await finishStoppedExplanation(executionProfile);
    if (stoppedExplanation) {
      return {
        explanation: stoppedExplanation,
        stopped: true
      };
    }
    const rejectedThread = isPlainObject(error?.sourceEditorRejectedThread)
      ? error.sourceEditorRejectedThread
      : null;
    const rejectedThreadId = normalizeText(rejectedThread?.threadId);
    const cleanup = rejectedThreadId
      ? await cleanupRejectedSourceEditorExplanationThread(
          context,
          rejectedThreadId,
          terminalService,
          rejectedThread.executionProfile
        )
      : null;
    const cleanupSucceeded = cleanup?.ok === true;
    const failure = sourceEditorErrorResponse(error);
    const message = normalizeText(failure.error) || fallbackError;
    const failedExplanation = sourceEditorExplanationWithMessage(
      currentExplanation(),
      assistantMessageId,
      {
        status: "failed",
        text: message
      }
    );
    await remember({
      ...(rejectedThreadId
        ? {
            agentThreadId: cleanupSucceeded ? "" : rejectedThreadId,
            agentTurnId: cleanupSucceeded ? "" : normalizeText(rejectedThread?.turnId)
          }
        : {}),
      error: message,
      ...(executionProfile
        ? {
            executionProfile,
            model: executionProfile.model
          }
        : {}),
      messages: failedExplanation.messages,
      status: "failed"
    });
    if (cleanupSucceeded) {
      await removeSourceEditorExplanationCleanupRecord(
        context,
        currentExplanation().id
      );
    }
    emitEvent("source-explanation.failed", {
      code: failure.code,
      error: message,
      statusCode: failure.statusCode
    });
    throw error;
  }
}

async function streamSourceEditorExplanation(context = {}, input = {}, {
  emit = null,
  explanationChats = null,
  explanationInput = null,
  explanationTurns,
  isClosed = null,
  terminalService = null
} = {}) {
  const preparedInput = explanationInput || await sourceEditorExplanationInput(context, input);
  const createdAt = new Date().toISOString();
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || sourceEditorExplanationId();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  const displayPrompt = sourceEditorExplanationDisplayPrompt(preparedInput);
  const explanation = {
    agentThreadId: "",
    agentSettings: null,
    agentTurnId: "",
    body: "",
    createdAt,
    engine: "agent-chat",
    executionProfile: null,
    followups: [],
    id: explanationId,
    messages: [
      sourceEditorExplanationMessage("user", displayPrompt, createdAt, {
        id: userMessageId
      }),
      sourceEditorExplanationMessage("assistant", "", createdAt, {
        id: assistantMessageId,
        status: "thinking"
      })
    ],
    model: "",
    ownerOriginId: input.originId,
    promptVersion: preparedInput.promptVersion,
    sourceRange: preparedInput.range,
    status: "running",
    title: sourceEditorExplanationTitle(preparedInput)
  };

  const stream = createSourceEditorExplanationStreamState(context, explanation, {
    assistantMessageId,
    emit,
    explanationChats,
    explanationTurns,
    isClosed
  });

  try {
    stream.setExplanation(await writeSourceEditorExplanation(context, explanation, {
      explanationChats
    }));
    stream.emitEvent("source-explanation.started", {
      assistantMessageId,
      userMessageId
    });

    const trackedTurn = await runTrackedSourceEditorAgentTurn(context, {
      assistantMessageId,
      currentExplanation: stream.currentExplanation,
      emitEvent: stream.emitEvent,
      explanationChats,
      remember: stream.remember,
      terminalService,
      run: () => streamSourceEditorAgentTurn(context, {
        prompt: sourceEditorExplanationPrompt(preparedInput),
        promptLabel: "Source code explanation",
        terminalService,
        ...stream.streamHandlers
      })
    });
    if (trackedTurn.stopped) {
      return trackedTurn.explanation;
    }
    const result = trackedTurn.result;

    return await stream.finish(result.text, {
      agentThreadId: result.threadId || stream.currentExplanation().agentThreadId,
      agentTurnId: result.turnId || stream.currentExplanation().agentTurnId,
      executionProfile: result.executionProfile,
      model: result.executionProfile.model,
      summary: sourceEditorExplanationSummary(result.text)
    });
  } finally {
    stream.finishPendingTurn();
  }
}

function sourceEditorExplanationPrompt({
  contextWindow = "",
  file = {},
  promptCode = {},
  range = {},
  selectedText = ""
} = {}) {
  const wholeFile = range.scope === "file";
  const inlineCode = isPlainObject(promptCode) ? promptCode : {};
  const codeLabel = normalizeText(inlineCode.label) || (wholeFile ? "File contents" : "Selected code");
  const codeNote = normalizeText(inlineCode.note);
  const codeText = String(inlineCode.text ?? selectedText ?? "");
  return [
    "You are Vibe64's senior source-code explainer.",
    "Explain what this code is responsible for in the system. Do not teach language basics and do not explain obvious syntax such as `const`, imports, braces, or function declarations unless they are architecturally relevant.",
    wholeFile
      ? "The user asked about the whole file. Explain the file's role, its major sections, and how other parts of the project are likely to interact with it."
      : "The user selected a specific range. Explain that range first, then explain how it fits into the surrounding file and wider project.",
    "Use only the bounded source context supplied below. Do not inspect the repository, use tools, access the network, or edit files. Be explicit when you infer something from context.",
    "Prefer this shape: brief summary; role in the system; how it works; important data/control flow; key dependencies or callers/callees; risks, edge cases, or things to know.",
    "Be concrete and project-aware. Avoid generic rewrite advice unless there is a direct behavioral risk. Do not edit files.",
    `Return concise user-facing Markdown no longer than ${SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS.toLocaleString("en-US")} characters.`,
    "",
    `File: ${file.path}`,
    `Target: ${wholeFile ? "whole file" : `lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`}`,
    `Language: ${range.language || file.language || sourceEditorLanguageForPath(file.path)}`,
    "",
    ...(codeNote
      ? [
          "Important context:",
          codeNote,
          ""
        ]
      : []),
    `${codeLabel}:`,
    "```",
    codeText,
    "```",
    "",
    ...(contextWindow
      ? [
          "Nearby context:",
          "```",
          contextWindow,
          "```"
        ]
      : [])
  ].join("\n");
}

async function addSourceEditorExplanationFollowup(context = {}, input = {}, {
  explanationChats = null,
  explanationFollowupGenerator = generateSourceEditorExplanationFollowupWithAgentService
} = {}) {
  const message = sourceEditorExplanationFollowupMessage(input.message);
  const explanation = await readSourceEditorExplanation(context, input.explanationId, {
    explanationChats
  });
  const createdAt = new Date().toISOString();
  let generated;
  try {
    generated = await explanationFollowupGenerator(explanation, message, {
      context
    });
  } catch (error) {
    const retirement = isPlainObject(error?.sourceEditorFollowupThreadRetirement)
      ? error.sourceEditorFollowupThreadRetirement
      : null;
    if (retirement) {
      const cleanupSucceeded = retirement.cleanupSucceeded === true;
      const executionProfile = sourceEditorExecutionProfileSnapshot(retirement.executionProfile) ||
        sourceEditorExecutionProfileSnapshot(explanation.executionProfile);
      const failure = sourceEditorErrorResponse(error);
      const failureMessage = normalizeText(failure.error) || "Source explanation follow-up failed.";
      await writeSourceEditorExplanation(context, {
        ...explanation,
        agentThreadId: cleanupSucceeded ? "" : retirement.threadId,
        agentTurnId: cleanupSucceeded ? "" : retirement.turnId,
        error: failureMessage,
        executionProfile,
        messages: [
          ...sourceEditorExplanationMessagesForAppend(explanation),
          sourceEditorExplanationMessage("user", message, createdAt),
          sourceEditorExplanationMessage("assistant", failureMessage, new Date().toISOString(), {
            status: "failed"
          })
        ],
        model: executionProfile?.model || explanation.model,
        status: "failed"
      }, {
        explanationChats
      });
      if (cleanupSucceeded) {
        await removeSourceEditorExplanationCleanupRecord(context, explanation.id);
      }
      if (error && typeof error === "object" && Object.isExtensible(error)) {
        error.details = {
          ...(isPlainObject(error.details) ? error.details : {}),
          cleanupExplanationId: explanation.id,
          cleanupRequired: !cleanupSucceeded,
          cleanupThreadId: retirement.threadId
        };
      }
    }
    throw error;
  }
  const followupAnswer = normalizeGeneratedSourceEditorFollowup(generated);
  const answer = followupAnswer.answer;
  if (!answer) {
    throw sourceEditorError("The agent returned an empty source explanation answer.", "vibe64_source_explanation_agent_invalid", {}, 502);
  }
  const nextFollowups = [
    ...explanation.followups,
    {
      createdAt,
      id: sourceEditorExplanationMessageId(),
      role: "user",
      text: message
    },
    {
      createdAt: new Date().toISOString(),
      id: sourceEditorExplanationMessageId(),
      role: "assistant",
      text: answer
    }
  ];
  const nextMessages = [
    ...sourceEditorExplanationMessagesForAppend(explanation),
    sourceEditorExplanationMessage("user", message, createdAt),
    sourceEditorExplanationMessage("assistant", answer)
  ];
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...explanation,
    agentSettings: null,
    agentThreadId: followupAnswer.agentThreadId || explanation.agentThreadId,
    agentTurnId: followupAnswer.agentTurnId || explanation.agentTurnId,
    body: answer,
    engine: followupAnswer.engine || explanation.engine,
    executionProfile: followupAnswer.executionProfile || explanation.executionProfile,
    model: followupAnswer.executionProfile?.model || followupAnswer.model || explanation.model,
    followups: nextFollowups,
    messages: nextMessages,
    summary: sourceEditorExplanationSummary(answer)
  }, {
    explanationChats
  }));
}

function sourceEditorExplanationFollowupMessage(value = "") {
  const message = String(value || "").trim();
  if (!message) {
    throw sourceEditorError("Enter a question before sending a follow-up.", "vibe64_source_explanation_followup_empty");
  }
  if (message.length > SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH) {
    throw sourceEditorError("Follow-up question is too long.", "vibe64_source_explanation_followup_too_large", {
      maxLength: SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH
    }, 413);
  }
  return message;
}

function sourceEditorEconomyFollowupThread(explanation = {}) {
  const agentThreadId = normalizeText(explanation.agentThreadId);
  const executionProfile = sourceEditorExecutionProfileSnapshot(explanation.executionProfile);
  if (
    !executionProfile ||
    executionProfile.profileId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.profileId ||
    executionProfile.workloadId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.workloadId
  ) {
    throw sourceEditorError(
      "Regenerate this explanation before asking follow-up questions. Only a verified low-cost source-explanation conversation can be continued.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      409
    );
  }
  if (normalizeText(explanation.status) === "failed") {
    throw sourceEditorError(
      "Regenerate this explanation before asking another follow-up. Its previous assistant turn failed, so Vibe64 will not reuse that conversation.",
      "vibe64_source_explanation_agent_thread_failed",
      {},
      409
    );
  }
  if (!agentThreadId && normalizeText(explanation.engine) === "agent-cache") {
    return "";
  }
  if (!agentThreadId) {
    throw sourceEditorError(
      "Regenerate this explanation before asking follow-up questions. It was created before source explanation chat was available.",
      "vibe64_source_explanation_agent_thread_missing",
      {},
      409
    );
  }
  return agentThreadId;
}

async function streamSourceEditorExplanationFollowup(context = {}, input = {}, {
  emit = null,
  explanationChats = null,
  explanationTurns,
  isClosed = null,
  terminalService = null
} = {}) {
  const message = sourceEditorExplanationFollowupMessage(input.message);
  const baseExplanation = await readSourceEditorExplanation(context, input.explanationId, {
    explanationChats
  });
  const agentThreadId = sourceEditorEconomyFollowupThread(baseExplanation);
  const createdAt = new Date().toISOString();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  const explanation = {
    ...baseExplanation,
    agentSettings: null,
    agentTurnId: "",
    messages: [
      ...sourceEditorExplanationMessagesForAppend(baseExplanation),
      sourceEditorExplanationMessage("user", message, createdAt, {
        id: userMessageId
      }),
      sourceEditorExplanationMessage("assistant", "", createdAt, {
        id: assistantMessageId,
        status: "thinking"
      })
    ],
    error: "",
    ownerOriginId: baseExplanation.ownerOriginId || input.originId,
    status: "running"
  };

  const stream = createSourceEditorExplanationStreamState(context, explanation, {
    assistantMessageId,
    emit,
    explanationChats,
    explanationTurns,
    isClosed
  });

  try {
    stream.setExplanation(await writeSourceEditorExplanation(context, explanation, {
      explanationChats
    }));
    stream.emitEvent("source-explanation.followup.started", {
      assistantMessageId,
      userMessageId
    });

    const trackedTurn = await runTrackedSourceEditorAgentTurn(context, {
      assistantMessageId,
      currentExplanation: stream.currentExplanation,
      emitEvent: stream.emitEvent,
      explanationChats,
      fallbackError: "Source explanation follow-up failed.",
      remember: stream.remember,
      terminalService,
      run: () => streamSourceEditorAgentTurn(context, {
        answerMaxChars: SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS,
        outputSchema: SOURCE_EDITOR_FOLLOWUP_OUTPUT_SCHEMA,
        prompt: sourceEditorExplanationFollowupPrompt(baseExplanation, message),
        promptLabel: "Source code explanation follow-up",
        terminalService,
        threadId: agentThreadId,
        ...stream.streamHandlers
      })
    });
    if (trackedTurn.stopped) {
      return trackedTurn.explanation;
    }
    const result = trackedTurn.result;

    const nextFollowups = [
      ...baseExplanation.followups,
      {
        createdAt,
        id: userMessageId,
        role: "user",
        text: message
      },
      {
        createdAt: new Date().toISOString(),
        id: assistantMessageId,
        role: "assistant",
        text: result.text
      }
    ];
    return await stream.finish(result.text, {
      agentThreadId: result.threadId || stream.currentExplanation().agentThreadId,
      agentTurnId: result.turnId || stream.currentExplanation().agentTurnId,
      executionProfile: result.executionProfile,
      followups: nextFollowups,
      model: result.executionProfile.model,
      summary: sourceEditorExplanationSummary(result.text)
    });
  } finally {
    stream.finishPendingTurn();
  }
}

async function stopSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  let explanation = await readSourceEditorExplanationRecord(context, explanationId, {
    explanationChats
  });
  const assistantMessageId = explanation.messages.findLast((entry) => entry.role === "assistant")?.id;
  if (explanation.status === "running" && !explanation.agentTurnId) {
    const pendingTurn = explanationTurns.get(sourceEditorExplanationMemoryKey(context, explanationId));
    const identity = pendingTurn && pendingTurn.assistantMessageId === assistantMessageId
      ? await pendingTurn.identity
      : null;
    explanation = await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    });
    const currentAssistant = explanation.messages.findLast((entry) => entry.role === "assistant");
    if (currentAssistant?.id !== assistantMessageId || explanation.status !== "running") {
      return withSourceEditorExplanationFreshness(context, explanation);
    }
    if (!identity || explanation.agentThreadId !== identity.threadId || explanation.agentTurnId !== identity.turnId) {
      throw sourceEditorError(
        "The assistant turn identity is unavailable, so this source explanation could not be stopped.",
        "vibe64_source_explanation_agent_interrupt_unavailable",
        {},
        409
      );
    }
  }
  const threadId = normalizeText(explanation.agentThreadId);
  const turnId = normalizeText(explanation.agentTurnId);
  if (threadId && turnId) {
    if (!terminalService || typeof terminalService.interruptDetachedAgentChatTurn !== "function") {
      throw sourceEditorError("Agent chat interrupt is not available for source explanations.", "vibe64_source_explanation_agent_interrupt_unavailable", {}, 409);
    }
    const result = await terminalService.interruptDetachedAgentChatTurn(context.sessionId, {
      executionProfile: sourceEditorExecutionProfileSnapshot(explanation.executionProfile) ||
        sourceEditorExecutionProfileRequest(),
      threadId,
      turnId
    }, sourceEditorAgentOperationOptions(context, {}, {
      providerId: explanation.executionProfile?.providerId
    }));
    if (result?.ok !== true) {
      throw sourceEditorError(
        result?.error || "The agent service did not confirm that this source explanation was stopped.",
        result?.code || "vibe64_source_explanation_agent_interrupt_unconfirmed",
        isPlainObject(result) ? result : { interruptResult: result ?? null },
        result?.statusCode || 502
      );
    }
  }
  // Do not yield between checking the current request and publishing its stopped state.
  const current = sourceEditorExplanationStore(explanationChats).get(
    sourceEditorExplanationMemoryKey(context, explanationId)
  );
  const lastAssistant = current?.messages.findLast((entry) => entry.role === "assistant");
  if (!current || current.agentThreadId !== threadId || current.agentTurnId !== turnId ||
      lastAssistant?.id !== assistantMessageId) {
    return withSourceEditorExplanationFreshness(context, await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    }));
  }
  explanation = current;
  if (lastAssistant?.id) {
    explanation = sourceEditorExplanationWithMessage(explanation, lastAssistant.id, {
      status: "stopped",
      text: lastAssistant.text || "Stopped."
    });
  }
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...explanation,
    status: "stopped"
  }, {
    explanationChats
  }));
}

function sourceEditorCleanupActiveIds(value = []) {
  return new Set((Array.isArray(value) ? value : [])
    .map((id) => {
      try {
        return normalizeSourceEditorExplanationId(id);
      } catch {
        return "";
      }
    })
    .filter(Boolean));
}

function sourceEditorCleanupRecordAgeMs(record = {}, nowMs = Date.now()) {
  const timestampMs = Date.parse(record.updatedAt || record.createdAt || "");
  return Number.isFinite(timestampMs) ? Math.max(0, nowMs - timestampMs) : Number.POSITIVE_INFINITY;
}

function shouldCleanupSourceEditorExplanationRecord(record = {}, {
  activeIds = new Set(),
  nowMs = Date.now(),
  originId = ""
} = {}) {
  if (activeIds.has(record.id)) {
    return false;
  }
  const recordOriginId = normalizeText(record.originId);
  const requestedOriginId = normalizeText(originId);
  if (requestedOriginId && recordOriginId && requestedOriginId === recordOriginId) {
    return true;
  }
  return sourceEditorCleanupRecordAgeMs(record, nowMs) >= SOURCE_EDITOR_EXPLANATION_CLEANUP_MAX_AGE_MS;
}

async function cleanupSourceEditorExplanations(context = {}, input = {}, {
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  const activeIds = sourceEditorCleanupActiveIds(input.activeExplanationIds);
  const originId = normalizeText(input.originId);
  const store = sourceEditorExplanationStore(explanationChats);
  const cleaned = [];
  const failures = [];
  const nowMs = Date.now();

  const remaining = await mutateSourceEditorExplanationCleanupRecords(context, async (records) => {
    const nextRecords = [];
    for (const record of records) {
      if (!shouldCleanupSourceEditorExplanationRecord(record, {
        activeIds,
        nowMs,
        originId
      })) {
        nextRecords.push(record);
        continue;
      }

      try {
        const key = sourceEditorExplanationMemoryKey(context, record.id);
        const pendingTurn = explanationTurns.get(key);
        const agentCleanup = await deleteSourceEditorExplanationAgentThread(context, record, {
          terminalService
        });
        store.delete(key);
        pendingTurn?.close();
        cleaned.push({
          id: record.id,
          status: normalizeText(agentCleanup?.status || "deleted"),
          threadId: record.agentThreadId
        });
      } catch (error) {
        failures.push({
          code: normalizeText(error?.code || "vibe64_source_explanation_cleanup_failed"),
          error: normalizeText(error?.message || "Source explanation cleanup failed."),
          id: record.id,
          threadId: record.agentThreadId
        });
        nextRecords.push(record);
      }
    }
    return nextRecords;
  });

  return {
    activeIds: [...activeIds],
    cleaned,
    failureCount: failures.length,
    failures,
    remainingCount: remaining.length
  };
}

async function deleteSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  const store = sourceEditorExplanationStore(explanationChats);
  const key = sourceEditorExplanationMemoryKey(context, explanationId);
  const explanation = store.get(key) || await readSourceEditorExplanationCleanupRecord(context, explanationId);
  if (!explanation) {
    return {
      agentCleanup: {
        ok: true,
        status: "notFound"
      },
      deleted: false
    };
  }
  const pendingTurn = explanationTurns.get(key);
  const agentCleanup = await deleteSourceEditorExplanationAgentThread(context, explanation, {
    terminalService
  });
  store.delete(key);
  pendingTurn?.close();
  await removeSourceEditorExplanationCleanupRecord(context, explanationId);
  return {
    agentCleanup,
    deleted: true
  };
}

function normalizeGeneratedSourceEditorFollowup(value = "") {
  if (typeof value === "string") {
    return {
      answer: value.trim()
    };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    answer: String(source.answer || source.text || "").trim(),
    agentThreadId: normalizeText(source.agentThreadId),
    agentTurnId: normalizeText(source.agentTurnId),
    engine: normalizeText(source.engine),
    executionProfile: sourceEditorExecutionProfileSnapshot(source.executionProfile),
    model: normalizeText(source.model)
  };
}

async function generateSourceEditorExplanationFollowupWithAgentService(explanation = {}, message = "", {
  context = {},
  terminalService = null
} = {}) {
  if (!terminalService || typeof terminalService.runDetachedAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat is not available for source explanations.", "vibe64_source_explanation_agent_unavailable", {}, 409);
  }
  const agentThreadId = sourceEditorEconomyFollowupThread(explanation);
  let observedExecutionProfile = sourceEditorExecutionProfileSnapshot(explanation.executionProfile);
  let observedThreadId = agentThreadId;
  let observedTurnId = "";
  let result;
  try {
    result = await terminalService.runDetachedAgentChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
      executionProfile: sourceEditorExecutionProfileRequest(),
      expectedAccountIdentitySignature: normalizeText(context.agentAccountIdentitySignature),
      outputSchema: SOURCE_EDITOR_FOLLOWUP_OUTPUT_SCHEMA,
      prompt: sourceEditorExplanationFollowupPrompt(explanation, message),
      promptLabel: "Source code explanation follow-up",
      threadId: agentThreadId,
      timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
    }, sourceEditorAgentOperationOptions(context, {
      onEvent(event = {}) {
        observedExecutionProfile ||= sourceEditorExecutionProfileSnapshot(event.executionProfile);
        observedThreadId = normalizeText(event.threadId) || observedThreadId;
        observedTurnId = normalizeText(event.turnId) || observedTurnId;
      }
    }));
    observedExecutionProfile ||= sourceEditorExecutionProfileSnapshot(result?.executionProfile);
    observedThreadId = normalizeText(result?.threadId) || observedThreadId;
    observedTurnId = normalizeText(result?.turnId) || observedTurnId;
    if (result?.ok === false) {
      const failure = sourceEditorFollowupThreadError(result);
      throw sourceEditorError(
        failure.error || failure.message || "The agent could not answer this source explanation follow-up.",
        failure.code || "vibe64_source_explanation_agent_failed",
        failure,
        failure.statusCode || 502
      );
    }
    const answer = sourceEditorStructuredAnswer(result?.text, {
      maxChars: SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS
    });
    const executionProfile = requiredSourceEditorExecutionProfile(result?.executionProfile);
    return {
      agentThreadId: observedThreadId,
      agentTurnId: observedTurnId,
      answer,
      engine: "agent-chat",
      executionProfile,
      model: executionProfile.model
    };
  } catch (error) {
    if (!observedThreadId) {
      throw sourceEditorFollowupThreadError(error);
    }
    const cleanup = await cleanupRejectedSourceEditorExplanationThread(
      context,
      observedThreadId,
      terminalService,
      observedExecutionProfile
    );
    const failure = sourceEditorFailureWithFollowupThreadRetirement(
      sourceEditorFollowupThreadError(error),
      {
        cleanupSucceeded: cleanup.ok === true,
        executionProfile: observedExecutionProfile,
        threadId: observedThreadId,
        turnId: observedTurnId
      }
    );
    if (cleanup.ok !== true) {
      failure.details = {
        ...(isPlainObject(failure.details) ? failure.details : {}),
        cleanupError: normalizeText(cleanup.error),
        cleanupRequired: true,
        cleanupThreadId: observedThreadId
      };
    }
    throw failure;
  }
}

function sourceEditorExplanationFollowupPrompt(explanation = {}, message = "") {
  const range = explanation.sourceRange || {};
  const wholeFile = range.scope === "file";
  return [
    "Continue the Vibe64 source-code explanation thread.",
    wholeFile
      ? "Answer the user's follow-up about the same whole-file explanation and its role in the project."
      : "Answer the user's follow-up about the same selected source range and its role in the project.",
    "Assume the user knows the programming language; focus on project behavior, relationships, data/control flow, risks, and intent.",
    "Use only the bounded context below. Do not inspect the repository, use tools, access the network, or edit files. If the current explanation is stale, say so plainly before answering.",
    `Return concise user-facing Markdown no longer than ${SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS.toLocaleString("en-US")} characters.`,
    "",
    `File: ${range.path}`,
    `Target: ${wholeFile ? "whole file" : `lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`}`,
    explanation.stale ? `Stale status: ${explanation.staleReason || "The source changed."}` : "Stale status: current",
    "",
    "Current explanation summary:",
    explanation.summary || "(none)",
    "",
    "Current explanation body:",
    boundedSourceEditorPromptText(explanation.body || "(none)", SOURCE_EDITOR_FOLLOWUP_CONTEXT_MAX_CHARS),
    "",
    "User follow-up:",
    message
  ].join("\n");
}

async function saveSourceEditorFile(context = {}, input = {}) {
  const file = await sourceEditorExistingFile(context, input.path);
  const currentBuffer = await readFile(file.absolutePath);
  assertTextBuffer(currentBuffer, file.relativePath);
  const currentHash = sourceEditorHash(currentBuffer);
  const baseHash = normalizeText(input.baseHash);
  if (baseHash && baseHash !== currentHash) {
    throw sourceEditorError("This file changed on disk. Reload it before saving.", SOURCE_EDITOR_CONFLICT_CODE, {
      currentHash,
      path: file.relativePath
    }, 409);
  }

  const nextText = String(input.text ?? "");
  const nextBuffer = Buffer.from(nextText, "utf8");
  if (nextBuffer.byteLength > context.policy.maxFileBytes) {
    throw sourceEditorError("The edited file is too large for the source editor.", "vibe64_source_editor_file_too_large", {
      maxFileBytes: context.policy.maxFileBytes,
      path: file.relativePath,
      size: nextBuffer.byteLength
    }, 413);
  }
  assertTextBuffer(nextBuffer, file.relativePath);
  await writeSourceEditorTextFile(context, file.absolutePath, nextText);
  const savedBuffer = await readFile(file.absolutePath);
  const savedStats = await lstat(file.absolutePath);
  return sourceEditorFilePayload(file.relativePath, savedBuffer, savedStats, {
    text: undefined
  });
}

function sourceEditorFileChange(context = {}, input = {}, file = {}) {
  return {
    hash: normalizeText(file.hash),
    mtimeMs: file.mtimeMs,
    originId: normalizeText(input.originId),
    path: normalizeSourceEditorRelativePath(file.path || input.path),
    projectSlug: normalizeText(input.projectSlug),
    sessionId: normalizeText(context.sessionId || input.sessionId),
    size: file.size,
    updatedAt: new Date().toISOString()
  };
}

function assertTextBuffer(buffer, relativePath = "") {
  if (buffer.includes(0)) {
    throw sourceEditorError("The selected file appears to be binary.", "vibe64_source_editor_binary_file", {
      path: relativePath
    }, 415);
  }
}

function sourceEditorTempRoot(temporaryRoot = "", sessionId = "") {
  const root = normalizeText(temporaryRoot);
  if (!path.isAbsolute(root)) {
    throw sourceEditorError("Source editor requires an absolute runtime temp root.", "vibe64_source_editor_temp_root_missing", {}, 500);
  }
  const sessionKey = crypto.createHash("sha256")
    .update(normalizeText(sessionId))
    .digest("hex")
    .slice(0, 24);
  return path.join(root, "vibe64-source-editor", sessionKey);
}

async function writeSourceEditorTextFile(context = {}, absolutePath = "", text = "") {
  const tempRoot = normalizeText(context.sourceEditorTempRoot);
  if (!tempRoot) {
    throw sourceEditorError("Source editor save requires runtime temp storage.", "vibe64_source_editor_temp_root_missing", {}, 500);
  }
  await mkdir(tempRoot, {
    recursive: true
  });
  const temporaryPath = path.join(tempRoot, `${process.pid}-${Date.now()}-${crypto.randomUUID()}-${path.basename(absolutePath)}`);
  try {
    await writeFile(temporaryPath, text, "utf8");
    await copyFile(temporaryPath, absolutePath);
  } finally {
    await rm(temporaryPath, {
      force: true
    }).catch(() => null);
  }
}

function sourceEditorHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sourceEditorFilePayload(relativePath = "", buffer, stats, overrides = {}) {
  return {
    hash: sourceEditorHash(buffer),
    language: sourceEditorLanguageForPath(relativePath),
    mtimeMs: stats.mtimeMs,
    path: relativePath,
    size: buffer.byteLength,
    text: buffer.toString("utf8"),
    ...overrides
  };
}

function sourceEditorLanguageForPath(filePath = "") {
  const basename = path.posix.basename(String(filePath || "")).toLowerCase();
  const extension = path.posix.extname(basename);
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue"].includes(extension)) {
    return "javascript";
  }
  if (extension === ".json") {
    return "json";
  }
  if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"].includes(extension)) {
    return "cpp";
  }
  if ([".sh", ".bash", ".zsh", ".fish"].includes(extension) || ["bashrc", "zshrc"].includes(basename)) {
    return "shell";
  }
  if ([".md", ".markdown", ".todo"].includes(extension) || basename === "todo") {
    return "markdown";
  }
  return "text";
}

export {
  SOURCE_EDITOR_CONFLICT_CODE,
  createService,
  normalizeSourceEditorRelativePath,
  pathMatchesPolicyPattern,
  sourceEditorLanguageForPath
};
