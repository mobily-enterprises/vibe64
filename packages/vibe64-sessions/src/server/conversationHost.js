import { AppError } from "@jskit-ai/kernel/server/runtime";
import { authenticatedVibe64User, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import { isTrustedStudioWebSocketRequest, requireLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { mainConversationTarget, temporaryConversationTarget } from "../shared/conversationIdentity.js";
import { conversationTransportSchema } from "./conversationTransportSchema.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("./types.js").SessionsService["browserConversations"]} MainBrowserConversations */
/** @typedef {import("@local/vibe64-colleague/server/types").ColleagueService["browserConversations"]} ColleagueBrowserConversations */

const SUBSCRIBE_ACTION_ID = "vibe64.conversation.subscribe";

function conversationUnavailable() {
  return new AppError(403, "This conversation is unavailable.", { code: "conversation_forbidden" });
}

/**
 * Without Colleague, no conversation besides Main and temporary ones opens and
 * the transport carries only their envelopes.
 */
const NO_COLLEAGUE_CONVERSATIONS = Object.freeze({
  open() {
    throw conversationUnavailable();
  },
  conversationDataSchema: null,
  conversationSelectionSchema: null
});

/**
 * The assistant runtime's conversation host for this app: Main and temporary
 * conversations open through sessions, every other one through Colleague. The
 * assistant runtime owns the routes, subscriptions and client contracts; the
 * host admits only this Studio's own requests and runs each conversation
 * action as a workspace operation.
 * @param {object} dependencies
 * @param {ColleagueBrowserConversations | typeof NO_COLLEAGUE_CONVERSATIONS} dependencies.colleagueConversations
 * @param {RuntimeHttp} dependencies.http
 * @param {MainBrowserConversations} dependencies.mainConversations
 */
function createConversationHost({ colleagueConversations, http, mainConversations }) {
  function open(input) {
    if (mainConversationTarget(input.id) || temporaryConversationTarget(input.id)) return mainConversations.open(input);
    return colleagueConversations.open(input);
  }

  function register(method, route, options, handler) {
    return http.router.register(method, route, { ...options, auth: "public" }, async (request, reply) => {
      if (!requireLocalStudioRequest(request, reply)) return reply;
      return handler(request, reply);
    });
  }

  function assertStudioSubscription(context) {
    const request = context.requestMeta?.request;
    if (!isTrustedStudioWebSocketRequest({
      ...request,
      headers: request?.headers,
      vibe64User: authenticatedVibe64User(context)
    })) {
      throw Object.assign(new Error("Open this conversation from this Studio's own origin."), { statusCode: 403 });
    }
  }

  function wrapAction(definition) {
    const { permission: _permission, execute, ...action } = definition;
    return Object.freeze({
      ...action,
      extensions: { ...action.extensions, vibe64: WORKSPACE_OPERATION },
      execute(input, context, deps) {
        if (definition.id === SUBSCRIBE_ACTION_ID) assertStudioSubscription(context);
        return execute(input, context, deps);
      }
    });
  }

  return Object.freeze({
    access: Object.freeze({
      subscribeActionId: SUBSCRIBE_ACTION_ID,
      requestPolicy: "host",
      router: Object.freeze({ register }),
      wrapAction
    }),
    conversations: Object.freeze({
      open,
      conversationDataSchema: conversationTransportSchema([
        mainConversations.conversationDataSchema,
        colleagueConversations.conversationDataSchema
      ]),
      conversationSelectionSchema: conversationTransportSchema([
        mainConversations.conversationSelectionSchema,
        colleagueConversations.conversationSelectionSchema
      ])
    })
  });
}

export { createConversationHost, NO_COLLEAGUE_CONVERSATIONS };
