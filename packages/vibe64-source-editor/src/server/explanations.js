import crypto from "node:crypto";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { GENESIS_MACHINE_CITY_PATH, validateArchitectureFacts, SOURCE_EXPLANATION_PROMPT_VERSION, sourceExplanationGuidance } from "@local/vibe64-genesis/server";
import { isMissingPathError, normalizeText } from "@local/vibe64-core/server/core";
import { VIBE64_AGENT_EXECUTION_PROFILE_IDS, VIBE64_AGENT_EXECUTION_WORKLOAD_IDS, defineVibe64AgentExecutionProfileRequest, vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import { readSourceInterpretation, writeSourceInterpretation } from "./sourceInterpretations.js";
import {
  downloadSessionFile,
  isPlainObject,
  normalizeSourceEditorRelativePath,
  readSourceEditorFile,
  runSourceEditorOperation,
  sourceEditorError,
  sourceEditorErrorResponse,
  sourceEditorHash,
  sourceEditorLanguageForPath,
  sourceEditorTempRoot,
  streamSourceEditorOperation
} from "./sourceFiles.js";

// Source explanations: helper agent routing, cache, cleanup ledger, prompts
// and streamed turns.
const SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES = 6;

const SOURCE_EDITOR_EXPLANATION_CONTEXT_MAX_CHARS = 12_000;

const SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS = 60_000;

const SOURCE_EDITOR_EXPLANATION_MAX_LINES = 240;

const SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES = 128 * 1024 * 1024;

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
  profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
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
  if (typeof terminalService?.resolveAssistantPurpose !== "function") {
    throw sourceEditorError("Assistant routing is unavailable for source explanations.", "vibe64_source_explanation_authorization_unavailable", {}, 503);
  }
  const decision = await terminalService.resolveAssistantPurpose({ purpose: "source_explanation" }, {
    runtime: context.runtime, session: context.session, vibe64User: context.vibe64User
  });
  if (!decision.available) throw sourceEditorError(decision.message, decision.reasonCode, {}, 409);
  return { providerId: decision.effectiveSelection.engineId, accountIdentitySignature: decision.connectionIdentity, decision };
}

async function resolveSourceEditorAgentExecutionProfile(terminalService = null, context = {}) {
  if (typeof terminalService?.resolveEphemeralAgentExecutionProfile !== "function") {
    throw sourceEditorError(
      "The selected assistant provider cannot resolve the low-cost profile required for source explanations.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      503
    );
  }
  const resolved = await terminalService.resolveEphemeralAgentExecutionProfile(
    context.assistantHelper.scope,
    sourceEditorExecutionProfileRequest(),
    { assistantSelection: context.assistantHelper.selection, vibe64User: context.vibe64User,
      expectedConnectionIdentity: context.assistantHelper.connectionIdentity }
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

async function runSourceEditorHelperTurn(terminalService, context, input, options = {}) {
  const helper = context.assistantHelper;
  const result = await terminalService.runEphemeralAgentChatTurn(helper.scope, {
    ...input, executionProfile: resolvedSourceEditorExecutionProfile(context.agentExecutionProfile)
  }, {
    assistantSelection: helper.selection, vibe64User: context.vibe64User,
    expectedConnectionIdentity: helper.connectionIdentity, signal: context.signal,
    async onEvent(event) {
      if (event.type === "thread") helper.conversationId = normalizeText(event.threadId);
      else if (event.type === "turn") helper.runId = normalizeText(event.turnId);
      else if (event.type === "helper-execution") helper.executionId = normalizeText(event.executionId);
      if (["thread", "turn", "helper-execution"].includes(event.type)) await context.retainAssistantHelper();
      await options.onEvent?.(event);
    }
  });
  helper.conversationId = normalizeText(result?.threadId) || helper.conversationId;
  helper.runId = normalizeText(result?.turnId) || helper.runId;
  await context.retainAssistantHelper();
  return result;
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
    return JSON.stringify(current?.decision.effectiveSelection) === JSON.stringify(context.assistantHelper.selection) &&
      normalizeText(current?.providerId) === expectedProviderId &&
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

function sourceEditorInterfacePromptVersion(presentation) {
  return `${SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION}:${presentation}:${SOURCE_EXPLANATION_PROMPT_VERSION}${presentation === 'description' ? ':overview-v5' : ':pseudocode-v5'}`;
}

function sourceEditorInterpretationCacheOptions(context, input, cacheKey, logger) {
  // Reuse the existing private cache for on-demand file overviews and exact
  // function pseudocode. Neither interpretation changes the authored Program.
  const range = input.range;
  if (!(range.scope === 'file' && range.presentation === 'description')
    && !(range.scope === 'selection' && range.presentation === 'steps' && range.symbolId)) return {};
  return {
    readCompleted: () => readSourceInterpretation(context, input, cacheKey).catch(() => null),
    writeCompleted: async (template, currentGeneration) => {
      try {
        await writeSourceInterpretation(context, input, cacheKey, template, async () => currentGeneration()
          && (await readSourceEditorFile(context, input.range.path)).hash === input.range.fileHash);
      } catch (error) {
        // Saving an optional interpretation must not fail a completed Helper
        // conversation or replace its existing stop/recovery lifecycle.
        logger?.warn('Source interpretation could not be saved.', { path: input.range.path, error });
      }
    }
  };
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
    normalizeText(range.symbolId),
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
    validateCompleted = null,
    readCompleted = null,
    writeCompleted = null
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
      const template = read(key) || (readCompleted ? await readCompleted() : null);
      if (template) {
        const completedIdentityValid = typeof validateCompleted !== "function" ||
          await validateCompleted(template) === true;
        if (completedIdentityValid && !closed && generations.get(key) === token) {
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
          validateCompleted,
          readCompleted,
          writeCompleted
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
          if (template && writeCompleted && !closed && generations.get(key) === token) {
            await writeCompleted(template, () => !closed && generations.get(key) === token);
          }
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

// Source explanations own their helper turns, conversation memory and cache.
function createExplanationOperations({
  explanationCacheNow,
  explanationFollowupGenerator,
  explanationGenerator,
  logger,
  projectService,
  sourceEditorContext,
  temporaryRoot,
  terminalService
}) {
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

  async function runSourceEditorAgentOperation(input = {}, operation) {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const explanationId = sourceEditorClientExplanationId(input.explanationId) || sourceEditorExplanationId();
    const key = sourceEditorExplanationMemoryKey({ sessionId }, explanationId);
    if (explanationTurns.has(key)) throw sourceEditorError("This explanation is already answering a question.", "vibe64_source_explanation_busy", {}, 409);
    const task = { sessionId, projectScope: currentProjectScopeKey(), id: explanationId, originId: input.originId,
      updatedAt: new Date().toISOString(), controller: new AbortController() };
    explanationTurns.set(key, task);
    let runtime;
    const run = async () => {
      const context = await sourceEditorContext(sessionId, { agentOperation: true, runtime, vibe64User: input.vibe64User });
      context.explanationId = explanationId;
      context.signal = task.controller.signal;
      context.signal.throwIfAborted();
      const retained = await readSourceEditorExplanationCleanupRecord(context, context.explanationId);
      if (retained?.helper && input.message) {
        const helper = retained.helper;
        if (helper.actorIdentity !== context.agentAccountIdentity || helper.connectionIdentity !== context.agentRoutingDecision.connectionIdentity ||
            JSON.stringify(helper.selection) !== JSON.stringify(context.agentRoutingDecision.effectiveSelection)) {
          throw sourceEditorError("This explanation uses a different AI or account. Start a new explanation to continue.",
            "vibe64_source_explanation_destination_changed", {}, 409);
        }
        context.assistantHelper = helper;
      } else {
        if (retained) {
          await deleteSourceEditorExplanationAgentThread(context, retained, { terminalService });
          await removeSourceEditorExplanationCleanupRecord(context, context.explanationId);
        }
        const id = `source_${crypto.randomUUID()}`;
        const root = path.join(runtime.stateRoot, "assistant-helpers", id);
        context.assistantHelper = { scope: { id, runtimeRoot: path.join(root, "runtime"), workdir: path.join(root, "workdir"),
          environment: {}, stableContext: "Explain only the supplied source and conversation. You have no tools or project access." },
          selection: context.agentRoutingDecision.effectiveSelection, connectionIdentity: context.agentRoutingDecision.connectionIdentity,
          actorIdentity: context.agentAccountIdentity, conversationId: "", runId: "", executionId: "" };
      }
      const retain = () => upsertSourceEditorExplanationCleanupRecord(context, { id: context.explanationId,
        sourceRange: { path: input.path || retained?.sourcePath || "" }, ownerOriginId: input.originId || retained?.originId,
        agentThreadId: context.assistantHelper.conversationId, agentTurnId: context.assistantHelper.runId,
        status: "running", createdAt: retained?.createdAt || task.updatedAt, updatedAt: new Date().toISOString() });
      context.retainAssistantHelper = retain;
      await retain();
      try {
        await mkdir(context.assistantHelper.scope.workdir, { recursive: true, mode: 0o700 });
        await mkdir(context.assistantHelper.scope.runtimeRoot, { recursive: true, mode: 0o700 });
        context.agentExecutionProfile = await resolveSourceEditorAgentExecutionProfile(terminalService, context);
        context.assistantHelper.executionProfile = sourceEditorExecutionProfileSnapshot(context.agentExecutionProfile);
        await retain();
        context.signal.throwIfAborted();
        const result = await operation(context);
        if (result?.status !== "stopped") context.signal.throwIfAborted();
        return result;
      } finally {
        if (context.assistantHelper && !context.assistantHelper.conversationId) {
          await deleteSourceEditorExplanationAgentThread(context, { id: context.explanationId, helper: context.assistantHelper }, { terminalService });
          await removeSourceEditorExplanationCleanupRecord(context, context.explanationId);
        }
      }
    };
    task.promise = (async () => {
      runtime = await projectService.createRuntime({ sessionId });
      task.controller.signal.throwIfAborted();
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
    })().finally(() => {
      if (explanationTurns.get(key) === task) explanationTurns.delete(key);
    });
    return task.promise;
  }

  return {
    operations: {
      async explainSelection(input = {}) {
        return runSourceEditorOperation(async () => {
          return runSourceEditorAgentOperation(input, async (context) => {
            const explanationInput = await sourceEditorExplanationInput(context, input);
            const cacheKey = sourceEditorExplanationCacheKey(context, explanationInput);
            return {
              explanation: await explanationCache.run(cacheKey, {
                completedCache: Boolean(context.agentAccountIdentitySignature),
                force: input.force === true,
                ...sourceEditorInterpretationCacheOptions(context, explanationInput, cacheKey, logger),
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
            return explanationCache.run(cacheKey, {
              completedCache: Boolean(context.agentAccountIdentitySignature),
              force: input.force === true,
              ...sourceEditorInterpretationCacheOptions(context, explanationInput, cacheKey, logger),
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

      async closeExplanationsForSession(sessionId) {
        const runtime = await projectService.createRuntime({ sessionId });
        const result = await cleanupSourceEditorExplanations({ runtime, sessionId,
          sourceEditorTempRoot: sourceEditorTempRoot(temporaryRoot, sessionId)
        }, {}, { all: true, explanationChats, explanationTurns, terminalService });
        return { ...result, ok: result.failureCount === 0,
          ...(result.failureCount ? { code: "vibe64_source_explanation_cleanup_failed",
            error: result.failures[0].error } : {}) };
      },
    },

    async close() {
      const tasks = [...explanationTurns.values()];
      for (const task of tasks) task.controller.abort();
      await Promise.allSettled(tasks.map((task) => task.promise));
      explanationCache.close();
    }
  };
}

function normalizeSourceEditorExplanationId(value = "") {
  const id = normalizeText(value);
  if (!/^[a-z0-9_-]+$/u.test(id)) {
    throw sourceEditorError("Invalid source explanation id.", "vibe64_source_explanation_id_invalid");
  }
  return id;
}

function sourceEditorExplanationMemoryKey(context = {}, explanationId = "") {
  return `${currentProjectScopeKey()}\0${normalizeText(context.sessionId)}:${normalizeSourceEditorExplanationId(explanationId)}`;
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
  if (!agentThreadId && !source.helper) {
    return null;
  }
  return {
    ...(source.helper ? { helper: structuredClone(source.helper) } : {}),
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
  const record = explanation;
  return normalizeSourceEditorCleanupRecord({
    ...(context.assistantHelper && context.explanationId === record.id ? { helper: context.assistantHelper } : {}),
    agentThreadId: record.agentThreadId,
    agentTurnId: record.agentTurnId,
    createdAt: record.createdAt,
    id: record.id,
    originId: record.ownerOriginId,
    sessionId: context.sessionId,
    sourcePath: record.sourceRange?.path,
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
    { ...records.find((record) => record.id === cleanupRecord.id), ...cleanupRecord }
  ]);
}

async function removeSourceEditorExplanationCleanupRecord(context = {}, explanationId = "") {
  let normalizedId = "";
  try {
    normalizedId = normalizeSourceEditorExplanationId(explanationId);
  } catch {
    return;
  }
  let removed;
  await mutateSourceEditorExplanationCleanupRecords(context, (records) => {
    removed = records.find((record) => record.id === normalizedId);
    return records.filter((record) => record.id !== normalizedId);
  });
  if (removed?.helper) await rm(sourceEditorHelperRoot(context, removed.helper), { recursive: true, force: true });
}

function sourceEditorHelperRoot(context, helper) {
  const root = path.join(context.runtime.stateRoot, "assistant-helpers", helper.scope.id);
  if (!/^source_[a-f0-9-]+$/u.test(helper.scope.id) || helper.scope.workdir !== path.join(root, "workdir") ||
      helper.scope.runtimeRoot !== path.join(root, "runtime")) {
    throw sourceEditorError("The source explanation has invalid cleanup paths.", "vibe64_source_explanation_cleanup_failed");
  }
  return root;
}

async function readSourceEditorExplanationCleanupRecord(context = {}, explanationId = "") {
  const normalizedId = normalizeSourceEditorExplanationId(explanationId);
  return (await readSourceEditorExplanationCleanupRecords(context))
    .find((record) => record.id === normalizedId) || null;
}

async function deleteSourceEditorExplanationAgentThread(context = {}, record = {}, {
  terminalService = null
} = {}) {
  if (record.helper) {
    const helper = record.helper;
    sourceEditorHelperRoot(context, helper);
    const deleted = await terminalService.deleteEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId, cleanupExecutionId: helper.executionId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
    }, { assistantSelection: helper.selection, vibe64User: context.vibe64User });
    if (deleted?.ok !== true) throw sourceEditorError(deleted?.error || "The source explanation helper could not be closed.",
      deleted?.code || "vibe64_source_explanation_agent_cleanup_unconfirmed");
    return deleted;
  }
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
  if (context.assistantHelper && context.explanationId === record.id) {
    context.assistantHelper.conversationId = record.agentThreadId || context.assistantHelper.conversationId;
    context.assistantHelper.runId = record.agentTurnId || context.assistantHelper.runId;
  }
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
    return ["stopping", "stopped"].includes(record.status) ? record : null;
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
      ...(["description", "steps"].includes(sourceRange.presentation) ? { presentation: sourceRange.presentation } : {}),
      ...(sourceRange.symbolId ? { symbolId: normalizeText(sourceRange.symbolId) } : {}),
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
    (range.scope !== "file" || range.presentation === 'description' || lines.length <= SOURCE_EDITOR_EXPLANATION_MAX_LINES) &&
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
  if (input.expectedHash && input.expectedHash !== file.hash) throw sourceEditorError("The saved file changed. Reopen it before requesting an explanation.", "vibe64_source_explanation_source_changed", {}, 409);
  const presentation = input.presentation;
  if (presentation !== undefined && !["description", "steps"].includes(presentation)) throw sourceEditorError("Choose Description or Steps.", "vibe64_source_explanation_presentation_invalid");
  const lines = sourceEditorLines(file.text);
  const symbolId = input.symbolId;
  let selection = input;
  if (symbolId !== undefined) {
    if (typeof symbolId !== "string" || !symbolId.trim() || symbolId.length > 4096) {
      throw sourceEditorError("Choose a valid indexed symbol.", "vibe64_source_explanation_symbol_invalid");
    }
    let architecture;
    try {
      // Reuse the original path, symlink and file-identity checks. The native
      // index has its own bound; it is not subject to the editable-file limit.
      const { fileHandle } = await downloadSessionFile(context, GENESIS_MACHINE_CITY_PATH);
      try {
        if ((await fileHandle.stat()).size > SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES) {
          throw sourceEditorError("Symbol analysis exceeds the supported size. Use Code or explain a selection.", "vibe64_source_explanation_index_too_large", {}, 413);
        }
        const chunks = [];
        for await (const chunk of fileHandle.createReadStream({ start: 0, end: SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES, autoClose: false })) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length > SOURCE_EDITOR_ARCHITECTURE_MAX_BYTES) {
          throw sourceEditorError("Symbol analysis exceeds the supported size. Use Code or explain a selection.", "vibe64_source_explanation_index_too_large", {}, 413);
        }
        architecture = validateArchitectureFacts(JSON.parse(buffer.toString("utf8")).architecture);
      } finally {
        await fileHandle.close();
      }
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 413) throw error;
      throw sourceEditorError("Symbol analysis is unavailable or invalid. Refresh analysis before describing the symbol.", "vibe64_source_explanation_index_unavailable", {}, 409);
    }
    const symbol = architecture.symbols.find(entry => entry.id === symbolId);
    const indexedFile = architecture.files.find(entry => entry.id === symbol?.fileId);
    if (!symbol?.rangeAvailable || symbol.path !== file.path || indexedFile?.path !== file.path || indexedFile.hash !== `sha256:${file.hash}`) {
      throw sourceEditorError("This symbol changed after analysis. Refresh analysis before describing it.", "vibe64_source_explanation_symbol_changed", {}, 409);
    }
    for (const point of [symbol.start, symbol.end]) {
      if (point.line > lines.length || point.column > lines[point.line - 1].length + 1) {
        throw sourceEditorError("The indexed symbol range is invalid for this file. Refresh analysis.", "vibe64_source_explanation_symbol_changed", {}, 409);
      }
    }
    if (presentation === 'steps' && !Array.isArray(symbol.parameters)) throw sourceEditorError("Explain function is available for callable declarations. Use Explain file or Code for other declarations.", "vibe64_source_explanation_not_callable");
    selection = { startLine: symbol.start.line, startColumn: symbol.start.column, endLine: symbol.end.line, endColumn: symbol.end.column };
  }
  const scope = symbolId !== undefined ? "selection" : normalizeText(input.scope) === "file" ? "file" : "selection";
  if (scope === 'file' && presentation === 'description') {
    selection = { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: lines.at(-1).length + 1 };
  }
  const range = sourceEditorRangeWithSelectionColumns(
    normalizeSourceEditorLineRange(selection, lines.length),
    selection,
    lines
  );
  const selectedText = sourceEditorSelectionForRange(file.text, range);
  if (!selectedText.trim()) {
    throw sourceEditorError("Select code before asking for an explanation.", "vibe64_source_explanation_empty_selection");
  }
  const selectedLineCount = range.endLine - range.startLine + 1;
  if (scope !== "file" && symbolId === undefined && selectedLineCount > SOURCE_EDITOR_EXPLANATION_MAX_LINES) {
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
  const promptVersion = presentation ? sourceEditorInterfacePromptVersion(presentation) : SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION;
  const promptCode = sourceEditorExplanationPromptCode({
    range: {
      ...range,
      scope,
      presentation
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
      ...(presentation ? { presentation } : {}),
      ...(symbolId !== undefined ? { symbolId } : {}),
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
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || context.explanationId || sourceEditorExplanationId();
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
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || context.explanationId || sourceEditorExplanationId();
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
  if (!terminalService || typeof terminalService.runEphemeralAgentChatTurn !== "function") {
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
    result = await runSourceEditorHelperTurn(terminalService, context, {
      executionProfile: resolvedSourceEditorExecutionProfile(context.agentExecutionProfile),
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
  if (context.assistantHelper) {
    try {
      const result = await deleteSourceEditorExplanationAgentThread(context, { helper: context.assistantHelper }, { terminalService });
      await removeSourceEditorExplanationCleanupRecord(context, context.explanationId);
      context.assistantHelper = null;
      return result;
    } catch (error) {
      return { ok: false, error: normalizeText(error.message) || "Agent chat cleanup failed." };
    }
  }
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
  if (!terminalService || typeof terminalService.runEphemeralAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat streaming is not available for source explanations.", "vibe64_source_explanation_agent_stream_unavailable", {}, 409);
  }
  let latestText = "";
  let latestExecutionProfile = null;
  let latestThreadId = normalizeText(threadId);
  let latestTurnId = "";
  let result = null;
  try {
    result = await runSourceEditorHelperTurn(terminalService, context, {
      executionProfile: resolvedSourceEditorExecutionProfile(context.agentExecutionProfile),
      outputSchema,
      prompt,
      promptLabel,
      threadId,
      timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
    }, sourceEditorAgentOperationOptions(context, {
      async onEvent(event = {}) {
        const eventExecutionProfile = sourceEditorExecutionProfileSnapshot(event.executionProfile);
        if (eventExecutionProfile && !latestExecutionProfile) {
          latestExecutionProfile = eventExecutionProfile;
          await onExecutionProfile?.(eventExecutionProfile);
        }
        if (event.type === "thread") {
          latestThreadId = normalizeText(event.threadId) || latestThreadId;
          await onThread?.({
            replacedThreadId: normalizeText(event.replacedThreadId),
            threadId: latestThreadId
          });
          return;
        }
        if (event.type === "turn") {
          latestThreadId = normalizeText(event.threadId) || latestThreadId;
          latestTurnId = normalizeText(event.turnId) || latestTurnId;
          await onTurn?.({
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
        if (classification.kind === 'live_progress') {
          await onText?.({ kind: 'live_progress', text: latestText, threadId: latestThreadId, turnId: latestTurnId });
        }
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
      await onExecutionProfile?.(executionProfile);
    }
    const text = sourceEditorStructuredAnswer(result?.text || latestText, {
      maxChars: answerMaxChars
    });
    await onText?.({
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
      await onExecutionProfile?.(failureProfile);
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
  remember = async () => {},
  setExplanation = () => {}
} = {}) {
  const updateExplanation = async (patch = {}) => {
    const next = {
      ...currentExplanation(),
      ...patch
    };
    setExplanation(next);
    await remember(patch);
    return next;
  };

  return {
    async onExecutionProfile(executionProfile) {
      await updateExplanation({
        executionProfile,
        model: executionProfile.model
      });
      emitEvent("source-explanation.execution-profile", {
        executionProfile
      });
    },
    async onThread({ threadId }) {
      await updateExplanation({
        agentThreadId: threadId
      });
      emitEvent("source-explanation.thread", {
        threadId
      });
    },
    async onTurn({ threadId, turnId }) {
      await updateExplanation({
        agentThreadId: threadId,
        agentTurnId: turnId
      });
      emitEvent("source-explanation.turn", {
        threadId,
        turnId
      });
    },
    async onText({ text }) {
      const next = sourceEditorExplanationWithMessage(currentExplanation(), assistantMessageId, {
        status: "thinking",
        text
      });
      setExplanation(next);
      await remember({
        messages: next.messages
      });
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
  isClosed = null
} = {}) {
  let explanation = initialExplanation;
  let writeQueue = Promise.resolve(explanation);
  const currentExplanation = () => explanation;
  const setExplanation = (value) => {
    explanation = value;
  };
  const remember = (patch = {}) => {
    const store = sourceEditorExplanationStore(explanationChats);
    const stored = store.get(sourceEditorExplanationMemoryKey(context, explanation.id));
    if (["stopping", "stopped"].includes(stored?.status) && patch.status !== "failed") {
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
      if (stopped && patch.status !== "failed") {
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
    remember,
    setExplanation,
    streamHandlers: sourceEditorAgentStreamHandlers({
      assistantMessageId,
      currentExplanation,
      emitEvent,
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
    const profile = sourceEditorExecutionProfileSnapshot(executionProfile) || stopped.executionProfile;
    const message = stopped.messages.findLast((entry) => entry.role === "assistant");
    if (message) stopped = sourceEditorExplanationWithMessage(stopped, message.id, {
      status: "stopped", text: message.text || "Stopped."
    });
    stopped = await writeSourceEditorExplanation(context, { ...stopped,
      ...(profile ? { executionProfile: profile, model: profile.model } : {}),
      agentThreadId: context.assistantHelper?.conversationId || stopped.agentThreadId,
      agentTurnId: context.assistantHelper?.runId || stopped.agentTurnId,
      error: "", status: "stopped"
    }, { explanationChats });
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
    const stoppedExplanation = context.signal?.aborted && error?.name !== "AbortError"
      ? null : await finishStoppedExplanation(executionProfile);
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
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || context.explanationId || sourceEditorExplanationId();
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
    executionProfile: sourceEditorExecutionProfileSnapshot(context.agentExecutionProfile),
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
    model: context.agentExecutionProfile.model,
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
}

function sourceEditorExplanationPrompt({
  contextWindow = "",
  file = {},
  promptCode = {},
  range = {},
  selectedText = ""
} = {}) {
  const wholeFile = range.scope === "file";
  const functionExplanation = range.scope === "selection" && range.presentation === "steps" && Boolean(range.symbolId);
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
    ...(range.presentation ? [sourceExplanationGuidance({ presentation: range.presentation, scope: range.scope })] : []),
    ...(functionExplanation ? [
      "For a real callable or runtime data interface, the caller's inputs and practical outputs are essential. Include **Inputs** and **Outputs and use** only when each describes a meaningful interface established by this source; absent sections must be omitted, not filled with 'no runtime parameters' or 'does not return data'. Explain observable effects where useful, without disguising them as returned data.",
      "When Inputs applies: name the parameters or runtime configuration callers supply, their practical meaning and expected shape, and important required/optional distinctions, defaults or constraints evidenced by this code. Group related options instead of documenting every parameter.",
      "Outputs and use: state what is actually returned and how callers use it. Name the useful returned fields and operations, what callers read or invoke and what those operations provide. Distinguish live state from snapshots, awaitable results and no useful return value when evidenced. Explain observable effects separately from returned data; merely saying 'returns an object', 'reactive state' or a type name is insufficient.",
      "If a parameter contract, return shape or usage cannot be established from the supplied code, state that briefly rather than guessing. A tiny usage example is welcome only when its calls and member names are evidenced; do not invent callers or dependencies."
    ] : []),
    range.presentation === "steps"
      ? `Start with a short purpose statement, ${functionExplanation ? 'explain the applicable input/output interface, then ' : ''}**Steps** with at most 12 concise numbered steps, within 300 words total. Each step describes an action, decision, effect or return; include meaningful failure conditions in the step where they occur. Group related handlers or returned operations rather than writing an essay about each one. Do not add introductory, API-intent or cache commentary.`
      : wholeFile && range.presentation === 'description'
      ? "Write a readable file overview in 150–250 words, using fewer words when the artifact is simple. Explain its scope, responsibilities, main parts, behavior and role in the surrounding system. Start with one purpose sentence, then use concise prose or at most 3 bullets for important behavior, configuration, effects, constraints and dependencies. Do not add Inputs or Outputs and use sections, even when the file contains callable exports; parameter and practical-return contracts belong only in function explanations. Describe behavior, not syntax. Distinguish inference or omitted context in one short note only when needed. Do not include a chat greeting, repeat the request, or invent empty sections."
      : "Prefer this shape: brief summary; role in the system; how it works; important data/control flow; key dependencies or callers/callees; risks, edge cases, or things to know.",
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

function sourceEditorHelperFollowupThread(explanation = {}) {
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
  const agentThreadId = sourceEditorHelperFollowupThread(baseExplanation);
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
}

async function stopSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  const key = sourceEditorExplanationMemoryKey(context, explanationId);
  const pendingTurn = explanationTurns.get(key);
  if (pendingTurn) {
    const current = sourceEditorExplanationStore(explanationChats).get(key);
    if (current) {
      sourceEditorExplanationStore(explanationChats).set(key, { ...current, status: "stopping" });
    }
    pendingTurn.controller.abort();
    await pendingTurn.promise.catch((error) => { if (error?.name !== "AbortError") throw error; });
  }
  if (pendingTurn && !sourceEditorExplanationStore(explanationChats).has(key)) {
    return normalizeSourceEditorExplanation({ id: explanationId, status: "stopped" });
  }
  let explanation = await readSourceEditorExplanationRecord(context, explanationId, { explanationChats });
  const assistantMessageId = explanation.messages.findLast((entry) => entry.role === "assistant")?.id;
  const cleanupRecord = await readSourceEditorExplanationCleanupRecord(context, explanationId);
  const threadId = normalizeText(explanation.agentThreadId);
  const turnId = normalizeText(explanation.agentTurnId);
  if (!pendingTurn && threadId && turnId && cleanupRecord?.helper) {
    const helper = cleanupRecord.helper;
    sourceEditorHelperRoot(context, helper);
    const stopped = await terminalService.stopEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId, runId: helper.runId, cleanupExecutionId: helper.executionId,
      executionProfile: helper.executionProfile
    }, { assistantSelection: helper.selection, vibe64User: context.vibe64User });
    if (stopped?.ok !== true) throw sourceEditorError(stopped?.error || "The source explanation could not be stopped.",
      stopped?.code || "vibe64_source_explanation_agent_interrupt_unconfirmed");
  } else if (!pendingTurn && threadId && turnId) {
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
    error: "",
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
  all = false,
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  const activeIds = sourceEditorCleanupActiveIds(input.activeExplanationIds);
  const originId = normalizeText(input.originId);
  const store = sourceEditorExplanationStore(explanationChats);
  const cleaned = [];
  const cleanedHelpers = [];
  const failures = [];
  const nowMs = Date.now();

  const tasks = [...explanationTurns.values()].filter((task) => task.sessionId === context.sessionId &&
    task.projectScope === currentProjectScopeKey() && (all || shouldCleanupSourceEditorExplanationRecord(task, { activeIds, nowMs, originId })));
  for (const task of tasks) task.controller.abort();
  await Promise.allSettled(tasks.map((task) => task.promise));

  const remaining = await mutateSourceEditorExplanationCleanupRecords(context, async (records) => {
    const nextRecords = [];
    for (const record of records) {
      if (!all && !shouldCleanupSourceEditorExplanationRecord(record, {
        activeIds,
        nowMs,
        originId
      })) {
        nextRecords.push(record);
        continue;
      }

      try {
        const key = sourceEditorExplanationMemoryKey(context, record.id);
        const agentCleanup = await deleteSourceEditorExplanationAgentThread(context, record, {
          terminalService
        });
        store.delete(key);
        if (record.helper) cleanedHelpers.push(record.helper);
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

  for (const helper of cleanedHelpers) await rm(sourceEditorHelperRoot(context, helper), { recursive: true, force: true });
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
  const pendingTurn = explanationTurns.get(key);
  pendingTurn?.controller.abort();
  await pendingTurn?.promise.catch(() => null);
  const explanation = await readSourceEditorExplanationCleanupRecord(context, explanationId) || store.get(key);
  if (!explanation) {
    return {
      agentCleanup: {
        ok: true,
        status: "notFound"
      },
      deleted: false
    };
  }
  const agentCleanup = await deleteSourceEditorExplanationAgentThread(context, explanation, {
    terminalService
  });
  store.delete(key);
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
  if (!terminalService || typeof terminalService.runEphemeralAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat is not available for source explanations.", "vibe64_source_explanation_agent_unavailable", {}, 409);
  }
  const agentThreadId = sourceEditorHelperFollowupThread(explanation);
  let observedExecutionProfile = sourceEditorExecutionProfileSnapshot(explanation.executionProfile);
  let observedThreadId = agentThreadId;
  let observedTurnId = "";
  let result;
  try {
    result = await runSourceEditorHelperTurn(terminalService, context, {
      executionProfile: sourceEditorExecutionProfileRequest(),
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

export {
  createExplanationOperations,
  describeSourceEditorAgentProvider,
  sourceEditorInterfacePromptVersion,
  sourceEditorVibe64UserIdentity
};
