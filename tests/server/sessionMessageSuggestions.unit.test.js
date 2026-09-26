import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  defineVibe64AssistantSelection,
  serializeVibe64AssistantSelection
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  createService
} from "../../packages/vibe64-sessions/src/server/service.js";
import {
  SESSION_MESSAGE_SUGGESTION_MAX_SUBMISSIONS_PER_MINUTE,
  SESSION_MESSAGE_SUGGESTION_MAX_PENDING,
  appendSuggestion,
  assertSuggestionSubmissionAllowed,
  emptySuggestionState,
  newSessionMessageSuggestion,
  readSessionMessageSuggestionState
} from "../../packages/vibe64-sessions/src/server/sessionMessageSuggestions.js";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const selection = defineVibe64AssistantSelection({
  agentId: "codex",
  catalogRevision: `sha256:${"d".repeat(64)}`,
  engineId: "codex",
  modelId: "gpt-5.4",
  modelProviderId: "openai",
  variantId: "medium"
});

function queueHarness(runtime, {
  deliveryResult = null,
  failDelivery = () => false,
  pinResult = null,
  publications = []
} = {}) {
  const deliveries = [];
  const pins = [];
  const unpins = [];
  const terminals = {
    async inspectAssistantAccess(_sessionId, options) {
      const owner = options.vibe64User?.role === "owner";
      return {
        available: true,
        canRequestMessage: !owner,
        canUse: owner,
        ownerOnly: true,
        providerId: "codex",
        transportId: "codex_app_server"
      };
    },
    async pinAgentAttachments(_sessionId, input) {
      pins.push(input);
      return typeof pinResult === "function"
        ? pinResult(input)
        : { missing: [], ok: true, retained: input.attachmentIds };
    },
    async requireAssistantAccess(_sessionId, options) {
      if (options.vibe64User?.role !== "owner") {
        const error = new Error("Only the workspace owner can use this personal AI connection.");
        error.code = "vibe64_assistant_owner_required";
        error.statusCode = 403;
        throw error;
      }
      return { available: true, canUse: true, ownerOnly: true };
    },
    async sendAgentMessage(_sessionId, input) {
      deliveries.push(input);
      if (typeof deliveryResult === "function") {
        return deliveryResult(input);
      }
      return failDelivery()
        ? { code: "provider_failed", error: "Provider failed.", ok: false }
        : { delivered: true, ok: true };
    },
    async unpinAgentAttachments(_sessionId, input) {
      unpins.push(input);
      return { ok: true, released: input.attachmentIds };
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals
  });
  return { deliveries, pins, publications, service, terminals, unpins };
}

async function createSuggestionRuntime(targetRoot) {
  const store = createVibe64SessionStore({
    projectContextRoot: targetRoot,
    projectRuntimeRoot: projectRuntimeRoot(targetRoot)
  });
  await store.createSession({
    metadata: {
      [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection)
    },
    runtimeKind: "genesis",
    sessionId: "session-1"
  });
  return {
    getSession(id, options) {
      return store.readSession(id, options);
    },
    store
  };
}

test("message suggestions retain preferred-name attribution and attachments through restart and idempotent approval", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const harness = queueHarness(runtime);
    const member = { displayName: "Grace Account", preferredName: "Amazing Grace", role: "user", username: "grace" };
    const owner = { displayName: "Ada Account", preferredName: "Countess Ada", role: "owner", username: "ada" };
    const displayAttachments = [{
      fileName: "context.png",
      size: 2048
    }];
    const created = await harness.service.suggestAgentMessage("session-1", {
      attachmentIds: ["11111111-1111-4111-8111-111111111111"],
      displayAttachments,
      message: "Please update the tests.",
      originId: "member-tab",
      vibe64User: member
    });
    assert.equal(created.ok, true);
    assert.deepEqual(created.suggestion.author, { displayName: "Amazing Grace", username: "grace" });
    assert.deepEqual(created.suggestion.displayAttachments, displayAttachments);
    assert.equal(harness.pins.length, 1);

    const memberQueue = await harness.service.listMessageSuggestions("session-1", {
      vibe64User: member
    });
    assert.equal(memberQueue.canManage, false);
    assert.deepEqual(memberQueue.suggestions.map(({ id }) => id), [created.suggestion.id]);
    const hiddenFromOtherMember = await harness.service.listMessageSuggestions("session-1", {
      vibe64User: { username: "linus" }
    });
    assert.deepEqual(hiddenFromOtherMember.suggestions, []);
    const ownerQueue = await harness.service.listMessageSuggestions("session-1", {
      vibe64User: owner
    });
    assert.equal(ownerQueue.canManage, true);
    assert.equal(ownerQueue.suggestions.length, 1);

    const approved = await harness.service.approveMessageSuggestion("session-1", {
      suggestionId: created.suggestion.id,
      vibe64User: owner
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.suggestion.status, "delivered");
    assert.deepEqual(approved.suggestion.decidedBy, { displayName: "Countess Ada", username: "ada" });
    assert.equal(harness.deliveries.length, 1);
    assert.deepEqual(harness.deliveries[0].displayAttachments, displayAttachments);
    assert.equal(harness.deliveries[0].message, "Please update the tests.");
    assert.equal(
      harness.deliveries[0].messageId,
      `vibe64-suggestion:${created.suggestion.id}`
    );
    assert.equal(
      harness.deliveries[0].displayMessage,
      "Suggested by Amazing Grace (grace); approved by Countess Ada (ada).\n\nPlease update the tests."
    );
    assert.equal(harness.unpins.length, 1);

    member.preferredName = "Grace Updated";
    owner.preferredName = "Ada Updated";
    const reloaded = queueHarness(runtime);
    const duplicate = await reloaded.service.approveMessageSuggestion("session-1", {
      suggestionId: created.suggestion.id,
      vibe64User: owner
    });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.suggestion.author, { displayName: "Amazing Grace", username: "grace" });
    assert.deepEqual(duplicate.suggestion.decidedBy, { displayName: "Countess Ada", username: "ada" });
    assert.equal(reloaded.deliveries.length, 0);
  });
});

test("owner approval authorizes the routed delivery without requiring the previous native connection", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const harness = queueHarness(runtime);
    const created = await harness.service.suggestAgentMessage("session-1", {
      message: "Implement the change through the available Code destination.",
      vibe64User: { role: "member", username: "member" }
    });
    harness.terminals.requireAssistantAccess = async () => { throw new Error("The previous native connection is unavailable."); };
    const approved = await harness.service.approveMessageSuggestion("session-1", {
      suggestionId: created.suggestion.id, vibe64User: { role: "owner", username: "owner" }
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.suggestion.status, "delivered");
    assert.equal(harness.deliveries.length, 1);
    assert.equal(harness.deliveries[0].vibe64User.role, "owner");
  });
});

test("coalesced suggestion approvals still authorize each caller", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const entered = Promise.withResolvers();
    const delivery = Promise.withResolvers();
    const harness = queueHarness(runtime, {
      deliveryResult: () => {
        entered.resolve();
        return delivery.promise;
      }
    });
    const owner = { displayName: "Ada", role: "owner", username: "ada" };
    const created = await harness.service.suggestAgentMessage("session-1", {
      message: "Only the owner may approve this.",
      vibe64User: { displayName: "Grace", role: "member", username: "grace" }
    });
    const approval = { suggestionId: created.suggestion.id, vibe64User: owner };
    const firstOwner = harness.service.approveMessageSuggestion("session-1", approval);
    await entered.promise;
    const member = harness.service.approveMessageSuggestion("session-1", {
      suggestionId: created.suggestion.id,
      vibe64User: { displayName: "Linus", role: "member", username: "linus" }
    });
    const secondOwner = harness.service.approveMessageSuggestion("session-1", approval);
    delivery.resolve({ delivered: true, ok: true });
    const [first, unauthorized, second] = await Promise.all([firstOwner, member, secondOwner]);

    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.code, "vibe64_message_suggestion_owner_required");
    assert.equal(unauthorized.suggestion, undefined);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(first.suggestion, second.suggestion);
    assert.equal(harness.deliveries.length, 1);
  });
});

test("coalesced owner approvals share thrown failures and permit an idempotent retry", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const entered = Promise.withResolvers();
    const delivery = Promise.withResolvers();
    let failing = true;
    const harness = queueHarness(runtime, {
      deliveryResult: () => {
        entered.resolve();
        return failing ? delivery.promise : { delivered: true, ok: true };
      }
    });
    const created = await harness.service.suggestAgentMessage("session-1", {
      message: "Keep this request available after the connection fails.",
      vibe64User: { displayName: "Grace", role: "member", username: "grace" }
    });
    const approval = {
      suggestionId: created.suggestion.id,
      vibe64User: { displayName: "Ada", role: "owner", username: "ada" }
    };
    const firstOwner = harness.service.approveMessageSuggestion("session-1", approval);
    await entered.promise;
    const secondOwner = harness.service.approveMessageSuggestion("session-1", approval);
    const failure = new Error("Provider connection lost.");
    failure.code = "provider_connection_lost";
    delivery.reject(failure);
    const results = await Promise.all([firstOwner, secondOwner]);

    assert.equal(results[0].ok, false);
    assert.equal(results[0].code, "provider_connection_lost");
    assert.deepEqual(results[0], results[1]);
    assert.equal(harness.deliveries.length, 1);
    const persisted = await readSessionMessageSuggestionState(runtime.store, "session-1");
    assert.equal(persisted.entries[0].status, "pending");
    assert.equal(persisted.entries[0].lastDeliveryError, "Provider connection lost.");

    failing = false;
    const retried = await harness.service.approveMessageSuggestion("session-1", approval);
    assert.equal(retried.ok, true);
    assert.equal(retried.suggestion.status, "delivered");
    assert.equal(harness.deliveries.length, 2);
    assert.equal(harness.deliveries[0].messageId, harness.deliveries[1].messageId);
  });
});

test("provider failure leaves a recoverable pending suggestion", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    let failing = true;
    const harness = queueHarness(runtime, { failDelivery: () => failing });
    const created = await harness.service.suggestAgentMessage("session-1", {
      message: "Retry me once.",
      vibe64User: { displayName: "Grace", role: "user", username: "grace" }
    });
    const failed = await harness.service.approveMessageSuggestion("session-1", {
      suggestionId: created.suggestion.id,
      vibe64User: { displayName: "Ada", role: "owner", username: "ada" }
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.suggestion.status, "pending");
    assert.equal(failed.suggestion.lastDeliveryError, "Provider failed.");

    failing = false;
    const retried = await harness.service.approveMessageSuggestion("session-1", {
      suggestionId: created.suggestion.id,
      vibe64User: { displayName: "Ada", role: "owner", username: "ada" }
    });
    assert.equal(retried.ok, true);
    assert.equal(retried.suggestion.status, "delivered");
    assert.equal(harness.deliveries.length, 2);
    assert.equal(harness.deliveries[0].messageId, harness.deliveries[1].messageId);
  });
});

test("approval fails safely and keeps attachments retained when delivery finds one missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const missingId = "11111111-1111-4111-8111-111111111111";
    const harness = queueHarness(runtime, {
      deliveryResult: () => ({
        code: "vibe64_agent_attachment_missing",
        error: "The retained attachment no longer exists.",
        ok: false
      })
    });
    const created = await harness.service.suggestAgentMessage("session-1", {
      attachmentIds: [missingId],
      message: "Use the retained attachment.",
      vibe64User: { displayName: "Grace", role: "user", username: "grace" }
    });

    const result = await harness.service.approveMessageSuggestion("session-1", {
      suggestionId: created.suggestion.id,
      vibe64User: { displayName: "Ada", role: "owner", username: "ada" }
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_agent_attachment_missing");
    assert.equal(result.suggestion.status, "pending");
    assert.equal(result.suggestion.lastDeliveryError, "The retained attachment no longer exists.");
    assert.equal(harness.unpins.length, 0);
  });
});

test("authors withdraw only their own suggestions and only the owner may discard", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const publications = [];
    const harness = queueHarness(runtime, { publications });
    const grace = { displayName: "Grace", role: "user", username: "grace" };
    const owner = { displayName: "Ada Account", preferredName: "Countess Ada", role: "owner", username: "ada" };
    const first = await harness.service.suggestAgentMessage("session-1", {
      attachmentIds: ["11111111-1111-4111-8111-111111111111"],
      message: "Withdraw this.",
      vibe64User: grace
    });

    const foreignWithdrawal = await harness.service.withdrawMessageSuggestion("session-1", {
      suggestionId: first.suggestion.id,
      vibe64User: { displayName: "Linus", username: "linus" }
    });
    assert.equal(foreignWithdrawal.ok, false);
    assert.equal(foreignWithdrawal.code, "vibe64_message_suggestion_withdraw_forbidden");

    const withdrawn = await harness.service.withdrawMessageSuggestion("session-1", {
      suggestionId: first.suggestion.id,
      vibe64User: grace
    });
    assert.equal(withdrawn.ok, true);
    assert.equal(withdrawn.suggestion.status, "withdrawn");
    assert.equal(harness.unpins.length, 1);

    const second = await harness.service.suggestAgentMessage("session-1", {
      message: "Discard this.",
      vibe64User: grace
    });
    const memberDiscard = await harness.service.discardMessageSuggestion("session-1", {
      suggestionId: second.suggestion.id,
      vibe64User: grace
    });
    assert.equal(memberDiscard.ok, false);
    assert.equal(memberDiscard.code, "vibe64_message_suggestion_owner_required");

    const discarded = await harness.service.discardMessageSuggestion("session-1", {
      suggestionId: second.suggestion.id,
      vibe64User: owner
    });
    assert.equal(discarded.ok, true);
    assert.equal(discarded.suggestion.status, "discarded");
    assert.deepEqual(discarded.suggestion.decidedBy, { displayName: "Countess Ada", username: "ada" });
    assert.deepEqual(discarded.suggestion.author, { displayName: "Grace", username: "grace" });
    assert.deepEqual(publications.map(([, event]) => event.reason), [
      "session-message-suggestion-created",
      "session-message-suggestion-withdrawn",
      "session-message-suggestion-created",
      "session-message-suggestion-discarded"
    ]);
  });
});

test("missing attachments fail before a suggestion becomes durable", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const missingId = "11111111-1111-4111-8111-111111111111";
    const harness = queueHarness(runtime, {
      pinResult: () => ({
        code: "vibe64_agent_attachment_missing",
        error: "The attachment no longer exists.",
        missing: [missingId],
        ok: false,
        retained: []
      })
    });

    const result = await harness.service.suggestAgentMessage("session-1", {
      attachmentIds: [missingId],
      message: "This must not enter the queue.",
      vibe64User: { displayName: "Grace", role: "user", username: "grace" }
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_agent_attachment_missing");
    const queue = await harness.service.listMessageSuggestions("session-1", {
      vibe64User: { displayName: "Grace", role: "user", username: "grace" }
    });
    assert.deepEqual(queue.suggestions, []);
  });
});

test("a partial attachment pin is rolled back before suggestion failure", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const retainedId = "11111111-1111-4111-8111-111111111111";
    const missingId = "22222222-2222-4222-8222-222222222222";
    const harness = queueHarness(runtime, {
      pinResult: () => ({
        missing: [missingId],
        ok: false,
        retained: [retainedId]
      })
    });

    const result = await harness.service.suggestAgentMessage("session-1", {
      attachmentIds: [retainedId, missingId],
      message: "This must not leave an attachment pinned.",
      vibe64User: { displayName: "Grace", role: "user", username: "grace" }
    });

    assert.equal(result.ok, false);
    assert.deepEqual(harness.unpins, [{
      attachmentIds: [retainedId],
      suggestionId: harness.pins[0].suggestionId
    }]);
  });
});

test("message suggestion submission rate is bounded in durable state", () => {
  const now = "2026-08-26T00:00:30.000Z";
  let state = emptySuggestionState();
  for (let index = 0; index < SESSION_MESSAGE_SUGGESTION_MAX_SUBMISSIONS_PER_MINUTE; index += 1) {
    const suggestion = newSessionMessageSuggestion({
      author: { username: "grace" },
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      message: `Suggestion ${index}`,
      now: `2026-08-26T00:00:${String(index).padStart(2, "0")}.000Z`
    });
    state = appendSuggestion(state, suggestion, suggestion.updatedAt);
  }
  assert.throws(
    () => assertSuggestionSubmissionAllowed(
      state,
      { username: "grace" },
      Date.parse(now)
    ),
    (error) => error.code === "vibe64_message_suggestion_rate_limited"
  );
});

test("message suggestions accept managed usernames up to 63 characters", () => {
  const username = "u".repeat(63);
  const suggestion = newSessionMessageSuggestion({
    author: { username },
    id: "00000000-0000-4000-8000-000000000001",
    message: "Please review this."
  });

  assert.equal(suggestion.author.username, username);
  assert.throws(
    () => newSessionMessageSuggestion({
      author: { username: "u".repeat(64) },
      id: "00000000-0000-4000-8000-000000000002",
      message: "This identity is too long."
    }),
    (error) => error.code === "vibe64_message_suggestion_actor_invalid"
  );
});

test("message suggestion pending count is bounded across authors", () => {
  let state = emptySuggestionState();
  for (let index = 0; index < SESSION_MESSAGE_SUGGESTION_MAX_PENDING; index += 1) {
    const suffix = String(index).padStart(12, "0");
    const suggestion = newSessionMessageSuggestion({
      author: { username: `member_${index}` },
      id: `00000000-0000-4000-8000-${suffix}`,
      message: `Suggestion ${index}`,
      now: "2026-08-26T00:00:00.000Z"
    });
    state = appendSuggestion(state, suggestion, suggestion.updatedAt);
  }
  assert.throws(
    () => assertSuggestionSubmissionAllowed(state, { username: "next_member" }),
    (error) => error.code === "vibe64_message_suggestion_queue_full"
  );
});

test("pending suggestions remain readable after the session is archived", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const harness = queueHarness(runtime);
    const created = await harness.service.suggestAgentMessage("session-1", {
      message: "Preserve this pending decision.",
      vibe64User: { displayName: "Grace", role: "user", username: "grace" }
    });

    await runtime.store.writeStatus("session-1", VIBE64_SESSION_STATUS.ARCHIVED);
    await runtime.store.publishSessionArchive("session-1");

    const archived = await readSessionMessageSuggestionState(runtime.store, "session-1");
    assert.equal(archived.entries.length, 1);
    assert.equal(archived.entries[0].id, created.suggestion.id);
    assert.equal(archived.entries[0].status, "pending");
  });
});

test("assistant access exposes separate purpose decisions without private connection identities", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = await createSuggestionRuntime(targetRoot);
    const harness = queueHarness(runtime);
    harness.terminals.inspectAssistantAccess = async (_sessionId, context) => {
      assert.equal(context.vibe64User.username, "member");
      return {
        available: true, canUse: true, nativeCanUse: false, canUseAny: true, canRequestMessage: false, currentMode: "junior",
        purposes: {
          junior: { available: true, effectiveSelection: { ...selection, modelId: "deepseek-flash" },
            connectionIdentity: "private-connection", seniorJuniorPair: {
              senior: { connectionIdentity: "private-plan" }, junior: { connectionIdentity: "private-code" }
            } },
          prompt_hint: { available: false, reasonCode: "helper_review_required", message: "Review helper routing." },
          auto: { available: false, routerConnectionIdentity: "private-router", reasonCode: "personal_roles" }
        }
      };
    };
    const result = await harness.service.inspectAssistantAccess("session-1", { vibe64User: { username: "member", role: "member" } });
    assert.equal(result.ok, true);
    assert.equal(result.currentMode, "junior");
    assert.equal(result.canUse, true);
    assert.equal(result.nativeCanUse, false);
    assert.equal(result.purposes.prompt_hint.available, false);
    assert.equal(result.purposes.junior.effectiveSelection.modelId, "deepseek-flash");
    assert.doesNotMatch(JSON.stringify(result), /private-|connectionIdentity|routerConnectionIdentity/u);
    assert.equal(harness.deliveries.length, 0);
  });
});
