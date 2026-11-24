// What the session's source looks like at one moment, and which of its files changed since: the facts behind
// the plan's "Updated 47 min ago · 12 files changed since" and the plan check at the end of a turn. A source state
// holds, for the session's source and each connected copy, its HEAD and the files Git reports changed or untracked
// there, each with its modification time and size (or "deleted"). A file changed since a state when HEAD moved
// over it, when it is changed now and was not then or changed again (another time or size), or when it was changed
// then and is not now (committed or put back). Vibe64 never reads more into it: which plan item a change belongs
// to is the AI's to judge.
import { lstat } from "node:fs/promises";
import path from "node:path";
import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runSourceCommand } from "@local/vibe64-runtime/server/sourceCommand";
import { readWorkPlanMark } from "./assistantWorkPlan.js";

const GIT_TIMEOUT_MS = 15_000;
const STATUS_BUFFER_BYTES = 16 * 1024 * 1024;
// The changed files a state records per repository; past it the state is cut and counts say "or more".
const RECORDED_FILES = 1000;
const COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

/**
 * The repositories a session's source is made of: its own and each connected copy, by name ("" for its own).
 * @param {{ metadata?: Record<string, string> }} session
 */
function sourceRepositories(session) {
  const source = sessionSourcePath(session);
  if (!source) return [];
  let copies = [];
  try {
    copies = sessionConnectedCopies(session);
  } catch {
    // Unreadable copy records are Save's and Update's to report; the session's own source still counts.
  }
  return [{ name: "", root: source }, ...copies.map((copy) => ({ name: copy.name, root: copy.path }))];
}

function git(root, args) {
  // No optional locks: reading the status never rewrites the session's index.
  return runSourceCommand("git", ["--no-optional-locks", "-C", root, ...args], {
    cwd: root,
    gitSafeDirectories: [root],
    maxBuffer: STATUS_BUFFER_BYTES,
    runtimes: ["git"],
    timeout: GIT_TIMEOUT_MS
  });
}

/**
 * HEAD and the changed and untracked paths of `git status --porcelain=v2 -z --branch`.
 * @param {string} output
 */
function parseStatus(output) {
  const fields = output.split("\0");
  let head = "";
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.startsWith("# branch.oid ")) {
      const oid = field.slice("# branch.oid ".length).trim();
      head = COMMIT_ID.test(oid) ? oid : "";
    } else if (field.startsWith("1 ")) {
      paths.push(field.split(" ").slice(8).join(" "));
    } else if (field.startsWith("2 ")) {
      paths.push(field.split(" ").slice(9).join(" "));
      // A rename or copy is followed by the path it came from.
      paths.push(fields[index + 1]);
      index += 1;
    } else if (field.startsWith("u ")) {
      paths.push(field.split(" ").slice(10).join(" "));
    } else if (field.startsWith("? ")) {
      paths.push(field.slice(2));
    }
  }
  return { head, paths: [...new Set(paths.filter(Boolean))].sort() };
}

/** A changed file's signature: its modification time and size, or "deleted". */
async function fileSignature(root, relativePath) {
  const info = await lstat(path.join(root, relativePath)).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  return info ? `${info.mtimeMs}:${info.size}` : "deleted";
}

async function repositoryState({ name, root }) {
  const result = await git(root, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--no-renames"]);
  if (!result.ok) return { name, unreadable: true };
  const { head, paths } = parseStatus(result.stdout);
  const recorded = paths.slice(0, RECORDED_FILES);
  const files = {};
  for (const file of recorded) files[file] = await fileSignature(root, file);
  return { name, head, files, ...(paths.length > recorded.length ? { cut: true } : {}) };
}

/**
 * The session's source now: when it was read, and each repository's HEAD and changed files.
 * @param {{ metadata?: Record<string, string> }} session
 * @returns {Promise<{ at: string, repositories: object[] } | null>} null when the session has no source
 */
async function readSourceState(session) {
  const repositories = sourceRepositories(session);
  if (!repositories.length) return null;
  // Taken before Git reads anything: a file written while the state is read counts as changed after it.
  const at = new Date().toISOString();
  return { at, repositories: await Promise.all(repositories.map(repositoryState)) };
}

/**
 * The session's source now, from its source descriptor (which leaves the connected copies out) and the session's
 * connected copies record.
 * @param {{ readMetadataValue: (sessionId: string, name: string) => Promise<string | undefined> }} store
 * @param {string} sessionId
 * @param {{ metadata?: Record<string, string> }} descriptor
 */
async function sessionSourceState(store, sessionId, descriptor) {
  const copies = await store.readMetadataValue(sessionId, "connected_copies") || "";
  return readSourceState({ ...descriptor, sessionId, metadata: { ...descriptor.metadata, connected_copies: copies } });
}

/** The paths HEAD's move from one commit to another changed, or null when Git can't tell (a commit is gone). */
async function headChanges(root, from, to) {
  if (!from || !to || from === to) return [];
  const result = await git(root, ["diff", "--name-only", "-z", "--no-renames", from, to, "--"]);
  return result.ok ? result.stdout.split("\0").filter(Boolean) : null;
}

/**
 * The files of the session's source that changed since an earlier state, and whether there may be more than counted
 * (a state was cut, a repository unreadable, or HEAD moved from a commit Git no longer has).
 * @param {{ at: string, repositories: object[] } | null} before
 * @param {{ metadata?: Record<string, string> }} session
 * @returns {Promise<{ files: string[], more: boolean } | null>} null when there is nothing to compare
 */
async function sourceChangesSince(before, session) {
  if (!before?.repositories) return null;
  const now = await readSourceState(session);
  if (!now) return null;
  const changed = new Set();
  let more = false;
  const roots = new Map(sourceRepositories(session).map((repository) => [repository.name, repository.root]));
  for (const current of now.repositories) {
    const earlier = before.repositories.find((repository) => repository.name === current.name);
    const prefix = current.name ? `connected/${current.name}/` : "";
    if (current.unreadable || earlier?.unreadable) {
      more = true;
      continue;
    }
    const add = (file) => changed.add(prefix + file);
    const previousFiles = earlier?.files || {};
    if (earlier) {
      const moved = await headChanges(roots.get(current.name), earlier.head, current.head);
      if (moved === null) more = true;
      else moved.forEach(add);
    }
    for (const [file, signature] of Object.entries(current.files)) {
      if (previousFiles[file] === signature) continue;
      // A file the earlier, cut state did not record may have been changed then already: only a later write counts.
      if (earlier?.cut && !(file in previousFiles) && signature !== "deleted" &&
          Number(signature.split(":")[0]) <= Date.parse(before.at)) continue;
      add(file);
    }
    for (const file of Object.keys(previousFiles)) {
      if (!(file in current.files)) add(file);
    }
    if (current.cut || earlier?.cut) more = true;
  }
  return { files: [...changed].sort(), more };
}

// The plan view's count is read again at most this often per plan: each change event reads the summary.
const PLAN_CHANGES_TTL_MS = 5_000;
const PLAN_CHANGES_KEPT = 256;
const planChangesRead = new Map();

/**
 * How many of the session's files changed since the AI last brought the current plan up to date (its mark), or null
 * when no mark records the source then.
 * @param {object} context the plan's context, with the session and its metadata
 * @returns {Promise<{ files: number, more: boolean } | null>}
 */
async function planChangesSinceMark(context) {
  const mark = await readWorkPlanMark(context);
  if (!mark?.source) return null;
  const key = [context.runtime.stateRoot || "", context.session.sessionId, context.routingConversationId || "", mark.at].join("\0");
  const kept = planChangesRead.get(key);
  if (kept && kept.until > Date.now()) return kept.read;
  const read = sourceChangesSince(mark.source, context.session)
    .then((changes) => changes && { files: changes.files.length, more: changes.more });
  planChangesRead.set(key, { until: Date.now() + PLAN_CHANGES_TTL_MS, read });
  read.catch(() => planChangesRead.delete(key));
  while (planChangesRead.size > PLAN_CHANGES_KEPT) planChangesRead.delete(planChangesRead.keys().next().value);
  return read;
}

export { readSourceState, sessionSourceState, sourceChangesSince, planChangesSinceMark, parseStatus };
