import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { readProjectRuntimeOpenState } from "@local/vibe64-core/server/projectRuntimeOpenState";
import { VIBE64_SERVICE_DATA_ROOT_ENV } from "@local/vibe64-core/server/studioRoots";
import { installVibe64ManagedExecutionProvider } from "../../packages/vibe64-execution/src/server/managedExecution.js";
import { Vibe64TerminalsFeature } from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsFeature.js";
import { Vibe64SessionRuntime } from "../../packages/vibe64-runtime/src/server/runtime.js";
import process from "node:process";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";

// The server configures the Studio project context before any feature reads it.
configureStudioProjectContext({ env: process.env });

const claudeSelection = JSON.stringify({ engineId: "claude", agentId: "claude", modelId: "sonnet", modelProviderId: "anthropic",
  variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` });

// One open-able project with one active session, its terminals feature
// started; onCreateRuntime runs on every project runtime lookup. Cleanup runs
// in reverse, so the feature shuts down before its files are removed.
async function startDormancyFixture(t, { onCreateRuntime = () => {} } = {}) {
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-dormancy-exp-"));
  cleanups.push(() => rm(root, { force: true, recursive: true }));
  const runtimeRoot = path.join(root, "runtime"), targetRoot = path.join(root, "project");
  await mkdir(targetRoot, { recursive: true });
  const commands = [];
  cleanups.push(installVibe64ManagedExecutionProvider({
    async stopExecution() { return { ok: true }; },
    async runCommand(request) {
      commands.push({ label: request.execution?.label || "", command: request.command, args: request.args });
      return { ok: false, code: "test_no_commands", error: "no commands in this experiment" };
    }
  }));
  let runtime = null;
  const project = {
    createSessionStore() { return {}; },
    async createRuntime() {
      onCreateRuntime();
      runtime ||= new Vibe64SessionRuntime({
        projectContextRoot: targetRoot,
        projectRuntimeRoot: runtimeRoot,
        promptEnvironment: process.env,
        inspectSourceByDefault: false
      });
      return runtime;
    },
    createRuntimeWithoutSource(options) { return this.createRuntime(options); },
    currentProjectRuntimeRoot() { return runtimeRoot; }, currentTargetRoot() { return targetRoot; },
    async listPracticeProjectSlugs() { return []; },
    async listProjects() { return { ok: true, projects: [{ slug: "inspector", runtime: { open: true } }] }; },
    async readCurrentProject() { return { slug: "inspector" }; },
    async readEnv() { return { env: { records: [] }, ok: true }; },
    runInProjectContext(_slug, operation) { return operation(); },
    async saveEnvUserValues() { return { ok: true }; }
  };
  const created = await project.createRuntime();
  const session = await created.store.createSession({ sessionId: "2026-10-24_02-33-27", runtimeKind: "genesis",
    metadata: { assistant_selection: claudeSelection } });
  const sourcePath = path.join(root, "session-sources", "sessions", "active", session.sessionId, "source");
  await mkdir(sourcePath, { recursive: true });
  await created.store.writeMetadataValue(session.sessionId, "source_path", sourcePath);
  await created.store.writeMetadataValue(session.sessionId, "source_path_authority", "managed_session_source");
  await created.store.writeMetadataValue(session.sessionId, "source_kind", "session_clone");
  await created.store.writeStatus(session.sessionId, "active");
  const published = [];
  const feature = Vibe64TerminalsFeature;
  const dependencies = {
    actionCatalogue: createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) }), env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") },
    events: { async publish(event) { published.push(event); return event; } },
    fastify: { addHook() {}, get() {} }, http: { router: { register() {} } },
    logger: { error() {}, info() {}, warn(...args) { published.push({ warn: args }); } },
    project, uploads: { readSingleMultipartFile() {} }
  };
  const outputs = await feature.setup(dependencies, { profile: "test" });
  cleanups.push(() => feature.shutdown(dependencies, { outputs, profile: "test" }));
  return { commands, created, outputs, published, runtimeRoot, session };
}

// The 5-minute dormancy sweep lists each open project's sessions to decide
// whether its runtime is idle. That listing reads session records only, with no
// repository check or work inspection for a session nobody views, and closing
// an idle runtime runs no Git work.
test("the dormancy sweep reads session records only and closes an idle runtime without repository work", async (t) => {
  const { commands, created, outputs, published, session } = await startDormancyFixture(t);
  await outputs.terminals.openProjectRuntime();
  assert.deepEqual((await created.listSessions({ statusGroup: "open" })).map((listed) => [listed.sessionId, listed.sourceReady]),
    [[session.sessionId, true]], "the sweep sees a session with source, as a real workspace does");
  published.length = 0;
  const fresh = await outputs.terminals.closeDormantProjectRuntimes({});
  assert.deepEqual(fresh.results.map((result) => [result.reason, result.dormant]), [["not-dormant", false]]);
  assert.deepEqual(commands, [], "a sweep of an active runtime runs nothing");
  assert.deepEqual(published, []);
  const idle = await outputs.terminals.closeDormantProjectRuntimes({ nowMs: Date.now() + 31 * 60 * 1000 });
  assert.deepEqual(idle.results.map((result) => [result.reason, result.dormant, result.ok]), [["idle-timeout", true, true]]);
  assert.deepEqual(commands, [], "closing an idle runtime checks and inspects nothing");
  assert.deepEqual(published.map((event) => event.realtime?.payload?.action), ["runtime-closed"]);
});

// 2026-11-05: idle cleanup closed a project while its owner was typing a
// message, because typing was not recorded as activity.
test("typing keeps a project open and idle cleanup closes it once typing stops", async (t) => {
  const { outputs, runtimeRoot } = await startDormancyFixture(t);
  await outputs.terminals.openProjectRuntime();
  await sleep(1200);
  const noted = await outputs.terminals.noteProjectRuntimeActivity();
  assert.equal(noted.runtime.open, true);
  const typing = await outputs.terminals.closeDormantProjectRuntimes({ idleAfterMs: 1000 });
  assert.deepEqual(typing.results.map((result) => [result.reason, result.dormant]), [["not-dormant", false]],
    "the open was 1.2 s ago but the typing just now");
  const idle = await outputs.terminals.closeDormantProjectRuntimes({ idleAfterMs: 1000, nowMs: Date.now() + 1100 });
  assert.deepEqual(idle.results.map((result) => [result.reason, result.dormant, result.ok]), [["idle-timeout", true, true]]);
  const afterClose = await outputs.terminals.noteProjectRuntimeActivity();
  assert.equal(afterClose.runtime.open, false, "typing never reopens a closed project");
  assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).open, false);
});

// An open used to be refused while idle cleanup was closing the project, or
// to land in the middle of the Close and be undone by it.
test("opening a project during idle cleanup waits for its Close and opens the project again", async (t) => {
  let openDuringClose = null;
  let pendingOpen = null;
  const fixture = await startDormancyFixture(t, {
    onCreateRuntime() {
      if (!openDuringClose) return;
      pendingOpen = openDuringClose();
      openDuringClose = null;
    }
  });
  const { outputs, published, runtimeRoot } = fixture;
  await outputs.terminals.openProjectRuntime();
  published.length = 0;
  openDuringClose = () => outputs.terminals.openProjectRuntime({ reason: "project-open" });
  const idle = await outputs.terminals.closeDormantProjectRuntimes({ nowMs: Date.now() + 31 * 60 * 1000 });
  assert.ok(pendingOpen, "the open was requested while idle cleanup ran");
  assert.deepEqual(idle.results.map((result) => [result.reason, result.dormant, result.ok]), [["idle-timeout", true, true]]);
  const reopened = await pendingOpen;
  assert.equal(reopened.ok, true);
  assert.equal(reopened.runtime.open, true);
  assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).open, true);
  assert.deepEqual(published.map((event) => event.realtime?.payload?.action).filter(Boolean),
    ["runtime-closed", "runtime-opened"]);
});
