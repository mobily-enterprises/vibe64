import { readFile } from "node:fs/promises";
import path from "node:path";

import { listGenesisPasses } from "@local/vibe64-genesis/server";
import { serializeByKey, writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { isMissingPathError, vibe64Error } from "@local/vibe64-core/server/core";
import { resolveProjectRuntimeRoot } from "@local/vibe64-core/server/projectState";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runSourceCommand } from "@local/vibe64-runtime/server/sourceCommand";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { vibe64Result } from "./terminalShared.js";

/** @typedef {Awaited<ReturnType<typeof listGenesisPasses>>[number]} GenesisPass */
/**
 * What the project remembers about one pass's suggestion; every field is an ISO time. When a pass
 * last ran is Genesis's record, never this one.
 * @typedef {{ snoozedUntil?: string, dismissedAt?: string }} ProjectPassRecord
 */

const PROJECT_PASSES_FILE = "pass-suggestions.json";
const DAY_MS = 24 * 60 * 60 * 1000;
// "Later" on a suggestion hides it for this long.
const PASS_SNOOZE_DAYS = 7;
// Vibe64's interval for each of Genesis's recommendation hints: a pass is due once this many days
// have passed since it last completed and the app has had this many commits since. A pass that
// never ran is due once the app has this many commits in all.
const PASS_INTERVALS = Object.freeze({
  "after-change": Object.freeze({ days: 7, commits: 20 }),
  "first-version": Object.freeze({ days: 90, commits: 30 }),
  periodic: Object.freeze({ days: 21, commits: 30 })
});
const passInterval = (pass) => PASS_INTERVALS[Object.hasOwn(PASS_INTERVALS, pass.recommend?.when) ? pass.recommend.when : "periodic"];
const COMMIT_COUNT_TIMEOUT_MS = 15_000;
const recordUpdates = new Map();

function projectPassesPath(projectRuntimeRoot) {
  return path.join(resolveProjectRuntimeRoot({ projectRuntimeRoot }), "settings", PROJECT_PASSES_FILE);
}

const isoTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : "";

/**
 * The project's pass records, by pass id: any snooze or dismissal of its suggestion. A project
 * whose suggestions were never snoozed or dismissed has none.
 * @param {string} projectRuntimeRoot
 * @returns {Promise<Record<string, ProjectPassRecord>>}
 */
async function readProjectPassRecords(projectRuntimeRoot) {
  let stored;
  try {
    stored = JSON.parse(await readFile(projectPassesPath(projectRuntimeRoot), "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) return {};
    if (error instanceof SyntaxError) {
      throw vibe64Error("The project's pass suggestion settings are not valid JSON.", "vibe64_project_passes_invalid");
    }
    throw error;
  }
  const passes = stored?.passes && typeof stored.passes === "object" ? stored.passes : {};
  return Object.fromEntries(Object.entries(passes).map(([id, record]) => [id, Object.fromEntries(
    ["snoozedUntil", "dismissedAt"].flatMap((field) => isoTime(record?.[field]) ? [[field, record[field]]] : [])
  )]));
}

/**
 * Replaces one pass's record with what change returns for it, one change per project at a time.
 * @param {string} projectRuntimeRoot
 * @param {string} passId
 * @param {(record: ProjectPassRecord) => ProjectPassRecord} change
 */
async function updateProjectPassRecord(projectRuntimeRoot, passId, change) {
  const filePath = projectPassesPath(projectRuntimeRoot);
  return serializeByKey(recordUpdates, filePath, async () => {
    const passes = await readProjectPassRecords(projectRuntimeRoot);
    passes[passId] = change(passes[passId] || {});
    await writeJsonFileAtomic(filePath, { passes }, { fileMode: vibe64SharedModes().file });
    return passes[passId];
  });
}

/**
 * The suggestion rule, kept simple on purpose. A pass is due once its interval's days have passed
 * since its last completed run (Genesis's lastRun) and the app has had its interval's commits
 * since; a pass that never ran, once the app has that many commits in all. A snoozed pass waits
 * for its snooze to end, and a dismissed one until it completes again. Of the passes due, one that
 * never ran comes first, then the most overdue for its interval; a tie keeps Genesis's order.
 * @param {Array<GenesisPass & { commitsSince: number | null, snoozedUntil: string, dismissed: boolean }>} passes
 * @param {number} [now]
 */
function passRecommendation(passes, now = Date.now()) {
  const overdue = (pass) => pass.lastRun ? (now - Date.parse(pass.lastRun)) / DAY_MS / passInterval(pass).days : Infinity;
  return passes.filter((pass) => pass.commitsSince !== null && !pass.dismissed && !(Date.parse(pass.snoozedUntil) > now) &&
    pass.commitsSince >= passInterval(pass).commits && overdue(pass) >= 1)
    .reduce((chosen, pass) => !chosen || overdue(pass) > overdue(chosen) ? pass : chosen, null);
}

/**
 * Commits in the session source's history (HEAD), only those since a time when one is given;
 * null when the source cannot answer.
 * @param {string} sourceRoot
 * @param {string} [since] an ISO time
 * @returns {Promise<number | null>}
 */
async function countSessionCommits(sourceRoot, since = "") {
  if (!sourceRoot) return null;
  const result = await runSourceCommand("git", [
    "-C", sourceRoot, "rev-list", "--count", ...(since ? [`--since=${since}`] : []), "HEAD"
  ], { cwd: sourceRoot, gitSafeDirectories: [sourceRoot], runtimes: ["git"], timeout: COMMIT_COUNT_TIMEOUT_MS });
  const count = Number(result.stdout.trim());
  return result.ok && Number.isSafeInteger(count) ? count : null;
}

/**
 * The chat's Passes list: the passes Genesis offers with when each last ran in this project, the
 * commits since, and the one suggestion the rule picks; and the suggestion's Later and Dismiss.
 * Each answers as a route does: a refusal is a failure result, not a thrown error.
 * @param {object} dependencies
 * @param {(sessionId: string) => Promise<{ runtime: { stateRoot: string }, session: object }>} dependencies.sessionContext
 * @param {typeof countSessionCommits} [dependencies.countCommits]
 * @param {typeof listGenesisPasses} [dependencies.listPasses]
 * @param {() => number} [dependencies.now]
 */
function createProjectPasses({
  sessionContext,
  countCommits = countSessionCommits,
  listPasses = listGenesisPasses,
  now = Date.now
}) {
  /** @param {string} sessionId */
  function readSessionPasses(sessionId) {
    return vibe64Result(() => readPasses(sessionId));
  }

  async function readPasses(sessionId) {
    const { runtime, session } = await sessionContext(sessionId);
    const sourceRoot = sessionSourcePath(session);
    const [genesisPasses, records] = await Promise.all([
      listPasses({ projectRoot: sourceRoot }),
      readProjectPassRecords(runtime.stateRoot)
    ]);
    // Passes that last ran at the same time share one count.
    const counts = new Map();
    const commitsSince = (lastRun) => {
      if (!counts.has(lastRun)) counts.set(lastRun, countCommits(sourceRoot, lastRun));
      return counts.get(lastRun);
    };
    const passes = await Promise.all(genesisPasses.map(async (pass) => {
      const record = records[pass.id] || {};
      return {
        ...pass,
        commitsSince: await commitsSince(pass.lastRun || ""),
        snoozedUntil: record.snoozedUntil || "",
        // A dismissal lasts until the pass completes again.
        dismissed: Boolean(record.dismissedAt) && !(Date.parse(pass.lastRun) > Date.parse(record.dismissedAt))
      };
    }));
    const recommended = passRecommendation(passes, now());
    return { ok: true, sessionId, passes, recommendation: recommended ? recommended.id : "" };
  }

  /**
   * Later snoozes a pass's suggestion for a week; Dismiss hides it until the pass runs again.
   * @param {string} sessionId
   * @param {{ passId: string, action: "snooze" | "dismiss" }} input
   */
  function changePassRecommendation(sessionId, input) {
    return vibe64Result(() => changeRecommendation(sessionId, input));
  }

  async function changeRecommendation(sessionId, input) {
    const { runtime, session } = await sessionContext(sessionId);
    if (!(await listPasses({ projectRoot: sessionSourcePath(session) })).some(({ id }) => id === input.passId)) {
      throw vibe64Error("That pass is not available in this project.", "vibe64_project_pass_unknown");
    }
    const at = now();
    await updateProjectPassRecord(runtime.stateRoot, input.passId, (record) => ({
      ...record,
      ...(input.action === "snooze"
        ? { snoozedUntil: new Date(at + PASS_SNOOZE_DAYS * DAY_MS).toISOString() }
        : { dismissedAt: new Date(at).toISOString() })
    }));
    return readPasses(sessionId);
  }

  return Object.freeze({
    readSessionPasses,
    changePassRecommendation
  });
}

export {
  PASS_INTERVALS,
  PASS_SNOOZE_DAYS,
  countSessionCommits,
  createProjectPasses,
  passRecommendation,
  readProjectPassRecords
};
