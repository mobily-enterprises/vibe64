import assert from "node:assert/strict";
import { Readable, Duplex } from "node:stream";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClaudeJsonClient, readClaudeJsonFrames } from "../../packages/vibe64-runtime/src/server/claudeStreamJson.js";
import { claudeCodeArguments, createClaudeCodeProcess } from "../../packages/vibe64-terminals/src/server/claudeCodeProcess.js";
import { claudeCapabilities, claudePlanUsage, createClaudeSessionAgentProvider, nativeMessageId } from "../../packages/vibe64-terminals/src/server/agent/providers/claudeSessionAgentProvider.js";
import { sessionRenewalManualHandoverTemplate, sessionRenewalHandoverHash } from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";
import { createNativeHelperModelStore } from "../../packages/vibe64-core/src/server/nativeHelperModel.js";
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
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(observed, [1, 2]);
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
  const session = { sessionId: "test", sessionRoot: path.join(root, "state"), metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: workdir, assistant_selection: JSON.stringify(selection) } };
  const written = [];
  const store = {
    async mutateSession(_id, operation) { return operation(); },
    async writeMetadataValue(_id, key, value) { session.metadata[key] = value; },
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
    accountStatus: async () => behavior.account,
    credentialHome: { home: root }, recordGitActor: async () => ({ ok: true }), connectionStatus: async () => true,
    createProcess: async (options) => {
      const native = { options, executionId: `test-${processes.length}`, stopped: false, stopAllowed: true,
        initialization: { models: [{ value: "sonnet", supportedEffortLevels: ["low", "high"] }, { value: "haiku", supportedEffortLevels: [] }] },
        async stop() { this.stopped = this.stopAllowed; return { exited: this.stopped, scopeEmpty: this.stopped }; },
        client: { interrupt: async () => {
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
  return { provider, providerOptions, behavior, context, processes, written, root };
}

test("Claude provider admits prompts in order, steers, projects thinking and text, and deduplicates sends", async (t) => {
  const f = await fixture(t);
  const sent = await f.provider.sendMessage(f.context, { message: "First", messageId: "first" });
  assert.equal(sent.delivered, true);
  assert.equal(f.processes[0].lastInput.message, "Context: First");
  const steered = await f.provider.sendMessage(f.context, { message: "Change direction", messageId: "second" });
  assert.equal(steered.deliveryMode, "steer");
  assert.equal(f.processes.length, 1);
  await f.processes[0].options.onEvent({ type: "assistant", message: { id: "answer", content: [
    { type: "thinking", thinking: "Exposed thinking summary." }, { type: "text", text: "Done." }
  ] } });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Done.", uuid: "result" });
  assert.deepEqual(f.written.map((message) => message.role), ["user", "user", "thinking", "assistant"]);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  assert.equal((await f.provider.sendMessage(f.context, { message: "First", messageId: "first" })).duplicate, true);
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
  await assert.rejects(restored.readConversation(f.context, { conversationId: temporary.conversationId }), /unavailable/u);
});

test("Claude admission inspection uses the shared contract and native history prevents duplicate sends", async (t) => {
  const f = await fixture(t);
  const ready = await f.provider.ensureSession(f.context);
  await writeHistory(f, ready.thread.id, [{ type: "user", uuid: nativeMessageId("accepted"), message: { content: "accepted" } }]);
  const inspected = await f.provider.inspectMessageAdmission(f.context, { messageId: "accepted", threadId: ready.thread.id });
  assert.equal(inspected.admission, "accepted");
  assert.equal((await f.provider.sendMessage(f.context, { message: "accepted", messageId: "accepted" })).duplicate, true);
  assert.equal(f.processes[0].lastInput, undefined);
});

test("Claude bounded helpers use Haiku without tools or the project's command environment", async (t) => {
  const f = await fixture(t);
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

test("Claude status reads native JSON and returns only public account details", async () => {
  const status = await readClaudeCodeAuthStatus({ credentialHome: { home: "/home/fixture" }, commandRunner: async (input) => {
    assert.deepEqual(input.args, ["auth", "status", "--json"]);
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
  const store = createNativeHelperModelStore({ systemRoot: f.providerOptions.systemRoot, providerId: "claude" });
  await store.write("sonnet");
  const selected = await f.provider.resolveExecutionProfile(f.context, { profileId: "economy", workloadId: "commit_title" });
  assert.equal(selected.model, "sonnet");
  assert.equal(selected.thinking, "low");
  await store.write("");
  assert.equal((await f.provider.resolveExecutionProfile(f.context, { profileId: "economy", workloadId: "commit_title" })).model, "haiku");
  f.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", result: "Title", uuid: "title" });
  await f.provider.runDetachedChatTurn(f.context, { prompt: "Write a title", executionProfile: selected });
  assert.equal(f.processes.at(-1).options.model, "sonnet");
  assert.equal(f.processes.at(-1).options.toolFree, true);
  await store.write("unavailable");
  await assert.rejects(f.provider.resolveExecutionProfile(f.context, { profileId: "economy", workloadId: "commit_title" }), /helper model is unavailable/u);
});
