// The type of the `vibe64.project` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} ProjectService */
/** @typedef {ReturnType<typeof import("./projectSelection.js").createProjectSelection>} ProjectSelection */
/** @typedef {ReturnType<typeof import("./projectSessionWork.js").createProjectSessionWork>} ProjectSessionWork */
/** @typedef {ReturnType<typeof import("./projectServiceSlots.js").createProjectServiceSlots>} ProjectServiceSlots */
/** @typedef {ReturnType<typeof import("./projectEnvironment.js").createProjectEnvironment>} ProjectEnvironment */
/** @typedef {ReturnType<typeof import("./projectActions.js").createVibe64ProjectChangedPublisher>} PublishProjectChanged */
/**
 * A host's managed resources (vibe64.resource-environment.v2). A host prepares
 * a session's resources and may also name and keep a managed project database.
 * @typedef {object} ProjectResourceEnvironment
 * @property {boolean} [managedDevelopmentDatabase]
 * @property {(input: object) => Promise<object> | object} [environmentForResources]
 * @property {(input: object) => Promise<object> | object} [environmentForProvisionedResources]
 * @property {(input: object) => Promise<string> | string} [developmentDatabaseNameForProject]
 * @property {(input: object) => Promise<object> | object} [removeSessionResources]
 */
/**
 * A host's saved values for the Development Env (vibe64.project.saved-env-values,
 * contract vibe64.saved-env-values.v1), shown by its own label.
 * @typedef {object} SavedEnvValues
 * @property {string} label
 * @property {(input: { projectContextRoot: string, projectRuntimeRoot: string, projectSlug: string }) => Promise<object>} valuesForProject
 */

export {};
