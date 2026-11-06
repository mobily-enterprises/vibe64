// The type of the `vibe64.pages` capability, for features that require it, and of a page's records.

/** @typedef {ReturnType<typeof import("./service.js").createPagesService>} PagesService */

/**
 * Who made a page or one of its versions: the person whose request the
 * session's agent was answering.
 * @typedef {object} PageAuthor
 * @property {string} id
 * @property {string} name
 */

/**
 * One kept version of a page.
 * @typedef {object} PageVersionEntry
 * @property {number} number
 * @property {string} title the page's title at this version
 * @property {string} createdAt
 * @property {PageAuthor} createdBy
 * @property {string} sessionId the session whose agent published it
 * @property {number} files
 * @property {number} bytes
 * @property {number} [restoredFrom] the earlier version it brought back, if it did
 */

/**
 * A page's stored record, `<project state>/pages/<id>/page.json`.
 * @typedef {object} PageRecord
 * @property {"vibe64.page.v1"} contract
 * @property {string} id
 * @property {string} title
 * @property {PageAuthor} createdBy
 * @property {string} sessionId the session it came from
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {PageAuthor} updatedBy
 * @property {boolean} archived
 * @property {string | null} archivedAt
 * @property {number} version the current version's number
 * @property {PageVersionEntry[]} versions the kept versions, oldest first, at most ten
 */

/**
 * What a project member or the agent sees of a page.
 * @typedef {object} PageSummary
 * @property {string} id
 * @property {string} title
 * @property {PageAuthor} createdBy
 * @property {string} sessionId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {PageAuthor} updatedBy
 * @property {boolean} archived
 * @property {string | null} archivedAt
 * @property {number} version
 * @property {{ number: number, title: string, createdAt: string, createdBy: PageAuthor, restoredFrom?: number }[]} versions the kept versions, oldest first
 * @property {string} link the in-app path that opens it beside the chat
 * @property {PageRefreshSummary | null} refresh how it refreshes, if it does
 */

/**
 * A page's refresh as everyone sees it.
 * @typedef {object} PageRefreshSummary
 * @property {"command" | "prompt"} kind a script with no AI, or an AI task in the session it was set from
 * @property {string} schedule "Every hour", "Daily at 07:30 (Europe/Rome)"
 * @property {PageAuthor} scheduledBy who it runs as
 * @property {string} sessionId the session it was set from, where a prompt refresh runs
 * @property {string} nextAt
 * @property {boolean} paused
 * @property {string} pausedReason
 * @property {number} failures failed runs in a row; three pause it
 * @property {{ startedAt: string, taskId?: string } | null} running
 * @property {{ id: string, kind: string, startedAt: string, endedAt: string, outcome: "refreshed" | "failed" | "cancelled" | "skipped", message: string, version?: number, taskId?: string, sessionId?: string } | null} lastRun
 */

/**
 * What a host decides about scheduled refreshes, through the pages service's setRefreshHost; with
 * none, nothing is refused and an AI refresh's task starts with no person.
 * @typedef {object} PageRefreshHost
 * @property {(person: PageAuthor, slug: string) => Promise<{ user: object | null, blocked: string }>} runAs
 *   whom a refresh this person set runs as now: the user its AI task starts as (null for none), or why
 *   it can't run, which pauses the schedule
 * @property {string} scriptRefusal why refresh scripts don't run on this host, or ""
 */

/**
 * How the pages scheduler runs a prompt refresh as an AI task; vibe64.ai-tasks supplies it.
 * @typedef {object} PageRefreshTasks
 * @property {(sessionId: string, input: object, vibe64User: object | null) => Promise<PageRefreshTaskState>} start as that user, or as no one
 * @property {(sessionId: string, taskId: string) => Promise<PageRefreshTaskState | null>} read null once the task is closed
 * @property {(sessionId: string, taskId: string) => Promise<void>} cancel
 * @property {(sessionId: string, taskId: string) => Promise<void>} close
 */

/**
 * @typedef {object} PageRefreshTaskState
 * @property {string} id
 * @property {boolean} ended
 * @property {boolean} done
 * @property {boolean} needsYou whether it stopped for a person
 * @property {boolean} unavailable whether the AI account was the reason
 * @property {boolean} cancelled whether someone cancelled it
 * @property {string} message
 * @property {{ at: string, text: string }[]} log
 */

export {};
