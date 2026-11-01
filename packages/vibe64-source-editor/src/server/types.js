// The type of the `vibe64.source-editor` capability, for features that require
// it, and the route scope and explanation stream this package's modules share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} SourceEditorService */
/** @typedef {ReturnType<typeof import("@jskit-ai/kernel/server/http").createActionRouteScope>} ActionRouteScope */
/** @typedef {(event: object) => void} SourceEditorStreamEmit */
/** @typedef {() => boolean} SourceEditorStreamClosed */
/** @typedef {{ emit: SourceEditorStreamEmit, isClosed: SourceEditorStreamClosed }} SourceEditorExplanationStream */

export {};
