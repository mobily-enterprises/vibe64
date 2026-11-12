import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { createPreviewPreparationFixture } from "../fixtures/previewPreparation.js";
import {
  freezeTerminalNamespaceAdmission,
  listTerminalSessions,
  thawTerminalNamespaceAdmission
} from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import { outputTargetTerminalNamespace } from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import { previewLogPath } from "../../packages/vibe64-terminals/src/server/previewDiagnosticFiles.js";
import { workspaceSetupState, writeWorkspaceSetupState } from "../../packages/vibe64-runtime/src/server/workspaceSetupState.js";

process.env.VIBE64_RUNTIME_NAMESPACE = "preview-preparation-test";
const execFileAsync = promisify(execFile);

async function fixture(t, options = {}) {
  const value = await createPreviewPreparationFixture(options);
  t.after(() => value.close());
  return value;
}

async function eventually(operation, attempts = 100) {
  let failure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) { failure = error; }
    await delay(30);
  }
  throw failure;
}

async function assertServes(terminal, value = "initial") {
  assert.equal(terminal.ok, true, JSON.stringify(terminal));
  await eventually(async () => {
    const response = await fetch(terminal.metadata.targetUrl);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `<h1>Preview works: ${value}</h1>`);
  });
}

function runningPreviews(sessionId) {
  return listTerminalSessions({ namespace: outputTargetTerminalNamespace(sessionId) })
    .filter(({ status }) => status === "running");
}

function runningPreviewIds(sessionId) {
  return runningPreviews(sessionId).map(({ id }) => id);
}

/** Every Preview process the session's launches started, oldest first, from its launch log. */
async function startedPreviewIds(f) {
  const session = await f.runtime.getSessionWithoutSource(f.sessionId);
  const log = await readFile(previewLogPath(session), "utf8");
  return [...new Set(log.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter(({ reason }) => reason === "terminal_started")
    .map(({ terminalSessionId }) => terminalSessionId))];
}

/** What setup had installed when the Preview's server started. */
async function installedFor(terminal) {
  const response = await fetch(new URL("/installed", terminal.metadata.targetUrl));
  return response.text();
}

/**
 * Lets work the setup's completion queued on the Preview finish: a status
 * read waits behind every Preview start, restart and stop queued before it.
 */
async function settlePreview(f) {
  const status = await f.terminals.outputTargetStatus(f.sessionId);
  assert.equal(status.ok, true, JSON.stringify(status));
}

// The ways setup runs again in a session that is already prepared.
const setupReruns = {
  // Update marks preparation required before it changes the source, then starts it unasked.
  async Update(f) {
    const session = await f.runtime.getSessionWithoutSource(f.sessionId);
    await writeWorkspaceSetupState(f.runtime.store, f.sessionId, {
      ...workspaceSetupState(session.workspaceSetup),
      recipeHash: "",
      status: "required"
    });
    const setup = await f.terminals.prepareWorkspaceSetup(f.sessionId);
    await setup.completion;
  },
  // Prepare workspace, Retry and an AI task's check.
  async Retry(f) {
    const setup = await f.terminals.prepareWorkspaceSetup(f.sessionId, { retry: true });
    await setup.completion;
  }
};

test("prepared previews launch while the assistant lock is occupied and concurrent starts leave one running process", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  await f.prepare();
  const envPath = path.join(f.sourceRoot, ".env");
  const before = await lstat(envPath, { bigint: true });
  const release = await f.holdAssistantLock();
  try {
    await assertServes(await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" }));
    const starts = await Promise.all(Array.from({ length: 3 }, () => (
      f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" })
    )));
    assert.equal(starts.every(({ ok }) => ok === true), true);
    await assertServes(starts.at(-1));
    assert.equal(listTerminalSessions({ namespace: outputTargetTerminalNamespace(f.sessionId) })
      .filter(({ status }) => status === "running").length, 1);
    assert.equal(await f.setupRuns(), 1);
    assert.equal((await lstat(envPath, { bigint: true })).ctimeNs, before.ctimeNs);
    assert.equal((await f.runtime.store.runSessionExclusive(f.sessionId, "agent-write-mode", () => null)).acquired, false);
  } finally { await release(); }
});

for (const change of ["environment value", "missing environment file", "Git excludes", "setup recipe"]) {
  test(`changed ${change} waits for the assistant lock, then prepares and serves a real preview`, { timeout: 15_000 }, async (t) => {
    const environmentWaiting = Promise.withResolvers();
    const f = await fixture(t, { logger: { ...console, warn(event, message) {
      if (event?.event === "vibe64.session_lock.contended" && event.operation === "prepare-project-environment") {
        environmentWaiting.resolve();
      } else {
        console.warn(event, message);
      }
    } } });
    await f.prepare();
    const envPath = path.join(f.sourceRoot, ".env");
    const excludePath = path.join(f.sourceRoot, ".git", "info", "exclude");
    if (change === "environment value" || change === "setup recipe") {
      const stack = await readFile(f.stackPath, "utf8");
      await writeFile(f.stackPath, change === "environment value"
        ? stack.replace("`initial`", "`updated`")
        : stack.replace("`setup.cjs`", "`setup.cjs` `new-recipe`"));
    } else if (change === "missing environment file") {
      await rm(envPath);
    } else {
      await writeFile(excludePath, "# user rule\n");
    }
    const before = await readFile(envPath, "utf8").catch(() => null);
    const excludeBefore = await readFile(excludePath, "utf8");
    const release = await f.holdAssistantLock();
    let starting = null;
    try {
      if (change === "setup recipe") {
        // A start that must run setup again refuses at once while the assistant holds the lock.
        const rejected = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
        assert.equal(rejected.ok, false);
        assert.equal(rejected.code, "vibe64_agent_write_mode_busy", JSON.stringify(rejected));
      } else {
        // One that only writes the project environment waits for the holder, up to its ten-second
        // grace for a brief one, and writes nothing meanwhile.
        starting = f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
        const finishedFirst = await Promise.race([environmentWaiting.promise, starting.then((result) => ({ result }))]);
        assert.equal(finishedFirst, undefined,
          `The start finished without waiting for the assistant lock: ${JSON.stringify(finishedFirst?.result)}`);
      }
      assert.equal(await f.setupRuns(), 1);
      assert.equal(await readFile(envPath, "utf8").catch(() => null), before);
      assert.equal(await readFile(excludePath, "utf8"), excludeBefore);
    } finally { await release(); }
    const started = await (starting || f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" }));
    await assertServes(started, change === "environment value" ? "updated" : "initial");
    assert.equal(await f.setupRuns(), change === "setup recipe" ? 2 : 1);
  });
}

test("a Preview's preparation frees the agent-write lock while its command runs, another trigger joins that run, and shutdown admission stays intact", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const holdPath = path.join(f.sourceRoot, "hold-setup");
  await writeFile(holdPath, "hold");
  const starting = f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
  const namespace = outputTargetTerminalNamespace(f.sessionId);
  let joined;
  try {
    await eventually(() => readFile(path.join(f.sourceRoot, "setup-entered.txt")));
    // Only starting the run took the lock, so an Update or a message is not held back by its command.
    const contender = await f.runtime.store.runSessionExclusive(f.sessionId, "agent-write-mode", () => "entered");
    assert.equal(contender.value, "entered", "The preparation held the lock while its command ran.");
    // Another trigger on the same tree (another tab, the preparation after an Update) joins the running one.
    joined = await f.terminals.prepareWorkspaceSetup(f.sessionId);
    assert.notEqual(joined.ok, false, JSON.stringify(joined));
    assert.ok(joined.completion, "The second trigger did not find the running preparation.");
    assert.equal(freezeTerminalNamespaceAdmission(namespace, { owner: "test-renewal" }).code, "terminal_admission_busy");
  } finally { await rm(holdPath, { force: true }); }
  await assertServes(await starting);
  assert.equal((await joined.completion).status, "succeeded");
  assert.equal(freezeTerminalNamespaceAdmission(namespace, { owner: "test-renewal" }).ok, true);
  try {
    const rejected = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app", forceRestart: true });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "terminal_admission_frozen");
  } finally { thawTerminalNamespaceAdmission(namespace, { owner: "test-renewal" }); }
  assert.equal(await f.setupRuns(), 1);
});

test("failed preparation does not launch a preview and leaves the source lock usable", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.sourceRoot, "fail-setup"), "fail");
  const failed = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
  assert.equal(failed.ok, false);
  assert.equal(failed.id, undefined);
  assert.equal((await f.runtime.store.runSessionExclusive(f.sessionId, "agent-write-mode", () => null)).acquired, true);
  await rm(path.join(f.sourceRoot, "fail-setup"));
  const retry = await f.terminals.prepareWorkspaceSetup(f.sessionId, { retry: true });
  await retry.completion;
  await assertServes(await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" }));
});

test("Git alternates repair remains locked while prepared launch inspection stays read-only", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  await f.prepare();
  await execFileAsync("git", ["-C", f.sourceRoot, "add", "."]);
  await execFileAsync("git", ["-C", f.sourceRoot, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "Fixture"]);
  const borrowed = path.join(f.root, "borrowed");
  await execFileAsync("git", ["clone", "--shared", f.sourceRoot, borrowed]);
  const alternatesPath = path.join(f.sourceRoot, ".git", "objects", "info", "alternates");
  // Borrow the clone's object database, which in turn borrows this source.
  // A real object store is needed for the repack, so dissociate the clone first.
  await execFileAsync("git", ["-C", borrowed, "repack", "-a", "-d"]);
  await rm(path.join(borrowed, ".git", "objects", "info", "alternates"));
  await writeFile(alternatesPath, `${path.join(borrowed, ".git", "objects")}\n`);
  const release = await f.holdAssistantLock();
  try {
    const rejected = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
    assert.equal(rejected.code, "vibe64_agent_write_mode_busy", JSON.stringify(rejected));
    assert.match(await readFile(alternatesPath, "utf8"), /borrowed/u);
  } finally { await release(); }
  await assertServes(await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" }));
  await assert.rejects(() => readFile(alternatesPath), { code: "ENOENT" });
});

for (const [rerun, runSetupAgain] of Object.entries(setupReruns)) {
  test(`a running Preview restarts on what setup installed when ${rerun} runs setup again`, { timeout: 30_000 }, async (t) => {
    const f = await fixture(t);
    await f.prepare();
    const first = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
    await assertServes(first);
    assert.equal(await installedFor(first), "install 1");
    await runSetupAgain(f);
    assert.equal(await f.setupRuns(), 2);
    // A restart closes the old process before it starts the new one, so for a
    // moment no Preview runs at all; only one running process that is not the
    // first counts.
    const restarted = await eventually(async () => {
      const running = runningPreviews(f.sessionId);
      assert.equal(running.length, 1, `Expected one running Preview, found ${running.length}.`);
      assert.notEqual(running[0].id, first.id, "The Preview still runs the process started before setup ran again.");
      return running[0];
    }, 300);
    await assertServes(restarted);
    assert.equal(await installedFor(restarted), "install 2");
    await settlePreview(f);
    assert.deepEqual(runningPreviewIds(f.sessionId), [restarted.id]);
    assert.deepEqual(await startedPreviewIds(f), [first.id, restarted.id], "Setup restarted the Preview more than once.");
  });
}

test("a Preview whose own start ran setup is not restarted again after it", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const started = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
  await assertServes(started);
  await settlePreview(f);
  assert.deepEqual(runningPreviewIds(f.sessionId), [started.id]);
  assert.deepEqual(await startedPreviewIds(f), [started.id]);
  assert.equal(await installedFor(started), "install 1");
  assert.equal(await f.setupRuns(), 1);
});

test("a stopped Preview stays stopped when setup runs again", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  await f.prepare();
  const started = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
  await assertServes(started);
  const stopped = await f.terminals.stopOutputTargetTerminal(f.sessionId, started.id);
  assert.notEqual(stopped.ok, false, JSON.stringify(stopped));
  await setupReruns.Retry(f);
  assert.equal(await f.setupRuns(), 2);
  await settlePreview(f);
  assert.deepEqual(runningPreviewIds(f.sessionId), []);
  assert.deepEqual(await startedPreviewIds(f), [started.id]);
});

test("a failed setup run leaves the running Preview as it is", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  await f.prepare();
  const started = await f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app" });
  await assertServes(started);
  await writeFile(path.join(f.sourceRoot, "fail-setup"), "fail");
  await setupReruns.Retry(f);
  assert.equal((await f.runtime.getSessionWithoutSource(f.sessionId)).workspaceSetup.status, "failed");
  await settlePreview(f);
  assert.deepEqual(runningPreviewIds(f.sessionId), [started.id]);
  assert.deepEqual(await startedPreviewIds(f), [started.id]);
  assert.equal(await installedFor(started), "install 1");
});
