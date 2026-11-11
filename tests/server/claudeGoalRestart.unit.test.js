import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { defineVibe64AssistantSelection } from "../../packages/vibe64-runtime/src/shared/assistantSelection.js";
import { createService as createTerminalService } from "../../packages/vibe64-terminals/src/server/service.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/terminalActions.js";
import { ACTION_READ_CONVERSATION_CONTEXT, createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { terminalsServiceCollaborators } from "../fixtures/terminalsServiceCollaborators.js";
import { createSessionsService as createSessionService, withMainChatOperations } from "./vibe64SessionsTestHelpers.js";

// The server configures the Studio project context before any feature reads it.
configureStudioProjectContext({ env: process.env });

const PROJECT_SLUG = "claude-goal-restart";

/**
 * One Main chat session served by the real terminals service, manager, Claude
 * owner, managed process transport and session store. Only Claude's inference
 * is synthetic: a /goal command keeps its turn working until the process stops,
 * as a goal Claude is still working on does; any other message completes.
 */
async function goalHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-goal-restart-"));
  let service;
  t.after(async () => {
    try { await service?.close(); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  const workdir = path.join(root, "sessions", "active", "test", "source");
  await mkdir(workdir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "Initial");
  const selection = { engineId: "claude", agentId: "claude", modelId: "sonnet", modelProviderId: "anthropic",
    variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  await store.createSession({ sessionId: "test", runtimeKind: "genesis", metadata: { source_kind: "session_clone",
    source_path_authority: "managed_session_source", source_path: workdir, assistant_selection: JSON.stringify(selection),
    label: "Goal restart" } });
  const runtime = { stateRoot: path.join(root, "runtime"), projectContextRoot: root, store,
    getSession: id => store.readSession(id), getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    listSessions: async () => [await store.readSession("test")],
    renderPrompt: async (_id, input) => ({ prompt: `Context: ${input.request}` }) };
  const project = {
    readCurrentProject: async () => ({ path: root, projectContextRoot: root, sourceRoot: workdir, slug: PROJECT_SLUG }),
    createRuntime: () => runtime,
    createRuntimeWithoutSource(options) { return this.createRuntime(options); },
    createSessionStore: () => store,
    currentServiceDataRoot: () => path.join(root, "service-data"),
    currentTargetRoot: () => root,
    listProjects: async () => ({ ok: true, projects: [{ slug: PROJECT_SLUG, runtime: { open: true } }] }),
    projectInspectionEnvironment: async () => ({ VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" }),
    projectExecutionEnvironment: async () => ({}),
    readEnv: async () => ({ ok: true, records: [] }),
    runInProjectContext: async (_context, operation) => operation(),
    saveEnvUserValues: async () => ({ ok: true })
  };
  const command = path.join(root, "claude.cjs");
  const tracePath = path.join(root, "claude-trace.jsonl");
  // While this file exists, the next Claude that starts exits at once, as one can on a loaded server.
  const failStartPath = path.join(root, "fail-next-start");
  await writeFile(command, `#!${process.execPath}
const { createInterface } = require('node:readline');
const { appendFileSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
const trace = value => appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify(value) + '\\n');
trace({ args, pid: process.pid });
if (args[0] === 'auth') {
  emit({ loggedIn: true, authMethod: 'claude.ai', email: 'owner@example.test' });
  process.exit(0);
}
if (existsSync(${JSON.stringify(failStartPath)})) {
  rmSync(${JSON.stringify(failStartPath)});
  process.stderr.write('Claude could not start\\n');
  process.exit(1);
}
const flag = args.includes('--resume') ? '--resume' : '--session-id';
const conversationId = args[args.indexOf(flag) + 1];
const directory = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/gu, '-'));
mkdirSync(directory, { recursive: true });
const record = value => appendFileSync(path.join(directory, conversationId + '.jsonl'), JSON.stringify(value) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  trace({ frame });
  if (frame.type === 'control_request') {
    if (frame.request.subtype === 'initialize') emit({ type: 'system', subtype: 'init', capabilities: ['interrupt_send_now_v1'] });
    emit({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id,
      response: { models: [{ value: 'sonnet', supportedEffortLevels: ['high'] }] } } });
    if (frame.request.subtype === 'interrupt') emit({ type: 'result', subtype: 'success', terminal_reason: 'aborted_streaming', result: '' });
    return;
  }
  if (frame.type !== 'user') return;
  const text = frame.message.content;
  if (text.startsWith('/goal ')) {
    emit(frame);
    const condition = text.slice(6);
    const clear = condition === 'clear';
    const marker = { type: 'attachment', uuid: frame.uuid + '-goal', timestamp: new Date().toISOString(), attachment: {
      type: 'goal_status', condition: clear ? 'All checks pass' : condition, sentinel: true, met: clear } };
    record(marker);
    record({ ...frame, parentUuid: marker.uuid });
    if (clear) {
      emit({ type: 'result', subtype: 'success', local_command: 'goal', user_message_uuid: frame.uuid, result: '' });
      return;
    }
    // A goal whose turn ends with a progress report waits between turns, its checker still armed.
    const report = () => {
      const answer = { type: 'assistant', uuid: frame.uuid + '-report', parentUuid: frame.uuid, timestamp: new Date().toISOString(),
        message: { id: frame.uuid + '-report', role: 'assistant', content: [{ type: 'text', text: 'Progress report' }] } };
      record(answer);
      emit(answer);
      emit({ type: 'result', subtype: 'success', result: 'Progress report' });
    };
    // Later in a long turn Claude compacts its context, as its history saves it:
    // the boundary, a summary timestamped before it, and the goal re-attached
    // with a sentinel that no /goal command follows.
    if (condition.includes('compacted')) {
      setTimeout(() => {
        const boundary = { type: 'system', subtype: 'compact_boundary', uuid: frame.uuid + '-boundary', parentUuid: null,
          logicalParentUuid: frame.uuid, timestamp: new Date().toISOString(), compactMetadata: { trigger: 'auto' } };
        record(boundary);
        record({ type: 'user', uuid: frame.uuid + '-summary', parentUuid: boundary.uuid, isCompactSummary: true,
          isVisibleInTranscriptOnly: true, timestamp: new Date(Date.now() - 300).toISOString(),
          message: { role: 'user', content: 'This session is being continued from a previous conversation.' } });
        record({ ...marker, uuid: frame.uuid + '-reattached', parentUuid: frame.uuid + '-summary', timestamp: new Date(Date.now() + 50).toISOString() });
        report();
      }, 1000);
      return;
    }
    if (condition.startsWith('Between turns')) {
      report();
      return;
    }
    emit({ type: 'stream_event', event: { type: 'message_start', message: { id: frame.uuid + '-reply' } } });
    emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Working on the goal' } } });
    return;
  }
  record(frame);
  emit(frame);
  emit({ type: 'result', subtype: 'success', result: 'Done' });
});
`, { mode: 0o700 });
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
  const actor = { username: "goal-owner", uid: 71, role: "owner" };
  const warnings = [];
  const createService = () => {
    const value = createTerminalService(terminalsServiceCollaborators({ project, actions,
      logger: { info() {}, warn: record => warnings.push(record), error: record => warnings.push(record) },
      env: { CLAUDE_CONFIG_DIR: path.join(root, "config"), VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agent-runtime"),
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments"), VIBE64_CLAUDE_COMMAND: command,
        VIBE64_SYSTEM_ROOT: path.join(root, "system"), VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" },
      codexTerminalController: { codexToolHomeRequired: false, codexAppServerProviderOptions: { systemRoot: path.join(root, "system") } }
    }));
    value.configureAssistantRuntime({
      resolveAssistantUser: async user => user?.username === actor.username ? actor : user,
      createActionContext: () => ({ channel: "internal", surface: "app", resolveAssistantUser: async () => actor }),
      authorizeProjectMessage: async user => user?.username === actor.username ? actor : user
    });
    return value;
  };
  service = createService();
  registerVibe64ActionContext(actions, {
    projectContext: { currentPracticeProjectScope: () => null, projectsRoot: path.dirname(root), async readWorkspaceProject() {
      return { project: { projectRoot: root, projectRuntimeRoot: runtime.stateRoot } };
    } },
    resolveUser: async ({ context }) => typeof context.resolveAssistantUser === "function" ? context.resolveAssistantUser() : actor,
    authorizeProject: async () => {}
  });
  const terminals = new Proxy({}, { get: (_target, key) => service[key] });
  const sessions = createSessionService({ actions, project, terminals });
  actions.register({ contributorId: "test.claude-goal-restart", domain: "vibe64",
    actions: [...createSessionActions({ sessions: withMainChatOperations(sessions) }), ...createTerminalActions({ terminals })]
      .map(definition => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
  const goalProject = (await actions.execute({ actionId: ACTION_READ_CONVERSATION_CONTEXT,
    input: { projectSlug: PROJECT_SLUG, sessionId: "test" }, context: { channel: "internal", surface: "app" } })).project;
  const options = { runtime, vibe64User: actor };
  const trace = async () => {
    try {
      const text = await readFile(tracePath, "utf8");
      return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map(JSON.parse);
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  // Each /goal command that starts or continues a goal (not the clear before a Resume).
  const goalCommands = async () => (await trace()).filter(row => row.frame?.type === "user" &&
    /^\/goal (?!clear$)/u.test(row.frame.message.content)).length;
  const intent = async () => JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent || "null");
  const turnActive = async () => (await service.agentSessionState("test", { ...options, session: await store.readSession("test") })).turn?.active === true;
  async function waitFor(condition, message, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await condition();
      if (value) return value;
      assert.ok(Date.now() < deadline, typeof message === "function" ? await message() : message);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  return {
    get service() { return service; },
    options, store, warnings, actor, goalCommands, intent, turnActive, waitFor, trace,
    failNextStart: () => writeFile(failStartPath, ""),
    inProject: operation => runWithProjectRequestContext({ ...goalProject, vibe64User: null }, operation),
    async restart({ graceful = true } = {}) {
      if (graceful) await service.close();
      service = createService();
      return service;
    },
    /** A goal Main chat started, with Claude still working on it, or between turns once its turn finishes. */
    async startRunningGoal(objective, { finishes = false } = {}) {
      const sent = await service.sendAgentMessage("test", { message: "Work", messageId: "before-goal" }, options);
      assert.equal(sent.delivered, true, JSON.stringify(sent));
      await waitFor(async () => !await turnActive(), "the first message completes");
      // A routed Senior goal, as Main chat sets one.
      const routed = { ...defineVibe64AssistantSelection(selection), selectionSource: "explicit" };
      await createAssistantRoutingStore({ systemRoot: path.join(root, "system") }).write({
        owner: { senior: routed, junior: routed }, nonOwner: {} }, 0);
      await store.writeMetadataValue("test", "assistant_routing", JSON.stringify({ mode: "senior", deslop: true }));
      const empty = await service.readCanonicalAgentGoal("test", options);
      assert.equal(empty.goal, null);
      // The finished turn's follow-up work can still hold the write briefly.
      const started = await waitFor(async () => {
        const result = await service.updateCanonicalAgentGoal("test", { ...options, action: "set", objective,
          expectedSegmentId: empty.target.segmentId, messageId: "set-goal" });
        return result?.code === "vibe64_agent_write_mode_busy" ? null : result;
      }, "the goal starts once the first turn's follow-up work ends");
      assert.equal(started.status, "accepted", JSON.stringify(started));
      await waitFor(async () => (await intent())?.pending === null, "the goal's attachment is reconciled");
      const read = await service.readCanonicalAgentGoal("test", options);
      assert.equal(read.goal.status, "active");
      if (finishes) await waitFor(async () => !await turnActive(), "the goal's turn ends with its report");
      else assert.equal(await turnActive(), true, "Claude is still working on the goal");
      return read;
    }
  };
}

test("a Claude goal that was working when the server stopped continues by itself, once, after restart", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    await h.restart();
    const recovery = await h.service.recoverActiveGoals();
    assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
    assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify(recovery));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "active");
    assert.equal(read.error, undefined);
    assert.equal(await h.turnActive(), true, "Claude works on the goal again");
    // The same server's recovery never continues it twice.
    await h.service.recoverActiveGoals();
    assert.equal(await h.goalCommands(), commandsBefore + 1);
  });
});

for (const [name, objective] of [["between turns", "Between turns: all checks pass"],
  ["between turns after Claude compacted its context", "Between turns, compacted: all checks pass"]])
test(`a Claude goal ${name} when the server stopped continues by itself, once, after restart`, { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal(objective, { finishes: true });
    const commandsBefore = await h.goalCommands();
    await h.restart();
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    const evidence = async () => JSON.stringify({ recovery, intent: await h.intent(), warnings: h.warnings });
    assert.equal(recovery.ok, true, await evidence());
    assert.equal(recovery.results.at(-1).resumed, true, await evidence());
    assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    await h.service.recoverActiveGoals();
    assert.equal(await h.goalCommands(), commandsBefore + 1);
  });
});

test("a Claude goal survives a server that died without closing and continues once on the next server", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    const dead = h.service;
    await h.restart({ graceful: false });
    try {
      const recovery = await h.service.recoverActiveGoals();
      assert.equal(recovery.ok, true, JSON.stringify({ recovery, warnings: h.warnings }));
      assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify(recovery));
      assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    } finally {
      await dead.close().catch(() => {});
    }
  });
});

test("a goal whose continuation fails right after a restart is tried again and continues once", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    const commandsBefore = await h.goalCommands();
    await h.restart();
    await h.failNextStart();
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [200] });
    assert.equal(recovery.ok, false, JSON.stringify(recovery));
    assert.match((await h.intent()).error, /Vibe64 tries again shortly\.$/u);
    await h.waitFor(async () => await h.goalCommands() === commandsBefore + 1, "the next attempt continues the goal");
    await h.waitFor(() => h.turnActive(), "Claude works on the goal again");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "active");
    assert.equal(read.error, undefined, "the earlier failure no longer shows");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "nothing is sent twice");
  });
});

test("Resume of a paused Claude goal after a restart answers within seconds", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    const running = await h.startRunningGoal("All checks pass");
    const paused = await h.service.updateCanonicalAgentGoal("test", { ...h.options, action: "pause",
      expectedSegmentId: running.target.segmentId, expectedGoalId: running.goal.id });
    assert.equal(paused.status, "paused", JSON.stringify(paused));
    await h.restart();
    const recovery = await h.service.recoverActiveGoals();
    assert.equal(recovery.results.at(-1).skipped, true, "a paused goal stays paused");
    const read = await h.service.readCanonicalAgentGoal("test", h.options);
    assert.equal(read.goal.status, "paused");
    const commandsBefore = await h.goalCommands();
    const startedAt = Date.now();
    const resumed = await h.service.updateCanonicalAgentGoal("test", { ...h.options, action: "resume",
      expectedSegmentId: read.target.segmentId, expectedGoalId: read.goal.id, messageId: "resume-after-restart" });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(resumed.status, "accepted", JSON.stringify(resumed));
    assert.ok(elapsedMs < 10_000, `Resume answered in ${elapsedMs} ms`);
    assert.equal(await h.goalCommands(), commandsBefore + 1);
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "active");
  });
});

test("after Stop a restart leaves a Claude goal alone, and the person's next message makes restarts continue it again, once", { timeout: 60_000 }, async t => {
  const h = await goalHarness(t);
  await h.inProject(async () => {
    await h.startRunningGoal("All checks pass");
    await h.service.interruptAgentTurn("test", {}, h.options);
    await h.waitFor(async () => !await h.turnActive(), "Stop ends the goal's turn");
    assert.equal((await h.intent()).active, false, "Stop ends the goal's continuation");
    assert.equal((await h.service.readCanonicalAgentGoal("test", h.options)).goal.status, "active", "Claude's goal stays active");
    const commandsBefore = await h.goalCommands();
    await h.restart();
    const afterStop = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(afterStop.results.at(-1).skipped, true, JSON.stringify(afterStop));
    assert.equal(await h.goalCommands(), commandsBefore, "a restart after Stop sends nothing");
    // The person's next message continues the goal and enrolls its continuation again.
    const sent = await h.waitFor(async () => {
      const result = await h.service.sendAgentMessage("test", { message: "Keep going", messageId: "after-stop" }, h.options);
      return result?.code === "vibe64_agent_write_mode_busy" ? null : result;
    }, "the message is admitted once the restart's own work ends");
    assert.equal(sent.delivered, true, JSON.stringify(sent));
    assert.equal((await h.intent()).active, true, "the message enrolls the goal's continuation again");
    assert.equal(await h.goalCommands(), commandsBefore, "the message itself sends no goal command");
    await h.waitFor(async () => !await h.turnActive(), "the message's turn ends");
    await h.restart();
    const recovery = await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(recovery.results.at(-1).resumed, true, JSON.stringify({ recovery, intent: await h.intent(), warnings: h.warnings }));
    assert.equal(await h.goalCommands(), commandsBefore + 1, "the goal continues with exactly one native command");
    await h.service.recoverActiveGoals({ retryDelaysMs: [] });
    assert.equal(await h.goalCommands(), commandsBefore + 1, "it is never sent twice");
  });
});
