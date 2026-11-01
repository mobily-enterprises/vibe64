// The type of the `vibe64.source-editor` capability, for features that require
// it, and the route scope this package's route modules share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} SourceEditorService */
/** @typedef {ReturnType<typeof import("@jskit-ai/kernel/server/http").createActionRouteScope>} ActionRouteScope */

export {};
