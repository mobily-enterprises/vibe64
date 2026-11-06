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
 * @property {{ number: number, createdAt: string, createdBy: PageAuthor, restoredFrom?: number }[]} versions the kept versions, oldest first
 * @property {string} link the in-app path that opens it beside the chat
 */

export {};
