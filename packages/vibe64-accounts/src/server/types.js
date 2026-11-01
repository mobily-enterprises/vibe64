// The types of the `vibe64.accounts`, `vibe64.accounts.runtime` and
// `vibe64.connections` capabilities, for features that require them, and the
// types several of the package's files share.

/** @typedef {ReturnType<typeof import("./accountsRuntime.js").createAccountsRuntime>} AccountsRuntime */
/** @typedef {ReturnType<typeof import("./service.js").createService>} AccountsService */
/** @typedef {ReturnType<typeof import("./Vibe64AccountsFeature.js").createConnections>} ConnectionsService */
/** @typedef {ReturnType<typeof import("./authSessionViews.js").createAuthSessionViews>} AuthSessionViews */
/** @typedef {ReturnType<typeof import("./accountStatusReads.js").createAccountStatusReads>} AccountStatusReads */
/** @typedef {ReturnType<typeof import("./accountAccess.js").createAccountAccess>} AccountAccess */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService["readClaudeAccountStatus"]} TerminalsReadClaudeAccountStatus */
/** @typedef {ReturnType<typeof import("./aiConnectionService.js").createAiConnectionService>} AiConnectionService */
/** @typedef {AccountsRuntime["requireAiManagement"]} AccountsRequireAiManagement */
/** @typedef {ReturnType<typeof import("./aiConnectionStore.js").createAiConnectionStore>} AiConnectionStore */
/** @typedef {ReturnType<typeof import("./modelRouting.js").createModelRouting>} ModelRouting */
/** @typedef {ReturnType<typeof import("./accountRealtimeEvents.js").createVibe64AccountsChangedPublisher>} PublishAccountChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService["inspectAssistantRoutingConfiguration"]} TerminalsInspectAssistantRoutingConfiguration */

export {};
