import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

// This is a development input reader, not an authorization boundary. Hosted
// execution has already checked the map against the task's receiving sessions.
export async function readConnectedDevelopmentSources(sourceFile, { projectRoot } = {}) {
  const file = path.resolve(projectRoot, sourceFile);
  const relative = path.relative(await realpath(projectRoot), await realpath(file));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The connected source map must belong to this development project.");
  }
  const map = JSON.parse(await readFile(file, "utf8"));
  if (map?.contract !== "vibe64.connected-sources.v1" || typeof map.sessionId !== "string" || !map.sessionId ||
      !Array.isArray(map.projects)) throw new Error("Expected a prepared vibe64.connected-sources.v1 source map.");
  const roots = new Set();
  const projects = [];
  for (const project of map.projects) {
    if (!["dependency", "composition"].includes(project?.relationship) ||
        !["npm", "custom"].includes(project.type) ||
        typeof project.sourceRoot !== "string" || !path.isAbsolute(project.sourceRoot)) {
      throw new Error("Connected development requires an absolute source root, relationship and effective npm/custom type for each project.");
    }
    const sourceRoot = await realpath(project.sourceRoot);
    if (roots.has(sourceRoot)) throw new Error(`Duplicate connected development source root: ${sourceRoot}.`);
    roots.add(sourceRoot);
    projects.push({ ...project, sourceRoot });
  }
  return { file, sessionId: map.sessionId, projects };
}

export function developmentProjectRoot(root) {
  const session = path.dirname(root);
  const active = path.dirname(session);
  const sessions = path.dirname(active);
  return path.basename(root) === "source" && path.basename(active) === "active" && path.basename(sessions) === "sessions"
    ? path.dirname(sessions)
    : root;
}

export async function resolvePinnedDevelopmentSource(source, expectedPackage) {
  if (!source) return null;
  const configured = path.resolve(source);
  if (!configured.endsWith(`${path.sep}sessions${path.sep}pinned${path.sep}source`)) return null;
  const projectRoot = path.dirname(path.dirname(path.dirname(configured)));
  const project = path.basename(projectRoot);
  try {
    const resolved = await realpath(configured);
    if (developmentProjectRoot(resolved) !== projectRoot) throw new Error("The pin does not resolve to an active session in this project.");
    const manifest = JSON.parse(await readFile(path.join(resolved, "package.json"), "utf8"));
    if (manifest.name !== expectedPackage) throw new Error(`Expected repository ${expectedPackage}.`);
    await access(path.join(resolved, ".git"));
    return resolved;
  } catch (error) {
    throw new Error(`Development source for project ${project} is unavailable at ${configured}. Pin a valid ${expectedPackage} session in ${project}, then retry Preview. No other session or published package will be substituted. ${error.message}`, { cause: error });
  }
}

export async function resolveDevelopmentDependencySource(source, expectedPackage) {
  if (!source) return null;
  const pinnedRoot = await resolvePinnedDevelopmentSource(source, expectedPackage);
  // Pins are validated by the session path, package identity and Git metadata.
  // A consumer's managed commands must not execute in the dependency's session.
  if (pinnedRoot) return { sourceRoot: pinnedRoot, sourceParent: developmentProjectRoot(pinnedRoot) };
  const sourceRoot = await realpath(path.resolve(source));
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  const { stdout } = await exec("git", ["-c", `safe.directory=${sourceRoot}`, "-C", sourceRoot, "rev-parse", "--show-toplevel"]);
  if (manifest.name !== expectedPackage || await realpath(stdout.trim()) !== sourceRoot) {
    throw new Error(`Expected the ${expectedPackage} repository at ${sourceRoot}; no source was changed.`);
  }
  const sourceParent = developmentProjectRoot(sourceRoot);
  return { sourceRoot, sourceParent };
}
