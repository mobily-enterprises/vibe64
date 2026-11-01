import { renewalActorsMatch, renewalError } from "./sessionRenewalRules.js";

// Who a persisted renewal's workflow continues as when the request is not from
// the person it was confirmed by (a restart's recovery, or someone else). A
// composed host with its own people provides their resolver through this
// token: resolve(actor, { renewalId, sessionId, stage }) returns that person.
const SESSION_RENEWAL_ACTOR_RESOLVER_TOKEN = "vibe64.sessions.renewal-actor-resolver";

/** @typedef {import("./types.js").RenewalActorResolver} RenewalActorResolver */
/** @typedef {import("./types.js").RenewalActorRestoration} RenewalActorRestoration */

/** @param {unknown} resolver */
function assertRenewalActorResolver(resolver) {
  if (resolver && typeof resolver !== "function") {
    throw new TypeError("Vibe64 session renewal actor resolver must be a function or null.");
  }
}

/**
 * Standalone Vibe64 runs as the local user and keeps no user store: a renewal
 * no person asked for continues as it is, and another person cannot be restored.
 * @type {RenewalActorRestoration}
 */
async function restoreStandaloneRenewalActor(_state, input, { requestActor }) {
  if (!requestActor) {
    return input;
  }
  throw renewalError(
    "The current Vibe64 host cannot restore the user identity required to continue this session renewal.",
    "vibe64_session_renewal_actor_resolver_unavailable",
    { retryable: true }
  );
}

/**
 * The restoration through a host's resolver: the person it returns must be the
 * one the workflow persisted.
 * @param {RenewalActorResolver} resolve
 * @returns {RenewalActorRestoration}
 */
function restoreRenewalActorWith(resolve) {
  return async function restoreRenewalActor(state, input, { persistedActor }) {
    const resolved = await resolve(
      persistedActor,
      {
        renewalId: state.renewalId,
        sessionId: state.sessionId,
        stage: state.stage
      }
    );
    if (!renewalActorsMatch(resolved, persistedActor)) {
      throw renewalError(
        "The restored session-renewal actor does not match the persisted workflow actor.",
        "vibe64_session_renewal_actor_mismatch",
        { retryable: true, statusCode: 500 }
      );
    }
    return {
      ...input,
      vibe64User: resolved
    };
  };
}

export {
  SESSION_RENEWAL_ACTOR_RESOLVER_TOKEN,
  assertRenewalActorResolver,
  restoreRenewalActorWith,
  restoreStandaloneRenewalActor
};
