import { VIBE64_PROMPT_HINT_OUTPUT_SCHEMA } from "@local/vibe64-runtime/shared";

import { runAssistantHelperTurn } from "./assistantHelperTurn.js";
import {
  PROMPT_HINT_CLEANUP_REASONS,
  PROMPT_HINT_EXECUTION_PROFILE_REQUEST,
  PROMPT_HINT_HELPER_PREFIX,
  PROMPT_HINT_TASK_DIRECTORY,
  SHARED_PROMPT_HINTS_ARTIFACT,
  canonicalHash,
  parsePromptHintSuggestions,
  promptHintBasis,
  promptHintContextStatus,
  promptHintFailure,
  promptHintPrompt,
  promptHintResponse,
  samePromptHintBasis
} from "./promptHintRules.js";
import { isRecord, toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").PromptHintState} PromptHintState */
/** @typedef {import("./types.js").PromptHintContext} PromptHintContext */

/**
 * Prompt hint jobs: one helper turn per basis and identity, shared by every
 * request that joins it, cancelled when its last subscriber leaves or a newer
 * job of the same actor replaces it, and revalidated before its result is
 * cached, shared and returned.
 * @param {object} dependencies
 * @param {SessionAgentManager} dependencies.agent
 * @param {number} dependencies.cacheMaxEntries
 * @param {number} dependencies.cacheTtlMs
 * @param {PromptHintContext} dependencies.hintContext
 * @param {() => number} dependencies.now
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {PromptHintState} dependencies.state
 */
function createPromptHintJobs({
  agent,
  cacheMaxEntries,
  cacheTtlMs,
  hintContext,
  now,
  publishSessionChanged,
  state
}) {
  const completedCache = new Map();
  const jobsByKey = new Map();
  const jobsByOwner = new Map();

  function cacheGet(key) {
    const entry = completedCache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= now()) {
      completedCache.delete(key);
      return null;
    }
    completedCache.delete(key);
    completedCache.set(key, entry);
    return entry;
  }

  function cacheSet(key, value) {
    completedCache.delete(key);
    completedCache.set(key, {
      ...value,
      expiresAt: now() + cacheTtlMs
    });
    while (completedCache.size > cacheMaxEntries) {
      completedCache.delete(completedCache.keys().next().value);
    }
  }

  function rememberOwnerJob(job) {
    const jobs = jobsByOwner.get(job.ownerKey) || new Set();
    jobs.add(job);
    jobsByOwner.set(job.ownerKey, jobs);
  }

  function forgetOwnerJob(job) {
    const jobs = jobsByOwner.get(job.ownerKey);
    jobs?.delete(job);
    if (!jobs?.size) {
      jobsByOwner.delete(job.ownerKey);
    }
  }

  function detachRequestFromJob(request) {
    const job = request.job;
    if (!job) {
      return;
    }
    job.subscribers.delete(request.subscriberKey);
  }

  function cancelRequest(request) {
    request.cancelled = true;
    const job = request.job;
    detachRequestFromJob(request);
    if (job && !job.subscribers.size) {
      cancelJob(job);
    }
  }

  function cancelJobSubscribers(job) {
    for (const subscriberKey of job.subscribers) {
      const request = state.requestsBySubscriber.get(subscriberKey);
      if (request) {
        request.cancelled = true;
      }
    }
    job.subscribers.clear();
    cancelJob(job);
  }

  function cancelJob(job) {
    job.cancelRequested = true;
    job.abort.abort();
  }

  async function runJob(job) {
    if (job.cancelRequested) {
      return promptHintResponse("cancelled", { basis: job.snapshot.basis });
    }
    // Superseded requests already belong to this feature's per-actor job set.
    // Finish their cleanup before reusing that actor's durable task record.
    await Promise.all(job.previous.map((previous) => previous.promise));
    if (job.cancelRequested) return promptHintResponse("cancelled", { basis: job.snapshot.basis });
    const artifact = `${PROMPT_HINT_TASK_DIRECTORY}/${job.ownerKey.slice(7)}.json`;
    let result;
    try {
      result = await runAssistantHelperTurn({
        agent,
        fail: promptHintFailure,
        outputSchema: VIBE64_PROMPT_HINT_OUTPUT_SCHEMA,
        prefix: PROMPT_HINT_HELPER_PREFIX,
        profile: PROMPT_HINT_EXECUTION_PROFILE_REQUEST,
        prompt(profile) {
          const prompt = promptHintPrompt({
            blueprint: job.snapshot.blueprint,
            conversation: job.snapshot.conversation,
            draft: job.snapshot.draft,
            sessionState: job.context.sessionState,
            subsystems: job.snapshot.subsystems
          });
          if (Array.from(prompt).length > profile.limits.maxInputCharacters) {
            throw new Error("Prompt hint context exceeds the selected helper profile limit.");
          }
          return prompt;
        },
        promptLabel: "Vibe64 prompt hints",
        record: hintContext.promptHintHelperRecord(job.context, artifact),
        resolveIdentity: async () => job.identity,
        signal: job.abort.signal,
        stableContext: "Suggest next prompts only from the supplied conversation and draft. You have no tools or project access.",
        stateRoot: job.context.runtime.stateRoot,
        vibe64User: job.vibe64User
      });
    } catch (error) {
      if (PROMPT_HINT_CLEANUP_REASONS.has(error?.reason)) {
        const generation = error.cause;
        state.reportDiagnostic("vibe64_prompt_hints_cleanup_failed", error, {
          ...(isRecord(error.details) ? error.details : {}),
          cleanupCode: toText(error.code),
          // A cleanup failing before the turn means no generation ran.
          ...(error.beforeTurn ? {} : {
            generationCode: toText(generation?.code),
            generationError: toText(generation?.message),
            generationOk: !generation
          }),
          sessionId: job.sessionId
        });
        return promptHintResponse("unavailable", { basis: job.snapshot.basis });
      }
      if (job.cancelRequested) {
        return promptHintResponse("cancelled", { basis: job.snapshot.basis });
      }
      if (error?.reason === "execution_profile_missing") {
        state.reportDiagnostic("vibe64_prompt_hints_profile_mismatch", null, { sessionId: job.sessionId });
      } else {
        state.reportDiagnostic("vibe64_prompt_hints_generation_failed", error, { sessionId: job.sessionId });
      }
      return promptHintResponse("unavailable", { basis: job.snapshot.basis });
    }
    if (job.cancelRequested) {
      return promptHintResponse("cancelled", { basis: job.snapshot.basis });
    }
    const suggestions = parsePromptHintSuggestions(result?.text);
    if (!suggestions) {
      state.reportDiagnostic("vibe64_prompt_hints_output_invalid", null, {
        sessionId: job.sessionId
      });
      return promptHintResponse("unavailable", { basis: job.snapshot.basis });
    }

    let current = null;
    try {
      current = await hintContext.readContext(job.sessionId);
      const identity = await hintContext.resolvedAgentIdentity(current, job.vibe64User, () => job.cancelRequested);
      if (identity && canonicalHash(identity) !== canonicalHash(job.identity)) {
        return promptHintResponse("stale", { basis: job.snapshot.basis });
      }
    } catch (error) {
      if (job.cancelRequested) {
        return promptHintResponse("cancelled", { basis: job.snapshot.basis });
      }
      state.reportDiagnostic("vibe64_prompt_hints_revalidation_failed", error, {
        sessionId: job.sessionId
      });
      return promptHintResponse("stale", { basis: job.snapshot.basis });
    }
    const currentSnapshot = promptHintBasis(current, job.snapshot.draft);
    if (job.cancelRequested) {
      return promptHintResponse("cancelled", { basis: job.snapshot.basis });
    }
    if (
      promptHintContextStatus(current) !== "ready" ||
      !samePromptHintBasis(job.snapshot.basis, currentSnapshot.basis)
    ) {
      return promptHintResponse("stale", { basis: job.snapshot.basis });
    }
    cacheSet(job.key, {
      basis: job.snapshot.basis,
      suggestions
    });
    // Only conversation-based hints are shared. Draft-based hints stay private
    // to the actor's existing short-lived cache.
    if (!job.snapshot.draft) {
      try {
        await current.runtime.store.writeJsonArtifact(job.sessionId, SHARED_PROMPT_HINTS_ARTIFACT, {
          basis: job.snapshot.basis,
          suggestions
        });
        await publishSessionChanged(job.sessionId, { reason: "shared-prompt-hints-updated" });
      } catch (error) {
        state.reportDiagnostic("vibe64_prompt_hints_share_failed", error, { sessionId: job.sessionId });
      }
    }
    return promptHintResponse("ready", {
      basis: job.snapshot.basis,
      suggestions
    });
  }

  async function joinJob(request, {
    context,
    identity,
    key,
    sessionId,
    snapshot,
    vibe64User
  }) {
    let job = jobsByKey.get(key);
    if (job?.cancelRequested) {
      job = null;
    }
    let startJob = false;
    if (!job) {
      const previousJobs = [...(jobsByOwner.get(request.ownerKey) || [])];
      for (const previous of previousJobs) {
        if (previous.key !== key) {
          cancelJobSubscribers(previous);
        }
      }
      job = {
        actorId: request.actorId,
        abort: new AbortController(),
        previous: previousJobs,
        cancelRequested: false,
        context,
        identity,
        key,
        ownerKey: request.ownerKey,
        projectScope: request.projectScope,
        sessionId,
        snapshot,
        subscribers: new Set(),
        vibe64User
      };
      jobsByKey.set(key, job);
      rememberOwnerJob(job);
      startJob = true;
    }
    request.job = job;
    job.subscribers.add(request.subscriberKey);
    if (request.cancelled) {
      cancelRequest(request);
      return promptHintResponse("cancelled", { basis: snapshot.basis });
    }
    if (startJob) {
      job.promise = Promise.resolve().then(() => runJob(job)).finally(() => {
        if (jobsByKey.get(key) === job) {
          jobsByKey.delete(key);
        }
        forgetOwnerJob(job);
      });
    }
    try {
      const response = await job.promise;
      return !request.cancelled && job.subscribers.has(request.subscriberKey)
        ? response
        : promptHintResponse("cancelled", { basis: snapshot.basis });
    } finally {
      detachRequestFromJob(request);
    }
  }

  return Object.freeze({
    cacheGet,
    cancelRequest,
    joinJob
  });
}

export {
  createPromptHintJobs
};
