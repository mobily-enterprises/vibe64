import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").AssistantRuntime} AssistantRuntime */
/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */

/**
 * The authority a Main turn's application tools act with when no browser send carries one: a goal's Set or Resume,
 * or a turn Vibe64 sends for the person who started the work (a workflow's next step, a plan's pass, a turn resumed
 * after a restart, a project message). It acts through the person's own request while one is in progress, otherwise
 * through the assistant host's action context for that person (`createActionContext`), which resolves them afresh on
 * every action. It keeps only who and where (the session, its project, the actor's id and that context), never a
 * cached access grant: each tool call reads the grant again (serviceMainConversationHost.js), so a person who has
 * lost access is refused there.
 * @param {object} options
 * @param {ActionCatalogue} options.actions
 * @param {AssistantRuntime} options.assistantRuntime
 * @param {string} options.sessionId
 * @param {string} options.projectSlug
 * @param {object | null} options.actor the person, as the assistant host resolved them
 * @param {object | null} [options.requestMeta] the person's own request in progress, when there is one
 */
async function issueMainTurnAuthority({ actions, assistantRuntime, sessionId, projectSlug, actor, requestMeta = null }) {
  const requestContext = requestMeta ? { surface: "app", channel: "internal", requestMeta }
    : await assistantRuntime.createActionContext(actor);
  const grant = await actions.execute({
    actionId: "vibe64.sessions.conversation.context.read",
    input: { projectSlug, sessionId },
    context: requestContext
  });
  return { sessionId, projectSlug, actorId: grant.actor.id, requestContext };
}

/**
 * The authority for the Main turns Vibe64 sends for a person (routing's dispatch in service.js).
 * @param {object} dependencies
 * @param {ActionCatalogue | undefined} dependencies.actions
 * @param {ServiceState} dependencies.state whose assistant runtime is read as each turn is sent
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {RuntimeLogger} dependencies.logger
 */
function createMainTurnAuthority({ actions, state, sessionAccess, logger }) {
  /**
   * The authority a Main turn Vibe64 sends for a person carries for its application tools: that person's, as the
   * assistant host resolves them now. A person it cannot resolve, or who may no longer open the session, gets none,
   * so the turn still runs and each of its tool calls is refused.
   * @param {string} sessionId
   * @param {object | null | undefined} person who the send is for: the routing request's sender, or a project
   *   message's actor
   */
  async function turnAuthorityFor(sessionId, person) {
    // Without an action catalogue Main has no application tools to authorize (serviceMainConversationHost.js).
    if (!actions) return undefined;
    try {
      return await issueMainTurnAuthority({
        actions,
        assistantRuntime: state.assistantRuntime,
        sessionId,
        projectSlug: sessionAccess.projectRuntimeContext().projectSlug,
        actor: await state.assistantRuntime.resolveAssistantUser(person || null)
      });
    } catch (error) {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.agent_message",
        event: "vibe64.agent_message.tool_authority_refused",
        sessionId,
        code: error?.code || "",
        error: error?.message || String(error)
      }, "A turn Vibe64 sends runs without application tools: the person it is for was refused.");
      return undefined;
    }
  }

  return Object.freeze({
    turnAuthorityFor
  });
}

export { createMainTurnAuthority, issueMainTurnAuthority };
