import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  cleanupSessionSaveCommitMessage,
  generateSessionSaveCommitMessage,
  normalizeSessionSaveCommitMessage,
  sessionSaveCommitMessagePrompt
} from "../../packages/vibe64-terminals/src/server/sessionSaveCommitMessage.js";

const catalogRevision = `sha256:${"a".repeat(64)}`;

function resolvedEconomyProfile(workloadId = "commit_title") {
  return {
    limits: {
      maxInputCharacters: 20_000,
      maxOutputCharacters: 200,
      timeoutMs: 30_000
    },
    model: "gpt-5.6-luna",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: "economy",
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId
  };
}

test("commit-message prompt is bounded, specific, and contains only change facts", () => {
  const prompt = sessionSaveCommitMessagePrompt({
    files: Array.from({ length: 45 }, (_, index) => ({
      added: index + 1,
      deleted: index,
      path: `packages/feature-${index}/src/service.js`,
      status: "M"
    })),
    totalCount: 45
  });
  assert.match(prompt, /Changed files: 45/u);
  assert.match(prompt, /M: packages\/feature-0\/src\/service\.js \(\+1 -0\)/u);
  assert.match(prompt, /…and 5 more changed files/u);
  assert.doesNotMatch(prompt, /feature-44/u);
  assert.match(prompt, /do not use tools/iu);
});

async function namingFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routed-naming-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selection = { engineId: "opencode", modelProviderId: "deepseek", modelId: "deepseek-flash", agentId: "build", variantId: "", catalogRevision };
  const calls = [];
  const task = { status: "running", operationId: "save-1" };
  const actor = { role: "member", username: "ada" };
  const context = { vibe64User: actor, session: { sessionId: "session-1", metadata: {
    assistant_selection: JSON.stringify({ ...selection, engineId: "codex", agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra" })
  } }, runtime: { stateRoot: root, store: {
    async readBackgroundTask(sessionId, taskId) { assert.equal(sessionId, "session-1"); assert.equal(taskId, "save-work"); return structuredClone(task); },
    async writeBackgroundTaskEvent(_sessionId, _taskId, { patch }) { Object.assign(task, structuredClone(patch)); }
  } } };
  const profile = { ...resolvedEconomyProfile(), model: selection.modelId, providerId: selection.engineId };
  const agent = {
    async resolveAssistantPurpose(input, options) {
      calls.push("resolve");
      assert.deepEqual(input, { purpose: "commit_title", workflowEngineId: "codex" });
      assert.equal(options.vibe64User, actor);
      return { available: true, effectiveSelection: selection, connectionIdentity: "shared-key-generation-1" };
    },
    async resolveEphemeralExecutionProfile(scope, input, options) {
      calls.push("profile");
      assert.deepEqual(input, { profileId: "economy", workloadId: "commit_title" });
      assert.deepEqual(options.assistantSelection, selection);
      assert.equal(options.expectedConnectionIdentity, "shared-key-generation-1");
      assert.equal(task.assistantHelper.scope.id, scope.id, "ownership precedes provider setup");
      return profile;
    },
    async runEphemeralChatTurn(scope, input, options) {
      calls.push("run");
      assert.equal(input.executionProfile, profile);
      assert.match(input.prompt, /Changed files/u);
      assert.deepEqual(input.outputSchema.required, ["subject"]);
      assert.equal(options.session, undefined);
      await options.onEvent({ type: "helper-execution", executionId: "managed-helper-1" });
      await options.onEvent({ type: "thread", threadId: "native-helper-1" });
      await options.onEvent({ type: "turn", turnId: "native-turn-1" });
      assert.equal(task.assistantHelper.conversationId, "native-helper-1");
      assert.equal(task.assistantHelper.runId, "native-turn-1");
      return { ok: true, text: '{"subject":"Improve booking availability rules"}', executionProfile: profile };
    },
    async deleteEphemeralConversation(scope, input, options) {
      calls.push("delete");
      assert.deepEqual(scope, task.assistantHelper.scope);
      assert.deepEqual(options.assistantSelection, task.assistantHelper.selection);
      assert.equal(input.cleanupExecutionId, task.assistantHelper.executionId);
      return { ok: true };
    }
  };
  return { agent, calls, context, profile, task, run: () => generateSessionSaveCommitMessage({ agent, agentContext: context, changes: {} }) };
}

test("Save naming resolves shared Economy for a member with personal main chat and cleans its own scope", async (t) => {
  const f = await namingFixture(t);
  const result = await f.run();
  assert.equal(result.subject, "Improve booking availability rules");
  assert.deepEqual(result.executionProfile, f.profile);
  assert.deepEqual(f.calls, ["resolve", "profile", "run", "delete"]);
  assert.equal(f.task.assistantHelper, null);
  assert.equal(f.task.operationId, "save-1");
  assert.equal(JSON.parse(f.context.session.metadata.assistant_selection).modelId, "gpt-6-astra");
});

test("Save naming refuses unavailable Economy without starting a provider", async (t) => {
  const f = await namingFixture(t);
  f.agent.resolveAssistantPurpose = async () => ({ available: false, reasonCode: "helper_review_required", message: "Review Economy first." });
  await assert.rejects(f.run(), { code: "helper_review_required" });
  assert.deepEqual(f.calls, []);
  assert.equal(f.task.assistantHelper, undefined);
});

test("Save retains failed cleanup and retries it before resolving or starting another naming helper", async (t) => {
  const f = await namingFixture(t);
  const cleanup = f.agent.deleteEphemeralConversation;
  f.agent.deleteEphemeralConversation = async () => ({ ok: false, code: "cleanup_failed", error: "Retry cleanup." });
  await assert.rejects(f.run(), { code: "cleanup_failed" });
  const helper = structuredClone(f.task.assistantHelper);
  assert.equal(helper.conversationId, "native-helper-1");
  assert.equal(helper.executionId, "managed-helper-1");
  await access(helper.scope.runtimeRoot);
  f.calls.length = 0;
  await assert.rejects(f.run(), { code: "cleanup_failed" });
  assert.deepEqual(f.calls, [], "failed existing cleanup blocks new inference");
  f.agent.deleteEphemeralConversation = cleanup;
  await cleanupSessionSaveCommitMessage({ agent: f.agent, agentContext: f.context });
  assert.deepEqual(f.calls, ["delete"], "session close can recover ownership without resolving another model");
  assert.equal(f.task.assistantHelper, null);
  await assert.rejects(access(helper.scope.runtimeRoot), { code: "ENOENT" });
  await f.run();
});

test("Save naming cleans an empty failed scope and retains cleanup failure ahead of the inference error", async (t) => {
  const f = await namingFixture(t);
  f.agent.resolveEphemeralExecutionProfile = async () => { throw Object.assign(new Error("Connection changed."), { code: "connection_changed" }); };
  const cleanup = f.agent.deleteEphemeralConversation;
  await assert.rejects(f.run(), { code: "connection_changed" });
  assert.equal(f.task.assistantHelper, null);
  f.agent.deleteEphemeralConversation = async () => ({ ok: false, code: "cleanup_failed" });
  await assert.rejects(f.run(), (error) => error.code === "cleanup_failed" && error.cause?.code === "connection_changed");
  assert.equal(f.task.assistantHelper.conversationId, "");
  f.agent.deleteEphemeralConversation = cleanup;
  await assert.rejects(f.run(), { code: "connection_changed" });
  assert.equal(f.task.assistantHelper, null);
});

test("invalid or unverified naming responses are rejected after confirmed cleanup", async (t) => {
  const f = await namingFixture(t);
  assert.throws(() => normalizeSessionSaveCommitMessage("Save Vibe64 work"), { code: "vibe64_session_save_message_generic" });
  assert.throws(() => normalizeSessionSaveCommitMessage("A title\nwith a body"), { code: "vibe64_session_save_message_invalid" });
  for (const [result, code] of [
    [{ ok: false, code: "provider_failed", error: "Provider failed." }, "provider_failed"],
    [{ ok: true, text: '{"subject":"Improve search"}' }, "vibe64_session_save_message_execution_profile_missing"],
    [{ ok: true, executionProfile: f.profile, text: '{"extra":true,"subject":"Improve search"}' }, "vibe64_session_save_message_invalid"]
  ]) {
    f.agent.runEphemeralChatTurn = async (_scope, _input, options) => { await options.onEvent({ type: "thread", threadId: "rejected" }); return result; };
    await assert.rejects(f.run(), { code });
    assert.equal(f.task.assistantHelper, null);
  }
});

test("Save keeps cleanup paths usable when clearing durable helper ownership fails", async (t) => {
  const f = await namingFixture(t);
  const store = f.context.runtime.store;
  const write = store.writeBackgroundTaskEvent;
  store.writeBackgroundTaskEvent = async (sessionId, taskId, event) => {
    if (event.patch.assistantHelper === null) throw new Error("Task write failed.");
    return write(sessionId, taskId, event);
  };
  await assert.rejects(f.run(), /Task write failed/u);
  const scope = f.task.assistantHelper.scope;
  await access(scope.workdir);
  await access(scope.runtimeRoot);
  store.writeBackgroundTaskEvent = write;
  await cleanupSessionSaveCommitMessage({ agent: f.agent, agentContext: f.context });
  assert.equal(f.task.assistantHelper, null);
  await assert.rejects(access(scope.runtimeRoot), { code: "ENOENT" });
});
