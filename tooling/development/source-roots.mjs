import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

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
  const sourceRoot = await resolvePinnedDevelopmentSource(source, expectedPackage) || await realpath(path.resolve(source));
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  const { stdout } = await exec("git", ["-c", `safe.directory=${sourceRoot}`, "-C", sourceRoot, "rev-parse", "--show-toplevel"]);
  if (manifest.name !== expectedPackage || await realpath(stdout.trim()) !== sourceRoot) {
    throw new Error(`Expected the ${expectedPackage} repository at ${sourceRoot}; no source was changed.`);
  }
  const sourceParent = developmentProjectRoot(sourceRoot);
  return { sourceRoot, sourceParent };
}
