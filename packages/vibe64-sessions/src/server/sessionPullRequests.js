import crypto from "node:crypto";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createHeldRequests } from "@local/vibe64-core/server/heldRequests";
import { sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

// Saving and pushing the session's work and asking GitHub take minutes on a large or slow change. GitHub mutations
// are never retried automatically, so a repeat the editor no longer holds creates nothing.
const PULL_REQUEST_NOT_FOLLOWED = Object.freeze({
  code: "vibe64_session_pull_request_not_followed",
  error: "Vibe64 restarted or lost this pull request while creating it, so it cannot say whether it was created. " +
    "Check the session's pull request before creating it again."
});

/**
 * A session's pull request: the assistant tool's create, which waits for its outcome, and the pull request dialog's,
 * held while it goes on. `close`, at shutdown, resolves once every held creation has ended.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TerminalsService} dependencies.terminals
 */
function createSessionPullRequests({ logger, project, publishSessionChanged, terminals }) {
  async function createSessionPullRequest(sessionId, input) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      try {
        return await terminals.createSessionPullRequest(sessionId, {
          destinationReview: input.destinationReview,
          title: input.title,
          body: input.body,
          draft: input.draft,
          onRepositoryWriteAcquired: input.onRepositoryWriteAcquired,
          operationId: crypto.randomUUID(),
          runtime,
          session,
          vibe64User
        });
      } finally {
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-pull-request",
          session: await runtime.getSessionWithoutSource(sessionId)
        });
      }
    }, "The pull request could not be confirmed. Retry to check GitHub and continue.");
  }

  const held = createHeldRequests({
    component: "vibe64.session_pull_request",
    heldAs: "creating",
    logger,
    notFollowed: PULL_REQUEST_NOT_FOLLOWED
  });

  /**
   * The pull request dialog's create, held while it goes on (`createHeldRequests`): `received` while it waits for
   * the session's repository write, then `creating`.
   * @param {string} sessionId
   * @param {{ requestId: string, repeat?: boolean }} input
   */
  function startSessionPullRequest(sessionId, input) {
    return held.run([sessionId], input, (creation, { stage }) => (
      createSessionPullRequest(sessionId, { ...creation, onRepositoryWriteAcquired: () => stage("creating") })
    ));
  }

  return Object.freeze({
    close: held.close,
    createSessionPullRequest,
    startSessionPullRequest
  });
}

export { createSessionPullRequests };
