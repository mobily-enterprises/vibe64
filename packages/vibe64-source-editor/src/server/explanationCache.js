import { normalizeText } from "@local/vibe64-core/server/core";

import {
  describeSourceEditorAgentProvider,
  requiredSourceEditorExecutionProfile,
  resolveSourceEditorAgentExecutionProfile,
  SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE,
  sourceEditorExecutionProfileIdentity,
  sourceEditorExecutionProfileSnapshot
} from "./explanationProfile.js";
import { normalizeSourceEditorExplanation } from "./explanationRecords.js";
import { positiveInteger, sourceEditorExplanationSummary } from "./explanationText.js";
import { readSourceEditorFile, sourceEditorError } from "./sourceFiles.js";
import { readSourceInterpretation, writeSourceInterpretation } from "./sourceInterpretations.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

// The cache of finished source explanations, keyed by the code and question
// they answer, and the check that a cached answer still fits its code.
const SOURCE_EDITOR_EXPLANATION_CACHE_MAX_ENTRIES = 64;

const SOURCE_EDITOR_EXPLANATION_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @param {TerminalsService} terminalService
 * @param {object} [context]
 * @param {object | null} [template]
 */
async function sourceEditorCompletedCacheIdentityUnchanged(
  terminalService,
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

/**
 * @param {object} context
 * @param {object} input
 * @param {string} cacheKey
 * @param {RuntimeLogger} logger
 */
function sourceEditorInterpretationCacheOptions(context, input, cacheKey, logger) {
  // Reuse the existing private cache for on-demand file overviews and exact
  // function pseudocode. Neither interpretation changes the authored Program.
  const range = input.range;
  if (!(range.scope === "file" && range.presentation === "description")
    && !(range.scope === "selection" && range.presentation === "steps" && range.symbolId)) return {};
  return {
    readCompleted: () => readSourceInterpretation(context, input, cacheKey).catch(() => null),
    writeCompleted: async (template, currentGeneration) => {
      try {
        await writeSourceInterpretation(context, input, cacheKey, template, async () => currentGeneration()
          && (await readSourceEditorFile(context, input.range.path)).hash === input.range.fileHash);
      } catch (error) {
        // Saving an optional interpretation must not fail a completed Helper
        // conversation or replace its existing stop/recovery lifecycle.
        logger.warn("Source interpretation could not be saved.", { path: input.range.path, error });
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

  function close() {
    closed = true;
    completed.clear();
    generations.clear();
    inFlight.clear();
  }

  return Object.freeze({ close, run });
}

export {
  createSourceEditorExplanationCache,
  SOURCE_EDITOR_EXPLANATION_CACHE_MAX_ENTRIES,
  SOURCE_EDITOR_EXPLANATION_CACHE_TTL_MS,
  sourceEditorCompletedCacheIdentityUnchanged,
  sourceEditorExplanationCacheKey,
  sourceEditorExplanationCacheTemplate,
  sourceEditorInterpretationCacheOptions
};
