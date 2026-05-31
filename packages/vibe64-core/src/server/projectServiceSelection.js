function projectServiceTargetRoot(projectService = null) {
  if (!projectService || typeof projectService.currentTargetRoot !== "function") {
    return "";
  }
  return String(projectService.currentTargetRoot() || "").trim();
}

export {
  projectServiceTargetRoot
};
