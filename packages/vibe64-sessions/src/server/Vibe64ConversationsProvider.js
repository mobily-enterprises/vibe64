import { defineFeature } from "@jskit-ai/kernel/server/features";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { isTrustedStudioWebSocketRequest, requireLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { mainConversationTarget, temporaryConversationTarget } from "../shared/conversationIdentity.js";
import { conversationTransportSchema } from "./conversationTransportSchema.js";

// The original browser hosting owner is shared by Main and optional Colleague.
// AssistantFeature still owns all routes, subscriptions and client contracts.
const Vibe64ConversationsProvider = defineFeature({
  id: "vibe64.conversations", domain: "vibe64-conversations",
  requires: { sessions: "vibe64.sessions", http: "runtime.http" },
  optional: { colleague: "vibe64.colleague" },
  provides: { conversations: "assistant.conversations", access: "assistant.conversation.access" },
  setup({ sessions, colleague, http }) {
    const main = sessions.browserConversations;
    const product = colleague?.browserConversations;
    if (typeof main?.open !== "function") throw new TypeError("Main conversations require their session-owned browser facade.");
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
        subscribeActionId, requestPolicy: "host",
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
          return withVibe64ActionContext({ ...action,
            execute(input, context, deps) {
              if (definition.id === subscribeActionId) {
                const request = context.requestMeta?.request;
                if (!isTrustedStudioWebSocketRequest({ ...request, headers: request?.headers, vibe64User: authenticatedVibe64User(context) })) {
                  throw Object.assign(new Error("Open this conversation from this Studio's own origin."), { statusCode: 403 });
                }
              }
              return execute(input, context, deps);
            }
          }, { projectScoped: false });
        }
      }
    };
  }
});

export { Vibe64ConversationsProvider };
