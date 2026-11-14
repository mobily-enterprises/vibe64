// The types of the `vibe64.sessions` and `vibe64.sessions.repository-updates`
// capabilities, for features that require them, and the types several of the
// package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} SessionsService */
/** @typedef {ReturnType<typeof import("./repositoryUpdates.js").createRepositoryUpdates>} SessionRepositoryUpdates */
/** @typedef {ReturnType<typeof import("./repositoryUpdateProbe.js").createRepositoryUpdateProbe>} RepositoryUpdateProbe */
/**
 * What a project watch's realtime connection lends the watch action: whether
 * the watch is still current, holds and rooms it releases on leaving, and the
 * connection a session's timeline names.
 * @typedef {{ current: () => boolean, hold: (detach: () => void) => void, join: (room: string) => void, connection?: WatchConnection }} WatchBinding
 */
/**
 * One browser connection, for a session's timeline (sessionConnectionTimeline.js):
 * its tab, why it ended ("" while it is open) and how many of its watches show
 * each session.
 * @typedef {{ tab: string, closedReason: () => string, sessionViews: Map<string, number> }} WatchConnection
 */
/** @typedef {ReturnType<typeof import("./sessionWorkOperations.js").createSessionWorkOperations>} SessionWorkOperations */
/** @typedef {ReturnType<typeof import("./sessionPresence.js").createSessionPresenceService>} SessionPresenceService */
/** @typedef {ReturnType<typeof import("./sessionWorkspaceSetup.js").createTerminalsSetupRunner>} WorkspaceSetupRunner */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService["initializeModelRouting"]} AccountsInitializeModelRouting */
/** @typedef {ReturnType<typeof import("./sessionWorkspaceSetup.js").createSessionWorkspaceSetup>} SessionWorkspaceSetup */
/** @typedef {ReturnType<typeof import("./sessionArchive.js").createSessionArchive>} SessionArchive */
/** @typedef {ReturnType<typeof import("./sessionCreation.js").createSessionCreation>} SessionCreation */
/** @typedef {ReturnType<typeof import("./sessionRepositoryReads.js").createSessionRepositoryReads>} SessionRepositoryReads */
/** @typedef {ReturnType<typeof import("./sessionRepositoryUpdates.js").createSessionRepositoryUpdates>} SessionUpdateChecks */
/** @typedef {ReturnType<typeof import("./sessionWork.js").createSessionWork>} SessionWork */
/** @typedef {ReturnType<typeof import("./sessionRenewal.js").createSessionRenewalController>} SessionRenewalController */
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
