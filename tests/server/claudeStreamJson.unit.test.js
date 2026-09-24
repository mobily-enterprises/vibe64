import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Readable, Duplex } from "node:stream";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClaudeJsonClient, readClaudeJsonFrames } from "../../packages/vibe64-runtime/src/server/claudeStreamJson.js";
import { claudeCodeArguments, createClaudeCodeProcess } from "../../packages/vibe64-terminals/src/server/claudeCodeProcess.js";
import { readClaudeHistory } from "../../packages/vibe64-terminals/src/server/claudeConversationHistory.js";
import { claudeCapabilities, claudePlanUsage, createClaudeSessionAgentProvider, nativeMessageId } from "../../packages/vibe64-terminals/src/server/agent/providers/claudeSessionAgentProvider.js";
import { sessionRenewalManualHandoverTemplate, sessionRenewalHandoverHash } from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";
import { readClaudeCodeAuthStatus } from "../../packages/studio-terminal-core/src/server/claudeRuntime.js";
import { defineVibe64AssistantCapabilities } from "../../packages/vibe64-runtime/src/shared/assistantSelection.js";

async function frames(chunks, options) {
  const result = [];
  for await (const frame of readClaudeJsonFrames(Readable.from(chunks), options)) result.push(frame);
  return result;
}

test("Claude JSON frames survive every byte boundary, including Unicode and escaped newlines", async () => {
  const expected = [{ type: "assistant", text: "Hello 🌏\n世界" }, { type: "result", is_error: false }];
  const bytes = Buffer.from(`${expected.map((frame) => JSON.stringify(frame)).join("\r\n")}\n`);
  assert.deepEqual(await frames([...bytes].map((byte) => Buffer.from([byte]))), expected);
  assert.deepEqual(await frames([bytes]), expected);
});

test("Claude JSON framing bounds fragmented and complete frames and rejects malformed data without echoing it", async () => {
  await assert.rejects(frames([Buffer.from('{"type":"secret"}\n')], { maxFrameBytes: 8 }), /size limit/u);
  await assert.rejects(frames([Buffer.alloc(4, 32), Buffer.alloc(5, 32)], { maxFrameBytes: 8 }), /size limit/u);
  await assert.rejects(frames([Buffer.from("secret token\n")]), (error) => !error.message.includes("secret token"));
  await assert.rejects(frames([Buffer.from('{"type":"user","text":"'), Buffer.from([255]), Buffer.from('"}\n')]), /invalid UTF-8/u);
  await assert.rejects(frames([Buffer.from('[]\n')]), /event type/u);
  await assert.rejects(frames([Buffer.from('{"type":"result"}')]), /incomplete/u);
  assert.deepEqual(await frames([Buffer.from('{"type":"result"}')], { allowIncompleteTail: true }), []);
});

function fakeStream(onWrite) {
  return new Duplex({ read() {}, write(chunk, _encoding, callback) {
    Promise.resolve().then(() => onWrite(JSON.parse(String(chunk)), this)).then(() => callback(), callback);
  } });
}

test("Claude controls correlate out-of-order replies and events apply backpressure", async () => {
  const requests = [];
  const observed = [];
  const stream = fakeStream((frame, socket) => {
    requests.push(frame);
    if (requests.length === 2) for (const request of [...requests].reverse()) {
      socket.push(`${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: request.request_id, response: { name: request.request.subtype } } })}\n`);
    }
  });
  const client = createClaudeJsonClient({ stream, onEvent: async (frame) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    observed.push(frame.number);
  } });
  assert.deepEqual(await Promise.all([client.request({ subtype: "one" }), client.request({ subtype: "two" })]), [{ name: "one" }, { name: "two" }]);
  stream.push('{"type":"test","number":1}\n{"type":"test","number":2}\n');
  stream.push(null);
  await client.completion;
  assert.deepEqual(observed, [1, 2]);
  client.close();
});

test("Claude control replies bypass slow event persistence while events remain ordered", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const observed = [];
  const stream = fakeStream((frame, socket) => socket.push(`${JSON.stringify({
    type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} }
  })}\n`));
  const client = createClaudeJsonClient({ stream, onEvent: async (frame) => {
    if (frame.number === 1) { entered.resolve(); await release.promise; }
    observed.push(frame.number);
  } });
  stream.push('{"type":"event","number":1}\n{"type":"event","number":2}\n');
  await entered.promise;
  try {
    await client.request({ subtype: "interrupt" }, { timeoutMs: 100 });
    assert.deepEqual(observed, []);
    release.resolve();
    stream.push(null);
    await client.completion;
    assert.deepEqual(observed, [1, 2]);
  } finally {
    release.resolve();
    client.close();
  }
});

test("Claude interrupt uses the common 30-second control deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = createClaudeJsonClient({ stream: fakeStream(() => {}) });
  const pending = client.interrupt();
  let settled = false;
  const rejected = assert.rejects(pending, /interrupt timed out/u).then(() => { settled = true; });
  t.mock.timers.tick(29_999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await rejected;
  client.close();
  await client.completion;
});

test("Claude control timeouts and pipe closure reject pending work promptly", async () => {
  const stream = fakeStream(() => {});
  const client = createClaudeJsonClient({ stream, timeoutMs: 10 });
  await assert.rejects(client.initialize(), /timed out/u);
  const pending = client.request({ subtype: "interrupt" }, { timeoutMs: 10_000 });
  stream.push(null);
  await assert.rejects(pending, /ended unexpectedly/u);
  await client.completion;
});

test("Claude subscription launch preserves native auth and makes helper tools unavailable", () => {
  const args = claudeCodeArguments({ sessionId: "session", resume: true, model: "sonnet", effort: "high", toolFree: true });
  assert.ok(args.includes("--resume"));
  assert.ok(args.includes("stream-json"));
  assert.equal(args[args.indexOf("--thinking-display") + 1], "summarized");
  assert.equal(claudeCodeArguments({ terminal: true }).includes("--thinking-display"), false);
  assert.equal(args.includes("--bare"), false);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args.includes("bypassPermissions"), false);
});

test("Claude's live model and effort catalog fits the shared assistant selection contract", () => {
  const catalog = claudeCapabilities({ models: [{ value: "sonnet", displayName: "Sonnet", supportedEffortLevels: ["low", "high"] }] }, true);
  assert.equal(defineVibe64AssistantCapabilities(catalog).engineId, "claude");
  assert.equal(catalog.defaults.variantId, "high");
  assert.equal(catalog.modelProviders[0].models[0].variants[0].label, "Low");
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-provider-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selection = { engineId: "claude", agentId: "claude", modelId: "sonnet", modelProviderId: "anthropic", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
  const workdir = path.join(root, "sessions", "active", "test", "source");
  await mkdir(workdir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "Initial");
  const session = { sessionId: "test", sessionRoot: path.join(root, "state"), metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: workdir, assistant_selection: JSON.stringify(selection) } };
  const written = [];
  const checkpoints = [];
  const store = {
    async writeBackgroundTaskEvent(_id, _task, { patch }) { checkpoints.push(patch); return patch; },
    async mutateSession(_id, operation) { return operation(); },
    async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
    async deleteMetadataValue(_id, key) { delete session.metadata[key]; },
    async writeAgentRunEvent(_id, _run, { patch }) { return patch; },
    conversationMessageIdExists: async (_id, id) => written.some((message) => message.messageId === id),
    writeConversationUserMessage: async (_id, message) => { written.push({ role: "user", ...message }); return message; },
    writeConversationAssistantMessage: async (_id, message) => { written.push({ role: "assistant", ...message }); return message; },
    writeConversationCommentaryMessage: async (_id, message) => { written.push({ role: "commentary", ...message }); return message; },
    writeConversationThinkingMessage: async (_id, message) => { written.push({ role: "thinking", ...message }); return message; },
    updateConversationStream: (_id, value) => value,
    completeConversationStreamMessage() {}, clearConversationStream: () => ({}), readConversationStream: () => ({})
  };
  const runtime = { stateRoot: root, store, getSession: async () => session, renderPrompt: async (_id, input) => ({ prompt: `Context: ${input.request}` }) };
  const context = { sessionId: "test", session, runtime, assistantSelection: selection };
  const processes = [];
  const behavior = { account: { loggedIn: true, email: "owner@example.test", authMethod: "claude.ai" } };
  const providerOptions = { systemRoot: path.join(root, "system"), env: { CLAUDE_CONFIG_DIR: path.join(root, "config") },
    projectService: { readCurrentProject: async () => ({ sourceRoot: workdir }) },
    composeSessionContext: async () => ({ output: "Prepared session instructions" }),
    accountStatus: async () => behavior.account,
    credentialHome: { home: root }, recordGitActor: async () => ({ ok: true }), connectionStatus: async () => true,
    createProcess: async (options) => {
      const native = { options, executionId: `test-${processes.length}`, stopped: false, stopAllowed: true,
        initialization: { models: [{ value: "sonnet", supportedEffortLevels: ["low", "high"] }, { value: "haiku", supportedEffortLevels: [] }] },
        async stop() { this.stopped = this.stopAllowed; return { exited: this.stopped, scopeEmpty: this.stopped }; },
        client: { async request(request) { (native.requests ||= []).push(request); return {}; }, interrupt: async () => {
          await options.onEvent({ type: "result", subtype: "success", terminal_reason: "aborted_streaming", result: "" });
          return {};
        }, async send(message, input) {
          native.lastInput = { message, ...input };
          if (behavior.lifecycle) {
            await options.onEvent({ type: "command_lifecycle", command_uuid: input.messageId, state: "queued" });
            await options.onEvent({ type: "command_lifecycle", command_uuid: input.messageId, state: "started" });
          } else await options.onEvent({ type: "user", uuid: input.messageId, session_id: options.sessionId });
          await behavior.afterSend?.(native, message);
        } }
      };
      processes.push(native);
      return native;
    }
  };
  const provider = createClaudeSessionAgentProvider(providerOptions);
  return { provider, providerOptions, behavior, context, processes, written, root, checkpoints, git };
}

test("Claude provider admits prompts in order, steers, projects thinking and text, and deduplicates sends", async (t) => {
  const f = await fixture(t);
  const sent = await f.provider.sendMessage(f.context, { message: "First", messageId: "first" });
  assert.equal(sent.delivered, true);
  assert.equal(f.processes[0].lastInput.message, "Context: First");
  const steered = await f.provider.sendMessage(f.context, { message: "Change direction", messageId: "second" });
  assert.equal(steered.deliveryMode, "steer");
  assert.equal(f.processes.length, 1);
  const previousHead = f.git("rev-parse", "HEAD");
  await writeFile(path.join(f.context.session.metadata.source_path, "edited.txt"), "Retain this work");
  await f.processes[0].options.onEvent({ type: "assistant", message: { id: "answer", content: [
    { type: "thinking", thinking: "Exposed thinking summary." }, { type: "text", text: "Done." }
  ] } });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Done.", uuid: "result" });
  assert.deepEqual(f.written.map((message) => message.role), ["user", "user", "thinking", "assistant"]);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  assert.equal(f.checkpoints.at(-1).status, "ready");
  assert.equal(f.git("show", `${f.checkpoints.at(-1).checkpointCommit}:edited.txt`), "Retain this work");
  assert.equal(f.git("rev-parse", "HEAD"), previousHead);
  assert.equal((await f.provider.sendMessage(f.context, { message: "First", messageId: "first" })).duplicate, true);
});

test("Claude compaction status is scoped to the active conversation and clears after completion or Stop", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Work", messageId: "compact-work" });
  const event = f.processes[0].options.onEvent;
  const state = () => f.provider.sessionState(f.context);
  await event({ type: "system", subtype: "status", status: "compacting", parent_tool_use_id: "nested-agent" });
  assert.equal((await state()).turn.phase, "");
  await event({ type: "system", subtype: "status", status: "compacting" });
  assert.equal((await state()).turn.phase, "compacting");
  await event({ type: "system", subtype: "compact_boundary" });
  assert.equal((await state()).turn.phase, "");
  assert.equal((await state()).turn.active, true);
  await event({ type: "system", subtype: "status", status: "compacting" });
  await event({ type: "system", subtype: "status", status: null });
  assert.equal((await state()).turn.phase, "");
  await event({ type: "system", subtype: "status", status: "compacting" });
  await f.provider.interruptTurn(f.context);
  assert.equal((await state()).turn.phase, "");
  await event({ type: "system", subtype: "status", status: "compacting" });
  assert.equal((await state()).turn.phase, "", "A stopped process cannot restore compaction");
  await f.provider.sendMessage(f.context, { message: "Continue", messageId: "compact-continue" });
  assert.equal((await state()).turn.phase, "");
  const nextEvent = f.processes[1].options.onEvent;
  await nextEvent({ type: "system", subtype: "status", status: "compacting" });
  await nextEvent({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["Provider unavailable"] });
  assert.equal((await state()).turn.phase, "");
});

test("Claude stop requires process exit proof and resume keeps the native conversation", async (t) => {
  const f = await fixture(t);
  const initial = await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  f.processes[0].stopAllowed = false;
  await assert.rejects(f.provider.interruptTurn(f.context), /exit has not been confirmed/u);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, true);
  f.processes[0].stopAllowed = true;
  await f.provider.interruptTurn(f.context);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  await f.provider.sendMessage(f.context, { message: "Continue", messageId: "continue" });
  assert.equal(f.processes[1].options.sessionId, initial.thread.id);
  assert.equal(f.processes[1].options.resume, true);
});

test("Claude split native frames retain thinking and answers across streaming and history", async (t) => {
  const f = await fixture(t);
  const completedStreams = [];
  f.context.runtime.store.completeConversationStreamMessage = (_id, messageId) => completedStreams.push(messageId);
  const sent = await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  const event = f.processes[0].options.onEvent;
  const content = [{ type: "thinking", thinking: "Exposed summary." }, { type: "text", text: "Done." }];
  const nativeFrames = content.map((block, index) => ({
    type: "assistant", uuid: `block-${index}`, message: { id: "shared-api-id", content: [block] }
  }));
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "shared-api-id" } } });
  for (const [index, block] of content.entries()) {
    await event({ type: "stream_event", event: { type: "content_block_start", index, content_block: { type: block.type } } });
    await event({ type: "stream_event", event: { type: "content_block_delta", index,
      delta: block.type === "thinking" ? { thinking: block.thinking } : { text: block.text } } });
    await event({ type: "stream_event", event: { type: "content_block_stop", index } });
    await event(nativeFrames[index]);
  }
  await event({ type: "result", subtype: "success", result: "Done." });
  const live = await f.provider.readConversation(f.context);
  assert.deepEqual(live.messages.map(({ role, text }) => ({ role, text })), [
    { role: "thinking", text: "Exposed summary." }, { role: "assistant", text: "Done." }
  ]);
  assert.equal(new Set(live.messages.map((message) => message.id)).size, 2);
  assert.equal(new Set(f.written.filter((message) => message.role !== "user").map((message) => message.messageId)).size, 2);
  assert.ok(completedStreams.includes("claude_shared-api-id_1"));
  await writeHistory(f, sent.thread.id, nativeFrames.map((frame, apiBlockIndex) => ({ ...frame, apiBlockIndex })));
  const history = await readClaudeHistory({ configRoot: path.join(f.root, "config"),
    workdir: f.context.session.metadata.source_path, conversationId: sent.thread.id });
  assert.deepEqual(history.messages.map((message) => message.id), live.messages.map((message) => message.id));
  assert.deepEqual(history.messages.map((message) => message.text), ["Exposed summary.", "Done."]);
  assert.equal((await f.provider.readConversation(f.context)).messages.length, 2);
});

test("Claude reuses its main conversation when callers hold older session snapshots", async (t) => {
  const f = await fixture(t);
  const staleSession = structuredClone(f.context.session);
  const first = await f.provider.ensureSession(f.context);
  const staleContext = { ...f.context, session: staleSession };
  const state = await f.provider.sessionState(staleContext);
  const sent = await f.provider.sendMessage(staleContext, { message: "Hello", messageId: "hello" });
  assert.equal(state.thread.id, first.thread.id);
  assert.equal(sent.thread.id, first.thread.id);
  assert.equal(f.processes.length, 1);
});

test("Claude observation failure stops native work before publishing idle", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  await f.processes[0].options.onFailure(new Error("Broken stream"));
  assert.equal(f.processes[0].stopped, true);
  assert.equal((await f.provider.sessionState(f.context)).turn.state, "interrupted");
});

test("Claude managed bridge carries JSON and provides a verified scope stop", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-bridge-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, "claude-fixture");
  await writeFile(command, `#!/usr/bin/env node
const readline = require('node:readline');
if (Number(process.env.VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID) !== process.pid) {
  throw new Error('Native Git probes would wait forever for stdin.');
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: { models: [{ value: 'fixture' }] } } }) + '\\n');
  else process.stdout.write(JSON.stringify(frame) + '\\n');
});
`, { mode: 0o700 });
  const observed = Promise.withResolvers();
  const native = await createClaudeCodeProcess({ command, workdir: root, credentialHome: { home: root },
    onEvent: (event) => observed.resolve(event) });
  t.after(() => native.stop());
  assert.equal(native.initialization.models[0].value, "fixture");
  await native.client.send("Unicode 🌏", { messageId: "test" });
  assert.equal((await observed.promise).message.content, "Unicode 🌏");
  assert.equal((await native.stop()).scopeEmpty, true);
});

async function writeHistory(f, id, events, workdir = f.context.session.metadata.source_path) {
  const directory = path.join(f.root, "config", "projects", workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${id}.jsonl`), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

test("Claude command admission is distinct from user tool-result frames and waits for native background work", async (t) => {
  const f = await fixture(t);
  f.behavior.lifecycle = true;
  await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  const event = f.processes[0].options.onEvent;
  await event({ type: "user", uuid: "tool-result", message: { content: [{ type: "tool_result" }] } });
  await event({ type: "system", subtype: "task_started", task_id: "task", task_type: "local_agent" });
  await event({ type: "result", subtype: "success", result: "Done", uuid: "done" });
  assert.equal((await f.provider.sessionState(f.context)).turn.active, true);
  await event({ type: "system", subtype: "task_notification", task_id: "task", status: "completed" });
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
});

test("Claude recovers exact admission and temporary history without resending after restart", async (t) => {
  const f = await fixture(t);
  const temporary = await f.provider.createConversation(f.context);
  await f.provider.startConversationTurn(f.context, { conversationId: temporary.conversationId, message: "Temporary", messageId: "temp" });
  await writeHistory(f, temporary.conversationId, [
    { type: "user", uuid: nativeMessageId("temp"), message: { content: "Temporary" } },
    { type: "assistant", uuid: "answer", message: { id: "answer", content: [{ type: "text", text: "Recovered" }] } }
  ]);
  const stopped = [];
  const restored = createClaudeSessionAgentProvider({ ...f.providerOptions,
    stopExecution: async (id) => { stopped.push(id); return { scopeEmpty: true }; } });
  const read = await restored.readConversation(f.context, { conversationId: temporary.conversationId, messageId: "temp" });
  assert.equal(read.text, "Recovered");
  assert.equal(read.admitted, true);
  assert.deepEqual(stopped, ["test-0"]);
  assert.equal(f.processes.length, 1);
  assert.equal((await restored.closeSession(f.context)).processExitProof.exited, true);
  await restored.deleteConversation(f.context, { conversationId: temporary.conversationId });
  assert.equal(Object.hasOwn(f.context.session.metadata, `claude_conversation_${temporary.conversationId}`), false);
  await assert.rejects(restored.readConversation(f.context, { conversationId: temporary.conversationId }), /unavailable/u);
});

test("Claude admission inspection uses the shared contract and native history prevents duplicate sends", async (t) => {
  const f = await fixture(t);
  const ready = await f.provider.ensureSession(f.context);
  await writeHistory(f, ready.thread.id, [{ type: "user", uuid: nativeMessageId("accepted"), message: { content: "accepted" } }]);
  const inspected = await f.provider.inspectMessageAdmission(f.context, { messageId: "accepted", threadId: ready.thread.id });
  assert.equal(inspected.admission, "accepted");
  assert.equal(inspected.turnId, nativeMessageId("accepted"));
  assert.equal((await f.provider.sendMessage(f.context, { message: "accepted", messageId: "accepted" })).duplicate, true);
  assert.equal(f.processes[0].lastInput, undefined);
});

test("Claude bounded helpers use the selected Haiku without tools or the project's command environment", async (t) => {
  const f = await fixture(t);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku" };
  const executionProfile = await f.provider.resolveExecutionProfile(f.context, { profileId: "economy", workloadId: "commit_title" });
  f.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", result: "Fix the title", uuid: "title" });
  const result = await f.provider.runDetachedChatTurn(f.context, { prompt: "Write a title", executionProfile });
  assert.equal(result.text, "Fix the title");
  assert.equal(result.executionProfile.model, "haiku");
  assert.equal(f.processes[0].options.toolFree, true);
  assert.equal(f.processes[0].options.workdir, f.root);
  assert.equal(f.written.length, 0);
  await f.provider.deleteConversation(f.context, { conversationId: result.conversationId });
});

test("Claude renewal uses the main native history and verifies the approved fresh-thread acknowledgement", async (t) => {
  const f = await fixture(t);
  const source = { authority: "github", ref: "refs/heads/main", commit: "a".repeat(40) };
  const handover = sessionRenewalManualHandoverTemplate({ source });
  const handoverHash = sessionRenewalHandoverHash(handover);
  f.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", result: handover, uuid: "handover" });
  const generated = await f.provider.generateSessionRenewalHandover(f.context, { operationId: "renew-one", source });
  assert.equal(generated.handoverHash, handoverHash);
  assert.equal(generated.processExitProof.exited, true);
  assert.equal(f.written.length, 0);
  const successor = await fixture(t);
  successor.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", uuid: "ack", structured_output: {
    schemaVersion: "vibe64.session-renewal-acknowledgement.v1", status: "ready", handoverHash, sourceCommit: source.commit, message: "Ready."
  } });
  const seeded = await successor.provider.seedSessionRenewalHandover(successor.context, {
    operationId: "renew-one", source, handover, handoverHash, forbiddenThreadId: generated.threadId
  });
  assert.equal(seeded.acknowledgement.status, "ready");
  assert.equal(seeded.freshThread, true);
  assert.equal(successor.context.session.metadata.agent_briefing_delivered, "yes");
  assert.equal(successor.processes[0].stopped, true);
  assert.equal(successor.written.length, 0);
});

test("Claude renewal failures allow the shared manual handover recovery without losing the old conversation", async (t) => {
  const f = await fixture(t);
  const source = { authority: "github", ref: "refs/heads/main", commit: "a".repeat(40) };
  const ready = await f.provider.ensureSession(f.context);
  f.behavior.afterSend = (native) => native.options.onEvent({
    type: "result", subtype: "error_during_execution", is_error: true,
    errors: ["Start a new session to continue."], uuid: "refused"
  });
  await assert.rejects(f.provider.generateSessionRenewalHandover(f.context, { operationId: "renew-refused", source }), {
    code: "vibe64_session_renewal_turn_failed"
  });
  assert.equal(f.processes[0].stopped, true);
  assert.equal(f.context.session.metadata.claude_conversation_id, ready.thread.id);
  assert.equal(f.written.length, 0);
});

test("Claude status reads native JSON and returns only public account details", async () => {
  const status = await readClaudeCodeAuthStatus({ credentialHome: { home: "/home/fixture" }, commandRunner: async (input) => {
    assert.deepEqual(input.args, ["auth", "status", "--json"]);
    assert.equal(input.timeout, 30_000);
    assert.equal(input.credentialHome.home, "/home/fixture");
    return { ok: true, stdout: JSON.stringify({ loggedIn: true, email: "owner@example.test", authMethod: "claude.ai", subscriptionType: "max", accessToken: "not-public" }) };
  } });
  assert.equal(status.loggedIn, true);
  assert.equal(status.email, "owner@example.test");
  assert.equal(JSON.stringify(status).includes("not-public"), false);
});

test("Claude signed-out JSON is normal while failed and malformed status responses stay errors", async () => {
  const readStatus = (result) => readClaudeCodeAuthStatus({
    credentialHome: { home: "/home/fixture" }, commandRunner: async () => result
  });
  const signedOut = { ok: false, exitCode: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }) };
  assert.deepEqual(await readStatus(signedOut), {
    loggedIn: false, email: "", authMethod: "none", subscriptionType: ""
  });
  for (const result of [
    { ...signedOut, timedOut: true },
    { ...signedOut, signal: "SIGTERM" },
    { ...signedOut, exitCode: 2 },
    { ...signedOut, stdout: JSON.stringify({ loggedIn: true, email: "owner@example.test" }) },
    { ...signedOut, stdout: "invalid" },
    { ok: true, stdout: "{}" },
    { ok: true, stdout: "null" }
  ]) {
    const status = await readStatus(result);
    assert.equal(status.loggedIn, false);
    assert.ok(status.error);
  }
});

test("Claude status shares concurrent reads and invalidates when native account files change", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "claude-auth-status-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configRoot = path.join(home, ".claude");
  await mkdir(configRoot);
  let calls = 0;
  let email = "first@example.test";
  const input = { env: { CLAUDE_CONFIG_DIR: configRoot }, credentialHome: { home }, commandRunner: async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, stdout: JSON.stringify({ loggedIn: true, email, authMethod: "claude.ai" }) };
  } };
  const statuses = await Promise.all(Array.from({ length: 8 }, () => readClaudeCodeAuthStatus(input)));
  assert.equal(calls, 1);
  assert.ok(statuses.every((status) => status.email === email));
  if (process.platform !== "darwin") {
    await readClaudeCodeAuthStatus(input);
    assert.equal(calls, 1);
  }
  for (const file of [path.join(configRoot, ".credentials.json"), path.join(home, ".claude.json"), path.join(configRoot, ".claude.json")]) {
    email = `${calls}@example.test`;
    // Deliberately not JSON: the wrapper must never parse native credentials.
    await writeFile(file, "native-account-changed");
    assert.equal((await readClaudeCodeAuthStatus(input)).email, email);
    await rm(file);
    const before = calls;
    await readClaudeCodeAuthStatus(input);
    assert.equal(calls, before + 1);
  }
});

test("Claude status failures do not poison later reads or share across credential homes", async () => {
  let calls = 0;
  const commandRunner = async () => {
    calls += 1;
    return calls === 1 ? { ok: false, error: "Temporary failure" }
      : { ok: true, stdout: JSON.stringify({ loggedIn: false }) };
  };
  const input = { env: {}, credentialHome: { home: "/home/fixture" }, commandRunner };
  assert.equal((await readClaudeCodeAuthStatus(input)).error, "Temporary failure");
  assert.equal((await readClaudeCodeAuthStatus(input)).error, undefined);
  assert.equal(calls, 2);
  await readClaudeCodeAuthStatus({ ...input, credentialHome: { home: "/home/another" } });
  assert.equal(calls, 3);
});


test("Claude account identity survives restart and prevents another account from resuming owned history", async (t) => {
  const f = await fixture(t);
  const original = await f.provider.describeProvider(f.context);
  await f.provider.sendMessage(f.context, { message: "Work", messageId: "owned" });
  await f.provider.closeSession(f.context);
  const restarted = createClaudeSessionAgentProvider(f.providerOptions);
  assert.equal((await restarted.describeProvider(f.context)).accountIdentitySignature, original.accountIdentitySignature);
  await restarted.sendMessage(f.context, { message: "Continue", messageId: "resume" });
  assert.equal(f.processes[1].options.resume, true);
  f.behavior.account = { ...f.behavior.account, email: "someone-else@example.test" };
  const changed = await restarted.describeProvider(f.context);
  assert.notEqual(changed.accountIdentitySignature, original.accountIdentitySignature);
  await assert.rejects(restarted.sendMessage(f.context, { message: "Other account", messageId: "other" }),
    (error) => error.code === "vibe64_claude_account_changed");
  assert.equal(f.processes[1].stopped, true);
  const changedRestart = createClaudeSessionAgentProvider(f.providerOptions);
  assert.equal((await changedRestart.describeProvider(f.context)).accountIdentitySignature, changed.accountIdentitySignature);
  await assert.rejects(changedRestart.sendMessage(f.context, { message: "Other account", messageId: "other" }),
    (error) => error.code === "vibe64_claude_account_changed");
  assert.equal(f.processes.length, 2);
});

test("Claude requires an authenticated account identity before starting a native conversation", async (t) => {
  const f = await fixture(t);
  f.behavior.account = { loggedIn: false };
  await assert.rejects(f.provider.sendMessage(f.context, { message: "Work" }),
    (error) => error.code === "vibe64_claude_account_required");
  assert.equal(f.processes.length, 0);
});


test("Claude plan usage retains real windows and never invents an allowance after reset", () => {
  assert.deepEqual(claudePlanUsage({ rate_limits_available: false }).windows, []);
  const usage = claudePlanUsage({ rate_limits_available: true, rate_limits: {
    five_hour: { utilization: 25, resets_at: "2099-01-01T00:00:00Z" },
    seven_day: { utilization: 100, resets_at: null },
    seven_day_sonnet: { utilization: 10, resets_at: "2000-01-01T00:00:00Z" },
    seven_day_opus: { utilization: null, resets_at: null }
  } });
  assert.equal(usage.status, "available");
  assert.deepEqual(usage.windows.map(({ id, remainingPercent }) => ({ id, remainingPercent })), [
    { id: "five_hour", remainingPercent: 75 }, { id: "seven_day", remainingPercent: 0 }
  ]);
});

test("Claude changes model and effort through native controls without restarting the conversation", async (t) => {
  const f = await fixture(t);
  const first = await f.provider.ensureSession(f.context);
  const native = f.processes[0];
  const requests = [];
  native.client.request = async (request) => { requests.push(request); return {}; };
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku", variantId: "" };
  const second = await f.provider.ensureSession(f.context);
  assert.equal(second.thread.id, first.thread.id);
  assert.deepEqual(requests.map(({ subtype }) => subtype), ["apply_flag_settings", "set_model"]);
  assert.equal(requests[0].settings.effortLevel, null);
  assert.deepEqual(requests[1], { subtype: "set_model", model: "haiku" });
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "sonnet", variantId: "low" };
  await f.provider.ensureSession(f.context);
  assert.equal(requests.at(-2).settings.effortLevel, "low");
  assert.equal(f.processes.length, 1);
  assert.equal(native.stopped, false);
  await f.provider.sendMessage(f.context, { message: "Continue", messageId: "switched" });
  assert.equal(f.processes.length, 1);
  assert.equal(requests.length, 4);
});

test("Claude retires a process when its settings change is only partially accepted", async (t) => {
  const f = await fixture(t);
  await f.provider.ensureSession(f.context);
  const native = f.processes[0];
  native.client.request = async (request) => {
    if (request.subtype === "apply_flag_settings") throw new Error("Settings rejected");
    return {};
  };
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku", variantId: "" };
  await assert.rejects(f.provider.ensureSession(f.context), /Settings rejected/u);
  assert.equal(native.stopped, true);
  await f.provider.sendMessage(f.context, { message: "Retry", messageId: "retry-settings" });
  assert.equal(f.processes.length, 2);
  assert.equal(f.processes[1].options.model, "haiku");
});

test("Claude reads account capabilities and allowance through an already owned process", async (t) => {
  const f = await fixture(t);
  await f.provider.ensureSession(f.context);
  const native = f.processes[0];
  native.client.request = async (request) => {
    assert.equal(request.subtype, "get_usage");
    return { rate_limits_available: true, rate_limits: { seven_day: { utilization: 25 } } };
  };
  assert.equal((await f.provider.capabilities(f.context)).modelProviders[0].models.length, 2);
  assert.equal((await f.provider.readPlanUsage(f.context)).windows[0].remainingPercent, 75);
  assert.equal(f.processes.length, 1);
  assert.equal(native.stopped, false);
  await f.provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" });
  assert.equal(native.stopped, true);
});

test("Claude retains failed catalog cleanup and retries it before another query or account change", async (t) => {
  const f = await fixture(t);
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    createProcess: async (options) => {
      const native = await f.providerOptions.createProcess(options);
      native.stopAllowed = false;
      return native;
    }
  });
  await assert.rejects(provider.capabilities(f.context), /could not be stopped|cleanup could not be confirmed/u);
  await assert.rejects(provider.capabilities(f.context), /could not be stopped|cleanup could not be confirmed/u);
  assert.equal(f.processes.length, 1);
  f.processes[0].stopAllowed = true;
  assert.equal((await provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" })).ok, true);
  assert.equal(f.processes[0].stopped, true);
});

test("A failed Claude usage request still cleans up before an account change", async (t) => {
  const f = await fixture(t);
  const requested = Promise.withResolvers();
  const response = Promise.withResolvers();
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    createProcess: async (options) => {
      const native = await f.providerOptions.createProcess(options);
      native.client.request = async () => { requested.resolve(); return response.promise; };
      return native;
    }
  });
  const usage = provider.readPlanUsage(f.context);
  const rejectedUsage = assert.rejects(usage, /Native usage unavailable/u);
  await requested.promise;
  const retired = provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" });
  response.reject(new Error("Native usage unavailable"));
  await rejectedUsage;
  assert.equal((await retired).ok, true);
  assert.equal(f.processes[0].stopped, true);
});

test("Claude goals use native commands, preserve the goal on pause and reject stale actions", async (t) => {
  const f = await fixture(t);
  let timestamp = Date.now();
  f.behavior.afterSend = async (native, message) => {
    const directory = path.join(f.root, "config", "projects", native.options.workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
    await mkdir(directory, { recursive: true });
    const condition = message.slice(6);
    await writeFile(path.join(directory, `${native.options.sessionId}.jsonl`), `${JSON.stringify({
      type: "attachment", timestamp: new Date(timestamp++).toISOString(),
      attachment: { type: "goal_status", condition: condition === "clear" ? "Tests pass" : condition, sentinel: true, met: condition === "clear" }
    })}\n`);
    if (condition === "clear") await native.options.onEvent({ type: "result", subtype: "success", result: "" });
  };
  const started = await f.provider.updateGoal(f.context, { action: "set", objective: "Tests pass" });
  assert.equal(f.processes[0].lastInput.message, "/goal Tests pass");
  assert.equal(started.goal.status, "active");
  const action = { threadId: started.threadId, objective: started.goal.objective, createdAt: started.goal.createdAt };
  await assert.rejects(f.provider.updateGoal(f.context, { ...action, action: "pause", createdAt: -1 }), /goal changed/u);
  const paused = await f.provider.updateGoal(f.context, { ...action, action: "pause" });
  assert.equal(f.processes[0].stopped, true);
  assert.equal(paused.goal.status, "paused");
  const resumed = await f.provider.updateGoal(f.context, { ...action, action: "resume" });
  assert.equal(f.processes[1].options.resume, true);
  assert.equal(resumed.goal.status, "active");
  const cancelled = await f.provider.updateGoal(f.context, { action: "cancel", threadId: resumed.threadId,
    objective: resumed.goal.objective, createdAt: resumed.goal.createdAt });
  assert.equal(cancelled.goal, null);
  assert.equal(f.processes.at(-1).lastInput.message, "/goal clear");
  await assert.rejects(f.provider.updateGoal(f.context, { action: "set", objective: "Tests pass", tokenBudget: 100 }), /token budget/u);
});


test("Claude economy choices apply to new tasks without changing an already resolved task", async (t) => {
  const f = await fixture(t);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "sonnet" };
  const selected = await f.provider.resolveExecutionProfile(f.context, { profileId: "economy", workloadId: "commit_title" });
  assert.equal(selected.model, "sonnet");
  assert.equal(selected.thinking, "low");
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku" };
  assert.equal((await f.provider.resolveExecutionProfile(f.context, { profileId: "economy", workloadId: "commit_title" })).model, "haiku");
  f.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", result: "Title", uuid: "title" });
  await f.provider.runDetachedChatTurn(f.context, { prompt: "Write a title", executionProfile: selected });
  assert.equal(f.processes.at(-1).options.model, "sonnet");
  assert.equal(f.processes.at(-1).options.toolFree, true);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "unavailable" };
  await assert.rejects(f.provider.resolveExecutionProfile(f.context, { profileId: "economy", workloadId: "commit_title" }), /helper model is unavailable/u);
});


test("Claude conversation rewind selects the retained native branch across retries and new replies", async (t) => {
  const f = await fixture(t);
  const ready = await f.provider.ensureSession(f.context);
  for (const messageId of ["first", "second"]) {
    await f.provider.sendMessage(f.context, { message: messageId, messageId });
    await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Done." });
  }
  const events = [];
  f.context.runtime.store.writeAgentRunEvent = async (_id, _run, { event, patch }) => {
    events.push(event.kind);
    return patch;
  };
  const first = nativeMessageId("first");
  const second = nativeMessageId("second");
  const frames = [
    { type: "user", uuid: first, parentUuid: null, message: { content: "First" } },
    { type: "assistant", uuid: "answer-1", parentUuid: first, message: { content: [{ type: "text", text: "Retained" }] } },
    { type: "user", uuid: second, parentUuid: "answer-1", message: { content: "Second" } },
    { type: "assistant", uuid: "answer-2", parentUuid: second, message: { content: [{ type: "text", text: "Discarded" }] } }
  ];
  await writeHistory(f, ready.thread.id, frames);
  let controls = 0;
  f.processes[0].client.request = async (request) => {
    assert.deepEqual(request, { subtype: "rewind_conversation", target_message_uuid: second });
    await f.processes[0].options.onEvent({ type: "system", subtype: "status" });
    controls += 1;
    frames.push({ type: "last-prompt", leafUuid: "answer-1", explicit: true, rewound: true });
    await writeHistory(f, ready.thread.id, frames);
    throw new Error("reply lost after native rewind");
  };
  const plan = await f.provider.rewindConversation(f.context, { messageId: "second", previousMessageId: "first" });
  await assert.rejects(f.provider.rewindConversation(f.context, plan), /reply lost/);
  await f.provider.rewindConversation(f.context, plan);
  assert.equal(controls, 1);
  assert.deepEqual(events, ["conversation-rewound"], "Undo must not publish a turn completion that triggers workspace setup");
  let history = await readClaudeHistory({ configRoot: path.join(f.root, "config"), workdir: f.context.session.metadata.source_path, conversationId: ready.thread.id });
  assert.deepEqual(history.userIds, [first]);
  assert.deepEqual(history.messages.map((message) => message.text), ["Retained"]);
  frames.push(
    { type: "user", uuid: nativeMessageId("replacement"), parentUuid: "answer-1", message: { content: "Replacement" } },
    { type: "assistant", uuid: "answer-3", parentUuid: nativeMessageId("replacement"), message: { content: [{ type: "text", text: "New branch" }] } }
  );
  await writeHistory(f, ready.thread.id, frames);
  history = await readClaudeHistory({ configRoot: path.join(f.root, "config"), workdir: f.context.session.metadata.source_path, conversationId: ready.thread.id });
  assert.deepEqual(history.messages.map((message) => message.text), ["Retained", "New branch"]);
  await assert.rejects(f.provider.rewindConversation(f.context, plan), /last turn no longer matches/);
});


test("temporary Claude accepts active-turn steering in its existing native conversation", async (t) => {
  const f = await fixture(t);
  const { conversationId } = await f.provider.createConversation(f.context, { persistent: true });
  const first = await f.provider.startConversationTurn(f.context, { conversationId, persistent: true, message: "Investigate", messageId: "first" });
  const guided = await f.provider.startConversationTurn(f.context, { conversationId, persistent: true, steer: true, message: "Read logs first", messageId: "guidance" });
  assert.equal(guided.ok, true);
  assert.equal(guided.runId, first.runId);
  assert.equal(f.processes.length, 1);
  assert.equal(f.processes[0].lastInput.message, "Read logs first");
  assert.equal(f.written.length, 0, "temporary steering stays out of main History");
  await f.provider.stopConversation(f.context, { conversationId });
});


test("Claude shared API access requires native verification and reports connection identity without inference", async (t) => {
  const f = await fixture(t);
  const native = await f.provider.assistantAccess(f.context);
  assert.equal(native.ownerOnly, true);
  assert.equal(native.available, true);
  assert.match(native.connectionIdentity, /^sha256:[a-f0-9]{64}$/);
  f.behavior.account.email = "different@example.test";
  assert.notEqual((await f.provider.assistantAccess(f.context)).connectionIdentity, native.connectionIdentity);
  for (const providerId of ["deepseek", "zai-coding-plan"]) {
    const root = path.join(f.providerOptions.systemRoot, "ai-connections", "codex", providerId);
    await mkdir(path.join(root, "auth", "codex"), { recursive: true });
    await writeFile(path.join(root, "connection.json"), JSON.stringify({ apiKey: "private-key", claudeReady: false }));
    await writeFile(path.join(root, "auth", "codex", "status.json"), JSON.stringify({ connected: true, generation: "fixture-generation" }));
    const context = { ...f.context, assistantSelection: { ...f.context.assistantSelection, modelProviderId: providerId } };
    const unchecked = await f.provider.assistantAccess(context);
    assert.equal(unchecked.available, false, "Codex key verification does not prove the Claude endpoint works");
    assert.equal(unchecked.ownerOnly, providerId !== "deepseek");
    await writeFile(path.join(root, "connection.json"), JSON.stringify({ apiKey: "private-key", claudeReady: true }));
    const verified = await f.provider.assistantAccess(context);
    assert.equal(verified.available, true);
    assert.equal(verified.connectionIdentity, `curated:${providerId}:fixture-generation`);
    assert.doesNotMatch(JSON.stringify(verified), /private-key/);
    const catalog = await f.provider.capabilities(context, { modelProviderId: providerId });
    assert.equal(catalog.modelProviders.find(({ id }) => id === providerId).connected, true);
  }
  assert.equal(f.processes.length, 0, "access facts and external catalogues do not start an inference process");
});

test("scoped Claude helpers use the resolved model and can stop while main chat continues", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Main task", messageId: "main-task" });
  const main = f.processes[0];
  const original = structuredClone(f.context.session);
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "router_job",
    assistantScope: { id: "router_job", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "helper-runtime"),
      stableContext: "Classify only the supplied text." } };
  const executionProfile = await f.provider.resolveExecutionProfile(context, { profileId: "economy", workloadId: "request_routing" });
  assert.equal(executionProfile.model, f.context.assistantSelection.modelId);
  assert.equal(executionProfile.thinking, "low");
  const { conversationId } = await f.provider.createConversation(context, { ephemeral: true, executionProfile });
  await f.provider.startConversationTurn(context, { conversationId, executionProfile, message: "Classify", messageId: "helper-turn" });
  const helper = f.processes.at(-1);
  assert.notEqual(helper, main);
  assert.equal(helper.options.toolFree, true);
  assert.equal(helper.options.model, executionProfile.model);
  assert.equal(helper.options.effort, "low");
  assert.equal(helper.options.systemPrompt, context.assistantScope.stableContext);
  assert.equal(helper.options.appendSystemPrompt, undefined);
  await f.provider.stopConversation(context, { conversationId });
  assert.equal(helper.stopped, true);
  assert.equal(main.stopped, false);
  await f.provider.deleteConversation(context, { conversationId });
  assert.deepEqual(f.context.session, original);
  const continued = await f.provider.sendMessage(f.context, { message: "Continue main", messageId: "main-steer", steer: true });
  assert.equal(continued.ok, true);
  assert.equal(main.lastInput.message, "Continue main");
});

test("Claude changes provider controls before model and keeps the native conversation", async (t) => {
  const f = await fixture(t);
  const home = path.join(f.providerOptions.systemRoot, "ai-connections", "codex", "deepseek");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "connection.json"), JSON.stringify({ apiKey: "fixture-deepseek-secret", claudeReady: true }));
  const first = await f.provider.sendMessage(f.context, { message: "Plan this", messageId: "plan" });
  const native = f.processes[0];
  await native.options.onEvent({ type: "result", subtype: "success", result: "Agreed." });
  f.context.assistantSelection = { ...f.context.assistantSelection, modelProviderId: "deepseek", modelId: "deepseek-flash" };
  const second = await f.provider.sendMessage(f.context, { message: "Implement it", messageId: "code" });
  assert.equal(second.thread.id, first.thread.id);
  assert.equal(f.processes.length, 1);
  assert.deepEqual(native.requests.slice(-2).map(({ subtype }) => subtype), ["apply_flag_settings", "set_model"]);
  const flags = native.requests.at(-2).settings;
  assert.equal(flags.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
  assert.equal(flags.env.ANTHROPIC_AUTH_TOKEN, "fixture-deepseek-secret");
  assert.ok(flags.hooks.PreToolUse.length);
  assert.deepEqual(flags.fallbackModel, []);
  assert.ok(!JSON.stringify(native.options.env).includes("fixture-deepseek-secret"));
  await native.options.onEvent({ type: "result", subtype: "success", result: "Implemented." });
  f.context.assistantSelection = { ...f.context.assistantSelection, modelProviderId: "anthropic", modelId: "sonnet" };
  await f.provider.sendMessage(f.context, { message: "Review it", messageId: "review" });
  assert.equal(native.requests.at(-2).settings.env.ANTHROPIC_AUTH_TOKEN, "");
  assert.equal(native.requests.at(-2).settings.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com");
  assert.equal(f.processes.length, 1);
});

test("Claude does not send when a provider-settings acknowledgement fails", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "First", messageId: "first" });
  const native = f.processes[0];
  await native.options.onEvent({ type: "result", subtype: "success", result: "Done." });
  native.client.request = async () => { throw new Error("Settings rejected"); };
  f.context.assistantSelection = { ...f.context.assistantSelection, variantId: "low" };
  await assert.rejects(f.provider.sendMessage(f.context, { message: "Second", messageId: "second" }), /Settings rejected/);
  assert.equal(native.lastInput.messageId, nativeMessageId("first"));
  assert.equal(native.stopped, true);
});

test("scoped Claude helper cleanup recovers the captured managed process after restart", async (t) => {
  const f = await fixture(t);
  let captured;
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions, async createProcess(options) {
    const native = await f.providerOptions.createProcess(options);
    await options.onStarted?.(native.executionId);
    return native;
  } });
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "router_cleanup",
    assistantScope: { id: "router_cleanup", environment: {}, workdir: path.join(f.root, "work"), runtimeRoot: path.join(f.root, "runtime"),
      stableContext: "Classify only the supplied text." },
    async onEvent(event) { if (event.type === "helper-execution") captured = event; } };
  const executionProfile = await provider.resolveExecutionProfile(context, { profileId: "economy", workloadId: "request_routing" });
  const created = await provider.createConversation(context, { ephemeral: true, executionProfile });
  await provider.startConversationTurn(context, { conversationId: created.conversationId, executionProfile, message: "Classify", messageId: "helper-turn" });
  assert.equal(captured.conversationId, created.conversationId);
  assert.equal(captured.executionId, f.processes.at(-1).executionId);
  const stopped = [];
  let confirmStop = false;
  const restarted = createClaudeSessionAgentProvider({ ...f.providerOptions, async stopExecution(id) {
    stopped.push(id);
    return { scopeEmpty: confirmStop };
  } });
  const input = { conversationId: captured.conversationId, cleanupExecutionId: captured.executionId };
  await assert.rejects(restarted.deleteConversation(context, input), /exit has not been confirmed/);
  confirmStop = true;
  assert.equal((await restarted.deleteConversation(context, input)).deleted, true);
  assert.deepEqual(stopped, [captured.executionId, captured.executionId]);
  assert.equal(f.context.session.metadata[`claude_conversation_${captured.conversationId}`], undefined);
});
