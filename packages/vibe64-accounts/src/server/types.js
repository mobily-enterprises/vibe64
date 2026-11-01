// The types of the `vibe64.accounts`, `vibe64.accounts.runtime` and
// `vibe64.connections` capabilities, for features that require them, and the
// types several of the package's files share.

/**
 * The `vibe64.accounts.runtime` contract. The local runtime is createAccountsRuntime's; a composing host's runtime
 * has the same members and may also run host tool commands itself.
 * @typedef {ReturnType<typeof import("./accountsRuntime.js").createAccountsRuntime> & {
 *   runHostToolCommand?: (
 *     commandArgs: string[],
 *     options: object,
 *     runner: { fallback: typeof import("./accountHostCommands.js").runDefaultHostCommand }
 *   ) => Promise<object>
 * }} AccountsRuntime
 */
/** @typedef {ReturnType<typeof import("./service.js").createService>} AccountsService */
/** @typedef {ReturnType<typeof import("./connections.js").createConnections>} ConnectionsService */
/** @typedef {ReturnType<typeof import("./authSessionViews.js").createAuthSessionViews>} AuthSessionViews */
/** @typedef {ReturnType<typeof import("./authSessionViews.js").createAuthSessionState>} AuthSessionState */
/** @typedef {ReturnType<typeof import("./accountStatusReads.js").createAccountStatusReads>} AccountStatusReads */
/** @typedef {ReturnType<typeof import("./accountAccess.js").createAccountAccess>} AccountAccess */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService["readClaudeAccountStatus"]} TerminalsReadClaudeAccountStatus */
/** @typedef {ReturnType<typeof import("./aiConnectionService.js").createAiConnectionService>} AiConnectionService */
/** @typedef {ReturnType<typeof import("./aiConnectionService.js").createManagedAiConnections>} ManagedAiConnections */
/** @typedef {AccountsRuntime["requireAiManagement"]} AccountsRequireAiManagement */
/** @typedef {ReturnType<typeof import("./aiConnectionStore.js").createAiConnectionStore>} AiConnectionStore */
/** @typedef {ReturnType<typeof import("./modelRouting.js").createModelRouting>} ModelRouting */
/** @typedef {ReturnType<typeof import("./personalProfile.js").createPersonalProfile>} PersonalProfile */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/studioProjectContext").getStudioProjectContext>} StudioProjectContext */
/** @typedef {ReturnType<typeof import("./accountRealtimeEvents.js").createVibe64AccountsChangedPublisher>} PublishAccountChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService["inspectAssistantRoutingConfiguration"]} TerminalsInspectAssistantRoutingConfiguration */

export {};
