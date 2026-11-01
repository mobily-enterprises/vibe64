// The types of the `vibe64.sessions` and `vibe64.sessions.repository-updates`
// capabilities, for features that require them, and the types several of the
// package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} SessionsService */
/** @typedef {ReturnType<typeof import("./Vibe64SessionsProvider.js").createRepositoryUpdates>} SessionRepositoryUpdates */
/** @typedef {ReturnType<typeof import("./repositoryUpdateProbe.js").createRepositoryUpdateProbe>} RepositoryUpdateProbe */
/** @typedef {ReturnType<typeof import("./sessionWorkOperations.js").createSessionWorkOperations>} SessionWorkOperations */
/** @typedef {ReturnType<typeof import("./sessionPresence.js").createSessionPresenceService>} SessionPresenceService */
/** @typedef {ReturnType<typeof import("./sessionWorkspaceSetup.js").createTerminalsSetupRunner>} WorkspaceSetupRunner */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService["initializeModelRouting"]} AccountsInitializeModelRouting */
/** @typedef {ReturnType<typeof import("./sessionWorkspaceSetup.js").createSessionWorkspaceSetup>} SessionWorkspaceSetup */
/** @typedef {ReturnType<typeof import("./sessionArchive.js").createSessionArchive>} SessionArchive */
/** @typedef {SessionArchive["prepareArchive"]} SessionArchivePrepareArchive */
/** @typedef {ReturnType<typeof import("./sessionRenewalPredecessor.js").createRenewalPredecessorSession>} RenewalPredecessorSession */
/** @typedef {ReturnType<typeof import("./sessionRenewalAccess.js").createRenewalSessionAccess>} RenewalSessionAccess */
/** @typedef {ReturnType<typeof import("./sessionRenewalSuccessor.js").createRenewalSuccessorSession>} RenewalSuccessorSession */
/** @typedef {ReturnType<typeof import("./sessionRenewalAdmission.js").createRenewalAdmission>} RenewalAdmission */
/** @typedef {ReturnType<typeof import("./sessionRenewalRestoration.js").createRenewalRestoration>} RenewalRestoration */

export {};
