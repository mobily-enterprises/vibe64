import { defineFeature } from "@jskit-ai/kernel/server/features";
import { authenticatedVibe64User, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import { isTrustedStudioWebSocketRequest, requireLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { mainConversationTarget, temporaryConversationTarget } from "../shared/conversationIdentity.js";
import { conversationTransportSchema } from "./conversationTransportSchema.js";

/** @typedef {import("./types.js").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-colleague/server/types").ColleagueService} ColleagueService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

// The original browser hosting owner is shared by Main and optional Colleague.
// AssistantFeature still owns all routes, subscriptions and client contracts.
const Vibe64ConversationsFeature = defineFeature({
  id: "vibe64.conversations",
  domain: "vibe64-conversations",
  requires: {
    sessions: "vibe64.sessions",
    http: "runtime.http"
  },
  optional: { colleague: "vibe64.colleague" },
  provides: {
    conversations: "assistant.conversations",
    access: "assistant.conversation.access"
  },
  /**
   * @param {object} capabilities
   * @param {SessionsService} capabilities.sessions
   * @param {ColleagueService | null} capabilities.colleague
   * @param {RuntimeHttp} capabilities.http
   */
  setup({
    sessions,
    colleague,
    http
  }) {
    const main = sessions.browserConversations;
    const product = colleague?.browserConversations;
    const subscribeActionId = "vibe64.conversation.subscribe";
    return {
      conversations: {
        open(input) {
          if (mainConversationTarget(input.id) || temporaryConversationTarget(input.id)) return main.open(input);
          if (product) return product.open(input);
          throw Object.assign(new Error("This conversation is unavailable."), { code: "conversation_forbidden", statusCode: 403 });
        },
        conversationDataSchema: conversationTransportSchema([main.conversationDataSchema, product?.conversationDataSchema]),
        conversationSelectionSchema: conversationTransportSchema([main.conversationSelectionSchema,
          product?.conversationSelectionSchema])
      },
      access: {
        subscribeActionId,
        requestPolicy: "host",
        router: {
          register(method, route, options, handler) {
            return http.router.register(method, route, { ...options, auth: "public" }, async (request, reply) => {
              if (!requireLocalStudioRequest(request, reply)) return reply;
              return handler(request, reply);
            });
          }
        },
        wrapAction(definition) {
          const { permission, execute, ...action } = definition;
          return Object.freeze({
            ...action,
            extensions: { ...action.extensions, vibe64: WORKSPACE_OPERATION },
            execute(input, context, deps) {
              if (definition.id === subscribeActionId) {
                const request = context.requestMeta?.request;
                if (!isTrustedStudioWebSocketRequest({
                  ...request,
                  headers: request?.headers,
                  vibe64User: authenticatedVibe64User(context)
                })) {
                  throw Object.assign(new Error("Open this conversation from this Studio's own origin."), { statusCode: 403 });
                }
              }
              return execute(input, context, deps);
            }
          });
        }
      }
    };
  }
});

export { Vibe64ConversationsFeature };
