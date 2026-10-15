import { invalidStackOperation, isExplicitlyEmptyStackSection } from "./stackOperation.js";

const VIBE64_CONNECTED_PROJECTS_SECTION = "Connected projects";

function vibe64ConnectedProjectsInspection(section = {}) {
  const projects = [];
  if (section.status === "ready" && !isExplicitlyEmptyStackSection(section.lines)) {
    for (const [index, text] of section.lines.entries()) {
      if (!text.trim()) continue;
      const match = text.trim().match(/^- Connect `([^`\r\n]+)` from `([^`\r\n]+)` as `(dependency|composition)`\.$/u);
      if (!match) invalidStackOperation("VIBE64_CONNECTED_PROJECTS_INVALID", "genesis/stack.md#Connected projects",
        "Use: - Connect `Name` from `https://github.com/owner/repository` as `dependency` (or `composition`), followed by a period.", index + 1);
      projects.push({ name: match[1], repository: match[2], relationship: match[3] });
    }
    if (!projects.length) invalidStackOperation("VIBE64_CONNECTED_PROJECTS_INVALID", "genesis/stack.md#Connected projects",
      "Declare connected projects or exactly `- Nothing.`.");
  }
  return { contract: "vibe64.connected-projects.v1", declared: section.status === "ready",
    status: section.status === "blocked" ? "blocked" : projects.length ? "ready" : "unconfigured",
    projects, diagnostics: section.diagnostics || [] };
}

export { VIBE64_CONNECTED_PROJECTS_SECTION, vibe64ConnectedProjectsInspection };
