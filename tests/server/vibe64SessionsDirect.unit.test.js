import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_SKIP_INTEGRATION_SETUP,
  ACTION_RESUME_INTEGRATION_SETUP,
  ACTION_APPROVE_MESSAGE_SUGGESTION,
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CONFIRM_SESSION_RENEWAL,
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_ARCHIVE_SESSION,
  ACTION_CREATE_PULL_REQUEST,
  ACTION_CREATE_SESSION,
  ACTION_DISCARD_MESSAGE_SUGGESTION,
  ACTION_INSPECT_ASSISTANT_ACCESS,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION_CHANGE_DIFF,
  ACTION_INSPECT_SESSION_CHANGES,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_LIST_ASSISTANT_CAPABILITIES,
  ACTION_LIST_ARCHIVED_SESSIONS,
  ACTION_LIST_SESSIONS,
  ACTION_LIST_MESSAGE_SUGGESTIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_RETRY_SESSION_RENEWAL,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_UPDATE_SESSION_WORK,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
  ACTION_UPDATE_ASSISTANT_SELECTION,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  ACTION_UPDATE_SESSION_PRESENCE,
  ACTION_REWIND_CONVERSATION,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_SUGGEST_AGENT_MESSAGE,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_WITHDRAW_MESSAGE_SUGGESTION,
  createSessionActions
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  vibe64AssistantSelectionFromMetadata
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  createService
} from "../../packages/vibe64-sessions/src/server/service.js";
import {
  developmentDatabasePolicy
} from "../../packages/vibe64-project/src/server/developmentDatabasePolicy.js";
import {
  runProjectSessionPolicyExclusive
} from "../../packages/vibe64-project/src/server/projectSourceMutationLock.js";
import {
  vibe64StatusCode
} from "../../packages/vibe64-core/src/server/serverResponses.js";
import {
  createSessionChangedPublisher
} from "../../packages/vibe64-core/src/server/sessionRealtimeEvents.js";
import {
  runVibe64AgentWriteExclusive
} from "../../packages/vibe64-runtime/src/server/agentWriteLock.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  Vibe64SessionRuntime
} from "../../packages/vibe64-runtime/src/server/runtime.js";
import {
  projectRuntimeRoot,
  sourceMetadata,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function agentWriteLockHarness() {
  let active = false;
  const attempts = [];
  return {
    attempts,
    store: {
      async listSessionsForRenewal() { return []; },
      async listSessionConversations() { return []; },
      async writeMetadataValue() {},
      async runSessionExclusive(sessionId, operationName, operation) {
        attempts.push({ operationName, sessionId });
        if (active) {
          return {
            acquired: false,
            value: null
          };
        }
        active = true;
        try {
          return {
            acquired: true,
            value: await operation()
          };
        } finally {
          active = false;
        }
      }
    }
  };
}

const initialPlanSelection = {
  agentId: "build", catalogRevision: `sha256:${"a".repeat(64)}`, engineId: "opencode", modelId: "big-pickle",
  modelProviderId: "opencode", schema: "vibe64.assistant-selection.v1", variantId: ""
};

function assertInitialPlanMetadata(metadata = {}, createdBy = "") {
  assert.equal(metadata.created_by, createdBy);
  assert.deepEqual(vibe64AssistantSelectionFromMetadata(metadata), initialPlanSelection);
  assert.deepEqual(JSON.parse(metadata.assistant_routing), { mode: "senior", review: false, workflowEngineId: "opencode" });
}

async function requireAgentWrite(runtime, sessionId, operation) {
  const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, operation);
  if (!exclusive.acquired) {
    const error = new Error(exclusive.value.error);
    error.code = exclusive.value.code;
    error.retryable = exclusive.value.retryable;
    throw error;
  }
  return exclusive.value;
}

function sessionCreationPolicyHarness({
  beforeCreate = async () => {},
  initialSessions = [],
  initializeModelRouting = async () => ({ ok: true }),
  managed = true,
  resolveAssistantPurpose = async (input) => ({ available: true,
    effectiveSelection: input.override?.selection || initialPlanSelection, connectionIdentity: "workspace-ai" }),
  requireAssistantSelectionAccess = async () => ({ ok: true }),
  publishSessionChanged = async () => {},
  projectRuntimeRoot: runtimeRoot,
  resolveAssistantSelection = null,
  scope = "session",
  startWorkspaceSetup = () => ({ completion: null })
} = {}) {
  const openSessions = initialSessions.map((session) => ({
    status: "active",
    ...session
  }));
  const creationInputs = [];
  let runtimeCreations = 0;
  let nextSession = openSessions.length + 1;
  const runtime = {
    store: {
      async listSessionsForRenewal() {
        return openSessions.map((session) => ({ ...session }));
      }
    },
    async createSession(input) {
      creationInputs.push(input);
      await beforeCreate();
      const session = {
        sessionId: `session-${nextSession}`,
        status: "active",
        workspaceSetup: {
          status: "unconfigured"
        }
      };
      nextSession += 1;
      openSessions.push(session);
      return session;
    },
    async getSession(sessionId) {
      return openSessions.find((session) => session.sessionId === sessionId) || null;
    },
    async listSessionSummaries() {
      return openSessions
        .filter((session) => ["active", "blocked", "renewal_quiesced"].includes(session.status))
        .map((session) => ({ ...session }));
    }
  };
  const project = {
    async createRuntime() {
      runtimeCreations += 1;
      return runtime;
    },
    async developmentDatabasePolicy({ openSessions: currentSessions = [] } = {}) {
      return developmentDatabasePolicy({
        managed,
        openSessions: currentSessions,
        scope
      });
    },
    runProjectSessionPolicyExclusive(operation, options = {}) {
      return runProjectSessionPolicyExclusive(runtimeRoot, operation, options);
    }
  };
  const service = createService({
    initializeModelRouting,
    project,
    publishSessionChanged,
    terminals: {
      requireAssistantSelectionAccess,
      resolveAssistantPurpose,
      ...(typeof resolveAssistantSelection === "function"
        ? { resolveAssistantSelection }
        : {})
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      start: startWorkspaceSetup,
      wait: () => null
    }
  });
  return {
    creationInputs,
    openSessions,
    project,
    get runtimeCreations() {
      return runtimeCreations;
    },
    runtime,
    service
  };
}

test("sessions expose only direct chat and source actions", () => {
  assert.deepEqual(createSessionActions({ sessions: {} }).map((action) => action.id), [
    ACTION_RESUME_INTEGRATION_SETUP,
    ACTION_SKIP_INTEGRATION_SETUP,
    ACTION_INSPECT_REPOSITORY_HISTORY,
    ACTION_INSPECT_REPOSITORY_VERSION_FILES,
    ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
    ACTION_LIST_SESSIONS,
    ACTION_LIST_ARCHIVED_SESSIONS,
    ACTION_LIST_ASSISTANT_CAPABILITIES,
    ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
    ACTION_CREATE_SESSION,
    ACTION_UPDATE_CURRENT_SESSION,
    ACTION_INSPECT_SESSION,
    ACTION_UPDATE_ASSISTANT_SELECTION,
    ACTION_INSPECT_SESSION_RENEWAL,
    ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
    ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
    ACTION_CANCEL_SESSION_RENEWAL,
    ACTION_CONFIRM_SESSION_RENEWAL,
    ACTION_RETRY_SESSION_RENEWAL,
    ACTION_INSPECT_SESSION_CHANGES,
    ACTION_INSPECT_SESSION_CHANGE_DIFF,
    ACTION_INSPECT_SESSION_WORK,
    ACTION_CREATE_PULL_REQUEST,
    ACTION_SAVE_SESSION_WORK,
    ACTION_CHECK_SESSION_UPDATES,
    ACTION_UPDATE_SESSION_WORK,
    ACTION_READ_SESSION_CONVERSATION_LOG,
    ACTION_RETRY_WORKSPACE_SETUP,
    ACTION_ARCHIVE_SESSION,
    ACTION_REWIND_CONVERSATION,
  ACTION_SEND_AGENT_MESSAGE,
    ACTION_INSPECT_ASSISTANT_ACCESS,
    ACTION_LIST_MESSAGE_SUGGESTIONS,
    ACTION_SUGGEST_AGENT_MESSAGE,
    ACTION_WITHDRAW_MESSAGE_SUGGESTION,
    ACTION_APPROVE_MESSAGE_SUGGESTION,
    ACTION_DISCARD_MESSAGE_SUGGESTION,
    ACTION_INTERRUPT_AGENT_TURN,
    ACTION_UPDATE_SESSION_PRESENCE,
    ACTION_BROADCAST_SESSION_PREVIEW_STATE
  ]);
});

test("typing presence trusts the authenticated request user and never accepts a draft", async () => {
  const updates = [];
  const sessionPresence = {
    close() {},
    async update(input) {
      updates.push(input);
      return { ok: true, status: "typing" };
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return { sessionId, status: "active" };
          }
        };
      }
    },
    sessionPresence,
    terminals: {}
  });
  const action = createSessionActions({ sessions: service })
    .find((candidate) => candidate.id === ACTION_UPDATE_SESSION_PRESENCE);
  const validated = action.input.schema.create({
    originId: "tab:member-1",
    sequence: 7,
    sessionId: "session-1",
    typing: true
  });
  assert.deepEqual(validated.errors, {});
  assert.equal(Object.hasOwn(validated.validatedObject, "draft"), false);

  const unavailable = await action.execute(validated.validatedObject, {
    requestMeta: { request: {} }
  });
  assert.deepEqual(unavailable, { ok: true, status: "unavailable" });
  assert.equal(updates.length, 0);

  const result = await runWithProjectRequestContext({ slug: "beepollen" }, () => (
    action.execute(validated.validatedObject, {
      requestMeta: {
        request: {
          vibe64User: {
            preferredName: "John",
            username: "member-1"
          }
        }
      }
    })
  ));
  assert.deepEqual(result, { ok: true, status: "typing" });
  assert.deepEqual(updates, [{
    actorId: "member-1",
    displayName: "John",
    originId: "tab:member-1",
    projectSlug: "beepollen",
    sequence: 7,
    sessionId: "session-1",
    typing: true
  }]);
});

test("temporary typing presence requires a saved chat in the requested session", async () => {
  const updates = [];
  const lookups = [];
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession(sessionId) { return { sessionId, status: "active" }; },
          store: {
            async readSessionConversation(sessionId, conversationId) {
              lookups.push([sessionId, conversationId]);
              return sessionId === "session-1" && conversationId === "saved-chat" ? { conversationId } : null;
            }
          }
        };
      }
    },
    sessionPresence: {
      close() {},
      async update(input) {
        updates.push(input);
        return { ok: true, status: "typing" };
      }
    },
    terminals: {}
  });
  const action = createSessionActions({ sessions: service })
    .find((candidate) => candidate.id === ACTION_UPDATE_SESSION_PRESENCE);
  const context = { requestMeta: { request: { vibe64User: { username: "member", preferredName: "John" } } } };
  for (const [sessionId, conversationId, status] of [
    ["session-1", "saved-chat", "typing"],
    ["session-1", "closed-chat", "unavailable"],
    ["session-2", "saved-chat", "unavailable"]
  ]) {
    const validated = action.input.schema.create({ sessionId, conversationId, originId: "tab:member", sequence: 1, typing: true });
    assert.deepEqual(validated.errors, {});
    const result = await runWithProjectRequestContext({ slug: "beepollen" }, () => action.execute(validated.validatedObject, context));
    assert.equal(result.status, status);
  }
  assert.equal(lookups.length, 3);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].conversationId, "saved-chat");
  assert.equal(updates[0].actorId, "member");
});

test("assistant message action accepts attachment lease ids and display details", () => {
  const action = createSessionActions({ sessions: {} })
    .find((candidate) => candidate.id === ACTION_SEND_AGENT_MESSAGE);
  const attachmentId = "33333333-3333-4333-8333-333333333333";
  const displayAttachments = [{
    fileName: "screenshot.png",
    size: 2048
  }];

  assert.deepEqual(action.input.schema.patch({
    attachmentIds: [attachmentId],
    displayAttachments,
    message: "Inspect this file.",
    sessionId: "session-1"
  }), {
    errors: {},
    validatedObject: {
      attachmentIds: [attachmentId],
      displayAttachments,
      message: "Inspect this file.",
      sessionId: "session-1"
    }
  });
});

test("deferred session changes publish modern top-level realtime events", async () => {
  const events = [];
  const publish = createSessionChangedPublisher({
    async publish(event) {
      events.push(event);
      return event;
    }
  });

  await publish("session-1", {
    originId: "tab:test",
    payload: {
      clientRefresh: {
        includeOutputs: true
      }
    },
    reason: "workspace-setup-completed",
    session: {
      revision: 7,
      sessionId: "session-1",
      status: "active"
    }
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "entity.changed");
  assert.equal(events[0].entityId, "session-1");
  assert.equal(events[0].realtime.event, "vibe64.session.changed");
  assert.equal(events[0].realtime.audience, "all_clients");
  assert.deepEqual(events[0].realtime.payload, {
    projectSlug: "",
    clientRefresh: {
      includeOutputs: true
    },
    originId: "tab:test",
    reason: "workspace-setup-completed",
    revision: 7,
    sessionId: "session-1",
    status: "active"
  });
  assert.equal(Object.hasOwn(events[0], "meta"), false);
});

test("session publications use the trusted project context and actions do not republish service completions", async () => {
  const published = [];
  const publish = createSessionChangedPublisher({ async publish(event) { published.push(event); } });
  await Promise.all(["project-a", "project-b"].map((slug) => runWithProjectRequestContext({ slug }, async () => {
    await Promise.resolve();
    await publish("same-session-id", { payload: { projectSlug: "untrusted", conversationLogPatch: { text: slug } } });
  })));
  assert.deepEqual(published.map((event) => event.realtime.payload.projectSlug).sort(), ["project-a", "project-b"]);
  for (const action of createSessionActions({ sessions: {} })) {
    assert.equal(action.events.length, 0);
  }
});

test("conversation history includes the current live snapshot for reconnecting clients", async () => {
  const conversationStream = { revision: 3, messages: [{ messageId: "answer", role: "assistant", text: "Partial", status: "inProgress" }] };
  const service = createService({ terminals: { readConversationRewindState: async () => null }, project: { async createRuntime() {
    return {
      async readConversationLogPage(sessionId) {
        assert.equal(sessionId, "session-1");
        return { turns: [], pagination: { totalTurnCount: 0 } };
      },
      store: { readConversationStream(sessionId) {
        assert.equal(sessionId, "session-1");
        return conversationStream;
      } }
    };
  } } });
  const result = await service.readSessionConversationLog("session-1");
  assert.equal(result.ok, true);
  assert.equal(result.conversationStream, conversationStream);
  assert.deepEqual(result.conversationLog, []);
});

test("session detail exposes renewal advice from the current thread and durable history", async () => {
  const session = {
    manifest: { createdAt: "2026-08-23T00:00:00.000Z" },
    metadata: {
      agent_context_usage_provider: "codex",
      agent_context_usage_thread_id: "thread-current",
      agent_context_usage_updated_at: "2026-08-24T01:00:00.000Z",
      agent_context_used_tokens: "232560",
      agent_context_window_tokens: "258400",
      agent_identity_conversation_id: "thread-current"
    },
    sessionId: "session-1",
    status: "active"
  };
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async readConversationLogPage() {
            return { pagination: { totalTurnCount: 57 }, turns: [] };
          }
        };
      }
    },
    terminals: {
      async agentSessionState() {
        return { ok: true, status: "idle" };
      }
    }
  });

  const result = await service.inspectSession("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.renewalAdvisory.available, true);
  assert.equal(result.renewalAdvisory.primarySignal, "provider-context");
  assert.equal(result.renewalAdvisory.severity, "soon");
  assert.equal(result.renewalAdvisory.signals.contextUsage.usedTokens, 232560);
  assert.equal(result.renewalAdvisory.signals.conversationTurnCount, 57);
  assert.equal(Object.hasOwn(result, "uiSync"), false);
});

test("archived session detail reads retained history without starting a native provider", async () => {
  const session = { sessionId: "archived-session", status: "archived", metadata: {},
    manifest: { createdAt: "2026-09-25T00:00:00.000Z" } };
  const service = createService({
    project: { async createRuntime() { return {
      async getSession() { return session; },
      async readConversationLogPage() { return { pagination: { totalTurnCount: 1 }, turns: [] }; }
    }; } },
    terminals: { async agentSessionState() { assert.fail("Archived source and native history may be gone."); } }
  });
  const result = await service.inspectSession(session.sessionId);
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, session.sessionId);
  assert.equal(result.status, "archived");
  assert.equal(result.agentSession, null);
});

test("session status refreshes do not inspect Git and explicit source health checks remain enforced", async () => {
  const session = {
    manifest: { runtimeKind: "genesis" },
    metadata: sourceMetadata("/workspace", "session-1"),
    sessionId: "session-1",
    status: "active"
  };
  let runtime;
  const service = createService({
    project: {
      async createRuntime(options = {}) {
        runtime = new Vibe64SessionRuntime({
          inspectSourceByDefault: options.inspectSource !== false,
          sourceInspectionAvailable: false,
          store: {
            async readSession() { return session; },
            async readConversationLogPage() {
              return { pagination: { totalTurnCount: 3 }, turns: [] };
            }
          }
        });
        return runtime;
      }
    },
    terminals: {
      async agentSessionState(sessionId, context) {
        // Status consumers sharing this runtime must also avoid source inspection.
        const reread = await context.runtime.getSession(sessionId);
        assert.equal(reread.sourceInspection, null);
        return { ok: true, status: "running" };
      }
    }
  });

  for (let refresh = 0; refresh < 2; refresh += 1) {
    const result = await service.inspectSession(session.sessionId);
    assert.equal(result.ok, true);
    assert.equal(result.sourceInspection, null);
    assert.equal(result.sourceReady, true);
    assert.equal(result.agentSession.status, "running");
    await assert.rejects(runtime.assertSourceHealthy(session), {
      code: "vibe64_source_inspection_unavailable"
    });
  }
});

test("assistant messages use the plain message contract", async () => {
  const calls = [];
  const publications = [];
  const runtimeCreationOptions = [];
  const sessionReadOptions = [];
  const session = {
    sessionId: "session-1",
    status: "active"
  };
  const runtime = {
    async getSession(sessionId, options) {
      assert.equal(sessionId, session.sessionId);
      sessionReadOptions.push(options);
      return session;
    }
  };
  const service = createService({
    project: {
      async createRuntime(options) {
        runtimeCreationOptions.push(options);
        return runtime;
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async sendAgentMessage(...args) {
        calls.push(args);
        return {
          delivered: true,
          ok: true
        };
      }
    }
  });

  const result = await service.sendAgentMessage("session-1", {
    attachmentIds: ["33333333-3333-4333-8333-333333333333"],
    displayAttachments: [{
      fileName: "screenshot.png",
      size: 2048
    }],
    displayMessage: "Inspect screenshot.png",
    message: "Inspect /tmp/screenshot.png",
    messageId: "message:test",
    originId: "tab:test"
  });

  assert.deepEqual(calls[0][0], "session-1");
  assert.deepEqual(calls[0][1], {
    attachmentIds: ["33333333-3333-4333-8333-333333333333"],
    displayAttachments: [{
      fileName: "screenshot.png",
      size: 2048
    }],
    displayMessage: "Inspect screenshot.png",
    message: "Inspect /tmp/screenshot.png",
    messageId: "message:test",
    originId: "tab:test"
  });
  assert.equal(result.messageId, "message:test");
  assert.equal(result.ok, true);
  assert.equal(publications.length, 1);
  assert.deepEqual(runtimeCreationOptions, [{ inspectSource: false }]);
  assert.equal(calls[0][2].runtime, runtime);
  assert.equal(Object.hasOwn(calls[0][2], "session"), false);
  assert.deepEqual(sessionReadOptions, [{ inspectSource: false }]);
});

test("empty assistant messages fail without starting a provider turn", async () => {
  const service = createService({
    project: {},
    terminals: {}
  });

  assert.deepEqual(await service.sendAgentMessage("session-1", {
    message: "  "
  }), {
    code: "vibe64_agent_message_input_required",
    error: "Assistant messages require text.",
    ok: false
  });
  assert.equal(Object.hasOwn(service, "broadcastComposerDraft"), false);
  assert.equal(Object.hasOwn(service, "readComposerDraft"), false);
});

test("failed assistant delivery is published as failed, not accepted", async () => {
  const publications = [];
  const session = {
    sessionId: "session-1",
    status: "active"
  };
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          }
        };
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async sendAgentMessage() {
        return {
          code: "codex_thread_reconciliation_failed",
          error: "Codex thread reconciliation failed.",
          ok: false
        };
      }
    }
  });

  const result = await service.sendAgentMessage("session-1", {
    message: "Continue the import.",
    messageId: "message:test"
  });

  assert.equal(result.error, "Codex thread reconciliation failed.");
  assert.equal(result.ok, false);
  assert.equal(publications[0][1].reason, "session-agent-message-failed");
});

test("session work inspection includes the durable native Save operation", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return { sessionId: "session-1", status: "active" };
          },
          store: {
            async readBackgroundTask(sessionId, taskId) {
              assert.equal(sessionId, "session-1");
              assert.ok(["save-work", "update-session"].includes(taskId));
              return { id: taskId, status: "ready" };
            }
          }
        };
      }
    },
    terminals: {
      async inspectSessionWork(sessionId) {
        assert.equal(sessionId, "session-1");
        return { canonicalCommit: "abc123", unsaved: true };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");
  assert.equal(result.ok, true);
  assert.equal(result.unsaved, true);
  assert.equal(result.activeOperation, null);
  assert.deepEqual(result.operation, { id: "save-work", status: "ready" });
  assert.deepEqual(result.updateOperation, { id: "update-session", status: "ready" });
});

test("overlapping work reads share one inspection only for the same project and source version", async () => {
  let projectRoot = "/project-a";
  let canonicalCommit = "canonical-a";
  const inspections = [];
  const service = createService({
    project: {
      async createRuntime() {
        return {
          stateRoot: projectRoot,
          async getSession(sessionId) {
            return { sessionId, metadata: { canonical_commit: canonicalCommit }, status: "active" };
          },
          store: { async readBackgroundTask() { return null; } }
        };
      }
    },
    terminals: {
      inspectSessionWork(sessionId, { runtime }) {
        return new Promise((resolve, reject) => {
          inspections.push({ projectRoot: runtime.stateRoot, reject, resolve, sessionId });
        });
      }
    }
  });
  const tabs = Array.from({ length: 6 }, () => service.inspectSessionWork("session-1"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspections.length, 1);

  projectRoot = "/project-b";
  const otherProject = service.inspectSessionWork("session-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspections.length, 2);
  assert.equal(inspections[1].projectRoot, "/project-b");

  projectRoot = "/project-a";
  canonicalCommit = "canonical-new";
  const changedSource = service.inspectSessionWork("session-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspections.length, 3);
  inspections[0].resolve({ unsaved: true });
  inspections[1].resolve({ unsaved: false });
  inspections[2].resolve({ unsaved: false });
  assert.ok((await Promise.all(tabs)).every((result) => result.ok && result.unsaved));
  assert.equal((await otherProject).unsaved, false);
  assert.equal((await changedSource).unsaved, false);

  const failed = service.inspectSessionWork("session-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspections.length, 4, "Completed reads must not be cached.");
  inspections[3].reject(new Error("Inspection failed"));
  assert.equal((await failed).ok, false);
  const retry = service.inspectSessionWork("session-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspections.length, 5, "Failed reads must not be cached.");
  inspections[4].resolve({ unsaved: true });
  assert.equal((await retry).unsaved, true);
});

test("session work inspection returns operations read after repository inspection", async () => {
  let saveTask = {
    id: "save-work",
    message: "Reconciling the session onto the saved commit.",
    status: "running",
    updatedAt: "2026-08-21T09:26:37.991Z"
  };
  const updateTask = { id: "update-session", status: "ready" };
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return { sessionId: "session-1", status: "active" };
          },
          store: {
            async readBackgroundTask(_sessionId, taskId) {
              return taskId === "save-work" ? saveTask : updateTask;
            }
          }
        };
      }
    },
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async inspectSessionWork() {
        saveTask = {
          id: "save-work",
          message: "Session work was saved.",
          status: "ready",
          updatedAt: "2026-08-21T09:26:55.716Z"
        };
        return { canonicalCommit: "saved", unsaved: false };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.unsaved, false);
  assert.deepEqual(result.operation, saveTask);
});

test("work inspection reconciles an interrupted published Save exactly once", async () => {
  const writes = [];
  const metadata = [];
  const runningTask = {
    checkpointCommit: "checkpoint",
    checkpointTree: "tree",
    expectedCanonicalCommit: "old",
    id: "save-work",
    operationId: "save-1",
    proposedCommit: "saved",
    status: "running"
  };
  let saveTask = runningTask;
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return taskId === "save-work"
          ? saveTask
          : { id: "update-session", status: "ready" };
      },
      async writeBackgroundTaskEvent(_sessionId, _taskId, input) {
        writes.push(input);
        saveTask = { ...saveTask, ...input.patch, events: [input.event] };
        return saveTask;
      },
      async writeMetadataValue(...args) {
        metadata.push(args);
      }
    }
  };
  let recoverCalls = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async inspectSessionWork() {
        return { unsaved: false };
      },
      async recoverSessionWorkSave(_sessionId, input) {
        recoverCalls += 1;
        assert.equal(input.recovery, runningTask);
        return {
          reconciled: true,
          saveCommit: "saved",
          status: "saved"
        };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");
  assert.equal(result.ok, true);
  assert.equal(result.operation.status, "ready");
  assert.equal(recoverCalls, 1);
  assert.deepEqual(metadata, [
    ["session-1", "canonical_commit", "saved"],
    ["session-1", "base_commit", "saved"]
  ]);
  assert.equal(writes[0].event.kind, "save-recovered");
});

test("work inspection recovers an interrupted prepared Update and advances its base once", async () => {
  const writes = [];
  const metadata = [];
  const runningUpdate = {
    canonicalCommit: "canonical-new",
    checkpointCommit: "checkpoint",
    checkpointTree: "tree",
    id: "update-session",
    mergedCommit: "merged",
    mergedTree: "merged-tree",
    oldHead: "old-head",
    oldIndexTree: "old-index",
    operationId: "update-1",
    stage: "prepared",
    status: "running"
  };
  let updateTask = runningUpdate;
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return taskId === "update-session"
          ? updateTask
          : { id: "save-work", status: "ready" };
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        writes.push([taskId, input]);
        updateTask = { ...updateTask, ...input.patch, events: [input.event], id: taskId };
        return updateTask;
      },
      async writeMetadataValue(...args) {
        metadata.push(args);
      }
    }
  };
  let recoverCalls = 0;
  let prepareCalls = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    workspaceSetupRunner: {
      async start() {
        prepareCalls += 1;
        assert.equal(updateTask.status, "ready");
        return { completion: null, state: { status: "succeeded" } };
      }
    },
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async inspectSessionWork() {
        return { unsaved: true };
      },
      async recoverSessionWorkUpdate(_sessionId, input) {
        recoverCalls += 1;
        assert.equal(input.recovery, runningUpdate);
        return {
          canonicalCommit: "canonical-new",
          reconciled: true,
          status: "updated"
        };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");
  assert.equal(result.ok, true);
  assert.equal(result.updateOperation.status, "ready");
  assert.equal(recoverCalls, 1);
  assert.deepEqual(metadata, [
    ["session-1", "canonical_commit", "canonical-new"],
    ["session-1", "base_commit", "canonical-new"]
  ]);
  assert.equal(writes[0][0], "update-session");
  assert.equal(writes[0][1].event.kind, "update-recovered");
  await service.inspectSessionWork("session-1");
  assert.equal(recoverCalls, 1);
  assert.equal(prepareCalls, 1);
});

test("work inspection observes a live Save without mistaking it for an interrupted operation", async () => {
  let backgroundTask = { id: "save-work", status: "ready" };
  let continueSave;
  let saveStarted;
  const saveStartedPromise = new Promise((resolve) => {
    saveStarted = resolve;
  });
  const continueSavePromise = new Promise((resolve) => {
    continueSave = resolve;
  });
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    async listSessionSummaries() {
      return [{ sessionId: "session-1", status: "active" }];
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return taskId === "save-work"
          ? backgroundTask
          : { id: taskId, status: "ready" };
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        backgroundTask = {
          ...backgroundTask,
          ...input.patch,
          events: [...(backgroundTask.events || []), input.event],
          id: taskId
        };
        return backgroundTask;
      },
      async writeMetadataValue() {}
    }
  };
  let recoveryCalls = 0;
  const service = createService({
    project: {
      async readCurrentProject() { return { slug: "test-project", repository: { mode: "managed_git", defaultBranch: "main" } }; },
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async inspectSessionWork() {
        return { unsaved: true };
      },
      async recoverSessionWorkSave() {
        recoveryCalls += 1;
        throw new Error("A live Save must not be recovered.");
      },
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        saveStarted();
        await continueSavePromise;
        return {
          reconciled: true,
          saveCommit: "saved",
          status: "saved"
        };
      }
    }
  });

  const saving = service.saveSessionWork("session-1");
  await saveStartedPromise;
  const inspected = await service.inspectSessionWork("session-1");
  assert.equal(inspected.operation.status, "running");
  assert.deepEqual(inspected.activeOperation, {
    kind: "save",
    operationId: inspected.operation.operationId
  });
  assert.equal(recoveryCalls, 0);

  continueSave();
  const saved = await saving;
  assert.equal(saved.ok, true);
  assert.equal(saved.operation.status, "ready");
  const afterSave = await service.inspectSessionWork("session-1");
  assert.equal(afterSave.activeOperation, null);
});

test("members can Save and create pull requests independently of AI access", async () => {
  const taskEvents = [];
  const metadataWrites = [];
  let saveCalls = 0;
  const denied = new Error("Only the workspace owner can use this personal AI connection.");
  denied.code = "vibe64_assistant_owner_required";
  denied.statusCode = 403;
  const runtime = {
    async getSession() {
      return { agentRuns: [], sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask() { return null; },
      async writeBackgroundTaskEvent(...args) {
        taskEvents.push(args);
        return args[2].patch;
      },
      async writeMetadataValue(...args) {
        metadataWrites.push(args);
      }
    }
  };
  const service = createService({
    project: {
      async readCurrentProject() { return { slug: "test-project", repository: { mode: "managed_git", defaultBranch: "main" } }; },
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async requireAssistantAccess() {
        throw denied;
      },
      async saveSessionWork(_sessionId, input) {
        assert.equal(input.vibe64User.username, "member");
        await input.onRepositoryWriteAcquired();
        saveCalls += 1;
        return { reconciled: true, saveCommit: "member-save", status: "saved" };
      },
      async createSessionPullRequest(_sessionId, input) {
        assert.equal(input.vibe64User.username, "member");
        assert.equal(input.title, "Member changes");
        return { ok: true, pullRequest: { number: 12 } };
      }
    }
  });

  const result = await service.saveSessionWork("session-1", {
    vibe64User: { username: "member", role: "member" }
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(saveCalls, 1);
  assert.equal(taskEvents.at(-1)[2].patch.status, "ready");
  assert.deepEqual(metadataWrites, [
    ["session-1", "canonical_commit", "member-save"],
    ["session-1", "base_commit", "member-save"]
  ]);
  const published = await service.createSessionPullRequest("session-1", {
    title: "Member changes", vibe64User: { username: "member", role: "member" }
  });
  assert.equal(published.ok, true, published.error);
  assert.equal(published.pullRequest.number, 12);
});

test("Save authority races become a ready update requirement rather than an AI failure", async () => {
  let backgroundTask = { id: "save-work", status: "ready" };
  const publications = [];
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask() { return null; },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        backgroundTask = {
          ...backgroundTask,
          ...input.patch,
          events: [...(backgroundTask.events || []), input.event],
          id: taskId
        };
        return backgroundTask;
      }
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(_sessionId, change) {
      publications.push(change);
    },
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        const error = new Error("The saved project changed. Update this session (rebase).");
        error.code = "vibe64_session_save_update_required";
        error.details = {
          canonicalCommit: "new",
          reconciledCommit: "old",
          updateRequired: true
        };
        throw error;
      }
    }
  });

  const result = await service.saveSessionWork("session-1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_session_save_update_required");
  assert.equal(backgroundTask.status, "ready");
  assert.equal(backgroundTask.updateRequired, true);
  assert.equal(Object.hasOwn(backgroundTask, "error"), false);
  assert.equal(backgroundTask.events.at(-1).kind, "save-update-required");
  assert.equal(publications.at(-1).reason, "session-save-update-required");
});

test("native Save persists bounded progress and advances the session base only after reconciliation", async () => {
  const taskEvents = [];
  const metadata = [];
  const publications = [];
  const sessions = new Map([
    ["session-1", { agentRuns: [], sessionId: "session-1", status: "active" }],
    ["session-2", { agentRuns: [], sessionId: "session-2", status: "active" }]
  ]);
  const runtime = {
    async getSession(sessionId) {
      return sessions.get(sessionId);
    },
    async listSessionSummaries() {
      return [...sessions.values()];
    },
    store: {
      async readBackgroundTask() { return { assistantHelper: { scope: { id: "pending-naming-cleanup" }, conversationId: "retained-native-id" } }; },
      async writeBackgroundTaskEvent(sessionId, taskId, input) {
        assert.equal(sessionId, "session-1");
        assert.equal(taskId, "save-work");
        assert.ok(["running", "ready", "failed"].includes(input.patch.status));
        taskEvents.push(input);
        return {
          ...input.patch,
          events: taskEvents.map((entry) => entry.event),
          id: taskId
        };
      },
      async writeMetadataValue(sessionId, name, value) {
        metadata.push([sessionId, name, value]);
      }
    }
  };
  const service = createService({
    project: {
      async readCurrentProject() { return { slug: "test-project", repository: { mode: "managed_git", defaultBranch: "main" } }; },
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async saveSessionWork(sessionId, input) {
        assert.equal(sessionId, "session-1");
        await input.onRepositoryWriteAcquired();
        await input.onProgress({ kind: "canonical-refreshed", message: "Canonical source refreshed." });
        return {
          reconciled: true,
          saveCommit: "def456",
          status: "saved"
        };
      }
    }
  });

  const result = await service.saveSessionWork("session-1", { originId: "tab:test" });
  assert.equal(result.ok, true);
  assert.equal(result.operation.status, "ready");
  assert.deepEqual(metadata, [
    ["session-1", "canonical_commit", "def456"],
    ["session-1", "base_commit", "def456"],
    ["session-2", "canonical_commit", "def456"]
  ]);
  assert.deepEqual(taskEvents.map((entry) => entry.event.kind), [
    "save-started",
    "canonical-refreshed",
    "saved"
  ]);
  assert.equal(taskEvents[0].reset, true);
  assert.equal(taskEvents[0].patch.assistantHelper.conversationId, "retained-native-id");
  assert.equal(taskEvents[1].reset, undefined);
  assert.equal(taskEvents[2].reset, undefined);
  assert.deepEqual(publications.map((entry) => entry[1].reason), [
    "session-save-started",
    "session-save-progress",
    "session-save-completed",
    "repository-canonical-changed"
  ]);
  assert.equal(publications[3][0], "session-2");
  assert.deepEqual(publications[3][1].payload, {
    canonicalCommit: "def456",
    sourceSessionId: "session-1"
  });
});

test("native Save persists its semantic commit-title profile across a durable task reload", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "save-profile-audit";
    const store = createVibe64SessionStore({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await store.createSession({
      runtimeKind: "genesis",
      sessionId
    });
    const executionProfile = {
      limits: {
        maxInputCharacters: 12_000,
        maxOutputCharacters: 1_000,
        timeoutMs: 45_000
      },
      model: "provider-owned-economy-model",
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
      revision: "codex-economy-v2",
      thinking: "low",
      workloadId: "commit_title"
    };
    const runtime = {
      getSession(id) {
        return store.readSession(id);
      },
      async listSessionSummaries() {
        return [await store.readSession(sessionId)];
      },
      store
    };
    const service = createService({
      project: {
      async readCurrentProject() { return { slug: "test-project", repository: { mode: "managed_git", defaultBranch: "main" } }; },
        async createRuntime() {
          return runtime;
        }
      },
      terminals: {
        async requireAssistantAccess() {
          return { ok: true };
        },
        async saveSessionWork(_sessionId, input) {
          await input.onRepositoryWriteAcquired();
          await input.onProgress({
            executionProfile,
            kind: "message",
            message: "Version name ready.",
            stage: "message-ready"
          });
          return {
            commitTitleExecutionProfile: executionProfile,
            reconciled: true,
            saveCommit: "saved-profile-commit",
            status: "saved"
          };
        }
      }
    });

    const saved = await service.saveSessionWork(sessionId);
    assert.equal(saved.ok, true);

    const reloadedStore = createVibe64SessionStore({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const reloadedTask = await reloadedStore.readBackgroundTask(sessionId, "save-work");
    assert.deepEqual(reloadedTask.executionProfile, executionProfile);
    assert.deepEqual(reloadedTask.commitTitleExecutionProfile, executionProfile);
    assert.equal(reloadedTask.commitTitleExecutionProfile.profileId, "economy");
    assert.equal(reloadedTask.commitTitleExecutionProfile.revision, "codex-economy-v2");
    assert.equal(reloadedTask.commitTitleExecutionProfile.workloadId, "commit_title");
  });
});

test("a successful Save keeps mirror maintenance failure as a visible retryable warning", async () => {
  const taskEvents = [];
  const runtime = {
    async getSession() {
      return { agentRuns: [], sessionId: "session-1", status: "active" };
    },
    async listSessionSummaries() {
      return [{ agentRuns: [], sessionId: "session-1", status: "active" }];
    },
    store: {
      async readBackgroundTask() {
        return null;
      },
      async writeBackgroundTaskEvent(_sessionId, _taskId, input) {
        taskEvents.push(input);
        return {
          ...input.patch,
          events: taskEvents.map((entry) => entry.event),
          id: "save-work"
        };
      },
      async writeMetadataValue() {}
    }
  };
  const cacheMaintenance = {
    attempted: true,
    code: "vibe64_test_cache_refresh_failed",
    kind: "github_mirror",
    message: "Your work was saved, but Vibe64 could not refresh its local clone cache. A later session or Save will retry it.",
    reason: "refresh_failed",
    retryable: true,
    status: "retryable"
  };
  const service = createService({
    project: {
      async readCurrentProject() { return { slug: "test-project", repository: { mode: "managed_git", defaultBranch: "main" } }; },
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged() {},
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        await input.onProgress({
          cacheMaintenance,
          kind: "cache-warning",
          message: cacheMaintenance.message,
          stage: "cache-maintenance-warning"
        });
        return {
          cacheMaintenance,
          reconciled: true,
          saveCommit: "saved-with-warning",
          status: "saved"
        };
      }
    }
  });

  const result = await service.saveSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.operation.status, "ready");
  assert.equal(result.operation.cacheMaintenance.status, "retryable");
  assert.equal(result.operation.cacheMaintenance.retryable, true);
  assert.deepEqual(taskEvents.map((entry) => entry.event.kind), [
    "save-started",
    "cache-warning",
    "saved"
  ]);
  assert.match(taskEvents.at(-1).event.message, /local clone cache could not be refreshed/u);
  assert.equal(Object.hasOwn(result.operation, "error"), false);
});

test("a reconciled Save supersedes an older failed session update", async () => {
  const tasks = new Map([
    ["update-session", {
      code: "vibe64_session_update_conflict",
      error: "Conflict",
      events: [],
      id: "update-session",
      status: "failed"
    }]
  ]);
  const runtime = {
    async getSession() {
      return { agentRuns: [], sessionId: "session-1", status: "active" };
    },
    async listSessionSummaries() {
      return [{ agentRuns: [], sessionId: "session-1", status: "active" }];
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return tasks.get(taskId) || null;
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        const prior = tasks.get(taskId) || { events: [], id: taskId };
        const task = {
          ...prior,
          ...input.patch,
          events: [...(prior.events || []), input.event],
          id: taskId
        };
        tasks.set(taskId, task);
        return task;
      },
      async writeMetadataValue() {}
    }
  };
  const service = createService({
    project: {
      async readCurrentProject() { return { slug: "test-project", repository: { mode: "managed_git", defaultBranch: "main" } }; },
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        return {
          reconciled: true,
          saveCommit: "saved-commit",
          status: "saved"
        };
      }
    }
  });

  const result = await service.saveSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(tasks.get("update-session").status, "ready");
  assert.equal(tasks.get("update-session").code, "");
  assert.equal(tasks.get("update-session").error, "");
  assert.equal(tasks.get("update-session").resolvedBySaveCommit, "saved-commit");
  assert.equal(tasks.get("update-session").events.at(-1).kind, "update-superseded-by-save");
});

test("work inspection repairs a failed update superseded by a later reconciled Save", async () => {
  const tasks = new Map([
    ["save-work", {
      events: [],
      id: "save-work",
      reconciled: true,
      saveCommit: "saved-commit",
      status: "ready",
      updatedAt: "2026-08-19T12:01:00.000Z"
    }],
    ["update-session", {
      code: "vibe64_session_update_conflict",
      error: "Conflict",
      events: [],
      id: "update-session",
      status: "failed",
      updatedAt: "2026-08-19T12:00:00.000Z"
    }]
  ]);
  const runtime = {
    async getSession() {
      return { agentRuns: [], sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return tasks.get(taskId) || null;
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        const prior = tasks.get(taskId) || { events: [], id: taskId };
        const task = {
          ...prior,
          ...input.patch,
          events: [...(prior.events || []), input.event],
          id: taskId
        };
        tasks.set(taskId, task);
        return task;
      }
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async inspectSessionWork() {
        return { unsaved: false };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.updateOperation.status, "ready");
  assert.equal(result.updateOperation.code, "");
  assert.equal(result.updateOperation.resolvedBySaveCommit, "saved-commit");
});

test("Update starts fresh and automatically prepares the updated workspace", async () => {
  const conflictRecovery = {
    baseCommit: "base",
    canonicalCommit: "canonical",
    checkpointTree: "checkpoint",
    conflictPaths: ["shared.txt"],
    conflictTree: "conflict-tree",
    reviewId: "review-id",
    oldHead: "head",
    oldIndexTree: "index"
  };
  const tasks = new Map();
  const taskWrites = [];
  const metadata = [];
  const session = {
    agentRuns: [],
    metadata: {},
    sessionId: "session-1",
    status: "active"
  };
  const runtime = {
    async getSession() {
      return session;
    },
    async listSessionSummaries() {
      return [session];
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return tasks.get(taskId) || null;
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        taskWrites.push({ input, taskId });
        const prior = input.reset === true
          ? { events: [], id: taskId }
          : tasks.get(taskId) || { events: [], id: taskId };
        const task = {
          ...prior,
          ...input.patch,
          events: [...(prior.events || []), input.event],
          id: taskId
        };
        tasks.set(taskId, task);
        return task;
      },
      async writeMetadataValue(_sessionId, name, value) {
        metadata.push([name, value]);
        session.metadata[name] = value;
      }
    }
  };
  let updates = 0;
  let denyWrite = false;
  let rejectPreparation = false;
  const preparations = [];
  const publications = [];
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(_sessionId, event) {
      publications.push(event);
    },
    workspaceSetupRunner: {
      async start(input) {
        assert.equal(input.runtime, runtime);
        assert.equal(input.session.metadata.base_commit, "canonical");
        assert.equal(tasks.get("update-session").status, "running");
        assert.notEqual(input.retry, true);
        if (rejectPreparation) throw new Error("Preparation could not start.");
        const pending = Promise.withResolvers();
        preparations.push(pending);
        session.workspaceSetup = { status: "running" };
        return { state: session.workspaceSetup, completion: pending.promise };
      }
    },
    terminals: {
      async inspectSessionWork() {
        return {
          ahead: 0,
          behind: 0,
          canonicalCommit: "canonical",
          sessionHead: "canonical",
          updateAvailable: false
        };
      },
      async updateSessionWork(_sessionId, input) {
        if (denyWrite) {
          const error = new Error("Another repository write is active.");
          error.code = "vibe64_agent_write_mode_busy";
          throw error;
        }
        updates += 1;
        await input.onRepositoryWriteAcquired();
        if (updates === 1) {
          assert.equal(input.conflictRecovery, null);
          const error = new Error("One file needs review.");
          error.code = "vibe64_session_update_conflict";
          error.details = {
            conflictPaths: ["shared.txt"],
            conflictRecovery
          };
          throw error;
        }
        assert.deepEqual(input.conflictRecovery, updates === 2 ? conflictRecovery : null);
        assert.equal(input.reviewedConflictId, updates === 2 ? conflictRecovery.reviewId : "");
        const running = tasks.get("update-session");
        assert.equal(running.status, "running");
        assert.equal(running.error, undefined);
        assert.equal(running.conflictRecovery, undefined);
        assert.equal(running.mergedCommit, undefined);
        assert.deepEqual(running.events.map((event) => event.kind), ["update-started"]);
        return {
          canonicalCommit: "canonical",
          reconciled: true,
          status: "updated"
        };
      }
    }
  });

  const failed = await service.updateSessionWork("session-1");
  assert.equal(failed.ok, false);
  assert.equal(tasks.get("update-session").status, "failed");
  assert.deepEqual(tasks.get("update-session").conflictRecovery, conflictRecovery);
  assert.equal(preparations.length, 0, "A conflicting update must not start preparation.");

  const retried = await service.updateSessionWork("session-1", {
    reviewedConflictId: conflictRecovery.reviewId
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.operation.status, "ready");
  assert.equal(retried.operation.conflictRecovery, null);
  assert.deepEqual(retried.operation.conflictPaths, []);
  assert.equal(retried.operation.code, "");
  assert.equal(retried.operation.error, "");
  assert.equal(preparations.length, 1, "The HTTP result must not wait for preparation to finish.");
  assert.equal(publications.at(-1).session.workspaceSetup.status, "running");
  assert.deepEqual(
    taskWrites.filter(({ input }) => input.event.kind === "update-started")
      .map(({ input }) => input.reset),
    [true, true]
  );
  assert.deepEqual(
    retried.operation.events.map((event) => event.kind),
    ["update-started", "updated"]
  );
  assert.ok(metadata.some(([name, value]) => name === "base_commit" && value === "canonical"));

  for (const status of ["failed", "running"]) {
    const previous = {
      status,
      operationId: "abandoned-attempt",
      error: "The conflicting file has not changed since the failed update.",
      conflictRecovery,
      mergedCommit: "old-prepared-commit",
      events: [{ kind: "old-failure" }]
    };
    tasks.set("update-session", previous);
    denyWrite = true;
    const denied = await service.updateSessionWork("session-1");
    assert.equal(denied.code, "vibe64_agent_write_mode_busy");
    assert.equal(tasks.get("update-session"), previous);

    denyWrite = false;
    const fresh = await service.updateSessionWork("session-1");
    assert.equal(fresh.ok, true);
    assert.notEqual(fresh.operation.operationId, previous.operationId);
    assert.equal(fresh.operation.status, "ready");
    assert.equal(fresh.operation.conflictRecovery, null);
    assert.deepEqual(fresh.operation.events.map((event) => event.kind), ["update-started", "updated"]);
  }
  assert.equal(preparations.length, 3);
  rejectPreparation = true;
  const preparedFailed = await service.updateSessionWork("session-1");
  assert.equal(preparedFailed.ok, true, "A preparation startup failure must not undo successful Update.");
  assert.equal(preparedFailed.operation.status, "ready");
  session.workspaceSetup = { status: "failed", diagnostic: "Dependency installation failed." };
  for (const pending of preparations) pending.resolve(session.workspaceSetup);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tasks.get("update-session").status, "ready");
  assert.ok(publications.some((event) => event.reason === "workspace-setup-completed" &&
    event.workspaceSetup.status === "failed"));
});

test("one exact update check is shared, cached, and invalidates every sibling session", async () => {
  const metadata = [];
  const publications = [];
  const sessions = new Map([
    ["session-1", {
      agentRuns: [],
      metadata: { base_commit: "canonical-old" },
      sessionId: "session-1",
      status: "active"
    }],
    ["session-2", {
      agentRuns: [],
      metadata: { base_commit: "canonical-old" },
      sessionId: "session-2",
      status: "active"
    }]
  ]);
  const runtime = {
    async getSession(sessionId) {
      return sessions.get(sessionId);
    },
    async listSessionSummaries() {
      return [...sessions.values()];
    },
    store: {
      async writeMetadataValue(sessionId, name, value) {
        metadata.push([sessionId, name, value]);
        const session = sessions.get(sessionId);
        session.metadata = {
          ...session.metadata,
          [name]: value
        };
      }
    }
  };
  let exactChecks = 0;
  let finishExactCheck;
  const exactCheck = new Promise((resolve) => {
    finishExactCheck = resolve;
  });
  const service = createService({
    project: {
      async readCurrentProject() { return { slug: "test-project", repository: { mode: "managed_git", defaultBranch: "main" } }; },
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async checkSessionUpdates() {
        exactChecks += 1;
        return exactCheck;
      }
    }
  });

  const firstCheck = service.checkSessionUpdates("session-1");
  const joinedCheck = service.checkSessionUpdates("session-1", { force: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exactChecks, 1);
  finishExactCheck({
    ahead: 0,
    behind: 2,
    canonicalCommit: "canonical-new",
    incomingVersions: [
      {
        author: "Merc",
        committedAt: "2026-08-19T07:14:00.000Z",
        commit: "a".repeat(40),
        message: "Newest saved work"
      },
      {
        author: "Geoff",
        committedAt: "2026-08-19T07:13:00.000Z",
        commit: "b".repeat(40),
        isMerge: true,
        message: "Earlier saved work"
      }
    ],
    incomingVersionsTruncated: false,
    reconciled: false,
    sessionHead: "session-old",
    updateAvailable: true
  });
  const [result, joined] = await Promise.all([firstCheck, joinedCheck]);
  const cached = await service.checkSessionUpdates("session-1");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.relationship, "behind");
  assert.equal(result.updateStrategy, "rebase");
  assert.equal(joined.checkedAt, result.checkedAt);
  assert.equal(joined.canonicalCommit, result.canonicalCommit);
  assert.equal(cached.cached, true);
  assert.equal(exactChecks, 1);
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(metadata[0][0], "session-1");
  assert.equal(metadata[0][1], "canonical_commit");
  assert.equal(metadata[0][2], "canonical-new");
  assert.equal(metadata[1][0], "session-1");
  assert.equal(metadata[1][1], "repository_update_check");
  assert.deepEqual(JSON.parse(metadata[1][2]), {
    ahead: 0,
    behind: 2,
    canonicalCommit: "canonical-new",
    checkedAt: result.checkedAt,
    incomingVersions: [
      {
        author: "Merc",
        committedAt: "2026-08-19T07:14:00.000Z",
        commit: "a".repeat(40),
        isMerge: false,
        message: "Newest saved work",
        shortCommit: "aaaaaaaa"
      },
      {
        author: "Geoff",
        committedAt: "2026-08-19T07:13:00.000Z",
        commit: "b".repeat(40),
        isMerge: true,
        message: "Earlier saved work",
        shortCommit: "bbbbbbbb"
      }
    ],
    incomingVersionsTruncated: false,
    relationship: "behind",
    sessionHead: "session-old",
    updateAvailable: true,
    updateStrategy: "rebase"
  });
  assert.deepEqual(metadata[2], ["session-2", "canonical_commit", "canonical-new"]);
  assert.deepEqual(publications.map((entry) => [entry[0], entry[1].reason]), [
    ["session-1", "session-repository-checked"],
    ["session-2", "repository-canonical-changed"]
  ]);
  assert.deepEqual(publications[0][1].payload.repositoryUpdateCheck, JSON.parse(metadata[1][2]));
});

test("repository history facades require a stored session from the selected project before terminal admission", async (t) => {
  await withTemporaryRoot(async (targetRoot) => {
    const selectedRoot = `${targetRoot}/alpha`;
    const foreignRoot = `${targetRoot}/beta`;
    const selectedStore = createVibe64SessionStore({
      projectContextRoot: selectedRoot,
      projectRuntimeRoot: projectRuntimeRoot(selectedRoot)
    });
    const foreignStore = createVibe64SessionStore({
      projectContextRoot: foreignRoot,
      projectRuntimeRoot: projectRuntimeRoot(foreignRoot)
    });
    await selectedStore.createSession({ runtimeKind: "genesis", sessionId: "history-alpha" });
    await foreignStore.createSession({ runtimeKind: "genesis", sessionId: "history-beta" });
    assert.equal((await foreignStore.readSession("history-beta")).projectContextRoot, foreignRoot);

    const commit = "a".repeat(40);
    for (const [operation, input] of [
      ["inspectRepositoryHistory", { cursor: "", limit: "1" }],
      ["inspectRepositoryVersionFiles", { commit, historySnapshotCommit: commit, limit: "1", offset: "0" }],
      ["inspectRepositoryVersionFileDiff", { commit, historySnapshotCommit: commit, lineLimit: "10", path: "first.txt" }]
    ]) {
      await t.test(operation, async () => {
        const calls = [];
        const loaded = [];
        const service = createService({
          project: {
            async createRuntime(options) {
              calls.push(["runtime", options]);
              return {
                async getSession(sessionId, sessionOptions) {
                  calls.push(["session", sessionId, sessionOptions]);
                  const session = await selectedStore.readSession(sessionId);
                  loaded.push(session);
                  return session;
                }
              };
            }
          },
          terminals: {
            async [operation](terminalInput) {
              calls.push(["terminal", terminalInput]);
              return { ok: true };
            }
          }
        });

        const missing = await service[operation](input);
        assert.equal(missing.ok, false);
        assert.equal(missing.code, "vibe64_repository_history_session_required");
        assert.deepEqual(calls, []);

        const foreign = await service[operation]({ ...input, sessionId: "history-beta" });
        assert.equal(foreign.ok, false);
        assert.equal(foreign.code, "vibe64_session_not_found");
        assert.deepEqual(calls, [
          ["runtime", { inspectSource: false }],
          ["session", "history-beta", { inspectSource: false }]
        ]);
        assert.deepEqual(loaded, []);

        calls.length = 0;
        const selectedInput = { ...input, sessionId: "history-alpha" };
        const selected = await service[operation](selectedInput);
        assert.equal(selected.ok, true);
        assert.equal(loaded.length, 1);
        assert.equal(loaded[0].projectContextRoot, selectedRoot);
        assert.deepEqual(calls, [
          ["runtime", { inspectSource: false }],
          ["session", "history-alpha", { inspectSource: false }],
          ["terminal", { ...selectedInput, session: loaded[0] }]
        ]);
        assert.equal(calls[2][1].session, loaded[0]);
      });
    }
  });
});

test("repository history returns the last successful update check from session state", async () => {
  const checkedAt = "2026-08-19T07:15:00.000Z";
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              metadata: {
                canonical_commit: "canonical-new",
                repository_update_check: JSON.stringify({
                  ahead: 3,
                  behind: 2,
                  canonicalCommit: "canonical-new",
                  checkedAt,
                  incomingVersions: [
                    {
                      author: "Merc",
                      committedAt: "2026-08-19T07:14:00.000Z",
                      commit: "c".repeat(40),
                      isMerge: false,
                      message: "Latest saved work"
                    },
                    {
                      author: "Geoff",
                      committedAt: "2026-08-19T07:13:00.000Z",
                      commit: "b".repeat(40),
                      isMerge: true,
                      message: "Earlier saved work"
                    }
                  ],
                  relationship: "diverged",
                  sessionHead: "session-local"
                })
              },
              sessionId: "session-1"
            };
          }
        };
      }
    },
    terminals: {
      async inspectRepositoryHistory() {
        return {
          historySnapshotCommit: "canonical-new",
          versions: []
        };
      }
    }
  });

  const result = await service.inspectRepositoryHistory({ sessionId: "session-1" });
  assert.deepEqual(result.updateCheck, {
    ahead: 3,
    behind: 2,
    canonicalCommit: "canonical-new",
    checkedAt,
    incomingVersions: [
      {
        author: "Merc",
        committedAt: "2026-08-19T07:14:00.000Z",
        commit: "c".repeat(40),
        isMerge: false,
        message: "Latest saved work",
        shortCommit: "cccccccc"
      },
      {
        author: "Geoff",
        committedAt: "2026-08-19T07:13:00.000Z",
        commit: "b".repeat(40),
        isMerge: true,
        message: "Earlier saved work",
        shortCommit: "bbbbbbbb"
      }
    ],
    incomingVersionsTruncated: false,
    relationship: "diverged",
    sessionHead: "session-local",
    updateAvailable: true,
    updateStrategy: "rebase"
  });
});

test("repository history does not reuse an update check from an older canonical version", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              metadata: {
                canonical_commit: "canonical-new",
                repository_update_check: JSON.stringify({
                  ahead: 0,
                  behind: 1,
                  canonicalCommit: "canonical-old",
                  checkedAt: "2026-08-19T07:15:00.000Z",
                  relationship: "behind"
                })
              },
              sessionId: "session-1"
            };
          }
        };
      }
    },
    terminals: {
      async inspectRepositoryHistory() {
        return { versions: [] };
      }
    }
  });

  const result = await service.inspectRepositoryHistory({ sessionId: "session-1" });
  assert.equal(Object.hasOwn(result, "updateCheck"), false);
});

test("repository history does not reuse an old behind check without incoming version facts", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              metadata: {
                canonical_commit: "canonical-new",
                repository_update_check: JSON.stringify({
                  ahead: 0,
                  behind: 1,
                  canonicalCommit: "canonical-new",
                  checkedAt: "2026-08-19T07:15:00.000Z",
                  relationship: "behind"
                })
              },
              sessionId: "session-1"
            };
          }
        };
      }
    },
    terminals: {
      async inspectRepositoryHistory() {
        return { versions: [] };
      }
    }
  });

  const result = await service.inspectRepositoryHistory({ sessionId: "session-1" });
  assert.equal(Object.hasOwn(result, "updateCheck"), false);
});

test("native Save rejects every active provider state before touching Git", async () => {
  let saveCalls = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              agentRuns: [{ active: false, state: "finalizing" }],
              sessionId: "session-1",
              status: "active"
            };
          }
        };
      }
    },
    terminals: {
      async requireAssistantAccess() {
        return { ok: true };
      },
      async saveSessionWork() {
        saveCalls += 1;
        const error = new Error("Wait for the assistant turn to finish before saving this session's work.");
        error.code = "vibe64_session_save_agent_active";
        error.retryable = true;
        throw error;
      }
    }
  });

  const result = await service.saveSessionWork("session-1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_session_save_agent_active");
  assert.equal(saveCalls, 1);
});

test("an early assistant message waits for workspace preparation and is sent once", async () => {
  let finishSetup;
  const setupFinished = new Promise((resolve) => {
    finishSetup = resolve;
  });
  let sendCount = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              sessionId: "session-1",
              status: "active"
            };
          }
        };
      }
    },
    terminals: {
      async sendAgentMessage() {
        sendCount += 1;
        return { ok: true };
      }
    },
    workspaceSetupRunner: {
      isRunning: () => true,
      start: () => null,
      wait: () => setupFinished
    }
  });

  const sending = service.sendAgentMessage("session-1", {
    message: "Build the catalogue."
  });
  await Promise.resolve();
  assert.equal(sendCount, 0);
  finishSetup({ status: "failed" });
  const result = await sending;
  assert.equal(result.ok, true);
  assert.equal(sendCount, 1);
});

test("live workspace preparation prevents retry and archive races", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              sessionId: "session-1",
              status: "active"
            };
          }
        };
      }
    },
    terminals: {
      async requireAssistantSelectionAccess() {
        return { ok: true };
      }
    },
    workspaceSetupRunner: {
      isRunning: () => true,
      start() {
        const error = new Error("Workspace preparation is already running.");
        error.code = "vibe64_workspace_setup_running";
        throw error;
      },
      wait: () => null
    }
  });

  const archived = await service.archiveSession("session-1");
  assert.equal(archived.ok, false);
  assert.equal(archived.code, "vibe64_workspace_setup_running");

  const retried = await service.retryWorkspaceSetup("session-1");
  assert.equal(retried.ok, false);
  assert.equal(retried.code, "vibe64_workspace_setup_running");
});

test("archiving retains main and temporary routing cleanup records", async () => {
  for (const temporary of [false, true]) {
    const lock = agentWriteLockHarness();
    const metadata = { assistant_routing_request: JSON.stringify({ status: "cancelled", helper: { conversationId: "helper" } }) };
    const session = { sessionId: "session-1", sourceReady: true, status: "active", metadata: temporary ? {} : metadata };
    if (temporary) lock.store.listSessionConversations = async () => [{ conversationId: "chat", routingMetadata: metadata }];
    let closed = false;
    const service = createService({ project: { createRuntime: async () => ({ store: lock.store,
      getSession: async () => session, markSessionClosing: async () => { closed = true; } }) },
      terminals: {},
      workspaceSetupRunner: { isRunning: () => false, wait: () => null } });
    const result = await service.archiveSession("session-1");
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_assistant_routing_pending");
    assert.equal(closed, false);
  }
});

test("an active Save keeps archiving out of its agent-write window", async () => {
  const lock = agentWriteLockHarness();
  let finishSave;
  let saveStarted;
  const saveStartedPromise = new Promise((resolve) => {
    saveStarted = resolve;
  });
  const saveFinishedPromise = new Promise((resolve) => {
    finishSave = resolve;
  });
  const calls = [];
  const session = {
    sessionId: "session-1",
    sourceReady: true,
    status: "active"
  };
  const runtime = {
    async archiveSession() {
      calls.push("archive");
      session.status = "archived";
      return { ...session };
    },
    async clearSessionClosing() {
      calls.push("clear-closing");
    },
    async getSession() {
      return { ...session };
    },
    async markSessionClosing() {
      calls.push("closing");
    },
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const saving = requireAgentWrite(runtime, "session-1", async () => {
    calls.push("save-started");
    saveStarted();
    await saveFinishedPromise;
    calls.push("save-finished");
  });
  await saveStartedPromise;

  const blocked = await service.archiveSession("session-1");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "vibe64_agent_write_mode_busy");
  assert.equal(blocked.retryable, true);
  assert.deepEqual(calls, ["save-started"]);

  finishSave();
  await saving;
  const archived = await service.archiveSession("session-1");
  assert.equal(archived.ok, true);
  assert.deepEqual(calls, [
    "save-started",
    "save-finished",
    "closing",
    "terminals",
    "archive"
  ]);
  assert.deepEqual(lock.attempts.map((attempt) => attempt.operationName), [
    "agent-write-mode",
    "agent-write-mode",
    "agent-write-mode"
  ]);
});

test("active archiving keeps Save out of its agent-write window", async () => {
  const lock = agentWriteLockHarness();
  let finishCleanup;
  let cleanupStarted;
  const cleanupStartedPromise = new Promise((resolve) => {
    cleanupStarted = resolve;
  });
  const cleanupFinishedPromise = new Promise((resolve) => {
    finishCleanup = resolve;
  });
  const calls = [];
  const runtime = {
    async archiveSession() {
      calls.push("archive");
      return { sessionId: "session-1", status: "archived" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return { sessionId: "session-1", sourceReady: true, status: "active" };
    },
    async markSessionClosing() {
      calls.push("closing");
    },
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals-started");
        cleanupStarted();
        await cleanupFinishedPromise;
        calls.push("terminals-finished");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const archiving = service.archiveSession("session-1");
  await cleanupStartedPromise;
  let saveRan = false;
  const save = await runVibe64AgentWriteExclusive(runtime, "session-1", async () => {
    saveRan = true;
  });
  assert.equal(save.acquired, false);
  assert.equal(save.value.code, "vibe64_agent_write_mode_busy");
  assert.equal(save.value.retryable, true);
  assert.equal(saveRan, false);

  finishCleanup();
  const archived = await archiving;
  assert.equal(archived.ok, true);
  assert.deepEqual(calls, [
    "closing",
    "terminals-started",
    "terminals-finished",
    "archive"
  ]);
});

test("failed archiving cleanup releases the agent-write lock for retry", async () => {
  const lock = agentWriteLockHarness();
  const calls = [];
  let cleanupAttempt = 0;
  const runtime = {
    async archiveSession() {
      calls.push("archive");
      return { sessionId: "session-1", status: "archived" };
    },
    async clearSessionClosing() {
      calls.push("clear-closing");
    },
    async getSession() {
      return { sessionId: "session-1", sourceReady: true, status: "active" };
    },
    async markSessionClosing() {
      calls.push("closing");
    },
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        cleanupAttempt += 1;
        calls.push(`terminals:${cleanupAttempt}`);
        if (cleanupAttempt === 1) {
          const error = new Error("Temporary assistant cleanup failed.");
          error.code = "vibe64_test_cleanup_failed";
          throw error;
        }
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const failed = await service.archiveSession("session-1");
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "vibe64_test_cleanup_failed");
  assert.deepEqual(calls, ["closing", "terminals:1", "clear-closing"]);

  const retried = await service.archiveSession("session-1");
  assert.equal(retried.ok, true);
  assert.deepEqual(calls, [
    "closing",
    "terminals:1",
    "clear-closing",
    "closing",
    "terminals:2",
    "archive"
  ]);
});

test("concurrent archiving has one cleanup owner", async () => {
  const lock = agentWriteLockHarness();
  let finishCleanup;
  let cleanupStarted;
  const cleanupStartedPromise = new Promise((resolve) => {
    cleanupStarted = resolve;
  });
  const cleanupFinishedPromise = new Promise((resolve) => {
    finishCleanup = resolve;
  });
  let archiveCount = 0;
  let cleanupCount = 0;
  const runtime = {
    async archiveSession() {
      archiveCount += 1;
      return { sessionId: "session-1", status: "archived" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return { sessionId: "session-1", sourceReady: true, status: "active" };
    },
    async markSessionClosing() {},
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        cleanupCount += 1;
        cleanupStarted();
        await cleanupFinishedPromise;
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const first = service.archiveSession("session-1");
  await cleanupStartedPromise;
  const second = await service.archiveSession("session-1");
  assert.equal(second.ok, false);
  assert.equal(second.code, "vibe64_agent_write_mode_busy");
  assert.equal(cleanupCount, 1);
  assert.equal(archiveCount, 0);

  finishCleanup();
  const archived = await first;
  assert.equal(archived.ok, true);
  assert.equal(cleanupCount, 1);
  assert.equal(archiveCount, 1);
});

test("archiving a session releases its managed resources after terminals stop", async () => {
  const calls = [];
  const session = {
    sessionId: "session-1",
    sourcePath: "/srv/session-1/source",
    status: "active"
  };
  const runtime = {
    store: { async writeMetadataValue() {}, async listSessionsForRenewal() { return []; }, async listSessionConversations() { return []; } },
    async archiveSession() {
      calls.push("archive");
      return { ...session, status: "archived" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return session;
    },
    async markSessionClosing() {
      calls.push("closing");
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      },
      async releaseSessionResources(input) {
        calls.push(`resources:${input.sessionId}`);
        return { ok: true };
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const result = await service.archiveSession("session-1");
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["closing", "terminals", "resources:session-1", "archive"]);
});

test("archiving a source-creation failure does not release resources that were never provisioned", async () => {
  const calls = [];
  const session = {
    metadata: {
      source_creation_failed: "yes"
    },
    sessionId: "failed-source",
    sourceReady: false,
    status: "blocked"
  };
  const runtime = {
    store: { async writeMetadataValue() {}, async listSessionsForRenewal() { return []; }, async listSessionConversations() { return []; } },
    async archiveSession() {
      calls.push("archive");
      return { ...session, status: "archived" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return session;
    },
    async markSessionClosing() {
      calls.push("closing");
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      },
      async releaseSessionResources() {
        calls.push("resources");
        throw new Error("resources must not be released");
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const result = await service.archiveSession("failed-source");
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["closing", "terminals", "archive"]);
});

test("session creation resolves a partial selection before checking access", async () => {
  let catalogResolutions = 0;
  const resolvedSelection = {
    agentId: "codex",
    catalogRevision: "sha256:cd4f63e20cf4c9a130dc9581a295517e1273bc501b166d9d4a0ba8e6bec54729",
    engineId: "codex",
    modelId: VIBE64_CODEX_DEFAULT_MODEL,
    modelProviderId: "openai",
    schema: "vibe64.assistant-selection.v1",
    variantId: VIBE64_CODEX_DEFAULT_THINKING
  };
  const denied = new Error("Only the workspace owner can use this personal AI connection.");
  denied.code = "vibe64_assistant_owner_required";
  denied.statusCode = 403;
  const harness = sessionCreationPolicyHarness({
    async requireAssistantSelectionAccess(selection, options) {
      assert.deepEqual(selection, resolvedSelection);
      assert.equal(options.vibe64User.username, "member");
      throw denied;
    },
    async resolveAssistantSelection(selection) {
      catalogResolutions += 1;
      assert.deepEqual(selection, {
        configuredOnly: "true",
        engineId: "codex"
      });
      return resolvedSelection;
    }
  });

  const result = await harness.service.createSession({
    assistantSelection: { engineId: "codex" },
    vibe64User: { username: "member" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_assistant_owner_required");
  assert.equal(catalogResolutions, 1);
  assert.equal(harness.runtimeCreations, 0);
  assert.equal(harness.creationInputs.length, 0);
  assert.equal(harness.openSessions.length, 0);
});

for (const chooseBranch of [false, true]) {
  test(`new chats initialize the chosen workflow and start in the actor's effective Plan (branch=${chooseBranch})`, async () => {
    await withTemporaryRoot(async (targetRoot) => {
      const actor = { role: "member", username: "collaborator" };
      const calls = [];
      const repositoryBranch = { name: "feature/review", fromBranch: "main", expectedCommit: "a".repeat(40) };
      const harness = sessionCreationPolicyHarness({ projectRuntimeRoot: projectRuntimeRoot(targetRoot),
        initializeModelRouting: async (input) => { calls.push(["setup", input]); return { ok: true }; },
        resolveAssistantPurpose: async (input, options) => {
          calls.push(["resolve", input, options]);
          return { available: true, effectiveSelection: initialPlanSelection, backupUsed: true, connectionIdentity: "shared-key" };
        },
        requireAssistantSelectionAccess: async (selection, options) => { calls.push(["access", selection, options]); }
      });
      harness.project.resolveSessionBranch = async (input) => {
        assert.equal(chooseBranch, true, "Default session creation must not inspect branches");
        assert.deepEqual(input, { selection: repositoryBranch, vibe64User: actor });
        return { name: repositoryBranch.name, commit: repositoryBranch.expectedCommit };
      };
      const result = await harness.service.createSession({ workflowEngineId: "codex", vibe64User: actor,
        ...(chooseBranch ? { repositoryBranch } : {}) });
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(calls, [
        ["setup", { engineIds: ["codex"], vibe64User: actor }],
        ["resolve", { purpose: "senior", workflowEngineId: "codex" }, { vibe64User: actor }],
        ["access", initialPlanSelection, { vibe64User: actor, expectedConnectionIdentity: "shared-key" }]
      ]);
      assert.deepEqual(JSON.parse(harness.creationInputs[0].metadata.assistant_routing), { mode: "senior", review: false, workflowEngineId: "codex" });
      assert.deepEqual(vibe64AssistantSelectionFromMetadata(harness.creationInputs[0].metadata), initialPlanSelection);
      assert.equal(harness.creationInputs[0].metadata.repository_branch, chooseBranch ? repositoryBranch.name : undefined);
      assert.deepEqual(harness.creationInputs[0].sourceContext, {
        ...(chooseBranch ? { expectedCommit: repositoryBranch.expectedCommit } : {}), vibe64User: actor
      });
    });
  });
}

test("unavailable routing and failed initialization do not create a session", async () => {
  for (const failedSetup of [true, false]) {
    const harness = sessionCreationPolicyHarness({
      initializeModelRouting: async () => failedSetup ? { ok: false, error: "Reload routing", code: "vibe64_assistant_routing_stale" } : { ok: true },
      resolveAssistantPurpose: async () => ({ available: false, message: "Plan unavailable", reasonCode: "vibe64_assistant_routing_invalid" }),
      requireAssistantSelectionAccess: async () => { assert.fail("No available destination to authorize"); }
    });
    const result = await harness.service.createSession();
    assert.equal(result.ok, false);
    assert.equal(result.code, failedSetup ? "vibe64_assistant_routing_stale" : "vibe64_assistant_routing_invalid");
    assert.equal(harness.runtimeCreations, 0);
  }
});

test("assistant selection can recover from an unavailable current choice before checking target access", async () => {
  const lock = agentWriteLockHarness();
  const metadataWrites = [];
  let agentStateCalls = 0;
  let catalogResolutions = 0;
  const currentSelection = {
    agentId: "codex",
    catalogRevision: "sha256:cd4f63e20cf4c9a130dc9581a295517e1273bc501b166d9d4a0ba8e6bec54729",
    engineId: "codex",
    modelId: VIBE64_CODEX_DEFAULT_MODEL,
    modelProviderId: "openai",
    schema: "vibe64.assistant-selection.v1",
    variantId: VIBE64_CODEX_DEFAULT_THINKING
  };
  const session = {
    metadata: {
      assistant_selection: JSON.stringify(currentSelection)
    },
    sessionId: "session-1",
    status: "active"
  };
  const requestedSelection = {
    ...currentSelection,
    modelId: "gpt-5.6-codex"
  };
  const denied = new Error("Only the workspace owner can use this personal AI connection.");
  denied.code = "vibe64_assistant_owner_required";
  denied.statusCode = 403;
  const runtime = {
    async getSession() {
      return session;
    },
    store: {
      ...lock.store,
      async writeMetadataValue(...args) {
        metadataWrites.push(args);
      }
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async agentSessionState() {
        agentStateCalls += 1;
        return null;
      },
      async requireAssistantAccess() {
        throw new Error("The unavailable current selection must not block recovery.");
      },
      async requireAssistantSelectionAccess(selection, options) {
        assert.deepEqual(selection, requestedSelection);
        assert.equal(options.vibe64User.username, "member");
        throw denied;
      },
      async resolveAssistantSelection(selection) {
        catalogResolutions += 1;
        assert.deepEqual(selection, {
          engineId: "codex",
          modelId: requestedSelection.modelId
        });
        return requestedSelection;
      }
    }
  });

  const result = await service.updateAssistantSelection("session-1", {
    assistantSelection: { modelId: requestedSelection.modelId },
    vibe64User: { username: "member" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_assistant_owner_required");
  assert.equal(catalogResolutions, 1);
  assert.equal(agentStateCalls, 0);
  assert.deepEqual(metadataWrites, []);
});

test("assistant selection checks destination access and requires shutdown only when changing engines", async () => {
  for (const target of ["opencode", "deepseek", "zai-coding-plan"]) {
    const changesEngine = target === "opencode";
    for (const failure of changesEngine ? ["active", "shutdown", ""] : ["active", ""]) {
      const lock = agentWriteLockHarness();
      const operations = [];
      const events = [];
      const current = { agentId: "codex", catalogRevision: `sha256:${"a".repeat(64)}`, engineId: "codex",
        modelId: VIBE64_CODEX_DEFAULT_MODEL, modelProviderId: "openai", schema: "vibe64.assistant-selection.v1", variantId: "high" };
      const next = target === "opencode"
        ? { ...current, agentId: "build", engineId: "opencode", modelProviderId: "deepseek", modelId: "deepseek-chat" }
        : { ...current, modelProviderId: target, modelId: target === "deepseek" ? "deepseek-flash" : "glm-5.3" };
      const session = { sessionId: "session-1", projectSlug: "project-a", status: "active", metadata: { assistant_selection: JSON.stringify(current) } };
      const runtime = { async getSession() { return session; }, store: { ...lock.store,
        async writeMetadataValue(_id, name, value) { operations.push("write"); session.metadata[name] = value; }
      } };
      const service = createService({
        publishSessionChanged: createSessionChangedPublisher({ publish(event) { events.push(event); } }),
        project: { async createRuntime() { return runtime; } }, terminals: {
        async resolveAssistantSelection() { return next; },
        async requireAssistantAccess() { throw new Error("Do not authorize the disconnected old account"); },
        async requireAssistantSelectionAccess(value) { assert.equal(value.modelProviderId, next.modelProviderId); operations.push("access"); },
        async agentSessionState() { operations.push("state"); return { turn: { active: failure === "active" } }; },
        async prepareAssistantChangeover(id, context) {
          assert.equal(id, session.sessionId);
          assert.equal(context.session, session);
          operations.push("shutdown");
          return failure === "shutdown" ? { ok: false, code: "stop-failed" } : { ok: true };
        }
      } });
      const result = await service.updateAssistantSelection(session.sessionId, {
        assistantSelection: next, originId: "owner-browser", vibe64User: { role: "owner", username: "owner" }
      });
      if (failure) {
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.deepEqual(JSON.parse(session.metadata.assistant_selection), current);
        assert.ok(!operations.includes("write"));
        assert.equal(events.length, 0);
        if (failure === "active") assert.ok(!operations.includes("shutdown"));
      } else {
        assert.notEqual(result.ok, false, JSON.stringify(result));
        assert.equal(JSON.parse(session.metadata.assistant_selection).modelProviderId, next.modelProviderId);
        assert.deepEqual(operations, ["access", "state", ...(changesEngine ? ["shutdown"] : []), "write"]);
        assert.equal(events.length, 1);
        assert.equal(events[0].realtime.audience, "all_clients");
        assert.equal(events[0].realtime.event, "vibe64.session.changed");
        assert.deepEqual(events[0].realtime.payload, {
          projectSlug: "project-a", sessionId: "session-1", status: "active",
          originId: "owner-browser", reason: "session-assistant-selection-updated"
        });
      }
    }
  }
});

test("assistant model-access updates delegate the authenticated owner to the host seam", async () => {
  const calls = [];
  const service = createService({
    project: {},
    terminals: {
      async updateAssistantModelAccess(input, options) {
        calls.push({ input, options });
        return { connection: { id: input.modelProviderId }, ok: true };
      }
    }
  });

  const result = await service.updateAssistantModelAccess({
    engineId: "opencode",
    modelProviderId: "zai",
    unlocked: true,
    vibe64User: { role: "owner", username: "ada" }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    input: {
      engineId: "opencode",
      modelProviderId: "zai",
      unlocked: true
    },
    options: {
      vibe64User: { role: "owner", username: "ada" }
    }
  }]);
});

test("archived session history is ordered by archive time with a stable session-id tie-break", async () => {
  const requestedOptions = [];
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async listSessionSummaries(options) {
            requestedOptions.push(options);
            return [
              { archivedAt: "2026-09-02T10:00:00.000Z", sessionId: "2026-09-02", status: "archived" },
              { archivedAt: "2026-09-04T10:00:00.000Z", sessionId: "session-a", status: "archived" },
              { archivedAt: "2026-09-04T10:00:00.000Z", sessionId: "session-z", status: "archived" },
              { archivedAt: "2026-09-05T10:00:00.000Z", sessionId: "2026-08-01", status: "archived" }
            ];
          }
        };
      }
    },
    terminals: {},
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const result = await service.listArchivedSessions();

  assert.equal(result.ok, true);
  assert.deepEqual(requestedOptions, [{ statusGroup: "archived" }]);
  assert.deepEqual(result.sessions.map(({ sessionId }) => sessionId), [
    "2026-08-01",
    "session-z",
    "session-a",
    "2026-09-02"
  ]);
  assert.equal(Object.hasOwn(result, "creation"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
});

test("session responses enforce the ordinary three-session policy on the server", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const harness = sessionCreationPolicyHarness({
      initialSessions: [
        { sessionId: "session-1" },
        { sessionId: "session-2" }
      ],
      managed: true,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "session"
    });

    const available = await harness.service.listSessions();
    assert.deepEqual(available.creation, {
      canCreate: true,
      mode: "direct",
      showCreateAction: true
    });
    assert.deepEqual(available.limits, {
      maxOpenSessions: 3,
      openSessionCount: 2
    });

    const third = await harness.service.createSession();
    assert.equal(third.ok, true);
    assert.equal(third.sessionId, "session-3");
    assert.equal(third.creation.canCreate, false);
    assert.equal(third.creation.showCreateAction, true);
    assert.deepEqual(third.limits, {
      maxOpenSessions: 3,
      openSessionCount: 3
    });

    const rejected = await harness.service.createSession();
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    assert.deepEqual(rejected.details, {
      code: "vibe64_session_creation_limit",
      maxOpenSessions: 3,
      openSessionCount: 3
    });
    assert.equal(vibe64StatusCode(rejected), 409);
    assert.equal(harness.creationInputs.length, 1);
    assert.equal(harness.openSessions.length, 3);
  });
});

test("concurrent shared-database creation admits one request and leaves no rejected record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let releaseFirstCreation;
    let reportFirstCreation;
    const firstCreationStarted = new Promise((resolve) => {
      reportFirstCreation = resolve;
    });
    const firstCreationCanFinish = new Promise((resolve) => {
      releaseFirstCreation = resolve;
    });
    const harness = sessionCreationPolicyHarness({
      async beforeCreate() {
        reportFirstCreation();
        await firstCreationCanFinish;
      },
      managed: true,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project"
    });

    const first = harness.service.createSession({
      vibe64User: { username: "ada" }
    });
    await firstCreationStarted;
    const second = harness.service.createSession({
      vibe64User: { username: "grace" }
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(harness.creationInputs.length, 1);

    releaseFirstCreation();
    const responses = await Promise.all([first, second]);
    const accepted = responses.find((response) => response.ok === true);
    const rejected = responses.find((response) => response.ok === false);

    assert.equal(accepted.sessionId, "session-1");
    assert.deepEqual(accepted.creation, {
      canCreate: false,
      disabledReason: "This project shares one development database. Archive its open session before creating another.",
      mode: "direct",
      showCreateAction: false
    });
    assert.deepEqual(accepted.limits, {
      maxOpenSessions: 1,
      openSessionCount: 1
    });
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    assert.equal(vibe64StatusCode(rejected), 409);
    assert.deepEqual(rejected.details, {
      code: "vibe64_session_creation_limit",
      maxOpenSessions: 1,
      openSessionCount: 1
    });
    assert.equal(harness.creationInputs.length, 1);
    assertInitialPlanMetadata(harness.creationInputs[0].metadata, "ada");
    assert.deepEqual(harness.openSessions.map(({ sessionId, status }) => ({ sessionId, status })), [{
      sessionId: "session-1",
      status: "active"
    }]);
  });
});

test("an unfinished renewal durably reserves the shared-database session slot", async (t) => {
  for (const scenario of [
    {
      metadata: { renewal_quiesced_id: "renewal-1" },
      name: "quiesced before successor creation",
      sessionId: "renewal-source",
      status: "renewal_quiesced"
    },
    {
      metadata: {
        renewal_id: "renewal-1",
        renewed_from: "renewal-source"
      },
      name: "hidden successor transition",
      sessionId: "renewal-successor",
      status: "renewal_pending"
    }
  ]) {
    await t.test(scenario.name, async () => {
      await withTemporaryRoot(async (targetRoot) => {
        const harness = sessionCreationPolicyHarness({
          initialSessions: [{
            metadata: scenario.metadata,
            sessionId: scenario.sessionId,
            status: scenario.status
          }],
          managed: true,
          projectRuntimeRoot: projectRuntimeRoot(targetRoot),
          scope: "project"
        });

        const listed = await harness.service.listSessions();
        assert.equal(listed.creation.canCreate, false);
        assert.equal(listed.creation.showCreateAction, false);
        assert.deepEqual(listed.limits, {
          maxOpenSessions: 1,
          openSessionCount: 1
        });
        const rejected = await harness.service.createSession();
        assert.equal(rejected.code, "vibe64_session_creation_limit");
        assert.equal(harness.creationInputs.length, 0);
      });
    });
  }
});

test("shared-session admission releases its lock before workspace setup starts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let releaseSetup;
    let reportSetupStarted;
    const setupStarted = new Promise((resolve) => {
      reportSetupStarted = resolve;
    });
    const setupCanFinish = new Promise((resolve) => {
      releaseSetup = resolve;
    });
    const harness = sessionCreationPolicyHarness({
      managed: true,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project",
      async startWorkspaceSetup() {
        reportSetupStarted();
        await setupCanFinish;
        return { completion: null };
      }
    });

    const acceptedRequest = harness.service.createSession();
    await setupStarted;
    const rejected = await harness.service.createSession();

    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    assert.equal(vibe64StatusCode(rejected), 409);
    releaseSetup();
    const accepted = await acceptedRequest;
    assert.equal(accepted.ok, true);
    assert.equal(accepted.sessionId, "session-1");
  });
});

test("shared-session admission releases its lock before realtime publication", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let releasePublication;
    let reportPublicationStarted;
    const publicationStarted = new Promise((resolve) => {
      reportPublicationStarted = resolve;
    });
    const publicationCanFinish = new Promise((resolve) => {
      releasePublication = resolve;
    });
    const harness = sessionCreationPolicyHarness({
      managed: true,
      async publishSessionChanged() {
        reportPublicationStarted();
        await publicationCanFinish;
      },
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project"
    });

    const acceptedRequest = harness.service.createSession();
    await publicationStarted;
    const rejected = await harness.service.createSession();

    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    releasePublication();
    const accepted = await acceptedRequest;
    assert.equal(accepted.ok, true);
    assert.equal(accepted.sessionId, "session-1");
  });
});

test("post-creation setup and publication failures do not falsify a durable session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let publicationCalls = 0;
    const harness = sessionCreationPolicyHarness({
      managed: true,
      async publishSessionChanged() {
        publicationCalls += 1;
        throw new Error("simulated realtime failure");
      },
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project",
      async startWorkspaceSetup() {
        throw new Error("simulated setup start failure");
      }
    });

    const accepted = await harness.service.createSession();

    assert.equal(accepted.ok, true);
    assert.equal(accepted.sessionId, "session-1");
    assert.equal(accepted.creation.canCreate, false);
    assert.equal(publicationCalls, 1);
    assert.equal(harness.openSessions.length, 1);
    const rejected = await harness.service.createSession();
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
  });
});

test("new sessions publish running workspace preparation and its eventual result", async () => {
  const publications = [];
  const sessionCreationInputs = [];
  let finishSetup;
  const session = {
    sessionId: "session-1",
    status: "active",
    workspaceSetup: {
      status: "unconfigured"
    }
  };
  const runtime = {
    async createSession(input) {
      sessionCreationInputs.push(input);
      return session;
    },
    async getSession() {
      return { ...session };
    },
    async listSessionSummaries() {
      return sessionCreationInputs.length > 0 ? [{ ...session }] : [];
    }
  };
  const setupFinished = new Promise((resolve) => {
    finishSetup = () => {
      session.workspaceSetup = {
        currentLabel: "Install dependencies",
        status: "succeeded"
      };
      resolve(session.workspaceSetup);
    };
  });
  const service = createService({
    initializeModelRouting: async () => ({ ok: true }),
    project: {
      async createRuntime() {
        return runtime;
      },
      async developmentDatabasePolicy({ openSessions = [] } = {}) {
        return developmentDatabasePolicy({
          managed: false,
          openSessions
        });
      },
      async runProjectSessionPolicyExclusive(operation) {
        return operation();
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async resolveAssistantPurpose() { return { available: true, effectiveSelection: initialPlanSelection, connectionIdentity: "workspace-ai" }; },
      async requireAssistantSelectionAccess() {
        return { ok: true };
      }
    },
    workspaceSetupRunner: {
      isRunning: () => true,
      start() {
        session.workspaceSetup = {
          currentLabel: "Install dependencies",
          status: "running"
        };
        return {
          completion: setupFinished,
          state: session.workspaceSetup
        };
      },
      wait: () => setupFinished
    }
  });

  const vibe64User = {
    gid: 1001,
    home: "/home/ada",
    uid: 1001,
    username: "ada"
  };
  const created = await service.createSession({
    originId: "tab:test",
    vibe64User
  });
  assert.equal(created.workspaceSetup.status, "running");
  assert.equal(sessionCreationInputs.length, 1);
  assertInitialPlanMetadata(sessionCreationInputs[0].metadata, "ada");
  assert.deepEqual(sessionCreationInputs[0].sourceContext, { vibe64User });
  assert.equal(publications[0][1].reason, "session-created");
  assert.equal(publications[0][1].session.workspaceSetup.status, "running");

  finishSetup();
  await setupFinished;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(publications[1][1].reason, "workspace-setup-completed");
  assert.equal(publications[1][1].session.workspaceSetup.status, "succeeded");
});

test("workspace preparation starts required or newly configured recipes and retries failed attempts", async () => {
  let admissionBlocked = false;
  let status = "succeeded";
  let startCount = 0;
  const retryValues = [];
  const session = () => ({
    sessionId: "session-1",
    status: "active",
    workspaceSetup: { status }
  });
  const runtime = {
    async getSession() {
      return session();
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {},
    workspaceSetupRunner: {
      isRunning: () => false,
      async start(input) {
        startCount += 1;
        retryValues.push(input.retry);
        if (admissionBlocked) {
          return {
            code: "vibe64_agent_write_mode_busy",
            error: "Another assistant operation is starting. Try again in a moment.",
            ok: false,
            retryable: true
          };
        }
        status = "running";
        return {
          completion: null,
          state: { status }
        };
      },
      wait: () => null
    }
  });

  const rejected = await service.retryWorkspaceSetup("session-1");
  assert.equal(rejected.code, "vibe64_workspace_setup_retry_not_available");
  assert.equal(startCount, 0);

  status = "unconfigured";
  const newlyConfigured = await service.retryWorkspaceSetup("session-1");
  assert.equal(newlyConfigured.ok, true);
  assert.equal(newlyConfigured.workspaceSetup.status, "running");
  assert.equal(startCount, 1);
  assert.deepEqual(retryValues, [true]);

  status = "failed";
  const retried = await service.retryWorkspaceSetup("session-1");
  assert.equal(retried.ok, true);
  assert.equal(retried.workspaceSetup.status, "running");
  assert.equal(startCount, 2);
  assert.deepEqual(retryValues, [true, true]);

  status = "required";
  const required = await service.retryWorkspaceSetup("session-1");
  assert.equal(required.ok, true);
  assert.equal(required.workspaceSetup.status, "running");
  assert.equal(startCount, 3);
  assert.deepEqual(retryValues, [true, true, true]);

  status = "failed";
  admissionBlocked = true;
  const blocked = await service.retryWorkspaceSetup("session-1");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "vibe64_agent_write_mode_busy");
  assert.equal(blocked.retryable, true);
  assert.equal(status, "failed");
  assert.equal(startCount, 4);
});


test("conversation rewind forwards the authenticated actor without preparing the workspace", async () => {
  const session = { sessionId: "session-1" };
  const calls = [];
  const events = [];
  const runtime = { async getSession(id, options) {
    assert.equal(id, session.sessionId);
    assert.deepEqual(options, { inspectSource: false });
    return session;
  } };
  const sessions = createService({
    project: { async createRuntime(options) {
      assert.deepEqual(options, { inspectSource: false });
      return runtime;
    } },
    terminals: {
      async rewindConversation(...args) { calls.push(args); return { ok: true, text: "Last prompt" }; },
      async prepareWorkspaceSetup() { assert.fail("Undo must not prepare the workspace"); }
    },
    publishSessionChanged: async (...args) => events.push(args)
  });
  const action = createSessionActions({ sessions }).find((entry) => entry.id === ACTION_REWIND_CONVERSATION);
  const actor = { username: "member" };
  const result = await action.execute({
    sessionId: session.sessionId, turnId: "000002", originId: "browser-1",
    vibe64User: { username: "owner" }, checkpoint: { threadId: "untrusted" }
  }, { requestMeta: { request: { vibe64User: actor } } });
  assert.deepEqual(result, { ok: true, text: "Last prompt" });
  assert.deepEqual(calls, [[session.sessionId, {
    turnId: "000002", originId: "browser-1", vibe64User: actor
  }, { runtime, vibe64User: actor }]]);
  assert.deepEqual(events, [[session.sessionId, { originId: "browser-1", reason: "conversation-rewound", session }]]);
});

test("integration continuation action forwards only request identity and authenticated actor", async () => {
  const runtime = {};
  const calls = [];
  const events = [];
  const sessions = createService({
    project: { async createRuntime() { return runtime; } },
    terminals: { async resumeIntegrationContinuation(...args) {
      calls.push(args);
      return { ok: true, integrationSetup: { outcome: "completed", continuation: { status: "accepted" } } };
    } },
    publishSessionChanged: async (...args) => events.push(args)
  });
  const action = createSessionActions({ sessions }).find((entry) => entry.id === ACTION_RESUME_INTEGRATION_SETUP);
  const actor = { username: "member" };
  const result = await action.execute({
    sessionId: "session-1", turnId: "000001", requestId: "a".repeat(64),
    vibe64User: { username: "owner" }, message: "Untrusted text", threadId: "untrusted-thread"
  }, { requestMeta: { request: { vibe64User: actor } } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["session-1", { turnId: "000001", requestId: "a".repeat(64) }]);
  assert.equal(calls[0][2].runtime, runtime);
  assert.equal(calls[0][2].vibe64User, actor);
  assert.equal(typeof calls[0][2].readIntegrationConfiguration, "function");
  assert.deepEqual(events, [["session-1", { reason: "integration-setup-completed", session: null }]]);
});

test("integration setup skip needs no AI access and still validates the saved request", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({ projectContextRoot: targetRoot, projectRuntimeRoot: projectRuntimeRoot(targetRoot) });
    await store.createSession({ runtimeKind: "genesis", sessionId: "skip-request" });
    await store.writeConversationUserMessage("skip-request", { text: "Configure mail" });
    const turn = await store.writeConversationAssistantMessage("skip-request", {
      text: 'Configure mail.\n\n```vibe64-integration\n{"integrationId":"mail"}\n```'
    });
    const events = [];
    const runtime = { store, async getSession(sessionId) { return { sessionId, status: "active" }; } };
    const sessions = createService({
      project: { async createRuntime() { return runtime; } },
      terminals: { async requireAssistantAccess() { throw new Error("AI is unavailable."); } },
      publishSessionChanged: async (...args) => events.push(args)
    });
    const action = createSessionActions({ sessions }).find((entry) => entry.id === ACTION_SKIP_INTEGRATION_SETUP);
    const input = { sessionId: "skip-request", turnId: turn.turnId, requestId: turn.integrationSetup.requestId,
      vibe64User: { username: "owner" } };
    const context = { requestMeta: { request: { vibe64User: { username: "member", role: "member" } } } };
    const denied = await action.execute({ ...input, requestId: "f".repeat(64) }, context);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "vibe64_integration_setup_request_changed");
    assert.equal((await store.readConversationLog("skip-request"))[0].integrationSetup.outcome, "pending");
    assert.equal(events.length, 0);
    const accepted = await action.execute(input, context);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.integrationSetup.outcome, "skipped");
    assert.equal(events[0][0], "skip-request");
    assert.equal(events[0][1].reason, "integration-setup-skipped");
    assert.equal((await store.readConversationLog("skip-request")).length, 1);
  });
});

test("PR session creation binds only the server-resolved source and exact head commit", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const harness = sessionCreationPolicyHarness({ projectRuntimeRoot: projectRuntimeRoot(targetRoot) });
    const source = { number: 42, title: "Improve search", body: "GitHub description", headRepository: "alice/project",
      baseRepository: "example/project", baseBranch: "main", headBranch: "feature/search", headCommit: "a".repeat(40) };
    let requested;
    harness.project.resolvePullRequestSource = async (input) => { requested = input.number; return source; };
    const result = await harness.service.createSession({ pullRequestNumber: 42, headBranch: "main", github_pull_request: "untrusted" });
    assert.equal(result.ok, true, result.error);
    assert.equal(requested, 42);
    assert.deepEqual(JSON.parse(harness.creationInputs[0].metadata.github_pull_request), source);
    assert.equal(harness.creationInputs[0].sourceContext.expectedCommit, source.headCommit);
  });
});

test("chat mode changes retain the workflow after a foreign Intern answer", async () => {
  const lock = agentWriteLockHarness();
  const current = { agentId: "build", catalogRevision: `sha256:${"a".repeat(64)}`, engineId: "opencode",
    modelId: "big-pickle", modelProviderId: "opencode", schema: "vibe64.assistant-selection.v1", variantId: "" };
  const session = { sessionId: "session-1", projectSlug: "project-a", status: "active", metadata: {
    assistant_selection: JSON.stringify(current), assistant_routing: JSON.stringify({ mode: "intern", review: false, workflowEngineId: "codex" }) } };
  const runtime = { async getSession() { return session; }, store: { ...lock.store,
    async writeMetadataValue(_id, name, value) { session.metadata[name] = value; } } };
  const service = createService({ project: { async createRuntime() { return runtime; } }, terminals: {} });
  const changed = await service.updateAssistantSelection(session.sessionId, {
    assistantRouting: { mode: "senior", review: true }, vibe64User: { role: "member", username: "member" } });
  assert.notEqual(changed.ok, false, JSON.stringify(changed));
  assert.deepEqual(JSON.parse(session.metadata.assistant_routing), { mode: "senior", review: true, workflowEngineId: "codex" });
  assert.deepEqual(JSON.parse(session.metadata.assistant_selection), current);
  const foreignOverride = await service.updateAssistantSelection(session.sessionId, {
    assistantRouting: { mode: "junior", override: current }, vibe64User: { role: "member", username: "member" } });
  assert.equal(foreignOverride.ok, false);
  assert.match(foreignOverride.error, /workflow orchestrator/);
});

test("Auto cannot bypass an unfinished goal when native goal observation is unavailable", async () => {
  const lock = agentWriteLockHarness();
  const initialRouting = JSON.stringify({ mode: "junior", review: false, workflowEngineId: "codex" });
  const session = { sessionId: "session-1", projectSlug: "project-a", status: "active", metadata: {
    assistant_routing: initialRouting,
    assistant_selection: JSON.stringify({ schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
      modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` })
  } };
  const runtime = { async getSession() { return session; }, store: { ...lock.store,
    async writeMetadataValue(_id, name, value) { session.metadata[name] = value; } } };
  let observed = { status: "unavailable", goal: null };
  const service = createService({ project: { async createRuntime() { return runtime; } },
    terminals: { async readAgentGoal() { return observed; } } });
  const input = { assistantRouting: { mode: "auto", review: false }, vibe64User: { role: "owner", username: "owner" } };
  for (const status of ["active", "paused", "blocked", "budgetLimited", "usageLimited"]) {
    session.metadata.assistant_routing_goal = JSON.stringify({ status, mode: "junior" });
    const denied = await service.updateAssistantSelection(session.sessionId, input);
    assert.equal(denied.ok, false, status);
    assert.match(denied.error, /unfinished goal/);
    assert.equal(session.metadata.assistant_routing, initialRouting);
  }
  observed = { status: "available", goal: null };
  const cleared = await service.updateAssistantSelection(session.sessionId, input);
  assert.notEqual(cleared.ok, false, JSON.stringify(cleared));
  assert.equal(JSON.parse(session.metadata.assistant_routing).mode, "auto");
});
