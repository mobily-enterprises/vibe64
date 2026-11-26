import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createPreviewPreparationFixture } from "../fixtures/previewPreparation.js";
import { listTerminalSessions } from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import { outputTargetTerminalNamespace } from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import { previewLogPath } from "../../packages/vibe64-terminals/src/server/previewDiagnosticFiles.js";

process.env.VIBE64_RUNTIME_NAMESPACE = "preview-preparation-test";

// On 25 Nov 2026 a workspace's setup finished and restarted its Preview, whose Prepare step began the database
// migration; an agent's `preview restart`, asked for while that restart waited for the launch lock, then replaced the
// new run 1.7 s into its migration. The migration's change was made but never recorded, and every later start failed
// on its leftover lock. A restart is satisfied by a run started after it was asked for, never cuts a Prepare step
// (it waits for it, at most as long as a Preview start may take), and Stop stays immediate.

async function fixture(t, options = {}) {
  const value = await createPreviewPreparationFixture({ outputPrepare: true, ...options });
  t.after(() => value.close());
  await value.prepare();
  return value;
}

async function eventually(operation, attempts = 200) {
  let failure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) { failure = error; }
    await delay(25);
  }
  throw failure;
}

/** The outcome of `promise` if it settles within `ms`, else "pending". */
function settledWithin(promise, ms) {
  return Promise.race([promise, delay(ms, "pending")]);
}

async function assertServes(terminal) {
  assert.equal(terminal.ok, true, JSON.stringify(terminal));
  await eventually(async () => {
    const response = await fetch(terminal.metadata.targetUrl);
    assert.equal(response.status, 200);
  });
}

function runningPreviewIds(sessionId) {
  return listTerminalSessions({ namespace: outputTargetTerminalNamespace(sessionId) })
    .filter(({ status }) => status === "running")
    .map(({ id }) => id);
}

/** Every Preview process the session's launches started, oldest first, from its launch log. */
async function startedPreviewIds(f) {
  const session = await f.runtime.getSessionWithoutSource(f.sessionId);
  const log = await readFile(previewLogPath(session), "utf8");
  return [...new Set(log.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter(({ reason }) => reason === "terminal_started")
    .map(({ terminalSessionId }) => terminalSessionId))];
}

const start = (f) => f.terminals.startOutputTargetTerminal(f.sessionId, { outputTargetId: "app", requestedBy: "http" });
const restart = (f) => f.terminals.startOutputTargetTerminal(f.sessionId, {
  restartPreview: true,
  requestedBy: "agent-preview-command"
});

/** Starts the Preview with its Prepare step held, and returns its run once the step began. */
async function startHeldInPrepare(f) {
  await writeFile(path.join(f.sourceRoot, "hold-migrate"), "hold");
  const first = await start(f);
  assert.equal(first.ok, true, JSON.stringify(first));
  await eventually(async () => assert.equal(await f.migrateLog(), "begun\n"));
  return first;
}

test("two restarts asked for together give one new run, and a restart asked for after it started replaces it", {
  timeout: 30_000
}, async (t) => {
  const f = await fixture(t);
  const first = await start(f);
  await assertServes(first);
  // The second waits for the launch lock while the first replaces the run, then finds the run the first started.
  const [one, two] = await Promise.all([restart(f), restart(f)]);
  assert.equal(one.ok, true, JSON.stringify(one));
  assert.notEqual(one.id, first.id);
  assert.equal(two.id, one.id, "The second restart replaced the run the first had just started.");
  await assertServes(one);
  const later = await restart(f);
  assert.notEqual(later.id, one.id, "A restart asked for after the run started did not restart it.");
  await assertServes(later);
  assert.deepEqual(runningPreviewIds(f.sessionId), [later.id]);
  assert.equal(await f.migrateLog(), "begun\ndone\n".repeat(3));
});

test("a restart during the Prepare step waits for it to finish, then replaces the run", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const first = await startHeldInPrepare(f);
  const restarting = restart(f);
  const status = await eventually(async () => {
    const read = await f.terminals.outputTargetStatus(f.sessionId);
    assert.equal(read.preview.reason, "restart_waiting_for_prepare", JSON.stringify(read.preview));
    return read;
  });
  assert.match(status.preview.message, /Waiting for the database step to finish/u);
  assert.equal(await settledWithin(restarting, 300), "pending");
  assert.deepEqual(runningPreviewIds(f.sessionId), [first.id]);
  await rm(path.join(f.sourceRoot, "hold-migrate"));
  const restarted = await restarting;
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  assert.notEqual(restarted.id, first.id);
  assert.equal(restarted.waitedForPrepare, true);
  assert.equal(restarted.prepareCut, undefined);
  await assertServes(restarted);
  // The first run's migration finished before its run was replaced.
  assert.equal(await f.migrateLog(), "begun\ndone\nbegun\ndone\n");
});

test("Stop during the Prepare step is immediate and says the step was cut; a restart waiting for it ends stopped", {
  timeout: 30_000
}, async (t) => {
  const f = await fixture(t);
  const first = await startHeldInPrepare(f);
  const restarting = restart(f);
  await eventually(async () => {
    const read = await f.terminals.outputTargetStatus(f.sessionId);
    assert.equal(read.preview.reason, "restart_waiting_for_prepare", JSON.stringify(read.preview));
  });
  // The step is still held: Stop does not wait for it.
  const stopped = await settledWithin(f.terminals.stopOutputTargetTerminal(f.sessionId, first.id), 5_000);
  assert.notEqual(stopped, "pending", "Stop waited for the Prepare step.");
  assert.notEqual(stopped.ok, false, JSON.stringify(stopped));
  const restarted = await settledWithin(restarting, 5_000);
  assert.equal(restarted.ok, false, JSON.stringify(restarted));
  assert.equal(restarted.code, "vibe64_preview_stopped");
  const status = await f.terminals.outputTargetStatus(f.sessionId);
  assert.equal(status.preview.state, "stopped");
  assert.equal(status.preview.reason, "prepare_cut");
  assert.match(status.preview.message, /stopped during its database step/u);
  assert.deepEqual(runningPreviewIds(f.sessionId), []);
  assert.equal(await f.migrateLog(), "begun\n");
});

test("a restart is never refused for a Prepare step: one that outlasts the wait is replaced, and logged as cut", {
  timeout: 30_000
}, async (t) => {
  const warnings = [];
  const f = await fixture(t, {
    previewPrepareWaitMs: 300,
    terminalsLogger: { ...silentLogger, warn: (fields) => warnings.push(fields) }
  });
  const first = await startHeldInPrepare(f);
  const restarted = await restart(f);
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  assert.notEqual(restarted.id, first.id);
  assert.equal(restarted.waitedForPrepare, true);
  assert.equal(restarted.prepareCut, true);
  const replaced = warnings.filter(({ event }) => event === "vibe64.preview.run_replaced");
  assert.equal(replaced.length, 1, JSON.stringify(warnings));
  assert.equal(replaced[0].replaced.terminalSessionId, first.id);
  assert.equal(replaced[0].replaced.prepareCut, true);
  assert.equal(replaced[0].request.requestedBy, "agent-preview-command");
  assert.equal(replaced[0].request.restartPreview, true);
  assert.equal(restarted.metadata.launchRequestId, replaced[0].request.id);
  await rm(path.join(f.sourceRoot, "hold-migrate"));
  await assertServes(restarted);
  assert.equal(await f.migrateLog(), "begun\nbegun\ndone\n");
});

test("the restart after workspace setup, then an agent's restart, give one new run whose Prepare step completes", {
  timeout: 30_000
}, async (t) => {
  const f = await fixture(t);
  const first = await start(f);
  await assertServes(first);
  await writeFile(path.join(f.sourceRoot, "hold-migrate"), "hold");
  const setup = await f.terminals.prepareWorkspaceSetup(f.sessionId, { retry: true });
  await setup.completion;
  // Setup's own restart is queued for the launch lock by now; the agent asks for its restart meanwhile.
  const agent = await restart(f);
  assert.equal(agent.ok, true, JSON.stringify(agent));
  assert.notEqual(agent.id, first.id);
  await eventually(async () => assert.equal(await f.migrateLog(), "begun\ndone\nbegun\n"));
  assert.deepEqual(runningPreviewIds(f.sessionId), [agent.id]);
  await rm(path.join(f.sourceRoot, "hold-migrate"));
  await assertServes(agent);
  assert.deepEqual(runningPreviewIds(f.sessionId), [agent.id]);
  // The agent's restart kept setup's run: a run it replaced, its migration begun or not, would be a third start.
  assert.deepEqual(await startedPreviewIds(f), [first.id, agent.id], "The agent's restart replaced setup's new run.");
  assert.equal(await f.migrateLog(), "begun\ndone\nbegun\ndone\n");
});
