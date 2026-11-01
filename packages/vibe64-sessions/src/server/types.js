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
/**
 * A host's preparation of a session's archive, at each phase of every attempt;
 * `{ ok: false, error?, code? }` stops the archive.
 * @typedef {(context: { phase: string, renewal?: boolean, runtime: import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime, session: object }) => Promise<unknown>} SessionArchivePreparation
 */
/** @typedef {(actor: object, context: { renewalId: string, sessionId: string, stage: string }) => Promise<object | null>} RenewalActorResolver */
/**
 * How a persisted renewal's workflow input gets its person when the request's own person is not the persisted one.
 * @typedef {(state: object, input: object, actors: { persistedActor: object, requestActor: object | null }) => Promise<object>} RenewalActorRestoration
 */
/** @typedef {ReturnType<typeof import("./sessionRenewalPredecessor.js").createRenewalPredecessorSession>} RenewalPredecessorSession */
/** @typedef {ReturnType<typeof import("./sessionRenewalAccess.js").createRenewalSessionAccess>} RenewalSessionAccess */
/** @typedef {ReturnType<typeof import("./sessionRenewalSuccessor.js").createRenewalSuccessorSession>} RenewalSuccessorSession */
/** @typedef {ReturnType<typeof import("./sessionRenewalAdmission.js").createRenewalAdmission>} RenewalAdmission */
/** @typedef {ReturnType<typeof import("./sessionRenewalRestoration.js").createRenewalRestoration>} RenewalRestoration */

export {};
