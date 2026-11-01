function projectServiceSourceRoot(project = null) {
  // readable-check: allow method-probe - optional operation: without a project service there is no selected source
  if (project && typeof project.currentProjectSourceRoot === "function") {
    return String(project.currentProjectSourceRoot() || "").trim();
  }
  return "";
}

function projectServiceNamespaceRoot(project = null) {
  // readable-check: allow method-probe - optional operation: without a project service there is no selected namespace
  if (!project || typeof project.currentTargetRoot !== "function") {
    return "";
  }
  return String(project.currentTargetRoot() || "").trim();
}

export {
  projectServiceNamespaceRoot,
  projectServiceSourceRoot
};
