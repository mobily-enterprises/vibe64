// The type of the `vibe64.project` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} ProjectService */
/** @typedef {ReturnType<typeof import("./projectSelection.js").createProjectSelection>} ProjectSelection */
/** @typedef {ReturnType<typeof import("./projectSessionWork.js").createProjectSessionWork>} ProjectSessionWork */
/** @typedef {ReturnType<typeof import("./projectServiceSlots.js").createProjectServiceSlots>} ProjectServiceSlots */
/** @typedef {ReturnType<typeof import("./projectEnvironment.js").createProjectEnvironment>} ProjectEnvironment */
/** @typedef {ReturnType<typeof import("./projectActions.js").createVibe64ProjectChangedPublisher>} PublishProjectChanged */
/**
 * A host's saved values (vibe64.saved-env-values.v1), shown by its own label.
 * @typedef {object} SavedEnvValueProvider
 * @property {string} label
 * @property {(input: { projectContextRoot: string, projectRuntimeRoot: string, projectSlug: string }) => Promise<object>} valuesForProject
 * @property {(request: object) => Promise<object>} list
 * @property {(request: object) => Promise<object>} link
 * @property {(request: object) => Promise<object>} unlink
 */

export {};
