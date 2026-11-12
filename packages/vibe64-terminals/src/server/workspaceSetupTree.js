// The exact tree a workspace preparation prepares: per repository, one `git status` and a
// hash of only the files it lists, so the check costs what the uncommitted changes cost.
// What a step's named inputs hold is read the same way, over those inputs only.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { runSourceCommand } from "@local/vibe64-runtime/server/sourceCommand";

const GIT_STATUS_ARGS = Object.freeze([
  "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--no-renames"
]);
// The fields before the path in each `git status --porcelain=v2` entry kind.
const FIELDS_BEFORE_PATH = Object.freeze({ "1": 8, u: 10, "?": 1 });
// More changed files than this (an unignored dependency folder) are not hashed: such a tree has no record.
const MAX_CHANGED_FILES = 1000;

/** @param {string} root */
function gitOptions(root) {
  return { cwd: root, gitSafeDirectories: [root], runtimes: ["git"], timeout: 30_000 };
}

/**
 * The entries of `git status --porcelain=v2 -z` output, each with its path; null when one is of an
 * unknown kind or there are too many to hash.
 * @param {string} stdout
 */
function changedEntries(stdout) {
  const changed = stdout.split("\0").filter(entry => entry && !entry.startsWith("#"));
  if (changed.length > MAX_CHANGED_FILES) return null;
  const entries = [];
  for (const entry of changed) {
    const fields = FIELDS_BEFORE_PATH[entry[0]];
    if (!fields) return null;
    entries.push({ entry, file: entry.split(" ").slice(fields).join(" ") });
  }
  return entries;
}

/** What a listed file holds now: its content, a link's target, or that it is gone. */
async function fileDigest(filePath) {
  const stat = await lstat(filePath).catch(() => null);
  if (!stat) return "missing";
  if (stat.isSymbolicLink()) return `link:${await readlink(filePath)}`;
  if (!stat.isFile()) return "directory";
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return `file:${stat.mode & 0o111 ? "x" : "-"}:${hash.digest("hex")}`;
}

/**
 * A repository's commit and a digest of everything that differs from it, untracked files
 * included and ignored ones left out; null when it is not a repository with a commit, or
 * has too many changed files to hash.
 * @param {string} root
 * @param {typeof runSourceCommand} runCommand
 */
async function repositoryTree(root, runCommand) {
  const status = await runCommand("git", [...GIT_STATUS_ARGS], gitOptions(root));
  if (!status.ok) return null;
  const commit = status.stdout.split("\0").find(entry => entry.startsWith("# branch.oid "))?.slice("# branch.oid ".length) || "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit)) return null;
  const changed = changedEntries(status.stdout);
  if (!changed) return null;
  const changes = createHash("sha256");
  for (const { entry, file } of changed) {
    changes.update(`${entry}\0${await fileDigest(path.join(root, file))}\0`);
  }
  return { commit, changes: `sha256:${changes.digest("hex")}` };
}

/**
 * The tree a preparation of `recipeHash` finds: the session source's and each connected
 * repository's commit and uncommitted changes. Null when any of them cannot be read, which
 * no recorded tree matches.
 * @param {object} input
 * @param {string} input.sourcePath
 * @param {string[]} [input.connectedRoots]
 * @param {string} input.recipeHash
 * @param {typeof runSourceCommand} [input.runCommand]
 */
async function readPreparedTree({ sourcePath, connectedRoots = [], recipeHash, runCommand = runSourceCommand }) {
  try {
    const [own, ...connected] = await Promise.all([sourcePath, ...connectedRoots]
      .map(root => repositoryTree(root, runCommand)));
    if (!own || connected.some(tree => !tree)) return null;
    return {
      recipeHash,
      ...own,
      connected: connected.map((tree, index) => ({ name: path.basename(connectedRoots[index]), ...tree }))
    };
  } catch {
    return null;
  }
}

/**
 * What a changed file holds now as Git would store it, `mode blob`, computed here rather than
 * by Git; null when it is gone.
 * @param {string} filePath
 * @param {"sha1" | "sha256"} algorithm the repository's object hash
 */
async function blobEntry(filePath, algorithm) {
  const stat = await lstat(filePath).catch(() => null);
  if (!stat) return null;
  if (stat.isSymbolicLink()) {
    const target = Buffer.from(await readlink(filePath));
    return `120000 ${createHash(algorithm).update(`blob ${target.length}\0`).update(target).digest("hex")}`;
  }
  if (!stat.isFile()) throw new Error(`${filePath} is not a file.`);
  const hash = createHash(algorithm).update(`blob ${stat.size}\0`);
  await pipeline(createReadStream(filePath), hash);
  return `${stat.mode & 0o100 ? "100755" : "100644"} ${hash.digest("hex")}`;
}

/**
 * What a step's named `inputs` hold in the session source: the mode and blob of every file they
 * match (a folder covers every file below it, `*` matches within one path segment and `**`
 * across segments), ignored files left out. Tracked files come from one `git ls-files`, and only
 * the files one `git status` lists as changed or untracked are read, so the digest is the same
 * whether a file is committed, staged or not. Null when it cannot be read.
 * @param {object} input
 * @param {string} input.sourcePath
 * @param {string[]} input.inputs
 * @param {typeof runSourceCommand} [input.runCommand]
 */
async function readStepInputs({ sourcePath, inputs, runCommand = runSourceCommand }) {
  // Each input is a glob, never a pathspec with magic of its own.
  const pathspecs = ["--", ...inputs.map(input => `:(glob)${input}`)];
  try {
    const [tracked, status] = await Promise.all([
      runCommand("git", ["ls-files", "--stage", "-z", ...pathspecs], gitOptions(sourcePath)),
      runCommand("git", [...GIT_STATUS_ARGS, ...pathspecs], gitOptions(sourcePath))
    ]);
    const changed = tracked.ok && status.ok && changedEntries(status.stdout);
    if (!changed) return null;
    const files = new Map(tracked.stdout.split("\0").filter(Boolean).map((entry) => {
      const tab = entry.indexOf("\t");
      return [entry.slice(tab + 1), entry.slice(0, tab).split(" ").slice(0, 2).join(" ")];
    }));
    const commit = status.stdout.split("\0").find(entry => entry.startsWith("# branch.oid ")) || "";
    const algorithm = /^# branch\.oid [0-9a-f]{64}$/u.test(commit) ? "sha256" : "sha1";
    for (const { file } of changed) {
      const entry = await blobEntry(path.join(sourcePath, file), algorithm);
      if (entry) files.set(file, entry);
      else files.delete(file);
    }
    const listing = [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([file, entry]) => `${entry}\t${file}`).join("\0");
    return `sha256:${createHash("sha256").update(listing).digest("hex")}`;
  } catch {
    return null;
  }
}

export { readPreparedTree, readStepInputs };
