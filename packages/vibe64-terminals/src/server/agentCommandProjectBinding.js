import path from "node:path";

import { vibe64Error } from "@local/vibe64-core/server/core";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

function projectContextRoot(project) {
  const root = toText(project?.projectRoot || project?.path);
  return root ? path.resolve(root) : "";
}

/**
 * Binds each agent session to the project that prepared its command, and runs
 * later requests only inside that same project. `errors` gives each command
 * its own [message, code] for: sessionRequired, projectRequired, unbound and
 * changed. `capture()` adds command-specific fields to a new binding.
 * @param {ProjectService} project
 * @param {object} errors
 * @param {object} [options]
 * @param {() => object} [options.capture]
 */
function createAgentCommandProjectBinding(project, errors, options = {}) {
  const { capture = () => ({}) } = options;
  const bindings = new Map();
  const fail = ([message, code]) => vibe64Error(message, code);

  async function bind(sessionId = "") {
    const normalizedSessionId = toText(sessionId);
    if (!normalizedSessionId) throw fail(errors.sessionRequired);
    const projectRecord = await project.readCurrentProject();
    const projectSlug = toText(projectRecord?.slug || projectRecord?.name);
    if (!projectSlug) throw fail(errors.projectRequired);
    const binding = { ...capture(), projectContextRoot: projectContextRoot(projectRecord), projectSlug };
    bindings.set(normalizedSessionId, binding);
    return binding;
  }

  /**
   * Runs operation(binding, project) in the bound project, refusing when the
   * project at that slug is no longer the one that was bound.
   */
  async function run(sessionId = "", operation) {
    const binding = bindings.get(toText(sessionId));
    if (!binding?.projectSlug) throw fail(errors.unbound);
    return project.runInProjectContext(binding.projectSlug, async () => {
      const projectRecord = await project.readCurrentProject();
      if (
        toText(projectRecord?.slug || projectRecord?.name) !== binding.projectSlug ||
        binding.projectContextRoot && projectContextRoot(projectRecord) !== binding.projectContextRoot
      ) {
        throw fail(errors.changed);
      }
      return operation(binding, projectRecord);
    });
  }

  /**
   * Removes the session's binding and returns it, or null when none existed.
   */
  function forget(sessionId = "") {
    const normalizedSessionId = toText(sessionId);
    const binding = bindings.get(normalizedSessionId) || null;
    bindings.delete(normalizedSessionId);
    return binding;
  }

  const get = (sessionId = "") => bindings.get(toText(sessionId)) || null;

  return Object.freeze({
    bind,
    forget,
    get,
    run
  });
}

export { createAgentCommandProjectBinding };
