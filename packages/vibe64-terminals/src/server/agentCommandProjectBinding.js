import path from "node:path";

import { normalizeText, vibe64Error } from "@local/vibe64-core/server/core";

function projectContextRoot(project = {}) {
  const root = normalizeText(project?.projectRoot || project?.path);
  return root ? path.resolve(root) : "";
}

// Binds each agent session to the project that prepared its command, and runs
// later requests only inside that same project. `errors` gives each command
// its own [message, code] for: sessionRequired, projectRequired, unbound and
// changed. `capture()` adds command-specific fields to a new binding.
function createAgentCommandProjectBinding(projectService, errors, { capture = () => ({}) } = {}) {
  const bindings = new Map();
  const fail = ([message, code]) => vibe64Error(message, code);

  async function bind(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) throw fail(errors.sessionRequired);
    const project = await projectService.readCurrentProject();
    const projectSlug = normalizeText(project?.slug || project?.name);
    if (!projectSlug) throw fail(errors.projectRequired);
    const binding = { ...capture(), projectContextRoot: projectContextRoot(project), projectSlug };
    bindings.set(normalizedSessionId, binding);
    return binding;
  }

  // Runs operation(binding, project) in the bound project, refusing when the
  // project at that slug is no longer the one that was bound.
  async function run(sessionId = "", operation) {
    const binding = bindings.get(normalizeText(sessionId));
    if (!binding?.projectSlug) throw fail(errors.unbound);
    return projectService.runInProjectContext(binding.projectSlug, async () => {
      const project = await projectService.readCurrentProject();
      if (
        normalizeText(project?.slug || project?.name) !== binding.projectSlug ||
        binding.projectContextRoot && projectContextRoot(project) !== binding.projectContextRoot
      ) {
        throw fail(errors.changed);
      }
      return operation(binding, project);
    });
  }

  // Removes the session's binding and returns it, or null when none existed.
  function forget(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const binding = bindings.get(normalizedSessionId) || null;
    bindings.delete(normalizedSessionId);
    return binding;
  }

  return Object.freeze({
    bind,
    forget,
    get: (sessionId = "") => bindings.get(normalizeText(sessionId)) || null,
    run
  });
}

export { createAgentCommandProjectBinding };
