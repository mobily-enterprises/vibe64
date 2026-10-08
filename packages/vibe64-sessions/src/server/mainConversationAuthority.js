import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";

// Original Main facade request projection. Keep contributor grants out of the
// retained context so later native effects resolve current authority again.
function mainConversationRequestContext(context = {}) {
  const request = context?.requestMeta?.request;
  return { surface: "app", channel: "internal", requestMeta: request ? {
    ...context.requestMeta, request: { ...request, headers: request.headers, vibe64User: authenticatedVibe64User(context) }
  } : context?.requestMeta };
}

export { mainConversationRequestContext };
