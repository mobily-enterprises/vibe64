import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
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

// Three test files use this harness (claudeGoalRestart, claudeGoalRestartControls
// and claudeGoalUsageLimit), which the suite runs at once within the machine's
// test budget. Their ten tests were one file: one after another they took 50
// to 95 s on a busy test host, past the 60 s file budget, while the file's
// process spent three quarters of that waiting on the processes each terminal
// starts. Run at once inside that file, they slowed every step past the usage
// limit tests' 3 s reset window, so within each file they still run in turn.

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
  // While this file exists, the next goal command meets the AI account's limit it names: Claude's own
  // API-error message ends the turn at the usage limit (with its reset time) or out of credit.
  const limitPath = path.join(root, "next-goal-limit.json");
  await writeFile(command, `#!${process.execPath}
const { createInterface } = require('node:readline');
const { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
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
    if (existsSync(${JSON.stringify(limitPath)})) {
      const { text: limitText, resetsInMs, ...apiError } = JSON.parse(readFileSync(${JSON.stringify(limitPath)}, 'utf8'));
      rmSync(${JSON.stringify(limitPath)});
      const answer = { type: 'assistant', uuid: frame.uuid + '-limit', parentUuid: frame.uuid, timestamp: new Date().toISOString(),
        isApiErrorMessage: true, ...apiError, ...(Number.isFinite(resetsInMs) ? { apiErrorParams: { rate_limit_info: {
          status: 'rejected', rateLimitType: 'five_hour', resetsAt: Math.floor((Date.now() + resetsInMs) / 1000) } } } : {}),
        message: { id: frame.uuid + '-limit', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: limitText }] } };
      record(answer);
      emit(answer);
      emit({ type: 'result', subtype: 'success', is_error: true, result: limitText });
      return;
    }
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
    /** While no Claude runs: Claude meets the AI account's limit again, as its history saves it. */
    async appendLimit({ text, resetsInMs, ...apiError }) {
      // Main chat's history: the one whose goal turn met the limit.
      const projects = path.join(root, "config", "projects");
      const histories = [];
      for (const directory of await readdir(projects)) {
        for (const name of await readdir(path.join(projects, directory))) {
          const file = path.join(projects, directory, name);
          if (name.endsWith(".jsonl") && (await readFile(file, "utf8")).includes('"isApiErrorMessage":true')) histories.push(file);
        }
      }
      assert.equal(histories.length, 1, JSON.stringify(histories));
      await writeFile(histories[0], JSON.stringify({ type: "assistant", uuid: `limit-${Date.now()}`,
        timestamp: new Date().toISOString(), isApiErrorMessage: true, ...apiError,
        ...(Number.isFinite(resetsInMs) ? { apiErrorParams: { rate_limit_info: { status: "rejected", rateLimitType: "five_hour",
          resetsAt: Math.floor((Date.now() + resetsInMs) / 1000) } } } : {}),
        message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text }] } }) + "\n", { flag: "a" });
    },
    /**
     * A goal Main chat started, with Claude still working on it, or between turns once its turn finishes, or
     * with its turn ended at once by the AI account's limit (`limit`: the API error Claude saves).
     */
    async startRunningGoal(objective, { finishes = false, limit = null } = {}) {
      if (limit) await writeFile(limitPath, JSON.stringify(limit));
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
      if (limit) {
        await waitFor(async () => !await turnActive(), "the goal's turn ends at the account's limit");
        const limited = await service.readCanonicalAgentGoal("test", options);
        assert.equal(limited.goal.status, "usageLimited", JSON.stringify(limited));
        return limited;
      }
      const read = await service.readCanonicalAgentGoal("test", options);
      assert.equal(read.goal.status, "active");
      if (finishes) await waitFor(async () => !await turnActive(), "the goal's turn ends with its report");
      else assert.equal(await turnActive(), true, "Claude is still working on the goal");
      return read;
    }
  };
}

export { goalHarness };
