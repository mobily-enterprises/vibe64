import { currentProjectVibe64User } from "../../packages/vibe64-core/src/server/projectRequestContext.js";

/**
 * The session agent manager's required collaborators for a test that exercises
 * none of them: attachments that leave a message as it is, a conversation
 * runtime with no operations, access that is not owner-only, no plan usage, the
 * request's own user, no saved routing configuration and no providers. Spread it
 * first so a test's own collaborators replace these.
 */
const sessionAgentManagerDefaults = Object.freeze({
  attachments: Object.freeze({
    async prepareMessage(_context, message) {
      return message;
    }
  }),
  conversationRuntime: Object.freeze({}),
  readAssistantAccess: async () => ({ ownerOnly: false }),
  readProviderUsage: async () => null,
  readRoutingConfiguration: async () => undefined,
  resolveAssistantUser: async (user) => user || currentProjectVibe64User() || null,
  providers: Object.freeze([])
});

export { sessionAgentManagerDefaults };
