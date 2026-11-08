import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { installVibe64ManagedExecutionProvider } from "@local/vibe64-execution/server";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createPageRefreshKind } from "../../packages/vibe64-ai-tasks/src/server/kinds/pageRefresh.js";
import { createPageRefreshTasks } from "../../packages/vibe64-ai-tasks/src/server/pageRefreshTasks.js";
import { checkedSchedule, nextRefreshAt, scheduleText } from "../../packages/vibe64-pages/src/server/pageRefreshSchedule.js";
import { createPagesService } from "../../packages/vibe64-pages/src/server/service.js";

const run = promisify(execFile);
const SLUG = "refresh_project";
const MINUTE = 60_000;
const SET_AT = Date.UTC(2026, 10, 6, 9, 0, 0);
const alice = { id: "alice", name: "Alice" };
const bob = { id: "bob", name: "Bob" };
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };
const base64 = (text) => Buffer.from(text).toString("base64");
const iso = (ms) => new Date(ms).toISOString();

// A command refresh's script, as an AI would write it: it reads the saved project and writes the
// page's new data where $VIBE64_PAGE_DATA says.
const TOTAL_SCRIPT = `import { readFileSync, writeFileSync } from "node:fs";
const numbers = readFileSync("numbers.txt", "utf8").trim().split("\\n").map(Number);
writeFileSync(process.env.VIBE64_PAGE_DATA, JSON.stringify({
  total: numbers.reduce((sum, value) => sum + value, 0), page: process.env.VIBE64_PAGE_ID, home: process.env.HOME
}));
console.log("counted " + numbers.length + " numbers");
`;
const slowScript = (pidFile) => `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => {}, 60_000);
`;

async function until(read, description, timeout = 15_000) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${description}.`);
    await delay(25);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A project whose saved version is a Git commit, with unsaved work beside it, and Vibe64's pages
// service with a clock the test can move. Every project command goes through a recording host
// provider, as on a host that confines them.
async function refreshWorld(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-page-refresh-test-"));
  const projectRuntimeRoot = path.join(root, "state", "projects", SLUG);
  const source = path.join(root, "source");
  await Promise.all([mkdir(projectRuntimeRoot, { recursive: true }), mkdir(source, { recursive: true })]);
  const git = (...args) => run("git", ["-C", source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args]);
  await git("init", "--quiet", "--initial-branch=main");
  await writeFile(path.join(source, "numbers.txt"), "1\n2\n3\n");
  await git("add", "numbers.txt");
  await git("commit", "--quiet", "-m", "Numbers");
  await writeFile(path.join(source, "numbers.txt"), "100\n");
  const commit = (await git("rev-parse", "HEAD")).stdout.trim();

  const requests = [];
  const release = installVibe64ManagedExecutionProvider({
    async runCommand(request, context) {
      requests.push(request);
      return context.runLocal();
    },
    async stopExecution() {
      return { ok: true, scopeEmpty: true };
    }
  });
  const world = { root, source, commit, requests, skew: 0, services: [] };
  const clock = () => Date.now() + world.skew;
  const project = {
    runInProjectContext: (slug, operation) => runWithProjectRequestContext({ slug, projectRuntimeRoot }, operation),
    listProjects: async () => ({ projects: [{ slug: SLUG }] }),
    readCurrentProject: async () => ({ slug: SLUG, repositoryMode: "local_source", sourceRoot: source, repository: { defaultBranch: "main" } })
  };
  world.startPages = () => {
    const pages = createPagesService({ now: () => iso(clock()), clock, project, logger: quietLogger, refreshTaskPollMs: 20 });
    world.services.push(pages);
    world.pages = pages;
    return pages;
  };
  world.startPages();
  t.after(async () => {
    for (const pages of world.services) pages.closeRefreshes();
    release();
    await rm(root, { force: true, recursive: true });
  });
  world.clock = clock;
  world.inProject = (operation) => runWithProjectRequestContext({ slug: SLUG, projectRuntimeRoot }, operation);
  world.pagesRoot = path.join(projectRuntimeRoot, "pages");
  world.refreshFile = (pageId) => path.join(projectRuntimeRoot, "pages", pageId, "refresh.json");
  world.versionFile = (pageId, version, name) => readFile(path.join(projectRuntimeRoot, "pages", pageId, "versions", String(version), name), "utf8");
  world.publish = async (data) => (await world.inProject(() => world.pages.publishPage({
    title: "Totals",
    files: [
      { path: "index.html", base64: base64("<!doctype html><title>Totals</title><p id=\"total\"></p><script src=\"total.js\"></script>") },
      { path: "total.js", base64: base64("fetch(\"data.json\").then((answer) => answer.json()).then(({ total }) => { document.getElementById(\"total\").textContent = total; });") },
      { path: "data.json", base64: base64(JSON.stringify(data)) }
    ],
    by: alice,
    sessionId: "session-1"
  }))).page;
  world.setCommand = async (pageId, script, { every = "30m", by = alice } = {}) => (await world.inProject(() => world.pages.setPageRefresh({
    pageId, kind: "command", every, script: { name: "refresh.mjs", base64: base64(script) }, by, sessionId: "session-1"
  }))).page;
  world.read = async (pageId) => (await world.inProject(() => world.pages.readPage({ pageId }))).page;
  world.runs = async (pageId) => (await world.inProject(() => world.pages.refreshRuns({ pageId }))).runs;
  world.refreshNow = (pageId) => world.inProject(() => world.pages.runRefreshNow({ pageId }));
  // The page once its refresh has ended `count` runs and none is running.
  world.settled = (pageId, count) => until(async () => {
    const page = await world.read(pageId);
    return !page.refresh?.running && (await world.runs(pageId)).length >= count && page;
  }, `refresh run ${count} of ${pageId}`);
  return world;
}

// The AI task window's machinery, as the pages scheduler sees it: the test plays the AI.
function fakeTasks() {
  const calls = [];
  const states = new Map();
  let refusal = null;
  return {
    calls,
    refuse(code) {
      refusal = code ? Object.assign(new Error(`Refused: ${code}`), { code }) : null;
    },
    set(taskId, change) {
      states.set(taskId, { ...states.get(taskId), ...change });
    },
    seam: {
      async start(sessionId, input, vibe64User) {
        if (refusal) throw refusal;
        const id = `task-${calls.filter(([name]) => name === "start").length + 1}`;
        calls.push(["start", sessionId, input, vibe64User]);
        states.set(id, { id, ended: false, done: false, needsYou: false, unavailable: false, message: "", log: [{ at: "09:00", text: "Working" }] });
        return states.get(id);
      },
      async read(_sessionId, taskId) {
        return states.get(taskId) || null;
      },
      async cancel(sessionId, taskId) {
        calls.push(["cancel", sessionId, taskId]);
        states.set(taskId, { ...states.get(taskId), needsYou: false, ended: true });
      },
      async close(sessionId, taskId) {
        calls.push(["close", sessionId, taskId]);
        states.delete(taskId);
      }
    }
  };
}

test("a refresh runs every 15 minutes or more, or daily at a set time, and keeps only its next time", () => {
  assert.deepEqual(checkedSchedule({ every: "30m" }), { every: { minutes: 30 } });
  assert.deepEqual(checkedSchedule({ every: "2h" }), { every: { minutes: 120 } });
  assert.deepEqual(checkedSchedule({ every: "15 minutes" }), { every: { minutes: 15 } });
  assert.deepEqual(checkedSchedule({ daily: "7:30", timeZone: "Australia/Sydney" }), { daily: { time: "07:30", timeZone: "Australia/Sydney" } });
  assert.equal(checkedSchedule({ daily: "07:30" }).daily.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone, "else Vibe64's own time zone");
  for (const [input, message] of [
    [{ every: "10m" }, /at most every 15 minutes/u],
    [{ every: "25h" }, /at least daily/u],
    [{ every: "soon" }, /not a period such as 30m or 2h/u],
    [{ every: "30m", daily: "07:30" }, /either --every/u],
    [{}, /either --every/u],
    [{ daily: "7.30" }, /not a time such as 07:30/u],
    [{ daily: "07:30", timeZone: "Mars/Olympus" }, /not a time zone/u],
    [{ every: "30m", timeZone: "Europe/Rome" }, /--time-zone goes with --daily/u]
  ]) assert.throws(() => checkedSchedule(input), { code: "vibe64_pages_refresh_schedule_invalid", message }, JSON.stringify(input));

  const every = checkedSchedule({ every: "30m" });
  assert.equal(nextRefreshAt(every, { after: SET_AT, anchor: SET_AT }), SET_AT + 30 * MINUTE);
  // Stopped for three hours: the missed turns are one catch-up now, then the half hours from when it was set.
  assert.equal(nextRefreshAt(every, { after: SET_AT + 185 * MINUTE, anchor: SET_AT }), SET_AT + 210 * MINUTE);
  // 09:00 UTC is 20:00 in Sydney, on summer time in November: 07:30 there is 20:30 UTC.
  const sydney = checkedSchedule({ daily: "07:30", timeZone: "Australia/Sydney" });
  assert.equal(iso(nextRefreshAt(sydney, { after: SET_AT, anchor: SET_AT })), "2026-11-06T20:30:00.000Z");
  // Rome leaves summer time on 25 October 2026, and 07:30 there moves an hour in UTC.
  const rome = checkedSchedule({ daily: "07:30", timeZone: "Europe/Rome" });
  assert.equal(iso(nextRefreshAt(rome, { after: Date.UTC(2026, 9, 23, 12), anchor: 0 })), "2026-10-24T05:30:00.000Z");
  assert.equal(iso(nextRefreshAt(rome, { after: Date.UTC(2026, 9, 24, 12), anchor: 0 })), "2026-10-25T06:30:00.000Z");

  assert.deepEqual([15, 60, 90, 120].map((minutes) => scheduleText({ every: { minutes } })),
    ["Every 15 minutes", "Every hour", "Every 90 minutes", "Every 2 hours"]);
  assert.equal(scheduleText(sydney), "Daily at 07:30 (Australia/Sydney)");
});

test("a command refresh runs its script on the project as last saved, through the command gateway, and replaces only the page's data", async (t) => {
  const world = await refreshWorld(t);
  const page = await world.publish({ total: 0 });
  const set = await world.setCommand(page.id, TOTAL_SCRIPT);
  assert.equal(set.refresh.kind, "command");
  assert.equal(set.refresh.schedule, "Every 30 minutes");
  assert.deepEqual(set.refresh.scheduledBy, alice);
  assert.equal(set.refresh.sessionId, "session-1");
  assert.ok(Math.abs(Date.parse(set.refresh.nextAt) - world.clock() - 30 * MINUTE) < 5000, "the first refresh is one period after it was set");
  assert.deepEqual([set.refresh.running, set.refresh.paused, set.refresh.failures, set.refresh.lastRun], [null, false, 0, null]);
  assert.equal(world.requests.length, 0, "nothing runs between refreshes");

  const started = (await world.refreshNow(page.id)).page;
  assert.ok(started.refresh.running?.startedAt, "Refresh now starts at once");
  const refreshed = await world.settled(page.id, 1);
  assert.equal(refreshed.version, 2);
  assert.equal(refreshed.refresh.lastRun.outcome, "refreshed");
  assert.equal(refreshed.refresh.lastRun.message, "Refreshed: version 2.");
  assert.equal(refreshed.refresh.lastRun.log, undefined, "the list leaves the log to the refresh log");
  assert.deepEqual(refreshed.versions.at(-1).createdBy, alice, "the refresh is the person's who set it");
  assert.equal(refreshed.refresh.nextAt, set.refresh.nextAt, "Refresh now leaves the schedule as it was");

  const data = JSON.parse(await world.versionFile(page.id, 2, "data.json"));
  assert.equal(data.total, 6, "the saved numbers, never the unsaved 100");
  assert.equal(data.page, page.id);
  assert.notEqual(data.home, homedir(), "the script gets its own empty home");
  for (const name of ["index.html", "total.js"]) {
    assert.equal(await world.versionFile(page.id, 2, name), await world.versionFile(page.id, 1, name), `${name} stays as it was`);
  }
  assert.equal(await readFile(path.join(world.source, "numbers.txt"), "utf8"), "100\n", "the project's own folder is untouched");
  const [entry] = await world.runs(page.id);
  assert.match(entry.log, new RegExp(`^Saved version ${world.commit.slice(0, 12)} on main\\.\\ncounted 3 numbers`, "u"));
  assert.equal(entry.version, 2);

  const scripts = world.requests.filter((request) => request.command === "node");
  assert.equal(scripts.length, 1, "the script went through the command gateway");
  const [request] = scripts;
  assert.equal(request.actor, "app");
  assert.equal(request.inheritProcessEnv, false);
  assert.equal(request.execution.projectSlug, SLUG);
  assert.deepEqual(request.args.map((arg) => path.basename(arg)), ["refresh.mjs"]);
  assert.notEqual(request.cwd, world.source);
  assert.ok(request.cwd.startsWith(path.join(world.pagesRoot, ".refresh-runs") + path.sep), "the checkout is in the project's own state");
  await assert.rejects(stat(request.cwd), { code: "ENOENT" }, "the throwaway checkout is gone once the run ends");
});

test("a failing refresh keeps the last good version and says why, with its log, and three failures in a row pause it until someone resumes it", async (t) => {
  const world = await refreshWorld(t);
  const page = await world.publish({ total: 0 });
  await world.setCommand(page.id, "import { writeFileSync } from \"node:fs\";\nwriteFileSync(process.env.VIBE64_PAGE_DATA, \"total: 6\");\n");
  await world.refreshNow(page.id);
  const invalid = await world.settled(page.id, 1);
  assert.equal(invalid.version, 1, "data that is not JSON never reaches the page");
  assert.match(invalid.refresh.lastRun.message, /^The refresh script's data\.json is not valid JSON/u);

  const set = await world.setCommand(page.id, "console.log(\"Fetching totals\");\nconsole.error(\"The totals server is down.\");\nprocess.exit(3);\n");
  assert.equal(set.refresh.failures, 0, "setting the refresh again starts it afresh");
  for (let failure = 1; failure <= 3; failure += 1) {
    await world.refreshNow(page.id);
    const failed = await world.settled(page.id, failure + 1);
    assert.equal(failed.version, 1);
    assert.equal(failed.refresh.lastRun.outcome, "failed");
    assert.equal(failed.refresh.lastRun.message, "The refresh script stopped with exit status 3.");
    assert.equal(failed.refresh.failures, failure);
    assert.equal(failed.refresh.paused, failure === 3, `failure ${failure}`);
  }
  const paused = await world.read(page.id);
  assert.equal(paused.refresh.pausedReason, "The last 3 refreshes failed.");
  assert.equal(JSON.parse(await world.versionFile(page.id, 1, "data.json")).total, 0, "the last good version is still the page");
  const runs = await world.runs(page.id);
  assert.equal(runs.length, 4, "the log keeps the runs from before the refresh was set again");
  assert.match(runs[0].log, /Fetching totals\nThe totals server is down\.$/u, "newest first, with what the script printed");
  assert.ok(runs[0].endedAt >= runs[0].startedAt);

  // A paused schedule starts nothing when its time comes.
  world.skew = Date.parse(paused.refresh.nextAt) - Date.now() + MINUTE;
  await world.pages.resumeRefreshes();
  await delay(300);
  assert.equal((await world.runs(page.id)).length, 4);

  const resumed = (await world.inProject(() => world.pages.resumeRefresh({ pageId: page.id, by: bob }))).page;
  assert.deepEqual([resumed.refresh.paused, resumed.refresh.pausedReason, resumed.refresh.failures], [false, "", 0]);
  assert.deepEqual(resumed.refresh.scheduledBy, bob, "a resumed refresh runs as whoever resumed it");
  assert.ok(Date.parse(resumed.refresh.nextAt) > world.clock(), "and starts again from now");
  const pausedByBob = (await world.inProject(() => world.pages.pauseRefresh({ pageId: page.id, by: bob }))).page;
  assert.equal(pausedByBob.refresh.pausedReason, "Paused by Bob.");
});

test("a running refresh can always be cancelled, and archiving a page stops its refreshes until it is restored", async (t) => {
  const world = await refreshWorld(t);
  const page = await world.publish({ total: 0 });
  const pidFile = path.join(world.root, "refresh.pid");
  await world.setCommand(page.id, slowScript(pidFile));
  await world.refreshNow(page.id);
  const pid = Number(await until(() => readFile(pidFile, "utf8").catch(() => ""), "the script to start"));
  await assert.rejects(world.refreshNow(page.id), { code: "vibe64_pages_refresh_running" }, "one refresh of a page at a time");
  await world.inProject(() => world.pages.cancelRefresh({ pageId: page.id }));
  const cancelled = await world.settled(page.id, 1);
  assert.equal(cancelled.refresh.lastRun.outcome, "cancelled");
  assert.equal(cancelled.refresh.lastRun.message, "The refresh was cancelled.");
  assert.equal(cancelled.refresh.failures, 0, "a cancelled refresh is no failure");
  assert.equal(cancelled.version, 1);
  await until(() => !alive(pid), "the cancelled script to stop", 5000);

  await rm(pidFile);
  await world.refreshNow(page.id);
  const second = Number(await until(() => readFile(pidFile, "utf8").catch(() => ""), "the second script to start"));
  const archived = (await world.inProject(() => world.pages.archivePage({ pageId: page.id }))).page;
  assert.equal(archived.archived, true);
  const stopped = await world.settled(page.id, 2);
  assert.equal(stopped.refresh.lastRun.outcome, "cancelled", "archiving cancels the running refresh");
  await until(() => !alive(second), "the archived page's script to stop", 5000);
  await assert.rejects(world.refreshNow(page.id), { code: "vibe64_pages_archived" });
  world.skew = Date.parse(stopped.refresh.nextAt) - Date.now() + MINUTE;
  await world.pages.resumeRefreshes();
  await delay(300);
  assert.equal((await world.runs(page.id)).length, 2, "an archived page's time comes and goes");

  const restored = (await world.inProject(() => world.pages.restorePage({ pageId: page.id }))).page;
  assert.equal(restored.archived, false);
  assert.ok(Date.parse(restored.refresh.nextAt) > world.clock(), "a restored page refreshes again from now");
});

test("a schedule refreshes on time, and turns missed while Vibe64 was stopped come back as one catch-up", async (t) => {
  const world = await refreshWorld(t);
  const page = await world.publish({ total: 0 });
  const set = await world.setCommand(page.id, TOTAL_SCRIPT, { every: "15m" });
  const scheduledAt = Date.parse(set.refresh.nextAt) - 15 * MINUTE;
  const due = Date.parse(set.refresh.nextAt);
  // Vibe64's clock moves to just before the refresh is due, and the server picks its timer up again.
  world.skew = due - Date.now() - 400;
  await world.pages.resumeRefreshes();
  assert.equal((await world.runs(page.id)).length, 0, "not before its time");
  const onTime = await world.settled(page.id, 1);
  const [first] = await world.runs(page.id);
  assert.ok(Date.parse(first.startedAt) >= due && Date.parse(first.startedAt) < due + 5000, `started at ${first.startedAt}, due ${iso(due)}`);
  assert.equal(onTime.version, 2);
  assert.equal(onTime.refresh.nextAt, iso(scheduledAt + 30 * MINUTE), "the next turn keeps the rhythm from when it was set");

  // Vibe64 stops for three hours and starts again: one catch-up, not twelve.
  world.pages.closeRefreshes();
  world.skew += 3 * 60 * MINUTE;
  world.startPages();
  await world.pages.resumeRefreshes();
  const caughtUp = await world.settled(page.id, 2);
  await delay(300);
  assert.equal((await world.runs(page.id)).length, 2);
  assert.equal(caughtUp.version, 3);
  const nextAt = Date.parse((await world.read(page.id)).refresh.nextAt);
  assert.equal((nextAt - scheduledAt) % (15 * MINUTE), 0);
  assert.ok(nextAt > world.clock() && nextAt - world.clock() <= 15 * MINUTE);

  // A script that was running when Vibe64 stopped has ended with it, and so has its checkout.
  world.pages.closeRefreshes();
  await mkdir(path.join(world.pagesRoot, ".refresh-runs", "run-left"), { recursive: true });
  const record = JSON.parse(await readFile(world.refreshFile(page.id), "utf8"));
  await writeFile(world.refreshFile(page.id), JSON.stringify({ ...record, running: { id: "stale-run", kind: "command", startedAt: iso(world.clock()), startVersion: 3 } }));
  world.startPages();
  await world.pages.resumeRefreshes();
  const [stale] = await world.runs(page.id);
  assert.deepEqual([stale.id, stale.outcome, stale.message], ["stale-run", "cancelled", "Vibe64 stopped while this refresh ran."]);
  await assert.rejects(stat(path.join(world.pagesRoot, ".refresh-runs")), { code: "ENOENT" });
  assert.equal((await world.read(page.id)).refresh.running, null);
});

test("stopping the scheduler waits for a start's pickup still under way, which picks up no more projects", async () => {
  const entered = [];
  const held = Promise.withResolvers();
  const project = {
    listProjects: async () => ({ projects: [{ slug: "first" }, { slug: "second" }] }),
    // The first project's pickup is still running when the server stops.
    runInProjectContext: async (slug) => {
      entered.push(slug);
      await held.promise;
    }
  };
  const pages = createPagesService({ now: () => iso(Date.now()), clock: Date.now, project, logger: quietLogger });
  const resuming = pages.resumeRefreshes();
  await until(() => entered.length === 1, "the pickup reaching its first project");
  let closed = false;
  const closing = Promise.resolve(pages.closeRefreshes()).then(() => {
    closed = true;
  });
  await delay(50);
  assert.equal(closed, false, "stopping waits for the project being picked up");
  held.resolve();
  await closing;
  await resuming;
  assert.deepEqual(entered, ["first"]);
});

test("a prompt refresh is an AI task in the session it was set from, refreshed once the page has new data; a lost AI account or session pauses it", async (t) => {
  const world = await refreshWorld(t);
  const tasks = fakeTasks();
  world.pages.setRefreshTasks(tasks.seam);
  const page = await world.publish({ open: 4 });
  const set = (await world.inProject(() => world.pages.setPageRefresh({
    pageId: page.id, kind: "prompt", every: "1h", prompt: "Count the open issues in the tracker", by: alice, sessionId: "session-1"
  }))).page;
  assert.deepEqual([set.refresh.kind, set.refresh.schedule], ["prompt", "Every hour"]);
  const startedTasks = () => tasks.calls.filter(([name]) => name === "start").length;
  const runningTask = async () => (await world.read(page.id)).refresh.running?.taskId;

  await world.refreshNow(page.id);
  await until(runningTask, "the first task");
  const [, sessionId, input, vibe64User] = tasks.calls[0];
  assert.equal(sessionId, "session-1");
  assert.equal(vibe64User, null, "with no host, the task starts with no person, as a task started from the browser here does");
  assert.deepEqual(
    { pageId: input.pageId, prompt: input.prompt, startVersion: input.startVersion, saved: input.saved, data: JSON.parse(input.data) },
    { pageId: page.id, prompt: "Count the open issues in the tracker", startVersion: 1, saved: { branch: "main", commit: world.commit }, data: { open: 4 } }
  );
  // The AI writes the new data with its command, and its task ends done.
  await world.inProject(() => world.pages.updatePageData({ pageId: page.id, data: base64("{\"open\":7}"), by: alice, sessionId: "session-1" }));
  tasks.set("task-1", { ended: true, done: true });
  const refreshed = await world.settled(page.id, 1);
  assert.equal(refreshed.version, 2);
  assert.deepEqual([refreshed.refresh.lastRun.outcome, refreshed.refresh.lastRun.taskId], ["refreshed", "task-1"]);
  assert.deepEqual(tasks.calls.at(-1), ["close", "session-1", "task-1"], "a done refresh's task leaves the session");
  assert.equal((await world.runs(page.id))[0].log, "09:00  Working", "the task's log is the run's");

  // Nobody is there to answer: a task that needs a person is cancelled, and a missing AI account pauses the refresh.
  await world.refreshNow(page.id);
  await until(runningTask, "the second task");
  tasks.set("task-2", { needsYou: true, unavailable: true, message: "Sign in to the AI to continue." });
  const unavailable = await world.settled(page.id, 2);
  assert.deepEqual(tasks.calls.at(-1), ["cancel", "session-1", "task-2"]);
  assert.deepEqual([unavailable.version, unavailable.refresh.lastRun.outcome, unavailable.refresh.lastRun.message], [2, "failed", "Sign in to the AI to continue."]);
  assert.equal(unavailable.refresh.paused, true);
  assert.equal(unavailable.refresh.pausedReason, "The AI account isn't available: Sign in to the AI to continue.");

  await world.inProject(() => world.pages.resumeRefresh({ pageId: page.id, by: alice }));
  await world.refreshNow(page.id);
  await until(runningTask, "the third task");
  tasks.set("task-3", { needsYou: true, message: "Which tracker should I count?" });
  const asked = await world.settled(page.id, 3);
  assert.deepEqual([asked.refresh.lastRun.outcome, asked.refresh.failures, asked.refresh.paused], ["failed", 1, false]);

  // Another AI task open in that session: this turn is skipped, and counts as nothing.
  tasks.refuse("vibe64_ai_task_open");
  await world.refreshNow(page.id);
  const skipped = await world.settled(page.id, 4);
  assert.deepEqual([skipped.refresh.lastRun.outcome, skipped.refresh.failures, skipped.refresh.paused], ["skipped", 1, false]);

  tasks.refuse("vibe64_ai_task_session_closed");
  await world.refreshNow(page.id);
  const closed = await world.settled(page.id, 5);
  assert.equal(closed.refresh.lastRun.outcome, "failed");
  assert.equal(closed.refresh.pausedReason, "Its session is no longer open. Ask the AI in an open session to set this refresh again.");

  tasks.refuse(null);
  await world.inProject(() => world.pages.resumeRefresh({ pageId: page.id, by: alice }));
  await world.refreshNow(page.id);
  const taskId = await until(runningTask, "the task to cancel");
  await world.inProject(() => world.pages.cancelRefresh({ pageId: page.id }));
  const cancelled = await world.settled(page.id, 6);
  assert.deepEqual(tasks.calls.at(-1), ["cancel", "session-1", taskId]);
  assert.deepEqual([cancelled.refresh.lastRun.outcome, cancelled.version], ["cancelled", 2]);

  // Someone cancels it in the session's AI task window: cancelled too, and no failure.
  await world.refreshNow(page.id);
  await until(async () => (await runningTask()) === "task-5", "the task cancelled in its window");
  tasks.set("task-5", { ended: true, cancelled: true });
  const windowCancelled = await world.settled(page.id, 7);
  assert.deepEqual([windowCancelled.refresh.lastRun.outcome, windowCancelled.refresh.failures], ["cancelled", 0]);
  assert.equal(startedTasks(), 5);
});

test("a host decides whom a refresh runs as: a person who can no longer run it pauses it with why, an AI refresh starts as the host's user, and a host that runs no scripts refuses them", async (t) => {
  const world = await refreshWorld(t);
  const tasks = fakeTasks();
  world.pages.setRefreshTasks(tasks.seam);
  const checks = [];
  let blocked = "";
  world.pages.setRefreshHost({
    async runAs(person, slug) {
      checks.push([person.id, slug]);
      return blocked ? { user: null, blocked } : { user: { username: person.id, role: "member" }, blocked: "" };
    },
    scriptRefusal: ""
  });
  const page = await world.publish({ open: 4 });
  await world.inProject(() => world.pages.setPageRefresh({
    pageId: page.id, kind: "prompt", every: "1h", prompt: "Count the open issues", by: alice, sessionId: "session-1"
  }));
  await world.refreshNow(page.id);
  await until(async () => (await world.read(page.id)).refresh.running?.taskId, "the task");
  assert.deepEqual(checks, [["alice", SLUG]], "every run asks first, for the person who set it");
  assert.deepEqual(tasks.calls[0][3], { username: "alice", role: "member" }, "the task starts as the user the host names");
  await world.inProject(() => world.pages.updatePageData({ pageId: page.id, data: base64("{\"open\":5}"), by: alice, sessionId: "session-1" }));
  tasks.set("task-1", { ended: true, done: true });
  assert.equal((await world.settled(page.id, 1)).refresh.lastRun.outcome, "refreshed");

  blocked = "Alice can no longer open this project.";
  await world.refreshNow(page.id);
  const paused = await world.settled(page.id, 2);
  assert.deepEqual([paused.version, paused.refresh.lastRun.outcome, paused.refresh.lastRun.message], [2, "failed", blocked]);
  assert.deepEqual([paused.refresh.paused, paused.refresh.pausedReason], [true, blocked], "a person who lost access pauses it at once");
  assert.equal(tasks.calls.filter(([name]) => name === "start").length, 1, "and nothing runs for them");

  // Resuming makes it the resumer's refresh, checked as them from then on.
  blocked = "";
  await world.inProject(() => world.pages.resumeRefresh({ pageId: page.id, by: bob }));
  await world.refreshNow(page.id);
  await until(async () => (await world.read(page.id)).refresh.running?.taskId, "Bob's task");
  assert.deepEqual(checks.at(-1), ["bob", SLUG]);
  assert.equal(tasks.calls.at(-1)[3].username, "bob");
  await world.inProject(() => world.pages.cancelRefresh({ pageId: page.id }));
  await world.settled(page.id, 3);

  // A host that runs no refresh scripts refuses to set one, and pauses one already set.
  const scripts = await world.publish({ total: 0 });
  await world.setCommand(scripts.id, TOTAL_SCRIPT);
  world.pages.setRefreshHost({ runAs: async () => ({ user: null, blocked: "" }), scriptRefusal: "Refresh scripts don't run here." });
  await assert.rejects(world.setCommand(scripts.id, TOTAL_SCRIPT), {
    code: "vibe64_pages_refresh_scripts_unavailable",
    message: "Refresh scripts don't run here. Set an AI refresh with --prompt instead."
  });
  await world.refreshNow(scripts.id);
  const refused = await world.settled(scripts.id, 1);
  assert.deepEqual([refused.version, refused.refresh.paused], [1, true]);
  assert.equal(refused.refresh.pausedReason, "Refresh scripts don't run here. Ask the AI to refresh this page with AI instead.");
  assert.equal(world.requests.filter((request) => request.command === "node").length, 0, "the script never ran");
});

test("a page refresh task tells the AI what to find and the one command that writes it, starts only in an open session, and passes once the page has new data", async () => {
  let version = 3;
  const kind = createPageRefreshKind({ pages: { readPage: async ({ pageId }) => ({ page: { id: pageId, title: "Open issues", version } }) } });
  assert.deepEqual([kind.id, kind.routing, kind.repository], ["page-refresh", "fix", false]);
  const commit = "a".repeat(40);
  const problem = await kind.problem({}, {
    pageId: "open-issues-abc123", prompt: "Count the open issues", runId: "run-1", startVersion: 3, saved: { branch: "main", commit }, data: "{\"open\":4}"
  });
  assert.equal(problem.title, "Refresh \"Open issues\"");
  const brief = kind.brief(problem);
  assert.match(brief, /Count the open issues/u);
  assert.match(brief, new RegExp(`commit ${commit} on main`, "u"));
  assert.match(brief, /"open":4/u);
  assert.match(brief, /vibe64-helper pages data open-issues-abc123 <that file>/u);
  assert.match(brief, /never ask a question/u);
  const other = await kind.problem({}, { pageId: "open-issues-abc123", prompt: "Count the open issues", runId: "run-2", startVersion: 3 });
  assert.notEqual(other.key, problem.key, "each run is its own task");
  await assert.rejects(kind.problem({}, { pageId: "open-issues-abc123", startVersion: 3 }), { code: "vibe64_ai_task_no_problem" });

  const waiting = await kind.check.run({}, { problem });
  assert.deepEqual([waiting.passed, waiting.retryKey], [false, "3"]);
  assert.match(waiting.diagnostic, /still at version 3/u);
  version = 4;
  assert.equal((await kind.check.run({}, { problem })).passed, true);

  const started = [];
  const aiTasks = {
    async start(sessionId, request) {
      started.push([sessionId, request.kind, request.vibe64User]);
      return { task: { id: "task-1", phase: "needs_you", reason: "ai_unavailable", message: "Sign in", log: [] } };
    },
    async read() {
      throw Object.assign(new Error("Closed"), { code: "vibe64_ai_task_closed" });
    }
  };
  const project = { createRuntimeWithoutSource: async () => ({ listSessionSummaries: async () => [{ sessionId: "session-1" }] }) };
  const refreshTasks = createPageRefreshTasks({ aiTasks, project });
  await assert.rejects(refreshTasks.start("session-2", {}, null), { code: "vibe64_ai_task_session_closed" });
  const member = { username: "alice", role: "member" };
  const state = await refreshTasks.start("session-1", { pageId: "open-issues-abc123" }, member);
  assert.deepEqual(started, [["session-1", "page-refresh", member]], "the task starts as the user the pages host names");
  assert.deepEqual(state, { id: "task-1", ended: false, done: false, needsYou: true, unavailable: true, cancelled: false, message: "Sign in", log: [] });
  assert.equal(await refreshTasks.read("session-1", "task-1"), null, "a closed task reads as gone");
});
