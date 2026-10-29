import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { VIBE64_SERVICE_DATA_ROOT_ENV } from "@local/vibe64-core/server/studioRoots";
import { installVibe64ManagedExecutionProvider } from "../../packages/vibe64-execution/src/server/managedExecution.js";
import { createVibe64TerminalsFeature } from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsProvider.js";
import { Vibe64SessionRuntime } from "../../packages/vibe64-runtime/src/server/runtime.js";

const claudeSelection = JSON.stringify({ engineId: "claude", agentId: "claude", modelId: "sonnet", modelProviderId: "anthropic",
  variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` });

// The 5-minute dormancy sweep lists each open project's sessions to decide
// whether its runtime is idle. Monitoring suspected that listing of starting a
// repository check and a work inspection for a session nobody viewed: it must
// read session records only, and closing an idle runtime must run no Git work.
test("the dormancy sweep reads session records only and closes an idle runtime without repository work", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-dormancy-exp-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const runtimeRoot = path.join(root, "runtime"), targetRoot = path.join(root, "project");
  await mkdir(targetRoot, { recursive: true });
  const commands = [];
  t.after(installVibe64ManagedExecutionProvider({
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
      runtime ||= new Vibe64SessionRuntime({ projectContextRoot: targetRoot, projectRuntimeRoot: runtimeRoot, inspectSourceByDefault: false });
      return runtime;
    },
    currentProjectRuntimeRoot() { return runtimeRoot; }, currentTargetRoot() { return targetRoot; },
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
  const feature = createVibe64TerminalsFeature();
  const dependencies = {
    actionCatalogue: createActionCatalogue(), env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") },
    events: { async publish(event) { published.push(event); return event; } },
    fastify: { addHook() {}, get() {} }, http: { router: { register() {} } },
    logger: { error() {}, info() {}, warn(...args) { published.push({ warn: args }); } },
    project, uploads: { readSingleMultipartFile() {} }
  };
  const outputs = await feature.setup(dependencies, { profile: "test" });
  try {
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
  } finally { await feature.shutdown(dependencies, { outputs, profile: "test" }); }
});
