import assert from "node:assert/strict";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { prepareVibe64DevelopmentCopy } from "../../packages/vibe64-runtime/src/server/prepareDevelopmentCopy.js";
import { prepareCopiedClaudeConversationState, prepareCopiedScopedClaudeConversations } from "../../packages/vibe64-terminals/src/server/claudeConversationStorage.js";
import { prepareCopiedSessionConversation } from "../../packages/vibe64-terminals/src/server/sessionConversations.js";
import { prepareCopiedColleagueConversation } from "../../packages/vibe64-colleague/src/server/conversationRecord.js";
import { prepareCopiedAssistantRouting } from "../../packages/vibe64-terminals/src/server/assistantRouting.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("offline workflow preparation preserves uncertain delivery while stopping scheduling and parent helpers", () => {
  const request = { schemaVersion: 5, status: "working", delivery: "uncertain", attemptedMessageId: "pending",
    input: { message: "Retain this request" }, helper: { executionId: "parent", conversationId: "native-helper" } };
  const goal = { status: "active", objective: "Retain the goal", selection: { modelId: "original" } };
  const metadata = { assistant_routing_request: JSON.stringify(request), assistant_routing_goal: JSON.stringify(goal),
    assistant_goal_intent: JSON.stringify({ version: 1, id: "parent", active: true }) };
  const before = structuredClone(metadata);
  const copy = prepareCopiedAssistantRouting(metadata);
  const saved = JSON.parse(copy.assistant_routing_request);
  assert.equal(saved.status, "waiting");
  assert.equal(saved.stopped, true);
  assert.equal(saved.delivery, "uncertain");
  assert.equal(saved.attemptedMessageId, "pending");
  assert.deepEqual(saved.input, request.input);
  assert.deepEqual(saved.helper, { executionId: "", conversationId: "native-helper" });
  assert.deepEqual(JSON.parse(copy.assistant_routing_goal), { ...goal, status: "paused" });
  assert.equal(copy.assistant_goal_intent, "null", "a disposable copy cannot resume its parent’s active goal");
  assert.deepEqual(metadata, before);
  assert.throws(() => prepareCopiedAssistantRouting({ assistant_routing_request: JSON.stringify({ ...request, schemaVersion: 4 }) }), /upgrade/u);
});

test("offline scoped Claude preparation preserves native identity and never follows a parent alias", async () => {
  await withTemporaryRoot(async root => {
    const parent = path.join(root, "parent");
    const guest = path.join(root, "guest");
    const receipt = "colleague/owner/summary/runtime/claude-conversations/chat/native.json";
    await mkdir(path.dirname(path.join(parent, receipt)), { recursive: true });
    const serialized = JSON.stringify({ schemaVersion: 1, executionId: "parent-execution", state: "active",
      turnId: "native-turn", accountIdentity: "account", persistent: true });
    await writeFile(path.join(parent, receipt), serialized);
    await cp(parent, guest, { recursive: true });
    await symlink(parent, path.join(guest, "parent-alias"));
    assert.equal(await prepareCopiedScopedClaudeConversations(guest), 1);
    assert.deepEqual(JSON.parse(await readFile(path.join(guest, receipt), "utf8")), {
      ...JSON.parse(serialized), executionId: "", state: "interrupted"
    });
    assert.equal(await readFile(path.join(parent, receipt), "utf8"), serialized);
  });
});

test("copied Colleague retains chat history but cannot restart watches or assignments", async () => {
  const at = "2026-10-15T00:00:00.000Z";
  const original = { schemaVersion: 3, scopeId: "colleague_one", runtimeId: "owner", previousConversations: [],
    status: "working", conversationMetadata: { runtime: { version: 3, engine: "api", segmentId: "current",
      configuration: {}, predecessors: [], seen: {}, lastEngine: "api" } },
    conversationLog: [{ turnId: "000001", metadata: { runtime: { status: "running", engine: "api", segmentId: "current" } },
      messages: [{ role: "user", text: "Retained request", messageId: "request", at }] }],
    summaryHelper: { executionId: "parent-helper", conversationId: "retained-helper" },
    watches: [{ watchId: "one", status: "active" }, { watchId: "two", status: "pending" }],
    assignments: [{ assignmentId: "task", status: "waiting", turns: [] }], observations: [{ id: "queued", watchId: "two" }]
  };
  const before = structuredClone(original);
  const copy = await prepareCopiedColleagueConversation(original, "owner", { at });
  assert.deepEqual(original, before);
  assert.equal(copy.status, "interrupted");
  assert.deepEqual(copy.summaryHelper, { executionId: "", conversationId: "retained-helper" });
  assert.equal(copy.conversationMetadata.runtime.segmentId, "current");
  assert.equal(copy.conversationLog[0].messages[0].text, "Retained request");
  assert.equal(copy.conversationLog[0].metadata.runtime.status, "interrupted");
  assert.deepEqual(copy.watches.map(watch => watch.status), ["paused", "paused"]);
  assert.equal(copy.assignments[0].status, "needs-user");
  assert.deepEqual(copy.observations, []);
});

test("offline development copy stops saved main and temporary work while preserving parent history and identity", async () => {
  await withTemporaryRoot(async root => {
    const at = "2026-10-15T00:00:00.000Z";
    const sourceRoot = path.join(root, "parent-state");
    const destinationRoot = path.join(root, "guest-state");
    const parent = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: sourceRoot });
    await parent.createSession({ sessionId: "one", runtimeKind: "genesis" });
    const claude = JSON.stringify({ executionId: "parent-execution", state: "active", turnId: "native-turn",
      nativeWorkdir: "/same/worktree", lastMessageId: "message", sent: true, accountIdentity: "same-account" });
    await parent.writeMetadataValue("one", "claude_conversation_native", claude);
    await parent.writeSessionConversation("one", "secondary", { status: "inProgress", state: "open", draft: "Unsent next question",
      providerConversationId: "retained-native", nativeBindings: { claude: { conversationId: "retained-native", runId: "retained-run" } } });
    for (const scope of ["one", { sessionId: "one", conversationId: "secondary" }]) {
      await parent.conversationStorage.write(scope, async transaction => {
        await transaction.writeMetadata({ runtime: { version: 3, engine: "claude", segmentId: "segment", lastEngine: "claude",
          configuration: { model: "saved-model" }, predecessors: [], seen: {},
          binding: { conversationId: "retained-native", workdir: "/same/worktree", configRoot: "/same/config", executionId: "parent-execution" },
          nativeTurn: { active: true, state: "active" } } });
        await transaction.appendMessage("000001", { role: "user", text: "Original question", messageId: "question", at,
          turnMetadata: { runtime: { status: "running", engine: "claude", segmentId: "segment" } } });
      });
    }
    await parent.writeAgentRunEvent("one", "codex_app_server", { patch: {
      state: "active", providerThreadId: "native-codex", providerGoalStatus: "active", pendingUserMessageClientIds: ["pending"]
    } });
    await parent.writeBackgroundTaskEvent("one", "setup", { patch: { status: "running" } });
    const original = await readFile(path.join(parent.paths("one").conversationLogRoot, "transcript.json"), "utf8");
    const guest = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: destinationRoot });
    await parent.mutateSession("one", async () => {
      await cp(sourceRoot, destinationRoot, { recursive: true });
      const lock = path.join(parent.paths("one").sessionsRoot, ".locks", "one", "mutation.lock", "owner.json");
      const owner = await readFile(lock, "utf8");
      await prepareVibe64DevelopmentCopy({ store: guest, sessionId: "one", at });
      assert.equal(await readFile(lock, "utf8"), owner, "The parent's live lock remains owned by its writer");
    });
    const session = await guest.readSession("one");
    await guest.writeMetadataValue("one", "claude_conversation_native", prepareCopiedClaudeConversationState(session.metadata.claude_conversation_native));
    const secondary = (await guest.listSessionConversations("one"))[0];
    await guest.writeSessionConversation("one", secondary.conversationId, prepareCopiedSessionConversation(secondary));
    for (const scope of ["one", { sessionId: "one", conversationId: "secondary" }]) {
      await guest.conversationStorage.read(scope, async transaction => {
        const { runtime } = await transaction.readMetadata();
        assert.equal(runtime.binding.conversationId, "retained-native");
        assert.equal(runtime.binding.executionId, "");
        assert.equal(runtime.nativeTurn.active, false);
        const turn = await transaction.readTurn("000001");
        assert.equal(turn.metadata.runtime.status, "interrupted");
        assert.equal(turn.messages[0].text, "Original question");
      });
    }
    const [run] = await guest.readAgentRuns("one");
    assert.equal(run.active, false);
    assert.equal(run.state, "interrupted");
    assert.equal(run.providerGoalStatus, "paused");
    assert.equal(run.providerThreadId, "native-codex");
    assert.deepEqual(run.pendingUserMessageClientIds, []);
    assert.equal((await guest.readBackgroundTasks("one"))[0].status, "failed");
    const [copiedSecondary] = await guest.listSessionConversations("one");
    assert.equal(copiedSecondary.status, "interrupted");
    assert.equal(copiedSecondary.draft, "Unsent next question");
    assert.deepEqual(copiedSecondary.nativeBindings, secondary.nativeBindings);
    const copiedClaude = JSON.parse((await guest.readSession("one")).metadata.claude_conversation_native);
    assert.equal(copiedClaude.state, "interrupted");
    assert.equal(copiedClaude.executionId, "");
    assert.equal(copiedClaude.turnId, "native-turn");
    assert.equal(copiedClaude.accountIdentity, "same-account");
    assert.equal(await readFile(path.join(parent.paths("one").conversationLogRoot, "transcript.json"), "utf8"), original);
    assert.equal((await parent.readAgentRuns("one"))[0].active, true);
    assert.equal((await parent.readSession("one")).metadata.claude_conversation_native, claude);
    assert.equal((await parent.listSessionConversations("one"))[0].status, "inProgress");
  });
});
