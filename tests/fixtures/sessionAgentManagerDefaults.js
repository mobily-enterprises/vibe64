/**
 * The session agent manager's required collaborators for a test that exercises
 * none of them: a conversation runtime with no operations, access that is not
 * owner-only, no plan usage, and no saved routing configuration. Spread it
 * first so a test's own collaborators replace these.
 */
const sessionAgentManagerDefaults = Object.freeze({
  conversationRuntime: Object.freeze({}),
  readAssistantAccess: async () => ({ ownerOnly: false }),
  readProviderUsage: async () => null,
  readRoutingConfiguration: async () => undefined
});

export { sessionAgentManagerDefaults };
