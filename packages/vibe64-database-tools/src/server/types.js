// The type of the `vibe64.database-tools` capability, for features that require it, and of its parts.

/** @typedef {ReturnType<typeof import("./service.js").createService>} DatabaseToolsService */
/** @typedef {ReturnType<typeof import("./sessionDatabase.js").createSessionDatabase>} SessionDatabase */
/** @typedef {ReturnType<typeof import("./sessionQueries.js").createSessionQueries>} SessionQueries */

export {};
