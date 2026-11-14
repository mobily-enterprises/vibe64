import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { GENESIS_MASTER_PASS, GENESIS_PASSES } from "../fixtures/genesisPasses.js";
import {
  PASS_INTERVALS,
  PASS_SNOOZE_DAYS,
  countSessionCommits,
  createProjectPasses,
  passRecommendation,
  readProjectPassRecords
} from "../../packages/vibe64-terminals/src/server/projectPasses.js";

const execFileAsync = promisify(execFile);
const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-11-13T12:00:00.000Z");
const ago = (days) => new Date(START - days * DAY).toISOString();

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(directory, { force: true, recursive: true }));
  return directory;
}

// A project whose Genesis list reports lastRuns[id] for each pass and, when its own Genesis runs no
// pass, unavailable as the reason, and whose session source answers every commit count with
// commits(since).
async function project(t, { lastRuns = {}, commits = () => 60, unavailable = null } = {}) {
  const stateRoot = await temporaryDirectory(t, "v64-passes-");
  const clock = { now: START };
  const counted = [];
  const listed = [];
  const passes = createProjectPasses({
    sessionContext: async (sessionId) => ({ runtime: { stateRoot }, session: { sessionId, metadata: {} } }),
    listPasses: async (options) => {
      listed.push(options);
      return {
        unavailable,
        passes: GENESIS_PASSES.map((pass) => ({
          ...pass, lastRun: lastRuns[pass.id] ?? null, ...(unavailable ? { unavailable, runs: [] } : {})
        })),
        master: { ...GENESIS_MASTER_PASS, ...(unavailable ? { unavailable, passes: [], runs: [] } : {}) }
      };
    },
    countCommits: async (_sourceRoot, since) => {
      counted.push(since);
      return commits(since);
    },
    now: () => clock.now
  });
  const read = async () => {
    const result = await passes.readSessionPasses("session-1");
    return { ...result, byId: Object.fromEntries(result.passes.map((pass) => [pass.id, pass])) };
  };
  return { clock, counted, listed, lastRuns, passes, read, stateRoot };
}

test("the Passes list is Genesis's passes, each with its last completed run from Genesis or none", async (t) => {
  const f = await project(t, { lastRuns: { "quality-pass": ago(3) }, commits: (since) => since ? 4 : 120 });
  const result = await f.read();
  assert.equal(result.ok, true);
  assert.deepEqual(result.passes.map(({ id, title, description, recommend }) => ({ id, title, description, recommend })),
    GENESIS_PASSES.map(({ id, title, description, recommend }) => ({ id, title, description, recommend })));
  assert.equal(result.byId["quality-pass"].lastRun, ago(3), "a pass that ran shows when");
  assert.equal(result.byId["quality-pass"].commitsSince, 4);
  assert.equal(result.byId.deslop.lastRun, null, "a pass that never ran shows none");
  assert.equal(result.byId.deslop.commitsSince, 120, "a pass that never ran counts the whole history");
  assert.deepEqual(f.counted.sort(), ["", ago(3)], "passes that last ran at the same time share one count");
  assert.deepEqual(f.listed, [{ projectRoot: "" }], "Genesis lists the passes for the session's source");
  assert.equal(result.unavailable, null, "the project's Genesis runs passes");
  assert.deepEqual(result.byId.deslop.runs, GENESIS_PASSES[0].runs, "each pass carries the runs Genesis offers");
  assert.deepEqual(result.master, { ...GENESIS_MASTER_PASS, commitsSince: 120 },
    "the Master pass, never completed, with the whole history's count, which it shares");
});

test("a project whose own Genesis runs no pass lists its passes with Genesis's reason and suggests none", async (t) => {
  const reason = "This project's Genesis (genesis-compiler 1.10.15) cannot run passes. Update it to 1.10.21 or later.";
  const f = await project(t, { unavailable: reason, commits: () => 500 });
  const result = await f.read();
  assert.equal(result.unavailable, reason);
  assert.ok(result.passes.every((pass) => pass.unavailable === reason && pass.runs.length === 0));
  assert.equal(result.recommendation, "", "every pass is due by its commits, but none can run");
});

test("the suggestion rule: a never-run or overdue pass, never-run first, then the most overdue for its interval", () => {
  const pass = (id, state) => ({ ...GENESIS_PASSES.find((entry) => entry.id === id),
    lastRun: null, commitsSince: 60, snoozedUntil: "", dismissed: false, ...state });
  // Genesis's periodic hint: Vibe64's interval for it is 21 days and 30 commits.
  assert.deepEqual(PASS_INTERVALS.periodic, { days: 21, commits: 30 });
  const suggested = (state) => passRecommendation([pass("quality-pass", state)], START)?.id || "";
  assert.equal(suggested({ lastRun: ago(20) }), "", "not yet overdue");
  assert.equal(suggested({ lastRun: ago(21) }), "quality-pass", "overdue");
  assert.equal(suggested({ lastRun: ago(40), commitsSince: 29 }), "", "overdue but barely changed");
  assert.equal(suggested({}), "quality-pass", "never run");
  assert.equal(suggested({ commitsSince: 29 }), "", "a pass that never ran waits for enough commits in all");
  assert.equal(suggested({ commitsSince: null }), "", "no suggestion without a commit count");
  assert.equal(suggested({ dismissed: true }), "");
  assert.equal(suggested({ snoozedUntil: ago(-1) }), "");
  assert.equal(suggested({ snoozedUntil: ago(1) }), "quality-pass", "a snooze that ended no longer hides it");
  assert.equal(suggested({ unavailable: "This project's Genesis has no Quality pass.", runs: [] }), "",
    "a pass the project's Genesis cannot run is never suggested");
  assert.equal(passRecommendation([{ ...pass("data-pass"), recommend: { when: "someday", hint: "" }, lastRun: ago(21) }], START)?.id,
    "data-pass", "a hint Vibe64 does not know is periodic");

  const due = (passes) => passRecommendation(passes, START)?.id || "";
  // Deslop's after-change interval is 7 days and the data pass's periodic one 21: 28 days is four Deslop intervals, 42 two data ones.
  assert.equal(due([pass("data-pass", { lastRun: ago(42) }), pass("deslop", { lastRun: ago(28) })]), "deslop", "the most overdue");
  assert.equal(due([pass("deslop", { lastRun: ago(70) }), pass("identity-pass")]), "identity-pass",
    "a pass that never ran comes before an overdue one");
  assert.equal(due([pass("ui-pass"), pass("quality-pass")]), "ui-pass", "passes that never ran keep Genesis's order");
  assert.equal(due([pass("deslop", { lastRun: ago(1) })]), "", "nothing due, nothing suggested");
});

test("Later hides a suggestion for a week and Dismiss until the pass completes again", async (t) => {
  // Every other pass ran a day ago, and the app has not changed since.
  const f = await project(t, {
    lastRuns: Object.fromEntries(GENESIS_PASSES.filter(({ id }) => id !== "deslop").map(({ id }) => [id, ago(1)])),
    commits: (since) => since ? 0 : 60
  });
  assert.equal((await f.read()).recommendation, "deslop", "the one pass that never ran");

  const snoozed = await f.passes.changePassRecommendation("session-1", { passId: "deslop", action: "snooze" });
  assert.equal(snoozed.recommendation, "");
  assert.equal(snoozed.passes[0].snoozedUntil, new Date(START + PASS_SNOOZE_DAYS * DAY).toISOString());
  f.clock.now = START + PASS_SNOOZE_DAYS * DAY - 1;
  assert.equal((await f.read()).recommendation, "");
  f.clock.now = START + PASS_SNOOZE_DAYS * DAY;
  assert.equal((await f.read()).recommendation, "deslop", "the snooze is over");

  const dismissed = await f.passes.changePassRecommendation("session-1", { passId: "deslop", action: "dismiss" });
  assert.equal(dismissed.recommendation, "");
  assert.equal(dismissed.passes[0].dismissed, true);
  f.clock.now += 365 * DAY;
  const later = await f.read();
  assert.equal(later.byId.deslop.dismissed, true, "a dismissed suggestion stays hidden");
  assert.notEqual(later.recommendation, "deslop");

  // Genesis records Deslop's next completed run: the dismissal ends, and the pass waits for its interval.
  f.lastRuns.deslop = new Date(f.clock.now).toISOString();
  const ran = await f.read();
  assert.equal(ran.byId.deslop.dismissed, false);
  assert.notEqual(ran.recommendation, "deslop");
  const stored = JSON.parse(await readFile(path.join(f.stateRoot, "settings", "pass-suggestions.json"), "utf8"));
  assert.deepEqual(Object.keys(stored.passes.deslop).sort(), ["dismissedAt", "snoozedUntil"], "Vibe64 keeps no run times");

  const refused = await f.passes.changePassRecommendation("session-1", { passId: "no-such-pass", action: "snooze" });
  assert.equal(refused.ok, false);
  assert.match(JSON.stringify(refused), /vibe64_project_pass_unknown/u);
});

test("stored suggestion records keep only their times, and unreadable ones are refused with a code", async (t) => {
  const stateRoot = await temporaryDirectory(t, "v64-pass-records-");
  assert.deepEqual(await readProjectPassRecords(stateRoot), {});
  const file = path.join(stateRoot, "settings", "pass-suggestions.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ passes: { "data-pass": { dismissedAt: ago(1), snoozedUntil: "not a time", extra: "dropped" } } }));
  assert.deepEqual(await readProjectPassRecords(stateRoot), { "data-pass": { dismissedAt: ago(1) } });
  await writeFile(file, "{");
  await assert.rejects(readProjectPassRecords(stateRoot), { code: "vibe64_project_passes_invalid" });
});

test("commits are counted in the session source's history, all of them or only those since a time", async (t) => {
  const source = await temporaryDirectory(t, "v64-pass-commits-");
  const git = (args) => execFileAsync("git", args, { cwd: source });
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.name", "Vibe64 Test"]);
  await git(["config", "user.email", "vibe64@example.test"]);
  for (const text of ["one", "two"]) {
    await writeFile(path.join(source, "app.txt"), `${text}\n`);
    await git(["add", "app.txt"]);
    await git(["commit", "-m", text]);
  }
  assert.equal(await countSessionCommits(source), 2);
  assert.equal(await countSessionCommits(source, new Date(Date.now() + DAY).toISOString()), 0);
  assert.equal(await countSessionCommits(""), null, "a session without source has no count");
  assert.equal(await countSessionCommits(await temporaryDirectory(t, "v64-pass-not-git-")), null);
});
