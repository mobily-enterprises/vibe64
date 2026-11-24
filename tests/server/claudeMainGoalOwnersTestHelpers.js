import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { claudeHistoryPath, readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { defineVibe64AssistantSelection } from "../../packages/vibe64-runtime/src/shared/assistantSelection.js";
import { ACTION_READ_CONVERSATION_CONTEXT, createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { mainConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { createService as createTerminalService } from "../../packages/vibe64-terminals/src/server/service.js";
import { LIMIT_RESET_MARGIN_MS } from "../../packages/vibe64-terminals/src/server/serviceGoalLimitReset.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/terminalActions.js";
import { TURN_RESUME_LOOP_WINDOW_MS } from "../../packages/vibe64-terminals/src/server/turnInterruptions.js";
import { terminalsServiceCollaborators } from "../fixtures/terminalsServiceCollaborators.js";
import { fixture } from "./claudeStreamJsonTestHelpers.js";
import { createSessionsService as createSessionService, sendFollowed, withMainChatOperations } from "./vibe64SessionsTestHelpers.js";

// The server configures the Studio project context before any feature reads it.
configureStudioProjectContext({ env: process.env });

// Run as one test in one process, an idle goal's phases took 27 s at about a third of a CPU and reached the test's
// 60 s limit on busier test hosts. Four files now run its parts at once within the machine's test budget:
// claudeMainGoalOwnersActive, claudeMainGoalOwnersIdleRestart, claudeMainGoalOwnersIdleSelfControls and
// claudeMainGoalOwnersIdleBlockOnGoal (.unit.test.js). Each part builds the state its phases read itself.
const PHASES = new Set(["send-and-raw-goal", "stopped-first-goals", "restart-refusals", "self-controls", "block-on-goal"]);

/**
 * A goal intent as a restart long after its last resume reads it: each resume it carries is moved back past the
 * crash-loop window, so the next restart resumes the goal again (claudeGoalRestart.unit.test.js covers the window).
 */
function longAfterLastResume(intent) {
  const earlier = at => at ? new Date(Date.parse(at) - TURN_RESUME_LOOP_WINDOW_MS).toISOString() : at;
  return { ...intent, interruptions: intent.interruptions?.map(entry => ({ ...entry, resumedAt: earlier(entry.resumedAt) })) };
}

/**
 * One Main chat served by the real terminals service, manager, Claude owner, managed process transport and session
 * store, whose goal is set, restarted, recovered, paused and controlled by Claude itself. Only Claude's inference is
 * synthetic. Every part runs, in order:
 *
 * - the setup, the empty goal read, the browser's authority and timing records, and an invalid goal refused before
 *   dispatch;
 * - "send-and-raw-goal": the first send's delivery milestones, its duplicate and a Stop that keeps the process, then
 *   a raw goal set, paused (ending that process) and cancelled;
 * - the routing store and, for an active goal, a turn still working;
 * - "stopped-first-goals" (idle goal): Stop during a first goal's preparation and before its dispatch;
 * - the canonical goal, held at its acknowledgement and attachment, its junior pin, read view, native identity and
 *   duplicate, and a restart after which it reads active;
 * - "restart-refusals" (idle goal): restarts at a native blocker, a failed evaluation, a usage limit, out of credit,
 *   a denied actor, a crash before the goal's attachment (resumed once), an unrelated attachment and a command that
 *   never arrived;
 * - for an idle goal, a recovery that times out on the session lock; restart recovery queued behind workspace
 *   preparation and its one Resume, whose tools get fresh authority; for an active goal, a Stop that prevents a
 *   queued Resume; a reader's Pause through the pinned target, kept across a restart;
 * - "self-controls" (idle goal): Resume, a Pause by action ID refused, prose, Claude's own Pause, a restart while
 *   paused, Claude's Resume in chat, a second Resume refused, Claude's own Block, a restart keeping the blocker, a
 *   slow send while blocked, and Resume;
 * - "block-on-goal" (idle goal): Resume, Cancel, a goal that blocks in its own turn with fresh request authority,
 *   and the Cancel a main AI change makes.
 *
 * A part that leaves a phase out leaves out no state the later phases read: they count Claude's inputs from their
 * own start, the canonical goal starts its own Claude process, and the restart refusals end by restoring the goal's
 * history and resumability.
 */
async function mainGoalOwnersScenario(t, { busyGoal, phases }) {
  const runs = new Set(phases);
  for (const phase of runs) assert.ok(PHASES.has(phase), `Unknown Main goal phase ${phase}`);
  let removeFixture;
  const f = await fixture({ after(callback) { removeFixture = callback; } });
  let service;
  t.after(async () => {
    try { await service?.close(); }
    finally { await removeFixture(); }
  });
  let recoveryLockContended;
  const store = createVibe64SessionStore({ projectContextRoot: f.root, projectRuntimeRoot: path.join(f.root, "runtime"),
    logger: { warn(record) {
      if (record.operation === "resume-agent-goal" && ["vibe64.session_lock.contended", "vibe64.session_lock.rejected"].includes(record.event)) {
        recoveryLockContended?.resolve(record);
      }
    } } });
  await store.createSession({ sessionId: "test", runtimeKind: "genesis",
    metadata: { ...f.context.session.metadata, label: "BoundClaude" } });
  const runtime = { ...f.context.runtime, stateRoot: path.join(f.root, "runtime"),
    projectContextRoot: f.root, store, getSession: id => store.readSession(id), getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    listSessions: async () => [await store.readSession("test")] };
  const project = {
    ...f.providerOptions.project,
    createRuntime: () => runtime,
    createRuntimeWithoutSource(options) { return this.createRuntime(options); },
    createSessionStore: () => store,
    currentServiceDataRoot: () => path.join(f.root, "service-data"),
    currentTargetRoot: () => f.root,
    listProjects: async () => ({ ok: true, projects: [{ slug: "claude-main-fixture", runtime: { open: true } }] }),
    readCurrentProject: async () => ({ path: f.root, projectContextRoot: f.root,
      sourceRoot: f.context.session.metadata.source_path, slug: "claude-main-fixture" }),
    projectInspectionEnvironment: async () => ({ VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" }),
    projectExecutionEnvironment: async () => ({}),
    readEnv: async () => ({ ok: true, records: [] }),
    runInProjectContext: async (_context, operation) => operation(),
    saveEnvUserValues: async () => ({ ok: true })
  };
  // Only native inference is synthetic. The service, manager, provider, shared
  // runtime, managed process transport and original session store are real.
  const command = path.join(f.root, "service-claude.cjs");
  const tracePath = path.join(f.root, "service-claude-trace.jsonl");
  const goalAcknowledgementGate = path.join(f.root, "hold-goal-acknowledgement");
  const goalAttachmentGate = path.join(f.root, "hold-goal-attachment");
  const recoveryToolProbe = path.join(f.root, "probe-recovery-tool-authority");
  await writeFile(command, `#!${process.execPath}
const { createInterface } = require('node:readline');
const { appendFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
const trace = value => appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify(value) + '\\n');
trace({ args, pid: process.pid });
if (args[0] === 'auth') {
  emit({ loggedIn: true, authMethod: 'claude.ai', email: 'owner@example.test' });
  process.exit(0);
}
const flag = args.includes('--resume') ? '--resume' : '--session-id';
const conversationId = args[args.indexOf(flag) + 1];
const directory = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/gu, '-'));
mkdirSync(directory, { recursive: true });
const record = value => appendFileSync(path.join(directory, conversationId + '.jsonl'), JSON.stringify(value) + '\\n');
const pauseTool = (name, id, input) => {
  emit({ type: 'assistant', uuid: id + '-message', message: { content: [
    { type: 'tool_use', id, name: 'mcp__application__' + name, input }
  ] } });
  emit({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'application',
    message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: input, _meta: { 'claudecode/toolUseId': id } } }
  } });
};
createInterface({ input: process.stdin }).on('line', async line => {
  const frame = JSON.parse(line);
  trace({ frame, pid: process.pid });
  if (frame.type === 'control_request') {
    if (frame.request.subtype === 'initialize') emit({ type: 'system', subtype: 'init', capabilities: ['interrupt_send_now_v1'] });
    emit({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id,
      response: { models: [{ value: 'sonnet', supportedEffortLevels: ['high'] }] } } });
    if (frame.request.subtype === 'interrupt') emit({ type: 'result', subtype: 'success', terminal_reason: 'aborted_streaming', result: '' });
    return;
  }
  if (frame.type === 'control_response' && ['self-pause-contract', 'self-resume-contract', 'self-resume-again-contract', 'self-block-contract', 'self-block-goal-contract'].includes(frame.response.request_id)) {
    const action = frame.response.request_id.startsWith('self-block') ? 'block' : frame.response.request_id.startsWith('self-resume') ? 'resume' : 'pause';
    pauseTool('assistant_action_execute', frame.response.request_id.replace('-contract', '-execute'), { actionId: 'vibe64.terminals.main-goal.' + action, version: 1,
      input: action === 'block' ? { reason: 'The human must supply the missing approval code.' } : {} });
    return;
  }
  if (frame.type === 'control_response' && frame.response.request_id.endsWith('-execute')) {
    const receipt = { type: 'user', message: { content: [{ type: 'tool_result',
      tool_use_id: frame.response.request_id, content: JSON.stringify(frame.response.response) }] } };
    record(receipt);
    emit(receipt);
    // After Resume, Claude ends its reply; the goal continues in its own turn.
    if (frame.response.request_id.startsWith('self-resume')) emit({ type: 'result', subtype: 'success', result: 'Resuming the goal.' });
    return;
  }
  if (frame.type !== 'user') return;
  record(frame);
  const text = frame.message.content;
  if (text.startsWith('/goal ')) {
    while (existsSync(${JSON.stringify(goalAcknowledgementGate)})) await new Promise(resolve => setTimeout(resolve, 5));
    emit(frame);
    while (existsSync(${JSON.stringify(goalAttachmentGate)})) await new Promise(resolve => setTimeout(resolve, 5));
    const condition = text.slice(6);
    const marker = { type: 'attachment', uuid: frame.uuid + '-goal', timestamp: new Date().toISOString(), attachment: {
      type: 'goal_status', condition: condition === 'clear' ? 'Tests pass' : condition, sentinel: true, met: condition === 'clear'
    } };
    record(marker);
    record({ ...frame, parentUuid: marker.uuid });
    if (condition === 'clear') emit({ type: 'result', subtype: 'success', local_command: 'goal', user_message_uuid: frame.uuid, result: '' });
    if (condition === 'BLOCK_ON_GOAL') setTimeout(() => pauseTool('assistant_action_contract', 'self-block-goal-contract', { actionId: 'vibe64.terminals.main-goal.block', version: 1 }), 50);
    if (condition !== 'clear' && existsSync(${JSON.stringify(recoveryToolProbe)})) setTimeout(() => pauseTool('assistant_action_contract', 'recovery-authority-contract', { actionId: 'vibe64.terminals.main-goal.pause', version: 1 }), 50);
    return;
  }
  emit(frame);
  if (/(Pause|Block|Resume|Resume again) through the admitted application tool/u.test(text)) {
    const action = text.includes('Block through') ? 'block' : text.includes('Resume') ? 'resume' : 'pause';
    const id = text.includes('Resume again') ? 'self-resume-again' : 'self-' + action;
    pauseTool('assistant_action_contract', id + '-contract', { actionId: 'vibe64.terminals.main-goal.' + action, version: 1 });
    return;
  }
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: frame.uuid + '-reply' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Service progress' } } });
});
`, { mode: 0o700 });
  const publications = [];
  const streamed = Promise.withResolvers();
  const deliveryDiagnostics = [];
  const firstResponseTiming = Promise.withResolvers();
  const recordDeliveryDiagnostic = record => {
    deliveryDiagnostics.push(record);
    if (record.event === "vibe64.agent_message.delivery_timing" && record.stage === "first-response") firstResponseTiming.resolve();
  };
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
  const actor = { username: "service-owner", uid: 73, role: "owner" };
  let recoveredActorReads = 0;
  const createService = () => {
    const value = createTerminalService(terminalsServiceCollaborators({ project, actions,
    logger: { info: recordDeliveryDiagnostic, warn: recordDeliveryDiagnostic, error: recordDeliveryDiagnostic },
    env: { ...f.providerOptions.env, VIBE64_CLAUDE_COMMAND: command, JSKIT_REALTIME_DEBUG: "1",
      VIBE64_SYSTEM_ROOT: path.join(f.root, "system"), VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" },
    codexTerminalController: { codexToolHomeRequired: false,
      codexAppServerProviderOptions: { systemRoot: path.join(f.root, "system") } },
    publishSessionChanged: { agentTerminal: async (_sessionId, event) => {
      publications.push(event);
      if (event.reason === "assistant-stream" && event.payload.conversationStream.messages.some(message => message.text === "Service progress")) streamed.resolve();
    } }
  }));
    value.configureAssistantRuntime({
      resolveAssistantUser: async user => user?.username === actor.username ? actor : user,
      createActionContext(user) {
        assert.equal(user.username, actor.username);
        return { channel: "internal", surface: "app", resolveAssistantUser: async () => {
          recoveredActorReads++; return actor;
        } };
      },
      authorizeProjectMessage: async user => user?.username === actor.username ? actor : user
    });
    return value;
  };
  service = createService();
  const options = { runtime, vibe64User: actor };
  const originalGoalRequest = { headers: { cookie: "fixture-session" } };
  let requireGoalRequest = false;
  registerVibe64ActionContext(actions, {
    projectContext: { currentPracticeProjectScope: () => null, projectsRoot: path.dirname(f.root), async readWorkspaceProject() {
      return { project: { projectRoot: f.root, projectRuntimeRoot: runtime.stateRoot } };
    } },
    resolveUser: async ({ request, context }) => typeof context.resolveAssistantUser === "function"
      ? context.resolveAssistantUser()
      : !requireGoalRequest || request?.headers?.cookie === originalGoalRequest.headers.cookie ? actor : null,
    authorizeProject: async ({ slug }) => assert.equal(slug, "claude-main-fixture")
  });
  // Daemon recreation below must leave the browser facade using the current owner. `slowProjectOpenMs` makes the
  // next Main chat send's project open take that long, as after a restart on a loaded machine.
  let slowProjectOpenMs = 0;
  const terminals = new Proxy({}, { get: (_target, key) => {
    if (key !== "openProjectRuntime" || !slowProjectOpenMs) return service[key];
    const ms = slowProjectOpenMs;
    slowProjectOpenMs = 0;
    return async (...args) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return service.openProjectRuntime(...args);
    };
  } });
  const sessions = createSessionService({ actions, project, terminals });
  actions.register({ contributorId: "test.claude-main-goals", domain: "vibe64",
    actions: [...createSessionActions({ sessions: withMainChatOperations(sessions) }), ...createTerminalActions({ terminals })]
      .map(definition => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
  // Its sends are followed to their delivery, as the page follows them: on a loaded machine a send can outlast the
  // editor's two-second answer and answer as held.
  const goalFacade = await sessions.browserConversations.open({
    id: mainConversationId({ projectSlug: "claude-main-fixture", sessionId: "test" }), context: { channel: "internal", surface: "app", requestMeta: { request: originalGoalRequest } }
  });
  const goalProject = (await actions.execute({ actionId: ACTION_READ_CONVERSATION_CONTEXT,
    input: { projectSlug: "claude-main-fixture", sessionId: "test" }, context: { channel: "internal", surface: "app" } })).project;
  // Keep raw service calls in the same project namespace; each command still supplies its own actor.
  await runWithProjectRequestContext({ ...goalProject, vibe64User: null }, async () => {
    const emptyGoalRead = await goalFacade.readGoal();
    assert.equal(emptyGoalRead.status, "available");
    assert.equal(emptyGoalRead.goal, null);
    const state = await service.agentSessionState("test", { ...options, session: await store.readSession("test") });
    assert.ok(state.thread.id);
    const browserAuthority = { sessionId: "test", projectSlug: "claude-main-fixture", actorId: String(actor.uid),
      requestContext: { channel: "internal", surface: "app" } };
    const browser = await service.openBrowserConversation("test", { ...options, browserAuthority });
    const releaseBrowser = await browser.subscribe(() => {});
    await browser.read();
    releaseBrowser();
    await assert.rejects(service.openBrowserConversation("test", { ...options,
      browserAuthority: { ...browserAuthority, actorId: "another-person" } }), { code: "conversation_forbidden" });
    const browserTimings = deliveryDiagnostics.filter(event => event.event === "vibe64.conversation.browser_timing");
    assert.ok(browserTimings.some(event => event.phase === "session-read" && event.completed));
    assert.ok(browserTimings.some(event => event.phase === "native-open" && event.completed));
    for (const operation of ["open", "read"]) {
      assert.ok(browserTimings.some(event => event.phase === "authorization" && event.operation === operation && event.allowed));
    }
    assert.ok(browserTimings.filter(event => event.phase === "authorization" && event.operation === "subscribe")
      .every(event => !event.allowed || event.durationMs >= 100), "Healthy streaming checks do not log per token");
    assert.ok(browserTimings.some(event => event.phase === "authorization" && event.allowed === false));
    assert.ok(browserTimings.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0));
    assert.equal(JSON.stringify(browserTimings).includes(actor.username), false);
    assert.equal(emptyGoalRead.target.segmentId, `claude:${state.thread.id}`,
      "the empty-goal read returns its selected identity without a second target lookup");
    // The fake Claude appends whole lines while this reads them, and a reader can
    // see part of a long one: only lines that end in a newline are complete.
    const trace = async () => {
      try {
        const text = await readFile(tracePath, "utf8");
        return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map(JSON.parse);
      } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    };
    assert.equal((await trace()).some(row => row.args?.includes("--print")), false, "inspection does not start native inference");
    await assert.rejects(goalFacade.updateGoal({ action: "set", objective: "clear", messageId: "invalid-goal-condition",
      expectedSegmentId: emptyGoalRead.target.segmentId }), {
      code: "conversation_invalid_goal", statusCode: 400, delivery: "not-sent"
    });
    assert.notEqual(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent || "null")?.active, true,
      "pre-dispatch validation cannot leave an active continuation intent behind");
    assert.equal((await trace()).some(row => row.frame?.type === "user"), false);
    async function startGoal(input, representation) {
      const before = (await trace()).filter(row => row.frame?.type === "user").length;
      const deadline = Date.now() + 5000;
      let result;
      for (;;) {
        result = representation?.canonical
          ? await goalFacade.updateGoal(input)
          : await service.updateAgentGoal("test", { ...options, ...input });
        if (result?.ok !== false || result.code !== "vibe64_agent_write_mode_busy" || result.retryable !== true) break;
        assert.equal((await trace()).filter(row => row.frame?.type === "user").length, before,
          "the original write-mode busy response rejects before native goal admission");
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return result;
    }
    let rows;
    if (runs.has("send-and-raw-goal")) {
      const request = { message: "Work", messageId: "service-main" };
      const sent = await service.sendAgentMessage("test", request, options);
      assert.equal(sent.delivered, true);
      assert.equal(sent.thread.id, state.thread.id);
      await streamed.promise;
      await firstResponseTiming.promise;
      const timingStages = deliveryDiagnostics.filter(event => event.event === "vibe64.agent_message.delivery_timing" &&
        event.messageId === request.messageId).map(event => event.stage);
      const milestones = ["received", "preparation-started", "provider-started", "runtime-ready",
        "dispatch-started", "native-acknowledged", "receipt-persisted", "accepted"];
      // Finer marks may appear between these milestones; the milestones keep their order.
      assert.deepEqual(timingStages.filter(stage => milestones.includes(stage)).slice(0, 8), milestones);
      if (timingStages.includes("authorized")) assert.ok(timingStages.includes("git-actor"), "Preparation marks its Git actor on the delivery observer.");
      assert.equal(timingStages.filter(stage => stage === "first-response").length, 1);
      assert.ok(deliveryDiagnostics.some(event => event.event === "vibe64.agent_message.lock_acquired" && event.messageId === request.messageId));
      assert.ok(deliveryDiagnostics.some(event => event.event === "vibe64.agent_message.delivery_finished" && event.delivered));
      assert.equal(JSON.stringify(deliveryDiagnostics.filter(event => event.event?.startsWith("vibe64.agent_message."))).includes('"Work"'), false);
      assert.ok(publications.some(event => event.reason === "claude-stream-message-delivered"));
      assert.equal((await service.agentSessionState("test", { ...options, session: await store.readSession("test") })).turn.active, true);
      assert.equal((await service.sendAgentMessage("test", request, options)).duplicate, true);
      rows = await store.readConversationLog("test");
      assert.deepEqual(rows.flatMap(turn => turn.messages).filter(message => message.role === "user").map(message => message.messageId), ["service-main"]);
      assert.equal(rows[0].metadata.actorId, actor.username);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, 1, "duplicate delivery never invokes native Send again");
      assert.equal((await trace()).filter(row => row.args?.includes("--print")).length, 1);
      const stopped = await service.interruptAgentTurn("test", {}, options);
      assert.equal(stopped.interrupted, true);
      // Stop ends Claude's turn with its interrupt, as Esc does in Claude Code, and keeps the managed
      // native process, so background agents and commands run on.
      const nativePid = (await trace()).find(row => row.args?.includes("--print")).pid;
      assert.doesNotThrow(() => process.kill(nativePid, 0), "Stop keeps the managed native process");
      assert.equal((await trace()).filter(row => row.pid === nativePid && row.frame?.request?.subtype === "interrupt").length, 1,
        "Stop is one interrupt of the running process");
      assert.equal((await service.agentSessionState("test", { ...options, session: await store.readSession("test") })).turn.active, false);
      assert.notEqual(JSON.parse((await store.readSession("test")).metadata[`claude_conversation_${state.thread.id}`]).executionId, "",
        "the conversation keeps the process the Stop kept");

      const started = await startGoal({ action: "set", objective: "Tests pass" });
      assert.equal(started.ok, true, JSON.stringify(started));
      assert.equal(started.threadId, state.thread.id);
      assert.equal(started.goal.status, "active");
      const goal = { threadId: started.threadId, createdAt: started.goal.createdAt, objective: started.goal.objective };
      await assert.rejects(service.updateAgentGoal("test", { ...options, ...goal, action: "pause", createdAt: -1 }), /goal changed/u);
      const paused = await service.updateAgentGoal("test", { ...options, ...goal, action: "pause" });
      assert.equal(paused.goal.status, "paused");
      assert.equal((await service.readAgentGoal("test", options)).goal.status, "paused");
      // The Stop kept the process, so the goal ran on it. Pause ends the goal's turn, stands Claude's own
      // goal checker down on that still-running process, so "Goal cleared" sits beside the Pause, and
      // then stops the process.
      assert.deepEqual((await trace()).filter(row => row.frame?.type === "user").map(row => [row.pid, row.frame.message.content]),
        [[nativePid, "Context: Work"], [nativePid, "/goal Tests pass"], [nativePid, "/goal clear"]]);
      assert.equal((await trace()).filter(row => row.args?.includes("--print")).length, 1);
      assert.throws(() => process.kill(nativePid, 0), { code: "ESRCH" }, "Pause returns only after the managed native process has exited");
      rows = await store.readConversationLog("test");
      assert.equal(rows.flatMap(turn => turn.messages).filter(message => message.role === "user").length, 2);
      assert.equal(rows.some(turn => turn.metadata.runtime), false);
      const metadata = (await store.readSession("test")).metadata;
      assert.equal(metadata.runtime, undefined);
      assert.equal(JSON.parse(metadata.assistant_changeover).engines.claude.pending, undefined);
      assert.equal(metadata.claude_conversation_id, state.thread.id);

      await service.updateAgentGoal("test", { ...options, ...goal, action: "cancel" });
      // Raw Cancel acknowledges /goal clear before its terminal result is drained.
      // Finish that original native command before this separate canonical journey.
      const clearDeadline = Date.now() + 5000;
      let clearedState;
      for (;;) {
        clearedState = await service.agentSessionState("test", { ...options, session: await store.readSession("test") });
        assert.equal(clearedState.thread.id, state.thread.id, "goal clear retains the original native thread");
        if (clearedState.turn?.active === false) break;
        assert.ok(Date.now() < clearDeadline, "the admitted goal clear reaches its original terminal state");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.notEqual(clearedState.turn.state, "failed", clearedState.turn.error);
      assert.equal((await service.readAgentGoal("test", options)).goal, null);
    }
    const routedSelection = { ...defineVibe64AssistantSelection(f.context.assistantSelection), selectionSource: "explicit" };
    await createAssistantRoutingStore({ systemRoot: path.join(f.root, "system") }).write({
      owner: { senior: routedSelection, junior: routedSelection }, nonOwner: {}
    }, 0);
    await store.writeMetadataValue("test", "assistant_routing", JSON.stringify({ mode: "senior", afterPlan: ["review", "security-pass", "deslop"] }));
    if (busyGoal) {
      const working = await service.sendAgentMessage("test", { message: "Continue working", messageId: "before-busy-goal" }, options);
      assert.equal(working.delivered, true);
      assert.equal((await service.agentSessionState("test", { ...options, session: await store.readSession("test") })).turn.active, true);
    }
    if (!busyGoal && runs.has("stopped-first-goals")) {
      await store.writeMetadataValue("test", "assistant_goal_intent", "null");
      const preparationEntered = Promise.withResolvers();
      const preparationRelease = Promise.withResolvers();
      t.signal.addEventListener("abort", () => preparationRelease.resolve(), { once: true });
      const waitStoppedIntent = async () => {
        const deadline = Date.now() + 5000;
        while (JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active) {
          assert.ok(Date.now() < deadline, "Stop records its intent before waiting for native preparation");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      let holdPreparation = true;
      service.configureAssistantRuntime({ async resolveAssistantUser(user) {
        if (holdPreparation) {
          holdPreparation = false;
          preparationEntered.resolve();
          await preparationRelease.promise;
        }
        return user;
      } });
      const beforeStoppedSet = (await trace()).filter(row => row.frame?.type === "user").length;
      const stoppedSet = startGoal({ action: "set",
        expectedSegmentId: `claude:${state.thread.id}`, objective: "Do not dispatch this stopped goal",
        messageId: "stopped-first-goal" }, { canonical: true }).then(value => ({ value }), error => ({ error }));
      await Promise.race([preparationEntered.promise, stoppedSet.then(result => {
        throw new Error(`Goal ended before preparation gate: ${result.error?.message || JSON.stringify(result.value)}`);
      })]);
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
        "the first goal records intent before asynchronous preparation");
      const stoppingPreparation = service.interruptAgentTurn("test", {}, options);
      await waitStoppedIntent();
      preparationRelease.resolve();
      await stoppingPreparation;
      assert.match((await stoppedSet).error?.message || "", /stopped during preparation/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, beforeStoppedSet);
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false,
        "Stop cannot be undone by a late first-goal preparation");

      const dispatchEntered = Promise.withResolvers();
      const dispatchRelease = Promise.withResolvers();
      t.signal.addEventListener("abort", () => dispatchRelease.resolve(), { once: true });
      let holdDispatch = true;
      service.configureAssistantRuntime({ async resolveAssistantUser(user) {
        const intent = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent || "null");
        if (holdDispatch && intent?.selection && intent.pending?.messageId === "stopped-authorized-goal") {
          holdDispatch = false;
          dispatchEntered.resolve();
          await dispatchRelease.promise;
        }
        return user;
      } });
      const stoppedDispatch = startGoal({ action: "set",
        expectedSegmentId: `claude:${state.thread.id}`, objective: "Do not dispatch after authorization",
        messageId: "stopped-authorized-goal" }, { canonical: true }).then(value => ({ value }), error => ({ error }));
      await Promise.race([dispatchEntered.promise, stoppedDispatch.then(result => {
        throw new Error(`Goal ended before dispatch gate: ${result.error?.message || JSON.stringify(result.value)}`);
      })]);
      const stoppingDispatch = service.interruptAgentTurn("test", {}, options);
      await waitStoppedIntent();
      dispatchRelease.resolve();
      await stoppingDispatch;
      assert.match((await stoppedDispatch).error?.message || "", /stopped before dispatch/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, beforeStoppedSet,
        "Stop during final account authorization prevents native dispatch");
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
    }
    const processCountBeforeGoal = (await trace()).filter(row => row.args?.includes("--print")).length;
    await writeFile(goalAcknowledgementGate, "hold");
    let canonicalSettled = false;
    const canonicalCommand = { action: "set", expectedSegmentId: `claude:${state.thread.id}`,
      objective: "Verify the service", messageId: "service-canonical-goal" };
    const canonicalResult = startGoal(canonicalCommand, { canonical: true }).then(value => {
      canonicalSettled = true;
      return { value };
    }, error => {
      canonicalSettled = true;
      return { error };
    });
    const nativeObjective = canonicalCommand.objective;
    const frameDeadline = Date.now() + 5000;
    while (!(await trace()).some(row => row.frame?.type === "user" && row.frame.message.content === `/goal ${nativeObjective}`)) {
      if (canonicalSettled) {
        const result = await canonicalResult;
        assert.fail(`Canonical goal ended before dispatch: ${result.error?.message || JSON.stringify(result)}`);
      }
      assert.ok(Date.now() < frameDeadline, "canonical service goal reached the original native sender");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(canonicalSettled, false);
    assert.equal((await store.readSession("test")).metadata.assistant_routing_goal, undefined,
      "preparing and writing native history does not commit the application goal pin before acknowledgement");
    assert.equal((await store.readConversationLog("test")).some(turn => turn.user?.messageId === canonicalCommand.messageId), false);
    // Save a different role while native acknowledgement is still held. Its
    // next-turn pin must survive the older goal-start completion callback.
    await store.writeMetadataValue("test", "assistant_routing", JSON.stringify({ mode: "junior", afterPlan: ["review", "security-pass", "deslop"] }));
    await writeFile(goalAttachmentGate, "hold");
    await rm(goalAcknowledgementGate);
    while (!await store.conversationMessageIdExists("test", canonicalCommand.messageId)) {
      assert.ok(Date.now() < frameDeadline, "native admission is saved before its attachment");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(canonicalSettled, false, "command acknowledgement cannot adopt an older goal snapshot");
    assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).pending.messageId, canonicalCommand.messageId);
    await rm(goalAttachmentGate);
    const accepted = await canonicalResult;
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.value.status, "accepted");
    assert.equal(accepted.value.messageId, canonicalCommand.messageId);
    assert.doesNotMatch(JSON.stringify(accepted.value), /"(?:nativeResult|session|threadId)"\s*:/u);
    let pinned = JSON.parse((await store.readSession("test")).metadata.assistant_routing_goal);
    assert.equal(pinned.objective, canonicalCommand.objective);
    assert.equal(pinned.selection.engineId, "claude");
    assert.equal(pinned.status, "active");
    assert.equal(pinned.mode, "junior");
    const readView = await goalFacade.readGoal();
    let visible = readView.goal;
    assert.equal(readView.target.segmentId, `claude:${state.thread.id}`);
    assert.equal(readView.target.capabilities.goalBudgets, false);
    assert.equal(readView.target.capabilities.goalCommands.set.delivery, "message");
    assert.equal(readView.target.capabilities.goalCommands.pause.delivery, "control");
    assert.equal(visible.objective, canonicalCommand.objective);
    const nativeHistory = await readClaudeHistory({ configRoot: f.providerOptions.env.CLAUDE_CONFIG_DIR,
      workdir: f.context.session.metadata.source_path, conversationId: state.thread.id });
    assert.equal(nativeHistory.goal.objective, nativeObjective);
    assert.doesNotMatch(nativeHistory.goal.objective, /Vibe64 role|Auto plan/);
    if (busyGoal) assert.equal((await trace()).filter(row => row.args?.includes("--print")).length, processCountBeforeGoal,
      "setting a busy goal retains its current native process and instructions");
    for (const key of ["engineId", "modelProviderId", "agentId", "modelId", "variantId"]) {
      assert.equal(pinned.selection[key], routedSelection[key], `goal retains selected ${key}`);
    }
    assert.equal(visible.id, createHash("sha256").update(JSON.stringify([
      state.thread.id, nativeHistory.goal.createdAt, nativeObjective
    ])).digest("hex"), "display decoration never changes the canonical native identity");
    const pinBeforeDuplicate = (await store.readSession("test")).metadata.assistant_routing_goal;
    let nativeMessagesBeforeDuplicate = (await trace()).filter(row => row.frame?.type === "user").length;
    const duplicateGoal = await startGoal({ ...canonicalCommand, objective: "A changed retry" }, { canonical: true });
    assert.equal(duplicateGoal.duplicate, true);
    assert.equal(duplicateGoal.turnId, accepted.value.turnId);
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate);
    assert.equal((await store.readSession("test")).metadata.assistant_routing_goal, pinBeforeDuplicate,
      "an existing UUID has no new native result and cannot commit a different goal pin");
    let intentBeforeRestart = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent);
    assert.equal(intentBeforeRestart.active, true);
    assert.equal(intentBeforeRestart.pending, null);
    assert.equal(intentBeforeRestart.native.objective, nativeObjective);
    assert.equal(intentBeforeRestart.actor.username, actor.username);
    await service.close();
    assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
      "daemon shutdown preserves the person's active goal intent");
    service = createService();
    // After a deploy restart a goal's Claude turn is no longer running. It once
    // read paused, though nobody had paused it, while recovery resumed it.
    // Only Pause makes a goal read paused.
    const unpausedAfterRestart = await service.readCanonicalAgentGoal("test", options);
    assert.equal(unpausedAfterRestart.goal.status, "active",
      "a goal nobody paused reads active after a restart, so its control offers Pause, not Resume");
    assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_routing_goal).status, "active");
    if (!busyGoal && runs.has("restart-refusals")) {
      const historyFile = await claudeHistoryPath({ configRoot: f.providerOptions.env.CLAUDE_CONFIG_DIR,
        workdir: f.context.session.metadata.source_path, conversationId: state.thread.id });
      const beforeLoopLimit = await readFile(historyFile.path, "utf8");
      await writeFile(historyFile.path, JSON.stringify({ type: "system", subtype: "informational",
        timestamp: new Date().toISOString(),
        content: "A hook blocked the turn from ending 9 consecutive times — overriding and ending turn." }) + "\n", { flag: "a" });
      const blocked = await service.recoverActiveGoals();
      assert.equal(blocked.results.at(-1).blocked, true, JSON.stringify(blocked));
      const blockedRead = await service.readCanonicalAgentGoal("test", options);
      assert.equal(blockedRead.goal.status, "blocked");
      assert.match(blockedRead.goal.reason, /Resolve the blocker/);
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
        "a native blocker preserves the person's unfinished goal intent");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "restart never blindly starts the same native loop again");
      await writeFile(historyFile.path, beforeLoopLimit + JSON.stringify({ type: "attachment",
        timestamp: new Date().toISOString(), attachment: { type: "goal_status", condition: nativeObjective,
          met: false, failed: true, reason: "The remaining checks need credentials from the user." } }) + "\n");
      const impossible = await service.recoverActiveGoals();
      assert.equal(impossible.results.at(-1).blocked, true, JSON.stringify(impossible));
      const impossibleRead = await service.readCanonicalAgentGoal("test", options);
      assert.equal(impossibleRead.goal.status, "blocked");
      assert.equal(impossibleRead.goal.reason, "The remaining checks need credentials from the user.");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "a native failed evaluation must not be resumed after restart either");
      // At the account's usage limit, or out of credit, Claude's own message
      // ends the turn. A restart then sends nothing into that limit: the goal
      // waits, with the reset time, and continues by itself once the limit has
      // reset (resumesAt); out of credit it waits for the person's Resume.
      const resetsAt = Math.floor(Date.now() / 1000) + 5 * 60 * 60;
      for (const [label, limit, waitingFields] of [
        ["usage limit", { error: "rate_limit", apiError: "usage_limit_reached",
          apiErrorParams: { rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour" } },
          text: "You've hit your session limit · resets 5am (UTC)" }, { resetsAt, resumesAt: resetsAt + LIMIT_RESET_MARGIN_MS / 1000 }],
        ["out of credit", { error: "billing_error", text: "Credit balance is too low" }, { outOfCredit: true, resumesAt: undefined }]
      ]) {
        const { text, ...apiError } = limit;
        await writeFile(historyFile.path, beforeLoopLimit + JSON.stringify({ type: "assistant",
          timestamp: new Date().toISOString(), isApiErrorMessage: true, ...apiError,
          message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text }] } }) + "\n");
        await service.close();
        service = createService();
        const waiting = await service.recoverActiveGoals();
        assert.equal(waiting.results.at(-1).waiting, true, `${label}: ${JSON.stringify(waiting)}`);
        const waitingRead = await service.readCanonicalAgentGoal("test", options);
        assert.equal(waitingRead.goal.status, "usageLimited", label);
        for (const [key, value] of Object.entries(waitingFields)) assert.equal(waitingRead.goal[key], value, `${label}: ${key}`);
        assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
          `${label}: a restart sends no turn into the limit`);
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
          `${label}: the person's request to keep working is kept for their Resume`);
      }
      await service.close();
      await writeFile(historyFile.path, beforeLoopLimit);
      service = createService();
      service.configureAssistantRuntime({ authorizeProjectMessage: async () => {
        throw new Error("The original actor no longer has project access.");
      } });
      const denied = await service.recoverActiveGoals();
      assert.equal(denied.ok, false);
      assert.match(denied.results[0].error, /actor no longer/u);
      assert.match((await service.readCanonicalAgentGoal("test", options)).error, /actor no longer/u,
        "recovery failure remains visible without removing native goal controls");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate);
      await service.close();
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify({ ...intentBeforeRestart, native: null,
        pending: { action: "set", messageId: canonicalCommand.messageId, expectedSegmentId: canonicalCommand.expectedSegmentId,
          objective: nativeObjective } }));
      service = createService();
      const attachedAfterCrash = await service.recoverActiveGoals();
      assert.equal(attachedAfterCrash.results.at(-1).resumed, true, JSON.stringify(attachedAfterCrash));
      intentBeforeRestart = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent);
      assert.equal(intentBeforeRestart.active, true);
      assert.equal(intentBeforeRestart.pending, null);
      nativeMessagesBeforeDuplicate++;
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "the original accepted attachment is reconciled, then exactly one Resume is sent");
      await service.close();
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify({ ...intentBeforeRestart,
        pending: { action: "resume", messageId: canonicalCommand.messageId, objective: nativeObjective } }));
      service = createService();
      const unrelatedAttachment = await service.recoverActiveGoals();
      assert.equal(unrelatedAttachment.ok, false);
      assert.match(unrelatedAttachment.results.at(-1).error, /own native goal attachment/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "an accepted old command cannot adopt a newer goal with identical text");
      await service.close();
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify({ ...intentBeforeRestart,
        pending: { action: "resume", messageId: "unknown-goal-receipt", objective: nativeObjective } }));
      service = createService();
      // Claude proves this command never arrived: its history lacks it and no
      // work of it is pending. Recovery says so and still sends nothing itself.
      const neverSent = await service.recoverActiveGoals();
      assert.equal(neverSent.ok, false);
      assert.match(neverSent.results[0].error, /never reached the AI, so nothing was sent/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "a goal command that never arrived is not replaced with a new Resume by recovery");
      await service.close();
      // The restarts below come long after the one that just resumed the goal, as the crash-loop rule needs to resume it.
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify(longAfterLastResume(intentBeforeRestart)));
      service = createService();
    }
    if (!busyGoal) {
      // Exercise real lock expiry without spending its production minute in a
      // test; only the deadline is shortened at the existing store boundary.
      const held = Promise.withResolvers();
      const release = Promise.withResolvers();
      const preparing = store.runSessionExclusive("test", "agent-write-mode", async () => {
        held.resolve(); await release.promise;
      }, { operation: "prepare-workspace" });
      await held.promise;
      runtime.store = { ...store, runSessionExclusive(id, name, operation, lockOptions = {}) {
        if (lockOptions.operation === "resume-agent-goal") {
          assert.equal(lockOptions.waitMs, 60_000);
          lockOptions = { ...lockOptions, waitMs: 20 };
        }
        return store.runSessionExclusive(id, name, operation, lockOptions);
      } };
      try {
        const timedOut = await service.recoverActiveGoals();
        assert.equal(timedOut.ok, false);
        assert.equal(timedOut.results[0].code, "vibe64_agent_write_mode_busy");
        // The refusal names what holds the session.
        assert.match((await service.readCanonicalAgentGoal("test", options)).error,
          /The workspace is being prepared\. Try again when it is ready\./u);
        assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
          "lock timeout is visible and never dispatches or retries a goal");
      } finally { release.resolve(); runtime.store = store; }
      await preparing;
      await service.close();
      service = createService();
      runtime.listSessions = async () => [{ sessionId: "removed-during-recovery" }, await store.readSession("test")];
    }
    const prepareEntered = Promise.withResolvers();
    const prepareReleased = Promise.withResolvers();
    recoveryLockContended = Promise.withResolvers();
    const preparing = store.runSessionExclusive("test", "agent-write-mode", async () => {
      prepareEntered.resolve();
      await prepareReleased.promise;
    }, { operation: "prepare-workspace" });
    await prepareEntered.promise;
    await writeFile(goalAttachmentGate, "hold");
    requireGoalRequest = true;
    await writeFile(recoveryToolProbe, "probe");
    const recovering = service.recoverActiveGoals();
    try {
      const contention = await recoveryLockContended.promise;
      assert.equal(contention.waitMs, 60_000, "restart recovery queues behind ordinary workspace preparation");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "waiting for the preparation owner cannot dispatch a goal");
    } finally { prepareReleased.resolve(); }
    await preparing;
    const attachmentDeadline = Date.now() + 5000;
    while ((await trace()).filter(row => row.frame?.type === "user").length === nativeMessagesBeforeDuplicate) {
      assert.ok(Date.now() < attachmentDeadline, "restart Resume reaches native admission");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).pending,
      "restart Resume retains its pending command until its own attachment arrives");
    await rm(goalAttachmentGate);
    const recovery = await recovering;
    assert.equal(recovery.ok, busyGoal, JSON.stringify(recovery));
    assert.equal(recovery.results.at(-1).resumed, true, "one removed session cannot suppress the next goal's recovery");
    const probeDeadline = Date.now() + 5000;
    let probe;
    while (!probe) {
      probe = (await trace()).findLast(row => row.frame?.type === "control_response" &&
        row.frame.response?.request_id === "recovery-authority-contract");
      assert.ok(Date.now() < probeDeadline, "Recovered native goal can discover its application control contract");
      if (!probe) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(probe.frame.response.subtype, "success", JSON.stringify(probe));
    assert.doesNotMatch(JSON.stringify(probe), /Log in to Vibe64|vibe64_auth_required/);
    assert.ok(recoveredActorReads > 0, "Recovered tools use host-issued fresh authority without a browser request");
    await rm(recoveryToolProbe);
    requireGoalRequest = false;
    if (!busyGoal) assert.equal(recovery.results[0].ok, false);
    runtime.listSessions = async () => [await store.readSession("test")];
    const framesAfterRecovery = (await trace()).filter(row => row.frame?.type === "user").length;
    assert.equal(framesAfterRecovery, nativeMessagesBeforeDuplicate + 1, "restart admits exactly one canonical Resume");
    await service.recoverActiveGoals();
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesAfterRecovery);
    visible = (await service.readCanonicalAgentGoal("test", options)).goal;
    assert.equal(visible.status, "active");
    if (busyGoal) {
      await service.close();
      // A restart long after the one that resumed the goal: restart recovery queues behind the preparation again.
      const resumedIntent = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent);
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify(longAfterLastResume(resumedIntent)));
      service = createService();
      const held = Promise.withResolvers();
      const release = Promise.withResolvers();
      recoveryLockContended = Promise.withResolvers();
      const preparing = store.runSessionExclusive("test", "agent-write-mode", async () => {
        held.resolve(); await release.promise;
      }, { operation: "prepare-workspace" });
      await held.promise;
      const recovering = service.recoverActiveGoals();
      let stopping;
      try {
        await recoveryLockContended.promise;
        stopping = service.interruptAgentTurn("test", {}, options);
        const deadline = Date.now() + 5000;
        while (JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active) {
          assert.ok(Date.now() < deadline, "Stop records intent before waiting for the preparation lock");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { release.resolve(); }
      await preparing;
      await stopping;
      assert.equal((await recovering).ok, false, "Stop prevents a queued automatic Resume");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesAfterRecovery);
    }
    const differentSelection = { ...f.context.assistantSelection, engineId: "codex", agentId: "codex",
      modelProviderId: "openai", modelId: "gpt-6-astra" };
    await store.writeMetadataValue("test", "assistant_selection", JSON.stringify(differentSelection));
    const stoppingOptions = { runtime, vibe64User: { username: "reader", role: "member" } };
    const pinnedRead = await service.readCanonicalAgentGoal("test", stoppingOptions);
    assert.equal(pinnedRead.goal.id, visible.id);
    assert.equal(pinnedRead.target.segmentId, canonicalCommand.expectedSegmentId);
    assert.equal(pinnedRead.routing.selection.engineId, "claude");
    const stoppedGoal = await service.updateCanonicalAgentGoal("test", { ...stoppingOptions, action: "pause",
      expectedSegmentId: canonicalCommand.expectedSegmentId, expectedGoalId: visible.id });
    assert.equal(stoppedGoal.status, "paused");
    assert.equal((await store.readSession("test")).metadata.assistant_selection, JSON.stringify(differentSelection),
      "read and Pause retain the pinned goal target without rebinding the visible chat");
    pinned = JSON.parse((await store.readSession("test")).metadata.assistant_routing_goal);
    assert.equal(pinned.status, "paused");
    assert.equal(pinned.selection.engineId, "claude");
    assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
    await service.close();
    service = createService();
    assert.equal((await service.recoverActiveGoals()).results[0].skipped, true);
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesAfterRecovery,
      "explicit Pause survives another daemon restart");
    rows = await store.readConversationLog("test");
    assert.equal(rows.filter(turn => turn.user?.messageId === canonicalCommand.messageId).length, 1);
    assert.equal(rows.some(turn => turn.metadata.runtime), false);
    assert.equal((await store.readSession("test")).metadata.runtime, undefined);
    if (!busyGoal && (runs.has("self-controls") || runs.has("block-on-goal"))) {
      await store.writeMetadataValue("test", "assistant_selection", JSON.stringify(routedSelection));
      const retainedGoal = await service.readAgentGoal("test", options);
      const currentGoal = await service.updateAgentGoal("test", { ...options, action: "resume",
        threadId: retainedGoal.threadId, createdAt: retainedGoal.goal.createdAt, objective: retainedGoal.goal.objective });
      assert.equal(currentGoal.goal.status, "active");
      // Claude's own Pause or Block stops its process after the tool receipt; its goal checker stands down first,
      // beside that Pause or Block, so no "Goal cleared" lands above the person's next message.
      // The process to drain is the one that received the turn's last message (the Pause or Block, or the goal that
      // blocks), not the newest one: Vibe64 starts other Claude processes beside it (an account read starts one that
      // only initializes and exits). The stand-down takes as long as its interrupt and clear take, so the test's own
      // time limit bounds the wait.
      const drainsAfterStandingDown = async message => {
        const { pid } = (await trace()).findLast(row => row.frame?.type === "user");
        for (;;) {
          try { process.kill(pid, 0); }
          catch (error) { if (error.code === "ESRCH") break; throw error; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal((await trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content, "/goal clear", message);
      };
      if (runs.has("self-controls")) {
        await assert.rejects(actions.execute({ actionId: "vibe64.terminals.main-goal.pause",
          input: { projectSlug: "claude-main-fixture" }, context: { channel: "automation", surface: "app" } }), {
          code: "vibe64_main_goal_control_required"
        });
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
          "Knowing the action ID is not authority to pause a Main goal");
        const prose = await sendFollowed(goalFacade, { messageId: "service-pause-prose", text: "I am paused.", steer: true });
        assert.equal(prose.delivered, true);
        assert.equal((await service.readAgentGoal("test", options)).goal.status, "active");
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
          "Ordinary prose never substitutes for the structured Pause operation");
        const pauseReceipt = await sendFollowed(goalFacade, { messageId: "service-self-pause", text: "Pause through the admitted application tool.", steer: true });
        assert.equal(pauseReceipt.delivered, true);
        const pauseDeadline = Date.now() + 5000;
        let pauseCall;
        while (!pauseCall || pauseCall.status === "running") {
          const log = await store.readConversationLog("test");
          pauseCall = log.flatMap(turn => turn.metadata.applicationTools || []).find(call => call.id.endsWith("self-pause-execute"));
          assert.ok(Date.now() < pauseDeadline, JSON.stringify({ pauseCall, frames: (await trace()).slice(-4) }));
          if (!pauseCall || pauseCall.status === "running") await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(pauseCall.status, "complete");
        assert.equal(pauseCall.result.ok, true, JSON.stringify(pauseCall.result));
        assert.equal(pauseCall.result.result.result.status, "paused");
        const afterPause = await service.readAgentGoal("test", options);
        assert.equal(afterPause.goal.status, "paused");
        assert.equal(afterPause.goal.objective, currentGoal.goal.objective);
        assert.equal(afterPause.goal.createdAt, currentGoal.goal.createdAt);
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
        await drainsAfterStandingDown("Self-Pause stands Claude's goal checker down, then drains after its native tool receipt");
        const framesBeforeRestart = (await trace()).filter(row => row.frame?.type === "user").length;
        await service.close();
        service = createService();
        assert.equal((await service.recoverActiveGoals()).results[0].skipped, true);
        assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesBeforeRestart);
        const ordinary = await sendFollowed(goalFacade, { messageId: "service-after-paused-restart", text: "An ordinary message while the goal stays paused." });
        assert.equal(ordinary.delivered, true);
        assert.equal((await service.readAgentGoal("test", options)).goal.status, "paused");
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
        const nativeInputs = (await trace()).filter(row => row.frame?.type === "user").slice(framesBeforeRestart);
        assert.equal(nativeInputs.length, 1, `no second goal clear lands above the person's message: ${JSON.stringify(nativeInputs)}`);
        assert.match(nativeInputs[0].frame.message.content, /An ordinary message while the goal stays paused/);
        // Asked in chat to continue the goal it paused, Claude resumes it through
        // Main's Resume action: the goal continues once that turn ends, once.
        const resumedGoalCommand = `/goal ${currentGoal.goal.objective}`;
        const resumedGoalCommands = async () => (await trace()).filter(row => row.frame?.type === "user" &&
          row.frame.message.content === resumedGoalCommand).length;
        const finishedToolCall = async id => {
          const deadline = Date.now() + 5000;
          for (;;) {
            const call = (await store.readConversationLog("test")).flatMap(turn => turn.metadata.applicationTools || [])
              .find(row => row.id.endsWith(id));
            if (call && call.status !== "running") return call;
            assert.ok(Date.now() < deadline, JSON.stringify({ id, call, frames: (await trace()).slice(-4) }));
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        };
        const commandsBeforeChatResume = await resumedGoalCommands();
        const resumeReceipt = await sendFollowed(goalFacade, { messageId: "service-self-resume", text: "Resume through the admitted application tool.", steer: true });
        assert.equal(resumeReceipt.delivered, true);
        const resumeCall = await finishedToolCall("self-resume-execute");
        assert.equal(resumeCall.result.ok, true, JSON.stringify(resumeCall.result));
        assert.equal(resumeCall.result.result.result.status, "resuming");
        const chatResumeDeadline = Date.now() + 5000;
        while ((await service.readAgentGoal("test", options)).goal.status !== "active") {
          assert.ok(Date.now() < chatResumeDeadline, JSON.stringify({ deliveryDiagnostics: deliveryDiagnostics.slice(-3),
            intent: (await store.readSession("test")).metadata.assistant_goal_intent, frames: (await trace()).slice(-3) }));
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        const chatResumed = await service.readAgentGoal("test", options);
        assert.equal(chatResumed.goal.objective, currentGoal.goal.objective);
        const chatResumedIntent = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent);
        assert.equal(chatResumedIntent.active, true, "a restart continues the goal resumed in chat");
        assert.ok(!chatResumedIntent.resumeRequested, JSON.stringify(chatResumedIntent));
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.equal(await resumedGoalCommands(), commandsBeforeChatResume + 1, "the goal resumed in chat continues once");
        assert.match(nativeInputs[0].frame.message.content,
          /goal is paused, not cleared[\s\S]*assistant_action_execute with \{"actionId":"vibe64\.terminals\.main-goal\.resume","input":\{\}\}/u,
          "Claude, whose own goal checker was cleared, was told the goal is paused and how to resume it");
        // With nothing to resume, Claude's Resume is refused and sends nothing.
        // The turn that asked for the Resume has ended, so these are new messages.
        const againReceipt = await sendFollowed(goalFacade, { messageId: "service-self-resume-again", text: "Resume again through the admitted application tool." });
        assert.equal(againReceipt.delivered, true);
        const againCall = await finishedToolCall("self-resume-again-execute");
        assert.notEqual(againCall.result.ok, true, JSON.stringify(againCall.result));
        assert.match(JSON.stringify(againCall.result), /vibe64_main_goal_nothing_to_resume|no paused, blocked or waiting goal to resume/u);
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.equal((await service.readAgentGoal("test", options)).goal.status, "active");
        assert.equal(await resumedGoalCommands(), commandsBeforeChatResume + 1, "a refused Resume sends nothing");
        // The goal resumed in chat is the active goal Claude reports a blocker on.
        await assert.rejects(actions.execute({ actionId: "vibe64.terminals.main-goal.block",
          input: { projectSlug: "claude-main-fixture", reason: "Missing approval code" },
          context: { channel: "automation", surface: "app" } }), { code: "vibe64_main_goal_control_required" });
        const blockReceipt = await sendFollowed(goalFacade, { messageId: "service-self-block", text: "Block through the admitted application tool." });
        assert.equal(blockReceipt.delivered, true);
        const blockDeadline = Date.now() + 5000;
        let blockCall;
        while (!blockCall || blockCall.status === "running") {
          const log = await store.readConversationLog("test");
          blockCall = log.flatMap(turn => turn.metadata.applicationTools || []).find(call => call.id.endsWith("self-block-execute"));
          assert.ok(Date.now() < blockDeadline, JSON.stringify({ blockCall, frames: (await trace()).slice(-4) }));
          if (!blockCall || blockCall.status === "running") await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(blockCall.status, "complete");
        assert.equal(blockCall.result.ok, true, JSON.stringify(blockCall.result));
        assert.equal(blockCall.result.result.result.status, "blocked");
        const blocked = await service.readAgentGoal("test", options);
        assert.equal(blocked.goal.status, "blocked");
        assert.equal(blocked.goal.reason, "The human must supply the missing approval code.");
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
          "A model-reported external blocker does not manufacture a human Pause");
        await drainsAfterStandingDown("Self-Block stands Claude's goal checker down, then drains after its native tool receipt");
        const blockedFrames = (await trace()).filter(row => row.frame?.type === "user").length;
        await service.close();
        service = createService();
        assert.equal((await service.recoverActiveGoals()).results[0].blocked, true);
        assert.equal((await trace()).filter(row => row.frame?.type === "user").length, blockedFrames,
          "Restart retains the blocker without invoking Claude again");
        // On 24 Nov 2026 this send outlasted the editor's two-second answer on a loaded test host and answered as held.
        slowProjectOpenMs = 2_500;
        const blockedOrdinary = await sendFollowed(goalFacade, { messageId: "service-blocked-ordinary", text: "Explain the blocker without resuming." });
        assert.equal(blockedOrdinary.delivered, true);
        assert.equal((await service.readAgentGoal("test", options)).goal.status, "blocked");
        const blockedInputs = (await trace()).filter(row => row.frame?.type === "user").slice(blockedFrames);
        assert.equal(blockedInputs.length, 1, `no second goal clear lands above the person's message: ${JSON.stringify(blockedInputs)}`);
        assert.match(blockedInputs[0].frame.message.content, /Explain the blocker without resuming[\s\S]*goal is blocked, not cleared/u);
        await service.updateAgentGoal("test", { ...options, ...blocked.goal, threadId: blocked.threadId, action: "resume" });
        assert.equal((await service.readAgentGoal("test", options)).goal.status, "active");
      }
      if (runs.has("block-on-goal")) {
        const resumedBlocked = await goalFacade.readGoal();
        await goalFacade.updateGoal({ action: "cancel", expectedSegmentId: resumedBlocked.target.segmentId,
          expectedGoalId: resumedBlocked.goal.id, messageId: "before-block-on-goal" });
        requireGoalRequest = true;
        service.configureAssistantRuntime({ resolveAssistantUser: async () => null });
        await startGoal({ action: "set", objective: "BLOCK_ON_GOAL", messageId: "block-on-goal",
          expectedSegmentId: resumedBlocked.target.segmentId }, { canonical: true });
        const goalToolDeadline = Date.now() + 5000;
        let goalToolCall;
        while (!goalToolCall || goalToolCall.status === "running") {
          goalToolCall = (await store.readConversationLog("test")).flatMap(turn => turn.metadata.applicationTools || [])
            .find(call => call.id.endsWith("self-block-goal-execute"));
          assert.ok(Date.now() < goalToolDeadline, JSON.stringify({ goalToolCall, frames: (await trace()).slice(-5) }));
          if (!goalToolCall || goalToolCall.status === "running") await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(goalToolCall.result.ok, true, JSON.stringify(goalToolCall));
        assert.equal((await service.readAgentGoal("test", options)).goal.status, "blocked",
          "The goal command retains fresh request authority even without a signed-in runtime actor or intervening user message");
        await drainsAfterStandingDown("A Block during the goal's own turn stands Claude's goal checker down, then drains");
        // The owner saves a different main AI while this project is closed. Once
        // it opens again, nothing changes until the goal would continue: Resume
        // then cancels it through Cancel goal and tells the chat why.
        const routing = createAssistantRoutingStore({ systemRoot: path.join(f.root, "system") });
        const savedRouting = await routing.read();
        const nextMainAi = { ...savedRouting.owner.senior, modelId: `${savedRouting.owner.senior.modelId}-next` };
        await service.close();
        await routing.write({ owner: { ...savedRouting.owner, senior: nextMainAi, junior: nextMainAi },
          nonOwner: savedRouting.nonOwner }, savedRouting.revision);
        service = createService();
        const reopened = await service.readAgentGoal("test", options);
        assert.equal(reopened.goal.status, "blocked", "opening the project cancels nothing by itself");
        const framesBeforeResume = (await trace()).filter(row => row.frame?.type === "user").length;
        const resumed = await service.updateAgentGoal("test", { ...options, ...reopened.goal, threadId: reopened.threadId, action: "resume" });
        assert.equal(resumed.code, "vibe64_goal_main_ai_changed", JSON.stringify(resumed));
        const afterSwitch = await service.readAgentGoal("test", options);
        assert.ok(!afterSwitch.goal || ["complete", "completed"].includes(afterSwitch.goal.status), JSON.stringify(afterSwitch));
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false,
          "a cancelled goal is never resumed after restart");
        assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_routing_goal).status, "complete");
        const resumeFrames = (await trace()).filter(row => row.frame?.type === "user").slice(framesBeforeResume);
        assert.ok(resumeFrames.length && resumeFrames.every(row => row.frame.message.content === "/goal clear"),
          `the goal runs no turn on the old main AI: ${JSON.stringify(resumeFrames)}`);
        const notices = (await store.readConversationLog("test"))
          .filter(turn => JSON.stringify(turn).includes("Goal cancelled because the main AI changed"));
        assert.equal(notices.length, 1, JSON.stringify(notices));
      }
    }
  });
}

export { mainGoalOwnersScenario };
