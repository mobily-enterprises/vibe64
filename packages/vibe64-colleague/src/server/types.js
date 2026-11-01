// The types of the `vibe64.colleague` and `vibe64.colleague.browser-focus`
// capabilities, for features that require them, and the types several of the
// package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createColleagueService>} ColleagueService */
/** @typedef {ReturnType<typeof import("./registerColleagueFocus.js").createColleagueBrowserFocus>} ColleagueBrowserFocus */
/** @typedef {ReturnType<typeof import("./usageKnowledge.js").createColleagueUsageKnowledge>} ColleagueUsageKnowledge */
/** @typedef {ReturnType<typeof import("./colleagueServiceState.js").createColleagueServiceState>} ColleagueServiceState */
/** @typedef {ReturnType<typeof import("./colleagueRecords.js").createColleagueRecords>} ColleagueRecords */
/** @typedef {ReturnType<typeof import("./colleagueThreads.js").createColleagueThreads>} ColleagueThreads */
/** @typedef {ReturnType<typeof import("./colleagueConversations.js").createColleagueConversations>} ColleagueConversations */
/** @typedef {ReturnType<typeof import("./colleagueWorker.js").createColleagueWorker>} ColleagueWorker */
/** @typedef {ReturnType<typeof import("./watchSources.js").createWatchSources>} WatchSources */
/** @typedef {() => Promise<string>} ColleagueNameResolver The name Colleague gives the model on each turn. */

export {};
