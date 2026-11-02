import { AppError } from "@jskit-ai/kernel/server/runtime";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { isLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";

/**
 * Original Main facade request projection. Keep contributor grants out of the
 * retained context so later native effects resolve current authority again.
 */
function mainConversationRequestContext(context = {}) {
  const request = context.requestMeta?.request;
  return {
    surface: "app",
    channel: "internal",
    requestMeta: request ? {
      ...context.requestMeta,
      request: { ...request, headers: request.headers, vibe64User: authenticatedVibe64User(context) }
    } : context.requestMeta
  };
}

/**
 * The conversation access an action's context grants: its actor, project and
 * person. A standalone editor's local request for its selected project is the
 * local actor; any other request without the policy's grant is refused.
 * @param {object} _input
 * @param {object} context
 */
function conversationContextGrant(_input, context) {
  if (!context.vibe64Action) {
    const request = context.requestMeta?.request;
    const project = currentProjectRequestContext();
    if (getStudioProjectContext().projectCatalogEnabled !== false || !project || !request ||
        !isLocalStudioRequest(Object.assign(Object.create(request), { vibe64User: null }))) {
      throw new AppError(403, "Open this conversation from the local editor for its selected project.", {
        code: "conversation_forbidden",
        messageCode: "vibe64_conversation_local_editor_required"
      });
    }
    // Standalone requests already resolve the selected project in the action
    // policy. No account or authority context contributor serves them.
    return { actor: { id: "local" }, project, user: null };
  }
  return {
    actor: context.actor,
    project: context.vibe64Action.project,
    user: authenticatedVibe64User(context)
  };
}

/**
 * The authority a person's Main chat send carries to the browser conversation:
 * the session, its project, the actor and the original request.
 * @param {string} sessionId
 * @param {object} context
 */
function mainBrowserAuthority(sessionId, context) {
  const grant = conversationContextGrant({ sessionId }, context);
  return {
    sessionId,
    projectSlug: grant.project.slug,
    actorId: grant.actor.id,
    requestContext: mainConversationRequestContext(context)
  };
}

export {
  conversationContextGrant,
  mainBrowserAuthority,
  mainConversationRequestContext
};
