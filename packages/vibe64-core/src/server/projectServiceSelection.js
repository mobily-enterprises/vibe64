function projectServiceSourceRoot(projectService = null) {
  // readable-check: allow method-probe - optional operation: without a project service there is no selected source
  if (projectService && typeof projectService.currentProjectSourceRoot === "function") {
    return String(projectService.currentProjectSourceRoot() || "").trim();
  }
  return "";
}

function projectServiceNamespaceRoot(projectService = null) {
  // readable-check: allow method-probe - optional operation: without a project service there is no selected namespace
  if (!projectService || typeof projectService.currentTargetRoot !== "function") {
    return "";
  }
  return String(projectService.currentTargetRoot() || "").trim();
}

export {
  projectServiceNamespaceRoot,
  projectServiceSourceRoot
};
