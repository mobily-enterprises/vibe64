/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * The selected project's source root, or empty when none is selected.
 * @param {ProjectService} project
 */
function projectServiceSourceRoot(project) {
  return String(project.currentProjectSourceRoot() || "").trim();
}

/**
 * The selected project's namespace root, or empty when none is selected.
 * @param {ProjectService} project
 */
function projectServiceNamespaceRoot(project) {
  return String(project.currentTargetRoot() || "").trim();
}

export {
  projectServiceNamespaceRoot,
  projectServiceSourceRoot
};
