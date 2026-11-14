import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { GENESIS_MASTER_PASS, GENESIS_PASSES } from "../fixtures/genesisPasses.js";

const run = promisify(execFile);
const DAY = 24 * 60 * 60 * 1000;

test("Passes read Genesis's own list for a fresh project: never run, then a recorded run with its runs, and the suggestions", async (t) => {
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

  // Genesis lists all eight passes, none run, each with its whole-app and deep runs, and the Master pass; the fixture the
  // other tests use is the same list, its sample size aside, since a run's size follows the project's own files.
  const shape = ({ id, title, description, recommend, request, lastRun, unavailable, runs }) =>
    ({ id, title, description, recommend, request, lastRun, unavailable, runs });
  const masterShape = ({ id, title, description, request, lastRun, lastPasses, unavailable, passes, runs }) =>
    ({ id, title, description, request, lastRun, lastPasses, unavailable, passes, runs });
  const listed = await listGenesisPasses({ projectRoot: source });
  assert.equal(listed.unavailable, null, "the Genesis Vibe64 runs runs every pass");
  const { files, lines } = listed.passes[0].runs.find(({ id }) => id === "deep");
  assert.ok(Number.isSafeInteger(files) && files > 0 && Number.isSafeInteger(lines) && lines > 0, "the fresh project's own source");
  const size = `${files.toLocaleString("en-US")} files, ${lines.toLocaleString("en-US")} lines`;
  const resized = (runs) => runs.map((run) => run.files === undefined ? run : { ...run, label: run.label.replace(/\(.*\)$/u, `(${size})`), files, lines });
  assert.deepEqual(listed.passes.map(shape), GENESIS_PASSES.map((pass) => shape({ ...pass, runs: resized(pass.runs) })));
  assert.deepEqual(masterShape(listed.master), masterShape({ ...GENESIS_MASTER_PASS, runs: resized(GENESIS_MASTER_PASS.runs) }));

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
  assert.deepEqual(fresh.passes.map(({ lastRun }) => lastRun), GENESIS_PASSES.map(() => null), "the list shows Never completed for each");
  assert.equal(fresh.recommendation, "", "an app with one commit is too new for any suggestion");

  // A pass's own last step records its run in the project; the list shows when, and the saved record is the
  // commit its since-last run starts from.
  const before = Math.floor(Date.now() / 1000) * 1000;
  await run(path.join(genesisPackageBinDirectory(), "genesis"), ["passes", "done", "quality-pass"], { cwd: source });
  const recorded = await read();
  const { lastRun } = recorded.byId["quality-pass"];
  assert.match(lastRun, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
  assert.ok(Date.parse(lastRun) >= before);
  assert.ok(recorded.passes.every(({ id, lastRun: other }) => id === "quality-pass" || other === null));
  assert.deepEqual(recorded.byId["quality-pass"].runs.map(({ id }) => id), ["whole", "deep"], "an unsaved record has no commit to start from");
  await git(["add", "genesis/passes.json"]);
  await git(["commit", "-q", "-m", "Quality pass"]);
  const recordCommit = (await git(["rev-parse", "HEAD"])).stdout.trim();

  // Thirty commits a day after that run, and three weeks on: every pass is due.
  const changed = new Date(Date.parse(lastRun) + DAY).toISOString();
  for (let index = 0; index < 30; index += 1) {
    await git(["commit", "-q", "--allow-empty", "-m", `Change ${index}`], { GIT_AUTHOR_DATE: changed, GIT_COMMITTER_DATE: changed });
  }
  clock.now = Date.parse(lastRun) + 22 * DAY;
  const due = await read();
  assert.equal(due.byId["quality-pass"].commitsSince, 31, "the record's commit and the thirty after it");
  assert.equal(due.byId.deslop.commitsSince, 32);
  const [whole, since] = due.byId["quality-pass"].runs;
  assert.deepEqual(whole, { id: "whole", label: "Whole app", request: "Quality pass the whole app." });
  assert.ok(recordCommit.startsWith(since.commit), `${since.commit} is the record's commit`);
  assert.deepEqual(since, {
    id: "since-last",
    label: `Since last completed (${since.commit}, 30 commits)`,
    request: `Quality pass: the changes since commit ${since.commit}, judged against the whole app.`,
    commit: since.commit,
    commitsSince: 30
  });
  assert.ok(due.passes.filter(({ id }) => id !== "quality-pass").every(({ runs }) => runs.map(({ id }) => id).join() === "whole,deep"),
    "a pass never completed has only its whole-app and deep runs");
  // Passes that never ran come first, in Genesis's order; Later and Dismiss move on to the next.
  const order = [];
  let current = due.recommendation;
  for (const action of ["snooze", "dismiss", "snooze", "dismiss", "snooze", "dismiss", "snooze", "dismiss"]) {
    order.push(current);
    current = (await passes.changePassRecommendation("session-1", { passId: current, action })).recommendation;
  }
  assert.deepEqual(order, ["deslop", "ui-pass", "identity-pass", "data-pass", "security-pass", "ux-pass", "speed-pass", "quality-pass"],
    "never-run passes first, then the overdue one");
  assert.equal(current, "", "every pass is snoozed or dismissed");
  clock.now += 7 * DAY;
  const later = await read();
  assert.equal(later.recommendation, "deslop", "a snooze ends after a week");
  assert.equal(later.byId["ui-pass"].dismissed, true, "a dismissal lasts until the pass completes again");

  // A Master pass records itself last, with the passes it ran; once committed, it offers the changes since it, sized
  // by the files they touch.
  await run(path.join(genesisPackageBinDirectory(), "genesis"), ["passes", "done", "master-pass", "deslop", "security-pass"], { cwd: source });
  await git(["add", "genesis/passes.json"]);
  await git(["commit", "-q", "-m", "Master pass"]);
  await writeFile(path.join(source, "notes.txt"), "one\ntwo\n");
  await git(["add", "notes.txt"]);
  await git(["commit", "-q", "-m", "A change"]);
  const mastered = await read();
  assert.deepEqual(mastered.master.lastPasses, ["security-pass", "deslop"], "in the Master order");
  const [, masterSince] = mastered.master.runs;
  assert.deepEqual(masterSince, {
    id: "since-last",
    label: `Since last completed (${masterSince.commit}, 1 commit; 1 files, 2 lines)`,
    request: `Master pass: the changes since commit ${masterSince.commit}, judged against the whole app.`,
    commit: masterSince.commit,
    commitsSince: 1,
    selectedRequest: `Master pass ({passes}): the changes since commit ${masterSince.commit}, judged against the whole app.`,
    files: 1,
    lines: 2
  });
});

test("a project pinned to a Genesis that cannot run passes lists them with Genesis's reason, offers no run and suggests none", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-genesis-passes-old-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const source = path.join(root, "sessions", "active", "session-1", "source");
  await mkdir(source, { recursive: true });
  const git = (args) => run("git", args, { cwd: source });
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.name", "Vibe64 Test"]);
  await git(["config", "user.email", "vibe64@example.test"]);
  await initializeGenesisProject({ projectRoot: source });
  // genesis-compiler 1.10.15, as the project installs it: a release from before passes, with its two pass skills.
  const pinned = path.join(source, "node_modules", "genesis-compiler");
  for (const skill of ["genesis-deslop", "genesis-program", "genesis-project", "genesis-ui-pass"]) {
    await mkdir(path.join(pinned, "skills", skill), { recursive: true });
  }
  await writeFile(path.join(pinned, "package.json"), JSON.stringify({ name: "genesis-compiler", version: "1.10.15" }));
  await writeFile(path.join(source, "package.json"), JSON.stringify({ devDependencies: { "genesis-compiler": "1.10.15" } }));
  await writeFile(path.join(source, ".gitignore"), "node_modules/\n", { flag: "a" });
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "A project pinned to an older Genesis"]);
  for (let index = 0; index < 40; index += 1) await git(["commit", "-q", "--allow-empty", "-m", `Change ${index}`]);

  const { version } = JSON.parse(await readFile(path.join(genesisPackageBinDirectory(), "..", "genesis-compiler", "package.json"), "utf8"));
  const reason = `This project's Genesis (genesis-compiler 1.10.15) cannot run passes. Update it to ${version} or later with npm install --save-dev genesis-compiler@${version}, then commit the change.`;
  const passes = createProjectPasses({
    sessionContext: async (sessionId) => ({
      runtime: { stateRoot: path.join(root, "state") },
      session: { sessionId, metadata: { source_path: source, source_path_authority: "managed_session_source", source_kind: "session_clone" } }
    })
  });
  const result = await passes.readSessionPasses("session-1");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.unavailable, reason);
  assert.deepEqual(result.passes.map(({ id }) => id), GENESIS_PASSES.map(({ id }) => id), "every pass is still listed");
  assert.ok(result.passes.every((pass) => pass.unavailable === reason && pass.runs.length === 0));
  assert.ok(result.passes.every(({ commitsSince }) => commitsSince >= 30), "every pass is due by its commits");
  assert.equal(result.recommendation, "", "but none is suggested, since none can run");
  assert.deepEqual([result.master.unavailable, result.master.passes, result.master.runs], [reason, [], []], "nor the Master pass");
});
