import { readdir } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError } from "@local/vibe64-core/server/core";
import { normalizedPromptHintDraft, normalizedPromptHintSuggestions } from "@local/vibe64-runtime/shared";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";

import {
  PROMPT_HINT_CONTEXT_VERSION,
  PROMPT_HINT_TASK_DIRECTORY,
  SHARED_PROMPT_HINTS_ARTIFACT,
  canonicalHash,
  definePromptHintOperationId,
  definePromptHintOriginId,
  promptHintActorId,
  promptHintBasis,
  promptHintContextStatus,
  promptHintOwnerKey,
  promptHintResponse,
  promptHintSessionKey,
  promptHintStaticSuggestions,
  promptHintSubscriberKey,
  samePromptHintBasis
} from "./promptHintRules.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").PromptHintState} PromptHintState */
/** @typedef {import("./types.js").PromptHintContext} PromptHintContext */
/** @typedef {ReturnType<typeof import("./promptHintJobs.js").createPromptHintJobs>} PromptHintJobs */

/**
 * Prompt hint requests: each browser operation's request, answered from the
 * static starters, the shared or cached hints, or the job it joins, and
 * cancelled one at a time or for a whole session, with its helper records.
 * @param {object} dependencies
 * @param {PromptHintContext} dependencies.hintContext
 * @param {PromptHintJobs} dependencies.hintJobs
 * @param {ProjectService} dependencies.project
 * @param {PromptHintState} dependencies.state
 */
function createPromptHintRequests({
  hintContext,
  hintJobs,
  project,
  state
}) {
  const requestsBySession = new Map();

  function jobCacheKey({ actorId = "", basis = {}, identity = {}, projectScope = "", sessionId = "" } = {}) {
    return canonicalHash({ actorId, basis, identity, contextVersion: PROMPT_HINT_CONTEXT_VERSION, projectScope, sessionId });
  }

  function rememberRequest(request) {
    state.requestsBySubscriber.set(request.subscriberKey, request);
    const requests = requestsBySession.get(request.sessionKey) || new Set();
    requests.add(request);
    requestsBySession.set(request.sessionKey, requests);
  }

  function forgetRequest(request) {
    if (state.requestsBySubscriber.get(request.subscriberKey) === request) {
      state.requestsBySubscriber.delete(request.subscriberKey);
    }
    const requests = requestsBySession.get(request.sessionKey);
    requests?.delete(request);
    if (!requests?.size) {
      requestsBySession.delete(request.sessionKey);
    }
  }

  async function generateRequest(request) {
    const {
      sessionId,
      vibe64User
    } = request;
    if (request.cancelled) {
      return promptHintResponse("cancelled");
    }
    let context = null;
    try {
      context = await hintContext.readContext(sessionId);
    } catch (error) {
      if (request.cancelled) {
        return promptHintResponse("cancelled");
      }
      state.reportDiagnostic("vibe64_prompt_hints_context_failed", error, { sessionId });
      return promptHintResponse("unavailable");
    }
    const snapshot = promptHintBasis(context, request.draft);
    request.snapshot = snapshot;
    if (request.cancelled) {
      return promptHintResponse("cancelled", { basis: snapshot.basis });
    }
    const status = promptHintContextStatus(context);
    if (status !== "ready") {
      return promptHintResponse(status, { basis: snapshot.basis });
    }
    if (!snapshot.conversation.length && !snapshot.draft && !snapshot.blueprint) {
      return promptHintResponse("static", {
        basis: snapshot.basis,
        suggestions: promptHintStaticSuggestions(context)
      });
    }

    let identity = null;
    try {
      identity = await hintContext.resolvedAgentIdentity(context, vibe64User, () => request.cancelled);
    } catch (error) {
      if (request.cancelled) return promptHintResponse("cancelled", { basis: snapshot.basis });
      if (!snapshot.draft) {
        try {
          const source = await context.runtime.store.readArtifact(sessionId, SHARED_PROMPT_HINTS_ARTIFACT);
          const shared = source ? JSON.parse(source) : null;
          const suggestions = normalizedPromptHintSuggestions(shared?.suggestions);
          if (!request.cancelled && suggestions.length && samePromptHintBasis(shared?.basis, snapshot.basis)) {
            return promptHintResponse("ready", { basis: snapshot.basis, cached: true, suggestions });
          }
        } catch (readError) {
          state.reportDiagnostic("vibe64_prompt_hints_share_read_failed", readError, { sessionId });
        }
      }
      state.reportDiagnostic("vibe64_prompt_hints_profile_unavailable", error, { sessionId });
      return promptHintResponse("unavailable", { basis: snapshot.basis });
    }
    if (request.cancelled || !identity) {
      return promptHintResponse("cancelled", { basis: snapshot.basis });
    }
    const key = jobCacheKey({
      actorId: request.actorId,
      basis: snapshot.basis,
      identity,
      projectScope: request.projectScope,
      sessionId
    });
    const cached = hintJobs.cacheGet(key);
    if (cached) {
      try {
        const current = await hintContext.readContext(sessionId);
        if (request.cancelled) {
          return promptHintResponse("cancelled", { basis: snapshot.basis });
        }
        if (
          promptHintContextStatus(current) === "ready" &&
          samePromptHintBasis(snapshot.basis, promptHintBasis(current, request.draft).basis)
        ) {
          return promptHintResponse("ready", {
            basis: cached.basis,
            cached: true,
            suggestions: cached.suggestions
          });
        }
      } catch {
        if (request.cancelled) {
          return promptHintResponse("cancelled", { basis: snapshot.basis });
        }
        return promptHintResponse("stale", { basis: snapshot.basis });
      }
      return promptHintResponse("stale", { basis: snapshot.basis });
    }
    return hintJobs.joinJob(request, {
      context,
      identity,
      key,
      sessionId,
      snapshot,
      vibe64User
    });
  }

  async function generateSessionPromptHints(sessionId = "", input = {}) {
    const normalizedSessionId = toText(sessionId);
    const operationId = definePromptHintOperationId(input.operationId);
    const originId = definePromptHintOriginId(input.originId);
    const projectScope = currentProjectScopeKey();
    const vibe64User = input.vibe64User || null;
    const actorId = promptHintActorId(vibe64User);
    const subscriberKey = promptHintSubscriberKey({
      actorId,
      operationId,
      originId,
      projectScope,
      sessionId: normalizedSessionId,
      vibe64User
    });
    const existing = state.requestsBySubscriber.get(subscriberKey);
    if (existing) {
      return existing.promise;
    }
    const request = {
      actorId,
      cancelled: false,
      draft: normalizedPromptHintDraft(input.draft),
      job: null,
      operationId,
      originId,
      ownerKey: promptHintOwnerKey({
        actorId,
        projectScope,
        sessionId: normalizedSessionId
      }),
      projectScope,
      sessionId: normalizedSessionId,
      sessionKey: promptHintSessionKey({
        projectScope,
        sessionId: normalizedSessionId
      }),
      snapshot: null,
      subscriberKey,
      vibe64User
    };
    rememberRequest(request);
    request.promise = Promise.resolve().then(() => generateRequest(request));
    try {
      return await request.promise;
    } finally {
      forgetRequest(request);
    }
  }

  async function cancelSessionPromptHints(sessionId = "", input = {}) {
    const normalizedSessionId = toText(sessionId);
    const operationId = definePromptHintOperationId(input.operationId);
    const originId = definePromptHintOriginId(input.originId);
    const projectScope = currentProjectScopeKey();
    const vibe64User = input.vibe64User || null;
    const actorId = promptHintActorId(vibe64User);
    const subscriberKey = promptHintSubscriberKey({
      actorId,
      operationId,
      originId,
      projectScope,
      sessionId: normalizedSessionId,
      vibe64User
    });
    const request = state.requestsBySubscriber.get(subscriberKey);
    if (!request) {
      return promptHintResponse("notFound");
    }
    hintJobs.cancelRequest(request);
    return promptHintResponse("cancelled", { basis: request.snapshot?.basis || null });
  }

  async function cancelSessionPromptHintsForSession(sessionId = "", options = {}) {
    const normalizedSessionId = toText(sessionId);
    const projectScope = currentProjectScopeKey();
    const sessionKey = promptHintSessionKey({
      projectScope,
      sessionId: normalizedSessionId
    });
    const requests = [...(requestsBySession.get(sessionKey) || [])];
    for (const request of requests) {
      hintJobs.cancelRequest(request);
    }
    await Promise.all(requests.map((request) => request.promise.catch(() => null)));
    const runtime = options.runtime || await project.createRuntimeWithoutSource();
    const session = options.session || await runtime.getSessionWithoutSource(normalizedSessionId);
    const readPaths = options.renewalCleanup
      ? runtime.store.withReadableSessionPathsForRenewal : runtime.store.withReadableSessionPaths;
    const artifacts = await readPaths(normalizedSessionId, async (paths) => {
      try { return await readdir(path.join(paths.artifactsRoot, PROMPT_HINT_TASK_DIRECTORY)); }
      catch (error) {
        if (isMissingPathError(error)) return [];
        throw error;
      }
    });
    for (const filename of artifacts) {
      if (/^[a-f0-9]{64}\.json$/u.test(filename)) {
        await hintContext.cleanupHelper({
          runtime,
          session,
          renewalCleanup: options.renewalCleanup
        }, `${PROMPT_HINT_TASK_DIRECTORY}/${filename}`, null);
      }
    }
    return {
      cancelled: requests.length,
      ok: true
    };
  }

  return Object.freeze({
    cancelSessionPromptHints,
    cancelSessionPromptHintsForSession,
    generateSessionPromptHints
  });
}

export {
  createPromptHintRequests
};
