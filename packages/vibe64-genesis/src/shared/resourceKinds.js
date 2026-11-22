// Which declared Stack resources a Development run needs. Its one owner: Env's
// rows and status, workspace setup and Preview's start check all read it.

// Object storage speaking the S3 API, in an account the person holds with a
// provider of their own choosing. For development and a workspace's own release
// the person enters its settings (development without them uses the app's own
// default storage); a host may make one for a separate deployment it runs.
const BUCKET_RESOURCE_KIND = "bucket";

/**
 * Whether only the person supplies a resource of this kind, never a host: a
 * bucket is theirs, so its values come only from the Env they enter.
 * @param {string} [kind] a declared resource's kind
 */
function resourceKindIsPersonSupplied(kind = "") {
  return kind === BUCKET_RESOURCE_KIND;
}

/**
 * Whether development needs a declared resource's values before the
 * application runs. A bucket does not: without its settings the application
 * uses its own default storage.
 * @param {{ kind?: string }} [resource] a declared resource
 */
function resourceRequiredInDevelopment(resource = {}) {
  return !resourceKindIsPersonSupplied(resource.kind);
}

export {
  BUCKET_RESOURCE_KIND,
  resourceKindIsPersonSupplied,
  resourceRequiredInDevelopment
};
