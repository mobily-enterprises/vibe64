// The type of the `vibe64.terminals` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} TerminalsService */

/** @typedef {ReturnType<typeof import("./agent/sessionAgentManagerState.js").createSessionAgentManagerState>} SessionAgentManagerState */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentBindings.js").createSessionAgentBindings>} SessionAgentBindings */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentAccess.js").createSessionAgentAccess>} SessionAgentAccess */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentConversationOperations.js").createSessionAgentConversationOperations>} SessionAgentConversationOperations */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/conversation").createConversationRuntime>} ConversationRuntime */
/** @typedef {ReturnType<typeof import("./sessionAttachments.js").createSessionAttachments>} SessionAttachments */

export {};
