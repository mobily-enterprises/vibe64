import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// Where a session's Save goes, as the session tab's info, the Save button's
// hint and the Save confirmation show it. The destination is the one the
// server resolves for the session's work (its `destination`), which Save
// itself rechecks: this only says it in short form, and whether its branch
// is the project's main branch.

const PROJECT_REPOSITORY_LABEL = "Project repository";
const LOCAL_PATH = /^(?:[/~.\\]|[A-Za-z]:[\\/]|file:)/u;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const SCP_REMOTE = /^[^@\s/:]+@([^\s/:]+):(.+)$/u;

/**
 * A repository in short form: `owner/name` on GitHub, `host/path` on another
 * host, never credentials, a query or a local path. A local folder is the
 * project's own repository.
 * @param {string} repository
 * @param {string} [mode]
 * @returns {string}
 */
function vibe64SaveTargetRepository(repository = "", mode = "") {
  const value = normalizeText(repository);
  if (mode === "local_source" || !value || /[\s\0]/u.test(value) || LOCAL_PATH.test(value)) {
    return PROJECT_REPOSITORY_LABEL;
  }
  let host = "";
  let name = value;
  const scp = SCP_REMOTE.exec(value);
  if (scp) {
    [, host, name] = scp;
  } else if (URL_SCHEME.test(value)) {
    try {
      const url = new URL(value);
      host = url.hostname;
      name = url.pathname;
    } catch {
      return PROJECT_REPOSITORY_LABEL;
    }
  }
  name = name.replace(/^\/+|\/+$/gu, "").replace(/\.git$/u, "");
  if (!name || /[@:]/u.test(name)) {
    return PROJECT_REPOSITORY_LABEL;
  }
  return !host || host.toLowerCase() === "github.com" ? name : `${host}/${name}`;
}

/**
 * The session's Save target, or null until the server has resolved it.
 * `offMain` marks a branch other than the project's main branch, or another
 * repository than the project's own (a fork's pull request).
 * @param {Record<string, any> | null} destination The work state's `destination`.
 * @param {Record<string, any>} [project] The project, for its main branch and repository.
 * @returns {{ branch: string, note: string, offMain: boolean, repository: string, text: string } | null}
 */
function vibe64SessionSaveTarget(destination = null, project = {}) {
  const target = normalizeObject(destination);
  const branch = normalizeText(target.branch);
  if (!branch) {
    return null;
  }
  const mode = normalizeText(target.mode);
  const repository = vibe64SaveTargetRepository(target.repository, mode);
  const context = normalizeObject(project);
  const mainBranch = normalizeText(context.repository?.defaultBranch);
  const projectRepository = normalizeText(context.githubRepository?.fullName || context.repository?.github?.fullName);
  const otherRepository = mode === "github" && Boolean(projectRepository) &&
    repository.toLowerCase() !== projectRepository.toLowerCase();
  const note = mainBranch && branch !== mainBranch
    ? `not ${mainBranch}`
    : otherRepository ? "not this project's repository" : "";
  return {
    branch,
    note,
    offMain: Boolean(note),
    repository,
    text: `${repository} · ${branch}${note ? ` (${note})` : ""}`
  };
}

export {
  vibe64SaveTargetRepository,
  vibe64SessionSaveTarget
};
