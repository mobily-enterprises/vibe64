// Where the next after-plan passes start: one commit per session, which the
// passes' requests name so each judges only the changes since then.
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runSourceCommand } from "@local/vibe64-runtime/server/sourceCommand";

const AFTER_PLAN_BASE_METADATA = "after_plan_base";
// A full SHA-1 or SHA-256 commit id.
const COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const GIT_TIMEOUT_MS = 15_000;

/** The commit a Git command names in the session source, or "" when it names none. */
async function sourceCommit(sourceRoot, args) {
  if (!sourceRoot) return "";
  const result = await runSourceCommand("git", ["-C", sourceRoot, ...args], {
    cwd: sourceRoot,
    gitSafeDirectories: [sourceRoot],
    runtimes: ["git"],
    timeout: GIT_TIMEOUT_MS
  });
  const commit = result.ok ? result.stdout.trim() : "";
  return COMMIT_ID.test(commit) ? commit : "";
}

const sessionHead = (session) => sourceCommit(sessionSourcePath(session), ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);

/**
 * The commit the session's next after-plan passes start from: the one it recorded, while it is
 * still in HEAD's history; otherwise where the session's work leaves the canonical history it last
 * saw (the merge base of HEAD with that commit). A Save that reconciles, or an Update, rebases the
 * session's work, leaving a recorded commit outside that history, where a diff from it would hold
 * others' changes too. "" when neither exists.
 * @param {{ sessionId: string, metadata?: Record<string, string> }} session
 */
async function afterPlanBase(session) {
  const sourceRoot = sessionSourcePath(session);
  const metadata = session.metadata || {};
  const recorded = String(metadata[AFTER_PLAN_BASE_METADATA] || "");
  // The merge base of HEAD with a commit is that commit exactly when HEAD's history holds it.
  if (COMMIT_ID.test(recorded) && await sourceCommit(sourceRoot, ["merge-base", "HEAD", recorded]) === recorded) return recorded;
  const canonical = String(metadata.canonical_commit || metadata.base_commit || "");
  return COMMIT_ID.test(canonical) ? sourceCommit(sourceRoot, ["merge-base", "HEAD", canonical]) : "";
}

/**
 * Records the session source's HEAD as where the next after-plan passes start: when a chain of
 * them ends, and when a plan becomes current without one recorded (onlyWhenUnset).
 * @param {{ writeMetadataValue: Function, readMetadataValue: Function }} store
 * @param {{ sessionId: string, metadata?: Record<string, string> }} session
 * @param {{ onlyWhenUnset?: boolean }} [options]
 */
async function rememberAfterPlanBase(store, session, { onlyWhenUnset = false } = {}) {
  if (onlyWhenUnset && await store.readMetadataValue(session.sessionId, AFTER_PLAN_BASE_METADATA)) return;
  const head = await sessionHead(session);
  if (head) await store.writeMetadataValue(session.sessionId, AFTER_PLAN_BASE_METADATA, head);
}

export {
  AFTER_PLAN_BASE_METADATA,
  afterPlanBase,
  rememberAfterPlanBase
};
