// The types of the `vibe64.accounts`, `vibe64.accounts.runtime` and
// `vibe64.connections` capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./accountsRuntime.js").createAccountsRuntime>} AccountsRuntime */
/** @typedef {ReturnType<typeof import("./service.js").createService>} AccountsService */
/** @typedef {ReturnType<typeof import("./Vibe64AccountsFeature.js").createConnections>} ConnectionsService */

export {};
