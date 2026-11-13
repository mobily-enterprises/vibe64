import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  genesisPackageBinDirectory,
  initializeGenesisProject,
  listGenesisPasses
} from "../../packages/vibe64-genesis/src/server/index.js";
import { createProjectPasses } from "../../packages/vibe64-terminals/src/server/projectPasses.js";
import { GENESIS_PASSES } from "../fixtures/genesisPasses.js";

const run = promisify(execFile);
const DAY = 24 * 60 * 60 * 1000;

test("Passes read Genesis's own list for a fresh project: never run, then a recorded run, and the suggestions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-genesis-passes-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  // A managed session's source, holding a fresh Genesis project with one commit.
  const source = path.join(root, "sessions", "active", "session-1", "source");
  await mkdir(source, { recursive: true });
  const git = (args, env = {}) => run("git", args, { cwd: source, env: { ...process.env, ...env } });
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.name", "Vibe64 Test"]);
  await git(["config", "user.email", "vibe64@example.test"]);
  await initializeGenesisProject({ projectRoot: source });
  await git(["add", "-A"]);
  // Committed two days ago, so it never shares the second of the recorded run below.
  const created = new Date(Date.now() - 2 * DAY).toISOString();
  await git(["commit", "-q", "-m", "A fresh Genesis project"], { GIT_AUTHOR_DATE: created, GIT_COMMITTER_DATE: created });

  // Genesis lists all five passes, none run; the fixture the other tests use is the same list.
  const shape = ({ id, title, description, recommend, request, lastRun }) => ({ id, title, description, recommend, request, lastRun });
  const listed = await listGenesisPasses({ projectRoot: source });
  assert.deepEqual(listed.map(shape), GENESIS_PASSES.map(shape));
  assert.ok(listed.every(({ request }) => request.trim()), "every pass has its own request for Run");

  const clock = { now: Date.now() };
  const passes = createProjectPasses({
    sessionContext: async (sessionId) => ({
      runtime: { stateRoot: path.join(root, "state") },
      session: { sessionId, metadata: { source_path: source, source_path_authority: "managed_session_source", source_kind: "session_clone" } }
    }),
    now: () => clock.now
  });
  const read = async () => {
    const result = await passes.readSessionPasses("session-1");
    assert.equal(result.ok, true, JSON.stringify(result));
    return { ...result, byId: Object.fromEntries(result.passes.map((pass) => [pass.id, pass])) };
  };
  const fresh = await read();
  assert.deepEqual(fresh.passes.map(({ lastRun }) => lastRun), [null, null, null, null, null], "the list shows Never completed for each");
  assert.equal(fresh.recommendation, "", "an app with one commit is too new for any suggestion");

  // A pass's own last step records its run in the project; the list shows when.
  const before = Math.floor(Date.now() / 1000) * 1000;
  await run(path.join(genesisPackageBinDirectory(), "genesis"), ["passes", "done", "quality-pass"], { cwd: source });
  const recorded = await read();
  const { lastRun } = recorded.byId["quality-pass"];
  assert.match(lastRun, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
  assert.ok(Date.parse(lastRun) >= before);
  assert.deepEqual(recorded.passes.filter(({ id }) => id !== "quality-pass").map(({ lastRun: other }) => other), [null, null, null, null]);

  // Thirty commits a day after that run, and three weeks on: every pass is due.
  const changed = new Date(Date.parse(lastRun) + DAY).toISOString();
  for (let index = 0; index < 30; index += 1) {
    await git(["commit", "-q", "--allow-empty", "-m", `Change ${index}`], { GIT_AUTHOR_DATE: changed, GIT_COMMITTER_DATE: changed });
  }
  clock.now = Date.parse(lastRun) + 22 * DAY;
  const due = await read();
  assert.equal(due.byId["quality-pass"].commitsSince, 30);
  assert.equal(due.byId.deslop.commitsSince, 31);
  // Passes that never ran come first, in Genesis's order; Later and Dismiss move on to the next.
  const order = [];
  let current = due.recommendation;
  for (const action of ["snooze", "dismiss", "snooze", "dismiss", "snooze"]) {
    order.push(current);
    current = (await passes.changePassRecommendation("session-1", { passId: current, action })).recommendation;
  }
  assert.deepEqual(order, ["deslop", "ui-pass", "identity-pass", "data-pass", "quality-pass"],
    "never-run passes first, then the overdue one");
  assert.equal(current, "", "every pass is snoozed or dismissed");
  clock.now += 7 * DAY;
  const later = await read();
  assert.equal(later.recommendation, "deslop", "a snooze ends after a week");
  assert.equal(later.byId["ui-pass"].dismissed, true, "a dismissal lasts until the pass completes again");
});
