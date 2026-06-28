function projectServiceTargetRoot(projectService = null) {
  if (projectService && typeof projectService.currentProjectSourceRoot === "function") {
    const sourceRoot = String(projectService.currentProjectSourceRoot() || "").trim();
    if (sourceRoot) {
      return sourceRoot;
    }
  }
  if (!projectService || typeof projectService.currentTargetRoot !== "function") {
    return "";
  }
  return String(projectService.currentTargetRoot() || "").trim();
}

export {
  projectServiceTargetRoot
};
