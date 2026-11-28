/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { openProjectRuntimeRecords } from "./serviceSessionAccess.js";
import { waitsForAccount } from "./assistantRoutingRequests.js";

/**
 * The turns an AI account stopped while they ran (signed out, or switched to an account their person couldn't use),
 * continued once an AI account is set: every Main chat and temporary chat of every open session whose request waits
 * for an account (waitsForAccount) is told to continue, as the person it ran for, through the resume every interrupted
 * turn takes (assistantRoutingInterruptions.js continueAfterAccountSet), whatever it was doing. The saved records rule
 * out every other chat without taking its lock; under the lock routing checks again, so a chat continues once however
 * many events, passes or servers reach it. A temporary chat that holds an AI task is its task's, and a goal's turn is
 * its goal's: neither is ever marked.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {AssistantRouting} dependencies.mainChatRouting
 * @param {SessionConversations} dependencies.sessionConversations
 */
function createServiceTurnsAfterAccountSet({
  state,
  logger,
  project,
  sessionAccess,
  assistantContext,
  mainChatRouting,
  sessionConversations
}) {
  const warn = (error, fields, message) => logOperationalEvent(logger, "warn", {
    component: "vibe64.turn_resume",
    event: "vibe64.turn_resume.account_set_failed",
    code: error?.code,
    error: error?.message,
    ...fields
  }, message);

  /** The person a chat's request ran for, still allowed in the project, as its resume's actor. */
  async function actorOptions(request) {
    const sender = request.submittedBy || null;
    const actor = sender
      ? await state.assistantRuntime.authorizeProjectMessage(sender, sessionAccess.projectRuntimeContext().projectSlug)
      : null;
    return actor ? { vibe64User: actor } : {};
  }

  /** Continues each chat of a session that waits for an account; one that fails is reported, and the others go on. */
  async function continueSession(projectSlug, sessionId) {
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const chats = [{ conversationId: "", request: assistantRoutingRequestForDisplay(context.session.metadata) }];
    for (const record of await context.runtime.store.listSessionConversations(sessionId)) {
      if (record.state === "closing" || record.task) continue;
      chats.push({ conversationId: record.conversationId, request: assistantRoutingRequestForDisplay(record.routingMetadata) });
    }
    for (const { conversationId, request } of chats) {
      if (!waitsForAccount(request)) continue;
      const fields = { projectSlug, sessionId, ...(conversationId ? { conversationId } : {}) };
      try {
        const options = await actorOptions(request);
        const result = conversationId
          ? await sessionConversations.continueTemporaryTurnAfterAccountSet(sessionId, { ...options, conversationId })
          : await mainChatRouting.continueAfterAccountSet(sessionId, options);
        logOperationalEvent(logger, "warn", {
          component: "vibe64.turn_resume",
          event: "vibe64.turn_resume.account_set",
          ...fields,
          ...result
        }, "A turn its AI account stopped, after an AI account was set.");
      } catch (error) {
        warn(error, fields, "A turn its AI account stopped could not be continued; Continue resumes it.");
      }
    }
  }

  /**
   * Visits every open session of every open project, inside its project. Started by an AI account being set; its work
   * is tracked, so shutdown waits for a resume it began.
   * @returns {Promise<void>}
   */
  function continueTurnsAfterAccountSet() {
    if (state.lifecycle.closing) return Promise.resolve();
    return state.trackShutdownWork((async () => {
      const listed = await project.listProjects();
      if (listed?.ok === false) throw new Error(listed.error || "The projects could not be listed.");
      for (const projectRecord of openProjectRuntimeRecords(listed)) {
        if (state.lifecycle.closing) return;
        const projectSlug = projectRecord.slug;
        await project.runInProjectContext(projectSlug, async () => {
          for (const session of await sessionAccess.listOpenProjectRuntimeSessions()) {
            if (state.lifecycle.closing) return;
            await continueSession(projectSlug, session.sessionId)
              .catch(error => warn(error, { projectSlug, sessionId: session.sessionId }, "A session's chats could not be read after an AI account was set."));
          }
        }).catch(error => warn(error, { projectSlug }, "A project's chats could not be read after an AI account was set."));
      }
    })().catch(error => warn(error, {}, "The chats could not be read after an AI account was set.")));
  }

  return continueTurnsAfterAccountSet;
}

export { createServiceTurnsAfterAccountSet };
