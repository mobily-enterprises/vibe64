// The files an adapter other than npm generates in a session tree (a derived manifest, a go.work,
// a Cargo config) so the toolchain reads the connected checkout in place of the published package.
// Each is untracked, kept out of Git through the type's own exclude block, and rewritten only when
// its text changes.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";

function inside(tree, relative) {
  const target = path.resolve(tree, relative);
  if (path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..") || !target.startsWith(`${path.resolve(tree)}${path.sep}`)) {
    throw vibe64Error(`A connected derived file must stay inside its tree: ${relative}.`, "vibe64_connected_derived_path");
  }
  return target;
}

/** A derived file's text, or null when it does not exist. */
async function readDerivedFile(tree, relative) {
  return readFile(inside(tree, relative), "utf8").catch(error => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

/** Refuses when the tree tracks any of these paths: a derived file never replaces a tracked one. */
async function refuseTracked({ connection, tree, paths, runCommand }) {
  // `git ls-files --` with no path lists every tracked file.
  if (!paths.length) return;
  const tracked = await runCommand({ command: "git", args: ["ls-files", "-z", "--", ...paths], cwd: tree, timeout: 60_000 });
  if (tracked?.ok !== true) {
    throw vibe64Error(`Connected ${connection.name}: Git could not say whether ${tree} tracks ${paths.join(", ")}.`, "vibe64_connected_git_unavailable");
  }
  const first = String(tracked.stdout || "").split("\0").find(Boolean);
  if (first) {
    throw vibe64Error(
      `Connected ${connection.name}: ${tree} tracks ${first} in Git, so Vibe64 will not generate it. Stop tracking it, or rename the tracked file.`,
      "vibe64_connected_derived_tracked"
    );
  }
}

/**
 * Writes the type's derived files in one tree and keeps exactly those out of Git.
 * @param {object} input
 * @param {{ name: string }} input.connection the connection being applied (for messages)
 * @param {string} input.tree
 * @param {Record<string, string>} input.files every derived file of the type in this tree, by relative path
 * @param {(request: object) => Promise<object>} input.runCommand
 * @param {(tree: string, paths: string[]) => Promise<void>} input.writeGitExcludes
 * @param {string[]} [input.excludes] more paths the type keeps out of Git, such as a folder its toolchain writes
 * @returns {Promise<string[]>} the paths whose text changed
 */
async function writeDerivedFiles({ connection, tree, files, runCommand, writeGitExcludes, excludes = [] }) {
  const paths = Object.keys(files).sort();
  await refuseTracked({ connection, tree, paths, runCommand });
  const changed = [];
  const modes = vibe64SharedModes();
  for (const relative of paths) {
    const target = inside(tree, relative);
    const entry = await lstat(target).catch(() => null);
    if (entry && !entry.isFile()) {
      throw vibe64Error(`Connected ${connection.name}: ${relative} in ${tree} is not a plain file, so Vibe64 will not replace it.`, "vibe64_connected_derived_path");
    }
    if (await readDerivedFile(tree, relative) === files[relative]) continue;
    await writeFileAtomic(target, files[relative], { directoryMode: modes.inheritingDirectory, fileMode: modes.file });
    changed.push(relative);
  }
  await writeGitExcludes(tree, [...paths, ...excludes]);
  return changed;
}

/**
 * The patterns the type's exclude block holds in a tree: what its adapter last generated there.
 * Empty when it never generated anything, so a restore can stop without searching the tree.
 */
async function excludedDerivedPatterns(tree, type) {
  const text = await readFile(path.join(tree, ".git", "info", "exclude"), "utf8").catch(() => "");
  const lines = text.split(/\r?\n/u);
  const begin = lines.indexOf(`# BEGIN Vibe64 managed connected ${type} packages files`);
  const end = lines.indexOf(`# END Vibe64 managed connected ${type} packages files`);
  return begin >= 0 && end > begin ? lines.slice(begin + 1, end).filter(Boolean) : [];
}

/** Removes derived files (when no connection of the type remains) and the type's exclude block. */
async function removeDerivedFiles({ tree, paths, writeGitExcludes }) {
  const removed = [];
  for (const relative of paths) {
    const target = inside(tree, relative);
    if (!(await lstat(target).catch(() => null))) continue;
    await rm(target, { recursive: true, force: true });
    removed.push(relative);
  }
  await writeGitExcludes(tree, []);
  return removed;
}

/**
 * A digest of what a toolchain decision was made from: the text of each file below the roots whose
 * name `wanted` accepts, outside dot-folders and the `skipped` folders, with the files `counted`
 * refuses (one an adapter generated) left out. A files-only proof trusts what preparation recorded
 * only while this is unchanged.
 * @param {{ roots: string[], wanted: (name: string) => boolean, skipped?: Set<string>, counted?: (text: string) => boolean }} input
 */
async function inputsDigest({ roots, wanted, skipped = new Set(), counted = () => true }) {
  const hash = createHash("sha256");
  for (const [index, root] of roots.entries()) {
    const files = [];
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && !skipped.has(entry.name)) await walk(path.join(dir, entry.name));
        else if (entry.isFile() && wanted(entry.name)) files.push(path.join(dir, entry.name));
      }
    };
    await walk(root);
    for (const file of files.sort()) {
      const text = await readFile(file, "utf8").catch(() => null);
      if (text !== null && counted(text)) hash.update(`${index}\0${path.relative(root, file)}\0${text}\0`);
    }
  }
  return hash.digest("hex");
}

export { excludedDerivedPatterns, inputsDigest, readDerivedFile, refuseTracked, removeDerivedFiles, writeDerivedFiles };
