import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { isTrustedStudioWebSocketRequest, requireLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { mainConversationTarget, temporaryConversationTarget } from "../shared/conversationIdentity.js";

function conversationSchema(main, colleague) {
  if (!colleague) return main;
  // Each product's original action still validates its complete input. The
  // common transport accepts either declared product envelope.
  return createSchema(Object.fromEntries(Object.entries({
    ...main.getFieldDefinitions(), ...colleague.getFieldDefinitions()
  }).map(([key, field]) => [key, { ...field, required: false }])));
}

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
        conversationDataSchema: conversationSchema(main.conversationDataSchema, product?.conversationDataSchema),
        conversationSelectionSchema: conversationSchema(main.conversationSelectionSchema, product?.conversationSelectionSchema)
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
