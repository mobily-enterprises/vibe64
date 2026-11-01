// The type of the `vibe64.project` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} ProjectService */
/** @typedef {ReturnType<typeof import("./projectSelection.js").createProjectSelection>} ProjectSelection */
/** @typedef {ReturnType<typeof import("./projectSessionWork.js").createProjectSessionWork>} ProjectSessionWork */
/** @typedef {ReturnType<typeof import("./projectServiceSlots.js").createProjectServiceSlots>} ProjectServiceSlots */
/** @typedef {ReturnType<typeof import("./projectEnvironment.js").createProjectEnvironment>} ProjectEnvironment */
/** @typedef {ReturnType<typeof import("./projectActions.js").createVibe64ProjectChangedPublisher>} PublishProjectChanged */

export {};
