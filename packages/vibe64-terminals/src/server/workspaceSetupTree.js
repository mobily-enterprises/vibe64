// The exact tree a workspace preparation prepares: per repository, one `git status` and a
// hash of only the files it lists, so the check costs what the uncommitted changes cost.

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
  const status = await runCommand("git", [...GIT_STATUS_ARGS], {
    cwd: root,
    gitSafeDirectories: [root],
    runtimes: ["git"],
    timeout: 30_000
  });
  if (!status.ok) return null;
  const entries = status.stdout.split("\0").filter(Boolean);
  const commit = entries.find(entry => entry.startsWith("# branch.oid "))?.slice("# branch.oid ".length) || "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit)) return null;
  const changed = entries.filter(line => !line.startsWith("#"));
  if (changed.length > MAX_CHANGED_FILES) return null;
  const changes = createHash("sha256");
  for (const entry of changed) {
    const fields = FIELDS_BEFORE_PATH[entry[0]];
    if (!fields) return null;
    const file = entry.split(" ").slice(fields).join(" ");
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

export { readPreparedTree };
