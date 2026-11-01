// The type of the `vibe64.publishing` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createPublishingService>} PublishingService */
/** @typedef {ReturnType<typeof import("./service.js").createPublishingPackaging>} PublishingPackaging */
/** @typedef {ReturnType<typeof import("./projectRepository.js").createProjectRepository>} ProjectRepository */

export {};
