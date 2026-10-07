import { createSessionConversationBinding, prepareSessionConversationDisposal } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createCapabilityHttpRuntime } from "@jskit-ai/kernel/server/http";
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { AssistantFeature } from "@jskit-ai/assistant-runtime/server";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { registerVibe64ActionContext } from "../../packages/vibe64-core/src/server/actionContext.js";
import { ACTION_READ_CONVERSATION_CONTEXT, createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { createService as createSessionService } from "../../packages/vibe64-sessions/src/server/service.js";
import { Vibe64ConversationsProvider } from "../../packages/vibe64-sessions/src/server/Vibe64ConversationsProvider.js";
import { mainConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { Readable } from "node:stream";
import { codexAppServerThreadSettings, codexAppServerTurnSettings } from "../../packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js";
import { createProviderUsage } from "../../packages/vibe64-terminals/src/server/providerUsage.js";
import { createCodexProviderConnectionStore } from "../../packages/vibe64-core/src/server/codexProviderConnections.js";

import { createCodexTerminalController } from "../fixtures/codexMainConversation.js";
import { prepareCodexModelRouting } from "../../packages/vibe64-terminals/src/server/nativeConversationRetirement.js";
import {
  codexTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import {
  freezeTerminalNamespaceAdmission,
  thawTerminalNamespaceAdmission
} from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import {
  createService as createTerminalService
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  createService as createSourceEditorService
} from "../../packages/vibe64-source-editor/src/server/service.js";
import {
  CodexAppServerAgentProvider,
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
  codexAppServerRuntimeDir,
  currentCodexAccountIdentitySignature,
  stopCodexAppServerRuntime
} from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import {
  MINIMUM_CODEX_VERSION
} from "../../packages/vibe64-runtime/src/server/minimumCodexVersion.js";
import {
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  CODEX_HELPER_THREAD_LIFECYCLES,
  createCodexHelperThreadLedger
} from "../../packages/vibe64-terminals/src/server/codexHelperThreadLedger.js";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "../../packages/vibe64-runtime/src/shared/agentExecutionProfiles.js";
import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  serializeVibe64AssistantSelection
} from "../../packages/vibe64-runtime/src/shared/assistantSelection.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  sessionRenewalHandoverHash
} from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";
import { installVibe64ManagedExecutionProvider, stableHash } from "@local/vibe64-execution/server";
import { createCodexGitCommandService, prepareCodexGitCommand } from "../../packages/vibe64-terminals/src/server/codexGitCommand.js";
import { agentSessionCommandEnvironmentIsHealthy } from "../../packages/vibe64-terminals/src/server/agentCommandEnvironment.js";
import { genesisCommandShimDirectory, vibe64HostContextRegistry } from "../../packages/vibe64-genesis/src/server/index.js";
import { vibe64DriverInputFromRegistry } from "../../packages/vibe64-genesis/src/server/promptContext.js";
import { writeCodexAuthMarker } from "../../packages/vibe64-core/src/server/codexAuthState.js";
import { createAssistantRoutingStore } from "../../packages/vibe64-core/src/server/assistantRoutingStore.js";
import { sendWithAssistantChangeover } from "../../packages/vibe64-terminals/src/server/assistantChangeover.js";

const TEST_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"a".repeat(64)}`;
const TEST_AUTH_STATE_SIGNATURE = `v1:${"b".repeat(24)}`;
const TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"d".repeat(64)}`;

function exactStoppedRuntimeMetadata(runtimeDir, {
  stopped = false
} = {}) {
  return {
    pid: 99999999,
    processExitVerifiedAt: stopped ? "2026-08-25T00:00:00.000Z" : "",
    processIdentity: {
      commandHash: "0123456789ab",
      platform: "linux-proc",
      runtimeToken: "11111111-1111-4111-8111-111111111111",
      startTimeTicks: "1",
      version: 1
    },
    processState: stopped ? "stopped" : "running",
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    runtimeDir,
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    transport: "unix"
  };
}

async function exactProcessIdentity(pid, runtimeToken, commandHash) {
  const statText = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = statText.slice(statText.lastIndexOf(")") + 1).trim().split(/\s+/u);
  return {
    commandHash,
    platform: "linux-proc",
    runtimeToken,
    startTimeTicks: fields[19],
    version: 1
  };
}

function createProvider(calls, subscribers, captures, providerOptions = {}) {
  captures.providerOptions.push(providerOptions);
  return {
    close() {
      calls.push(["close"]);
      captures.closes += 1;
    },
    currentConnectionGeneration() {
      return captures.connectionGeneration;
    },
    isAvailable() {
      return captures.connected !== false;
    },
    currentServerInfo() {
      return { userAgent: captures.serverUserAgent };
    },
    async currentRuntimeInfo() {
      captures.onCurrentRuntimeInfo?.();
      if (captures.currentRuntimeInfoWait) await captures.currentRuntimeInfoWait;
      return {
        ...captures.runtimeInfo,
        executionMode: providerOptions.executionMode || "interactive"
      };
    },
    async currentHelperExecutionContext() {
      return {
        accountIdentitySignature: captures.runtimeInfo.accountIdentitySignature,
        cwd: providerOptions.helperWorkdir,
        executionMode: "helper"
      };
    },
    async ensureAvailable() {
      calls.push(["ensure"]);
      captures.onEnsureAvailable?.();
      if (captures.ensureAvailableWait) {
        await captures.ensureAvailableWait;
      }
      await mkdir(captures.runtimeInfo.runtimeDir, { recursive: true });
    },
    async ensureRuntime() {
      calls.push(["ensureRuntime"]);
      return {
        endpoint: captures.runtimeInfo.endpoint,
        reused: captures.runtimeReused === true,
        runtimeDir: captures.runtimeInfo.runtimeDir,
        transport: captures.runtimeInfo.transport
      };
    },
    async listModels(params, options = {}) {
      calls.push(["models", params]);
      captures.modelSignals.push(options.signal || null);
      if (captures.failModelLists > 0) {
        captures.failModelLists -= 1;
        const error = new Error("model catalog temporarily unavailable");
        error.code = "rate_limited";
        throw error;
      }
      if (captures.hangModelLists) {
        return new Promise((resolve, reject) => {
          void resolve;
          const abort = () => {
            captures.modelAborts += 1;
            const error = new Error("model catalog aborted");
            error.code = "ABORT_ERR";
            error.name = "AbortError";
            reject(error);
          };
          if (options.signal?.aborted) {
            abort();
            return;
          }
          options.signal?.addEventListener?.("abort", abort, { once: true });
        });
      }
      return {
        data: [{
          hidden: false,
          model: "gpt-5.6-luna",
          supportedReasoningEfforts: [{
            description: "Low",
            reasoningEffort: "low"
          }]
        }],
        nextCursor: null
      };
    },
    async listHelperThreads() {
      calls.push(["helperThreads"]);
      captures.helperThreadInventories += 1;
      if (captures.failHelperThreadInventories > 0) {
        captures.failHelperThreadInventories -= 1;
        throw new Error("helper inventory temporarily unavailable");
      }
      if (captures.helperThreadInventoryWait) {
        await captures.helperThreadInventoryWait;
      }
      return {
        threadIds: [...captures.helperThreadIds]
      };
    },
    async deleteThread(threadId) {
      calls.push(["delete", threadId]);
      captures.deletes.push(threadId);
      if (captures.deleteThreadHandler) {
        return captures.deleteThreadHandler(threadId);
      }
      if (captures.failDeletes > 0) {
        captures.failDeletes -= 1;
        const error = new Error("thread deletion failed");
        error.code = "delete_failed";
        error.method = "thread/delete";
        throw error;
      }
      if (captures.undefinedDeletes > 0) {
        captures.undefinedDeletes -= 1;
        return undefined;
      }
      return { id: threadId };
    },
    async interruptTurn(threadId, turnId) {
      calls.push(["interrupt", threadId, turnId]);
      captures.interrupts.push({ threadId, turnId });
      if (captures.failInterrupts > 0) {
        captures.failInterrupts -= 1;
        throw new Error("thread interruption failed");
      }
      captures.interruptHold?.enter();
      await captures.interruptHold?.wait;
      if (captures.interruptCompletesTurns) {
        emitCodexNotification(subscribers, turnCompleted({
          status: "completed",
          threadId,
          turnId
        }));
      }
      return { status: "interrupted" };
    },
    async trustProject() {},
    async listHooks(cwds) {
      calls.push(["hooks", cwds]);
      const inventoryIndex = captures.hookLists.length;
      captures.hookLists.push(cwds);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: captures.hookInventories[inventoryIndex] || captures.hooks,
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["config", params]);
      captures.configReads.push(params);
      return {
        config: {
          mcp_servers: captures.mcpServers
        }
      };
    },
    async resumeThread(threadId, settings) {
      calls.push(["resume", threadId]);
      captures.resumes.push({ settings, threadId });
      return Object.hasOwn(captures, "resumeThreadResult") ? captures.resumeThreadResult : { id: threadId };
    },
    async readThread(threadId) {
      calls.push(["read", threadId]);
      captures.onReadThread?.(threadId);
      if (captures.persistentHistory) return { raw: { id: threadId, historyMode: "paginated", status: captures.persistentStatus || "idle", turns: captures.persistentHistory } };
      throw new Error("ephemeral threads do not support includeTurns");
    },
    async readThreadStatus(threadId) {
      return this.readThread(threadId);
    },
    async listThreadTurns(threadId) {
      const thread = await this.readThread(threadId);
      return { data: thread.raw?.turns || thread.turns || [] };
    },
    async readGoal() { return { goal: captures.persistentGoal || null }; },
    async stopThreadForObservationLoss(threadId, turnId) {
      calls.push(["stopObserved", threadId, turnId]);
      captures.persistentStatus = "idle";
      if (captures.persistentGoal) captures.persistentGoal.status = "paused";
    },
    async steerTurn(threadId, turnId, message, options) {
      calls.push(["steer", { threadId, turnId, message, options }]);
      return { id: turnId };
    },
    async sendTurn(threadId, input, settings) {
      calls.push(["turn", threadId]);
      const turnId = `turn-${captures.turns.length + 1}`;
      captures.turns.push({ input, settings, threadId });
      await captures.onSendTurn?.({ input, settings, threadId });
      return {
        id: turnId,
        raw: { status: "inProgress" }
      };
    },
    async startThread(settings) {
      calls.push(["thread", settings]);
      captures.threads.push(settings);
      captures.onStartThread?.();
      if (captures.startThreadWait) {
        await captures.startThreadWait;
      }
      if (captures.failThreadStarts > 0) {
        captures.failThreadStarts -= 1;
        const error = new Error("thread start failed");
        error.code = "thread_start_failed";
        throw error;
      }
      return { id: captures.uniqueThreadIds ? `conversation-${captures.threads.length}` : "conversation-1" };
    },
    async stopRuntime(options = {}) {
      calls.push(["stopRuntime"]);
      captures.stopRuntimes += 1;
      captures.stopRuntimeOptions.push(options);
      captures.stopRuntimeProviderOptions.push(providerOptions);
      captures.onStopRuntime?.();
      if (captures.stopRuntimeWait) {
        await captures.stopRuntimeWait;
      }
      if (captures.stopRuntimeHandler) {
        return captures.stopRuntimeHandler({
          options,
          providerOptions
        });
      }
      return captures.stopRuntimeResult;
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }
  };
}

test("chat model discovery reuses a resident provider without closing it", async () => {
  await withConversationController(async ({ captures, controller }) => {
    await controller.executionProfileModelCatalog("session-1");
    const providerCount = captures.providerOptions.length;
    const catalog = await controller.modelCatalog();
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    assert.equal(captures.providerOptions.length, providerCount);
    assert.equal(captures.stopRuntimes, 0);
    assert.equal(captures.closes, 0);
  });
});

test("chat model discovery stops its temporary service on success and failure", async () => {
  await withConversationController(async ({ captures, controller }) => {
    assert.equal((await controller.modelCatalog()).data[0].model, "gpt-5.6-luna");
    assert.equal(captures.stopRuntimes, 1);
    await controller.invalidateAppServerRuntimes({ includeOwned: true, reason: "logout" });
    captures.failModelLists = 1;
    await assert.rejects(controller.modelCatalog(), /model catalog temporarily unavailable/u);
    assert.equal(captures.stopRuntimes, 2);
    captures.stopRuntimeResult = { stopped: false };
    await assert.rejects(controller.modelCatalog(), /process exit could not be verified/u);
    captures.stopRuntimeResult = { stopped: true };
  });
});

test("chat model catalog expires and never caches unverified runtime cleanup", async (t) => {
  await withConversationController(async ({ captures, controller }) => {
    const now = Date.now();
    await controller.modelCatalog();
    t.mock.method(Date, "now", () => now + 31_000);
    captures.stopRuntimeResult = { stopped: false };
    await assert.rejects(controller.modelCatalog(), /process exit could not be verified/u);
    captures.stopRuntimeResult = { stopped: true };
    await controller.invalidateAppServerRuntimes({ includeOwned: true, reason: "auth-session-status" });
    const stopped = captures.stopRuntimes;
    await controller.modelCatalog();
    assert.equal(captures.stopRuntimes, stopped + 1);
  });
});

test("chat model discovery leaves an already running shared process alive", async () => {
  await withConversationController(async ({ captures, controller }) => {
    captures.runtimeReused = true;
    await controller.modelCatalog();
    assert.equal(captures.stopRuntimes, 0);
    assert.equal(captures.closes, 1);
  });
});

test("repeated chat model discovery uses one short-lived runtime per auth generation", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const catalogs = await Promise.all([controller.modelCatalog(), controller.modelCatalog()]);
    assert.deepEqual(catalogs[0], catalogs[1]);
    assert.equal(captures.stopRuntimes, 1);
    await controller.modelCatalog();
    assert.equal(captures.stopRuntimes, 1);

    captures.runtimeInfo.authStateSignature = "v1:changed-login";
    captures.runtimeInfo.accountIdentitySignature = TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE;
    await controller.modelCatalog();
    assert.equal(captures.stopRuntimes, 2, "a new login must read its own live catalog");
  });
});

for (const outcome of ["cancelled", "provider failure", "account switch", "cleanup retry", "cleanup failure"]) {
  test(`detached helper work reports automatic thread retirement after ${outcome}`, async () => {
    await withConversationController(async ({ captures, controller, projectRuntimeRoot, session, subscribers }) => {
      const profile = sourceExplanationHelperProfile({ workloadId: "prompt_hint" });
      const retired = [];
      const pending = controller.streamDetachedChatTurn(session.sessionId, {
        executionProfile: profile, expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
        outputSchema: sourceExplanationOutputSchema(2500),
        prompt: "Suggest a next step for the supplied conversation."
      }, { onEvent(event) { if (event.type === "thread-retired") retired.push(event.threadId); } });
      const startup = await Promise.race([
        pending.then((result) => ({ result })),
        waitForCapturedTurns(captures, 1).then(() => ({ started: true }))
      ]);
      assert.equal(startup.started, true, JSON.stringify(startup.result));
      await waitForHelperLedgerLifecycle(projectRuntimeRoot, CODEX_HELPER_THREAD_LIFECYCLES.ACTIVE);
      if (outcome === "cleanup failure") captures.failDeletes = 100;
      if (outcome === "cleanup retry") {
        captures.failDeletes = 1;
        const cleanup = await controller.deleteDetachedChatThread(session.sessionId, {
          executionProfile: profile,
          threadId: "conversation-1"
        });
        assert.equal(cleanup.ok, false);
        await controller.describeProvider(session.sessionId);
      }
      if (outcome === "account switch") {
        const invalidated = await controller.invalidateAppServerRuntimes({ includeOwned: true, reason: "logout" });
        assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
        captures.runtimeInfo.accountIdentitySignature = TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE;
      }
      if (outcome === "cancelled") {
        await controller.interruptDetachedChatTurn(session.sessionId, {
          executionProfile: profile, threadId: "conversation-1", turnId: "turn-1"
        });
        await waitForSessionValue(() => captures.interrupts.length, (count) => count === 1, "helper interruption");
      }
      emitCodexNotification(subscribers, turnCompleted({ status: outcome === "provider failure" ? "failed" : "interrupted" }));
      const result = await pending;
      assert.equal(result.ok, false);
      if (outcome === "cleanup failure") {
        assert.deepEqual(retired, [], "failed cleanup must retain ownership");
        const { records } = await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll();
        assert.equal(records.length, 1);
        assert.equal(records[0].lifecycle, CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED);
        captures.failDeletes = 0;
        assert.equal((await controller.deleteDetachedChatThread(session.sessionId, {
          threadId: records[0].threadId, executionProfile: profile
        })).ok, true);
        return;
      }
      assert.deepEqual(retired, ["conversation-1"]);
      assert.deepEqual(captures.deletes, outcome === "cleanup retry"
        ? ["conversation-1", "conversation-1"]
        : ["conversation-1"]);
      assert.deepEqual((await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll()).records, []);
    });
  });
}

test("helper model discovery uses one live provider catalog per connection generation", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const first = await controller.executionProfileModelCatalog("session-1");
    const second = await controller.executionProfileModelCatalog("session-1");

    assert.equal(first, second);
    assert.deepEqual(first, {
      data: [{
        hidden: false,
        model: "gpt-5.6-luna",
        supportedReasoningEfforts: [{
          reasoningEffort: "low"
        }]
      }]
    });
    assert.deepEqual(calls.filter(([operation]) => operation === "models"), [[
      "models",
      {
        includeHidden: false,
        limit: 100
      }
    ]]);
  });
});

test("helper model discovery does not cache failures and invalidates on reconnect", async () => {
  await withConversationController(async ({ calls, captures, controller }) => {
    captures.failModelLists = 1;
    await assert.rejects(
      controller.executionProfileModelCatalog("session-1"),
      (error) => error.code === "rate_limited"
    );
    await controller.executionProfileModelCatalog("session-1");
    captures.connectionGeneration = 2;
    await controller.executionProfileModelCatalog("session-1");

    assert.equal(calls.filter(([operation]) => operation === "models").length, 3);
  });
});

test("Codex provider description uses the session's shared runtime and stable account identity", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const description = await controller.describeProvider("session-1");

    assert.deepEqual(description, {
      accountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
      providerId: "codex",
      transportId: "codex_app_server"
    });
    assert.equal(Object.isFrozen(description), true);
    assert.equal(captures.providerOptions.length, 1);
    assert.equal(captures.providerOptions[0].executionMode, "");
    assert.equal(captures.providerOptions[0].runtimeInstanceId, "");
    assert.match(captures.providerOptions[0].helperWorkdir, /helper-workspaces/u);
  });
});

test("helper work consumes the caller runtime and session without an implicit project runtime lookup", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    projectRuntimeRoot,
    projectService,
    session,
    subscribers
  }) => {
    let implicitRuntimeLookups = 0;
    let explicitRuntimeSessionLookups = 0;
    const originalCreateRuntime = projectService.createRuntime;
    const callerSession = {
      ...session,
      projectContextRoot: path.join(projectRuntimeRoot, "wrong-session-authority")
    };
    const runtime = {
      async getSession() {
        explicitRuntimeSessionLookups += 1;
        return session;
      },
      projectContextRoot,
      stateRoot: projectRuntimeRoot
    };
    projectService.createRuntime = () => {
      implicitRuntimeLookups += 1;
      throw new Error("Explicit helper context must not create another project runtime.");
    };

    try {
      const catalog = await controller.executionProfileModelCatalog("session-1", {
        runtime,
        session: callerSession
      });
      const description = await controller.describeProvider("session-1", {
        runtime,
        session: callerSession
      });
      const pending = controller.runDetachedChatTurn("session-1", {
        executionProfile: sourceExplanationHelperProfile(),
        outputSchema: sourceExplanationOutputSchema(),
        prompt: "Use the session selected by this browser request."
      }, {
        runtime,
        session: callerSession
      });
      await waitForCapturedTurns(captures, 1);
      completeDetachedTurn(subscribers, {
        text: JSON.stringify({ answer: "Used the explicit session context." })
      });
      const result = await pending;

      assert.equal(catalog.data[0].model, "gpt-5.6-luna");
      assert.equal(description.accountIdentitySignature, TEST_ACCOUNT_IDENTITY_SIGNATURE);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(implicitRuntimeLookups, 0);
      assert.equal(explicitRuntimeSessionLookups, 0);
      const ownership = await createCodexHelperThreadLedger({
        projectRuntimeRoot
      }).readAll();
      assert.equal(ownership.records.length, 1);
      assert.equal(ownership.records[0].projectContextRoot, projectContextRoot);
      assert.notEqual(
        ownership.records[0].projectContextRoot,
        callerSession.projectContextRoot
      );
    } finally {
      projectService.createRuntime = originalCreateRuntime;
    }
  });
});

test("source explanations preserve one pre-resolved profile through the terminal service and manager", async () => {
  await withConversationController(async ({
    calls,
    captures,
    projectContextRoot,
    projectRuntimeRoot,
    projectService,
    session,
    subscribers,
    temporaryRoot
  }) => {
    const store = createVibe64SessionStore({
      projectContextRoot,
      projectRuntimeRoot,
      projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
    });
    await store.createSession({
      metadata: session.metadata,
      runtimeKind: "genesis",
      sessionId: session.sessionId
    });
    const runtime = {
      async getSession(sessionId) {
        return store.readSession(sessionId);
      },
      projectContextRoot,
      stateRoot: projectRuntimeRoot,
      store
    };
    const codexToolHomeSource = path.join(temporaryRoot, "codex-tool-home");
    await mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true });
    await writeFile(
      path.join(codexToolHomeSource, ".codex", "auth.json"),
      JSON.stringify({
        OPENAI_API_KEY: "test-source-explanation-api-key",
        auth_mode: "api_key"
      })
    );
    captures.runtimeInfo.accountIdentitySignature = await currentCodexAccountIdentitySignature({
      executionMode: "helper",
      toolHomeSource: codexToolHomeSource
    });
    const terminalProjectService = {
      ...projectService,
      createRuntime() {
        return runtime;
      },
      createSessionStore() {
        return store;
      },
      async readCurrentProject() {
        return {
          projectContextRoot: projectService.createRuntime().projectContextRoot,
          slug: "test-project"
        };
      },
      async readEnv() {
        return { ok: true, records: [] };
      },
      async runInProjectContext(_context, operation) {
        return operation();
      },
      async saveEnvUserValues() {
        return { ok: true };
      }
    };
    const terminalService = createTerminalService({
      codexTerminalController: {
            codexAppServerProviderOptions: { systemRoot: path.join(temporaryRoot, "system") },
        codexAppServerProviderFactory(providerOptions) {
          return createProvider(calls, subscribers, captures, providerOptions);
        },
        codexToolHomeRequired: false,
        codexToolHomeSource
      },
      env: {
        VIBE64_RUNTIME_NAMESPACE: "test",
        VIBE64_WORKSPACE: "test"
      },
      projectService: terminalProjectService
    });
    await writeCodexAuthMarker(path.join(temporaryRoot, "system"), { connected: true, loginId: randomUUID() });
    await createAssistantRoutingStore({ systemRoot: path.join(temporaryRoot, "system") }).write({ codex: {
      helper: { ...JSON.parse(session.metadata.assistant_selection), modelId: "gpt-5.6-luna", variantId: "low", selectionSource: "explicit" }
    } }, 0);
    let firstResolvedProfile = null;
    let resolvedProfile = null;
    let resolutionCalls = 0;
    let resolutionCallsWhenThreadStarted = 0;
    captures.onStartThread = () => {
      resolutionCallsWhenThreadStarted = resolutionCalls;
    };
    const sourceTerminalService = {
      ...terminalService,
      async resolveEphemeralAgentExecutionProfile(...args) {
        resolutionCalls += 1;
        resolvedProfile = await terminalService.resolveEphemeralAgentExecutionProfile(...args);
        firstResolvedProfile ||= resolvedProfile;
        return resolvedProfile;
      }
    };
    const sourceEditor = createSourceEditorService({
      projectService: terminalProjectService,
      temporaryRoot,
      terminalService: sourceTerminalService
    });
    terminalService.setSourceEditorProvider(sourceEditor);
    await writeFile(
      path.join(session.metadata.source_path, "app.js"),
      "export function total(left, right) { return left + right; }\n"
    );

    try {
      const pending = sourceEditor.explainSelection({
        endColumn: 61,
        endLine: 1,
        explanationId: "exp-real-manager-profile",
        path: "app.js",
        sessionId: session.sessionId,
        startColumn: 1,
        startLine: 1
      });
      await Promise.race([
        waitForCapturedTurns(captures, 1),
        pending.then((result) => assert.fail(`Source explanation ended before starting a turn: ${JSON.stringify(result)}`))
      ]);
      completeDetachedTurn(subscribers, {
        text: JSON.stringify({
          answer: "This function returns the sum of its two arguments."
        })
      });
      const response = await pending;
      const auditProfile = vibe64AgentExecutionProfileAuditSnapshot(firstResolvedProfile);

      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(resolutionCallsWhenThreadStarted, 1);
      assert.equal(resolutionCalls, 2);
      assert.equal(calls.filter(([operation]) => operation === "models").length, 2, "routing and the isolated scope each verify the model catalogue");
      assert.equal(Object.isFrozen(firstResolvedProfile), true);
      assert.deepEqual(response.explanation.executionProfile, auditProfile);
      assert.equal(captures.threads[0].model, auditProfile.model);
      assert.equal(captures.threads[0].config.model_reasoning_effort, auditProfile.thinking);
      assert.equal(captures.turns[0].settings.model, auditProfile.model);
    } finally {
      await sourceEditor.close();
      await terminalService.closeSessionTerminals(session.sessionId);
    }
  });
});

for (const startFails of [false, true]) {
  test(startFails
    ? "source explanation Stop settles when a pending follow-up fails before announcing its turn identity"
    : "source explanation Stop targets a follow-up whose provider turn identity is still pending", {
    timeout: 15_000
  }, async (t) => {
    await withConversationController(async ({
      calls,
      captures,
      projectContextRoot,
      projectRuntimeRoot,
      projectService,
      session,
      subscribers,
      temporaryRoot
    }) => {
      const store = createVibe64SessionStore({
        projectContextRoot,
        projectRuntimeRoot,
        projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
      });
      await store.createSession({
        metadata: session.metadata,
        runtimeKind: "genesis",
        sessionId: session.sessionId
      });
      const runtime = {
        async getSession(sessionId) {
          return store.readSession(sessionId);
        },
        projectContextRoot,
        stateRoot: projectRuntimeRoot,
        store
      };
      const codexToolHomeSource = path.join(temporaryRoot, "codex-tool-home");
      await mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true });
      await writeFile(
        path.join(codexToolHomeSource, ".codex", "auth.json"),
        JSON.stringify({
          OPENAI_API_KEY: "test-source-explanation-api-key",
          auth_mode: "api_key"
        })
      );
      captures.runtimeInfo.accountIdentitySignature = await currentCodexAccountIdentitySignature({
        executionMode: "helper",
        toolHomeSource: codexToolHomeSource
      });
      captures.interruptCompletesTurns = true;
      const terminalProjectService = {
        ...projectService,
        createRuntime() {
          return runtime;
        },
        createSessionStore() {
          return store;
        },
        async readCurrentProject() {
          return { projectContextRoot, slug: "test-project" };
        },
        async readEnv() {
          return { ok: true, records: [] };
        },
        async runInProjectContext(_context, operation) {
          return operation();
        },
        async saveEnvUserValues() {
          return { ok: true };
        }
      };
      const followupDispatch = createDeterministicHold();
      const stopInputRead = createDeterministicHold();
      const terminalService = createTerminalService({
        codexTerminalController: {
                codexAppServerProviderOptions: { systemRoot: path.join(temporaryRoot, "system") },
          codexAppServerProviderFactory(providerOptions) {
            const provider = createProvider(calls, subscribers, captures, providerOptions);
            return {
              ...provider,
              async sendTurn(...args) {
                const turn = await provider.sendTurn(...args);
                if (turn.id === "turn-2") {
                  followupDispatch.enter();
                  await followupDispatch.wait;
                  if (startFails) {
                    throw new Error("Follow-up B startup failed before its turn identity.");
                  }
                }
                return turn;
              }
            };
          },
          codexToolHomeRequired: false,
          codexToolHomeSource
        },
        env: {
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        },
        projectService: terminalProjectService
      });
      await writeCodexAuthMarker(path.join(temporaryRoot, "system"), { connected: true, loginId: randomUUID() });
      await createAssistantRoutingStore({ systemRoot: path.join(temporaryRoot, "system") }).write({ codex: {
        helper: { ...JSON.parse(session.metadata.assistant_selection), modelId: "gpt-5.6-luna", variantId: "low", selectionSource: "explicit" }
      } }, 0);
      const sourceEditor = createSourceEditorService({
        projectService: terminalProjectService,
        temporaryRoot,
        terminalService
      });
      terminalService.setSourceEditorProvider(sourceEditor);
      const cleanupPath = path.join(temporaryRoot, "vibe64-source-editor",
        createHash("sha256").update(session.sessionId).digest("hex").slice(0, 24), "source-editor-explanation-cleanup.json");
      const explanationId = "exp-stop-pending-followup";
      const events = [];
      const stream = {
        emit(event) {
          events.push(event);
        },
        isClosed() {
          return false;
        }
      };
      const firstAnswer = "This function returns the sum of its two arguments.";
      const followupAnswer = "Late answer B must not replace the stopped message.";
      let stopObservation = null;
      let stopBeforeAcknowledgement = null;
      let finished = null;
      let firstMessages = null;
      await writeFile(
        path.join(session.metadata.source_path, "app.js"),
        "export function total(left, right) { return left + right; }\n"
      );

      try {
        const first = sourceEditor.streamExplanation({
          endColumn: 61,
          endLine: 1,
          explanationId,
          path: "app.js",
          sessionId: session.sessionId,
          startColumn: 1,
          startLine: 1
        }, stream);
        await Promise.race([
          first.then(() => assert.fail(`Initial explanation ended before native startup: ${JSON.stringify(events)}`)),
          waitForSessionValue(
            async () => events.find((event) => event.type === "source-explanation.turn" && event.turnId === "turn-1"),
            Boolean, "the initial source explanation turn identity"
          )
        ]);
        completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: firstAnswer }) });
        await first;
        const firstFinished = events.find((event) => event.type === "source-explanation.finished");
        assert.equal(firstFinished?.explanation.body, firstAnswer, JSON.stringify(events));
        firstMessages = structuredClone(firstFinished.explanation.messages);
        const firstRecord = JSON.parse(await readFile(cleanupPath, "utf8")).records[0];

        const followup = sourceEditor.streamExplanationFollowup({
          assistantMessageId: "msg_pending_b_assistant",
          explanationId,
          message: "Question B: explain the return value.",
          sessionId: session.sessionId,
          userMessageId: "msg_pending_b_user"
        }, stream);
        await waitForCapturedTurns(captures, 2);
        await followupDispatch.entered;
        const started = events.find((event) => event.type === "source-explanation.followup.started");
        assert.equal(started?.assistantMessageId, "msg_pending_b_assistant", JSON.stringify(events));
        assert.equal(started.explanation.agentTurnId, "");
        assert.equal(events.some((event) => event.type === "source-explanation.turn" && event.turnId === "turn-2"), false);
        const startingRecord = JSON.parse(await readFile(cleanupPath, "utf8")).records[0];
        assert.equal(startingRecord.helper.conversationId, firstRecord.helper.conversationId);
        assert.equal(startingRecord.helper.scope.id, firstRecord.helper.scope.id);
        assert.equal((await store.runSessionExclusive(
          session.sessionId,
          "agent-write-mode",
          () => "Source work can proceed while the follow-up is answering."
        )).acquired, true);

        const stopping = sourceEditor.stopExplanation({
          // Observe ordinary input consumption after real context reads, returning the unchanged ID.
          get explanationId() {
            stopInputRead.enter();
            return explanationId;
          },
          sessionId: session.sessionId
        }).then(
          (response) => { stopObservation = { response }; },
          (error) => { stopObservation = { error }; }
        );
        try {
          await stopInputRead.entered;
          await flushPromises();
          stopBeforeAcknowledgement = stopObservation;
          assert.equal(stopBeforeAcknowledgement, null, "Stop must wait for B's identity or startup failure.");
          assert.deepEqual(captures.interrupts, [], "Stop must not interrupt the completed initial turn.");
        } finally {
          // A correct Stop may still be waiting for B's identity; never await it behind this gate.
          followupDispatch.release();
        }
        if (!startFails) {
          await waitForSessionValue(
            async () => events.find((event) => event.type === "source-explanation.turn" && event.turnId === "turn-2"),
            Boolean,
            "follow-up B's announced source explanation turn identity"
          );
        }
        await stopping;
        if (!startFails) {
          completeDetachedTurn(subscribers, {
            text: JSON.stringify({ answer: followupAnswer }),
            turnId: "turn-2"
          });
        }
        await followup;
        finished = events.filter((event) => [
          "source-explanation.finished",
          "source-explanation.failed"
        ].includes(event.type)).at(-1)?.explanation;
        assert.ok(finished, JSON.stringify(events));
        assert.deepEqual(finished.messages.slice(0, firstMessages.length), firstMessages);
        assert.equal((await store.runSessionExclusive(
          session.sessionId,
          "agent-write-mode",
          () => "released"
        )).value, "released");
        const cleanupRecords = await readFile(cleanupPath, "utf8").then((text) => JSON.parse(text).records,
          (error) => { if (error.code === "ENOENT") return []; throw error; });
        if (!startFails) {
          assert.equal(cleanupRecords[0].helper.conversationId, "conversation-1");
          assert.equal(cleanupRecords[0].helper.runId, "turn-2");
        }
        assert.ifError(stopObservation.error);
        if (startFails) {
          assert.equal(events.some((event) => event.type === "source-explanation.turn" && event.turnId === "turn-2"), false);
          assert.deepEqual(captures.interrupts, []);
          assert.deepEqual(cleanupRecords, []);
          assert.equal(finished.status, "failed");
          assert.equal(finished.messages.at(-1).status, "failed");
          assert.match(finished.messages.at(-1).text, /Follow-up B startup failed/u);
        }
        t.diagnostic(JSON.stringify({
          finalAnswer: finished.messages.at(-1).text,
          finalStatus: finished.status,
          interrupts: captures.interrupts,
          retainedHelpers: cleanupRecords.length,
          stopBeforeAcknowledgement,
          stopResponse: stopObservation.response
        }));
      } finally {
        followupDispatch.release();
        stopInputRead.release();
        await sourceEditor.close();
        await terminalService.closeSessionTerminals(session.sessionId);
      }
      await assert.rejects(readFile(cleanupPath), { code: "ENOENT" });
      assert.ok(captures.deletes.includes("conversation-1"));
      assert.equal(stopObservation.response.ok, !startFails, JSON.stringify(stopObservation.response));
      if (!startFails) assert.equal(stopObservation.response.explanation.status, "stopped");
      assert.deepEqual(captures.interrupts, startFails ? [] : [{ threadId: "conversation-1", turnId: "turn-2" }]);
      assert.equal(finished.status, startFails ? "failed" : "stopped");
      assert.equal(finished.messages.at(-1).status, startFails ? "failed" : "stopped");
      assert.notEqual(finished.messages.at(-1).text, followupAnswer);
    });
  });
}

test("terminal renewal callbacks run inside the agent-write lock and hidden seeding uses only its renewal reader", async () => {
  await withConversationController(async ({ projectRuntimeRoot, projectService, session, temporaryRoot }) => {
    const codexToolHomeSource = path.join(temporaryRoot, "codex-tool-home");
    await mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true });
    await writeFile(
      path.join(codexToolHomeSource, ".codex", "auth.json"),
      JSON.stringify({
        OPENAI_API_KEY: "test-renewal-callback-api-key",
        auth_mode: "api_key"
      })
    );
    let lockDepth = 0;
    let normalReads = 0;
    let renewalReads = 0;
    const runtime = {
      async getSession() {
        normalReads += 1;
        return session;
      },
      async getSessionForRenewal() {
        renewalReads += 1;
        return {
          ...session,
          status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
        };
      },
      projectContextRoot: projectService.createRuntime().projectContextRoot,
      stateRoot: projectRuntimeRoot,
      store: {
        ...projectService.createRuntime().store,
        async runSessionExclusive(sessionId, operationName, operation) {
          assert.equal(sessionId, session.sessionId);
          assert.equal(operationName, "agent-write-mode");
          lockDepth += 1;
          try {
            return {
              acquired: true,
              value: await operation()
            };
          } finally {
            lockDepth -= 1;
          }
        },
        async runSessionExclusiveForRenewal(sessionId, operationName, operation) {
          assert.equal(sessionId, session.sessionId);
          assert.equal(operationName, "agent-write-mode");
          lockDepth += 1;
          try {
            return {
              acquired: true,
              value: await operation()
            };
          } finally {
            lockDepth -= 1;
          }
        }
      }
    };
    const terminalProjectService = {
      ...projectService,
      createSessionStore() {
        return {};
      },
      createRuntime() {
        return runtime;
      },
      async readCurrentProject() {
        return {
          projectContextRoot: runtime.projectContextRoot,
          slug: "test-project"
        };
      },
      async readEnv() {
        return { ok: true, records: [] };
      },
      async runInProjectContext(_context, operation) {
        return operation();
      },
      async saveEnvUserValues() {
        return { ok: true };
      }
    };
    const terminalService = createTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          assert.fail("Renewal callback controls must not start an assistant provider.");
        },
        codexToolHomeRequired: false,
        codexToolHomeSource
      },
      env: {
        VIBE64_RUNTIME_NAMESPACE: "test",
        VIBE64_WORKSPACE: "test"
      },
      projectService: terminalProjectService
    });
    const cancelled = {
      code: "cancelled-inside-lock",
      ok: false
    };

    const generated = await terminalService.generateSessionRenewalHandover(
      session.sessionId,
      { operationId: "renewal:generate" },
      {
        beforeStart(context) {
          assert.equal(lockDepth, 1);
          assert.equal(context.session, session);
          return cancelled;
        },
        runtime
      }
    );
    const merged = await terminalService.generateSessionRenewalHandover(
      session.sessionId,
      { operationId: "renewal:merged" },
      {
        beforeStart() {
          assert.equal(lockDepth, 1);
          return {
            input: {
              source: {
                authority: "github",
                commit: "a".repeat(40),
                ref: "refs/heads/main\ninvalid",
                repository: "https://github.com/example/project.git"
              }
            },
            ok: true
          };
        },
        runtime
      }
    );
    const seeded = await terminalService.seedSessionRenewalHandover(
      session.sessionId,
      { operationId: "renewal:seed" },
      {
        beforeStart(context) {
          assert.equal(lockDepth, 1);
          assert.equal(context.session.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);
          return cancelled;
        },
        runtime
      }
    );
    const renewalId = "renewal-terminal-cleanup";
    const hiddenSuccessor = {
      ...session,
      metadata: {
        ...session.metadata,
        renewal_id: renewalId,
        renewed_from: "source-session"
      },
      status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
    };
    assert.equal(normalReads, 3);
    await assert.rejects(
      () => terminalService.closeRenewalSuccessorSessionTerminals(hiddenSuccessor, {
        renewalId: "wrong-renewal",
        runtime
      }),
      TypeError
    );
    await terminalService.closeRenewalSuccessorSessionTerminals(hiddenSuccessor, {
      renewalId,
      runtime
    });

    assert.equal(generated, cancelled);
    assert.equal(merged.code, "vibe64_session_renewal_source_invalid");
    assert.equal(seeded, cancelled);
    assert.equal(normalReads, 3, "renewal closure retains its supplied hidden session context");
    assert.equal(renewalReads, 1);
    assert.equal(lockDepth, 0);
  });
});

function emitCodexNotification(subscribers, notification) {
  for (const subscriber of [...subscribers]) {
    subscriber(notification);
  }
}

function codexEvent({
  message = "",
  phase = "progress",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "codex/event",
    params: {
      event: {
        payload: {
          message,
          phase,
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId,
      turnId
    }
  };
}

function turnCompleted({
  status = "completed",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "turn/completed",
    params: {
      threadId,
      turn: {
        id: turnId,
        status
      },
      turnId
    }
  };
}

function turnStarted({
  status = "inProgress",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "turn/started",
    params: {
      threadId,
      turn: {
        id: turnId,
        status
      },
      turnId
    }
  };
}

function threadStatusChanged({
  status = "idle",
  threadId = "conversation-1"
} = {}) {
  return {
    method: "thread/status/changed",
    params: {
      status: { type: status },
      threadId
    }
  };
}

function threadGoalUpdated({
  status = "active",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "thread/goal/updated",
    params: {
      goal: {
        createdAt: 1_777_777_700_000,
        objective: "Complete the representative goal stream.",
        status,
        threadId,
        timeUsedSeconds: 60,
        tokenBudget: null,
        tokensUsed: 1_000,
        updatedAt: 1_777_777_760_000
      },
      threadId,
      turnId
    }
  };
}

function reasoningSummaryDelta({
  itemId = "reasoning-1",
  text = "",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "item/reasoning/summaryTextDelta",
    params: {
      delta: text,
      itemId,
      summaryIndex: 0,
      threadId,
      turnId
    }
  };
}

function assistantItemCompleted({
  itemId = "assistant-1",
  phase = "commentary",
  text = "",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "item/completed",
    params: {
      completedAtMs: 1_777_777_760_000,
      item: {
        id: itemId,
        phase,
        text,
        type: "agentMessage"
      },
      threadId,
      turnId
    }
  };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

const FIXTURE_WAIT_TIMEOUT_MS = 3_000;

async function waitForSessionValue(readValue, predicate, description) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < FIXTURE_WAIT_TIMEOUT_MS) {
    const value = await readValue();
    if (predicate(value)) {
      return value;
    }
    await flushPromises();
  }
  const value = await readValue();
  assert.fail(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

async function waitForCapturedTurns(captures, expectedCount) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < FIXTURE_WAIT_TIMEOUT_MS) {
    if (captures.turns.length >= expectedCount) {
      return;
    }
    await flushPromises();
  }
  assert.fail(`Expected ${expectedCount} captured Codex turns; found ${captures.turns.length}.`);
}

async function waitForHelperLedgerLifecycle(projectRuntimeRoot, lifecycle) {
  const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
  const startedAt = Date.now();
  while (Date.now() - startedAt < FIXTURE_WAIT_TIMEOUT_MS) {
    const listed = await ledger.readAll();
    if (listed.records.length === 1 && listed.records[0].lifecycle === lifecycle) {
      return listed.records[0];
    }
    await flushPromises();
  }
  const listed = await ledger.readAll();
  assert.fail(
    `Expected one ${lifecycle} helper record; found ${JSON.stringify(listed)}.`
  );
}

function sourceExplanationHelperProfile(overrides = {}) {
  const {
    limits = {},
    ...profileOverrides
  } = overrides;
  return defineVibe64AgentExecutionProfileResolution({
    limits: {
      maxInputCharacters: 100_000,
      maxOutputCharacters: 32_000,
      timeoutMs: 180_000,
      ...limits
    },
    model: "gpt-5.6-luna",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-helper-luna-low-v2",
    thinking: "low",
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION,
    ...profileOverrides
  });
}

function sourceExplanationOutputSchema(maxLength = 5_000) {
  return {
    additionalProperties: false,
    properties: {
      answer: {
        maxLength,
        minLength: 1,
        type: "string"
      }
    },
    required: ["answer"],
    type: "object"
  };
}

function turnTokenUsage({
  threadId = "conversation-1",
  turnId = "turn-1",
  usage = {}
} = {}) {
  return {
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      tokenUsage: {
        last: usage
      },
      turnId
    }
  };
}

function completeDetachedTurn(subscribers, {
  text = "",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  emitCodexNotification(subscribers, codexEvent({
    message: text,
    phase: "final_answer",
    threadId,
    turnId
  }));
  emitCodexNotification(subscribers, turnCompleted({
    threadId,
    turnId
  }));
}

async function managedSessionFixture(temporaryRoot) {
  const projectContextRoot = path.join(temporaryRoot, "authority");
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "session-1",
    "source"
  );
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  return {
    projectContextRoot,
    projectRuntimeRoot,
    session: {
      metadata: {
        [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection({
          agentId: "codex",
          catalogRevision: `sha256:${"f".repeat(64)}`,
          engineId: "codex",
          modelId: "gpt-5.5",
          modelProviderId: "openai",
          variantId: "high"
        }),
        repository_mode: "local_source",
        source_kind: "session_clone",
        source_path: sourcePath,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      sessionId: "session-1",
      sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-1")
    }
  };
}

async function managedProjectScopedSessionFixture(temporaryRoot, slug, sessionId) {
  const projectContextRoot = path.join(temporaryRoot, slug, "authority");
  const projectRuntimeRoot = path.join(temporaryRoot, slug, "runtime");
  const projectSessionSourceRoot = path.join(temporaryRoot, slug, "managed", "sessions");
  const sourcePath = path.join(
    projectSessionSourceRoot,
    "active",
    sessionId,
    "source"
  );
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  const metadata = {
    repository_mode: "local_source",
    source_kind: "session_clone",
    source_path: sourcePath,
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
  };
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot
  });
  await store.createSession({
    metadata,
    runtimeKind: "genesis",
    sessionId
  });
  const session = await store.readSession(sessionId);
  const runtime = {
    async getSession() {
      return store.readSession(sessionId);
    },
    async renderPrompt(_sessionId, { request } = {}) {
      return { prompt: String(request || "Continue.") };
    },
    projectContextRoot,
    stateRoot: projectRuntimeRoot,
    store
  };
  return {
    context: {
      projectContextRoot,
      projectRuntimeRoot,
      projectSessionSourceRoot,
      slug,
      targetRoot: projectContextRoot
    },
    runtime,
    session,
    store
  };
}

function createDeterministicHold() {
  let enter = () => null;
  let release = () => null;
  return {
    enter() {
      enter();
    },
    entered: new Promise((resolve) => {
      enter = resolve;
    }),
    release() {
      release();
    },
    wait: new Promise((resolve) => {
      release = resolve;
    })
  };
}

test("routing refuses to relocate an existing Codex conversation into another provider home", async () => {
  await withConversationController(async () => {
    for (const saved of [
      { codex_routing_home_provider: "deepseek", codex_conversation_id: "saved-thread" },
      { codex_routing_home_provider: "zai-coding-plan", codex_conversation_id: "saved-thread" },
      { agent_identity_provider: "opencode", codex_deepseek_conversation_id: "retained-thread" },
      { agent_identity_provider: "codex", agent_identity_model_provider: "deepseek", agent_identity_conversation_id: "saved-thread" }
    ]) {
      const metadata = { ...saved };
      const writes = [];
      const runtime = { store: { writeMetadataValue: async (...args) => writes.push(args) } };
      await assert.rejects(prepareCodexModelRouting("session-1", { modelProviderId: "deepseek" }, {
        runtime, session: { metadata }
      }), { code: "vibe64_codex_history_unsupported", statusCode: 409 });
      assert.deepEqual(metadata, saved);
      assert.deepEqual(writes, []);
    }
    const writes = [];
    const runtime = { store: { writeMetadataValue: async (...args) => writes.push(args) } };
    const metadata = {};
    await prepareCodexModelRouting("session-1", { modelProviderId: "deepseek" }, { runtime, session: { metadata } });
    assert.deepEqual(metadata, { codex_routing_home_provider: "openai" });
    assert.deepEqual(writes, [["session-1", "codex_routing_home_provider", "openai"]]);
    metadata.agent_identity_provider = "codex";
    metadata.agent_identity_model_provider = "deepseek";
    metadata.agent_identity_conversation_id = "shared-thread";
    await prepareCodexModelRouting("session-1", { modelProviderId: "openai" }, { runtime, session: { metadata } });
    assert.equal(writes.length, 1, "A shared Codex home remains pinned across provider changes.");
    assert.equal(metadata.agent_identity_conversation_id, "shared-thread");
  });
});

// Preserve the actual controller/provider fixture and route its scoped native
// commands through the supplied common handle and application binding owner.
function throughCommonScopedConversation(controller, persistentContext = null) {
  const provider = controller.conversationProvider;
  const runtime = createConversationRuntime({
    authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { conversation: ({ id, context, input, operation }) => operation === "dispose"
      ? prepareSessionConversationDisposal(provider, id, context, input)
      : createSessionConversationBinding(provider, id, context) }
  });
  const native = (method) => async (sessionId, input = {}, options = {}) => {
    const conversation = await runtime.open({ id: sessionId, representation: "native",
      context: { ...options, sessionId, scopedConversationId: input.conversationId } });
    return conversation[method](input);
  };
  if (persistentContext) {
    const manager = createSessionAgentManager({ providers: [provider], conversationRuntime: runtime });
    return { ...controller, closeAllForSession: () => runtime.close(),
      ...Object.fromEntries(["startConversationTurn", "readConversation", "waitForConversationTurn", "stopConversation", "deleteConversation"]
        .map(method => [method, (sessionId, input = {}, options = {}) => manager[method](sessionId, input, {
          ...persistentContext, ...options, sessionId
        })])) };
  }
  return { ...controller,
    startConversationTurn: native("send"), readConversation: native("read"),
    waitForConversationTurn: native("wait"), stopConversation: native("cancel"),
    deleteConversation: native("dispose") };
}

async function withConversationController(operation, {
  promptHints = null,
  codexHelperThreadLedgerFactory = null,
  providerFactory = null,
  codexGitCommand = null,
  codexToolHomeSource = undefined,
  codexSystemRoot = undefined
} = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-temporary-conversation-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const calls = [];
  const captures = {
    closes: 0,
    configReads: [],
    connectionGeneration: 1,
    deletes: [],
    environmentVersion: "one",
    helperThreadIds: [],
    helperThreadInventories: 0,
    helperThreadInventoryWait: null,
    ensureAvailableWait: null,
    failModelLists: 0,
    failDeletes: 0,
    failHelperThreadInventories: 0,
    failInterrupts: 0,
    failThreadStarts: 0,
    hangModelLists: false,
    hookLists: [],
    hookInventories: [],
    hooks: [{
      currentHash: "sha256:test-hook",
      enabled: true,
      handlerType: "command",
      isManaged: false,
      key: "test:write-hook",
      sourcePath: "/tmp/test-hook.js"
    }],
    mcpServers: {
      "test.write-anywhere": {
        command: "malicious-write-tool"
      }
    },
    interrupts: [],
    interruptCompletesTurns: false,
    modelAborts: 0,
    modelSignals: [],
    onStopRuntime: null,
    onCurrentRuntimeInfo: null,
    onEnsureAvailable: null,
    onProviderFactory: null,
    onProjectEnvironment: null,
    onReadThread: null,
    providerOptions: [],
    projectEnvironmentWait: null,
    resumes: [],
    runtimeInfo: null,
    serverUserAgent: `vibe64/${MINIMUM_CODEX_VERSION} (unit test)`,
    threads: [],
    stopRuntimes: 0,
    stopRuntimeOptions: [],
    stopRuntimeProviderOptions: [],
    stopRuntimeHandler: null,
    stopRuntimeResult: { stopped: true },
    stopRuntimeWait: null,
    startThreadWait: null,
    turns: [],
    undefinedDeletes: 0
  };
  const promptHintReads = [];
  const subscribers = new Set();
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  captures.runtimeInfo = {
    accountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    authStateSignature: TEST_AUTH_STATE_SIGNATURE,
    endpoint: `unix://${path.join(projectRuntimeRoot, "codex.sock")}`,
    executionContextHash: "c".repeat(12),
    provider: "codex_app_server",
    runtimeDir: path.join(projectRuntimeRoot, "codex-runtime"),
    runtimesHash: "d".repeat(12),
    terminalEnvHash: "e".repeat(12),
    toolHomeSource: "",
    transport: "unix"
  };
  const projectService = {
    agentRuntimeRoot: path.join(temporaryRoot, "agent-runtimes"),
    createRuntime() {
      return {
        async getSession() {
          return session;
        },
        projectContextRoot,
        store: {
          async readBackgroundTask() { return null; },
          async readSessionForRenewal() { return { ...session, backgroundTasks: [] }; },
          async withReadableSessionPaths(sessionId, operation) {
            return operation({ artifactsRoot: path.join(projectRuntimeRoot, "sessions", sessionId, "artifacts") });
          },
          async withReadableSessionPathsForRenewal(sessionId, operation) {
            return operation({ artifactsRoot: path.join(projectRuntimeRoot, "sessions", sessionId, "artifacts") });
          },
          async writeBackgroundTaskEvent(sessionId, taskId, entry) {
            captures.cleanupEvents ||= [];
            captures.cleanupEvents.push({ sessionId, taskId, ...entry });
            return entry.patch;
          }
        },
        stateRoot: projectRuntimeRoot
      };
    },
    async projectInspectionEnvironment() {
      captures.onProjectEnvironment?.();
      if (captures.projectEnvironmentWait) {
        await captures.projectEnvironmentWait;
      }
      return {
        PROVIDER_OWNERSHIP_VERSION: captures.environmentVersion,
        VIBE64_RUNTIME_NAMESPACE: "test",
        VIBE64_WORKSPACE: "test"
      };
    },
    async readPromptHints() {
      promptHintReads.push(true);
      return {
        ok: true,
        promptHints: promptHints !== false
      };
    }
  };
  const controller = createCodexTerminalController({
    nativeTestContext: { runtime: projectService.createRuntime(), session },
    codexAppServerProviderFactory(providerOptions) {
      captures.onProviderFactory?.();
      return providerFactory
        ? providerFactory(providerOptions, { calls, subscribers, captures })
        : createProvider(calls, subscribers, captures, providerOptions);
    },
    ...(codexHelperThreadLedgerFactory ? { codexHelperThreadLedgerFactory } : {}),
    ...(codexGitCommand ? { codexGitCommand } : {}),
    ...(codexToolHomeSource === undefined ? {} : { codexToolHomeSource }),
    ...(codexSystemRoot === undefined ? {} : { codexAppServerProviderOptions: { systemRoot: codexSystemRoot } }),
    env: {
      VIBE64_AGENT_RUNTIME_DIR: projectService.agentRuntimeRoot,
      ...(codexGitCommand ? { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(temporaryRoot, "attachments") } : {}),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService
  });
  let closeController = true;
  try {
    await operation({
      calls,
      captures,
      controller,
      promptHintReads,
      projectContextRoot,
      projectRuntimeRoot,
      projectService,
      session,
      simulateControllerCrash() {
        closeController = false;
      },
      subscribers,
      temporaryRoot
    });
  } finally {
    if (closeController) {
      await controller.closeAllForSession("session-1");
    }
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function restartedCaptures(source = {}, overrides = {}) {
  return {
    ...source,
    closes: 0,
    configReads: [],
    deletes: [],
    helperThreadInventories: 0,
    helperThreadInventoryWait: null,
    ensureAvailableWait: null,
    failDeletes: 0,
    failHelperThreadInventories: 0,
    failInterrupts: 0,
    hookLists: [],
    interrupts: [],
    modelAborts: 0,
    modelSignals: [],
    onStopRuntime: null,
    providerOptions: [],
    resumes: [],
    runtimeInfo: { ...source.runtimeInfo },
    stopRuntimes: 0,
    stopRuntimeOptions: [],
    stopRuntimeProviderOptions: [],
    stopRuntimeHandler: null,
    stopRuntimeWait: null,
    threads: [],
    turns: [],
    undefinedDeletes: 0,
    ...overrides
  };
}

function createRestartedController({
  session,
  calls = [],
  captures,
  codexHelperThreadLedgerFactory,
  projectService,
  providerFactory = null,
  codexToolHomeSource = undefined,
  codexSystemRoot = undefined,
  subscribers = new Set()
} = {}) {
  const runtime = projectService.createRuntime();
  const projectRuntimeRoot = runtime.stateRoot;
  const agentRuntimeRoot = projectService.agentRuntimeRoot ||
    path.join(projectRuntimeRoot, "agent-runtimes");
  return createCodexTerminalController({
    ...(session ? { nativeTestContext: { runtime, session } } : {}),
    codexAppServerProviderFactory(providerOptions) {
      return providerFactory
        ? providerFactory(providerOptions, { calls, subscribers, captures })
        : createProvider(calls, subscribers, captures, providerOptions);
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: agentRuntimeRoot,
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    ...(codexHelperThreadLedgerFactory ? { codexHelperThreadLedgerFactory } : {}),
    ...(codexToolHomeSource === undefined ? {} : { codexToolHomeSource }),
    ...(codexSystemRoot === undefined ? {} : { codexAppServerProviderOptions: { systemRoot: codexSystemRoot } }),
    projectService
  });
}

async function withAgentMessageController(operation, {
  actions = null,
  throughTerminalService = false,
  bindConversation = false,
  codexAppServerActiveReconcileMs = 60_000
} = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-message-"));
  const codexToolHomeSource = path.join(temporaryRoot, "codex-tool-home");
  await mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true });
  await writeFile(
    path.join(codexToolHomeSource, ".codex", "auth.json"),
    JSON.stringify({
      OPENAI_API_KEY: "test-agent-message-api-key",
      auth_mode: "api_key"
    })
  );
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
  });
  await store.createSession({
    metadata: session.metadata,
    runtimeKind: "genesis",
    sessionId: session.sessionId
  });

  const captures = {
    finalText: "",
    finalItems: new Map(),
    omitSendTurnId: false,
    onSendTurn: null,
    onSteerTurn: null,
    provider: null,
    providerOptions: [],
    renderPrompts: [],
    sendTurnWait: null,
    sessionThreadIds: [],
    steers: [],
    stopRuntimes: 0,
    threadSnapshotTurns: null,
    threadStarts: [],
    turnReplies: [],
    turns: [],
    subscribers: null
  };
  const runtime = {
    async getSession(sessionId) {
      return store.readSession(sessionId);
    },
    async renderPrompt(_sessionId, { request, task } = {}) {
      captures.renderPrompts.push({ request, task });
      return {
        prompt: `GENESIS ${task}: ${String(request || "Continue.")}`
      };
    },
    projectContextRoot,
    stateRoot: projectRuntimeRoot,
    store
  };
  const projectService = {
    createRuntime() {
      return runtime;
    },
    createSessionStore() {
      return store;
    },
    async readCurrentProject() {
      return { path: projectContextRoot, projectContextRoot, slug: "test-project" };
    },
    async readEnv() {
      return { ok: true, records: [] };
    },
    async runInProjectContext(context, callback) {
      return runWithProjectRequestContext(context, callback);
    },
    async saveEnvUserValues() {
      return { ok: true };
    },
    async projectInspectionEnvironment() {
      return {
        VIBE64_RUNTIME_NAMESPACE: "test",
        VIBE64_WORKSPACE: "test"
      };
    },
    async readPromptHints() {
      return {
        ok: true,
        promptHints: true
      };
    }
  };
  const controllerOptions = {
    codexAppServerActiveReconcileMs,
    codexAppServerProviderOptions: { systemRoot: path.join(temporaryRoot, "system") },
    codexAppServerDaemonWellbeingMs: 60_000,
    logger: { warn: (event) => captures.onDiagnostic?.(event) },
    publishSessionChanged: async (sessionId, event) => captures.onSessionChanged?.(sessionId, event),
    ...(bindConversation ? { publishConversation: event => captures.onConversationChanged?.(event) } : {}),
    codexToolHomeRequired: false,
    codexToolHomeSource,
    codexAppServerProviderFactory(providerOptions) {
      captures.providerOptions.push(providerOptions);
      const subscribers = new Set();
      captures.subscribers = subscribers;
      const provider = {
        closed: 0,
        status: "idle",
        threadCwd: "",
        threadId: "11111111-1111-4111-8111-111111111111",
        turnId: "",
        close() {
          provider.closed += 1;
        },
        async ensureAvailable() { if (provider.observationFailure) throw provider.observationFailure; },
        failObservation(error) {
          provider.observationFailure = error;
          return providerOptions.onObservationLost(error);
        },
        async ensureRuntime() {
          const runtimeDir = path.join(temporaryRoot, "provider-runtime");
          return {
            endpoint: `unix://${path.join(runtimeDir, "codex.sock")}`,
            runtimeDir,
            socketPath: path.join(runtimeDir, "codex.sock"),
            transport: "unix"
          };
        },
        isAvailable() {
          return provider.closed === 0;
        },
        async listModels() {
          return { data: [{ model: "gpt-5.5", hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }]
          }], nextCursor: null };
        },
        isHelperProvider() { return false; },
        async currentRuntimeInfo() {
          return { runtimeDir: path.join(temporaryRoot, "provider-runtime") };
        },
        async listLoadedThreads() {
          return {
            data: [provider.threadId]
          };
        },
        async listHelperThreads() {
          return {
            threadIds: []
          };
        },
        async listAppServerThreadsForCwd({ cwd }) {
          return {
            cwd,
            threadIds: [...captures.sessionThreadIds]
          };
        },
        async readThread(threadId = provider.threadId) {
          if (Array.isArray(captures.threadSnapshotTurns)) {
            return {
              cwd: provider.threadCwd,
              id: threadId,
              turns: captures.threadSnapshotTurns
            };
          }
          const turn = captures.turns.find((candidate) => (
            candidate.turnId === provider.turnId
          ));
          const finalItems = [...captures.finalItems.values()]
            .filter((entry) => entry.threadId === threadId && entry.turnId === provider.turnId)
            .map((entry) => entry.item);
          const finalText = typeof captures.finalText === "function"
            ? captures.finalText(provider.turnId)
            : captures.finalText || `Completed ${provider.turnId}.`;
          if (!finalItems.length && (captures.finalText || provider.status !== "inProgress")) {
            finalItems.push({
              id: `answer-${provider.turnId}`,
              phase: "final_answer",
              text: finalText,
              type: "agentMessage"
            });
          }
          return {
            cwd: provider.threadCwd,
            id: threadId,
            turns: provider.turnId ? [{
              id: provider.turnId,
              items: [{
                clientId: turn?.settings?.clientUserMessageId || "",
                content: [{
                  text: turn?.input || "",
                  type: "text"
                }],
                id: `user-${provider.turnId}`,
                type: "userMessage"
              }, ...finalItems],
              status: provider.status
            }] : []
          };
        },
        async readThreadStatus() {
          return {
            status: provider.status,
            turnId: provider.turnId
          };
        },
        async listThreadTurns(threadId, { cursor = "0", limit = 1, sortDirection = "desc" } = {}) {
          const thread = await provider.readThread(threadId);
          const byId = new Map();
          if (!Array.isArray(captures.threadSnapshotTurns)) {
            for (const entry of captures.finalItems.values()) {
              if (entry.threadId !== threadId) continue;
              if (!byId.has(entry.turnId)) byId.set(entry.turnId, { id: entry.turnId, status: "completed", items: [] });
              byId.get(entry.turnId).items.push(entry.item);
            }
          }
          for (const turn of thread.turns || []) byId.set(turn.id, turn);
          const turns = [...byId.values()];
          if (sortDirection === "desc") turns.reverse();
          const offset = Number(cursor);
          return {
            data: turns.slice(offset, offset + limit),
            nextCursor: offset + limit < turns.length ? String(offset + limit) : null
          };
        },
        async readGoal() { return { goal: null }; },
        async resumeThread(threadId, settings = {}) {
          await providerOptions.beforeResumeThread?.(threadId);
          provider.threadId = threadId;
          provider.threadCwd = settings.cwd || provider.threadCwd;
          return {
            id: threadId
          };
        },
        async sendTurn(threadId, input, settings) {
          const turnId = `turn-${captures.turns.length + 1}`;
          provider.status = "inProgress";
          provider.turnId = turnId;
          captures.turns.push({
            input,
            settings,
            threadId,
            turnId
          });
          captures.onSendTurn?.({ provider, turnId });
          if (captures.sendTurnWait) {
            await captures.sendTurnWait;
          }
          captures.turnReplies.push(turnId);
          return {
            id: captures.omitSendTurnId ? "" : turnId,
            raw: {
              status: provider.status
            }
          };
        },
        async startThread(settings) {
          captures.threadStarts.push(settings);
          provider.threadCwd = settings.cwd || provider.threadCwd;
          if (!captures.sessionThreadIds.includes(provider.threadId)) {
            captures.sessionThreadIds.push(provider.threadId);
          }
          return {
            id: provider.threadId
          };
        },
        async steerTurn(threadId, turnId, message, options) {
          captures.steers.push({
            message,
            options,
            threadId,
            turnId
          });
          if (captures.onSteerTurn) {
            return captures.onSteerTurn({
              message,
              options,
              provider,
              threadId,
              turnId
            });
          }
          return {
            id: turnId
          };
        },
        async stopRuntime(options = {}) {
          captures.stopRuntimes += 1;
          captures.stopRuntimeOptions = options;
          captures.stopRuntimeProviderOptions = providerOptions;
          return captures.stopRuntimeResult || { stopped: true };
        },
        subscribe(callback) {
          const receive = (notification) => {
            const params = notification.params;
            if (notification.method === "item/completed" && params?.item?.phase === "final_answer") {
              captures.finalItems.set(`${params.threadId}:${params.turnId}:${params.item.id}`, params);
              if (Array.isArray(captures.threadSnapshotTurns)) {
                let turn = captures.threadSnapshotTurns.find((candidate) => candidate.id === params.turnId);
                if (!turn) {
                  turn = { id: params.turnId, items: [], status: "inProgress" };
                  captures.threadSnapshotTurns.push(turn);
                }
                const index = turn.items.findIndex((item) => item.id === params.item.id);
                if (index < 0) turn.items.push(params.item);
                else turn.items[index] = params.item;
              }
            }
            callback(notification);
          };
          subscribers.add(receive);
          return () => subscribers.delete(receive);
        }
      };
      captures.provider = provider;
      captures.onProviderCreated?.(provider);
      return provider;
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(temporaryRoot, "attachments"),
      VIBE64_SYSTEM_ROOT: path.join(temporaryRoot, "system"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService
  };
  const terminalService = throughTerminalService
    ? createTerminalService({
        actions,
        codexTerminalController: controllerOptions,
        env: controllerOptions.env,
        publishSessionChanged: { agentTerminal: controllerOptions.publishSessionChanged },
        projectService
      })
    : null;
  const controller = terminalService ? null : createCodexTerminalController(controllerOptions);

  try {
    await operation({
      captures,
      controller,
      controllerOptions,
      projectService,
      runtime,
      sessionId: session.sessionId,
      store,
      terminalService
    });
  } finally {
    if (terminalService) {
      await terminalService.close();
    } else {
      await controller.closeAllForSession(session.sessionId);
    }
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

test("the common Codex entry uses the original main journal, receipt files and cleanup owner", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const actor = { preferredName: "Ada", role: "owner", username: "ada-owner" };
    const unrelatedActor = { preferredName: "Other", role: "owner", username: "other-owner" };
    const hostProvider = controller.conversationProvider;
    const common = createConversationRuntime({ engine: "codex", authorize: async () => true,
      host: { nativeTools: true, conversation: ({ id, context, input, operation }) => operation === "dispose"
        ? prepareSessionConversationDisposal(hostProvider, id, context, input)
        : createSessionConversationBinding(hostProvider, id, {
        ...context, prepareInput: async input => {
          const prepared = await Promise.resolve(input);
          return { ...prepared, vibe64User: actor, actorContext: unrelatedActor };
        }
      }) }
    });
    captures.onConversationChanged = event => common.publishNative(event);
    captures.onProviderCreated = provider => {
      let goal = null;
      provider.readGoal = async () => ({ goal });
      provider.setGoal = async (threadId, input) => ({ goal: goal = { ...input, threadId,
        status: "active", createdAt: 10, updatedAt: 10, tokensUsed: 0, timeUsedSeconds: 0 } });
      provider.setGoalStatus = async (_threadId, status) => ({ goal: goal = { ...goal, status } });
      provider.clearGoal = async () => { goal = null; return {}; };
      provider.interruptTurn = async () => { provider.status = "interrupted"; return { interrupted: true }; };
    };
    const before = (await runtime.getSession(sessionId)).metadata;
    const readSession = runtime.getSession;
    runtime.getSession = async () => { throw new Error("Passive native status must not hydrate the full session history"); };
    try {
      const passive = await common.open({ id: sessionId, context: { runtime }, representation: "native" });
      assert.equal((await passive.read()).ok, true);
    } finally { runtime.getSession = readSession; }
    const conversation = await common.open({ id: sessionId, context: { runtime } });
    assert.equal((await conversation.read()).segmentId, null);
    assert.equal(await conversation.readGoal(), null);
    assert.deepEqual((await runtime.getSession(sessionId)).metadata, before, "opening and reading do not reconstruct runtime state");
    assert.equal(captures.provider, null, "reading an unstarted main conversation does not acquire a provider");
    const goal = await conversation.updateGoal({ action: "set", expectedSegmentId: null, expectedGoalId: null, objective: "Keep the fixture small" });
    assert.equal(goal.status, "active");
    assert.equal((await store.readConversationLog(sessionId)).length, 0, "the original first Set does not manufacture an authored message");
    await conversation.updateGoal({ action: "cancel", expectedSegmentId: (await conversation.read()).segmentId, expectedGoalId: goal.id });
    const canonicalEvents = [];
    const unsubscribe = await conversation.subscribe(event => canonicalEvents.push(event));
    const selected = (await runtime.getSession(sessionId)).metadata.assistant_selection;
    const native = await common.open({ id: sessionId, context: { runtime }, representation: "native" });
    const exactObjective = " Keep this exact pinned goal ";
    const pinnedGoal = await native.updateGoal({ action: "set", threadId: captures.provider.threadId, objective: exactObjective });
    assert.equal(pinnedGoal.ok, true);
    assert.equal(pinnedGoal.goal.objective, exactObjective);
    assert.equal(pinnedGoal.goal.createdAt, 10, "the native result keeps the original numeric expectation");
    const pinnedSession = await runtime.getSession(sessionId);
    const pinned = await common.open({ id: sessionId, representation: "native", context: {
      runtime, session: pinnedSession, assistantSelection: JSON.parse(selected)
    } });
    await store.writeMetadataValue(sessionId, "assistant_selection", JSON.stringify({
      ...JSON.parse(selected), engineId: "opencode", modelProviderId: "deepseek"
    }));
    const readPinned = await pinned.readGoal();
    assert.equal(readPinned.status, "available");
    assert.equal(readPinned.threadId, captures.provider.threadId);
    assert.deepEqual(readPinned.goal, pinnedGoal.goal);
    const expectedGoal = { threadId: readPinned.threadId, objective: exactObjective, createdAt: 10 };
    assert.equal((await pinned.updateGoal({ ...expectedGoal, action: "pause" })).goal.status, "paused");
    assert.equal((await pinned.updateGoal({ ...expectedGoal, action: "cancel" })).goal, null);
    await assert.rejects(pinned.send({ messageId: "stale-selected-native-send", message: "Do not send this" }),
      /selected assistant changed/);
    assert.equal(captures.turns.length, 0, "pinned controls cannot loosen ordinary Send selection");
    await store.writeMetadataValue(sessionId, "assistant_selection", selected);

    let durableBeforeClear = false;
    const writeMetadata = store.writeMetadataValue;
    store.writeMetadataValue = async (id, name, value) => {
      if (name === "assistant_changeover") {
        const state = JSON.parse(value);
        if (state.lastEngine === "codex" && !state.engines.codex.pending) {
          durableBeforeClear = await store.conversationMessageIdExists(id, "bound-main-message");
          assert.equal(durableBeforeClear, true, "the original receipt file precedes clearing the original pending journal");
        }
      }
      return writeMetadata(id, name, value);
    };
    const receipt = await conversation.send({ messageId: "bound-main-message", text: "Keep the original owner" });
    assert.equal(receipt.status, "accepted");
    const duplicate = await native.send({ messageId: "bound-main-message", message: "Keep the original owner" });
    assert.deepEqual(duplicate, { value: { ok: true, delivered: true, messageId: "bound-main-message", duplicate: true } });
    assert.equal(Object.hasOwn(duplicate, "session"), false, "the original duplicate result has no later session snapshot");
    assert.ok(canonicalEvents.some(event => event.type === "accepted"));
    assert.ok(canonicalEvents.every(event => !Object.hasOwn(event, "session") && !Object.hasOwn(event, "nativeResult")));
    unsubscribe();

    assert.equal(durableBeforeClear, true);
    assert.equal(captures.threadStarts.length, 1);
    const history = await store.readConversationLog(sessionId);
    assert.equal(history[0].user.text, "Keep the original owner");
    assert.equal(history[0].user.messageId, "bound-main-message");
    assert.equal(history[0].metadata.actorId, actor.username,
      "the final awaited application actor wins over a mismatched neutral input field");
    assert.equal(history[0].metadata.actorDisplayName, actor.preferredName);
    assert.equal(history[0].metadata.runtime, undefined, "original main history is not rewritten with runtime-v3 metadata");
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).outerTurnId, "bound-main-message");
    assert.equal((await conversation.read()).segmentId, `codex:${captures.provider.threadId}`);
    assert.equal((await conversation.cancel()).stopped, true);
    const identity = (await conversation.read()).segmentId;
    const replacement = { operationId: "bound-main-replace", expectedSegmentId: identity, reason: "renewal", briefing: "Keep the original owner." };
    await conversation.replace(replacement);
    assert.equal((await conversation.read()).segmentId, null);
    assert.equal((await conversation.replace(replacement)).duplicate, true, "replacement retry retains the saved original operation after identity release");
    await assert.rejects(conversation.updateGoal({ action: "set", expectedSegmentId: null, expectedGoalId: null, objective: "Continue" }),
      { code: "conversation_replacement_briefing_pending" });
    await conversation.dispose();
    assert.ok(captures.stopRuntimes > 0, "dispose uses the original shared runtime cleanup owner");
    assert.equal((await runtime.getSession(sessionId)).metadata.runtime, undefined);
    await common.close();
  }, { bindConversation: true });
});

test("native main handles preserve a failed delivery with a known native turn identity", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const hostProvider = controller.conversationProvider;
    const common = createConversationRuntime({ engine: "codex", authorize: async () => true,
      host: { nativeTools: true, conversation: ({ id, context, input, operation }) => operation === "dispose"
        ? prepareSessionConversationDisposal(hostProvider, id, context, input)
        : createSessionConversationBinding(hostProvider, id, {
        ...context, prepareInput: async input => input
      }) }
    });
    captures.onConversationChanged = event => common.publishNative(event);
    captures.onProviderCreated = provider => {
      provider.interruptTurn = async () => { provider.status = "interrupted"; return { interrupted: true }; };
    };
    captures.onSendTurn = ({ provider }) => { provider.status = "failed"; };
    await store.writeMetadataValue(sessionId, "assistant_changeover", JSON.stringify({
      lastEngine: "opencode", engines: { opencode: { seen: {} } }
    }));
    const native = await common.open({ id: sessionId, context: { runtime }, representation: "native" });
    const canonical = await common.open({ id: sessionId, context: { runtime } });
    const events = [];
    await canonical.subscribe(event => events.push(event));
    let sending = 0;
    const messageId = "native-failed-result";
    const result = await native.send({ messageId, message: "Native request body", displayMessage: "Visible authorship",
      async onPromptSending() {
        sending += 1;
        const state = JSON.parse(await store.readMetadataValue(sessionId, "assistant_changeover"));
        assert.equal(state.engines.codex.pending.attempted, false, "original callback precedes the journal mark");
      }
    });
    assert.equal(result.value.ok, false);
    assert.equal(result.value.error, "Codex turn failed.");
    assert.equal(result.nativeIdentity.turnId, "turn-1");
    assert.equal(Object.hasOwn(result, "session"), true, "the original failure snapshot is returned only to this native invocation");
    assert.equal(sending, 1);
    assert.ok(captures.renderPrompts[0].request.endsWith("Native request body"));
    assert.equal(await store.conversationMessageIdExists(sessionId, messageId), false);
    const pending = JSON.parse(await store.readMetadataValue(sessionId, "assistant_changeover")).engines.codex.pending;
    assert.equal(pending.messageId, messageId);
    assert.equal(pending.attempted, true);
    assert.equal(pending.displayMessage, "Visible authorship");
    assert.equal(events.some(event => event.type === "accepted"), false);
    assert.ok(events.every(event => !Object.hasOwn(event, "session") && !Object.hasOwn(event, "nativeResult")));
    assert.equal((await runtime.getSession(sessionId)).metadata.runtime, undefined);
    await common.close();
  }, { bindConversation: true });
});

test("Codex Stop reports unconfirmed command exit even when its native turn already became idle", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    assert.equal((await controller.sendMessage(sessionId, { message: "Work", messageId: "command-stop-failure" })).ok, true);
    captures.provider.interruptTurn = async () => {
      captures.provider.status = "idle";
      throw Object.assign(new Error("Command exit unconfirmed"), { code: "vibe64_codex_command_stop_unconfirmed" });
    };
    const stopped = await controller.interruptTurn(sessionId, { threadId: captures.provider.threadId });
    assert.equal(stopped.ok, false, JSON.stringify(stopped));
    assert.equal(stopped.code, "vibe64_codex_command_stop_unconfirmed");
    assert.notEqual(stopped.operationOutcome, "already_idle");
  });
});

test("Codex compaction phase follows native items and clears on completion and interruption", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ captures, controller, controllerOptions, sessionId, store }) => {
    const published = [];
    captures.onSessionChanged = (_id, event) => published.push(event);
    assert.equal((await controller.sendMessage(sessionId, { message: "Work", messageId: "compaction-work" })).ok, true);
    const { threadId, turnId } = captures.provider;
    captures.provider.interruptTurn = async () => {
      captures.provider.status = "interrupted";
      return { interrupted: true };
    };
    const notify = (method, id = turnId) => emitCodexNotification(captures.subscribers, {
      method, params: { threadId, turnId: id, item: { id: "compact-item", type: "contextCompaction" } }
    });
    const readPhase = async () => (await controller.terminalState(sessionId)).codexAgentTurn.phase;
    notify("item/started");
    await waitForSessionValue(readPhase, (phase) => phase === "compacting", "compaction start");
    await waitForSessionValue(async () => published,
      (events) => events.some((event) => event.payload?.agentSession?.turn?.phase === "compacting"), "compaction publication");
    const reader = createCodexTerminalController(controllerOptions);
    assert.equal((await reader.terminalState(sessionId)).codexAgentTurn.phase, "compacting", "Fresh reads retain the current phase");
    captures.provider.connectionGeneration = "after-compaction-reconnect";
    captures.subscribers.clear();
    assert.equal((await controller.ensureThread(sessionId)).ok, true);
    await waitForSessionValue(readPhase, (phase) => phase === "", "reconnection clears an unconfirmed old phase");
    notify("item/started");
    await waitForSessionValue(readPhase, (phase) => phase === "compacting", "compaction on the new observer");
    notify("item/completed");
    await waitForSessionValue(readPhase, (phase) => phase === "", "compaction completion");
    assert.equal((await controller.terminalState(sessionId)).codexAgentTurn.active, true);
    notify("item/started");
    await waitForSessionValue(readPhase, (phase) => phase === "compacting", "second compaction");
    const stopped = await controller.interruptTurn(sessionId, { threadId });
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    assert.equal(await readPhase(), "");
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).providerPhase, "");
    assert.equal((await controller.sendMessage(sessionId, { message: "Continue", messageId: "after-compaction-stop" })).ok, true);
    assert.equal(await readPhase(), "");
    const successorId = captures.provider.turnId;
    notify("item/started", turnId);
    notify("item/started", successorId);
    await waitForSessionValue(async () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run.providerTurnId === successorId && run.providerPhase === "compacting", "successor compaction");
    notify("item/completed", turnId);
    notify("item/completed", successorId);
    await waitForSessionValue(readPhase, (phase) => phase === "", "successor completion");
    assert.equal((await controller.terminalState(sessionId)).codexAgentTurn.turnId, successorId);
  });
});

test("Codex reasoning activity follows native item boundaries, clears on tool use and ignores old turns", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "reasoning-phase" });
    const { threadId, turnId } = captures.provider;
    const notify = (method, type, id = turnId) => emitCodexNotification(captures.subscribers, {
      method, params: { threadId, turnId: id, item: { id: `${type}-item`, type } }
    });
    const phase = async () => (await store.readAgentRun(sessionId, "codex_app_server")).providerPhase;
    notify("item/started", "reasoning");
    await waitForSessionValue(phase, (value) => value === "reasoning", "active reasoning");
    notify("item/started", "commandExecution");
    await waitForSessionValue(phase, (value) => value === "", "tool execution clears reasoning");
    notify("item/started", "reasoning");
    await waitForSessionValue(phase, (value) => value === "reasoning", "next reasoning item");
    notify("item/completed", "reasoning");
    await waitForSessionValue(phase, (value) => value === "", "reasoning completion");
    notify("item/started", "reasoning", "old-turn");
    await controller.closeAllForSession(sessionId);
    assert.notEqual(await phase(), "reasoning");
  });
});

test("Codex initialization pins its routing home even when a previous engine has a conversation", async () => {
  await withAgentMessageController(async ({ captures, controllerOptions, sessionId, store, terminalService }) => {
    const session = await store.readSession(sessionId);
    const selection = { ...JSON.parse(session.metadata.assistant_selection), modelProviderId: "deepseek", modelId: "deepseek-flash" };
    const connections = createCodexProviderConnectionStore({ systemRoot: controllerOptions.codexAppServerProviderOptions.systemRoot,
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: "verified", status: "completed", output: [], type: "message", content: [] }) }) });
    await connections.change("deepseek", { apiKey: "test-key" });
    for (const [name, value] of Object.entries({
      assistant_selection: JSON.stringify(selection), agent_identity_provider: "opencode",
      agent_identity_conversation_id: "previous-opencode-thread", opencode_conversation_id: "previous-opencode-thread"
    })) await store.writeMetadataValue(sessionId, name, value);

    const prepared = await terminalService.ensureAgentSession(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const ready = await store.readSession(sessionId);
    assert.equal(ready.metadata.codex_routing_home_provider, "openai");
    assert.equal(ready.metadata.opencode_conversation_id, "previous-opencode-thread");
    assert.equal(captures.providerOptions.at(-1).toolHomeSource, controllerOptions.codexToolHomeSource);
    assert.equal(captures.turns.length, 0, "Preparing a new assistant must not send a message.");
    await terminalService.prepareRoutingSelection(sessionId, selection, { runtime: { store }, session: ready });
    assert.equal((await store.readSession(sessionId)).metadata.agent_identity_conversation_id,
      ready.metadata.agent_identity_conversation_id, "Routing must retain the prepared native conversation.");
  }, { throughTerminalService: true });
});

test("assistant verification shares a stalled status read while attachments remain usable", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ captures, runtime, sessionId, terminalService }) => {
    assert.equal((await terminalService.ensureAgentSession(sessionId)).ok, true);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let reads = 0;
    captures.provider.readThreadStatus = async () => {
      reads += 1;
      entered.resolve();
      await release.promise;
      return { status: "idle" };
    };
    captures.provider.ensureAvailable = async () => { throw new Error("Verification repeated provider preparation"); };
    captures.provider.resumeThread = async () => { throw new Error("Verification resumed an already subscribed thread"); };
    const first = terminalService.ensureAgentSession(sessionId);
    await entered.promise;
    const second = terminalService.ensureAgentSession(sessionId);
    try {
      const uploaded = await terminalService.uploadAgentAttachment(sessionId, {
        fileName: "while-checking.txt",
        stream: Readable.from(["Uploaded while the provider is stalled."])
      });
      assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
      assert.equal(await readFile(uploaded.path, "utf8"), "Uploaded while the provider is stalled.");
      const exclusive = await runtime.store.runSessionExclusive(sessionId, "agent-write-mode", async () => true);
      assert.equal(exclusive.acquired, true, "Verification held the source-write lock");
      assert.equal(reads, 1, "Concurrent verification did not share the provider request");
    } finally {
      release.resolve();
    }
    const results = await Promise.all([first, second]);
    assert.ok(results.every((result) => result.ok === true), JSON.stringify(results));
    assert.equal(reads, 1);
  }, { throughTerminalService: true });
});

test("a late assistant verification response cannot reattach a closed session", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    assert.equal((await controller.ensureThread(sessionId)).ok, true);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let resumes = 0;
    captures.provider.readThreadStatus = async () => {
      entered.resolve();
      await release.promise;
      return { status: "idle" };
    };
    captures.provider.resumeThread = async () => { resumes += 1; };
    const checking = controller.ensureThread(sessionId);
    await entered.promise;
    try {
      await controller.closeAllForSession(sessionId);
    } finally {
      release.resolve();
    }
    const result = await checking;
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_agent_session_changed");
    assert.equal(resumes, 0);
    assert.equal(captures.subscribers.size, 0);
    assert.equal(captures.providerOptions.length, 1);
  });
});

test("verification of an unloaded or missing Codex thread requires protected preparation", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ captures, runtime, sessionId, terminalService }) => {
    assert.equal((await terminalService.ensureAgentSession(sessionId)).ok, true);
    captures.provider.readThreadStatus = async () => ({ status: { type: "notLoaded" } });
    captures.provider.resumeThread = async () => { throw new Error("Verification resumed a thread without write admission"); };
    const attempts = [];
    runtime.store.runSessionExclusive = async (_id, lock, _operation, options) => {
      attempts.push({ lock, ...options });
      return { acquired: false };
    };
    const unloaded = await terminalService.ensureAgentSession(sessionId);
    assert.equal(unloaded.code, "vibe64_agent_write_mode_busy");
    captures.provider.readThreadStatus = async (threadId) => {
      throw Object.assign(new Error(`thread not loaded: ${threadId}`), { code: -32600, method: "thread/read" });
    };
    const missing = await terminalService.ensureAgentSession(sessionId);
    assert.equal(missing.code, "vibe64_agent_write_mode_busy");
    assert.deepEqual(attempts, Array(2).fill({ lock: "agent-write-mode", operation: "prepare-agent-session", waitMs: 10_000 }));
    captures.provider.readThreadStatus = async () => {
      throw Object.assign(new Error("invalid thread/read configuration"), { code: -32600, method: "thread/read" });
    };
    const invalid = await terminalService.ensureAgentSession(sessionId);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error, "invalid thread/read configuration");
    assert.equal(attempts.length, 2, "An unrelated provider error triggered preparation");
  }, { throughTerminalService: true });
});

test("assistant preparation still takes the session write lock", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ runtime, sessionId, terminalService }) => {
    const attempts = [];
    runtime.store.runSessionExclusive = async (_id, lock, _operation, options) => {
      attempts.push({ lock, ...options });
      return { acquired: false };
    };
    const result = await terminalService.ensureAgentSession(sessionId);
    assert.equal(result.code, "vibe64_agent_write_mode_busy");
    assert.deepEqual(attempts, [{ lock: "agent-write-mode", operation: "prepare-agent-session", waitMs: 10_000 }]);
  }, { throughTerminalService: true });
});

test("Codex connection loss during preparation releases the session for recovery", { timeout: 10_000 }, async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    assert.equal((await controller.ensureThread(sessionId)).ok, true);
    const provider = captures.provider;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    provider.isAvailable = () => false;
    provider.ensureAvailable = async () => {
      entered.resolve();
      await release.promise;
      throw provider.observationFailure;
    };
    provider.stopThreadForObservationLoss = async () => {
      throw new Error("Process has stopped");
    };
    const preparing = controller.ensureThread(sessionId);
    await entered.promise;
    // The socket callback runs outside the preparation's session mutation.
    const stopping = provider.failObservation(new Error("Connection closed during startup"));
    release.resolve();
    const result = await preparing;
    assert.equal(result.ok, false);
    await stopping;
    assert.equal((await store.readBackgroundTask(sessionId, "codex_app_server")).status, "failed");
    const exclusive = await store.runSessionExclusive(sessionId, "agent-write-mode", async () => true);
    assert.equal(exclusive.acquired, true);
    const recovered = await controller.ensureThread(sessionId);
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal((await store.readBackgroundTask(sessionId, "codex_app_server")).status, "ready");
  });
});

for (const processStopped of [false, true]) {
  test(`idle Codex reconnects without interrupting completed work (process stopped: ${processStopped})`, async () => {
    await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
      const sent = await controller.sendMessage(sessionId, {
        message: "Work",
        messageId: "completed-before-disconnect"
      });
      assert.equal(sent.ok, true);
      const provider = captures.provider;
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: "completed-before-disconnect-answer",
        phase: "final_answer",
        text: "Finished before disconnect.",
        threadId: provider.threadId,
        turnId: provider.turnId
      }));
      provider.status = "completed";
      emitCodexNotification(captures.subscribers, turnCompleted({
        threadId: provider.threadId,
        turnId: provider.turnId
      }));
      const completed = await waitForSessionValue(
        () => store.readAgentRun(sessionId, "codex_app_server"),
        (run) => run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
        "completed work before losing the idle connection"
      );
      provider.stopThreadForObservationLoss = async () => {
        if (processStopped) throw new Error("Assistant process is gone");
      };
      await provider.failObservation(new Error("Idle connection closed"));
      assert.deepEqual(await store.readAgentRun(sessionId, "codex_app_server"), completed);
      const recovered = await controller.ensureThread(sessionId);
      assert.equal(recovered.ok, true, JSON.stringify(recovered));
      assert.equal(recovered.observationStopped, undefined);
      assert.equal(captures.providerOptions.length, processStopped ? 2 : 1);
      assert.equal(captures.turns.length, 1, "Reconnection must not replay the completed user message");
      assert.equal(captures.threadStarts.length, 1, "Reconnection must preserve the existing conversation");
      const run = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(run.state, VIBE64_AGENT_RUN_STATE.COMPLETED);
      const conversation = await store.readConversationLog(sessionId);
      assert.ok(conversation.some((row) => row.assistant?.text === "Finished before disconnect."));
    });
  });
}

const RENEWAL_SOURCE = Object.freeze({
  authority: "github",
  commit: "a".repeat(40),
  ref: "refs/heads/main",
  repository: "https://github.com/example/project.git"
});

function renewalHandoverText() {
  return [
    "# Session handover",
    "## Objective",
    "Finish the exact saved project work.",
    "## Decisions",
    "Keep the existing architecture.",
    "## Saved source",
    "- Authority: github",
    "- Repository: https://github.com/example/project.git",
    "- Ref: refs/heads/main",
    `- Commit: ${RENEWAL_SOURCE.commit}`,
    "## Touched areas",
    "The server.",
    "## Verification",
    "Focused tests passed.",
    "## Unresolved work",
    "One task remains.",
    "## Next action",
    "Implement the remaining task."
  ].join("\n");
}

function completeAgentMessageHarnessTurn(captures, provider, turnId, text) {
  queueMicrotask(() => {
    provider.status = "completed";
    completeDetachedTurn(captures.subscribers, {
      text,
      threadId: provider.threadId,
      turnId
    });
  });
}

test("session renewal handover runs on the exact visible main thread with its durable assistant selection", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await store.mutateSession(sessionId, async () => {
      await Promise.all([
        store.writeMetadataValue(
          sessionId,
          VIBE64_ASSISTANT_SELECTION_METADATA,
          serializeVibe64AssistantSelection({
            agentId: "codex",
            catalogRevision: `sha256:${"c".repeat(64)}`,
            engineId: "codex",
            modelId: "gpt-5.6-sol",
            modelProviderId: "openai",
            variantId: "high"
          })
        ),
        store.writeMetadataValue(sessionId, "agent_settings_model", "gpt-5.5"),
        store.writeMetadataValue(sessionId, "agent_settings_provider", "codex"),
        store.writeMetadataValue(sessionId, "agent_settings_thinking", "low")
      ]);
    });
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    captures.provider.status = "completed";
    captures.provider.turnId = "historical-main-turn";
    const handover = renewalHandoverText();
    captures.finalText = handover;
    captures.onSendTurn = ({ provider, turnId }) => {
      completeAgentMessageHarnessTurn(captures, provider, turnId, handover);
    };

    const result = await controller.generateSessionRenewalHandover(sessionId, {
      agentSettings: {
        model: "gpt-5.6-luna",
        thinking: "low"
      },
      operationKey: "renewal:generate-one",
      source: RENEWAL_SOURCE
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.handover, handover);
    assert.equal(result.threadId, prepared.codexThreadId);
    assert.equal(result.turnId, "turn-1");
    assert.equal(result.clientMessageId, captures.turns[0].settings.clientUserMessageId);
    assert.equal(captures.turns[0].settings.model, "gpt-5.6-sol");
    assert.equal(captures.turns[0].settings.effort, "high");
    assert.equal(Object.hasOwn(captures.turns[0].settings, "outputSchema"), false);
    const saved = await store.readSession(sessionId);
    assert.equal(saved.metadata.agent_renewal_handover_turn_id, "turn-1");
    assert.equal(saved.metadata.agent_renewal_handover_hash, result.handoverHash);
    const renewalRun = saved.agentRuns.find(({ id }) => id === "codex_app_server");
    assert.equal(renewalRun.active, false);
    assert.equal(renewalRun.state, "completed");
    assert.equal(renewalRun.providerThreadId, prepared.codexThreadId);
    assert.equal(renewalRun.providerTurnId, "turn-1");

    const retried = await controller.generateSessionRenewalHandover(sessionId, {
      operationKey: "renewal:generate-one",
      source: RENEWAL_SOURCE
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.reconciled, true);
    assert.equal(retried.turnId, "turn-1");
    assert.equal(captures.turns.length, 1);
  });
});

test("renewed-session seeding starts a fresh hidden turn and requires its exact structured acknowledgement", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const assistantSelection = {
      agentId: "codex",
      catalogRevision: `sha256:${"c".repeat(64)}`,
      engineId: "codex",
      modelId: "gpt-5.5",
      modelProviderId: "openai",
      variantId: "low"
    };
    await store.writeMetadataValue(
      sessionId,
      VIBE64_ASSISTANT_SELECTION_METADATA,
      serializeVibe64AssistantSelection(assistantSelection)
    );
    // These fields are deliberately stale: the durable assistant selection
    // owns the fresh thread's model and thinking choice.
    await store.writeMetadataValue(sessionId, "agent_settings_model", "gpt-5.6-sol");
    await store.writeMetadataValue(sessionId, "agent_settings_provider", "codex");
    await store.writeMetadataValue(sessionId, "agent_settings_thinking", "xhigh");
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    const acknowledgement = {
      handoverHash,
      message: "Ready to continue from the approved handover.",
      schemaVersion: "vibe64.session-renewal-acknowledgement.v1",
      sourceCommit: RENEWAL_SOURCE.commit,
      status: "ready"
    };
    captures.finalText = JSON.stringify(acknowledgement);
    captures.onSendTurn = ({ provider, turnId }) => {
      completeAgentMessageHarnessTurn(
        captures,
        provider,
        turnId,
        JSON.stringify(acknowledgement)
      );
    };

    const session = await store.readSession(sessionId);
    assert.equal(session.metadata.agent_settings_model, "gpt-5.6-sol");
    assert.equal(session.metadata.agent_settings_provider, "codex");
    assert.equal(session.metadata.agent_settings_thinking, "xhigh");
    const result = await controller.seedSessionRenewalHandover(sessionId, {
      agentSettings: {
        model: "gpt-5.6-sol",
        thinking: "low"
      },
      handover,
      handoverHash,
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:seed-one",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.freshThread, true);
    assert.equal(result.subscriptionDeferred, true);
    assert.equal(result.acknowledgement.handoverHash, handoverHash);
    assert.equal(result.turnId, "turn-1");
    assert.equal(captures.threadStarts.length, 1);
    assert.equal(captures.threadStarts[0].sandbox, "read-only");
    assert.equal(captures.turns[0].settings.model, assistantSelection.modelId);
    assert.equal(captures.turns[0].settings.effort, assistantSelection.variantId);
    assert.deepEqual(captures.turns[0].settings.sandboxPolicy, {
      networkAccess: false,
      type: "readOnly"
    });
    assert.equal(captures.turns[0].settings.outputSchema.additionalProperties, false);
    assert.deepEqual(captures.turns[0].settings.outputSchema.properties.handoverHash.enum, [handoverHash]);
    const saved = await store.readSessionForRenewal(sessionId);
    assert.equal(saved.metadata.agent_renewal_seed_turn_id, "turn-1");
    assert.equal(saved.metadata.agent_briefing_delivered, "yes");
    assert.equal(saved.metadata.agent_settings_model, assistantSelection.modelId);
    assert.equal(saved.metadata.agent_settings_thinking, assistantSelection.variantId);

    const retried = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash,
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:seed-one",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: saved
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.freshThread, false);
    assert.equal(retried.reconciled, true);
    assert.equal(retried.turnId, "turn-1");
    assert.equal(captures.threadStarts.length, 1);
    assert.equal(captures.turns.length, 1);

    const ordinary = await controller.sendMessage(sessionId, {
      agentSettings: {
        model: saved.metadata.agent_settings_model,
        providerId: saved.metadata.agent_settings_provider,
        thinking: saved.metadata.agent_settings_thinking
      },
      message: "Continue with the renewed session settings.",
      messageId: "renewal-settings-ordinary-turn"
    });
    assert.equal(ordinary.ok, true, JSON.stringify(ordinary));
    assert.equal(captures.turns.length, 2);
    assert.equal(captures.turns[1].settings.model, assistantSelection.modelId);
    assert.equal(captures.turns[1].settings.effort, assistantSelection.variantId);
    assert.deepEqual(captures.turns[1].settings.sandboxPolicy, {
      networkAccess: "enabled",
      type: "externalSandbox"
    });
    const continued = await store.readSession(sessionId);
    assert.equal(continued.metadata.agent_settings_model, assistantSelection.modelId);
    assert.equal(continued.metadata.agent_settings_provider, "codex");
    assert.equal(continued.metadata.agent_settings_thinking, assistantSelection.variantId);
  });
});

test("renewal provider controls read only their exact hidden successor and retain observation barriers", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const renewalId = "renewal-hidden-provider";
    await store.writeMetadataValue(sessionId, "renewal_id", renewalId);
    await store.writeMetadataValue(sessionId, "renewed_from", "predecessor");
    const statusPath = store.paths(sessionId).statusPath;
    await writeFile(statusPath, `${VIBE64_SESSION_STATUS.RENEWAL_PENDING}\n`);
    runtime.getSessionForRenewal = (id) => store.readSessionForRenewal(id);
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    const acknowledgement = JSON.stringify({ handoverHash, message: "Ready.",
      schemaVersion: "vibe64.session-renewal-acknowledgement.v1", sourceCommit: RENEWAL_SOURCE.commit, status: "ready" });
    captures.finalText = acknowledgement;
    captures.onSendTurn = ({ provider, turnId }) => completeAgentMessageHarnessTurn(captures, provider, turnId, acknowledgement);
    const input = { handover, handoverHash, operationKey: "renewal:hidden-controls", source: RENEWAL_SOURCE };
    try {
      await assert.rejects(runtime.getSession(sessionId), { code: "vibe64_session_renewal_private" });
      const seeded = await controller.seedSessionRenewalHandover(sessionId, input, {
        runtime, session: await store.readSessionForRenewal(sessionId)
      });
      assert.equal(seeded.ok, true, JSON.stringify(seeded));
      const options = captures.providerOptions.at(-1);
      assert.equal(options.renewalId, renewalId);
      assert.equal(await options.prepareAuth("openai"), "native");
      await options.beforeResumeThread(seeded.threadId);
      const params = { cwd: (await store.readSessionForRenewal(sessionId)).metadata.source_path };
      await options.prepareThreadResumeParams(seeded.threadId, params, { runtime: { reused: false }, processChanged: true });
      const retried = await controller.seedSessionRenewalHandover(sessionId, input, {
        runtime, session: await store.readSessionForRenewal(sessionId)
      });
      assert.equal(retried.ok, true, JSON.stringify(retried));
      assert.equal(retried.reconciled, true);
      assert.equal(captures.turns.length, 1);
      const runPath = path.join(store.paths(sessionId).agentRunsRoot, "codex_app_server.json");
      await writeFile(runPath, JSON.stringify({ id: "codex_app_server", providerThreadId: seeded.threadId,
        providerStatus: "observation_lost", error: "A verified stop must be retained." }));
      await assert.rejects(options.beforeResumeThread(seeded.threadId), { code: "vibe64_codex_observation_lost" });
      await store.writeMetadataValueForRenewal(sessionId, "renewal_id", "different-renewal");
      await assert.rejects(options.prepareAuth("openai"), { code: "vibe64_session_renewal_private" });
      await assert.rejects(options.beforeResumeThread(seeded.threadId), { code: "vibe64_session_renewal_private" });
      await assert.rejects(runtime.getSession(sessionId), { code: "vibe64_session_renewal_private" });
    } finally {
      await writeFile(statusPath, `${VIBE64_SESSION_STATUS.ACTIVE}\n`);
      await rm(path.join(store.paths(sessionId).agentRunsRoot, "codex_app_server.json"), { force: true });
    }
  });
});

test("renewed-session seeding starts fresh when a manual handover has no predecessor thread id", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    const acknowledgement = {
      handoverHash,
      message: "Ready to continue from the approved manual handover.",
      schemaVersion: "vibe64.session-renewal-acknowledgement.v1",
      sourceCommit: RENEWAL_SOURCE.commit,
      status: "ready"
    };
    captures.finalText = JSON.stringify(acknowledgement);
    captures.onSendTurn = ({ provider, turnId }) => {
      completeAgentMessageHarnessTurn(
        captures,
        provider,
        turnId,
        JSON.stringify(acknowledgement)
      );
    };

    const result = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash,
      operationKey: "renewal:manual-without-old-thread",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.freshThread, true);
    assert.equal(result.acknowledgement.handoverHash, handoverHash);
    assert.equal(captures.threadStarts.length, 1);
    assert.equal(captures.turns.length, 1);
  });
});

test("renewed-session seeding distinguishes an accepted handover from a failed model response", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    captures.onSendTurn = ({ provider }) => {
      provider.status = "failed";
    };

    const result = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash,
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:failed-model",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_renewal_turn_failed");
    assert.equal(result.details.handoverPromptAccepted, true);
    assert.equal(result.details.turnId, "turn-1");
    assert.equal(captures.turns.length, 1);
  });
});

test("renewed-session seeding does not claim delivery without the exact Codex turn id", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const handover = renewalHandoverText();
    captures.omitSendTurnId = true;

    const result = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash: sessionRenewalHandoverHash(handover),
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:missing-turn-id",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_renewal_turn_identity_missing");
    assert.equal(result.details.handoverPromptAccepted, undefined);
    assert.equal(result.details.turnId, "");
    assert.equal(captures.turns.length, 1);
  });
});

test("renewed-session seeding rejects a fresh thread that already contains history", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const handover = renewalHandoverText();
    captures.threadSnapshotTurns = [{
      id: "unrelated-turn",
      items: [{
        content: [{ text: "Unrelated prior request", type: "text" }],
        id: "unrelated-user-message",
        type: "userMessage"
      }],
      status: "completed"
    }];

    const result = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash: sessionRenewalHandoverHash(handover),
      operationKey: "renewal:history-bearing-successor",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_renewal_fresh_thread_required");
    assert.match(result.error, /unrelated conversation/u);
    assert.equal(captures.turns.length, 0);
  });
});

test("session renewal requires manual fallback when the exact old thread has no readable history", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    const result = await controller.generateSessionRenewalHandover(sessionId, {
      operationKey: "renewal:unreadable",
      source: RENEWAL_SOURCE
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_renewal_thread_unreadable");
    assert.match(result.error, /manually/u);
    assert.equal(captures.turns.length, 0);
  });
});

test("session renewal provider primitives reject every helper execution profile before provider work", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const source = RENEWAL_SOURCE;
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    const generation = await controller.generateSessionRenewalHandover(sessionId, {
      executionProfile: null,
      operationKey: "renewal:helper-generate",
      source
    });
    const seed = await controller.seedSessionRenewalHandover(sessionId, {
      executionProfile: {
        profileId: "helper"
      },
      handover,
      handoverHash,
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:helper-seed",
      source
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(generation.code, "vibe64_session_renewal_interactive_provider_required");
    assert.equal(seed.code, "vibe64_session_renewal_interactive_provider_required");
    assert.equal(captures.threadStarts.length, 0);
    assert.equal(captures.turns.length, 0);
  });
});

test("Codex admission inspection uses exact native user identity without sending", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const threadId = prepared.codexThreadId;
    const messageId = "integration-continuation-admission";
    captures.threadSnapshotTurns = [{ id: "accepted-turn", items: [{
      type: "userMessage", clientId: messageId, id: "native-user"
    }] }];
    assert.deepEqual(await controller.inspectMessageAdmission(sessionId, { messageId, threadId }), {
      ok: true, admission: "accepted", messageId, threadId, turnId: "accepted-turn"
    });
    assert.equal((await controller.inspectMessageAdmission(sessionId, {
      messageId: "another-message", threadId
    })).admission, "unknown");
    captures.threadSnapshotTurns[0].items[0].type = "agentMessage";
    assert.equal((await controller.inspectMessageAdmission(sessionId, { messageId, threadId })).admission, "unknown");
    const mismatch = await controller.inspectMessageAdmission(sessionId, { messageId, threadId: "another-thread" });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, "vibe64_codex_thread_mismatch");
    captures.provider.readThread = async () => { throw new Error("Provider history unavailable"); };
    assert.equal((await controller.inspectMessageAdmission(sessionId, { messageId, threadId })).admission, "unknown");
    assert.equal(captures.turns.length, 0);
    assert.equal(captures.steers.length, 0);
  });
});

test("Codex integration continuation recovers native acceptance with a fresh service after local persistence failure", async () => {
  await withAgentMessageController(async ({ captures, controllerOptions, projectService, terminalService, sessionId, store }) => {
    const systemRoot = controllerOptions.env.VIBE64_SYSTEM_ROOT;
    await writeCodexAuthMarker(systemRoot, { connected: true, loginId: randomUUID() });
    const junior = { ...JSON.parse((await store.readSession(sessionId)).metadata.assistant_selection), selectionSource: "explicit" };
    await createAssistantRoutingStore({ systemRoot }).write({ codex: { senior: junior, junior } }, 0);
    const routingAccess = await terminalService.inspectAssistantAccess(sessionId);
    assert.equal(routingAccess.purposes.junior.available, true, JSON.stringify(routingAccess));
    const prepared = await terminalService.ensureAgentSession(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const mainProvider = captures.provider;
    await store.writeConversationUserMessage(sessionId, { text: "Configure mail." });
    const turn = await store.writeConversationAssistantMessage(sessionId, {
      text: 'Configure mail.\n\n```vibe64-integration\n{"integrationId":"mail"}\n```'
    });
    const input = { turnId: turn.turnId, requestId: turn.integrationSetup.requestId };
    const completion = await store.completeIntegrationSetupRequest(sessionId, {
      ...input, configurationHash: "a".repeat(64), verifiedAt: "2026-09-11T08:00:00.000Z"
    });
    const writeUser = store.writeConversationUserMessage;
    store.writeConversationUserMessage = async () => {
      mainProvider.readThread = async () => { throw new Error("History temporarily unavailable."); };
      throw new Error("Local persistence failed.");
    };
    let restarted;
    try {
      const uncertain = await terminalService.resumeIntegrationContinuation(sessionId, input, {
        readIntegrationConfiguration: async () => ({ ok: true, baseHash: "a".repeat(64),
          configuration: { integrations: { mail: {} } } })
      });
      assert.equal(uncertain.code, "vibe64_integration_continuation_unconfirmed", JSON.stringify(uncertain));
      assert.equal(uncertain.integrationSetup.continuation.status, "sending");
      assert.equal(captures.turns.length, 1);
      const acceptedTurn = captures.turns[0];
      // A new provider object reads the native history preserved independently
      // of the controller whose local persistence failed.
      captures.threadSnapshotTurns = [{ id: acceptedTurn.turnId, items: [{
        type: "userMessage", id: "native-user", clientId: acceptedTurn.settings.clientUserMessageId
      }], status: "completed" }];
      await terminalService.close();
      store.writeConversationUserMessage = writeUser;
      restarted = createTerminalService({ codexTerminalController: controllerOptions,
        env: controllerOptions.env, projectService });
      const result = await restarted.resumeIntegrationContinuation(sessionId, input);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.integrationSetup.continuation.status, "accepted");
      assert.equal(result.integrationSetup.continuationMessageId, completion.continuationMessageId);
      assert.equal(captures.turns.length, 1);
      assert.equal(captures.turns[0].settings.clientUserMessageId, completion.continuationMessageId);
      assert.equal((await restarted.resumeIntegrationContinuation(sessionId, input)).ok, true);
      assert.equal(captures.turns.length, 1);
      assert.equal(captures.steers.length, 0);
    } finally {
      store.writeConversationUserMessage = writeUser;
      await restarted?.close();
    }
  }, { throughTerminalService: true });
});

test("provider balance reads observe Codex claim and completion without holding up inference", async () => {
  await withAgentMessageController(async ({ captures, controller, controllerOptions, sessionId, store }) => {
    const session = await store.readSession(sessionId);
    const selection = JSON.parse(session.metadata.assistant_selection);
    await store.writeMetadataValue(sessionId, "assistant_selection", JSON.stringify({ ...selection, modelProviderId: "deepseek", modelId: "deepseek-flash" }));
    const connections = createCodexProviderConnectionStore({ systemRoot: controllerOptions.codexAppServerProviderOptions.systemRoot,
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: "verified", status: "completed", output: [], type: "message", content: [] }) }) });
    await connections.change("deepseek", { apiKey: "test-key" });
    const pending = [];
    const usage = createProviderUsage({ resolveConnection: async () => ({ apiKey: "test-key" }), fetchImpl: () => {
      const request = Promise.withResolvers(); pending.push(request); return request.promise;
    } });
    captures.onSessionChanged = (id, event) => usage.observe("test-project", id, event);
    captures.onSendTurn = () => assert.equal(pending.length, 1, "balance query starts before inference dispatch");
    const result = await controller.sendMessage(sessionId, { message: "Work", messageId: "balance-turn" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(pending.length, 1, "accepted turn reuses the claim's identity");
    completeAgentMessageHarnessTurn(captures, captures.provider, captures.provider.turnId, "Done.");
    await waitForSessionValue(async () => pending.length, value => value === 2, "completion balance read");
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).state, VIBE64_AGENT_RUN_STATE.COMPLETED);
    for (const request of pending) request.resolve({ ok: false });
  });
});

test("duplicate agent messages with the same message id call the provider once", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    let releaseSendTurn;
    captures.sendTurnWait = new Promise((resolve) => {
      releaseSendTurn = resolve;
    });
    let observeSendTurn;
    const sendTurnObserved = new Promise((resolve) => {
      observeSendTurn = resolve;
    });
    captures.onSendTurn = observeSendTurn;

    const input = {
      message: "Start atomic delivery.",
      messageId: "message-atomic-duplicate"
    };
    const firstDelivery = controller.sendMessage(sessionId, input);
    await sendTurnObserved;
    const concurrentDuplicate = controller.sendMessage(sessionId, input);
    releaseSendTurn();
    captures.sendTurnWait = null;

    const [first, duplicate] = await Promise.all([
      firstDelivery,
      concurrentDuplicate
    ]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(duplicate, first);

    const durableDuplicate = await controller.sendMessage(sessionId, input);
    assert.equal(durableDuplicate.ok, true, JSON.stringify(durableDuplicate));
    assert.equal(durableDuplicate.duplicate, true);
    assert.equal(durableDuplicate.operationOutcome, "message_already_delivered");
    assert.equal(captures.turns.length, 1);
    assert.equal(captures.steers.length, 0);
    assert.equal(captures.turns[0].settings.clientUserMessageId, input.messageId);
  });
});

test("an idle message preserves a missing provider binding without silently replacing context", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    const provider = captures.provider;
    const staleThreadId = prepared.codexThreadId;
    const replacementThreadId = "22222222-2222-4222-8222-222222222222";
    const originalReadThread = provider.readThread.bind(provider);
    const missingThreadError = (method) => {
      const error = new Error(`thread not loaded: ${staleThreadId}`);
      error.code = -32600;
      error.method = method;
      return error;
    };
    provider.readThreadStatus = async (threadId = provider.threadId) => {
      if (threadId === staleThreadId) {
        throw missingThreadError("thread/read");
      }
      return {
        status: provider.status,
        turnId: provider.turnId
      };
    };
    provider.readThread = async (threadId = provider.threadId) => {
      if (threadId === staleThreadId) {
        throw missingThreadError("thread/read");
      }
      return originalReadThread(threadId);
    };
    provider.resumeThread = async (threadId, settings = {}) => {
      if (threadId === staleThreadId) {
        throw missingThreadError("thread/resume");
      }
      provider.threadId = threadId;
      provider.threadCwd = settings.cwd || provider.threadCwd;
      return { id: threadId };
    };
    provider.startThread = async (settings = {}) => {
      captures.threadStarts.push(settings);
      provider.threadCwd = settings.cwd || provider.threadCwd;
      provider.threadId = replacementThreadId;
      captures.sessionThreadIds.push(replacementThreadId);
      return { id: replacementThreadId };
    };
    captures.onSendTurn = ({ provider: activeProvider, turnId }) => {
      const turn = captures.turns.find((candidate) => candidate.turnId === turnId);
      if (turn?.input.includes("VIBE64_CONTEXT_RECOVERY:")) {
        completeAgentMessageHarnessTurn(
          captures,
          activeProvider,
          turnId,
          "Recovered the persisted Vibe64 conversation."
        );
      }
    };

    const result = await controller.sendMessage(sessionId, {
      message: "Continue after the missing provider thread.",
      messageId: "message-after-missing-thread"
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.match(result.error, /thread not loaded/);
    assert.equal(captures.turns.length, 0);
    assert.equal(captures.threadStarts.length, 1);
    const unchanged = await store.readSession(sessionId);
    assert.equal(unchanged.metadata.agent_identity_conversation_id, staleThreadId);
  });
});

test("an idle message does not replace a thread for an unrelated invalid request", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    captures.provider.readThreadStatus = async () => {
      const error = new Error("invalid thread/read configuration");
      error.code = -32600;
      error.method = "thread/read";
      throw error;
    };

    const result = await controller.sendMessage(sessionId, {
      message: "Do not duplicate this work.",
      messageId: "message-invalid-read"
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid thread\/read configuration/u);
    assert.equal(captures.turns.length, 0);
    assert.equal(captures.threadStarts.length, 1);
  });
});

test("Codex changeover resumes its original thread and sends one combined normal prompt", async () => {
  await withAgentMessageController(async ({ captures, controllerOptions, terminalService, runtime, sessionId, store }) => {
    const originalSelection = (await store.readSession(sessionId)).metadata.assistant_selection;
    const first = await terminalService.sendAgentMessage(sessionId, { message: "Original Codex task", messageId: "changeover-first" });
    assert.equal(first.delivered, true, JSON.stringify(first));
    const originalThread = captures.turns[0].threadId;
    completeAgentMessageHarnessTurn(captures, captures.provider, "turn-1", "Original Codex answer");
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.active === false, "the first changeover turn to complete");
    const context = { runtime, session: await store.readSession(sessionId) };
    const authFile = path.join(controllerOptions.codexToolHomeSource, ".codex", "auth.json");
    const auth = await readFile(authFile);
    await rm(authFile);
    const stoppedThreads = [];
    captures.provider.stopThreadForObservationLoss = async (id) => { stoppedThreads.push(id); };
    const closed = await terminalService.prepareAssistantChangeover(sessionId, context);
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.deepEqual(stoppedThreads, [originalThread]);
    await writeFile(authFile, auth);
    const otherSelection = { agentId: "build", engineId: "opencode", modelId: "deepseek-chat",
      modelProviderId: "deepseek", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` };
    await store.writeMetadataValue(sessionId, "assistant_selection", serializeVibe64AssistantSelection(otherSelection));
    await store.writeMetadataValue(sessionId, "agent_identity_provider", "opencode");
    await store.writeMetadataValue(sessionId, "agent_identity_conversation_id", "ses_opencode_original");
    await store.writeMetadataValue(sessionId, "agent_transport_id", "opencode_server");
    await sendWithAssistantChangeover(sessionId, { message: "The other engine changed the plan", messageId: "changeover-other" },
      { runtime, session: await store.readSession(sessionId) }, {
        async sendMessage(_id, input) {
          await input.onPromptSending({ threadId: "ses_opencode_original" });
          await store.writeConversationUserMessage(sessionId, {
            messageId: input.messageId, text: input.displayMessage, turnMetadata: { engineId: "opencode" }
          });
          await store.writeConversationAssistantMessage(sessionId, { text: "The new plan uses blue", messageId: "changeover-other-answer" });
          return { ok: true, delivered: true };
        }
      });
    await store.writeMetadataValue(sessionId, "assistant_selection", originalSelection);
    const blockedGoal = await terminalService.updateAgentGoal(sessionId, { action: "resume" });
    assert.equal(blockedGoal.code, "vibe64_changeover_message_required");
    assert.equal(captures.turns.length, 1);
    const returning = await terminalService.sendAgentMessage(sessionId, { message: "Continue with that plan", messageId: "changeover-return" });
    assert.equal(returning.delivered, true, JSON.stringify(returning));
    assert.equal(captures.threadStarts.length, 1, "returning must not create a replacement Codex thread");
    assert.equal(captures.turns.length, 2, "there must be no separate handover turn");
    assert.equal(captures.turns[1].threadId, originalThread);
    assert.equal(captures.turns[1].input.length, 1);
    assert.match(captures.turns[1].input[0], /The new plan uses blue/);
    assert.ok(captures.turns[1].input[0].endsWith("User's message:\nContinue with that plan"));
    assert.equal((await store.readConversationLog(sessionId)).at(-1).user.text, "Continue with that plan");
  }, { throughTerminalService: true });
});

test("Codex changeover restores authored text from a durable claim on a late native receipt", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.ensureThread(sessionId);
    const threadId = captures.provider.threadId;
    const messageId = "changeover-late-receipt";
    await store.writeMetadataValue(sessionId, "assistant_changeover", JSON.stringify({
      lastEngine: "opencode", engines: { codex: { seen: {}, pending: {
        messageId, threadId, attempted: true, displayMessage: "Only the authored request",
        turnMetadata: { actorId: "owner", actorDisplayName: "Owner" }, displayAttachments: []
      } } }
    }));
    const notification = { method: "item/completed", params: { threadId, turnId: "late-turn", item: {
      type: "userMessage", id: "late-native-item", clientId: messageId,
      content: [{ type: "text", text: "[Vibe64 conversation changeover]\nPrivate catchup text\nOnly the authored request" }]
    } } };
    emitCodexNotification(captures.subscribers, notification);
    const turns = await waitForSessionValue(() => store.readConversationLog(sessionId),
      (value) => value.some((turn) => turn.user?.messageId === messageId), "late changeover receipt");
    assert.equal(turns.at(-1).user.text, "Only the authored request");
    assert.equal(turns.at(-1).metadata.actorId, "owner");
    emitCodexNotification(captures.subscribers, notification);
    await controller.closeAllForSession(sessionId);
    assert.equal((await store.readConversationLog(sessionId)).filter((turn) => turn.user).length, 1);
    assert.equal(captures.turns.length, 0, "receipt recovery must not send a turn");
  });
});

test("Codex renders only opening and explicit Deslop prompts through Genesis", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const waitForIdle = (turnId) => waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.active === false && run?.providerTurnId === turnId,
      `${turnId} to complete`
    );

    await controller.sendMessage(sessionId, {
      message: "Start this session.",
      messageId: "message-prompt-opening"
    });
    completeAgentMessageHarnessTurn(captures, captures.provider, "turn-1", "Completed turn-1.");
    await waitForIdle("turn-1");
    await controller.sendMessage(sessionId, {
      genesisTask: "deslop",
      message: `Deslop commit ${"a".repeat(40)}.`,
      messageId: "message-prompt-deslop"
    });
    completeAgentMessageHarnessTurn(captures, captures.provider, "turn-2", "Completed turn-2.");
    await waitForIdle("turn-2");
    await controller.sendMessage(sessionId, {
      message: "Explain one cleanup choice.",
      messageId: "message-prompt-follow-up"
    });
    completeAgentMessageHarnessTurn(captures, captures.provider, "turn-3", "Completed turn-3.");
    await waitForIdle("turn-3");

    assert.deepEqual(captures.renderPrompts.map(({ task }) => task), ["start", "deslop"]);
    assert.match(captures.turns[0].input[0], /GENESIS start: Start this session\./u);
    assert.match(captures.turns[1].input[0], /GENESIS deslop: Deslop commit/u);
    assert.doesNotMatch(captures.turns[2].input[0], /GENESIS/u);
    assert.equal(captures.turns[2].input[0], "Explain one cleanup choice.");
    assert.equal(captures.turns.every(({ input }) => input.length === 1), true);
  });
});

test("Codex leaves the first visible message raw after a delivered renewal handover", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await store.writeMetadataValue(
      sessionId,
      "renewal_handover_delivered_at",
      "2026-09-04T01:00:00.000Z"
    );

    await controller.sendMessage(sessionId, {
      message: "Continue after I repair the provider login.",
      messageId: "renewal-visible-follow-up"
    });
    completeAgentMessageHarnessTurn(captures, captures.provider, "turn-1", "Continued.");
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.active === false && run?.providerTurnId === "turn-1",
      "the renewed follow-up to complete"
    );

    assert.deepEqual(captures.renderPrompts, []);
    assert.equal(captures.turns[0].input[0], "Continue after I repair the provider login.");
  });
});

test("provider receipt persists the authored message before its answer while the acknowledgement is pending", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const accepted = Promise.withResolvers();
    captures.sendTurnWait = accepted.promise;
    const messageId = "message-deslop-receipt";
    captures.onSendTurn = ({ provider, turnId }) => {
      for (const subscriber of captures.subscribers) {
        subscriber({ method: "item/completed", params: {
          threadId: provider.threadId,
          turnId,
          item: { type: "userMessage", id: "user-receipt", clientId: messageId, content: [{ type: "text", text: "Expanded private Genesis prompt" }] }
        } });
        subscriber({ method: "item/completed", params: {
          threadId: provider.threadId,
          turnId,
          item: { type: "agentMessage", id: "reply-before-http", phase: "commentary", text: "I am reviewing the commit." }
        } });
      }
    };
    const sending = controller.sendMessage(sessionId, {
      displayMessage: "Deslop saved commit 04f8283622d6.",
      genesisTask: "deslop",
      message: "Deslop commit 04f8283622d6.",
      messageId
    });
    try {
      const turns = await waitForSessionValue(
        () => store.readConversationLog(sessionId),
        (value) => value.some((turn) => turn.commentary?.some((item) => item.text === "I am reviewing the commit.")),
        "the early assistant commentary"
      );
      assert.deepEqual(captures.turnReplies, []);
      assert.equal(turns[0].user.text, "Deslop saved commit 04f8283622d6.");
      assert.equal(turns[0].user.messageId, messageId);
      assert.equal(JSON.stringify(turns).includes("Expanded private Genesis prompt"), false);
      const steered = await controller.sendMessage(sessionId, {
        message: "Keep the cleanup inside this commit.",
        messageId: "message-during-pending-send"
      });
      assert.equal(steered.ok, true, JSON.stringify(steered));
      assert.equal(captures.steers.length, 1);
      assert.deepEqual(captures.turnReplies, []);
    } finally {
      accepted.resolve();
    }
    const result = await sending;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.conversationTurn.user.messageId, messageId);
    assert.equal((await store.readConversationLog(sessionId)).filter((turn) => turn.user?.messageId === messageId).length, 1);
  });
});

test("terminal service accepts steering after a receipt while the first provider acknowledgement is pending", async () => {
  await withAgentMessageController(async ({ captures, sessionId, store, terminalService }) => {
    const accepted = Promise.withResolvers();
    captures.sendTurnWait = accepted.promise;
    const messageId = "service-pending-send";
    captures.onSendTurn = ({ provider, turnId }) => {
      for (const subscriber of captures.subscribers) {
        subscriber({
          method: "item/completed",
          params: {
            threadId: provider.threadId,
            turnId,
            item: {
              type: "userMessage",
              id: "service-user-receipt",
              clientId: messageId,
              content: [{ type: "text", text: "First project request." }]
            }
          }
        });
      }
    };
    const sending = terminalService.sendAgentMessage(sessionId, {
      message: "First project request.",
      messageId
    });
    let steering;
    let timeout;
    try {
      await waitForSessionValue(
        () => store.readConversationLog(sessionId),
        (turns) => turns.some((turn) => turn.user?.messageId === messageId),
        "the terminal service's durable provider receipt"
      );
      assert.deepEqual(captures.turnReplies, []);
      steering = terminalService.sendAgentMessage(sessionId, {
        message: "Keep the change focused.",
        messageId: "service-steering-after-receipt"
      });
      const result = await Promise.race([
        steering,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(null), FIXTURE_WAIT_TIMEOUT_MS);
        })
      ]);
      assert.notEqual(result, null, "Steering waited for the first accepted Send to release server admission.");
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(captures.steers.length, 1);
      assert.deepEqual(captures.turnReplies, []);
      const first = await sending;
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(
        (await store.readConversationLog(sessionId)).filter((turn) => turn.user?.messageId === messageId).length,
        1
      );
    } finally {
      clearTimeout(timeout);
      accepted.resolve();
      await Promise.allSettled([sending, steering]);
    }
  }, { throughTerminalService: true });
});

test("terminal service holds admission until its exact receipt is persisted", async () => {
  await withAgentMessageController(async ({ captures, sessionId, store, terminalService }) => {
    const acknowledgement = Promise.withResolvers();
    const persistReceipt = Promise.withResolvers();
    const messageId = "receipt-must-be-durable";
    const writeMessage = store.writeConversationUserMessage;
    let receiptWriteEntered = false;
    store.writeConversationUserMessage = async (id, input) => {
      if (input.messageId === messageId) {
        receiptWriteEntered = true;
        await persistReceipt.promise;
      }
      return writeMessage(id, input);
    };
    captures.sendTurnWait = acknowledgement.promise;
    captures.onSendTurn = ({ provider, turnId }) => {
      for (const subscriber of captures.subscribers) {
        subscriber({
          method: "item/completed",
          params: {
            threadId: provider.threadId,
            turnId,
            item: {
              type: "userMessage",
              id: "other-receipt",
              clientId: "another-message",
              content: [{ type: "text", text: "An unrelated message." }]
            }
          }
        });
      }
    };
    const sending = terminalService.sendAgentMessage(sessionId, {
      message: "Persist this before accepting the next message.",
      messageId
    });
    let timeout;
    try {
      await waitForSessionValue(
        () => store.readConversationLog(sessionId),
        (turns) => turns.some((turn) => turn.user?.text === "An unrelated message."),
        "the unrelated receipt to finish processing"
      );
      assert.equal((await store.runSessionExclusive(sessionId, "agent-write-mode", () => null)).acquired, false);
      assert.equal(receiptWriteEntered, false);
      for (const subscriber of captures.subscribers) {
        subscriber({
          method: "item/completed",
          params: {
            threadId: captures.provider.threadId,
            turnId: captures.provider.turnId,
            item: {
              type: "userMessage",
              id: "matching-receipt",
              clientId: messageId,
              content: [{ type: "text", text: "The expanded private opening prompt." }]
            }
          }
        });
      }
      await waitForSessionValue(() => receiptWriteEntered, Boolean, "the paused authored-message write");
      assert.equal((await store.runSessionExclusive(sessionId, "agent-write-mode", () => null)).acquired, false);
      assert.equal(await store.conversationMessageIdExists(sessionId, messageId), false);
      persistReceipt.resolve();
      const result = await Promise.race([
        sending,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(null), FIXTURE_WAIT_TIMEOUT_MS);
        })
      ]);
      assert.notEqual(result, null, "The persisted receipt did not finish delivery.");
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(await store.conversationMessageIdExists(sessionId, messageId), true);
      assert.equal((await store.runSessionExclusive(sessionId, "agent-write-mode", () => null)).acquired, true);
      assert.deepEqual(captures.turnReplies, []);
    } finally {
      clearTimeout(timeout);
      persistReceipt.resolve();
      acknowledgement.resolve();
      await sending;
      store.writeConversationUserMessage = writeMessage;
    }
  }, { throughTerminalService: true });
});

for (const deliveryMode of ["opening", "steering"]) {
  for (const lateReply of ["success", "failure"]) {
    test(`terminal service settles duplicate ${deliveryMode} messages from a receipt and ignores a late ${lateReply}`, async () => {
      await withAgentMessageController(async ({ captures, sessionId, store, terminalService }) => {
        if (deliveryMode === "steering") {
          const opened = await terminalService.sendAgentMessage(sessionId, {
            message: "Start the task.",
            messageId: "receipt-test-opening"
          });
          assert.equal(opened.ok, true, JSON.stringify(opened));
        }
        const acknowledgement = Promise.withResolvers();
        const messageId = `receipt-${deliveryMode}-${lateReply}`;
        captures.onSendTurn = ({ provider, turnId }) => {
          for (const subscriber of captures.subscribers) {
            subscriber({
              method: "item/completed",
              params: {
                threadId: provider.threadId,
                turnId,
                item: {
                  type: "userMessage",
                  id: `user-${messageId}`,
                  clientId: messageId,
                  content: [{ type: "text", text: "The accepted request." }]
                }
              }
            });
          }
        };
        if (deliveryMode === "opening") {
          captures.sendTurnWait = acknowledgement.promise;
        } else {
          captures.onSteerTurn = async (context) => {
            captures.onSendTurn(context);
            await acknowledgement.promise;
            return { id: context.turnId };
          };
        }
        const input = { message: "The accepted request.", messageId };
        const sending = terminalService.sendAgentMessage(sessionId, input);
        const duplicate = terminalService.sendAgentMessage(sessionId, input);
        let timeout;
        try {
          const results = await Promise.race([
            Promise.all([sending, duplicate]),
            new Promise((resolve) => {
              timeout = setTimeout(() => resolve(null), FIXTURE_WAIT_TIMEOUT_MS);
            })
          ]);
          assert.notEqual(results, null, "The exact receipt did not settle both requests.");
          assert.equal(results.every((result) => result.ok), true, JSON.stringify(results));
          assert.equal(captures.turns.length, 1);
          assert.equal(captures.steers.length, deliveryMode === "steering" ? 1 : 0);
          assert.equal(
            (await store.readConversationLog(sessionId)).filter((turn) => turn.user?.messageId === messageId).length,
            1
          );

          completeAgentMessageHarnessTurn(captures, captures.provider, "turn-1", "First task completed.");
          await waitForSessionValue(
            () => store.readAgentRun(sessionId, "codex_app_server"),
            (run) => run?.active === false && run?.providerTurnId === "turn-1",
            "the accepted turn to finish before its old acknowledgement"
          );
          captures.onSendTurn = null;
          captures.onSteerTurn = null;
          captures.sendTurnWait = null;
          const next = await terminalService.sendAgentMessage(sessionId, {
            message: "Start the next independent task.",
            messageId: "receipt-test-next-turn"
          });
          assert.equal(next.ok, true, JSON.stringify(next));
          const currentRun = await store.readAgentRun(sessionId, "codex_app_server");
          assert.equal(currentRun.active, true);
          assert.equal(currentRun.providerTurnId, "turn-2");

          if (lateReply === "failure") {
            acknowledgement.reject(new Error("The old provider acknowledgement was lost."));
          } else {
            acknowledgement.resolve();
          }
          await flushPromises();
          assert.deepEqual(await store.readAgentRun(sessionId, "codex_app_server"), currentRun);
          assert.equal(captures.turns.length, 2);
          assert.equal(captures.renderPrompts.length, 1, "The accepted opening briefing was delivered again.");
        } finally {
          clearTimeout(timeout);
          acknowledgement.resolve();
          await Promise.allSettled([sending, duplicate]);
        }
      }, { throughTerminalService: true });
    });
  }
}

test("agent messages release an orphaned STARTING claim before starting the next turn", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const started = await controller.sendMessage(sessionId, {
      message: "Start before the provider identity arrives.",
      messageId: "message-starting-original"
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    captures.provider.status = "completed";
    captures.provider.turnId = "";
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "test-starting-without-provider-turn",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      },
      patch: {
        outerTurnId: "message-starting-original",
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "starting",
        providerThreadId: "",
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.STARTING,
        updatedAt: new Date(Date.now() - 15_001).toISOString()
      }
    });

    const result = await controller.sendMessage(sessionId, {
      message: "Continue after the orphaned claim.",
      messageId: "message-after-orphaned-start"
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.deliveryMode, "new_turn");
    assert.equal(result.turnId, "turn-2");
    assert.equal(captures.turns.length, 2);
    assert.equal(captures.steers.length, 0);
  });
});

test("startup reconciliation releases a message when the provider only has its completed predecessor", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    const threadId = captures.provider.threadId;
    const predecessorTurnId = "turn-before-restart";
    const messageId = "message-interrupted-before-provider-acceptance";
    captures.provider.status = "completed";
    captures.provider.turnId = predecessorTurnId;
    captures.threadSnapshotTurns = [{
      id: predecessorTurnId,
      items: [{
        clientId: "message-before-restart",
        id: "user-before-restart",
        type: "userMessage"
      }, {
        id: "answer-before-restart",
        phase: "final_answer",
        text: "The predecessor completed.",
        type: "agentMessage"
      }],
      status: "completed"
    }];
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "codex-app-server-result-processed",
        providerThreadId: threadId,
        providerTurnId: predecessorTurnId
      },
      patch: {
        inputSource: "chat",
        outerTurnId: "message-before-restart",
        pendingUserMessageClientIds: [],
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "completed",
        providerThreadId: threadId,
        providerTurnId: predecessorTurnId,
        state: VIBE64_AGENT_RUN_STATE.COMPLETED
      }
    });
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "codex-app-server-user-message-owned",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      },
      patch: {
        error: "",
        inputSource: "chat",
        outerTurnId: messageId,
        pendingUserMessageClientIds: [messageId],
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "starting",
        providerThreadId: threadId,
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      }
    });

    const reconciliation = await controller.reconcileThreads([{ sessionId }]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    const recoveredRun = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(recoveredRun?.state, VIBE64_AGENT_RUN_STATE.FAILED);
    assert.equal(recoveredRun?.providerStatus, "delivery_failed");
    assert.match(recoveredRun?.error || "", /message is safe; retry it/u);
    assert.deepEqual(recoveredRun?.pendingUserMessageClientIds, [messageId]);

    const retry = await controller.sendMessage(sessionId, {
      message: "Retry the message after restart recovery.",
      messageId
    });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.deliveryMode, "new_turn");
    assert.equal(captures.turns.length, 1);
    assert.equal(captures.turns[0].settings.clientUserMessageId, messageId);
  });
});

test("startup reconciliation resumes only the provider turn that owns the pending message", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    const threadId = captures.provider.threadId;
    const messageId = "message-accepted-before-restart";
    const providerTurnId = "turn-accepted-before-restart";
    captures.provider.status = "inProgress";
    captures.provider.turnId = providerTurnId;
    captures.threadSnapshotTurns = [{
      id: "turn-before-accepted-message",
      items: [{
        clientId: "message-before-accepted-message",
        id: "user-before-accepted-message",
        type: "userMessage"
      }],
      status: "completed"
    }, {
      id: providerTurnId,
      items: [{
        clientId: messageId,
        id: "user-accepted-before-restart",
        type: "userMessage"
      }],
      status: "inProgress"
    }];
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "codex-app-server-user-message-owned",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      },
      patch: {
        error: "",
        inputSource: "chat",
        outerTurnId: messageId,
        pendingUserMessageClientIds: [messageId],
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "starting",
        providerThreadId: threadId,
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      }
    });

    const reconciliation = await controller.reconcileThreads([{ sessionId }]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    const recoveredRun = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(recoveredRun?.state, VIBE64_AGENT_RUN_STATE.ACTIVE);
    assert.equal(recoveredRun?.providerStatus, "inProgress");
    assert.equal(recoveredRun?.providerThreadId, threadId);
    assert.equal(recoveredRun?.providerTurnId, providerTurnId);
    assert.deepEqual(recoveredRun?.pendingUserMessageClientIds, []);
    assert.equal(captures.turns.length, 0);
  });
});

test("thread readiness settles a completed provider turn that owns an interrupted delivery", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    const threadId = captures.provider.threadId;
    const messageId = "message-completed-before-restart";
    const providerTurnId = "turn-completed-before-restart";
    captures.provider.status = "completed";
    captures.provider.turnId = providerTurnId;
    captures.threadSnapshotTurns = [{
      id: providerTurnId,
      items: [{
        clientId: messageId,
        id: "user-completed-before-restart",
        type: "userMessage"
      }, {
        id: "answer-completed-before-restart",
        phase: "final_answer",
        text: "The interrupted delivery completed exactly once.",
        type: "agentMessage"
      }],
      status: "completed"
    }];
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        clientId: messageId,
        kind: "codex-app-server-user-message-owned",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      },
      patch: {
        error: "",
        inputSource: "chat",
        outerTurnId: messageId,
        pendingUserMessageClientIds: [messageId],
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "starting",
        providerThreadId: threadId,
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      }
    });

    const ready = await controller.ensureThread(sessionId);
    assert.equal(ready.ok, true, JSON.stringify(ready));
    assert.equal(ready.codexAgentTurn.active, false);
    assert.equal(ready.codexAgentTurn.status, "completed");
    assert.equal(ready.codexAgentTurn.turnId, providerTurnId);
    const run = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(run?.state, VIBE64_AGENT_RUN_STATE.COMPLETED);
    assert.deepEqual(run?.pendingUserMessageClientIds, []);
    const conversation = await store.readConversationLog(sessionId);
    assert.equal(
      conversation.at(-1)?.assistant?.text,
      "The interrupted delivery completed exactly once."
    );
  });
});

test("agent messages reject while a FINALIZING turn retains its provider turn id", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const started = await controller.sendMessage(sessionId, {
      message: "Start before finalization.",
      messageId: "message-finalizing-original"
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    captures.provider.status = "finalizing";
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "test-finalizing-with-provider-turn",
        state: VIBE64_AGENT_RUN_STATE.FINALIZING
      },
      patch: {
        outerTurnId: "message-finalizing-original",
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "completed",
        providerThreadId: captures.provider.threadId,
        providerTurnId: captures.provider.turnId,
        state: VIBE64_AGENT_RUN_STATE.FINALIZING
      }
    });

    const result = await controller.sendMessage(sessionId, {
      message: "Do not race final response persistence.",
      messageId: "message-finalizing-rejected"
    });
    assert.equal(result.ok, false);
    assert.equal(result.operationOutcome, "active_turn_not_ready");
    assert.equal(result.retryable, true);
    assert.equal(captures.turns.length, 1);
    assert.equal(captures.steers.length, 0);
  });
});

for (const throughTerminalService of [false, true]) {
  test(`completion during steer starts one ordinary turn with the same message id${throughTerminalService ? " through the common Main manager" : ""}`, async () => {
    await withAgentMessageController(async ({ captures, controller: originalController, sessionId, store, terminalService }) => {
      const controller = terminalService
        ? { async sendMessage(...args) {
            const result = await terminalService.sendAgentMessage(...args);
            return { ...result, turnId: result.turn?.id };
          } }
        : originalController;
      const started = await controller.sendMessage(sessionId, {
        message: "Start the original turn.",
        messageId: "message-steer-original"
      });
      assert.equal(started.ok, true, JSON.stringify(started));

      captures.onSteerTurn = ({ provider }) => {
        provider.status = "completed";
        const error = new Error("The original turn completed before steering.");
        error.code = -32602;
        error.method = "turn/steer";
        throw error;
      };
      const messageId = "message-steer-completed-race";
      const result = await controller.sendMessage(sessionId, {
        message: "Continue as an ordinary turn.",
        messageId
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.deliveryMode, "new_turn");
      assert.equal(result.turnId, "turn-2");
      assert.equal(captures.steers.length, 1);
      assert.equal(captures.turns.length, 2);
      assert.equal(captures.turns[1].settings.clientUserMessageId, messageId);
      const session = await store.readSession(sessionId);
      const agentRun = session.agentRuns.find(({ id }) => id === "codex_app_server");
      assert.equal(agentRun?.outerTurnId, messageId);
      assert.equal(agentRun?.providerTurnId, "turn-2");
      const conversationLog = await store.readConversationLog(sessionId);
      assert.equal(conversationLog.filter((turn) => (
        turn.user?.text === "Continue as an ordinary turn."
      )).length, 1);
    }, { throughTerminalService });
  });

  test(`a delayed start notification from a completed turn cannot replace the next chat turn${throughTerminalService ? " through the common Main manager" : ""}`, async () => {
    await withAgentMessageController(async ({ captures, controller: originalController, sessionId, store, terminalService }) => {
      const controller = terminalService
        ? { async sendMessage(...args) {
            const result = await terminalService.sendAgentMessage(...args);
            return { ...result, turnId: result.turn?.id };
          } }
        : originalController;
      captures.finalText = (turnId) => turnId === "turn-1"
        ? "First response."
        : "Second response.";
      const first = await controller.sendMessage(sessionId, {
        message: "Complete the first turn.",
        messageId: "message-before-delayed-start"
      });
      assert.equal(first.ok, true, JSON.stringify(first));

      const provider = captures.provider;
      const threadId = provider.threadId;
      const firstTurnId = provider.turnId;
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: "first-final",
        phase: "final_answer",
        text: "First response.",
        threadId,
        turnId: firstTurnId
      }));
      provider.status = "completed";
      emitCodexNotification(captures.subscribers, turnCompleted({
        threadId,
        turnId: firstTurnId
      }));
      await waitForSessionValue(
        () => store.readConversationLog(sessionId),
        (conversation) => conversation.some((turn) => turn.assistant?.text === "First response."),
        "the first response to persist"
      );

      const second = await controller.sendMessage(sessionId, {
        message: "Complete the next turn.",
        messageId: "message-after-delayed-start"
      });
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(second.turnId, "turn-2");

      const secondTurnId = provider.turnId;
      emitCodexNotification(captures.subscribers, turnStarted({
        threadId,
        turnId: firstTurnId
      }));
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: "second-final",
        phase: "final_answer",
        text: "Second response.",
        threadId,
        turnId: secondTurnId
      }));
      provider.status = "completed";
      emitCodexNotification(captures.subscribers, turnCompleted({
        threadId,
        turnId: secondTurnId
      }));

      const conversation = await waitForSessionValue(
        () => store.readConversationLog(sessionId),
        (value) => value.some((turn) => turn.assistant?.text === "Second response."),
        "the second response to survive the delayed start notification"
      );
      assert.deepEqual(
        conversation.map((turn) => turn.assistant?.text).filter(Boolean),
        ["First response.", "Second response."]
      );
      const run = await waitForSessionValue(
        () => store.readAgentRun(sessionId, "codex_app_server"),
        (value) => value?.providerTurnId === secondTurnId &&
          value?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
        "the second turn to finish without adopting the completed turn"
      );
      assert.equal(run?.providerTurnId, secondTurnId);
      assert.equal(run?.state, VIBE64_AGENT_RUN_STATE.COMPLETED);
      assert.equal(run?.events.some((event) => (
        event.kind === "codex-app-server-turn-continued" &&
        event.providerTurnId === firstTurnId
      )), false);
    }, { throughTerminalService });
  });
}

test("an idle thread notification completes its currently owned turn without a provider turn id", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    captures.finalText = "Completed from the idle thread status.";
    const started = await controller.sendMessage(sessionId, {
      message: "Complete from the authoritative thread status.",
      messageId: "message-thread-idle-completion"
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    const turnId = provider.turnId;
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "thread-idle-final",
      phase: "final_answer",
      text: "Completed from the idle thread status.",
      threadId,
      turnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, threadStatusChanged({ threadId }));

    const conversation = await waitForSessionValue(
      () => store.readConversationLog(sessionId),
      (value) => value.some((turn) => (
        turn.assistant?.text === "Completed from the idle thread status."
      )),
      "the thread-status completion to persist its final answer"
    );
    assert.equal(conversation.at(-1)?.assistant?.text, "Completed from the idle thread status.");
    const run = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (value) => value?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the idle thread status to release the owned turn"
    );
    assert.equal(run?.providerTurnId, turnId);
    assert.equal(run?.state, VIBE64_AGENT_RUN_STATE.COMPLETED);
  });
});

test("main thread restoration installs its listener before native resume can emit goal output", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    assert.equal((await controller.sendMessage(sessionId, {
      message: "Start the goal observer fixture.",
      messageId: "message-observer-owner"
    })).ok, true);
    const provider = captures.provider;
    const threadId = provider.threadId;
    provider.connectionGeneration = "replacement-connection";
    captures.subscribers.clear();
    provider.resumeThread = async () => {
      assert.ok(captures.subscribers.size > 0, "native resume requires an attached listener");
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: "commentary-during-resume",
        phase: "commentary",
        text: "Progress emitted before the resume response.",
        threadId,
        turnId: provider.turnId
      }));
      return { id: threadId };
    };
    const ready = await controller.ensureThread(sessionId);
    assert.equal(ready.ok, true, JSON.stringify(ready));
    await waitForSessionValue(
      () => store.readConversationLog(sessionId),
      (turns) => turns.some((turn) => turn.commentary?.some((item) => (
        item.text === "Progress emitted before the resume response."
      ))),
      "output emitted during native resume to be saved"
    );
  });
});

test("main thread restoration refuses native resume when its observer cannot attach", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    assert.equal((await controller.sendMessage(sessionId, {
      message: "Start the observer admission fixture.",
      messageId: "message-observer-admission"
    })).ok, true);
    const provider = captures.provider;
    provider.connectionGeneration = "replacement-connection";
    captures.subscribers.clear();
    let resumes = 0;
    provider.resumeThread = async () => {
      resumes += 1;
      return { id: provider.threadId };
    };
    provider.subscribe = () => { throw new Error("Observer attachment failed."); };
    const ready = await controller.ensureThread(sessionId);
    assert.equal(ready.ok, false);
    assert.equal(resumes, 0, "failed observation must prevent native resume");
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerStatus === "observation_lost" && !run.active, "verified stop after failed observer attachment");
    assert.ok(captures.stopRuntimes > 0);
  });
});

for (const retainProvider of [true, false]) {
  test(`startup-lock contention preserves work and goals and retries (retained provider: ${retainProvider})`, async () => {
    await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => runWithProjectRequestContext({
      targetRoot: runtime.projectContextRoot
    }, async () => {
      const started = await controller.sendMessage(sessionId, {
        message: "Keep the goal running while the shared server reconnects.",
        messageId: "goal-startup-contention"
      });
      assert.equal(started.ok, true, JSON.stringify(started));
      let provider = captures.provider;
      emitCodexNotification(captures.subscribers, threadGoalUpdated({
        threadId: provider.threadId,
        turnId: provider.turnId
      }));
      const before = await waitForSessionValue(
        () => store.readAgentRun(sessionId, "codex_app_server"),
        (run) => run?.providerGoalStatus === "active",
        "the active goal before reconnecting"
      );
      let busy = true;
      let recovered = false;
      let threadStops = 0;
      const prepareProvider = (current) => {
        provider = current;
        provider.status = "inProgress";
        provider.turnId = before.providerTurnId;
        provider.ensureAvailable = async () => {
          if (busy) {
            throw Object.assign(new Error("Codex is still reconnecting."), {
              code: CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
              retryable: true
            });
          }
          recovered = true;
        };
        provider.stopThreadForObservationLoss = async () => { threadStops += 1; };
      };
      if (retainProvider) {
        prepareProvider(provider);
      } else {
        // Discard the local connection so recovery starts with only persisted ownership.
        assert.equal((await controller.reconcileThreads([])).ok, true);
        assert.equal(provider.closed, 1);
        captures.onProviderCreated = prepareProvider;
      }
      const reconciliation = await controller.reconcileThreads([{ sessionId }]);
      assert.equal(reconciliation.ok, false);
      assert.equal(reconciliation.results[0].status, "reconnecting");
      assert.equal(reconciliation.results[0].retryable, true);
      assert.equal(provider.observationFailure, undefined);
      assert.equal(provider.closed, 0);
      assert.equal(threadStops, 0);
      assert.equal(captures.stopRuntimes, 0);
      assert.deepEqual(await store.readAgentRun(sessionId, "codex_app_server"), before);

      busy = false;
      await waitForSessionValue(() => recovered, Boolean, "automatic recovery after the startup lock clears");
      const after = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(after.state, VIBE64_AGENT_RUN_STATE.ACTIVE);
      assert.equal(after.providerGoalStatus, "active");
      assert.equal(after.providerTurnId, before.providerTurnId);
      assert.equal(captures.provider, provider);
      assert.equal(captures.turns.length, 1, "Recovery must not replay the prompt");
      assert.equal(captures.stopRuntimes, 0);
    }), { codexAppServerActiveReconcileMs: 20 });
  });
}

test("restart reconciliation keeps a live goal successor visible and steerable despite interrupted history", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const messageId = "message-goal-restart-owner";
    const started = await controller.sendMessage(sessionId, {
      message: "Continue the approved goal across a restart.",
      messageId
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      threadId,
      turnId: provider.turnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active",
      "the durable goal before restart reconciliation"
    );

    // thread/read reports live activity without an id; turn history can still
    // report interrupted while the automatically resumed turn is compacting.
    const successorTurnId = "goal-successor-after-restart";
    provider.turnId = successorTurnId;
    provider.connectionGeneration = "connection-after-restart";
    let liveStatus = "active";
    provider.readThreadStatus = async () => ({
      raw: { id: threadId, status: { type: liveStatus, activeFlags: [] } }
    });
    captures.threadSnapshotTurns = [{
      id: successorTurnId,
      items: [],
      status: "interrupted"
    }];
    provider.listThreadTurns = async () => ({ data: captures.threadSnapshotTurns });

    const ready = await controller.ensureThread(sessionId);
    assert.equal(ready.ok, true, JSON.stringify(ready));
    const recovered = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(recovered.state, VIBE64_AGENT_RUN_STATE.ACTIVE);
    assert.equal(recovered.providerTurnId, successorTurnId);
    assert.equal(recovered.outerTurnId, messageId);
    assert.equal(recovered.providerGoalStatus, "active");

    const text = "The resumed goal is continuing and its progress is visible.";
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "goal-restart-commentary",
      phase: "commentary",
      text,
      threadId,
      turnId: successorTurnId
    }));
    await waitForSessionValue(
      () => store.readConversationLog(sessionId),
      (turns) => turns.some((turn) => turn.commentary?.some((item) => item.text === text)),
      "the resumed goal commentary in the transcript"
    );
    const steered = await controller.sendMessage(sessionId, {
      message: "Give me a brief update, then continue the same goal.",
      messageId: "message-goal-restart-steer"
    });
    assert.equal(steered.ok, true, JSON.stringify(steered));
    assert.equal(captures.steers.at(-1)?.turnId, successorTurnId);
    assert.equal(captures.turns.length, 1, "steering must not start another ordinary turn");
    assert.equal(JSON.stringify(await store.readConversationLog(sessionId)).includes(
      "Codex could not finish because its provider failed."
    ), false);

    // Failure reconciliation may await history while the goal starts working.
    // The final decision must confirm inactivity after that awaited read.
    const listThreadTurns = provider.listThreadTurns;
    provider.listThreadTurns = async (...args) => {
      liveStatus = "active";
      return listThreadTurns(...args);
    };
    liveStatus = "idle";
    await controller.ensureThread(sessionId);
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).state,
      VIBE64_AGENT_RUN_STATE.ACTIVE);
    provider.listThreadTurns = listThreadTurns;

    // Once the provider really is idle, interrupted history must still settle
    // the turn. An active goal alone is not evidence of a running provider.
    liveStatus = "idle";
    await controller.ensureThread(sessionId);
    const stopped = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(stopped.state, VIBE64_AGENT_RUN_STATE.INTERRUPTED);
    assert.equal(stopped.providerTurnId, successorTurnId);

    // If that idle snapshot was stale, a new authoritative live observation
    // must repair the same turn without requiring a goal pause/resume nudge.
    liveStatus = "active";
    const observedAgain = await controller.ensureThread(sessionId);
    assert.equal(observedAgain.ok, true, JSON.stringify(observedAgain));
    const repaired = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(repaired.state, VIBE64_AGENT_RUN_STATE.ACTIVE);
    assert.equal(repaired.providerTurnId, successorTurnId);
    assert.equal(repaired.outerTurnId, messageId);
    assert.equal((await controller.sendMessage(sessionId, {
      message: "Keep working on the same goal.",
      messageId: "message-goal-observation-repaired"
    })).ok, true);
    assert.equal(captures.steers.at(-1)?.turnId, successorTurnId);
  });
});

test("a provider activity read cannot undo a user Stop completed while that read was pending", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    assert.equal((await controller.sendMessage(sessionId, {
      message: "Exercise cancellation during reconciliation.", messageId: "stop-during-status-read"
    })).ok, true);
    const provider = captures.provider;
    captures.threadSnapshotTurns = [];
    provider.connectionGeneration = "replacement-connection";
    const reading = createDeterministicHold();
    let reads = 0;
    provider.readThreadStatus = async () => {
      const snapshot = { status: provider.status, turnId: provider.turnId };
      if (++reads === 2) {
        reading.enter();
        await reading.wait;
      }
      return snapshot;
    };
    provider.interruptTurn = async () => {
      provider.status = "idle";
      return { interrupted: true };
    };
    const restoration = controller.ensureThread(sessionId);
    try {
      await reading.entered;
      const stopped = await controller.interruptTurn(sessionId, { threadId: provider.threadId });
      assert.equal(stopped.ok, true, JSON.stringify(stopped));
      assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).state,
        VIBE64_AGENT_RUN_STATE.INTERRUPTED);
    } finally {
      reading.release();
      await restoration;
    }
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).state,
      VIBE64_AGENT_RUN_STATE.INTERRUPTED);
  });
});

test("goal continuation publishes every final reply while retaining one outer chat owner", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const messageId = "message-goal-cadence-owner";
    const started = await controller.sendMessage(sessionId, {
      message: "Run the durable goal cadence fixture.",
      messageId
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    const firstTurnId = provider.turnId;
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "active",
      threadId,
      turnId: firstTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active",
      "the active goal owner"
    );

    const goalTurns = [{
      commentary: "Verifying the current checkpoint.",
      final: "Internal checkpoint one.\n\nThis provider turn is not the outer chat result.",
      reasoning: "Confirming task completion",
      turnId: firstTurnId
    }, {
      commentary: "Continuing the goal in the same outer turn.",
      final: "Internal checkpoint two.\n\nThe active goal will continue again.",
      reasoning: "Confirming idle state",
      turnId: "goal-turn-2"
    }, {
      commentary: "Preparing the terminal goal result.",
      final: "The goal is paused with the verified checkpoint preserved.",
      reasoning: "Waiting for more information",
      turnId: "goal-turn-3"
    }];

    for (let index = 0; index < goalTurns.length; index += 1) {
      const turn = goalTurns[index];
      emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
        itemId: `reasoning-${index + 1}`,
        text: turn.reasoning,
        threadId,
        turnId: turn.turnId
      }));
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: `commentary-${index + 1}`,
        phase: "commentary",
        text: turn.commentary,
        threadId,
        turnId: turn.turnId
      }));
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: `final-${index + 1}`,
        phase: "final_answer",
        text: turn.final,
        threadId,
        turnId: turn.turnId
      }));

      const successor = goalTurns[index + 1];
      provider.status = successor ? "inProgress" : "completed";
      provider.turnId = successor?.turnId || turn.turnId;
      emitCodexNotification(captures.subscribers, turnCompleted({
        threadId,
        turnId: turn.turnId
      }));
      if (successor) {
        emitCodexNotification(captures.subscribers, turnStarted({
          threadId,
          turnId: successor.turnId
        }));
        const adopted = await waitForSessionValue(
          () => store.readAgentRun(sessionId, "codex_app_server"),
          (run) => run?.providerTurnId === successor.turnId &&
            run?.state === VIBE64_AGENT_RUN_STATE.ACTIVE,
          `goal successor ${successor.turnId}`
        );
        assert.equal(adopted.inputSource, "chat");
        assert.equal(adopted.outerTurnId, messageId);
        assert.equal(adopted.providerGoalStatus, "active");
      }
    }

    const held = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === "goal-turn-3" &&
        run?.state === VIBE64_AGENT_RUN_STATE.FINALIZING,
      "the terminal provider turn to remain goal-owned"
    );
    assert.equal(held.inputSource, "chat");
    assert.equal(held.outerTurnId, messageId);

    const beforeGoalSettlement = await store.readConversationLog(sessionId);
    assert.deepEqual(beforeGoalSettlement.flatMap((turn) => turn.assistant ? [turn.assistant.text] : []),
      goalTurns.map(({ final }) => final));
    assert.deepEqual(
      beforeGoalSettlement.flatMap((turn) => turn.thinking || []).map(({ text }) => text),
      goalTurns.map(({ reasoning }) => reasoning)
    );
    assert.deepEqual(
      beforeGoalSettlement.flatMap((turn) => turn.commentary || []).map(({ text }) => text),
      goalTurns.map(({ commentary }) => commentary)
    );

    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "paused",
      threadId,
      turnId: "goal-turn-3"
    }));
    const settled = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "paused" &&
        run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the outer goal result to settle"
    );
    assert.equal(settled.inputSource, "chat");
    assert.equal(settled.outerTurnId, messageId);

    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "final-3",
      phase: "final_answer",
      text: goalTurns[2].final,
      threadId,
      turnId: "goal-turn-3"
    }));
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: "goal-turn-3"
    }));
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "paused",
      threadId,
      turnId: "goal-turn-3"
    }));
    await controller.closeAllForSession(sessionId);

    const conversation = await store.readConversationLog(sessionId);
    const assistantMessages = conversation.map((turn) => turn.assistant).filter(Boolean);
    assert.deepEqual(assistantMessages.map(({ text }) => text), goalTurns.map(({ final }) => final));
    const allVisibleText = JSON.stringify(conversation);
    assert.equal(allVisibleText.includes("Internal checkpoint one."), true);
    assert.equal(allVisibleText.includes("Internal checkpoint two."), true);

    const run = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(run.events.filter(({ kind }) => (
      kind === "codex-app-server-turn-continued"
    )).length, 2);
    assert.equal(run.events.filter(({ kind }) => (
      kind === "codex-app-server-result-processed"
    )).length, 1);
    assert.equal(run.events.filter(({ kind }) => (
      kind === "codex-app-server-goal-status-updated"
    )).length, 2);
  });
});

test("a persisted active goal restores its chat owner when a successor is observed from idle", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const messageId = "message-persisted-goal-owner";
    const started = await controller.sendMessage(sessionId, {
      message: "Exercise the persisted goal ownership boundary.",
      messageId
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "active",
      threadId,
      turnId: provider.turnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active",
      "the durable active goal status"
    );

    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "test-persisted-goal-idle-boundary",
        state: VIBE64_AGENT_RUN_STATE.COMPLETED
      },
      patch: {
        providerStatus: "completed",
        state: VIBE64_AGENT_RUN_STATE.COMPLETED
      }
    });
    const persistedIdle = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(persistedIdle.inputSource, "chat");
    assert.equal(persistedIdle.outerTurnId, messageId);
    assert.equal(persistedIdle.providerGoalStatus, "active");

    const successorTurnId = "persisted-goal-successor";
    captures.finalText = (turnId) => turnId === successorTurnId
      ? "Recovered goal final."
      : `Completed ${turnId}.`;
    provider.status = "inProgress";
    provider.turnId = successorTurnId;
    emitCodexNotification(captures.subscribers, turnStarted({
      threadId,
      turnId: successorTurnId
    }));
    const recovered = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === successorTurnId &&
        run?.state === VIBE64_AGENT_RUN_STATE.ACTIVE,
      "the idle goal successor to recover"
    );
    assert.equal(recovered.inputSource, "chat");
    assert.equal(recovered.outerTurnId, messageId);
    assert.equal(recovered.providerGoalStatus, "active");

    emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
      itemId: "recovered-goal-reasoning",
      text: "Confirming idle state",
      threadId,
      turnId: successorTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "recovered-goal-commentary",
      phase: "commentary",
      text: "The persisted outer owner is still active.",
      threadId,
      turnId: successorTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "recovered-goal-final",
      phase: "final_answer",
      text: "Recovered goal final.",
      threadId,
      turnId: successorTurnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: successorTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.state === VIBE64_AGENT_RUN_STATE.FINALIZING,
      "the recovered goal final to remain outer-owned"
    );
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "complete",
      threadId,
      turnId: successorTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "complete" &&
        run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the recovered goal to complete"
    );
    await controller.closeAllForSession(sessionId);

    const conversation = await store.readConversationLog(sessionId);
    assert.deepEqual(
      conversation.flatMap((turn) => turn.thinking || []).map(({ text }) => text),
      ["Confirming idle state"]
    );
    assert.deepEqual(
      conversation.flatMap((turn) => turn.commentary || []).map(({ text }) => text),
      ["The persisted outer owner is still active."]
    );
    assert.deepEqual(
      conversation.map((turn) => turn.assistant).filter(Boolean).map(({ text }) => text),
      ["Recovered goal final."]
    );
  });
});

test("terminal-origin messages inherit the latest UI actor without changing goal ownership", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const started = await controller.sendMessage(sessionId, {
      message: "Establish the visible chat thread.",
      messageId: "message-before-terminal-origin",
      vibe64User: {
        preferredName: "Ada",
        username: "ada-owner"
      }
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    const chatTurnId = provider.turnId;
    captures.finalText = "Visible chat final.";
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "chat-final",
      phase: "final_answer",
      text: "Visible chat final.",
      threadId,
      turnId: chatTurnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: chatTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the visible chat turn to complete"
    );

    const terminalTurnId = "terminal-origin-turn";
    const beforeProbe = await store.readAgentRun(sessionId, "codex_app_server");
    const readStatus = provider.readThreadStatus;
    provider.connectionGeneration = "after-control-check";
    provider.readThreadStatus = async () => ({ status: "idle" });
    provider.turnId = "internal-control-check";
    let probeChecks = 0;
    provider.isControlProbeTurn = (id, turnId) => {
      probeChecks += 1;
      return id === threadId && turnId === "internal-control-check";
    };
    captures.threadSnapshotTurns = [{ id: "internal-control-check", status: "completed", items: [] }];
    const reconnected = await controller.reconcileThreads([{ sessionId }]);
    assert.equal(reconnected.ok, true, JSON.stringify(reconnected));
    assert.ok(probeChecks > 0);
    const afterProbe = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(afterProbe.providerTurnId, beforeProbe.providerTurnId);
    assert.equal(afterProbe.outerTurnId, beforeProbe.outerTurnId);
    assert.equal(afterProbe.state, VIBE64_AGENT_RUN_STATE.COMPLETED);
    provider.readThreadStatus = readStatus;
    captures.threadSnapshotTurns = null;
    provider.status = "inProgress";
    provider.turnId = terminalTurnId;
    emitCodexNotification(captures.subscribers, turnStarted({
      threadId,
      turnId: terminalTurnId
    }));
    const terminalRun = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === terminalTurnId &&
        run?.state === VIBE64_AGENT_RUN_STATE.ACTIVE,
      "the terminal-origin turn to activate"
    );
    assert.equal(terminalRun.inputSource, "terminal");
    assert.equal(terminalRun.outerTurnId, `codex:${threadId}:${terminalTurnId}`);

    emitCodexNotification(captures.subscribers, {
      method: "item/completed",
      params: {
        item: {
          content: [{ text: "Native terminal request.", type: "text" }],
          id: "terminal-user-message",
          type: "userMessage"
        },
        threadId,
        turnId: terminalTurnId
      }
    });
    const terminalUserMessage = await waitForSessionValue(
      async () => (await store.readConversationLog(sessionId))
        .find((turn) => turn.user?.text === "Native terminal request."),
      Boolean,
      "the terminal-origin user message to be mirrored"
    );
    assert.partialDeepStrictEqual(terminalUserMessage.metadata, {
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      engineId: "codex"
    });

    emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
      itemId: "terminal-reasoning",
      text: "Terminal reasoning remains outside chat thinking.",
      threadId,
      turnId: terminalTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "terminal-commentary",
      phase: "commentary",
      text: "Visible terminal commentary.",
      threadId,
      turnId: terminalTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "terminal-final",
      phase: "final_answer",
      text: "Visible terminal final.",
      threadId,
      turnId: terminalTurnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: terminalTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === terminalTurnId &&
        run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the terminal-origin turn to complete"
    );
    await controller.closeAllForSession(sessionId);

    const conversation = await store.readConversationLog(sessionId);
    assert.deepEqual(
      conversation.map((turn) => turn.assistant).filter(Boolean).map(({ text }) => text),
      ["Visible chat final.", "Visible terminal final."]
    );
    assert.deepEqual(
      conversation.flatMap((turn) => turn.commentary || []).map(({ text }) => text),
      ["Visible terminal commentary."]
    );
    assert.equal(JSON.stringify(conversation).includes("Terminal reasoning remains outside chat thinking."), false);
  });
});

test("a changed session environment retires the previous provider for the same runtime", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-provider-ownership-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  let environmentVersion = "one";
  const providers = [];
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory(options) {
      const provider = {
        closed: 0,
        options,
        close() {
          provider.closed += 1;
        },
        async ensureAvailable() {},
        async startThread() {
          return { id: `conversation-${providers.length + 1}` };
        }
      };
      providers.push(provider);
      return provider;
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return session;
          },
          projectContextRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectInspectionEnvironment() {
        return {
          PROVIDER_OWNERSHIP_VERSION: environmentVersion,
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        };
      }
    }
  });
  try {
    const first = await controller.createConversation("session-1");
    assert.equal(first.ok, true, JSON.stringify(first));
    environmentVersion = "two";
    const second = await controller.createConversation("session-1");
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(providers.length, 2);
    assert.equal(providers[0].closed, 1);
    assert.equal(providers[1].closed, 0);
  } finally {
    await controller.closeAllForSession("session-1");
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("Codex sessions retain one shared runtime and concurrent final closes stop it once", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-shared-codex-runtime-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session: firstSession
  } = await managedSessionFixture(temporaryRoot);
  const secondSourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "session-2",
    "source"
  );
  await mkdir(secondSourcePath, { recursive: true });
  const secondSession = {
    ...firstSession,
    metadata: {
      ...firstSession.metadata,
      source_path: secondSourcePath
    },
    sessionId: "session-2",
    sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-2")
  };
  const thirdSourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "session-3",
    "source"
  );
  await mkdir(thirdSourcePath, { recursive: true });
  const thirdSession = {
    ...firstSession,
    metadata: {
      ...firstSession.metadata,
      source_path: thirdSourcePath
    },
    sessionId: "session-3",
    sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-3")
  };
  const sessions = new Map([
    [firstSession.sessionId, firstSession],
    [secondSession.sessionId, secondSession],
    [thirdSession.sessionId, thirdSession]
  ]);
  const providers = [];
  let stopRuntimeCalls = 0;
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory(options) {
      const provider = {
        closed: 0,
        options,
        close() {
          provider.closed += 1;
        },
        async ensureAvailable() {},
        async startThread() {
          return { id: `conversation-${providers.length + 1}` };
        },
        async stopRuntime() {
          stopRuntimeCalls += 1;
          return {
            processExitVerified: true,
            stopped: true
          };
        }
      };
      providers.push(provider);
      return provider;
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return {
          async getSession(sessionId) {
            return sessions.get(sessionId);
          },
          projectContextRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectInspectionEnvironment() {
        return {
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        };
      }
    }
  });
  try {
    const first = await controller.createConversation(firstSession.sessionId);
    const second = await controller.createConversation(secondSession.sessionId);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(providers.length, 2);
    assert.equal(providers[0].options.runtimeDir, providers[1].options.runtimeDir);
    assert.equal(providers[0].options.threadWorkdir, firstSession.metadata.source_path);
    assert.equal(providers[1].options.threadWorkdir, secondSession.metadata.source_path);
    assert.deepEqual(providers.map(({ options }) => options.session), [{}, {}]);

    await controller.closeAllForSession(firstSession.sessionId);
    assert.equal(stopRuntimeCalls, 0);
    assert.equal(providers[0].closed, 1);

    const third = await controller.createConversation(thirdSession.sessionId);
    assert.equal(third.ok, true, JSON.stringify(third));
    assert.equal(providers.length, 3);
    assert.equal(providers[2].options.runtimeDir, providers[1].options.runtimeDir);
    assert.equal(providers[2].options.threadWorkdir, thirdSession.metadata.source_path);

    await Promise.all([
      controller.closeAllForSession(secondSession.sessionId),
      controller.closeAllForSession(thirdSession.sessionId)
    ]);
    assert.equal(stopRuntimeCalls, 1);
  } finally {
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("an active chat keeps one composed session context while authored turns stay unchanged", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-active-provider-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const projectContextRoot = path.join(temporaryRoot, "authority");
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "session-1",
    "source"
  );
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
  });
  await store.createSession({
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    runtimeKind: "genesis",
    sessionId: "session-1"
  });

  let environmentVersion = "one";
  let nextTurn = 0;
  const vibe64User = {
    preferredName: "Ada",
    role: "owner",
    username: "ada-owner"
  };
  const providers = [];
  const runtime = {
    async getSession(sessionId) {
      return store.readSession(sessionId);
    },
    async renderPrompt(_sessionId, { request } = {}) {
      return {
        prompt: String(request || "Continue.")
      };
    },
    projectContextRoot,
    stateRoot: projectRuntimeRoot,
    store
  };
  const controller = createCodexTerminalController({
    codexAppServerActiveReconcileMs: 60_000,
    codexAppServerDaemonWellbeingMs: 60_000,
    codexAppServerProviderFactory(options) {
      const subscribers = new Set();
      const providerNumber = providers.length + 1;
      const provider = {
        closed: 0,
        options,
        resumedThreads: [],
        sentTurns: [],
        startedThreads: [],
        status: "idle",
        steeredMessages: [],
        threadId: "11111111-1111-4111-8111-111111111111",
        turnId: "",
        close() {
          provider.closed += 1;
        },
        async ensureAvailable() {},
        async ensureRuntime() {
          return {
            endpoint: `unix://${path.join(temporaryRoot, `provider-${providerNumber}.sock`)}`,
            runtimeDir: path.join(temporaryRoot, `provider-${providerNumber}`),
            socketPath: path.join(temporaryRoot, `provider-${providerNumber}.sock`),
            transport: "unix"
          };
        },
        async interruptTurn() {
          provider.status = "interrupted";
          return {
            status: "interrupted"
          };
        },
        isAvailable() {
          return provider.closed === 0;
        },
        async listLoadedThreads() {
          return {
            data: [provider.threadId]
          };
        },
        async readThread() {
          return {
            turns: provider.turnId ? [{
              id: provider.turnId,
              items: [{
                id: `answer-${provider.turnId}`,
                phase: "final_answer",
                text: "The original turn completed safely.",
                type: "agentMessage"
              }],
              status: provider.status
            }] : []
          };
        },
        async listThreadTurns() {
          return { data: (await provider.readThread()).turns };
        },
        async readThreadStatus() {
          return {
            status: provider.status,
            turnId: provider.turnId
          };
        },
        async resumeThread(threadId, settings) {
          provider.threadId = threadId;
          provider.resumedThreads.push({ settings, threadId });
          return {
            id: threadId
          };
        },
        async sendTurn(threadId, input, settings) {
          nextTurn += 1;
          provider.status = "inProgress";
          provider.turnId = `turn-${nextTurn}`;
          provider.sentTurns.push({ input, settings, threadId });
          return {
            id: provider.turnId,
            raw: {
              status: provider.status
            }
          };
        },
        async startThread(settings) {
          provider.startedThreads.push(settings);
          return {
            id: provider.threadId
          };
        },
        async steerTurn(threadId, turnId, message, settings) {
          provider.steeredMessages.push({
            message,
            settings,
            threadId,
            turnId
          });
          return {
            id: turnId
          };
        },
        async stopRuntime() {},
        subscribe(callback) {
          subscribers.add(callback);
          return () => subscribers.delete(callback);
        }
      };
      providers.push(provider);
      return provider;
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return runtime;
      },
      createSessionStore() {
        return store;
      },
      async projectExecutionEnvironment() {
        return this.projectInspectionEnvironment();
      },
      async projectInspectionEnvironment() {
        return {
          PROVIDER_OWNERSHIP_VERSION: environmentVersion,
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        };
      }
    }
  });

  try {
    const started = await controller.sendMessage("session-1", {
      message: "Start the work.",
      messageId: "message-1",
      vibe64User
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].options.threadEnv.PROVIDER_OWNERSHIP_VERSION, "one");
    assert.equal(
      providers[0].options.threadEnv.PATH.split(path.delimiter).includes(genesisCommandShimDirectory()),
      true
    );
    assert.equal(
      providers[0].startedThreads[0].systemPrompt,
      undefined
    );
    assert.equal(providers[0].options.threadEnv.GENESIS_SESSION_CONTEXT_INSTALLED, undefined);
    assert.equal(providers[0].startedThreads[0].hostContext.conversationKind, "main");
    assert.ok(providers[0].options.terminalEnv.GENESIS_HOST_CONTEXT_RESOLVER);
    assert.ok(providers[0].options.terminalEnv.GENESIS_HOST_CONTEXT_RESOLVER_DATA);
    assert.equal(Object.hasOwn(
      providers[0].options.threadEnv,
      "GENESIS_HOST_CONTEXT_RESOLVER"
    ), false);
    assert.equal(Object.hasOwn(
      providers[0].options.threadEnv,
      "GENESIS_HOST_CONTEXT_RESOLVER_DATA"
    ), false);
    assert.deepEqual(providers[0].sentTurns[0].input, ["Start the work."]);
    assert.equal(Object.hasOwn(providers[0].sentTurns[0].settings, "additionalContext"), false);
    environmentVersion = "two";
    const ensured = await controller.ensureThread("session-1");
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);

    const steered = await controller.sendMessage("session-1", {
      message: "Use this additional detail.",
      messageId: "message-2",
      vibe64User
    });
    assert.equal(steered.ok, true, JSON.stringify(steered));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);
    assert.equal(providers[0].steeredMessages.length, 1);
    assert.equal(providers[0].steeredMessages[0].threadId, providers[0].threadId);
    assert.equal(providers[0].steeredMessages[0].turnId, "turn-1");
    assert.equal(
      providers[0].steeredMessages[0].message,
      "Use this additional detail."
    );
    assert.equal(Object.hasOwn(
      providers[0].steeredMessages[0].settings,
      "additionalContext"
    ), false);
    const attributedTurns = await store.readConversationLog("session-1");
    assert.equal(attributedTurns.slice(0, 2).every((turn) => (
      turn.metadata?.actorId === "ada-owner" &&
      turn.metadata.actorDisplayName === "Ada"
    )), true);

    const activeReconciliation = await controller.reconcileThreads([{
      sessionId: "session-1"
    }]);
    assert.equal(activeReconciliation.ok, true, JSON.stringify(activeReconciliation));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);

    providers[0].status = "completed";
    const completedReconciliation = await controller.reconcileThreads([{
      sessionId: "session-1"
    }]);
    assert.equal(completedReconciliation.ok, true, JSON.stringify(completedReconciliation));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);
    const completedSession = await store.readSession("session-1");
    assert.equal(completedSession.agentRuns.find(({ id }) => id === "codex_app_server")?.state, "completed");
    assert.match(
      JSON.stringify(await store.readConversationLog("session-1")),
      /The original turn completed safely\./u
    );

    const restarted = await controller.sendMessage("session-1", {
      message: "Start the next turn.",
      messageId: "message-3",
      vibe64User
    });
    assert.equal(restarted.ok, true, JSON.stringify(restarted));
    assert.equal(providers.length, 2);
    assert.equal(providers[0].closed, 1);
    assert.equal(providers[1].closed, 0);
    assert.equal(providers[1].options.threadEnv.PROVIDER_OWNERSHIP_VERSION, "two");
    assert.equal(
      providers[1].resumedThreads[0].settings.systemPrompt,
      undefined
    );
    assert.deepEqual(providers[1].sentTurns[0].input, ["Start the next turn."]);
    assert.equal(Object.hasOwn(providers[1].sentTurns[0].settings, "additionalContext"), false);
    assert.equal(providers[1].resumedThreads[0].settings.hostContext.conversationKind, "main");
    const restartedMessage = (await store.readConversationLog("session-1"))
      .find((turn) => turn.user?.text === "Start the next turn.");
    assert.partialDeepStrictEqual(restartedMessage?.metadata, {
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      engineId: "codex"
    });

    environmentVersion = "three";
    await store.writeMetadataValue("session-1", "session_closing_reason", "archived");
    const interrupted = await controller.interruptTurn("session-1", {
      controlRequestId: "interrupt-1"
    });
    assert.equal(interrupted.ok, true, JSON.stringify(interrupted));
    assert.equal(providers.length, 2);
    assert.equal(providers[1].closed, 0);
  } finally {
    await controller.closeAllForSession("session-1");
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("closing a session without recorded Codex ownership leaves the shared runtime alone", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-unrecorded-runtime-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  const agentRuntimeRoot = path.join(temporaryRoot, "agent-runtimes");
  const providerEnv = {
    VIBE64_AGENT_RUNTIME_DIR: agentRuntimeRoot,
    VIBE64_RUNTIME_NAMESPACE: "test",
    VIBE64_WORKSPACE: "test"
  };
  const sharedRuntimeDir = codexAppServerRuntimeDir({
    env: providerEnv
  });
  await mkdir(sharedRuntimeDir, {
    recursive: true
  });
  await writeFile(
    path.join(sharedRuntimeDir, "runtime.json"),
    JSON.stringify(exactStoppedRuntimeMetadata(sharedRuntimeDir))
  );
  let currentSession = session;
  const controller = createCodexTerminalController({
    codexAppServerProviderOptions: {
      env: providerEnv
    },
    env: providerEnv,
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return currentSession;
          },
          projectContextRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectInspectionEnvironment() {
        return providerEnv;
      }
    }
  });
  try {
    await controller.closeAllForSession("session-1");
    assert.equal(
      JSON.parse(await readFile(path.join(sharedRuntimeDir, "runtime.json"), "utf8")).runtimeDir,
      sharedRuntimeDir
    );

    currentSession = {
      metadata: {},
      sessionId: "session-without-source",
      sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-without-source")
    };
    await controller.closeAllForSession("session-without-source");
    assert.equal(
      JSON.parse(await readFile(path.join(sharedRuntimeDir, "runtime.json"), "utf8")).runtimeDir,
      sharedRuntimeDir
    );
  } finally {
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("temporary conversations start turns without resuming a nonexistent rollout", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));

    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Explain this conflict."
    });

    assert.equal(turn.ok, true);
    assert.equal(calls.filter(([kind]) => kind === "resume").length, 0);
    assert.deepEqual(calls.filter(([kind]) => kind === "turn"), [
      ["turn", "conversation-1"]
    ]);
  });
});

test("temporary Repair conversations do not depend on failed helper cleanup after a restart", async () => {
  await withConversationController(async ({ session, captures, controller, projectRuntimeRoot, projectService,
    simulateControllerCrash, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile, outputSchema: sourceExplanationOutputSchema(), prompt: "Disposable helper."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Done." }) });
    const helper = await pending;
    captures.failDeletes = 1;
    assert.equal((await controller.deleteDetachedChatThread("session-1", {
      executionProfile, threadId: helper.threadId
    })).ok, false);
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    const before = (await ledger.readAll()).records;
    simulateControllerCrash();
    const calls = [];
    const restartedState = restartedCaptures(captures, {
      runtimeInfo: { ...captures.runtimeInfo, accountIdentitySignature: TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE },
      // Reserve conversation-1 for the persisted helper.
      threads: [{}],
      uniqueThreadIds: true,
      deleteThreadHandler(threadId) {
        assert.notEqual(threadId, helper.threadId, "Repair must not touch the unrelated helper");
        return { id: threadId };
      }
    });
    const restarted = createRestartedController({ session, calls, captures: restartedState, projectService });
    const conversation = await restarted.createConversation("session-1", {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    const turn = await restarted.startConversationTurn("session-1", {
      conversationId: conversation.conversationId, message: "Repair the subsystem map."
    });
    assert.equal(turn.ok, true, JSON.stringify(turn));
    assert.equal((await restarted.deleteConversation("session-1", {
      conversationId: conversation.conversationId, ephemeral: true
    })).ok, true);
    assert.deepEqual(restartedState.deletes, [conversation.conversationId]);
    assert.deepEqual(restartedState.resumes, []);
    assert.equal(restartedState.stopRuntimes, 0);
    assert.deepEqual((await ledger.readAll()).records, before);
    const unowned = await restarted.deleteDetachedChatThread("session-1", { threadId: helper.threadId });
    assert.equal(unowned.ok, false, "Omitting a profile must not bypass durable helper ownership");
    assert.deepEqual(restartedState.deletes, [conversation.conversationId]);
  });
});

test("temporary Codex uses normal execution settings, preserves command edits on close, and never writes main history", async () => {
  await withConversationController(async ({ captures, controller, projectService, session, subscribers }) => {
    const workdir = session.metadata.source_path;
    await writeFile(path.join(workdir, "existing.txt"), "Unrelated local work");
    const createRuntime = projectService.createRuntime.bind(projectService);
    projectService.createRuntime = (...args) => {
      const runtime = createRuntime(...args);
      for (const method of ["writeConversationUserMessage", "writeConversationAssistantMessage", "upsertConversationAssistantMessage"]) {
        runtime.store[method] = () => assert.fail("Temporary messages must not enter main History");
      }
      return runtime;
    };
    captures.onSendTurn = ({ settings }) => {
      assert.deepEqual(settings, codexAppServerTurnSettings({ cwd: workdir }));
      execFileSync("sh", ["-c", "printf 'Temporary command edit' > temporary-edit.txt"], { cwd: settings.cwd });
    };
    const conversation = await controller.createConversation("session-1", { ephemeral: true });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    const ordinary = codexAppServerThreadSettings({ cwd: workdir });
    assert.equal(captures.threads[0].sandbox, ordinary.sandbox);
    assert.equal(captures.threads[0].approvalPolicy, ordinary.approvalPolicy);
    assert.equal(Object.hasOwn(captures.threads[0], "dynamicTools"), false);
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId, ephemeral: true, message: "Edit the project."
    });
    assert.equal(turn.ok, true, JSON.stringify(turn));
    completeDetachedTurn(subscribers, { text: "Project edited." });
    await controller.waitForConversationTurn("session-1", { conversationId: conversation.conversationId });
    const closed = await controller.deleteConversation("session-1", { conversationId: conversation.conversationId, ephemeral: true });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.equal(await readFile(path.join(workdir, "temporary-edit.txt"), "utf8"), "Temporary command edit");
    assert.equal(await readFile(path.join(workdir, "existing.txt"), "utf8"), "Unrelated local work");
    assert.deepEqual(captures.deletes, [conversation.conversationId]);
  });
});

test("temporary conversations receive task session context without turn enrichment", async () => {
  const vibe64User = {
    preferredName: "Ada",
    role: "owner",
    username: "ada-owner"
  };

  await withConversationController(async ({ captures, controller, promptHintReads }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true,
      vibe64User
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));

    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Fix the focused issue.",
      vibe64User
    });
    assert.equal(turn.ok, true, JSON.stringify(turn));

    assert.equal(
      captures.threads[0].systemPrompt,
      undefined
    );
    assert.equal(captures.threads[0].hostContext.conversationKind, "temporary");
    assert.deepEqual(captures.turns[0].input, ["Fix the focused issue."]);
    assert.equal(Object.hasOwn(captures.turns[0].settings, "additionalContext"), false);
    assert.deepEqual(promptHintReads, []);

    const snapshot = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      runId: turn.runId
    });
    assert.deepEqual(snapshot.turnMetadata, {
      actorDisplayName: "Ada",
      actorId: "ada-owner"
    });
  }, { promptHints: false });
});

test("Codex cold recovery restores the temporary hook binding before native resume", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const conversation = await controller.createConversation("session-1", { ephemeral: true });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    const options = captures.providerOptions.at(-1);
    const params = await options.prepareThreadResumeParams(conversation.conversationId, {}, {
      runtime: { executionId: "replacement-process", reused: false }, processChanged: true
    });
    assert.equal(params.systemPrompt, undefined);
    assert.equal(params.cwd, session.metadata.source_path);
    const input = await vibe64DriverInputFromRegistry({
      data: JSON.parse(options.terminalEnv.GENESIS_HOST_CONTEXT_RESOLVER_DATA),
      providerSessionId: conversation.conversationId, scope: "session"
    });
    assert.equal(input.conversationKind, "temporary");
    assert.deepEqual(captures.resumes, [], "the binding is ready before the native resume RPC");
  });
});

test("non-project ephemeral conversations disable Codex tools and network on a supported app-server", async () => {
  await withConversationController(async ({ captures, controller, temporaryRoot }) => {
    const workdir = path.join(temporaryRoot, "system-repair-workdir");
    const runtimeRoot = path.join(temporaryRoot, "system-repair-runtime");
    await Promise.all([
      mkdir(workdir, { recursive: true }),
      mkdir(runtimeRoot, { recursive: true })
    ]);
    const assistantScope = {
      environment: {},
      id: "system_repair_test",
      runtimeRoot,
      stableContext: "Trusted bounded host snapshot.",
      workdir
    };
    const options = { assistantScope };
    const conversation = await controller.createConversation(assistantScope.id, {
      ephemeral: true
    }, options);
    assert.equal(conversation.ok, true, JSON.stringify(conversation));

    const providerOptions = captures.providerOptions.at(-1);
    assert.equal(providerOptions.routingModelProviderId, "openai");
    assert.equal(await providerOptions.prepareAuth("openai"), "native");
    assert.deepEqual(await providerOptions.prepareThreadEnvironment({}), {});
    const resumeParams = { model: "gpt-5.6-luna", config: { tools: { shell: false } } };
    assert.deepEqual(await providerOptions.prepareThreadResumeParams(conversation.conversationId, resumeParams, {
      runtime: {}, processChanged: true
    }), resumeParams);
    await providerOptions.beforeResumeThread(conversation.conversationId);

    const turn = await controller.startConversationTurn(assistantScope.id, {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Explain the trusted snapshot only."
    }, options);
    assert.equal(turn.ok, true, JSON.stringify(turn));
    assert.equal(captures.threads[0].systemPrompt, assistantScope.stableContext);
    assert.equal(captures.threads[0].sandbox, "read-only");
    assert.deepEqual(captures.threads[0].dynamicTools, []);
    assert.deepEqual(captures.threads[0].environments, []);
    assert.deepEqual(captures.threads[0].runtimeWorkspaceRoots, []);
    assert.deepEqual(captures.threads[0].selectedCapabilityRoots, []);
    assert.equal(captures.threads[0].config.features.shell_tool, false);
    assert.equal(captures.threads[0].config.features.web_search, undefined);
    assert.equal(captures.threads[0].config.web_search, "disabled");
    assert.deepEqual(captures.turns[0].settings.sandboxPolicy, {
      networkAccess: false,
      type: "readOnly"
    });
    assert.deepEqual(captures.turns[0].input, ["Explain the trusted snapshot only."]);

    const deleted = await controller.deleteConversation(assistantScope.id, {
      conversationId: conversation.conversationId,
      ephemeral: true
    }, options);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.deepEqual(captures.deletes, [conversation.conversationId]);
    assert.equal(captures.stopRuntimes, 1);
    assert.equal(deleted.providerExit.stopped, true);
  });
});

test("scoped Codex helper cancellation before thread creation releases its catalogue runtime", async () => {
  await withConversationController(async ({ captures, controller, session, temporaryRoot }) => {
    const scope = { id: "empty_helper", environment: {}, workdir: temporaryRoot,
      runtimeRoot: path.join(temporaryRoot, "helper-runtime"), stableContext: "Supplied text only." };
    const options = { assistantScope: scope };
    const before = structuredClone(session);
    await controller.executionProfileModelCatalog(scope.id, options);
    assert.equal(captures.threads.length, 0);
    const stopped = await controller.closeAllForSession(scope.id, options);
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(session, before);
  });
});

test("scoped Codex helpers enforce the selected bounded profile without touching the main session", async () => {
  await withConversationController(async ({ captures, controller, session, subscribers, temporaryRoot }) => {
    controller = throughCommonScopedConversation(controller);
    const workdir = path.join(temporaryRoot, "helper-work");
    await mkdir(workdir);
    const scope = { id: "router_job", environment: {}, workdir, runtimeRoot: path.join(temporaryRoot, "helper-runtime"),
      stableContext: "Classify only the supplied request." };
    const options = { assistantScope: scope };
    const before = structuredClone(session);
    const executionProfile = sourceExplanationHelperProfile({ workloadId: "request_routing",
      limits: { maxInputCharacters: 24, maxOutputCharacters: 128, timeoutMs: 1000 } });
    const catalog = await controller.executionProfileModelCatalog(scope.id, options);
    assert.equal(catalog.data[0].model, executionProfile.model);
    const created = await controller.createConversation(scope.id, { ephemeral: true, executionProfile }, options);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(captures.threads[0].ephemeral, true);
    assert.equal(captures.threads[0].model, executionProfile.model);
    assert.equal(captures.threads[0].config.features.shell_tool, false);
    assert.equal(captures.threads[0].config.model_reasoning_effort, "low");
    assert.equal(captures.threads[0].allowProviderModelFallback, false);
    const input = { ephemeral: true, conversationId: created.conversationId, executionProfile,
      message: "Classify this", outputSchema: sourceExplanationOutputSchema(8) };
    const started = await controller.startConversationTurn(scope.id, input, options);
    assert.equal(captures.resumes.length, 0, "a live ephemeral helper has no persisted rollout to resume");
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(captures.turns[0].settings.model, executionProfile.model);
    assert.equal(captures.turns[0].settings.effort, "low");
    assert.deepEqual(captures.turns[0].settings.sandboxPolicy, { networkAccess: false, type: "readOnly" });
    const waiting = controller.waitForConversationTurn(scope.id, { ...input, runId: started.runId }, options);
    completeDetachedTurn(subscribers, { text: '{"answer":"senior"}', threadId: created.conversationId, turnId: started.runId });
    const completed = await waiting;
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal(completed.rawText, '{"answer":"senior"}');
    const tooLong = await controller.startConversationTurn(scope.id, { ...input, message: "x".repeat(25) }, options);
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.error, /input limit/);
    assert.equal(captures.turns.length, 1);
    const changedProfile = await controller.startConversationTurn(scope.id, { ...input, executionProfile: {
      ...executionProfile, model: "different-model"
    } }, options);
    assert.equal(changedProfile.ok, false);
    assert.match(changedProfile.error, /profile changed/);
    const deleted = await controller.deleteConversation(scope.id, input, options);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.deepEqual(captures.deletes, [created.conversationId]);
    assert.deepEqual(session, before);
  });
});

test("scoped Codex helpers reject oversized output and keep their original deadline when waiting", async () => {
  for (const oversized of [true, false]) await withConversationController(async ({ captures, controller, subscribers, temporaryRoot }) => {
    controller = throughCommonScopedConversation(controller);
    const scope = { id: "bounded_job", environment: {}, workdir: temporaryRoot, runtimeRoot: path.join(temporaryRoot, "helper-runtime"),
      stableContext: "Use supplied text only." };
    const options = { assistantScope: scope };
    const executionProfile = sourceExplanationHelperProfile({ limits: { maxOutputCharacters: 128, timeoutMs: oversized ? 1000 : 25 } });
    const created = await controller.createConversation(scope.id, { ephemeral: true, executionProfile }, options);
    assert.equal(created.ok, true, JSON.stringify(created));
    const input = { ephemeral: true, conversationId: created.conversationId, executionProfile, message: "Answer",
      outputSchema: sourceExplanationOutputSchema(8) };
    const started = await controller.startConversationTurn(scope.id, input, options);
    assert.equal(started.ok, true, JSON.stringify(started));
    const pending = controller.waitForConversationTurn(scope.id, { ...input, runId: started.runId, timeoutMs: 60_000 }, options);
    if (oversized) completeDetachedTurn(subscribers, { text: "x".repeat(129), threadId: created.conversationId, turnId: started.runId });
    const result = await pending;
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.match(result.error, oversized ? /output limit/ : /timed out/i);
    if (!oversized) assert.deepEqual(captures.interrupts.at(-1), { threadId: created.conversationId, turnId: started.runId },
      "the workload deadline stops the exact native turn before returning");
    const stopped = await controller.stopConversation(scope.id, { ...input, runId: started.runId }, options);
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    assert.deepEqual(captures.interrupts.at(-1), { threadId: created.conversationId, turnId: started.runId });
    assert.equal((await controller.deleteConversation(scope.id, input, options)).ok, true);
  });
});

test("scoped Codex helpers reject a changed account before exposing completion", async () => {
  await withConversationController(async ({ captures, controller, subscribers, temporaryRoot }) => {
    controller = throughCommonScopedConversation(controller);
    const scope = { id: "account_fence", environment: {}, workdir: temporaryRoot,
      runtimeRoot: path.join(temporaryRoot, "helper-runtime"), stableContext: "Use supplied text only." };
    const options = { assistantScope: scope };
    const executionProfile = sourceExplanationHelperProfile();
    const created = await controller.createConversation(scope.id, { ephemeral: true, executionProfile }, options);
    assert.equal(created.ok, true, JSON.stringify(created));
    const input = { ephemeral: true, conversationId: created.conversationId, executionProfile, message: "Answer",
      outputSchema: sourceExplanationOutputSchema() };
    const started = await controller.startConversationTurn(scope.id, input, options);
    assert.equal(started.ok, true, JSON.stringify(started));
    const pending = controller.waitForConversationTurn(scope.id, { ...input, runId: started.runId }, options);
    captures.runtimeInfo.accountIdentitySignature = TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE;
    completeDetachedTurn(subscribers, { text: '{"answer":"Do not expose this account-stale reply."}',
      threadId: created.conversationId, turnId: started.runId });
    const result = await pending;
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.code, "vibe64_codex_helper_ownership_blocked");
    assert.match(result.error, /selected Codex account changed/u);
    const current = await controller.readConversation(scope.id, input, options);
    assert.equal(current.status, "failed");
    assert.equal(current.rawText, "");
    assert.equal(current.message, "");
    assert.deepEqual(captures.interrupts, [], "account validation must not interrupt an already completed native turn");
    assert.equal((await controller.deleteConversation(scope.id, input, options)).ok, true);
    assert.deepEqual(captures.deletes, [created.conversationId], "the parent keeps the original exact cleanup identity");
  });
});

test("scoped Codex helpers accept a same-account refresh through completion", async () => {
  await withConversationController(async ({ captures, controller, subscribers, temporaryRoot }) => {
    controller = throughCommonScopedConversation(controller);
    const scope = { id: "account_refresh", environment: {}, workdir: temporaryRoot,
      runtimeRoot: path.join(temporaryRoot, "helper-runtime"), stableContext: "Use supplied text only." };
    const options = { assistantScope: scope };
    const executionProfile = sourceExplanationHelperProfile();
    const created = await controller.createConversation(scope.id, { ephemeral: true, executionProfile }, options);
    assert.equal(created.ok, true, JSON.stringify(created));
    const input = { ephemeral: true, conversationId: created.conversationId, executionProfile, message: "Answer",
      outputSchema: sourceExplanationOutputSchema() };
    const started = await controller.startConversationTurn(scope.id, input, options);
    assert.equal(started.ok, true, JSON.stringify(started));
    const pending = controller.waitForConversationTurn(scope.id, { ...input, runId: started.runId }, options);
    captures.runtimeInfo.authStateSignature = `v1:${"c".repeat(24)}`;
    completeDetachedTurn(subscribers, { text: '{"answer":"The same account still owns this reply."}',
      threadId: created.conversationId, turnId: started.runId });
    const result = await pending;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.rawText, '{"answer":"The same account still owns this reply."}');
    assert.equal(result.status, "completed");
    assert.deepEqual(captures.interrupts, []);
    assert.equal((await controller.deleteConversation(scope.id, input, options)).ok, true);
  });
});

test("scoped Codex helpers require an authoritative account identity before Send", async () => {
  for (const accountIdentitySignature of ["", "not-an-account-signature"]) {
    await withConversationController(async ({ captures, controller, temporaryRoot }) => {
      controller = throughCommonScopedConversation(controller);
      const scope = { id: "account_required", environment: {}, workdir: temporaryRoot,
        runtimeRoot: path.join(temporaryRoot, "helper-runtime"), stableContext: "Use supplied text only." };
      const options = { assistantScope: scope };
      const executionProfile = sourceExplanationHelperProfile();
      const created = await controller.createConversation(scope.id, { ephemeral: true, executionProfile }, options);
      assert.equal(created.ok, true, JSON.stringify(created));
      const input = { ephemeral: true, conversationId: created.conversationId, executionProfile, message: "Answer",
        outputSchema: sourceExplanationOutputSchema() };
      captures.runtimeInfo.accountIdentitySignature = accountIdentitySignature;
      const rejected = await controller.startConversationTurn(scope.id, input, options);
      assert.equal(rejected.ok, false, JSON.stringify(rejected));
      assert.equal(rejected.code, "vibe64_codex_helper_ownership_blocked");
      assert.match(rejected.error, /stable selected-account identity/u);
      assert.deepEqual(captures.turns, []);
      assert.equal((await controller.readConversation(scope.id, input, options)).status, "ready");
      captures.runtimeInfo.accountIdentitySignature = TEST_ACCOUNT_IDENTITY_SIGNATURE;
      assert.equal((await controller.deleteConversation(scope.id, input, options)).ok, true);
    });
  }
});

test("scoped Codex completion keeps admission busy and cannot overwrite Stop during its account check", { timeout: 10_000 }, async () => {
  await withConversationController(async ({ captures, controller, subscribers, temporaryRoot }) => {
    controller = throughCommonScopedConversation(controller);
    const scope = { id: "account_completion_stop", environment: {}, workdir: temporaryRoot,
      runtimeRoot: path.join(temporaryRoot, "helper-runtime"), stableContext: "Use supplied text only." };
    const options = { assistantScope: scope };
    const executionProfile = sourceExplanationHelperProfile();
    const created = await controller.createConversation(scope.id, { ephemeral: true, executionProfile }, options);
    assert.equal(created.ok, true, JSON.stringify(created));
    const input = { ephemeral: true, conversationId: created.conversationId, executionProfile, message: "Answer",
      messageId: "first-account-check", outputSchema: sourceExplanationOutputSchema() };
    const started = await controller.startConversationTurn(scope.id, input, options);
    assert.equal(started.ok, true, JSON.stringify(started));
    const pending = controller.waitForConversationTurn(scope.id, { ...input, runId: started.runId }, options);
    const hold = createDeterministicHold();
    captures.currentRuntimeInfoWait = hold.wait;
    captures.onCurrentRuntimeInfo = () => hold.enter();
    try {
      completeDetachedTurn(subscribers, { text: '{"answer":"This late result must not revive the stopped turn."}',
        threadId: created.conversationId, turnId: started.runId });
      await hold.entered;
      const validating = await controller.readConversation(scope.id, input, options);
      assert.equal(validating.status, "inProgress");
      assert.equal(validating.rawText, "");
      const blocked = await controller.startConversationTurn(scope.id, { ...input,
        message: "A different request", messageId: "second-account-check" }, options);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "vibe64_temporary_conversation_turn_active");
      assert.equal(captures.turns.length, 1);
      const stopped = await controller.stopConversation(scope.id, { ...input, runId: started.runId }, options);
      assert.equal(stopped.ok, true, JSON.stringify(stopped));
      assert.deepEqual(captures.interrupts, [{ threadId: created.conversationId, turnId: started.runId }]);
      assert.equal((await controller.readConversation(scope.id, input, options)).status, "interrupted");
      hold.release();
      const rejected = await pending;
      assert.equal(rejected.ok, false, JSON.stringify(rejected));
      assert.match(rejected.error, /scoped helper turn is unavailable/u);
      const current = await controller.readConversation(scope.id, input, options);
      assert.equal(current.status, "interrupted");
      assert.equal(current.runId, started.runId);
      assert.equal(current.rawText, "");
      assert.equal(current.message, "");
      assert.equal(captures.interrupts.length, 1, "settling the late result must not issue another Stop");
    } finally {
      captures.currentRuntimeInfoWait = null;
      captures.onCurrentRuntimeInfo = null;
      hold.release();
      await pending;
    }
    assert.equal((await controller.deleteConversation(scope.id, input, options)).ok, true);
  });
});

test("scoped Codex helper cleanup after a restart deletes its captured native thread", async () => {
  await withConversationController(async ({ captures, controller, projectService, temporaryRoot }) => {
    controller = throughCommonScopedConversation(controller);
    const scope = { id: "restart_job", environment: {}, workdir: temporaryRoot, runtimeRoot: path.join(temporaryRoot, "helper-runtime"),
      stableContext: "Use supplied text only." };
    const options = { assistantScope: scope };
    const executionProfile = sourceExplanationHelperProfile();
    const created = await controller.createConversation(scope.id, { ephemeral: true, executionProfile }, options);
    assert.equal(created.ok, true, JSON.stringify(created));
    const after = restartedCaptures(captures);
    const restarted = throughCommonScopedConversation(createRestartedController({ captures: after, projectService }));
    after.failDeletes = 1;
    const input = { ephemeral: true, executionProfile, conversationId: created.conversationId };
    const failed = await restarted.deleteConversation(scope.id, input, options);
    assert.equal(failed.ok, false);
    assert.equal(after.stopRuntimes, 0, "failed cleanup retains the runtime for retry");
    const retried = await restarted.deleteConversation(scope.id, input, options);
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.deepEqual(after.deletes, [created.conversationId, created.conversationId]);
    await controller.deleteConversation(scope.id, input, options);
  });
});

test("non-project ephemeral deletion requires verified Codex runtime exit and can retry", async () => {
  await withConversationController(async ({ captures, controller, temporaryRoot }) => {
    const workdir = path.join(temporaryRoot, "system-repair-retry-workdir");
    const runtimeRoot = path.join(temporaryRoot, "system-repair-retry-runtime");
    await Promise.all([
      mkdir(workdir, { recursive: true }),
      mkdir(runtimeRoot, { recursive: true })
    ]);
    const assistantScope = {
      environment: {},
      id: "system_repair_retry",
      runtimeRoot,
      stableContext: "Trusted bounded host snapshot.",
      workdir
    };
    const options = { assistantScope };
    const conversation = await controller.createConversation(assistantScope.id, {
      ephemeral: true
    }, options);

    captures.stopRuntimeResult = { stopped: false };
    await assert.rejects(
      controller.deleteConversation(assistantScope.id, {
        conversationId: conversation.conversationId,
        ephemeral: true
      }, options),
      /process exit could not be verified/u
    );

    captures.stopRuntimeResult = { stopped: true };
    const retried = await controller.deleteConversation(assistantScope.id, {
      conversationId: conversation.conversationId,
      ephemeral: true
    }, options);
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.providerExit.stopped, true);
    assert.equal(captures.stopRuntimes, 2);
  });
});

test("temporary turns remain active for renewal until completion", async () => {
  await withConversationController(async ({ controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });

    assert.equal(await controller.hasActiveTemporaryConversation("session-1"), false);
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Fix the focused issue.",
    });

    assert.equal(turn.ok, true, JSON.stringify(turn));
    assert.equal(await controller.hasActiveTemporaryConversation("session-1"), true);

    emitCodexNotification(subscribers, codexEvent({
      message: "The focused issue is fixed.",
      phase: "final_answer"
    }));
    emitCodexNotification(subscribers, turnCompleted());
    await flushPromises();
    assert.equal(await controller.hasActiveTemporaryConversation("session-1"), false);
  });
});

test("temporary turns remain active past the helper deadline and accept their eventual result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    await withConversationController(async ({ controller, subscribers }) => {
      const conversation = await controller.createConversation("session-1", { ephemeral: true });
      await controller.startConversationTurn("session-1", {
        conversationId: conversation.conversationId,
        ephemeral: true,
        message: "Carefully repair this conflict.",
      });
      t.mock.timers.tick(180_001);
      await flushPromises();
      const working = await controller.readConversation("session-1", {
        conversationId: conversation.conversationId
      });
      assert.equal(working.status, "inProgress", JSON.stringify(working));
      assert.equal(await controller.hasActiveTemporaryConversation("session-1"), true);
      emitCodexNotification(subscribers, codexEvent({ message: "Checking the actual repair." }));
      t.mock.timers.tick(180_001);
      emitCodexNotification(subscribers, codexEvent({
        message: "The repair is ready to verify.", phase: "final_answer"
      }));
      emitCodexNotification(subscribers, turnCompleted());
      await flushPromises();
      const completed = await controller.readConversation("session-1", {
        conversationId: conversation.conversationId
      });
      assert.equal(completed.status, "completed");
      assert.equal(completed.message, "The repair is ready to verify.");
      assert.equal(await controller.hasActiveTemporaryConversation("session-1"), false);
    });
  } finally {
    t.mock.timers.reset();
  }
});

for (const failure of ["disconnect", "replacement"]) {
  test(`temporary turns release their watcher after a provider ${failure}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      await withConversationController(async ({ captures, controller, subscribers }) => {
        const conversation = await controller.createConversation("session-1", { ephemeral: true });
        await controller.startConversationTurn("session-1", {
          conversationId: conversation.conversationId,
          ephemeral: true,
          message: "Repair this conflict.",
        });
        if (failure === "disconnect") captures.connected = false;
        else captures.connectionGeneration += 1;
        t.mock.timers.tick(1000);
        await flushPromises();
        const failed = await controller.readConversation("session-1", {
          conversationId: conversation.conversationId
        });
        assert.equal(failed.status, "failed");
        assert.match(failed.error, /Connection to Codex was lost/u);
        assert.equal(await controller.hasActiveTemporaryConversation("session-1"), false);
        emitCodexNotification(subscribers, codexEvent({ message: "Late obsolete response.", phase: "final_answer" }));
        emitCodexNotification(subscribers, turnCompleted());
        await flushPromises();
        assert.equal((await controller.readConversation("session-1", {
          conversationId: conversation.conversationId
        })).status, "failed");
      });
    } finally {
      t.mock.timers.reset();
    }
  });
}

async function startTemporaryRepair(controller) {
  const conversation = await controller.createConversation("session-1", { ephemeral: true });
  const turn = await controller.startConversationTurn("session-1", {
    conversationId: conversation.conversationId,
    ephemeral: true,
    message: "Repair this conflict.",
  });
  return { conversationId: conversation.conversationId, runId: turn.runId, ephemeral: true };
}

test("temporary repair remains active until Codex confirms the interrupt", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const input = await startTemporaryRepair(controller);
    const hold = createDeterministicHold();
    captures.interruptHold = hold;
    let settled = false;
    const stopping = controller.stopConversation("session-1", input).then((result) => {
      settled = true;
      return result;
    });
    try {
      await hold.entered;
      assert.equal(settled, false);
      assert.equal(await controller.hasActiveTemporaryConversation("session-1"), true);
      assert.equal((await controller.readConversation("session-1", input)).status, "inProgress");
      const blocked = await controller.startConversationTurn("session-1", {
        conversationId: input.conversationId, ephemeral: true, message: "Start another repair."
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "vibe64_temporary_conversation_turn_active");
      hold.release();
      assert.equal((await stopping).ok, true);
      assert.equal(await controller.hasActiveTemporaryConversation("session-1"), false);
      assert.equal((await controller.readConversation("session-1", input)).status, "interrupted");
    } finally {
      hold.release();
      await stopping;
    }
  });
});

test("stopping and closing a partial repair preserves the Git index, HEAD, and existing local work", async () => {
  await withConversationController(async ({ controller, session }) => {
    const sourcePath = session.metadata.source_path;
    const git = (...args) => execFileSync("git", args, { cwd: sourcePath, encoding: "utf8" });
    git("init", "--quiet");
    const document = path.join(sourcePath, "document.md");
    await writeFile(document, "Saved document.\n");
    git("add", "document.md");
    git("-c", "user.name=Repair test", "-c", "user.email=repair@example.test", "commit", "--quiet", "-m", "Initial document");
    await writeFile(document, "Earlier staged work.\n");
    git("add", "document.md");
    await writeFile(document, "Earlier staged work.\nEarlier unstaged work.\n");
    await writeFile(path.join(sourcePath, "notes.txt"), "Earlier untracked work.\n");
    const headBefore = git("rev-parse", "HEAD");
    const indexBefore = await readFile(path.join(sourcePath, ".git", "index"));
    const input = await startTemporaryRepair(controller);
    const partial = "Earlier staged work.\nEarlier unstaged work.\nPartial repair still needs review.\n";
    await writeFile(document, partial);
    assert.equal((await controller.stopConversation("session-1", input)).ok, true);
    assert.equal((await controller.deleteConversation("session-1", input)).ok, true);
    assert.equal(git("rev-parse", "HEAD"), headBefore);
    assert.deepEqual(await readFile(path.join(sourcePath, ".git", "index")), indexBefore);
    assert.equal(await readFile(document, "utf8"), partial);
    assert.equal(await readFile(path.join(sourcePath, "notes.txt"), "utf8"), "Earlier untracked work.\n");
    assert.equal(git("ls-files", "--unmerged"), "");
    assert.equal(git("show", "HEAD:document.md"), "Saved document.\n");
  });
});

for (const operation of ["stop", "delete"]) {
  test(`failed temporary ${operation} retains the active repair for retry`, async () => {
    await withConversationController(async ({ captures, controller, subscribers }) => {
      const input = await startTemporaryRepair(controller);
      captures[operation === "stop" ? "failInterrupts" : "failDeletes"] = 1;
      const failed = await controller[`${operation}Conversation`]("session-1", input);
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.equal(await controller.hasActiveTemporaryConversation("session-1"), true);
      emitCodexNotification(subscribers, codexEvent({ message: "Still inspecting the conflict." }));
      await flushPromises();
      const working = await controller.readConversation("session-1", input);
      assert.equal(working.status, "inProgress", JSON.stringify(working));
      assert.equal(working.conversationExpired, undefined);
      assert.ok(working.progressUpdates.some((update) => update.text === "Still inspecting the conflict."));
      const retried = await controller[`${operation}Conversation`]("session-1", input);
      assert.equal(retried.ok, true, JSON.stringify(retried));
      assert.equal(await controller.hasActiveTemporaryConversation("session-1"), false);
    });
  });
}

test("long-running temporary turns still stop on request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    await withConversationController(async ({ controller }) => {
      const conversation = await controller.createConversation("session-1", { ephemeral: true });
      const turn = await controller.startConversationTurn("session-1", {
        conversationId: conversation.conversationId,
        ephemeral: true,
        message: "Repair this conflict.",
      });
      t.mock.timers.tick(180_001);
      assert.equal((await controller.stopConversation("session-1", {
        conversationId: conversation.conversationId, runId: turn.runId, ephemeral: true
      })).ok, true);
      await flushPromises();
      assert.equal((await controller.readConversation("session-1", {
        conversationId: conversation.conversationId
      })).status, "interrupted");
      assert.equal(await controller.hasActiveTemporaryConversation("session-1"), false);
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("temporary conversation retries reuse the accepted provider turn", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const input = {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Explain this conflict.",
      messageId: "message_temporary_test"
    };

    const first = await controller.startConversationTurn("session-1", input);
    const retried = await controller.startConversationTurn("session-1", input);

    assert.equal(first.runId, "turn-1");
    assert.equal(retried.runId, "turn-1");
    assert.equal(retried.messageId, input.messageId);
    assert.equal(calls.filter(([kind]) => kind === "turn").length, 1);
  });
});

test("persistent conversations still resume their saved rollout before a turn", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const conversation = await controller.createConversation("session-1");
    assert.equal(conversation.ok, true, JSON.stringify(conversation));

    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Continue."
    });

    assert.equal(turn.ok, true);
    assert.deepEqual(calls.filter(([kind]) => kind === "resume"), [
      ["resume", "conversation-1"]
    ]);
  });
});

test("temporary conversations expose live progress and final text without reading ephemeral history", async () => {
  await withConversationController(async ({ calls, controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Explain this conflict."
    });

    emitCodexNotification(subscribers, codexEvent({
      message: "Inspecting the conflicting changes."
    }));
    const working = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      runId: turn.runId
    });
    assert.equal(working.status, "inProgress");
    assert.deepEqual(working.progressUpdates, [{
      id: "progress:1",
      text: "Inspecting the conflicting changes."
    }]);

    emitCodexNotification(subscribers, codexEvent({
      message: "The conflict is safe to resolve.",
      phase: "final_answer"
    }));
    emitCodexNotification(subscribers, turnCompleted());
    await flushPromises();

    const completed = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      runId: turn.runId
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.message, "The conflict is safe to resolve.");
    assert.equal(calls.filter(([kind]) => kind === "read").length, 0);
  });
});

test("temporary conversations expose the human message from structured progress", async () => {
  await withConversationController(async ({ controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Resolve this conflict."
    });

    emitCodexNotification(subscribers, codexEvent({
      message: JSON.stringify({
        kind: "continue",
        message: "Comparing both intended changes.",
        report: ""
      })
    }));
    const working = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      runId: turn.runId
    });

    assert.deepEqual(working.progressUpdates, [{
      id: "progress:1",
      text: "Comparing both intended changes."
    }]);
  });
});

test("an expired temporary conversation never falls back to persistent thread history", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const result = await controller.readConversation("session-1", {
      conversationId: "expired-temporary-conversation",
      ephemeral: true,
      runId: "expired-turn"
    });

    assert.equal(result.ok, true);
    assert.equal(result.conversationExpired, true);
    assert.equal(result.status, "failed");
    assert.equal(calls.filter(([kind]) => kind === "read").length, 0);
  });
});

test("temporary conversations accept the final answer after the completion notification", async () => {
  await withConversationController(async ({ controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Explain this conflict."
    });

    emitCodexNotification(subscribers, turnCompleted());
    emitCodexNotification(subscribers, codexEvent({
      message: "The answer arrived safely.",
      phase: "final_answer"
    }));
    await flushPromises();

    const completed = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      runId: turn.runId
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.message, "The answer arrived safely.");
  });
});

test("helper discovery, overlapping turns and cleanup inspect the environment without preparing it", async () => {
  await withConversationController(async ({ captures, controller, projectService, session, subscribers }) => {
    captures.uniqueThreadIds = true;
    projectService.projectExecutionEnvironment = () => {
      assert.fail("Helper requests must not prepare project resources or environment files.");
    };
    await controller.executionProfileModelCatalog(session.sessionId);
    const input = {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Explain this bounded excerpt."
    };
    const first = controller.runDetachedChatTurn(session.sessionId, input);
    await waitForCapturedTurns(captures, 1);
    const second = controller.runDetachedChatTurn(session.sessionId, input);
    await waitForCapturedTurns(captures, 2);
    const namespace = codexTerminalNamespace(session.sessionId);
    assert.equal(freezeTerminalNamespaceAdmission(namespace, {
      owner: "session-renewal:overlapping-helpers"
    }).code, "terminal_admission_busy");
    assert.equal(captures.providerOptions.length, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "First." }) });
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Second." }),
      threadId: "conversation-2",
      turnId: "turn-2"
    });
    const results = await Promise.all([first, second]);
    assert.equal(results.every((result) => result.ok), true, JSON.stringify(results));
    for (const result of results) {
      const deleted = await controller.deleteDetachedChatThread(session.sessionId, {
        executionProfile: input.executionProfile,
        threadId: result.threadId
      });
      assert.equal(deleted.ok, true, JSON.stringify(deleted));
    }
  });
});

test("helper detached turns apply the resolved Luna-low profile and strict tool isolation", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    projectRuntimeRoot,
    session,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const prompt = "Explain only this bounded source excerpt.";
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt,
      timeoutMs: 999_999
    });
    await waitForCapturedTurns(captures, 1);

    assert.equal(captures.providerOptions.length, 1);
    assert.equal(captures.providerOptions[0].executionMode, "");
    assert.equal(captures.providerOptions[0].runtimeInstanceId, "");
    assert.equal(captures.threads.length, 1);
    const threadSettings = captures.threads[0];
    assert.equal(threadSettings.allowProviderModelFallback, false);
    assert.equal(threadSettings.approvalPolicy, "never");
    assert.equal(threadSettings.model, "gpt-5.6-luna");
    assert.equal(threadSettings.sandbox, "read-only");
    assert.equal(threadSettings.threadSource, "vibe64-helper");
    assert.deepEqual(threadSettings.dynamicTools, []);
    assert.deepEqual(threadSettings.environments, []);
    assert.deepEqual(threadSettings.runtimeWorkspaceRoots, []);
    assert.deepEqual(threadSettings.selectedCapabilityRoots, []);
    assert.equal(threadSettings.config.model_reasoning_effort, "low");
    assert.equal(threadSettings.config.model_reasoning_summary, "none");
    assert.equal(threadSettings.config.features.shell_tool, false);
    assert.equal(threadSettings.config.features.plugins, false);
    assert.equal(threadSettings.config.features.apps, false);
    assert.equal(threadSettings.config.features.multi_agent, false);
    assert.equal(threadSettings.config.features.view_image, false);
    assert.deepEqual(threadSettings.config.mcp_servers, {
      "test.write-anywhere": {
        enabled: false
      }
    });
    assert.deepEqual(threadSettings.config.hooks, {
      state: {
        "test:write-hook": {
          enabled: false
        }
      }
    });
    assert.equal(captures.configReads.length, 2);
    assert.equal(captures.hookLists.length, 2);

    assert.equal(captures.turns[0].input, prompt);
    assert.deepEqual(captures.turns[0].settings, {
      approvalPolicy: "never",
      cwd: threadSettings.cwd,
      effort: "low",
      environments: [],
      model: "gpt-5.6-luna",
      outputSchema,
      runtimeWorkspaceRoots: [],
      sandboxPolicy: {
        networkAccess: false,
        type: "readOnly"
      },
      summary: "none"
    });

    emitCodexNotification(subscribers, turnTokenUsage({
      usage: {
        cachedInputTokens: 17,
        cacheWriteInputTokens: 3,
        inputTokens: 41,
        outputTokens: 11,
        reasoningOutputTokens: 5,
        totalTokens: 57
      }
    }));
    const rawText = JSON.stringify({ answer: "The source returns the active account." });
    completeDetachedTurn(subscribers, { text: rawText });
    const result = await pending;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.text, rawText);
    assert.equal(result.inputCharacters, prompt.length);
    assert.equal(result.outputCharacters, rawText.length);
    assert.deepEqual(result.usage, {
      cachedInputTokens: 17,
      cacheWriteInputTokens: 3,
      inputTokens: 41,
      outputTokens: 11,
      reasoningOutputTokens: 5,
      totalTokens: 57
    });
    const ownership = await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll();
    assert.equal(Object.hasOwn(session, "projectContextRoot"), false);
    assert.equal(ownership.records.length, 1);
    assert.equal(ownership.records[0].projectContextRoot, projectContextRoot);
  });
});

test("helper follow-ups resume only a controller-owned thread with the same profile", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create the first bounded explanation."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "First explanation." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    const followUpPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Answer one follow-up about that explanation.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(captures, 2);

    assert.equal(captures.threads.length, 1);
    assert.equal(captures.resumes.length, 1);
    assert.equal(captures.resumes[0].threadId, first.threadId);
    assert.equal(captures.resumes[0].settings.model, "gpt-5.6-luna");
    assert.equal(captures.resumes[0].settings.sandbox, "read-only");
    assert.equal(captures.resumes[0].settings.config.model_reasoning_effort, "low");
    assert.equal(captures.resumes[0].settings.config.model_reasoning_summary, "none");
    assert.equal(captures.resumes[0].settings.config.features.shell_tool, false);
    assert.deepEqual(captures.resumes[0].settings.config.mcp_servers, {
      "test.write-anywhere": {
        enabled: false
      }
    });
    assert.equal(captures.configReads.length, 4);
    assert.equal(captures.hookLists.length, 4);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Follow-up explanation." }),
      turnId: "turn-2"
    });
    const followUp = await followUpPending;
    assert.equal(followUp.ok, true, JSON.stringify(followUp));
    assert.equal(followUp.threadId, first.threadId);

    const arbitrary = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Try an arbitrary thread.",
      threadId: "not-controller-owned"
    });
    assert.equal(arbitrary.ok, false);
    assert.equal(arbitrary.code, "vibe64_codex_helper_thread_unavailable");
    assert.equal(captures.resumes.length, 1);

    const drifted = await controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile({
        revision: "codex-helper-luna-low-v3"
      }),
      outputSchema,
      prompt: "Try profile drift.",
      threadId: first.threadId
    });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.code, "vibe64_codex_helper_thread_unavailable");
    assert.equal(captures.resumes.length, 1);
  });
});

test("concurrent helper follow-ups admit exactly one turn for an owned thread", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const initialPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create one reusable helper thread."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Initial answer." })
    });
    const initial = await initialPending;
    assert.equal(initial.ok, true);

    const followUps = ["First concurrent follow-up.", "Second concurrent follow-up."].map(
      (prompt) => controller.runDetachedChatTurn("session-1", {
        executionProfile,
        outputSchema,
        prompt,
        threadId: initial.threadId
      })
    );
    await waitForCapturedTurns(captures, 2);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Only one follow-up was admitted." }),
      turnId: "turn-2"
    });
    const results = await Promise.all(followUps);
    assert.equal(results.filter(({ ok }) => ok === true).length, 1);
    assert.equal(results.filter(({ code }) => (
      code === "vibe64_codex_helper_thread_unavailable"
    )).length, 1);
    assert.equal(captures.resumes.length, 1);
  });
});

test("helper detached turns reject oversized raw output and retire the thread", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile({
      limits: {
        maxOutputCharacters: 64
      }
    });
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(8),
      prompt: "Return one tiny explanation."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: "x".repeat(65)
    });
    const result = await pending;

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_agent_execution_profile_unbounded");
    assert.match(result.error, /exceeds the resolved output limit/u);
    assert.deepEqual(captures.deletes, ["conversation-1"]);

    const retired = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(8),
      prompt: "Do not revive the rejected thread.",
      threadId: "conversation-1"
    });
    assert.equal(retired.ok, false);
    assert.equal(retired.code, "vibe64_codex_helper_thread_unavailable");
    assert.equal(captures.resumes.length, 0);
  });
});

test("a delayed restore cannot revive helper ownership retired after its ledger read", async () => {
  const restoreRead = createDeterministicHold();
  let pauseNextRead = false;
  const codexHelperThreadLedgerFactory = ({ projectRuntimeRoot }) => {
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    return Object.freeze({
      ...ledger,
      async readAll() {
        const listed = await ledger.readAll();
        if (pauseNextRead) {
          pauseNextRead = false;
          restoreRead.enter();
          await restoreRead.wait;
        }
        return listed;
      }
    });
  };

  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile({
      limits: {
        maxOutputCharacters: 64
      }
    });
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(8),
      prompt: "Return one tiny explanation while ownership is restored."
    });
    await waitForCapturedTurns(captures, 1);

    pauseNextRead = true;
    const restoring = controller.executionProfileModelCatalog("session-1");
    await restoreRead.entered;
    try {
      completeDetachedTurn(subscribers, {
        text: "x".repeat(65)
      });
      const failed = await pending;
      assert.equal(failed.ok, false);
      assert.equal(failed.code, "vibe64_agent_execution_profile_unbounded");
      assert.deepEqual(captures.deletes, ["conversation-1"]);
      assert.deepEqual(
        await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll(),
        { failures: [], records: [] }
      );
    } finally {
      restoreRead.release();
    }

    assert.equal((await restoring).data[0].model, "gpt-5.6-luna");
    await controller.closeAllForSession("session-1");
    assert.deepEqual(captures.deletes, ["conversation-1"]);
  }, { codexHelperThreadLedgerFactory });
});

test("helper detached turn timeout is clamped to the resolved profile", {
  concurrency: false
}, async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"]
  });
  try {
    await withConversationController(async ({ captures, controller }) => {
      const pending = controller.runDetachedChatTurn("session-1", {
        executionProfile: sourceExplanationHelperProfile({
          limits: {
            timeoutMs: 25
          }
        }),
        outputSchema: sourceExplanationOutputSchema(),
        prompt: "Time-bound this explanation.",
        timeoutMs: 10_000
      });
      void pending.catch(() => null);
      await waitForCapturedTurns(captures, 1);

      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      t.mock.timers.tick(24);
      await flushPromises();
      assert.equal(settled, false);

      t.mock.timers.tick(1);
      const result = await pending;
      assert.equal(result.ok, false);
      assert.match(result.error, /Timed out waiting for Codex app-server response/u);
      assert.deepEqual(captures.deletes, ["conversation-1"]);
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("interactive detached turns retain their existing writable settings and response shape", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      prompt: "Discuss this source normally."
    });
    await waitForCapturedTurns(captures, 1);

    assert.equal(captures.threads.length, 1);
    assert.equal(captures.threads[0].sandbox, "danger-full-access");
    assert.equal("allowProviderModelFallback" in captures.threads[0], false);
    assert.deepEqual(captures.threads[0].config, {
      model_reasoning_effort: "xhigh", model_reasoning_summary: "concise"
    });
    assert.equal("dynamicTools" in captures.threads[0], false);
    assert.deepEqual(captures.turns[0].settings.sandboxPolicy, {
      networkAccess: "enabled",
      type: "externalSandbox"
    });
    assert.equal(captures.turns[0].settings.summary, "concise");
    assert.equal(captures.configReads.length, 0);
    assert.equal(captures.hookLists.length, 1);

    emitCodexNotification(subscribers, turnTokenUsage({
      usage: {
        inputTokens: 20,
        outputTokens: 4,
        totalTokens: 24
      }
    }));
    completeDetachedTurn(subscribers, {
      text: "The normal interactive response."
    });
    const result = await pending;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.text, "The normal interactive response.");
    assert.equal("usage" in result, false);
    assert.equal("inputCharacters" in result, false);
    assert.equal("outputCharacters" in result, false);
    assert.deepEqual(captures.deletes, []);
  });
});

test("session shutdown interrupts and deletes an active helper thread before stopping its provider", async () => {
  await withConversationController(async ({
    calls,
    captures,
    controller,
    simulateControllerCrash,
    subscribers
  }) => {
    captures.interruptCompletesTurns = true;
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Keep this bounded turn active until shutdown."
    });
    await waitForCapturedTurns(captures, 1);
    await flushPromises();

    await controller.closeAllForSession("session-1");
    simulateControllerCrash();

    const interruptIndex = calls.findIndex(([operation]) => operation === "interrupt");
    const deleteIndex = calls.findIndex(([operation]) => operation === "delete");
    const stopIndex = calls.findIndex(([operation]) => operation === "stopRuntime");
    assert.ok(interruptIndex >= 0);
    assert.ok(deleteIndex > interruptIndex);
    assert.ok(stopIndex > deleteIndex);
    assert.deepEqual(captures.interrupts, [{
      threadId: "conversation-1",
      turnId: "turn-1"
    }]);
    assert.equal(captures.stopRuntimes, 1);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Shutdown completed." })
    });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_helper_thread_unavailable");
  });
});

test("ordinary project dormancy close preserves interactive session process-exit proof", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };

    await controller.closeAllForSession(session.sessionId, {
      preserveProcessExitProof: true
    });

    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

test("ordinary runtime invalidation preserves interactive session process-exit proof", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const conversation = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };

    const invalidated = await controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });

    assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

test("ordinary runtime invalidation reports one failure for the shared Codex runtime", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const conversation = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");

    captures.stopRuntimeHandler = () => {
      const error = new Error("Shared Codex runtime stop failed.");
      error.code = "test_runtime_stop_failed";
      error.retryable = true;
      throw error;
    };

    const invalidated = await controller.invalidateAppServerRuntimes({
      reason: "account-changed"
    });
    assert.equal(invalidated.ok, false);
    assert.equal(invalidated.providerCount, 1);
    assert.equal(invalidated.stopped, 0);
    assert.equal(invalidated.results.length, 0);
    assert.deepEqual(invalidated.failed.map((failure) => ({
      code: failure.code,
      error: failure.error,
      retryable: failure.retryable
    })), [{
      code: "test_runtime_stop_failed",
      error: "Shared Codex runtime stop failed.",
      retryable: true
    }]);
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

test("account-wide Codex auth invalidation stops a pruned runtime without a selected project", async () => {
  await withAgentMessageController(async ({
    captures,
    controller,
    projectService,
    runtime,
    sessionId
  }) => {
    const prepared = await runWithProjectRequestContext({
      targetRoot: runtime.projectContextRoot
    }, () => controller.ensureThread(sessionId));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    const pruned = await controller.reconcileThreads([]);
    assert.equal(pruned.ok, true, JSON.stringify(pruned));
    assert.equal(captures.provider.closed, 1);
    assert.equal(captures.stopRuntimes, 0);

    const createRuntime = projectService.createRuntime;
    projectService.createRuntime = () => {
      const error = new Error("Choose a project before using project tools.");
      error.code = "vibe64_project_not_selected";
      throw error;
    };
    try {
      const invalidated = await controller.invalidateAppServerRuntimes({
        includeOwned: true,
        reason: "logout"
      });

      assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
      assert.equal(invalidated.providerCount, 1);
      assert.equal(invalidated.stopped, 1);
    } finally {
      projectService.createRuntime = createRuntime;
    }
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, {
      preserveProcessExitProof: true
    });
  });
});

test("auth turnover retires helper ownership when runtime removal wins the deletion race", async () => {
  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create a temporary thread before reconnecting."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Ready." }) });
    const first = await pending;
    assert.equal(first.ok, true, JSON.stringify(first));
    captures.failDeletes = 100;
    captures.stopRuntimeHandler = async () => {
      await rm(captures.runtimeInfo.runtimeDir, { recursive: true, force: true });
      return { processExitVerified: true, runtimeDirRemoved: true, stopped: true };
    };

    const invalidated = await controller.invalidateAppServerRuntimes({
      includeOwned: true,
      reason: "auth-session-exited"
    });
    assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    assert.deepEqual((await ledger.readAll()).records, []);
    const stale = await controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Never resume the retired thread.",
      threadId: first.threadId
    });
    assert.equal(stale.code, "vibe64_codex_helper_thread_unavailable");
    captures.failDeletes = 0;
    const next = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Continue after reconnecting without restarting Vibe64."
    });
    await waitForCapturedTurns(captures, 2);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Recovered." }), turnId: "turn-2"
    });
    assert.equal((await next).ok, true);
  });
});

test("auth turnover retries stale in-memory helper ownership after an earlier runtime removal", async () => {
  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create ownership retained by an earlier failed cleanup."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Ready." }) });
    assert.equal((await pending).ok, true);
    await rm(captures.runtimeInfo.runtimeDir, { recursive: true, force: true });
    captures.failDeletes = 100;
    const invalidated = await controller.invalidateAppServerRuntimes({
      includeOwned: true, reason: "auth-session-status"
    });
    assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
    assert.deepEqual(captures.deletes, []);
    assert.deepEqual((await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll()).records, []);
  });
});

test("auth turnover defers shared helper cleanup after verified exit and retries it on the next connection", async () => {
  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Keep cleanup recoverable across logout."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Ready." }) });
    const first = await pending;
    assert.equal(first.ok, true);
    captures.failDeletes = 100;
    captures.stopRuntimeResult = {
      processExitVerified: true, stopped: true, runtimeDirPreserved: true, runtimeDirRemoved: false
    };

    const invalidated = await controller.invalidateAppServerRuntimes({ includeOwned: true, reason: "logout" });
    captures.failDeletes = 0;
    assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
    assert.equal(invalidated.stopped, 1);
    assert.deepEqual(invalidated.results[0].pendingThreadCleanup.map((failure) => failure.threadId), [first.threadId]);
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    const retained = (await ledger.readAll()).records;
    assert.equal(retained.length, 1);
    assert.equal(retained[0].lifecycle, "cleanup_required");
    const retry = await controller.invalidateAppServerRuntimes({ includeOwned: true, reason: "auth-session-status" });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.providerCount, 0, "A stopped provider cannot block the next account transition");
    assert.deepEqual((await ledger.readAll()).records, retained, "Account refresh must preserve helper history ownership");

    captures.runtimeInfo.accountIdentitySignature = TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE;
    await controller.executionProfileModelCatalog("session-1");
    assert.deepEqual((await ledger.readAll()).records, []);
    assert.equal(captures.deletes.at(-1), first.threadId);
    assert.equal(captures.stopRuntimes, 1, "Cleanup must not stop the replacement account's runtime");
    assert.deepEqual(captures.resumes, []);
    assert.equal(captures.turns.length, 1, "Cleanup must not resume the previous account's work");
  });
});

test("auth turnover still fails when deferred helper cleanup cannot be persisted", async () => {
  let failWrite = false;
  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Preserve ownership if cleanup cannot be recorded."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Ready." }) });
    assert.equal((await pending).ok, true);
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    const retained = (await ledger.readAll()).records;
    failWrite = true;
    captures.stopRuntimeResult = {
      processExitVerified: true, stopped: true, runtimeDirPreserved: true, runtimeDirRemoved: false
    };
    const failed = await controller.invalidateAppServerRuntimes({ includeOwned: true, reason: "logout" });
    failWrite = false;
    assert.equal(failed.ok, false);
    assert.equal(failed.failed[0].code, "vibe64_codex_helper_thread_cleanup_failed");
    assert.deepEqual((await ledger.readAll()).records, retained);
    const retry = await controller.invalidateAppServerRuntimes({ includeOwned: true, reason: "auth-session-status" });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.deepEqual((await ledger.readAll()).records, []);
  }, {
    codexHelperThreadLedgerFactory(options) {
      const ledger = createCodexHelperThreadLedger(options);
      return {
        ...ledger,
        async write(record, options) {
          if (failWrite) throw new Error("Ownership storage temporarily unavailable.");
          return ledger.write(record, options);
        }
      };
    }
  });
});

test("auth turnover preserves helper ownership when thread deletion and runtime removal are unproven", async () => {
  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Retain cleanup evidence until removal is proven."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Ready." }) });
    assert.equal((await pending).ok, true);
    captures.failDeletes = 100;
    captures.stopRuntimeResult = { processExitVerified: true, stopped: true, runtimeDirRemoved: false };
    const invalidated = await controller.invalidateAppServerRuntimes({
      includeOwned: true, reason: "auth-session-exited"
    });
    assert.equal(invalidated.ok, false);
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    assert.equal((await ledger.readAll()).records.length, 1);
    captures.failDeletes = 0;
    const retry = await controller.invalidateAppServerRuntimes({
      includeOwned: true, reason: "auth-session-status"
    });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.deepEqual((await ledger.readAll()).records, []);
  });
});

test("auth turnover retries ledger removal after the owned runtime has already stopped", async () => {
  let failRemoval = true;
  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Preserve the ownership record when its removal fails."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Ready." }) });
    assert.equal((await pending).ok, true);
    captures.failDeletes = 100;
    captures.stopRuntimeHandler = async () => {
      await rm(captures.runtimeInfo.runtimeDir, { recursive: true, force: true });
      return { processExitVerified: true, runtimeDirRemoved: true, stopped: true };
    };
    const input = { includeOwned: true, reason: "auth-session-status" };
    const failed = await controller.invalidateAppServerRuntimes(input);
    assert.equal(failed.ok, false);
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    assert.equal((await ledger.readAll()).records.length, 1);
    failRemoval = false;
    const recovered = await controller.invalidateAppServerRuntimes(input);
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.deepEqual((await ledger.readAll()).records, []);
  }, {
    codexHelperThreadLedgerFactory(options) {
      const ledger = createCodexHelperThreadLedger(options);
      return {
        ...ledger,
        async remove(record) {
          if (failRemoval) {
            throw new Error("Ownership storage temporarily unavailable.");
          }
          return ledger.remove(record);
        }
      };
    }
  });
});

test("account-wide Codex auth invalidation requires verified runtime exit", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => {
    const prepared = await runWithProjectRequestContext({
      targetRoot: runtime.projectContextRoot
    }, () => controller.ensureThread(sessionId));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    captures.stopRuntimeResult = {
      processExitVerified: false,
      runtimeDirRemoved: false,
      stopped: false
    };

    const invalidated = await controller.invalidateAppServerRuntimes({
      includeOwned: true,
      reason: "logout"
    });

    assert.equal(invalidated.ok, false, JSON.stringify(invalidated));
    assert.equal(invalidated.providerCount, 1);
    assert.equal(invalidated.stopped, 0);
    assert.equal(invalidated.failed[0].code, "vibe64_codex_runtime_exit_unverified");
    assert.equal(captures.stopRuntimes, 1);
  });
});

test("non-shutdown runtime invalidation keeps the controller reusable", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const first = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    const invalidated = await controller.invalidateAppServerRuntimes({
      reason: "account-changed"
    });
    assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
    assert.equal(captures.stopRuntimes, 1);

    const second = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(captures.providerOptions.length, 2);
  });
});

test("the shared Codex runtime stays workspace-wide while its thread keeps the session directory", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => {
    const prepared = await runWithProjectRequestContext({
      slug: "assistant-project",
      targetRoot: runtime.projectContextRoot
    }, () => controller.ensureThread(sessionId));

    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.deepEqual(captures.providerOptions[0].project, {});
    assert.deepEqual(captures.providerOptions[0].session, {});
    assert.equal(
      captures.threadStarts[0].cwd,
      (await runtime.getSession(sessionId)).metadata.source_path
    );
  });
});

test("server shutdown stops a pruned owned runtime once across duplicate callers", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => {
    const prepared = await runWithProjectRequestContext({
      targetRoot: runtime.projectContextRoot
    }, () => controller.ensureThread(sessionId));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(captures.provider.closed, 0);

    const pruned = await controller.reconcileThreads([]);
    assert.equal(pruned.ok, true, JSON.stringify(pruned));
    assert.equal(captures.provider.closed, 1);
    assert.equal(captures.stopRuntimes, 0);

    const [first, second] = await Promise.all([
      controller.invalidateAppServerRuntimes({ reason: "server-shutdown" }),
      controller.invalidateAppServerRuntimes({ reason: "server-shutdown" })
    ]);

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(second, first);
    assert.equal(first.providerCount, 1);
    assert.equal(first.stopped, 1);
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, {
      preserveProcessExitProof: true
    });
  });
});

test("server shutdown stops a runtime to unblock acquisition and rejects later acquisition", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const acquisitionHeld = createDeterministicHold();
    captures.onEnsureAvailable = () => acquisitionHeld.enter();
    captures.ensureAvailableWait = acquisitionHeld.wait;
    captures.stopRuntimeHandler = () => {
      acquisitionHeld.release();
      if (captures.stopRuntimes === 1) {
        return {
          processExitVerified: false,
          runtimeDirPreserved: false,
          stopped: false
        };
      }
      return {
        processExitVerified: true,
        runtimeDirPreserved: true,
        stopped: true
      };
    };

    const acquiring = controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    await acquisitionHeld.entered;
    const firstShutdown = controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    const duplicateShutdown = controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    const rejectedAcquisition = controller.createConversation(session.sessionId, {
      ephemeral: true
    });

    const [acquired, rejected, first, duplicate] = await Promise.all([
      acquiring,
      rejectedAcquisition,
      firstShutdown,
      duplicateShutdown
    ]);
    assert.equal(acquired.ok, false);
    assert.equal(acquired.code, "vibe64_server_stopping");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_server_stopping");
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(duplicate, first);
    assert.equal(captures.stopRuntimes, 2);
  });
});

test("server shutdown serializes with an owned runtime before metadata is published", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux process identity is required.");
    return;
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-owned-runtime-race-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `shutdown-race-${randomUUID()}`;
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "owned-runtime-race-session",
    "source"
  );
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true })
  ]);
  const session = {
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "owned-runtime-race-session"
  };
  const preMetadata = createDeterministicHold();
  let child = null;
  let runtimeDir = "";
  let stopRuntimeCalls = 0;
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory(providerOptions) {
      runtimeDir = providerOptions.runtimeDir;
      return {
        close() {},
        async ensureAvailable() {
          const lockDir = path.join(runtimeDir, "runtime.lock");
          await mkdir(lockDir, { recursive: true });
          await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
            createdAt: new Date().toISOString(),
            pid: process.pid
          })}\n`);
          const runtimeToken = randomUUID();
          const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
          child = spawn(process.execPath, [
            "-e",
            "setInterval(() => {}, 1000);"
          ], {
            detached: true,
            env: {
              ...process.env,
              VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
              VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
            },
            stdio: "ignore"
          });
          child.unref();
          const processIdentity = await exactProcessIdentity(
            child.pid,
            runtimeToken,
            commandHash
          );
          preMetadata.enter();
          await preMetadata.wait;
          await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({
            ...exactStoppedRuntimeMetadata(runtimeDir),
            pid: child.pid,
            processIdentity
          })}\n`);
          await rm(lockDir, { force: true, recursive: true });
        },
        async startThread() {
          return { id: "owned-runtime-race-conversation" };
        },
        async stopRuntime(options = {}) {
          stopRuntimeCalls += 1;
          const stopping = stopCodexAppServerRuntime({
            ...options,
            runtimeDir
          });
          await flushPromises();
          preMetadata.release();
          return stopping;
        }
      };
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return session;
          },
          projectContextRoot: temporaryRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectInspectionEnvironment() {
        return {
          VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
          VIBE64_WORKSPACE: "test"
        };
      },
      async readPromptHints() {
        return { ok: true, promptHints: true };
      }
    }
  });

  try {
    const acquiring = controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    await preMetadata.entered;
    assert.ok(child?.pid > 1);
    assert.doesNotThrow(() => process.kill(-child.pid, 0));

    const shutdown = await controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    const acquired = await acquiring;
    assert.equal(acquired.ok, false);
    assert.equal(acquired.code, "vibe64_server_stopping");
    assert.equal(shutdown.ok, true, JSON.stringify(shutdown));
    assert.equal(shutdown.providerCount, 1);
    assert.equal(shutdown.stopped, 1);
    assert.equal(stopRuntimeCalls, 1);
    assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
  } finally {
    preMetadata.release();
    if (runtimeDir) {
      await rm(path.join(runtimeDir, "runtime.lock"), { force: true, recursive: true });
      await stopCodexAppServerRuntime({ runtimeDir }).catch(() => null);
    }
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The verified shutdown path normally stops the exact process group.
      }
    }
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("server shutdown proves exit of the exact owned detached runtime", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux process identity is required.");
    return;
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-owned-runtime-shutdown-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `shutdown-${randomUUID()}`;
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "owned-runtime-session",
    "source"
  );
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true })
  ]);
  const session = {
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "owned-runtime-session"
  };
  let child = null;
  let runtimeDir = "";
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory(providerOptions) {
      runtimeDir = providerOptions.runtimeDir;
      return {
        close() {},
        async ensureAvailable() {
          await mkdir(runtimeDir, { recursive: true });
          const runtimeToken = randomUUID();
          const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
          child = spawn(process.execPath, [
            "-e",
            "setInterval(() => {}, 1000);"
          ], {
            detached: true,
            env: {
              ...process.env,
              VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
              VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
            },
            stdio: "ignore"
          });
          child.unref();
          await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({
            ...exactStoppedRuntimeMetadata(runtimeDir),
            pid: child.pid,
            processIdentity: await exactProcessIdentity(child.pid, runtimeToken, commandHash)
          })}\n`);
        },
        async startThread() {
          return { id: "owned-runtime-conversation" };
        },
        stopRuntime(options = {}) {
          return stopCodexAppServerRuntime({
            ...options,
            runtimeDir
          });
        }
      };
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return session;
          },
          projectContextRoot: temporaryRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectInspectionEnvironment() {
        return {
          VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
          VIBE64_WORKSPACE: "test"
        };
      },
      async readPromptHints() {
        return { ok: true, promptHints: true };
      }
    }
  });

  try {
    const conversation = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    assert.ok(child?.pid > 1);
    assert.doesNotThrow(() => process.kill(-child.pid, 0));

    const shutdown = await controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    assert.equal(shutdown.ok, true, JSON.stringify(shutdown));
    assert.equal(shutdown.providerCount, 1);
    assert.equal(shutdown.stopped, 1);
    assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
  } finally {
    if (runtimeDir) {
      await stopCodexAppServerRuntime({ runtimeDir }).catch(() => null);
    }
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The verified shutdown path normally stops the exact process group.
      }
    }
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("same raw session closes remain isolated across project request contexts", async () => {
  await withConversationController(async ({
    controller,
    projectService,
    simulateControllerCrash,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "alpha",
      sessionId
    );
    const beta = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "beta",
      sessionId
    );
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    const reads = { alpha: 0, beta: 0 };
    const holds = { alpha: null, beta: null };
    for (const fixture of fixtures.values()) {
      fixture.runtime.getSession = async () => {
        const slug = fixture.context.slug;
        reads[slug] += 1;
        const hold = holds[slug];
        if (hold) {
          holds[slug] = null;
          hold.enter();
          await hold.wait;
        }
        return fixture.session;
      };
    }
    projectService.createRuntime = () => {
      const slug = currentProjectRequestContext()?.slug;
      const fixture = fixtures.get(slug);
      assert.ok(fixture, `Missing scoped fixture for ${slug || "no project"}.`);
      return fixture.runtime;
    };
    projectService.createSessionStore = () => {
      const slug = currentProjectRequestContext()?.slug;
      return fixtures.get(slug)?.store;
    };

    const alphaHold = createDeterministicHold();
    holds.alpha = alphaHold;
    const alphaClose = runWithProjectRequestContext(
      alpha.context,
      () => controller.closeAllForSession(sessionId)
    );
    await alphaHold.entered;

    await runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    assert.equal(reads.alpha, 1);
    assert.ok(reads.beta > 0);

    const alphaReadsBeforeDuplicate = reads.alpha;
    const duplicateAlphaClose = runWithProjectRequestContext(
      alpha.context,
      () => controller.closeAllForSession(sessionId)
    );
    await flushPromises();
    assert.equal(reads.alpha, alphaReadsBeforeDuplicate);

    const betaHold = createDeterministicHold();
    holds.beta = betaHold;
    const secondBetaClose = runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    await betaHold.entered;

    alphaHold.release();
    await Promise.all([alphaClose, duplicateAlphaClose]);

    const betaReadsBeforeDuplicate = reads.beta;
    const duplicateBetaClose = runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    await flushPromises();
    assert.equal(reads.beta, betaReadsBeforeDuplicate);

    betaHold.release();
    await Promise.all([secondBetaClose, duplicateBetaClose]);
    simulateControllerCrash();
  });
});

test("same raw session delivery admission remains independent across project request contexts", {
  timeout: 3_000
}, async () => {
  await withConversationController(async ({
    controller,
    projectService,
    simulateControllerCrash,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(temporaryRoot, "alpha", sessionId);
    const beta = await managedProjectScopedSessionFixture(temporaryRoot, "beta", sessionId);
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    const holds = { alpha: null, beta: null };
    for (const fixture of fixtures.values()) {
      const readSession = fixture.runtime.getSession.bind(fixture.runtime);
      fixture.runtime.getSession = async () => {
        const slug = fixture.context.slug;
        const hold = holds[slug];
        if (hold) {
          holds[slug] = null;
          hold.enter();
          await hold.wait;
        }
        return readSession();
      };
    }
    projectService.createRuntime = () => {
      const fixture = fixtures.get(currentProjectRequestContext()?.slug);
      assert.ok(fixture);
      return fixture.runtime;
    };
    projectService.createSessionStore = () => {
      return fixtures.get(currentProjectRequestContext()?.slug)?.store;
    };

    const alphaMessageHold = createDeterministicHold();
    holds.alpha = alphaMessageHold;
    const alphaMessage = runWithProjectRequestContext(alpha.context, () => (
      controller.sendMessage(sessionId, {
        message: "Start alpha independently.",
        messageId: "same-message"
      })
    ));
    await alphaMessageHold.entered;
    const betaMessageHold = createDeterministicHold();
    holds.beta = betaMessageHold;
    const betaMessage = runWithProjectRequestContext(beta.context, () => (
      controller.sendMessage(sessionId, {
        message: "Start beta independently.",
        messageId: "same-message"
      })
    ));
    await betaMessageHold.entered;
    alphaMessageHold.release();
    betaMessageHold.release();
    assert.equal((await alphaMessage).ok, true);
    assert.equal((await betaMessage).ok, true);

    const alphaConversation = await runWithProjectRequestContext(
      alpha.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    const betaConversation = await runWithProjectRequestContext(
      beta.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    assert.equal(alphaConversation.conversationId, betaConversation.conversationId);

    const alphaTurnHold = createDeterministicHold();
    holds.alpha = alphaTurnHold;
    const alphaTurn = runWithProjectRequestContext(alpha.context, () => (
      controller.startConversationTurn(sessionId, {
        conversationId: alphaConversation.conversationId,
        ephemeral: true,
        message: "Run alpha Temporary AI independently.",
        messageId: "same-temporary-message"
      })
    ));
    await alphaTurnHold.entered;
    const betaTurnHold = createDeterministicHold();
    holds.beta = betaTurnHold;
    const betaTurn = runWithProjectRequestContext(beta.context, () => (
      controller.startConversationTurn(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true,
        message: "Run beta Temporary AI independently.",
        messageId: "same-temporary-message"
      })
    ));
    await betaTurnHold.entered;
    alphaTurnHold.release();
    betaTurnHold.release();
    assert.equal((await alphaTurn).ok, true);
    assert.equal((await betaTurn).ok, true);
    await Promise.all([
      runWithProjectRequestContext(alpha.context, async () => {
        await controller.stopConversation(sessionId, {
          conversationId: alphaConversation.conversationId,
          ephemeral: true,
          runId: (await alphaTurn).runId
        });
        await controller.deleteConversation(sessionId, {
          conversationId: alphaConversation.conversationId,
          ephemeral: true
        });
      }),
      runWithProjectRequestContext(beta.context, async () => {
        await controller.stopConversation(sessionId, {
          conversationId: betaConversation.conversationId,
          ephemeral: true,
          runId: (await betaTurn).runId
        });
        await controller.deleteConversation(sessionId, {
          conversationId: betaConversation.conversationId,
          ephemeral: true
        });
      })
    ]);
    simulateControllerCrash();
  });
});

test("renewal cleanup cannot observe or delete another project's Temporary AI state", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    simulateControllerCrash,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "alpha",
      sessionId
    );
    const beta = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "beta",
      sessionId
    );
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    projectService.createRuntime = () => {
      const slug = currentProjectRequestContext()?.slug;
      const fixture = fixtures.get(slug);
      assert.ok(fixture, `Missing scoped fixture for ${slug || "no project"}.`);
      return fixture.runtime;
    };
    projectService.createSessionStore = () => {
      const slug = currentProjectRequestContext()?.slug;
      return fixtures.get(slug)?.store;
    };

    const alphaConversation = await runWithProjectRequestContext(
      alpha.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    const betaConversation = await runWithProjectRequestContext(
      beta.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    assert.equal(alphaConversation.conversationId, betaConversation.conversationId);

    const betaTurn = await runWithProjectRequestContext(
      beta.context,
      () => controller.startConversationTurn(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true,
        message: "Keep beta Temporary AI active during alpha renewal cleanup."
      })
    );
    assert.equal(betaTurn.ok, true, JSON.stringify(betaTurn));
    assert.equal(await runWithProjectRequestContext(
      alpha.context,
      () => controller.hasActiveTemporaryConversation(sessionId)
    ), false);
    assert.equal(await runWithProjectRequestContext(
      beta.context,
      () => controller.hasActiveTemporaryConversation(sessionId)
    ), true);

    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };
    await runWithProjectRequestContext(alpha.context, () => (
      controller.closeAllForSession(sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId: "alpha-renewal",
          sourceSessionId: sessionId
        },
        runtime: alpha.runtime,
        session: alpha.session
      })
    ));
    assert.equal(captures.stopRuntimeProviderOptions.length, 0);

    const alphaAfterCleanup = await runWithProjectRequestContext(
      alpha.context,
      () => controller.readConversation(sessionId, {
        conversationId: alphaConversation.conversationId,
        ephemeral: true
      })
    );
    const betaAfterCleanup = await runWithProjectRequestContext(
      beta.context,
      () => controller.readConversation(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true
      })
    );
    assert.equal(alphaAfterCleanup.conversationExpired, true);
    assert.equal(betaAfterCleanup.conversationExpired, undefined);
    assert.equal(betaAfterCleanup.status, "inProgress");
    assert.equal(await runWithProjectRequestContext(
      beta.context,
      () => controller.hasActiveTemporaryConversation(sessionId)
    ), true);

    await runWithProjectRequestContext(
      beta.context,
      () => controller.stopConversation(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true,
        runId: betaTurn.runId
      })
    );
    await runWithProjectRequestContext(
      beta.context,
      () => controller.deleteConversation(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true
      })
    );
    simulateControllerCrash();
  });
});

test("renewal cleanup cannot drain another project's notification queue", {
  timeout: 3_000
}, async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    simulateControllerCrash,
    subscribers,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(temporaryRoot, "alpha", sessionId);
    const beta = await managedProjectScopedSessionFixture(temporaryRoot, "beta", sessionId);
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    const originalCreateRuntime = projectService.createRuntime.bind(projectService);
    projectService.createRuntime = () => {
      const fixture = fixtures.get(currentProjectRequestContext()?.slug);
      return fixture?.runtime || originalCreateRuntime();
    };
    projectService.createSessionStore = () => {
      return fixtures.get(currentProjectRequestContext()?.slug)?.store;
    };

    const betaMessage = await runWithProjectRequestContext(beta.context, () => (
      controller.sendMessage(sessionId, {
        message: "Keep beta active while alpha renews.",
        messageId: "beta-notification-owner"
      })
    ));
    assert.equal(betaMessage.ok, true, JSON.stringify(betaMessage));
    const betaSession = await beta.store.readSession(sessionId);
    const betaRun = betaSession.agentRuns.find(({ id }) => id === "codex_app_server");
    const betaThreadId = betaSession.metadata.agent_identity_conversation_id;
    const betaTurnId = betaRun?.providerTurnId;
    assert.ok(betaThreadId);
    assert.ok(betaTurnId);
    assert.ok(subscribers.size > 0);

    const notificationHold = createDeterministicHold();
    const betaNotificationStore = new Proxy(beta.store, {
      get(target, property) {
        if (property === "mutateSession") {
          return async (...args) => {
            notificationHold.enter();
            await notificationHold.wait;
            return target.mutateSession(...args);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    projectService.createSessionStore = () => {
      const slug = currentProjectRequestContext()?.slug;
      return slug === "beta" ? betaNotificationStore : fixtures.get(slug)?.store;
    };
    await runWithProjectRequestContext(beta.context, async () => {
      emitCodexNotification(subscribers, {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: betaThreadId,
          tokenUsage: {
            last: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15
            },
            modelContextWindow: 100,
            total: { totalTokens: 15 }
          },
          turnId: betaTurnId
        }
      });
    });
    await notificationHold.entered;

    await runWithProjectRequestContext(
      alpha.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };
    await runWithProjectRequestContext(alpha.context, () => (
      controller.closeAllForSession(sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId: "alpha-notification-renewal",
          sourceSessionId: sessionId
        },
        runtime: alpha.runtime,
        session: alpha.session
      })
    ));

    notificationHold.release();
    await runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    simulateControllerCrash();
  });
});

test("renewal cleanup cannot cancel another project's finalizing recovery timer", {
  concurrency: false,
  timeout: 3_000
}, async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  try {
    await withConversationController(async ({
      calls,
      captures,
      controller,
      projectService,
      simulateControllerCrash,
      subscribers,
      temporaryRoot
    }) => {
      const sessionId = "shared-session";
      const alpha = await managedProjectScopedSessionFixture(temporaryRoot, "alpha", sessionId);
      const beta = await managedProjectScopedSessionFixture(temporaryRoot, "beta", sessionId);
      const fixtures = new Map([
        [alpha.context.slug, alpha],
        [beta.context.slug, beta]
      ]);
      const originalCreateRuntime = projectService.createRuntime.bind(projectService);
      projectService.createRuntime = () => {
        const fixture = fixtures.get(currentProjectRequestContext()?.slug);
        return fixture?.runtime || originalCreateRuntime();
      };
      projectService.createSessionStore = () => {
        return fixtures.get(currentProjectRequestContext()?.slug)?.store;
      };

      const betaMessage = await runWithProjectRequestContext(beta.context, () => (
        controller.sendMessage(sessionId, {
          message: "Wait for beta finalization recovery.",
          messageId: "beta-finalizing-owner"
        })
      ));
      assert.equal(betaMessage.ok, true, JSON.stringify(betaMessage));
      const startedBeta = await beta.store.readSession(sessionId);
      const startedRun = startedBeta.agentRuns.find(({ id }) => id === "codex_app_server");
      const betaThreadId = startedBeta.metadata.agent_identity_conversation_id;
      const betaTurnId = startedRun?.providerTurnId;
      await runWithProjectRequestContext(beta.context, async () => {
        emitCodexNotification(subscribers, turnCompleted({
          threadId: betaThreadId,
          turnId: betaTurnId
        }));
      });
      let finalizingRun = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await flushPromises();
        const current = await beta.store.readSession(sessionId);
        finalizingRun = current.agentRuns.find(({ id }) => id === "codex_app_server");
        if (finalizingRun?.state === VIBE64_AGENT_RUN_STATE.FINALIZING) {
          break;
        }
      }
      assert.equal(finalizingRun?.state, VIBE64_AGENT_RUN_STATE.FINALIZING);

      const notificationHold = createDeterministicHold();
      const betaNotificationStore = new Proxy(beta.store, {
        get(target, property) {
          if (property === "mutateSession") {
            return async (...args) => {
              notificationHold.enter();
              await notificationHold.wait;
              return target.mutateSession(...args);
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      projectService.createSessionStore = () => {
        const slug = currentProjectRequestContext()?.slug;
        return slug === "beta" ? betaNotificationStore : fixtures.get(slug)?.store;
      };
      await runWithProjectRequestContext(beta.context, async () => {
        emitCodexNotification(subscribers, {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: betaThreadId,
            tokenUsage: {
              last: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15
              },
              modelContextWindow: 100,
              total: { totalTokens: 15 }
            },
            turnId: betaTurnId
          }
        });
      });
      await notificationHold.entered;

      await runWithProjectRequestContext(
        alpha.context,
        () => controller.createConversation(sessionId, { ephemeral: true })
      );
      captures.stopRuntimeResult = {
        processExitVerified: true,
        runtimeDirPreserved: true,
        stopped: true
      };
      await runWithProjectRequestContext(alpha.context, () => (
        controller.closeAllForSession(sessionId, {
          renewalCleanup: {
            kind: "predecessor",
            renewalId: "alpha-finalizing-renewal",
            sourceSessionId: sessionId
          },
          runtime: alpha.runtime,
          session: alpha.session
        })
      ));

      const readsBeforeRecovery = calls.filter(([operation]) => operation === "read").length;
      const recoveryRead = new Promise((resolve) => {
        captures.onReadThread = resolve;
      });
      t.mock.timers.tick(10_001);
      await recoveryRead;
      captures.onReadThread = null;
      assert.ok(
        calls.filter(([operation]) => operation === "read").length > readsBeforeRecovery
      );
      notificationHold.release();
      await runWithProjectRequestContext(
        beta.context,
        () => controller.closeAllForSession(sessionId)
      );
      simulateControllerCrash();
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("hidden renewal successor shutdown requires its exact explicit cleanup context", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    session,
    simulateControllerCrash
  }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    simulateControllerCrash();
    const renewalId = "renewal-cleanup-1";
    const hiddenSession = {
      ...session,
      metadata: {
        ...session.metadata,
        renewal_id: renewalId,
        renewed_from: "source-session"
      },
      status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
    };
    const ordinaryRuntime = projectService.createRuntime();
    let ordinaryReads = 0;
    const hiddenRuntime = {
      ...ordinaryRuntime,
      async getSession() {
        ordinaryReads += 1;
        const error = new Error("Private renewal session");
        error.code = "vibe64_session_renewal_private";
        throw error;
      }
    };
    projectService.createRuntime = () => hiddenRuntime;

    await assert.rejects(
      () => controller.closeAllForSession(hiddenSession.sessionId),
      { code: "vibe64_session_renewal_private" }
    );
    await assert.rejects(
      () => controller.closeAllForSession(hiddenSession.sessionId, {
        renewalCleanup: {
          kind: "successor",
          renewalId: "wrong-renewal",
          sourceSessionId: "source-session"
        },
        runtime: hiddenRuntime,
        session: hiddenSession
      }),
      TypeError
    );
    assert.equal(ordinaryReads, 1);

    let releaseStopRuntime = () => null;
    const stopRuntimeStarted = new Promise((resolve) => {
      captures.onStopRuntime = resolve;
    });
    captures.stopRuntimeWait = new Promise((resolve) => {
      releaseStopRuntime = resolve;
    });
    const hiddenClose = controller.closeAllForSession(hiddenSession.sessionId, {
      renewalCleanup: {
        kind: "successor",
        renewalId,
        sourceSessionId: "source-session"
      },
      runtime: hiddenRuntime,
      session: hiddenSession
    });
    await stopRuntimeStarted;
    await assert.rejects(
      () => controller.closeAllForSession(hiddenSession.sessionId),
      { code: "vibe64_session_renewal_private" }
    );
    releaseStopRuntime();
    await hiddenClose;
    assert.equal(ordinaryReads, 2);
  });
});

test("renewal cleanup accepts a session that never acquired a Codex runtime", async () => {
  await withConversationController(async ({ captures, controller, projectService, session }) => {
    const renewalId = "renewal-unused-session";
    await controller.closeAllForSession(session.sessionId, {
      renewalCleanup: {
        kind: "predecessor",
        renewalId,
        sourceSessionId: session.sessionId
      },
      runtime: projectService.createRuntime(),
      session: { ...session, status: VIBE64_SESSION_STATUS.ACTIVE }
    });
    assert.equal(captures.providerOptions.length, 0);
    assert.equal(captures.stopRuntimes, 0);
  });
});

test("renewal predecessor cleanup fails closed when a cached Codex process does not confirm exit", async () => {
  await withConversationController(async ({ captures, controller, projectService, session }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    captures.stopRuntimeResult = { stopped: false };
    const renewalId = "renewal-predecessor-unverified-cache";
    const runtime = projectService.createRuntime();
    const activeSession = {
      ...session,
      status: VIBE64_SESSION_STATUS.ACTIVE
    };

    await assert.rejects(
      () => controller.closeAllForSession(session.sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId,
          sourceSessionId: session.sessionId
        },
        runtime,
        session: activeSession
      }),
      { code: "vibe64_session_renewal_process_exit_unverified" }
    );
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
    await assert.rejects(
      () => controller.closeAllForSession(session.sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId,
          sourceSessionId: session.sessionId
        },
        runtime,
        session: activeSession
      }),
      { code: "vibe64_session_renewal_process_exit_unverified" },
      "losing the failed provider cache cannot turn an acquired runtime into an unused session"
    );
  });
});

test("renewal predecessor cleanup accepts exact preserved process-exit proof", async () => {
  await withConversationController(async ({ captures, controller, projectService, session }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: false
    };
    const renewalId = "renewal-predecessor-preserved-proof";
    const runtime = projectService.createRuntime();

    await controller.closeAllForSession(session.sessionId, {
      renewalCleanup: {
        kind: "predecessor",
        renewalId,
        sourceSessionId: session.sessionId
      },
      runtime,
      session: {
        ...session,
        status: VIBE64_SESSION_STATUS.ACTIVE
      }
    });

    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

for (const closingMode of ["changeover", "renewal"]) {
test(`${closingMode} retries after a restart require the old runtime owner's verified empty scope`, async () => {
  await withConversationController(async ({ controller, projectService, session, temporaryRoot }) => {
    const runtimeDir = path.join(temporaryRoot, "codex-app-server-old");
    session.metadata.agent_transport_runtime_dir = runtimeDir;
    const options = closingMode === "changeover" ? { changeover: true } : {
      renewalCleanup: { kind: "predecessor", renewalId: "renewal-owner-recovery", sourceSessionId: session.sessionId },
      runtime: projectService.createRuntime(), session: { ...session, status: VIBE64_SESSION_STATUS.ACTIVE }
    };
    const stops = [];
    let scopeEmpty = false;
    const release = installVibe64ManagedExecutionProvider({
      async runCommand() { assert.fail("Changing an idle session must not start Codex."); },
      async stopExecution() { assert.fail("The old session has no retained execution id."); },
      async stopOwnedExecutions(selector) {
        stops.push(selector);
        return { supported: true, ok: scopeEmpty, scopeEmpty, closed: 0 };
      }
    });
    try {
      await assert.rejects(controller.closeAllForSession(session.sessionId, options),
        { code: closingMode === "changeover" ? "vibe64_changeover_process_exit_unverified" : "vibe64_session_renewal_process_exit_unverified" });
      scopeEmpty = true;
      await controller.closeAllForSession(session.sessionId, options);
      assert.equal(stops.length, 2);
      assert.deepEqual(stops[1], { kind: "assistant", operationId: "codex-app-server", ownerId: stableHash(runtimeDir) });
    } finally { release(); }
  });
});
}

test("renewal predecessor cleanup does not treat an already-missing runtime directory as exit proof", async () => {
  await withConversationController(async ({ captures, controller, projectService, session, temporaryRoot }) => {
    const activeSession = {
      ...session,
      metadata: {
        ...session.metadata,
        agent_transport_runtime_dir: path.join(temporaryRoot, "missing-codex-runtime")
      },
      status: VIBE64_SESSION_STATUS.ACTIVE
    };
    const renewalId = "renewal-predecessor-missing-runtime";
    const runtime = projectService.createRuntime();

    await assert.rejects(
      () => controller.closeAllForSession(session.sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId,
          sourceSessionId: session.sessionId
        },
        runtime,
        session: activeSession
      }),
      { code: "vibe64_session_renewal_process_exit_unverified" }
    );
    assert.equal(captures.providerOptions.length, 0);
  });
});

test("renewal proof release preserves a runtime still retained by another session", async () => {
  await withConversationController(async ({ captures, controller, projectService, session }) => {
    await controller.executionProfileModelCatalog(session.sessionId);
    const runtimeDir = captures.providerOptions.at(-1).runtimeDir;
    await mkdir(runtimeDir, { recursive: true });
    const runtimeFile = path.join(runtimeDir, "runtime.json");
    const saved = `${JSON.stringify(exactStoppedRuntimeMetadata(runtimeDir, { stopped: true }))}\n`;
    await writeFile(runtimeFile, saved);
    const archivedSession = { ...session, sessionId: "archived-predecessor", archived: true,
      status: VIBE64_SESSION_STATUS.ARCHIVED, metadata: { ...session.metadata,
        agent_transport_runtime_dir: runtimeDir, renewal_id: "shared-renewal", renewed_to: "successor" } };
    const options = { renewalId: "shared-renewal", runtime: projectService.createRuntime(), session: archivedSession };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const released = await controller.releaseRenewalPredecessorProcessExitProof(archivedSession.sessionId, options);
      assert.equal(released.released, true);
      assert.equal(released.sharedProcessRetained, true);
      assert.equal(await readFile(runtimeFile, "utf8"), saved);
      assert.equal(captures.stopRuntimes, 0);
      assert.equal(captures.closes, 0);
    }
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
  });
});

test("archived renewal predecessor releases preserved runtime proof idempotently", async () => {
  await withConversationController(async ({ controller, projectService, session, temporaryRoot }) => {
    const renewalId = "renewal-predecessor-proof-release";
    const runtimeDir = path.join(temporaryRoot, "codex-app-server-renewal-proof");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      path.join(runtimeDir, "runtime.json"),
      `${JSON.stringify(exactStoppedRuntimeMetadata(runtimeDir, { stopped: true }))}\n`
    );
    const archivedSession = {
      ...session,
      archived: true,
      metadata: {
        ...session.metadata,
        agent_transport_runtime_dir: runtimeDir,
        renewal_id: renewalId,
        renewed_to: "renewal-successor"
      },
      status: VIBE64_SESSION_STATUS.ARCHIVED
    };
    const runtime = projectService.createRuntime();

    const released = await controller.releaseRenewalPredecessorProcessExitProof(
      session.sessionId,
      {
        renewalId,
        runtime,
        session: archivedSession
      }
    );
    assert.equal(released.released, true);
    assert.equal(released.alreadyReleased, false);
    assert.equal(released.runtimeDirRemoved, true);

    const retried = await controller.releaseRenewalPredecessorProcessExitProof(
      session.sessionId,
      {
        renewalId,
        runtime,
        session: archivedSession
      }
    );
    assert.equal(retried.released, true);
    assert.equal(retried.alreadyReleased, true);

    await assert.rejects(
      () => controller.releaseRenewalPredecessorProcessExitProof(
        session.sessionId,
        {
          renewalId,
          runtime,
          session: {
            ...archivedSession,
            archived: false,
            status: VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
          }
        }
      ),
      TypeError
    );
  });
});

test("authorized renewal successor releases preserved runtime proof idempotently", async () => {
  await withConversationController(async ({ controller, projectService, session, temporaryRoot }) => {
    const renewalId = "renewal-successor-proof-release";
    const sourceSessionId = "source-session";
    const runtimeDir = path.join(temporaryRoot, "codex-app-server-successor-renewal-proof");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      path.join(runtimeDir, "runtime.json"),
      `${JSON.stringify(exactStoppedRuntimeMetadata(runtimeDir, { stopped: true }))}\n`
    );
    const successor = {
      ...session,
      metadata: {
        ...session.metadata,
        agent_transport_runtime_dir: runtimeDir,
        renewal_id: renewalId,
        renewed_from: sourceSessionId
      },
      status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
    };
    const authorization = {
      authorizedAt: "2026-08-25T00:00:00.000Z",
      kind: "vibe64.session_renewal_successor_process_exit_proof_release",
      renewalId,
      runtimeDir,
      schemaVersion: 1,
      sourceSessionId,
      successorSessionId: session.sessionId
    };
    const runtime = projectService.createRuntime();

    await assert.rejects(
      () => controller.releaseRenewalSuccessorProcessExitProof(
        session.sessionId,
        {
          authorization: {
            ...authorization,
            runtimeDir: path.join(temporaryRoot, "different-runtime")
          },
          renewalId,
          runtime,
          session: successor
        }
      ),
      TypeError
    );
    assert.match(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"), /"stopped"/u);

    const released = await controller.releaseRenewalSuccessorProcessExitProof(
      session.sessionId,
      {
        authorization,
        renewalId,
        runtime,
        session: successor
      }
    );
    assert.equal(released.released, true);
    assert.equal(released.alreadyReleased, false);
    assert.equal(released.runtimeDirRemoved, true);

    const retried = await controller.releaseRenewalSuccessorProcessExitProof(
      session.sessionId,
      {
        authorization,
        renewalId,
        runtime,
        session: successor
      }
    );
    assert.equal(retried.released, true);
    assert.equal(retried.alreadyReleased, true);
  });
});

test("cleanup and renewal freeze share one atomic terminal admission boundary", async () => {
  await withConversationController(async ({ calls, captures, controller, session }) => {
    let releaseEnvironment;
    let environmentStarted;
    const environmentStartedPromise = new Promise((resolve) => {
      environmentStarted = resolve;
    });
    captures.onProjectEnvironment = environmentStarted;
    captures.projectEnvironmentWait = new Promise((resolve) => {
      releaseEnvironment = resolve;
    });
    const owner = "session-renewal:cleanup-race";
    const namespace = codexTerminalNamespace(session.sessionId);
    const deleting = controller.deleteDetachedChatThread(session.sessionId, {
      threadId: "conversation-before-freeze"
    });
    await environmentStartedPromise;
    assert.deepEqual(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      owner
    }), {
      code: "terminal_admission_busy",
      error: "A terminal operation is still finishing.",
      ok: false
    });
    releaseEnvironment();
    const deleted = await deleting;
    assert.equal(deleted.ok, true);
    assert.equal(deleted.status, "deleted");
    assert.equal(calls.some(([operation]) => operation === "ensure"), true);
    assert.equal(calls.some(([operation]) => operation === "delete"), true);

    assert.equal(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      owner
    }).ok, true);
    const providerCount = captures.providerOptions.length;
    const ensureCount = calls.filter(([operation]) => operation === "ensure").length;
    const deleteCount = calls.filter(([operation]) => operation === "delete").length;
    const interruptCount = calls.filter(([operation]) => operation === "interrupt").length;
    try {
      const interrupted = await controller.interruptDetachedChatTurn(session.sessionId, {
        threadId: "conversation-before-freeze",
        turnId: "turn-before-freeze"
      });
      const stopped = await controller.stopConversation(session.sessionId, {
        conversationId: "conversation-before-freeze",
        runId: "turn-before-freeze"
      });

      assert.equal(interrupted.ok, true);
      assert.equal(interrupted.operationOutcome, "already_idle");
      assert.equal(stopped.ok, true);
      assert.equal(stopped.operationOutcome, "already_idle");
      assert.equal(captures.providerOptions.length, providerCount);
      assert.equal(calls.filter(([operation]) => operation === "ensure").length, ensureCount);
      assert.equal(calls.filter(([operation]) => operation === "delete").length, deleteCount);
      assert.equal(calls.filter(([operation]) => operation === "interrupt").length, interruptCount);
    } finally {
      assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);
    }
  });
});

test("renewal freeze cannot cross any Codex provider acquisition boundary", async (t) => {
  const boundaries = [{
    hook: "onProviderFactory",
    title: "provider factory"
  }, {
    hook: "onEnsureAvailable",
    title: "provider availability"
  }];

  for (const boundary of boundaries) {
    await t.test(boundary.title, async () => {
      await withConversationController(async ({ captures, controller, session }) => {
        const owner = `session-renewal:${boundary.hook}`;
        const namespace = codexTerminalNamespace(session.sessionId);
        let freezeAttempt = null;
        captures[boundary.hook] = () => {
          freezeAttempt = freezeTerminalNamespaceAdmission(namespace, {
            code: "vibe64_session_renewal_quiesced",
            error: "Session renewal has frozen terminal input.",
            owner
          });
        };

        const deleted = await controller.deleteDetachedChatThread(session.sessionId, {
          threadId: `conversation-${boundary.hook}`
        });

        assert.equal(deleted.ok, true);
        assert.deepEqual(freezeAttempt, {
          code: "terminal_admission_busy",
          error: "A terminal operation is still finishing.",
          ok: false
        });
        assert.equal(freezeTerminalNamespaceAdmission(namespace, {
          code: "vibe64_session_renewal_quiesced",
          error: "Session renewal has frozen terminal input.",
          owner
        }).ok, true);
        assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);
      });
    });
  }
});

test("renewal freeze cannot cross persisted helper runtime identity recovery", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const pending = controller.runDetachedChatTurn(session.sessionId, {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist one helper thread before the cleanup race."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted." })
    });
    const completed = await pending;
    simulateControllerCrash();

    const namespace = codexTerminalNamespace(session.sessionId);
    const owner = "session-renewal:runtime-identity";
    let freezeAttempt = null;
    const restarted = restartedCaptures(captures, {
      onCurrentRuntimeInfo() {
        freezeAttempt = freezeTerminalNamespaceAdmission(namespace, {
          code: "vibe64_session_renewal_quiesced",
          error: "Session renewal has frozen terminal input.",
          owner
        });
      }
    });
    const restartedController = createRestartedController({ session,
      captures: restarted,
      projectService
    });

    const deleted = await restartedController.deleteDetachedChatThread(session.sessionId, {
      executionProfile,
      threadId: completed.threadId
    });

    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.deepEqual(freezeAttempt, {
      code: "terminal_admission_busy",
      error: "A terminal operation is still finishing.",
      ok: false
    });
    assert.equal(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      owner
    }).ok, true);
    assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);
  });
});

test("failed session cleanup retains helper ownership and retries during later helper admission", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create one helper thread to clean up."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready for cleanup." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    captures.failDeletes = 1;
    await assert.rejects(
      controller.closeAllForSession("session-1"),
      (error) => {
        assert.equal(error.code, "vibe64_codex_helper_thread_cleanup_failed");
        assert.equal(error.retryable, true);
        return true;
      }
    );
    assert.equal(captures.stopRuntimes, 0);
    assert.equal(captures.closes, 0);

    const followUp = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "A cleanup-required thread must never run another turn.",
      threadId: first.threadId
    });
    assert.equal(followUp.ok, false);
    assert.equal(followUp.code, "vibe64_codex_helper_thread_unavailable");
    assert.equal(captures.turns.length, 1);
    assert.deepEqual(captures.deletes, ["conversation-1", "conversation-1"]);

    await controller.closeAllForSession("session-1");
    assert.deepEqual(captures.deletes, ["conversation-1", "conversation-1"]);
    assert.equal(captures.stopRuntimes, 1);
  });
});

test("resume verification failure removes retired ownership and never revives the stale thread", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a thread before its tool inventory changes."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Initial explanation." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    captures.hookInventories[2] = captures.hooks;
    captures.hookInventories[3] = captures.hooks.map((hook) => ({
      ...hook,
      currentHash: "sha256:changed-after-resume"
    }));
    const failedResume = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "This follow-up must fail closed.",
      threadId: first.threadId
    });
    assert.equal(failedResume.ok, false);
    assert.match(failedResume.error, /execution surfaces changed/u);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal(captures.resumes.length, 1);

    const staleRetry = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Never revive the already retired thread.",
      threadId: first.threadId
    });
    assert.equal(staleRetry.ok, false);
    assert.equal(staleRetry.code, "vibe64_codex_helper_thread_unavailable");
    assert.equal(captures.resumes.length, 1);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
  });
});

test("resume verification cleanup failure keeps ownership until deletion is retried", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a thread for retryable cleanup."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Initial explanation." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    captures.hookInventories[2] = captures.hooks;
    captures.hookInventories[3] = captures.hooks.map((hook) => ({
      ...hook,
      currentHash: "sha256:changed-with-delete-failure"
    }));
    captures.failDeletes = 1;
    const failedResume = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Fail verification and the first cleanup attempt.",
      threadId: first.threadId
    });
    assert.equal(failedResume.ok, false);
    assert.equal(failedResume.code, "vibe64_agent_execution_profile_policy_unenforceable");
    assert.match(failedResume.error, /could not retire a helper thread/u);

    const retriedCleanup = await controller.deleteDetachedChatThread("session-1", {
      executionProfile,
      threadId: first.threadId
    });
    assert.equal(retriedCleanup.ok, true, JSON.stringify(retriedCleanup));
    assert.equal(retriedCleanup.status, "deleted");
    assert.deepEqual(captures.deletes, ["conversation-1", "conversation-1"]);

    const staleRetry = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "The successfully retired thread must now be unavailable.",
      threadId: first.threadId
    });
    assert.equal(staleRetry.ok, false);
    assert.equal(staleRetry.code, "vibe64_codex_helper_thread_unavailable");
  });
});

test("start verification cleanup failure records the orphan until deletion is retried", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const executionProfile = sourceExplanationHelperProfile();
    captures.hookInventories[0] = captures.hooks;
    captures.hookInventories[1] = captures.hooks.map((hook) => ({
      ...hook,
      currentHash: "sha256:changed-after-start"
    }));
    captures.failDeletes = 1;

    const failedStart = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Fail the post-start inventory check and its first cleanup attempt."
    });
    assert.equal(failedStart.ok, false);
    assert.equal(failedStart.code, "vibe64_agent_execution_profile_policy_unenforceable");
    assert.match(failedStart.error, /could not retire a helper thread/u);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal(captures.turns.length, 0);

    const retriedCleanup = await controller.deleteDetachedChatThread("session-1", {
      executionProfile,
      threadId: "conversation-1"
    });
    assert.equal(retriedCleanup.ok, true, JSON.stringify(retriedCleanup));
    assert.equal(retriedCleanup.status, "deleted");
    assert.deepEqual(captures.deletes, ["conversation-1", "conversation-1"]);

    const staleRetry = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Never revive the retired startup thread.",
      threadId: "conversation-1"
    });
    assert.equal(staleRetry.ok, false);
    assert.equal(staleRetry.code, "vibe64_codex_helper_thread_unavailable");
    assert.equal(captures.resumes.length, 0);
  });
});

test("a completed result is not exposed when READY ownership cannot be persisted", async () => {
  await withConversationController(async ({ session,
    captures,
    projectRuntimeRoot,
    projectService,
    subscribers
  }) => {
    const failingLedgerFactory = ({ projectRuntimeRoot: ledgerRoot }) => {
      const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot: ledgerRoot });
      return Object.freeze({
        ...ledger,
        async write(record, options = {}) {
          if (
            options.expected &&
            record.lifecycle === CODEX_HELPER_THREAD_LIFECYCLES.READY
          ) {
            const error = new Error("simulated READY ownership persistence failure");
            error.code = "simulated_ready_ledger_failure";
            throw error;
          }
          return ledger.write(record, options);
        }
      });
    };
    const failingController = createRestartedController({ session,
      captures,
      codexHelperThreadLedgerFactory: failingLedgerFactory,
      projectService,
      subscribers
    });
    try {
      const pending = failingController.runDetachedChatTurn("session-1", {
        executionProfile: sourceExplanationHelperProfile(),
        outputSchema: sourceExplanationOutputSchema(),
        prompt: "Do not expose this result without durable READY ownership."
      });
      await waitForCapturedTurns(captures, 1);
      completeDetachedTurn(subscribers, {
        text: JSON.stringify({ answer: "Completed but not durably reusable." })
      });
      const failed = await pending;
      assert.equal(failed.ok, false);
      assert.equal(failed.code, "simulated_ready_ledger_failure");
      assert.deepEqual(captures.deletes, ["conversation-1"]);
      assert.deepEqual(
        await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll(),
        { failures: [], records: [] }
      );
    } finally {
      await failingController.closeAllForSession("session-1");
    }
  });
});

test("project shutdown finds and deletes helper-only providers by project ownership", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    session,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create a helper-only provider for project shutdown."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Project-owned explanation." })
    });
    assert.equal((await pending).ok, true);
    assert.equal(Object.hasOwn(session, "projectContextRoot"), false);

    const result = await controller.closeAllForProject({
      projectContextRoot,
      reason: "unit-test"
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.providerCount, 1);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal(captures.stopRuntimes, 1);
  });
});

test("provider replacement retires helper ownership before closing the old connection", async () => {
  await withConversationController(async ({ calls, captures, controller, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create a thread before the provider environment changes."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Provider one." })
    });
    assert.equal((await pending).ok, true);

    captures.environmentVersion = "two";
    await controller.executionProfileModelCatalog("session-1");

    const deleteIndex = calls.findIndex(([operation]) => operation === "delete");
    const closeIndex = calls.findIndex(([operation]) => operation === "close");
    const modelIndex = calls.findIndex(([operation]) => operation === "models");
    assert.ok(deleteIndex >= 0);
    assert.ok(closeIndex > deleteIndex);
    assert.ok(modelIndex > closeIndex);
    assert.equal(captures.closes, 1);
  });
});

test("model catalog resolution aborts at the workload deadline", {
  concurrency: false
}, async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"]
  });
  try {
    await withConversationController(async ({ captures, controller }) => {
      captures.hangModelLists = true;
      const pending = controller.executionProfileModelCatalog("session-1", {
        timeoutMs: 25
      });
      while (captures.modelSignals.length === 0) {
        await flushPromises();
      }
      let settled = false;
      void pending.catch(() => {
        settled = true;
      });

      t.mock.timers.tick(24);
      await flushPromises();
      assert.equal(settled, false);

      t.mock.timers.tick(1);
      await assert.rejects(pending, (error) => {
        assert.equal(error.code, "vibe64_codex_model_catalog_timeout");
        assert.equal(error.retryable, true);
        return true;
      });
      assert.equal(captures.modelSignals[0].aborted, true);
      assert.equal(captures.modelAborts, 1);
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("model catalog resolution follows explicit caller cancellation", async () => {
  await withConversationController(async ({ captures, controller }) => {
    captures.hangModelLists = true;
    const abortController = new AbortController();
    const pending = controller.executionProfileModelCatalog("session-1", {
      signal: abortController.signal,
      timeoutMs: 10_000
    });
    while (captures.modelSignals.length === 0) {
      await flushPromises();
    }

    const cancellation = new Error("caller cancelled model discovery");
    abortController.abort(cancellation);
    await assert.rejects(pending, (error) => error === cancellation);
    assert.equal(captures.modelSignals[0].aborted, true);
    assert.equal(captures.modelAborts, 1);
  });
});

test("startup reports an absent helper runtime only when it has no durable ownership", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const reconciliation = await controller.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.deepEqual(reconciliation.results[0].helperInventory, {
      deletedThreadIds: [],
      ok: true,
      ownedThreadIds: [],
      providerKey: reconciliation.results[0].helperInventory.providerKey,
      retiredMissingThreadIds: [],
      status: "runtimeAbsent"
    });
    assert.equal(captures.helperThreadInventories, 0);
  });
});

test("startup helper inventory failures do not block primary assistant reconciliation", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    await controller.executionProfileModelCatalog("session-1");
    captures.failHelperThreadInventories = 1;

    const reconciliation = await controller.reconcileThreads([session]);

    assert.equal(reconciliation.ok, false);
    assert.equal(reconciliation.results[0].ok, true, JSON.stringify(reconciliation));
    assert.equal(reconciliation.results[0].helperInventory, null);
    assert.match(
      reconciliation.results[0].helperFailure?.error || "",
      /helper inventory temporarily unavailable/u
    );
    assert.equal(reconciliation.failed.length, 1);
  });
});

test("a completed helper thread survives a controller crash and resumes only after identity proof", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Persist this helper thread before the controller crashes."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));
    const persisted = await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll();
    assert.equal(Object.hasOwn(session, "projectContextRoot"), false);
    assert.equal(persisted.records.length, 1);
    assert.equal(persisted.records[0].projectContextRoot, projectContextRoot);
    simulateControllerCrash();

    const restartedCalls = [];
    const restartedSubscribers = new Set();
    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({ session,
      calls: restartedCalls,
      captures: restarted,
      projectService,
      subscribers: restartedSubscribers
    });
    const followUpPending = restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Resume the exact persisted helper thread.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(restarted, 1);
    assert.deepEqual(restarted.resumes.map(({ threadId }) => threadId), [first.threadId]);
    completeDetachedTurn(restartedSubscribers, {
      text: JSON.stringify({ answer: "Resumed after restart." })
    });
    assert.equal((await followUpPending).ok, true);

    await restartedController.closeAllForSession("session-1");
    assert.deepEqual(restarted.deletes, [first.threadId]);
    assert.deepEqual(await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll(), {
      failures: [],
      records: []
    });
  });
});

test("a missing helper runtime retires stale ownership before provider identity comparison", async () => {
  await withConversationController(async ({ session,
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist this thread before its runtime disappears."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted before runtime loss." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(
      (await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll())
        .records.length,
      1
    );
    simulateControllerCrash();

    await rm(captures.runtimeInfo.runtimeDir, { force: true, recursive: true });
    captures.environmentVersion = "two";
    const restartedSubscribers = new Set();
    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({ session,
      captures: restarted,
      projectService,
      subscribers: restartedSubscribers
    });
    const freshPending = restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Start fresh after the stale runtime disappeared."
    });
    await waitForCapturedTurns(restarted, 1);
    completeDetachedTurn(restartedSubscribers, {
      text: JSON.stringify({ answer: "Fresh provider ownership." })
    });
    const fresh = await freshPending;
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(restarted.resumes.length, 0);
    assert.equal(restarted.stopRuntimes, 0);
    assert.equal(restarted.threads.length, 1);
    assert.equal(
      (await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll())
        .records.length,
      1
    );
    await restartedController.closeAllForSession("session-1");
  });
});

test("provider context drift retires a verified stale helper runtime", async () => {
  await withConversationController(async ({ session,
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist this thread before the provider context changes."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted before context drift." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));
    simulateControllerCrash();

    captures.environmentVersion = "two";
    const restartedSubscribers = new Set();
    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({ session,
      captures: restarted,
      projectService,
      subscribers: restartedSubscribers
    });
    const freshPending = restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Start fresh after verified stale-runtime retirement."
    });
    await waitForCapturedTurns(restarted, 1);
    completeDetachedTurn(restartedSubscribers, {
      text: JSON.stringify({ answer: "Fresh provider context." })
    });
    const fresh = await freshPending;
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(restarted.resumes.length, 0);
    assert.equal(restarted.stopRuntimes, 1);
    assert.equal(restarted.threads.length, 1);
    assert.equal(
      (await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll())
        .records.length,
      1
    );
    await restartedController.closeAllForSession("session-1");
  });
});

test("startup inventory retires READY ownership missing after a helper runtime restart", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Persist this completed thread before its private runtime restarts."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted before restart." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(
      (await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll())
        .records[0]?.lifecycle,
      CODEX_HELPER_THREAD_LIFECYCLES.READY
    );
    simulateControllerCrash();

    const restartedSubscribers = new Set();
    const restarted = restartedCaptures(captures, {
      helperThreadIds: []
    });
    const restartedController = createRestartedController({ session,
      captures: restarted,
      projectService,
      subscribers: restartedSubscribers
    });
    const reconciliation = await restartedController.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.equal(restarted.helperThreadInventories, 1);
    assert.deepEqual(restarted.deletes, []);
    assert.deepEqual(
      reconciliation.results[0].helperInventory.retiredMissingThreadIds,
      [first.threadId]
    );
    assert.deepEqual(reconciliation.results[0].helperInventory.ownedThreadIds, []);
    assert.deepEqual(
      await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll(),
      { failures: [], records: [] }
    );

    const staleFollowUp = await restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Do not resume a thread absent from authoritative inventory.",
      threadId: first.threadId
    });
    assert.equal(staleFollowUp.ok, false);
    assert.equal(staleFollowUp.code, "vibe64_codex_helper_thread_unavailable");

    const freshPending = restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a fresh thread immediately after stale ownership retirement."
    });
    await waitForCapturedTurns(restarted, 1);
    completeDetachedTurn(restartedSubscribers, {
      text: JSON.stringify({ answer: "Fresh thread created." })
    });
    const fresh = await freshPending;
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(fresh.threadId, first.threadId);
    assert.equal(
      (await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll())
        .records[0]?.lifecycle,
      CODEX_HELPER_THREAD_LIFECYCLES.READY
    );

    await restartedController.closeAllForSession("session-1");
  });
});

test("an active helper turn is interrupted and deleted during crash reconciliation", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Remain active across the simulated crash."
    });
    void pending.catch(() => null);
    await waitForCapturedTurns(captures, 1);
    const before = await waitForHelperLedgerLifecycle(
      projectRuntimeRoot,
      CODEX_HELPER_THREAD_LIFECYCLES.ACTIVE
    );
    assert.equal(before.turnId, "turn-1");
    simulateControllerCrash();

    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({ session,
      captures: restarted,
      projectService
    });
    const reconciliation = await restartedController.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.deepEqual(restarted.interrupts, [{
      threadId: "conversation-1",
      turnId: "turn-1"
    }]);
    assert.deepEqual(restarted.deletes, ["conversation-1"]);
    assert.equal((await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Too late." })
    });
    const crashedResult = await pending;
    assert.equal(crashedResult.ok, false);
  });
});

test("startup reconciliation deletes a thread orphaned before its first ledger write", async () => {
  await withConversationController(async ({ session,
    captures,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const failingLedgerFactory = ({ projectRuntimeRoot }) => {
      const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
      return Object.freeze({
        ...ledger,
        async write() {
          const error = new Error("simulated crash before durable ownership write");
          error.code = "simulated_ledger_crash";
          throw error;
        }
      });
    };
    captures.failDeletes = 1;
    const failedController = createRestartedController({ session,
      captures,
      codexHelperThreadLedgerFactory: failingLedgerFactory,
      projectService,
      subscribers
    });
    const failed = await failedController.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create the crash-window orphan."
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "vibe64_codex_helper_ownership_blocked");
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    const sharedOptions = captures.providerOptions.find(({ helperWorkdir }) => (
      Boolean(helperWorkdir)
    ));
    assert.ok(sharedOptions?.runtimeDir);
    await mkdir(sharedOptions.runtimeDir, { recursive: true });
    simulateControllerCrash();

    const restarted = restartedCaptures(captures, {
      helperThreadIds: ["conversation-1"]
    });
    const restartedController = createRestartedController({ session,
      captures: restarted,
      projectService
    });
    const reconciliation = await restartedController.reconcileThreads(["session-1"]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.equal(restarted.helperThreadInventories, 1);
    assert.deepEqual(restarted.deletes, ["conversation-1"]);
    assert.deepEqual(
      reconciliation.results[0].helperInventory.deletedThreadIds,
      ["conversation-1"]
    );
  });
});

test("startup inventory cannot delete a new helper thread before ownership is durable", async () => {
  await withConversationController(async ({
    captures,
    controller,
    session,
    subscribers
  }) => {
    let releaseStart = null;
    let reportStart = null;
    captures.startThreadWait = new Promise((resolve) => {
      releaseStart = resolve;
    });
    const startObserved = new Promise((resolve) => {
      reportStart = resolve;
    });
    captures.onStartThread = reportStart;
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create ownership while startup inventory is waiting."
    });
    await startObserved;
    captures.helperThreadIds = ["conversation-1"];

    const reconciliation = controller.reconcileThreads([session]);
    await flushPromises();
    assert.equal(captures.helperThreadInventories, 0);
    releaseStart();
    await waitForCapturedTurns(captures, 1);
    const reconciled = await reconciliation;
    assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    assert.equal(captures.helperThreadInventories, 1);
    assert.deepEqual(captures.deletes, []);
    assert.deepEqual(
      reconciled.results[0].helperInventory.ownedThreadIds,
      ["conversation-1"]
    );

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "The owned thread survived inventory." })
    });
    assert.equal((await pending).ok, true);
  });
});

test("startup inventory cannot retire a READY thread claimed by a concurrent follow-up", async () => {
  await withConversationController(async ({
    captures,
    controller,
    session,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a completed thread before startup inventory begins."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready for a follow-up." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    let releaseInventory = null;
    captures.helperThreadInventoryWait = new Promise((resolve) => {
      releaseInventory = resolve;
    });
    const reconciliation = controller.reconcileThreads([session]);
    while (captures.helperThreadInventories === 0) {
      await flushPromises();
    }

    const followUpPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Claim the READY thread while inventory is paused.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(captures, 2);
    releaseInventory();
    const reconciled = await reconciliation;
    assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    assert.deepEqual(reconciled.results[0].helperInventory.retiredMissingThreadIds, []);
    assert.deepEqual(reconciled.results[0].helperInventory.ownedThreadIds, [first.threadId]);
    assert.deepEqual(captures.deletes, []);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "The follow-up retained ownership." }),
      turnId: "turn-2"
    });
    assert.equal((await followUpPending).ok, true);
  });
});

test("helper project lifecycle gate releases after a rejected thread start", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    captures.failThreadStarts = 1;
    const failed = await controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Fail this start."
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "thread_start_failed");

    const retried = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "The next start must not deadlock."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "The lifecycle gate was released." })
    });
    assert.equal((await retried).ok, true);
  });
});

test("an account switch blocks persisted helper ownership without deleting it", async () => {
  await withConversationController(async ({ session,
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist this thread under account A."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Owned by account A." })
    });
    const first = await pending;
    assert.equal(first.ok, true);
    simulateControllerCrash();

    const switched = restartedCaptures(captures, {
      runtimeInfo: {
        ...captures.runtimeInfo,
        accountIdentitySignature: TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE
      }
    });
    const switchedController = createRestartedController({ session,
      captures: switched,
      projectService
    });
    const blocked = await switchedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Never adopt this thread from another account.",
      threadId: first.threadId
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "vibe64_codex_helper_ownership_blocked");
    assert.equal(switched.resumes.length, 0);
    assert.equal(switched.deletes.length, 0);
    assert.equal((await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 1);

    const original = restartedCaptures(captures);
    const cleanupController = createRestartedController({ session,
      captures: original,
      projectService
    });
    const cleanup = await cleanupController.deleteDetachedChatThread("session-1", {
      executionProfile,
      threadId: first.threadId
    });
    assert.equal(cleanup.ok, true, JSON.stringify(cleanup));
    assert.equal((await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
  });
});

test("a same-account auth refresh can resume persisted helper ownership", async () => {
  await withConversationController(async ({ session,
    captures,
    controller,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist this thread before a token refresh."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted." })
    });
    const first = await pending;
    assert.equal(first.ok, true);
    simulateControllerCrash();

    const refreshedSubscribers = new Set();
    const refreshed = restartedCaptures(captures, {
      runtimeInfo: {
        ...captures.runtimeInfo,
        authStateSignature: `v1:${"c".repeat(24)}`
      }
    });
    const refreshedController = createRestartedController({ session,
      captures: refreshed,
      projectService,
      subscribers: refreshedSubscribers
    });
    const followUpPending = refreshedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Resume under the same account after token refresh.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(refreshed, 1);
    assert.deepEqual(refreshed.resumes.map(({ threadId }) => threadId), [first.threadId]);
    completeDetachedTurn(refreshedSubscribers, {
      text: JSON.stringify({ answer: "Same account resumed." })
    });
    assert.equal((await followUpPending).ok, true);
    await refreshedController.closeAllForSession("session-1");
  });
});

test("an archived session retires its persisted helper thread during reconciliation", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before archiving."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    assert.equal((await pending).ok, true);
    session.status = VIBE64_SESSION_STATUS.ARCHIVED;
    simulateControllerCrash();

    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({ session,
      captures: restarted,
      projectService
    });
    const reconciliation = await restartedController.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.deepEqual(restarted.deletes, ["conversation-1"]);
    assert.equal((await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
  });
});

test("concurrent session closes coalesce helper deletion and clear durable ownership once", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before concurrent close."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    assert.equal((await pending).ok, true);

    const closed = await Promise.allSettled([
      controller.closeAllForSession("session-1"),
      controller.closeAllForSession("session-1")
    ]);
    simulateControllerCrash();
    assert.equal(closed.filter(({ status }) => status === "rejected").length, 0);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal((await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
  });
});

test("an unconfirmed delete result preserves cleanup-required ownership for retry", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before an unconfirmed delete."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    assert.equal((await pending).ok, true);
    captures.undefinedDeletes = 1;

    await assert.rejects(
      controller.closeAllForSession("session-1"),
      (error) => error.code === "vibe64_codex_helper_thread_cleanup_failed"
    );
    const retained = await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll();
    assert.equal(retained.records.length, 1);
    assert.equal(
      retained.records[0].lifecycle,
      CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED
    );
    const retried = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      threadId: "conversation-1"
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal((await createCodexHelperThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
    simulateControllerCrash();
  });
});

test("helper deletion requires the owned thread's exact semantic profile", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before profile-bound deletion."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    const completed = await pending;
    assert.equal(completed.ok, true, JSON.stringify(completed));

    const wrongWorkload = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
      },
      threadId: completed.threadId
    });
    assert.equal(wrongWorkload.ok, false);
    assert.equal(wrongWorkload.code, "vibe64_codex_helper_thread_unavailable");

    const missingProfile = await controller.deleteDetachedChatThread("session-1", {
      threadId: completed.threadId
    });
    assert.equal(missingProfile.ok, false);
    assert.equal(missingProfile.code, "vibe64_codex_helper_thread_unavailable");

    const malformedProfile = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: "helper",
      threadId: completed.threadId
    });
    assert.equal(malformedProfile.ok, false);
    assert.equal(malformedProfile.code, "vibe64_codex_helper_ownership_blocked");
    assert.deepEqual(captures.deletes, []);

    const deleted = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION
      },
      threadId: completed.threadId
    });
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.equal(deleted.status, "deleted");
    assert.deepEqual(captures.deletes, [completed.threadId]);
  });
});

test("helper deletion rejects an unknown thread without calling the provider", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const result = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION
      },
      threadId: "unowned-helper-thread"
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_helper_thread_unavailable");
    assert.deepEqual(captures.deletes, []);
  });
});

test("helper interruption rejects an unowned thread without calling the provider", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const result = await controller.interruptDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      threadId: "unowned-helper-thread",
      turnId: "unowned-helper-turn"
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_helper_thread_unavailable");
    assert.deepEqual(captures.interrupts, []);
  });
});

test("helper work rejects a stale expected account before creating a thread", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const result = await controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      expectedAccountIdentitySignature: TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Never run under a different selected account."
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_helper_ownership_blocked");
    assert.match(result.error, /selected Codex account changed/u);
    assert.deepEqual(captures.threads, []);
    assert.deepEqual(captures.turns, []);
  });
});

test("helper work rejects an account switch before exposing the result", async () => {
  await withConversationController(async ({
    captures,
    controller,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationHelperProfile(),
      expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Do not expose work after an account switch."
    });
    await waitForCapturedTurns(captures, 1);
    captures.runtimeInfo.accountIdentitySignature = TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE;
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "This result belongs to the old account." })
    });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_helper_ownership_blocked");
    assert.deepEqual(captures.deletes, ["conversation-1"]);
  });
});

for (const [outcome, deleteFailures] of [
  ["deleted", 0],
  ["retry after deletion failure", 1]
]) {
  test(`account-switch cleanup deletes only its persisted helper: ${outcome}`, async () => {
    await withConversationController(async ({ session, captures, controller, projectRuntimeRoot, projectService,
      simulateControllerCrash, subscribers }) => {
      const executionProfile = sourceExplanationHelperProfile();
      const pending = controller.runDetachedChatTurn("session-1", {
        executionProfile, outputSchema: sourceExplanationOutputSchema(), prompt: "Temporary work."
      });
      await waitForCapturedTurns(captures, 1);
      completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Done." }) });
      const first = await pending;
      captures.failDeletes = 1;
      const failed = await controller.deleteDetachedChatThread("session-1", {
        executionProfile, threadId: first.threadId
      });
      assert.equal(failed.ok, false);
      const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
      assert.equal((await ledger.readAll()).records[0].lifecycle, "cleanup_required");
      const runtime = projectService.createRuntime();
      const auditStore = createVibe64SessionStore({
        projectContextRoot: runtime.projectContextRoot,
        projectRuntimeRoot,
        projectSessionSourceRoot: path.resolve((await runtime.getSession()).metadata.source_path, "../../..")
      });
      await auditStore.createSession({
        sessionId: "session-1", runtimeKind: "genesis", metadata: (await runtime.getSession()).metadata
      });
      projectService.createRuntime = () => ({ ...runtime, store: auditStore });
      simulateControllerCrash();
      const switched = restartedCaptures(captures, {
        runtimeInfo: { ...captures.runtimeInfo, accountIdentitySignature: TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE },
        serverUserAgent: `vibe64/${MINIMUM_CODEX_VERSION} (upgraded server)`,
        failDeletes: deleteFailures,
        stopRuntimeResult: { stopped: false, processExitVerified: false }
      });
      const restarted = createRestartedController({ session, captures: switched, projectService });
      const result = await restarted.deleteDetachedChatThread("session-1", {
        executionProfile, threadId: first.threadId
      });
      const succeeds = deleteFailures === 0;
      assert.equal(result.ok, succeeds, JSON.stringify(result));
      assert.deepEqual(switched.deletes, [first.threadId]);
      assert.equal(switched.stopRuntimes, 0, "Cleanup must not stop the shared main-chat runtime");
      assert.deepEqual(switched.resumes, [], "Cleanup must not resume the previous account's work");
      assert.deepEqual(switched.turns, []);
      assert.equal((await ledger.readAll()).records.length, succeeds ? 0 : 1);
      const audit = await auditStore.readBackgroundTask("session-1", "codex-helper-cleanup");
      assert.equal(audit.status, succeeds ? "ready" : "failed");
      assert.ok(audit.events.some((event) => succeeds
        ? event.retiredThreadIds.includes(first.threadId)
        : event.failed.some((failure) => failure.threadId === first.threadId)));
      if (!succeeds) {
        await restarted.executionProfileModelCatalog("session-1");
        assert.equal((await ledger.readAll()).records.length, 0, "Next helper admission retries cleanup");
        assert.deepEqual(switched.deletes, [first.threadId, first.threadId]);
        assert.equal(switched.stopRuntimes, 0);
      }
    });
  });
}

test("helper admission retries same-account cleanup without a controller restart", async () => {
  await withConversationController(async ({ captures, controller, projectRuntimeRoot, subscribers }) => {
    const executionProfile = sourceExplanationHelperProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile, outputSchema: sourceExplanationOutputSchema(), prompt: "Disposable helper."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, { text: JSON.stringify({ answer: "Done." }) });
    const first = await pending;
    captures.failDeletes = 1;
    assert.equal((await controller.deleteDetachedChatThread("session-1", {
      executionProfile, threadId: first.threadId
    })).ok, false);
    const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
    assert.equal((await ledger.readAll()).records.length, 1);
    await controller.executionProfileModelCatalog("session-1");
    assert.equal((await ledger.readAll()).records.length, 0);
    assert.deepEqual(captures.deletes, [first.threadId, first.threadId]);
  });
});

for (const failureIndex of [0, 1]) {
  test(`mixed account-switch cleanup keeps failure visible at position ${failureIndex}`, async () => {
    await withConversationController(async ({ session, captures, controller, projectRuntimeRoot, projectService,
      simulateControllerCrash, subscribers }) => {
      captures.uniqueThreadIds = true;
      for (let index = 1; index <= 2; index += 1) {
        const pending = controller.runDetachedChatTurn("session-1", {
          executionProfile: sourceExplanationHelperProfile(),
          outputSchema: sourceExplanationOutputSchema(), prompt: "Disposable helper."
        });
        await waitForCapturedTurns(captures, index);
        completeDetachedTurn(subscribers, {
          threadId: `conversation-${index}`, turnId: `turn-${index}`,
          text: JSON.stringify({ answer: "Done." })
        });
        assert.equal((await pending).ok, true);
      }
      simulateControllerCrash();
      const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
      const { records } = await ledger.readAll();
      assert.equal(records.length, 2);
      for (const record of records) {
        await ledger.write({
          ...record, lifecycle: "cleanup_required", revision: record.revision + 1,
          updatedAt: new Date(Date.parse(record.updatedAt) + 1).toISOString()
        }, { expected: record });
      }
      const runtime = projectService.createRuntime();
      const auditStore = createVibe64SessionStore({
        projectContextRoot: runtime.projectContextRoot, projectRuntimeRoot,
        projectSessionSourceRoot: path.resolve((await runtime.getSession()).metadata.source_path, "../../..")
      });
      await auditStore.createSession({
        sessionId: "session-1", runtimeKind: "genesis", metadata: (await runtime.getSession()).metadata
      });
      projectService.createRuntime = () => ({ ...runtime, store: auditStore });
      let deleteIndex = 0;
      const switched = restartedCaptures(captures, {
        runtimeInfo: { ...captures.runtimeInfo, accountIdentitySignature: TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE },
        deleteThreadHandler(threadId) {
          if (deleteIndex++ === failureIndex) {
            throw new Error("Local thread deletion failed");
          }
          return { id: threadId };
        }
      });
      const restarted = createRestartedController({ session, captures: switched, projectService });
      await assert.rejects(restarted.executionProfileModelCatalog("session-1"), {
        code: "vibe64_codex_helper_ownership_blocked"
      });
      const failedId = records[failureIndex].threadId;
      const retiredId = records[1 - failureIndex].threadId;
      assert.deepEqual((await ledger.readAll()).records.map((record) => record.threadId), [failedId]);
      const audit = await auditStore.readBackgroundTask("session-1", "codex-helper-cleanup");
      assert.equal(audit.status, "failed");
      assert.deepEqual(audit.details.failed.map((failure) => failure.threadId), [failedId]);
      assert.deepEqual(audit.events.at(-1).retiredThreadIds, [retiredId]);
      switched.deleteThreadHandler = null;
      await restarted.executionProfileModelCatalog("session-1");
      assert.equal((await ledger.readAll()).records.length, 0);
      const recovered = await auditStore.readBackgroundTask("session-1", "codex-helper-cleanup");
      assert.equal(recovered.status, "ready");
      assert.deepEqual(recovered.details.failed, []);
      assert.ok(recovered.events.some((event) => event.status === "failed"));
      assert.equal(switched.stopRuntimes, 0, "Cleanup must not stop the shared main-chat runtime");
      assert.deepEqual(switched.deletes, [...records.map((record) => record.threadId), failedId]);
    });
  });
}

test("a first goal prepares the ordinary main conversation before activation", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, runtime }) => {
    captures.onProviderCreated = provider => {
      provider.readGoal = async () => ({ goal: null });
      provider.setGoal = async (threadId, input) => {
        assert.ok(captures.subscribers.size);
        assert.ok(captures.threadStarts.length, "The main conversation must exist before setting a goal");
        return { goal: { ...input, threadId, status: "active", createdAt: 10 } };
      };
    };
    const result = await controller.updateGoal(sessionId, { action: "set", threadId: "", objective: "Finish the fixture" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.goal.objective, "Finish the fixture");
    assert.equal((await runtime.getSession(sessionId)).agentRuns[0].providerGoalStatus, "active");
    assert.equal(captures.threadStarts.length, 1);
  });
});

test("setting a goal uses the observed main thread and rejects overwriting a live goal", async () => {
  await withAgentMessageController(async ({ captures, runtime, sessionId, terminalService }) => {
    assert.equal((await terminalService.ensureAgentSession(sessionId)).ok, true);
    const provider = captures.provider;
    let goal = null;
    const calls = [];
    provider.isHelperProvider = () => false;
    provider.readGoal = async () => ({ goal });
    provider.setGoal = async (threadId, input) => {
      assert.ok(captures.subscribers.size, "A goal needs an observer before activation");
      calls.push({ threadId, ...input });
      goal = { threadId, ...input, status: "active", createdAt: 100 };
      return { goal };
    };
    const input = { action: "set", threadId: provider.threadId, objective: "Finish the fixture", tokenBudget: 5000 };
    assert.equal((await terminalService.readAgentGoal(sessionId)).threadId, provider.threadId);
    assert.equal((await terminalService.updateAgentGoal(sessionId, { ...input, tokenBudget: 0 })).ok, false);
    assert.equal((await terminalService.updateAgentGoal(sessionId, { ...input, threadId: "old-thread" })).ok, false);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const writing = runtime.store.runSessionExclusive(sessionId, "agent-write-mode", async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    try {
      const blocked = await terminalService.updateAgentGoal(sessionId, input);
      assert.equal(blocked.code, "vibe64_agent_write_mode_busy", JSON.stringify(blocked));
      assert.deepEqual(calls, []);
    } finally { release.resolve(); await writing; }
    const created = await terminalService.updateAgentGoal(sessionId, input);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.deepEqual(calls, [{ threadId: provider.threadId, objective: input.objective, tokenBudget: 5000 }]);
    assert.equal((await runtime.getSession(sessionId)).agentRuns[0].providerGoalStatus, "active");
    assert.equal((await terminalService.updateAgentGoal(sessionId, input)).ok, false);
    assert.equal(calls.length, 1);
  }, { throughTerminalService: true });
});

test("goal UI controls reject stale goals and pause without interrupting the current turn", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => {
    const started = await controller.sendMessage(sessionId, { message: "Exercise goal controls", messageId: "goal-control-test" });
    assert.equal(started.ok, true);
    const provider = captures.provider;
    const goal = { threadId: provider.threadId, status: "active", objective: "Finish fixture", createdAt: 10, tokensUsed: 99 };
    const subscriptionCount = captures.subscribers.size;
    const calls = [];
    provider.isHelperProvider = () => false;
    provider.readGoal = async () => ({ goal: { ...goal } });
    provider.setGoalStatus = async (threadId, status) => {
      calls.push(status);
      assert.equal(threadId, goal.threadId);
      goal.status = status;
      return { goal: { ...goal } };
    };
    provider.interruptTurn = async () => { calls.push("interrupt"); provider.status = "interrupted"; return {}; };
    assert.equal((await controller.readGoal(sessionId)).goal.tokensUsed, 99);
    const input = { action: "pause", threadId: goal.threadId, objective: goal.objective, createdAt: goal.createdAt };
    assert.equal((await controller.updateGoal(sessionId, { ...input, threadId: "another-thread" })).ok, false);
    assert.equal((await controller.updateGoal(sessionId, { ...input, objective: "older goal" })).ok, false);
    assert.deepEqual(calls, []);
    const paused = await controller.updateGoal(sessionId, input);
    assert.equal(paused.ok, true, JSON.stringify(paused));
    assert.deepEqual(calls, ["paused"]);
    assert.equal((await runtime.getSession(sessionId)).agentRuns[0].active, true);
    const resumed = await controller.updateGoal(sessionId, { ...input, action: "resume" });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.goal.tokensUsed, 99);
    assert.equal(calls.at(-1), "active");
    assert.equal(captures.subscribers.size, subscriptionCount, "Goal controls added another listener for the same provider");
    for (const status of ["complete", "budgetLimited"]) {
      goal.status = status;
      assert.equal((await controller.updateGoal(sessionId, { ...input, action: "resume" })).ok, false);
      assert.equal((await controller.updateGoal(sessionId, input)).ok, false);
    }
  });
});

for (const status of ["active", "paused", "blocked", "usageLimited", "budgetLimited"]) {
  test(`cancelling an unfinished goal (${status}) preserves its conversation`, async () => {
    await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => {
      assert.equal((await controller.sendMessage(sessionId, {
        message: "Exercise goal cancellation", messageId: "goal-cancel-test"
      })).ok, true);
      const provider = captures.provider;
      const input = { action: "cancel", threadId: provider.threadId, objective: "Finish fixture", createdAt: 10 };
      let goal = { ...input, status };
      const calls = [];
      provider.isHelperProvider = () => false;
      provider.readGoal = async () => ({ goal });
      provider.clearGoal = async (threadId) => {
        calls.push(threadId);
        goal = null;
        return { cleared: true };
      };
      provider.setGoalStatus = async () => assert.fail("Cancel must not resume or mark the goal complete");
      provider.resumeThread = async () => assert.fail("Cancel must not resume the conversation");
      provider.interruptTurn = async () => assert.fail("Cancel must preserve the current ordinary turn");
      const before = await runtime.store.readConversationLog(sessionId);
      for (const stale of [{ threadId: "another-thread" }, { objective: "Older goal" }, { createdAt: 9 }]) {
        assert.equal((await controller.updateGoal(sessionId, { ...input, ...stale })).ok, false);
      }
      assert.deepEqual(calls, []);
      const cancelled = await controller.updateGoal(sessionId, input);
      assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
      assert.equal(cancelled.goal, null);
      assert.equal((await controller.readGoal(sessionId)).goal, null);
      assert.deepEqual(calls, [input.threadId]);
      assert.deepEqual(await runtime.store.readConversationLog(sessionId), before);
      const run = (await runtime.getSession(sessionId)).agentRuns[0];
      assert.equal(run.active, true, "Clearing a goal must not release an executing turn's ownership");
      assert.equal(run.providerGoalStatus, "");
    });
  });
}

test("failed goal cancellation preserves the goal for retry", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    assert.equal((await controller.sendMessage(sessionId, {
      message: "Exercise cancellation failure", messageId: "goal-cancel-failure"
    })).ok, true);
    const provider = captures.provider;
    provider.isHelperProvider = () => false;
    const goal = { threadId: provider.threadId, status: "blocked", objective: "Finish fixture", createdAt: 10 };
    provider.readGoal = async () => ({ goal });
    provider.clearGoal = async () => { throw new Error("Codex unavailable"); };
    await assert.rejects(controller.updateGoal(sessionId, { ...goal, action: "cancel" }), /Codex unavailable/);
    assert.deepEqual((await controller.readGoal(sessionId)).goal, goal);
  });
});

test("goal Resume respects Save admission and protects the gap before a native turn starts", async () => {
  await withAgentMessageController(async ({ captures, runtime, sessionId, terminalService }) => {
    assert.equal((await terminalService.ensureAgentSession(sessionId)).ok, true);
    const provider = captures.provider;
    const goal = { threadId: provider.threadId, status: "paused", objective: "Finish fixture", createdAt: 10 };
    const writes = [];
    provider.readGoal = async () => ({ goal: { ...goal } });
    provider.setGoalStatus = async (_threadId, status) => {
      writes.push(status);
      goal.status = status;
      return { goal: { ...goal } };
    };
    const input = { action: "resume", threadId: goal.threadId, objective: goal.objective, createdAt: goal.createdAt };
    const saveEntered = Promise.withResolvers();
    const releaseSave = Promise.withResolvers();
    const stopBeforeGit = new Error("Stop this fixture before Git publication.");
    const saving = assert.rejects(terminalService.saveSessionWork(sessionId, {
      async onRepositoryWriteAcquired() {
        saveEntered.resolve();
        await releaseSave.promise;
        throw stopBeforeGit;
      }
    }), (error) => error === stopBeforeGit);
    await saveEntered.promise;
    try {
      const blocked = await terminalService.updateAgentGoal(sessionId, input);
      assert.equal(blocked.code, "vibe64_agent_write_mode_busy");
      assert.deepEqual(writes, []);
    } finally {
      releaseSave.resolve();
      await saving;
    }

    const resumed = await terminalService.updateAgentGoal(sessionId, input);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.deepEqual(writes, ["active"]);
    assert.equal(provider.status, "idle", "The native scheduler has not started its turn yet");
    const pending = (await runtime.getSession(sessionId)).agentRuns.find((run) => run.providerGoalThreadId === goal.threadId);
    assert.equal(pending.providerGoalStatus, "active");
    assert.equal(pending.active, false, "Do not invent a running provider turn");
    await assert.rejects(terminalService.saveSessionWork(sessionId), { code: "vibe64_session_save_agent_active" });
    const earlyMessage = await terminalService.sendAgentMessage(sessionId, {
      message: "Keep the migration small.", messageId: "goal-message-before-native-turn"
    });
    assert.equal(earlyMessage.operationOutcome, "active_turn_not_ready");
    assert.equal(earlyMessage.retryable, true);
    assert.equal(captures.turns.length, 0, "A message replaced the pending native goal turn");
    assert.equal((await runtime.getSession(sessionId)).agentRuns[0].providerGoalStatus, "active");

    provider.status = "inProgress";
    provider.turnId = "native-goal-turn";
    for (const subscriber of captures.subscribers) {
      subscriber(turnStarted({ threadId: provider.threadId, turnId: provider.turnId }));
    }
    await waitForSessionValue(() => runtime.getSession(sessionId), (session) => (
      session.agentRuns.some((run) => run.active && run.providerTurnId === provider.turnId)
    ), "the resumed goal's native turn to enter normal lifecycle tracking");
    await assert.rejects(terminalService.saveSessionWork(sessionId), { code: "vibe64_session_save_agent_active" });
    const steering = await terminalService.sendAgentMessage(sessionId, {
      message: "Keep the migration small.", messageId: "goal-message-with-native-turn"
    });
    assert.equal(steering.ok, true, JSON.stringify(steering));
    assert.equal(captures.steers.length, 1);
    assert.equal(captures.steers[0].turnId, provider.turnId);

    provider.interruptTurn = async () => { throw new Error("Pausing a goal must not interrupt its turn"); };
    const paused = await runtime.store.runSessionExclusive(sessionId, "agent-write-mode", () => (
      terminalService.updateAgentGoal(sessionId, { ...input, action: "pause" })
    ));
    assert.equal(paused.acquired, true);
    assert.equal(paused.value.ok, true, JSON.stringify(paused.value));
    const pausedRun = (await runtime.getSession(sessionId)).agentRuns.find((run) => run.providerGoalThreadId === goal.threadId);
    assert.equal(pausedRun.providerGoalStatus, "paused");
    assert.equal(pausedRun.active, true);
    await assert.rejects(terminalService.saveSessionWork(sessionId), { code: "vibe64_session_save_agent_active" });
    completeAgentMessageHarnessTurn(captures, provider, provider.turnId, "Finished the current turn after pausing the goal.");
    await waitForSessionValue(() => runtime.getSession(sessionId), (session) => (
      session.agentRuns.some((run) => run.providerGoalStatus === "paused" && !run.active)
    ), "the paused goal's current turn to finish normally");
    await assert.rejects(terminalService.saveSessionWork(sessionId, {
      onRepositoryWriteAcquired() { throw stopBeforeGit; }
    }), (error) => error === stopBeforeGit);
    const messageWhilePaused = await terminalService.sendAgentMessage(sessionId, {
      message: "Review the checkpoint.", messageId: "goal-message-while-paused"
    });
    assert.equal(messageWhilePaused.ok, true, JSON.stringify(messageWhilePaused));
    assert.equal(captures.turns.length, 1, "A paused goal prevented an ordinary new message");
  }, { throughTerminalService: true });
});

test("clearing the current goal releases pending Resume ownership while stale thread events do not", async () => {
  await withAgentMessageController(async ({ captures, runtime, sessionId, terminalService }) => {
    assert.equal((await terminalService.ensureAgentSession(sessionId)).ok, true);
    const provider = captures.provider;
    const goal = { threadId: provider.threadId, status: "paused", objective: "Finish fixture", createdAt: 10 };
    provider.readGoal = async () => ({ goal: { ...goal } });
    provider.setGoalStatus = async (_threadId, status) => {
      goal.status = status;
      return { goal: { ...goal } };
    };
    const resumed = await terminalService.updateAgentGoal(sessionId, {
      action: "resume", threadId: goal.threadId, objective: goal.objective, createdAt: goal.createdAt
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    for (const subscriber of captures.subscribers) {
      subscriber({ method: "thread/goal/cleared", params: { threadId: "another-thread" } });
    }
    await assert.rejects(terminalService.saveSessionWork(sessionId), { code: "vibe64_session_save_agent_active" });
    for (const subscriber of captures.subscribers) {
      subscriber({ method: "thread/goal/cleared", params: { threadId: goal.threadId } });
    }
    await waitForSessionValue(() => runtime.getSession(sessionId), (session) => (
      session.agentRuns.some((run) => run.providerGoalThreadId === goal.threadId && run.providerGoalStatus === "")
    ), "the cleared goal to release pending native work");
    const stopBeforeGit = new Error("Stop this fixture before Git publication.");
    await assert.rejects(terminalService.saveSessionWork(sessionId, {
      onRepositoryWriteAcquired() { throw stopBeforeGit; }
    }), (error) => error === stopBeforeGit);
  }, { throughTerminalService: true });
});

test("clearing a goal settles its finalizing chat turn without another provider status read", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    captures.finalText = "The work is ready.";
    assert.equal((await controller.sendMessage(sessionId, {
      message: "Finish this goal.", messageId: "goal-cleared-final"
    })).ok, true);
    const provider = captures.provider;
    const threadId = provider.threadId;
    const turnId = provider.turnId;
    emitCodexNotification(captures.subscribers, threadGoalUpdated({ threadId, turnId }));
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active", "the goal to become active");
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "goal-cleared-answer", phase: "final_answer", text: "The work is ready.", threadId, turnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, turnCompleted({ threadId, turnId }));
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.state === VIBE64_AGENT_RUN_STATE.FINALIZING, "the goal-owned final result");
    const readThreadStatus = provider.readThreadStatus;
    provider.readThreadStatus = async () => { throw new Error("Goal clearing already proves that continuation stopped."); };
    try {
      emitCodexNotification(captures.subscribers, { method: "thread/goal/cleared", params: { threadId } });
      await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
        (run) => run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED && run.providerGoalStatus === "",
        "the cleared goal's final result to settle");
      const conversation = await store.readConversationLog(sessionId);
      assert.deepEqual(conversation.flatMap((turn) => turn.assistant ? [turn.assistant.text] : []), ["The work is ready."]);
    } finally {
      provider.readThreadStatus = readThreadStatus;
    }
  });
});

test("a goal event from an old subscribed thread cannot reconcile the replacement thread", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    assert.equal((await controller.ensureThread(sessionId)).ok, true);
    const provider = captures.provider;
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      patch: {
        state: VIBE64_AGENT_RUN_STATE.COMPLETED,
        providerThreadId: "replacement-thread",
        providerGoalThreadId: "replacement-thread",
        providerGoalStatus: "active"
      }
    });
    let statusReads = 0;
    provider.readThreadStatus = async () => { statusReads += 1; return { status: "idle" }; };
    const handled = Promise.withResolvers();
    captures.onSessionChanged = (_sessionId, event) => {
      if (event.reason === "codex-goal") handled.resolve();
    };
    emitCodexNotification(captures.subscribers, {
      method: "thread/goal/cleared", params: { threadId: provider.threadId }
    });
    await handled.promise;
    assert.equal(statusReads, 0, "A stale goal event read its old provider thread");
    const run = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(run.providerThreadId, "replacement-thread");
    assert.equal(run.providerGoalThreadId, "replacement-thread");
    assert.equal(run.providerGoalStatus, "active");
  });
});

for (const recordedThread of [false, true]) {
  test(`connection checks recover a stale Codex busy record (thread recorded: ${recordedThread})`, async () => {
    await withAgentMessageController(async ({ captures, sessionId, store, terminalService }) => {
      assert.equal((await terminalService.ensureAgentSession(sessionId)).ok, true);
      const provider = captures.provider;
      await store.writeAgentRunEvent(sessionId, "codex_app_server", {
        event: { kind: "observation-lost" },
        patch: {
          state: VIBE64_AGENT_RUN_STATE.STARTING,
          providerStatus: "observation_lost",
          ...(recordedThread ? { providerThreadId: provider.threadId } : {})
        }
      });
      const notifications = [];
      captures.onSessionChanged = (_id, event) => notifications.push(event);
      provider.resumeThread = async () => { throw new Error("Stale-record recovery must not resume work"); };
      const stopBeforeGit = new Error("Repository admission recovered.");
      await assert.rejects(terminalService.updateSessionWork(sessionId, {
        onRepositoryWriteAcquired() { throw stopBeforeGit; }
      }), error => error === stopBeforeGit);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await terminalService.ensureAgentSession(sessionId);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, false);
      }
      const run = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(run.active, false);
      assert.equal(run.state, VIBE64_AGENT_RUN_STATE.INTERRUPTED);
      assert.equal(run.providerThreadId, provider.threadId);
      assert.equal(run.events.filter(event => event.kind === "codex-observation-stop-recovered").length, 1);
      assert.equal(notifications.filter(event => event.reason === "codex-observation-stop-recovered").length, 1);
      assert.equal(captures.turns.length, 0);
      assert.deepEqual(await store.readConversationLog(sessionId), []);
      await assert.rejects(terminalService.updateSessionWork(sessionId, {
        onRepositoryWriteAcquired() { throw stopBeforeGit; }
      }), error => error === stopBeforeGit);
    }, { throughTerminalService: true });
  });
}

for (const condition of ["active turn", "active goal", "unknown goal", "unknown status", "read failure", "newer run"]) {
  test(`stale Codex recovery preserves the busy record with ${condition}`, async () => {
    await withAgentMessageController(async ({ captures, sessionId, store, terminalService }) => {
      assert.equal((await terminalService.ensureAgentSession(sessionId)).ok, true);
      await store.writeAgentRunEvent(sessionId, "codex_app_server", {
        event: { kind: "observation-lost" },
        patch: { state: VIBE64_AGENT_RUN_STATE.STARTING, providerStatus: "observation_lost" }
      });
      const provider = captures.provider;
      provider.resumeThread = async () => { throw new Error("Recovery must not resume work"); };
      if (condition === "active goal") provider.readGoal = async () => ({ goal: { status: "active" } });
      if (condition === "unknown goal") provider.readGoal = async () => ({});
      provider.readThreadStatus = async () => {
        if (condition === "read failure") throw new Error("Status unavailable");
        if (condition === "newer run") {
          await store.writeAgentRunEvent(sessionId, "codex_app_server", {
            patch: { state: VIBE64_AGENT_RUN_STATE.RUNNING, providerStatus: "inProgress", providerThreadId: provider.threadId }
          });
        }
        return { status: condition === "active turn" ? "inProgress" : condition === "unknown status" ? "unknown" : "idle" };
      };
      await terminalService.ensureAgentSession(sessionId);
      const run = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(run.active, true);
      assert.equal(run.events.some(event => event.kind === "codex-observation-stop-recovered"), false);
      await assert.rejects(terminalService.updateSessionWork(sessionId), { code: "vibe64_session_update_agent_active" });
      assert.equal(captures.turns.length, 0);
    }, { throughTerminalService: true });
  });
}

test("startup recovers a stopped Codex busy record without resuming its conversation", async () => {
  await withAgentMessageController(async ({ captures, controller, controllerOptions, sessionId, store }) => {
    assert.equal((await controller.ensureThread(sessionId)).ok, true);
    await controller.closeAllForSession(sessionId);
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: { kind: "observation-lost" },
      patch: { state: VIBE64_AGENT_RUN_STATE.STARTING, providerStatus: "observation_lost" }
    });
    captures.onProviderCreated = provider => {
      provider.status = "notLoaded";
      provider.resumeThread = async () => { throw new Error("Startup recovery must not resume work"); };
    };
    const restarted = createCodexTerminalController(controllerOptions);
    try {
      const result = await restarted.reconcileThreads([{ sessionId }]);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, false);
      assert.equal(captures.turns.length, 0);
    } finally {
      await restarted.closeAllForSession(sessionId);
    }
  });
});

for (const phase of ["status", "controls", "failed controls"]) {
  test(`Codex connection checks respect changeover during ${phase}`, { timeout: 15_000 }, async () => {
    await withAgentMessageController(async ({ captures, controller, sessionId }) => {
      assert.equal((await controller.ensureThread(sessionId)).ok, true);
      const provider = captures.provider;
      const checkingReached = Promise.withResolvers();
      const releaseCheck = Promise.withResolvers();
      const closingReached = Promise.withResolvers();
      const releaseClose = Promise.withResolvers();
      const readStatus = provider.readThreadStatus;
      const pauseCheck = async () => {
        checkingReached.resolve();
        await releaseCheck.promise;
      };
      if (phase === "status") {
        provider.readThreadStatus = async () => {
          await pauseCheck();
          return readStatus();
        };
      } else {
        provider.ensureThreadControls = async () => {
          await pauseCheck();
          if (phase === "failed controls") {
            await captures.providerOptions.at(-1).prepareThreadEnvironment({});
          }
          return { recovered: false };
        };
      }
      let stops = 0;
      provider.stopThreadForObservationLoss = async () => {
        stops += 1;
        closingReached.resolve();
        await releaseClose.promise;
      };
      const checking = controller.ensureThread(sessionId);
      await checkingReached.promise;
      const closing = controller.closeAllForSession(sessionId, { changeover: true });
      try {
        await closingReached.promise;
        releaseCheck.resolve();
        const result = await checking;
        assert.equal(provider.observationFailure, undefined, "deliberate closure is not observation loss");
        assert.equal(result.ok, false, "a late check cannot announce that the closing connection is ready");
        assert.equal(result.code, "vibe64_agent_session_changed");
      } finally {
        releaseCheck.resolve();
        releaseClose.resolve();
        await closing;
        await checking;
      }
      assert.equal(stops, 1, "only the deliberate changeover owns Stop");
      assert.equal(captures.turns.length, 0, "connection maintenance must not start a turn");
    });
  });
}

test("Codex control-check failure still stops observation on the current connection", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    assert.equal((await controller.sendMessage(sessionId, { message: "Work", messageId: "control-failure" })).ok, true);
    const provider = captures.provider;
    const failure = new Error("Current controls could not be verified");
    provider.ensureThreadControls = async () => { throw failure; };
    let stops = 0;
    provider.stopThreadForObservationLoss = async () => { stops += 1; };
    assert.equal((await controller.ensureThread(sessionId)).ok, false);
    assert.equal(provider.observationFailure, failure);
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerStatus === "observation_lost" && !run.active, "current connection observation stop");
    assert.equal(stops, 1);
    assert.equal(captures.turns.length, 1, "recovery must not replay the message");
  });
});

for (const fallback of [false, true]) {
  test(`Codex observation loss verifies ${fallback ? "runtime exit" : "thread stop"} and requires explicit Send`, async () => {
    await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
      assert.equal((await controller.sendMessage(sessionId, { message: "Work", messageId: "loss-owner" })).ok, true);
      const provider = captures.provider;
      const threadId = provider.threadId;
      let nativeStops = 0;
      provider.stopThreadForObservationLoss = async (id) => {
        nativeStops += 1;
        assert.equal(id, threadId);
        const pending = await store.readAgentRun(sessionId, "codex_app_server");
        assert.equal(pending.providerStatus, "observation_lost");
        assert.equal(pending.active, true, "ownership stays active until stop proof");
        if (fallback) throw new Error("Control connection lost");
        provider.status = "idle";
      };
      await provider.failObservation(new Error("Transcript observation failed"));
      assert.equal(nativeStops, 1);
      assert.equal(captures.stopRuntimes, fallback ? 1 : 0);
      const stopped = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(stopped.state, VIBE64_AGENT_RUN_STATE.INTERRUPTED);
      assert.equal(stopped.providerStatus, "observation_lost");
      const ready = await controller.ensureThread(sessionId);
      assert.equal(ready.ok, true, "a suspended conversation remains usable for explicit Send");
      assert.equal(ready.observationStopped, true);
      assert.equal(captures.turns.length, 1);
      const continued = await controller.sendMessage(sessionId, { message: "Continue", messageId: "explicit-after-loss" });
      assert.equal(continued.ok, true, JSON.stringify(continued));
      assert.equal(captures.turns.length, 2);
      assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, true);
    });
  });
}

test("Codex retains ownership and refuses new Send when neither thread nor runtime stop is verified", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "unverified-owner" });
    const provider = captures.provider;
    provider.stopThreadForObservationLoss = async () => { throw new Error("Control unavailable"); };
    captures.stopRuntimeResult = { stopped: false };
    await assert.rejects(provider.failObservation(new Error("Observation lost")));
    const run = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(run.active, true);
    assert.equal(run.providerStatus, "observation_lost");
    const sent = await controller.sendMessage(sessionId, { message: "Continue", messageId: "must-not-overlap" });
    assert.equal(sent.ok, false);
    assert.equal(captures.turns.length, 1);
    captures.stopRuntimeResult = { stopped: true };
    await provider.failObservation(new Error("Retry stop"));
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, false);
  });
});

test("Codex connection checks retry an unconfirmed observation stop before reconnecting", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const diagnostics = [];
    captures.onDiagnostic = (event) => diagnostics.push(event);
    await controller.sendMessage(sessionId, { message: "Work", messageId: "recover-stop-owner" });
    const provider = captures.provider;
    const threadId = provider.threadId;
    provider.stopThreadForObservationLoss = async () => { throw new Error("Control unavailable"); };
    captures.stopRuntimeResult = { stopped: false };
    await assert.rejects(provider.failObservation(new Error("Observation lost", {
      cause: new Error("Connection closed; token=private-test-token")
    })));
    assert.equal(diagnostics[0].event, "vibe64.codex_observation.lost");
    assert.match(diagnostics[0].cause, /Connection closed/);
    assert.equal(JSON.stringify(diagnostics).includes("private-test-token"), false);
    assert.ok(diagnostics.some((event) => event.event === "vibe64.codex_observation.stop_failed"));
    const blocked = await controller.ensureThread(sessionId);
    assert.equal(blocked.ok, false);
    assert.equal(captures.stopRuntimes, 2, "a connection check retries the retained stop owner");
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, true);
    captures.stopRuntimeResult = { stopped: true };
    const recovered = await controller.ensureThread(sessionId);
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, false);
    assert.equal(captures.turns.length, 1, "recovery must not replay the message");
    assert.equal(captures.threadStarts.length, 1, "recovery preserves the conversation");
    const continued = await controller.sendMessage(sessionId, { message: "Continue", messageId: "after-recovered-stop" });
    assert.equal(continued.ok, true, JSON.stringify(continued));
    assert.equal(captures.provider.threadId, threadId);
    assert.equal(captures.turns.length, 2);
  });
});

test("temporary Codex retains ownership after observation loss and retries the same stop owner", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    const conversation = await controller.createConversation(sessionId, { ephemeral: true });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    const conversationId = conversation.conversationId;
    const turn = await controller.startConversationTurn(sessionId, {
      conversationId, ephemeral: true, message: "Work"
    });
    assert.equal(turn.ok, true, JSON.stringify(turn));
    const provider = captures.provider;
    provider.stopThreadForObservationLoss = async () => { throw new Error("Control unavailable"); };
    captures.stopRuntimeResult = { stopped: false };
    await assert.rejects(provider.failObservation(new Error("Observation lost")));
    const pending = await controller.readConversation(sessionId, { conversationId, ephemeral: true });
    assert.equal(pending.status, "inProgress");
    assert.match(pending.error, /stop is not yet confirmed/);
    assert.equal(await controller.hasActiveTemporaryConversation(sessionId), true);
    const blocked = await controller.startConversationTurn(sessionId, {
      conversationId, ephemeral: true, message: "Must not overlap"
    });
    assert.equal(blocked.ok, false);
    assert.equal(captures.stopRuntimes, 2, "failed Send retries the same unconfirmed stop");
    captures.stopRuntimeResult = { stopped: true };
    const stopped = await controller.stopConversation(sessionId, { conversationId, ephemeral: true, runId: turn.runId });
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    assert.equal(await controller.hasActiveTemporaryConversation(sessionId), false);
    assert.equal(captures.stopRuntimes, 3);
    assert.equal(captures.turns.length, 1);
  });
});

test("a suspended Codex goal remains readable and only explicit Resume clears its stop barrier", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "goal-loss-owner" });
    const provider = captures.provider;
    const goal = { threadId: provider.threadId, status: "active", objective: "Finish fixture", createdAt: 10, tokensUsed: 99 };
    provider.isHelperProvider = () => false;
    provider.readGoal = async () => ({ goal: { ...goal } });
    provider.stopThreadForObservationLoss = async () => { goal.status = "paused"; provider.status = "idle"; };
    provider.setGoalStatus = async (_threadId, status) => {
      assert.ok(captures.subscribers.size, "Resume requires its observer first");
      assert.notEqual((await store.readAgentRun(sessionId, "codex_app_server")).providerStatus, "observation_lost");
      goal.status = status;
      return { goal: { ...goal } };
    };
    await provider.failObservation(new Error("Observation failed"));
    assert.equal((await controller.readGoal(sessionId)).goal.status, "paused");
    await assert.rejects(provider.resumeThread(provider.threadId), /observation|stopped/);
    emitCodexNotification(captures.subscribers, turnStarted({ threadId: provider.threadId, turnId: "obsolete-successor" }));
    await controller.ensureThread(sessionId);
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, false);
    const result = await controller.updateGoal(sessionId, {
      action: "resume", threadId: provider.threadId, objective: goal.objective, createdAt: goal.createdAt
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.goal.status, "active");
    assert.equal(result.goal.tokensUsed, 99);
  });
});

test("Codex stops when its notification queue cannot save commentary", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "commentary-storage-loss" });
    const provider = captures.provider;
    let stops = 0;
    provider.stopThreadForObservationLoss = async () => { stops += 1; provider.status = "idle"; };
    const write = store.writeConversationCommentaryMessage;
    store.writeConversationCommentaryMessage = async () => { throw new Error("Commentary storage failed"); };
    try {
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: "unsaved-commentary", phase: "commentary", text: "Working", threadId: provider.threadId, turnId: provider.turnId
      }));
      await waitForSessionValue(
        () => store.readAgentRun(sessionId, "codex_app_server"),
        (run) => run?.providerStatus === "observation_lost" && run.active === false,
        "a verified stop after failed commentary persistence"
      );
      assert.equal(stops, 1);
      assert.equal(captures.turns.length, 1);
    } finally { store.writeConversationCommentaryMessage = write; }
  });
});

test("Codex streams answer chunks before persistence, replaces the live answer and rejects late output", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store, projectService, runtime }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "stream-work" });
    const { threadId, turnId } = captures.provider;
    const snapshots = [];
    captures.onSessionChanged = (_id, event) => {
      if (event.payload?.conversationStream) snapshots.push(event.payload.conversationStream);
    };
    const params = { threadId, turnId, itemId: "stream-answer" };
    let hydrations = 0;
    const createRuntime = projectService.createRuntime;
    projectService.createRuntime = (...args) => { hydrations += 1; return createRuntime(...args); };
    emitCodexNotification(captures.subscribers, { method: "item/started", params: {
      ...params, item: { id: params.itemId, type: "agentMessage", phase: "final_answer" }
    } });
    for (const delta of ["Hello", " ", "world"]) {
      emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, delta } });
    }
    await waitForSessionValue(() => store.readConversationStream(sessionId),
      (snapshot) => snapshot.messages[0]?.text === "Hello world", "incremental answer");
    await waitForSessionValue(() => snapshots.at(-1),
      (snapshot) => snapshot?.messages[0]?.text === "Hello world", "broadcast text");
    assert.equal(hydrations, 0, "text chunks must not hydrate the session runtime");
    emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
      threadId, turnId, itemId: "stream-reasoning", text: "**Checking the answer**"
    }));
    await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.thinking?.some((message) => message.text === "Checking the answer")),
      "reasoning beside streamed text");
    assert.equal(hydrations, 0, "reasoning chunks must not hydrate the session runtime");
    const reopenedStore = createVibe64SessionStore({ projectContextRoot: runtime.projectContextRoot, projectRuntimeRoot: runtime.stateRoot });
    assert.equal(reopenedStore.readConversationStream(sessionId).messages[0].text, "Hello world");
    assert.equal((await store.readConversationLog(sessionId)).some((row) => row.assistant), false);
    assert.equal(snapshots.at(-1).messages[0].text, "Hello world");
    const messageId = snapshots.at(-1).messages[0].messageId;
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      ...params, phase: "final_answer", text: "Hello world!"
    }));
    const rows = await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.assistant?.text === "Hello world!"), "saved streamed answer");
    assert.equal(rows.at(-1).assistant.messageId, messageId);
    await waitForSessionValue(() => store.readConversationStream(sessionId),
      (snapshot) => !snapshot.messages.length, "live answer removal");
    emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, delta: "late" } });
    emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, itemId: "next", delta: "Next" } });
    await waitForSessionValue(() => store.readConversationStream(sessionId),
      (snapshot) => snapshot.messages[0]?.text === "Next", "next live answer");
    assert.equal(store.readConversationStream(sessionId).messages.length, 1);
    captures.provider.interruptTurn = async () => {
      captures.provider.status = "idle";
      return { interrupted: true };
    };
    const stopped = await controller.interruptTurn(sessionId, { threadId });
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    assert.deepEqual(store.readConversationStream(sessionId).messages, []);
    emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, itemId: "after-stop", delta: "Wrong" } });
    await controller.closeAllForSession(sessionId);
    assert.deepEqual(store.readConversationStream(sessionId).messages, []);
    assert.equal((await store.readConversationLog(sessionId)).filter((row) => row.assistant).length, 1);
  });
});

test("Codex coalesces queued reasoning fragments without delaying commentary behind per-token writes", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "reasoning-burst" });
    const { threadId, turnId } = captures.provider;
    const writes = [];
    const write = store.writeConversationThinkingMessage;
    let release;
    const blockedWrite = new Promise((resolve) => { release = resolve; });
    store.writeConversationThinkingMessage = async (...args) => {
      writes.push(args[1].text);
      if (writes.length === 1) await blockedWrite;
      return write.apply(store, args);
    };
    try {
      const fragment = (itemId, delta) => emitCodexNotification(captures.subscribers, {
        method: "item/reasoning/textDelta", params: { threadId, turnId, itemId, contentIndex: 0, delta }
      });
      fragment("first", "Start ");
      await waitForSessionValue(() => writes.length, (count) => count === 1, "first reasoning write");
      for (let index = 0; index < 1_000; index += 1) fragment("first", "word ");
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        threadId, turnId, itemId: "progress", phase: "commentary", text: "Checking the files."
      }));
      for (let index = 0; index < 1_000; index += 1) fragment("second", "next ");
      release();
      await waitForSessionValue(() => store.readConversationLog(sessionId),
        (rows) => rows.some((row) => row.thinking?.some(({ text }) => text === "next ".repeat(1_000).trim())),
        "reasoning after the progress update");
      const messages = (await store.readConversationLog(sessionId)).flatMap((row) => row.messages || [])
        .filter(({ role }) => ["thinking", "commentary"].includes(role));
      assert.deepEqual(messages.map(({ text }) => text), [
        `Start ${"word ".repeat(1_000)}`.trim(), "Checking the files.", "next ".repeat(1_000).trim()
      ]);
      assert.equal(writes.length, 3, "queued fragments share a write; commentary remains between the two reasoning items");
    } finally {
      release();
      store.writeConversationThinkingMessage = write;
    }
  });
});

test("Codex exposes reasoning text live and after reload without duplicating summaries or completed items", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store, runtime }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "raw-reasoning" });
    const { threadId, turnId } = captures.provider;
    const params = { threadId, turnId, itemId: "raw-thought", contentIndex: 0 };
    const thoughts = async () => (await store.readConversationLog(sessionId)).flatMap((row) => row.thinking || []).map(({ text }) => text);
    emitCodexNotification(captures.subscribers, { method: "item/reasoning/summaryPartAdded", params: {
      ...params, summaryIndex: 0
    } });
    emitCodexNotification(captures.subscribers, { method: "item/reasoning/textDelta", params: { ...params, delta: "First " } });
    await waitForSessionValue(thoughts, (rows) => rows.includes("First"), "first raw reasoning fragment");
    emitCodexNotification(captures.subscribers, { method: "item/reasoning/textDelta", params: { ...params, delta: "step." } });
    await waitForSessionValue(thoughts, (rows) => rows.includes("First step."), "continued raw reasoning");
    emitCodexNotification(captures.subscribers, { method: "item/reasoning/textDelta", params: {
      ...params, contentIndex: 1, delta: "Second step."
    } });
    await waitForSessionValue(thoughts, (rows) => rows.length === 2, "second reasoning content part");
    emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
      threadId, turnId, itemId: params.itemId, text: "Duplicate summary"
    }));
    emitCodexNotification(captures.subscribers, { method: "item/completed", params: {
      threadId, turnId, item: { id: params.itemId, type: "reasoning", summary: [], content: ["First step.", "Second step."] }
    } });
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      threadId, turnId, itemId: "progress", phase: "commentary", text: "Checking the sources."
    }));
    await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.commentary?.some(({ text }) => text === "Checking the sources.")), "separate commentary");
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      threadId, turnId, itemId: "glm-progress", phase: null, text: "Comparing the latest figures."
    }));
    await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.commentary?.some(({ text }) => text === "Comparing the latest figures.")), "GLM commentary without a phase");
    emitCodexNotification(captures.subscribers, { method: "item/completed", params: {
      threadId, turnId, item: { id: "completed-thought", type: "reasoning", summary: [], content: ["Final check."] }
    } });
    await waitForSessionValue(thoughts, (rows) => rows.length === 3, "completed-only reasoning");
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      threadId, turnId, itemId: "answer", phase: "final_answer", text: "Done."
    }));
    await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.assistant?.text === "Done."), "final answer beside reasoning");
    assert.deepEqual(await thoughts(), ["First step.", "Second step.", "Final check."]);
    const reopened = createVibe64SessionStore({ projectContextRoot: runtime.projectContextRoot, projectRuntimeRoot: runtime.stateRoot });
    assert.deepEqual((await reopened.readConversationLog(sessionId)).flatMap((row) => row.thinking || []).map(({ text }) => text), await thoughts());
  });
});

test("phase-less Codex updates stay progress when the saved turn supplies its final answer", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "phase-less-work" });
    const { threadId, turnId } = captures.provider;
    const progress = { type: "agentMessage", id: "progress", text: "Checking Japanese sources." };
    emitCodexNotification(captures.subscribers, { method: "item/completed", params: { threadId, turnId, item: progress } });
    await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.commentary?.some(({ text }) => text === progress.text)), "phase-less live update");
    captures.threadSnapshotTurns = [{ id: turnId, status: "completed", items: [
      progress,
      { type: "commandExecution", id: "research" },
      { type: "reasoning", id: "reasoning", content: ["Raw details."] },
      { type: "agentMessage", id: "answer", text: "The researched answer." }
    ] }];
    captures.provider.status = "idle";
    emitCodexNotification(captures.subscribers, turnCompleted({ threadId, turnId }));
    const rows = await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.assistant?.text === "The researched answer."), "phase-less final answer");
    assert.deepEqual(rows.flatMap((row) => row.commentary || []).map(({ text }) => text), [progress.text]);
    assert.deepEqual(rows.filter((row) => row.assistant).map((row) => row.assistant.text), ["The researched answer."]);
  });
});

test("Codex keeps reasoning summaries when both channels are exposed and ignores opaque reasoning", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "both-reasoning-channels" });
    const { threadId, turnId } = captures.provider;
    emitCodexNotification(captures.subscribers, reasoningSummaryDelta({ threadId, turnId, itemId: "thought", text: "Readable summary" }));
    emitCodexNotification(captures.subscribers, { method: "item/reasoning/textDelta", params: {
      threadId, turnId, itemId: "thought", contentIndex: 0, delta: "Duplicate raw text"
    } });
    for (const item of [
      { id: "completed-summary", type: "reasoning", summary: ["Completed summary"], content: ["Duplicate completed content"] },
      { id: "opaque", type: "reasoning", summary: [], content: [], encryptedContent: "opaque-provider-state" }
    ]) emitCodexNotification(captures.subscribers, { method: "item/completed", params: { threadId, turnId, item } });
    emitCodexNotification(captures.subscribers, assistantItemCompleted({ threadId, turnId, phase: "final_answer", text: "Done." }));
    const rows = await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.assistant?.text === "Done."), "reasoning completion");
    assert.deepEqual(rows.flatMap((row) => row.thinking || []).map(({ text }) => text), ["Readable summary", "Completed summary"]);
    assert.doesNotMatch(JSON.stringify(rows), /Duplicate|opaque-provider-state/);
  });
});

test("durable Codex history reads exposed reasoning content and prefers available summaries", async () => {
  await withConversationController(async ({ captures, controller, projectService }) => {
    captures.persistentHistory = [{ id: "saved-turn", status: "completed", items: [
      { id: "raw", type: "reasoning", summary: [], content: ["Exposed reasoning"] },
      { id: "summary", type: "reasoning", summary: ["Readable summary"], content: ["Duplicate content"] },
      { id: "opaque", type: "reasoning", summary: [], content: [], encryptedContent: "opaque-state" },
      { id: "commentary", type: "agentMessage", phase: "commentary", text: "Working." },
      { id: "glm-commentary", type: "agentMessage", text: "Checking sources." },
      { id: "command", type: "commandExecution", command: "check" },
      { id: "answer", type: "agentMessage", text: "Done." }
    ] }];
    const { conversationId } = await controller.createConversation("session-1", { persistent: true });
    const result = await controller.readConversation("session-1", { conversationId, persistent: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.messages.map(({ role, text }) => ({ role, text })), [
      { role: "thinking", text: "Exposed reasoning" },
      { role: "thinking", text: "Readable summary" },
      { role: "commentary", text: "Working." },
      { role: "commentary", text: "Checking sources." },
      { role: "assistant", text: "Done." }
    ]);
    assert.equal(result.message, "Done.", "progress cannot be repeated in the final reply");
    await controller.closeAllForSession("session-1");
    const restarted = createRestartedController({ captures, projectService });
    try {
      const restored = await restarted.readConversation("session-1", { conversationId, persistent: true });
      assert.deepEqual(restored.messages, result.messages);
    } finally { await restarted.closeAllForSession("session-1"); }
  });
});

test("slow stream delivery combines waiting fragments without crossing reasoning or completion", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "slow-stream" });
    const { threadId, turnId } = captures.provider;
    const params = { threadId, turnId, itemId: "slow-answer" };
    const delivery = createDeterministicHold();
    const received = [];
    captures.onSessionChanged = async (_id, event) => {
      if (event.reason === "assistant-stream") {
        received.push(event.payload.conversationStream.messages[0].text);
        if (received.length === 1) {
          delivery.enter();
          await delivery.wait;
        }
      } else if (event.reason === "codex-app-server-reasoning-summary") {
        received.push("reasoning");
      }
    };
    try {
      emitCodexNotification(captures.subscribers, {
        method: "item/agentMessage/delta", params: { ...params, delta: "Start " }
      });
      await delivery.entered;
      for (const delta of "a".repeat(100)) {
        emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, delta } });
      }
      emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
        threadId, turnId, itemId: "slow-reasoning", text: "**Checking delivery**"
      }));
      for (const delta of "b".repeat(100)) {
        emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, delta } });
      }
      const text = `Start ${"a".repeat(100)}${"b".repeat(100)}`;
      emitCodexNotification(captures.subscribers, assistantItemCompleted({ ...params, phase: "final_answer", text }));
      // This fragment must stay after completion and must never revive the item.
      emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, delta: "late" } });
      delivery.release();
      await controller.closeAllForSession(sessionId);
      assert.deepEqual(received, ["Start ", `Start ${"a".repeat(100)}`, "reasoning", text]);
      assert.deepEqual(store.readConversationStream(sessionId).messages, []);
      const rows = await store.readConversationLog(sessionId);
      assert.equal(rows.at(-1).assistant.text, text);
      assert.equal(rows.at(-1).thinking.at(-1).text, "Checking delivery");
    } finally {
      delivery.release();
    }
  });
});

for (const loaded of [true, false]) {
  test(`Codex reconnect restores the saved selection and concise summaries (loaded: ${loaded})`, async () => {
    await withAgentMessageController(async ({ captures, controller, controllerOptions, sessionId }) => {
      assert.equal((await controller.ensureThread(sessionId)).ok, true);
      const expected = { model_reasoning_effort: "high", model_reasoning_summary: "concise" };
      assert.equal(captures.threadStarts[0].model, "gpt-5.5");
      assert.deepEqual(captures.threadStarts[0].config, expected);
      const { threadId } = captures.provider;
      await controller.closeAllForSession(sessionId);
      const resumed = [];
      captures.onProviderCreated = (provider) => {
        provider.threadId = threadId;
        provider.listLoadedThreads = async () => ({ data: loaded ? [threadId] : [] });
        const resume = provider.resumeThread;
        provider.resumeThread = (id, settings) => {
          resumed.push(settings);
          return resume(id, settings);
        };
      };
      const restarted = createCodexTerminalController(controllerOptions);
      try {
        const result = await restarted.reconcileThreads([{ sessionId }]);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(resumed.length, 1);
        assert.equal(resumed[0].model, "gpt-5.5");
        assert.deepEqual(resumed[0].config, expected);
      } finally {
        await restarted.closeAllForSession(sessionId);
      }
    });
  });
}

test("Codex streamed commentary disappears after completion even when saved progress is deduplicated", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "stream-commentary" });
    const { threadId, turnId } = captures.provider;
    for (const itemId of ["comment-1", "comment-2"]) {
      const params = { threadId, turnId, itemId };
      emitCodexNotification(captures.subscribers, { method: "item/started", params: {
        ...params, item: { id: itemId, type: "agentMessage", phase: "commentary" }
      } });
      emitCodexNotification(captures.subscribers, { method: "item/agentMessage/delta", params: { ...params, delta: "Checking" } });
      const live = await waitForSessionValue(() => store.readConversationStream(sessionId),
        (snapshot) => snapshot.messages[0]?.text === "Checking", "live commentary");
      assert.equal(live.messages[0].role, "commentary");
      emitCodexNotification(captures.subscribers, assistantItemCompleted({ ...params, phase: "commentary", text: "Checking" }));
      await waitForSessionValue(() => store.readConversationStream(sessionId),
        (snapshot) => !snapshot.messages.length, "completed commentary removal");
    }
    const rows = await store.readConversationLog(sessionId);
    assert.equal(rows.flatMap((row) => row.commentary || []).filter((message) => message.text === "Checking").length, 1);
  });
});

test("active-goal steering publishes independent native replies immediately and preserves their rows", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "goal-work" });
    const provider = captures.provider;
    const threadId = provider.threadId;
    const turnId = provider.turnId;
    const patches = [];
    captures.onSessionChanged = (_sessionId, event) => {
      if (event.payload?.conversationLogPatch) patches.push(event.payload.conversationLogPatch.turn);
    };
    emitCodexNotification(captures.subscribers, threadGoalUpdated({ threadId, turnId }));
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active", "active goal");
    for (const [index, question] of ["Why are you stuck?", "What will happen next?"].entries()) {
      const sent = await controller.sendMessage(sessionId, { message: question, messageId: `steer-${index}` });
      assert.equal(sent.ok, true, JSON.stringify(sent));
      assert.equal(sent.deliveryMode, "active_turn");
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: `steer-answer-${index}`, phase: "final_answer", text: "The same answer.", threadId, turnId
      }));
      const rows = await waitForSessionValue(() => store.readConversationLog(sessionId),
        (rows) => rows.filter((row) => row.assistant).length === index + 1, "immediate reply before completion");
      assert.equal(rows.at(-1).user.text, question);
      const answerId = rows.at(-1).assistant.messageId;
      await waitForSessionValue(() => patches, (patches) => patches.some((row) => row.assistant?.messageId === answerId), "realtime answer");
      const run = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(run.active, true);
      assert.equal(run.outerTurnId, "goal-work");
      assert.equal(run.events.some((event) => event.kind === "codex-app-server-result-processed"), false);
    }
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "steer-answer-0", phase: "final_answer", text: "Corrected first answer.", threadId, turnId
    }));
    const corrected = await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.assistant?.text === "Corrected first answer."), "same-item correction");
    assert.deepEqual(corrected.filter((row) => row.assistant).map((row) => [row.user.text, row.assistant.text]), [
      ["Why are you stuck?", "Corrected first answer."], ["What will happen next?", "The same answer."]
    ]);
    emitCodexNotification(captures.subscribers, turnStarted({ threadId, turnId: "successor" }));
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === "successor", "successor ownership");
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "steer-answer-1", phase: "final_answer", text: "The same answer.", threadId, turnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "unowned-answer", phase: "final_answer", text: "Must stay absent", threadId, turnId: "unowned-turn"
    }));
    const missingTurnNotification = assistantItemCompleted({
      itemId: "missing-turn-answer", phase: "final_answer", text: "Must stay absent", threadId, turnId
    });
    delete missingTurnNotification.params.turnId;
    emitCodexNotification(captures.subscribers, missingTurnNotification);
    await controller.closeAllForSession(sessionId);
    const rows = await store.readConversationLog(sessionId);
    assert.equal(rows.filter((row) => row.assistant).length, 2);
    assert.equal(JSON.stringify(rows).includes("Must stay absent"), false);
    assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).providerTurnId, "successor");
  });
});

for (const failure of ["storage", "realtime", "history"]) {
  test(`a final reply survives ${failure} failure and history recovery without duplicate publication`, async () => {
    await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
      await controller.sendMessage(sessionId, { message: "Work", messageId: `recover-${failure}` });
      const provider = captures.provider;
      provider.stopThreadForObservationLoss = async () => { provider.status = "idle"; };
      const write = store.writeConversationAssistantMessage;
      const listThreadTurns = provider.listThreadTurns;
      let unavailable = true;
      provider.listThreadTurns = (...args) => {
        if (unavailable && failure === "history") throw new Error("Native history temporarily unavailable");
        return listThreadTurns(...args);
      };
      store.writeConversationAssistantMessage = (...args) => {
        if (unavailable && failure === "storage") throw new Error("Transcript unavailable");
        return write(...args);
      };
      captures.onSessionChanged = (_id, event) => {
        if (unavailable && failure === "realtime" && event.payload?.conversationLogPatch?.turn?.assistant) {
          throw new Error("Realtime unavailable");
        }
      };
      try {
        emitCodexNotification(captures.subscribers, assistantItemCompleted({
          itemId: "recover-final", phase: "final_answer", text: "The complete reply.",
          threadId: provider.threadId, turnId: provider.turnId
        }));
        await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
          (run) => run?.providerStatus === "observation_lost" && !run.active, "verified stop after publication failure");
        assert.equal((await store.readConversationLog(sessionId)).filter((row) => row.assistant).length,
          failure === "realtime" ? 1 : 0);
        unavailable = false;
        provider.resumeThread = async () => { throw new Error("History recovery must not resume native work"); };
        const readThread = provider.readThread;
        provider.readThread = async () => { throw new Error("Saved native history is unavailable"); };
        assert.equal((await controller.ensureThread(sessionId)).ok, false);
        assert.equal((await controller.sendMessage(sessionId, { message: "Wait for history", messageId: "blocked-history" })).ok, false);
        assert.equal(captures.turns.length, 1, "failed history recovery must not admit a new turn");
        assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).providerStatus, "observation_lost");
        provider.readThread = readThread;
        assert.equal((await controller.ensureThread(sessionId)).ok, true);
        assert.equal((await controller.ensureThread(sessionId)).ok, true);
        assert.deepEqual((await store.readConversationLog(sessionId)).flatMap((row) => row.assistant ? [row.assistant.text] : []), ["The complete reply."]);
        const run = await store.readAgentRun(sessionId, "codex_app_server");
        assert.equal(run.active, false);
        assert.equal(run.providerStatus, "observation_lost");
        assert.equal(captures.turns.length, 1);
      } finally {
        unavailable = false;
        store.writeConversationAssistantMessage = write;
        provider.listThreadTurns = listThreadTurns;
      }
    });
  });
}

test("Codex live IDs and history IDs publish each reply once across replay and restart", async () => {
  await withAgentMessageController(async ({ captures, controller, controllerOptions, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "history-identity" });
    const { threadId, turnId } = captures.provider;
    const historyIds = { "msg-first": "item-4040", "msg-second": "item-4041" };
    const useHistoryIds = (provider) => {
      const list = provider.listThreadTurns;
      provider.listThreadTurns = async (...args) => {
        const page = await list(...args);
        return {
          ...page,
          data: page.data.map((turn) => ({
            ...turn,
            items: turn.items.map((item) => ({ ...item, id: historyIds[item.id] || item.id }))
          }))
        };
      };
    };
    useHistoryIds(captures.provider);
    emitCodexNotification(captures.subscribers, threadGoalUpdated({ threadId, turnId }));
    await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active", "active goal");

    const replies = () => store.readConversationLog(sessionId).then((rows) => rows.filter((row) => row.assistant));
    const bundles = [];
    captures.onSessionChanged = (_sessionId, event) => {
      if (event.payload?.conversationLogPatch) bundles.push(event.payload);
    };
    for (const [index, itemId] of Object.keys(historyIds).entries()) {
      const params = { threadId, turnId, itemId };
      emitCodexNotification(captures.subscribers, { method: "item/started", params: {
        ...params, item: { id: itemId, type: "agentMessage", phase: "final_answer" }
      } });
      emitCodexNotification(captures.subscribers, {
        method: "item/agentMessage/delta", params: { ...params, delta: "Same answer." }
      });
      const live = await waitForSessionValue(() => store.readConversationStream(sessionId),
        (stream) => stream.messages.length === 1, "live reply");
      bundles.length = 0;
      emitCodexNotification(captures.subscribers, assistantItemCompleted({ ...params, phase: "final_answer", text: "Same answer." }));
      const saved = await waitForSessionValue(replies, (rows) => rows.length === index + 1, "distinct saved reply");
      const savedMessageId = saved.at(-1).assistant.messageId;
      assert.notEqual(savedMessageId, live.messages[0].messageId);
      await waitForSessionValue(() => store.readConversationStream(sessionId),
        (stream) => !stream.messages.length, "provisional stream replaced by saved history");
      await waitForSessionValue(() => bundles,
        (events) => events.some((event) => event.conversationLogPatch.turn.assistant.messageId === savedMessageId),
        "saved reply publication");
      for (const event of bundles.filter((event) => !event.conversationStream.messages.length)) {
        assert.equal(event.conversationLogPatch.turn.assistant.messageId, savedMessageId,
          "The stream must be retired with its saved reply, not an earlier reply");
      }
    }
    const ids = (await replies()).map((row) => row.assistant.messageId);
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      threadId, turnId, itemId: "msg-first", phase: "final_answer", text: "Corrected first answer."
    }));
    await waitForSessionValue(replies, (rows) => rows[0]?.assistant.text === "Corrected first answer.", "correction to the original row");
    await controller.closeAllForSession(sessionId);

    captures.onProviderCreated = (provider) => {
      provider.threadId = threadId;
      provider.turnId = turnId;
      provider.status = "inProgress";
      useHistoryIds(provider);
    };
    const restarted = createCodexTerminalController(controllerOptions);
    try {
      assert.equal((await restarted.reconcileThreads([{ sessionId }])).ok, true);
      assert.equal((await restarted.ensureThread(sessionId)).ok, true);
      for (const [itemId, answer] of [["msg-first", "Corrected first answer."], ["msg-second", "Same answer."]]) {
        emitCodexNotification(captures.subscribers, assistantItemCompleted({
          threadId, turnId, itemId, phase: "final_answer", text: answer
        }));
      }
      await restarted.closeAllForSession(sessionId);
      assert.deepEqual((await replies()).map((row) => row.assistant.messageId), ids);
      assert.deepEqual((await replies()).map((row) => row.assistant.text), ["Corrected first answer.", "Same answer."]);
      assert.equal(captures.turns.length, 1, "history reads must not resend the prompt");
    } finally {
      await restarted.closeAllForSession(sessionId);
    }
  });
});

test("a fresh controller recovers each active-goal final by native identity without resending", async () => {
  await withAgentMessageController(async ({ captures, controller, controllerOptions, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "restart-goal" });
    const { threadId, turnId } = captures.provider;
    emitCodexNotification(captures.subscribers, threadGoalUpdated({ threadId, turnId }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "before-restart", phase: "final_answer", text: "Already saved.", threadId, turnId
    }));
    await waitForSessionValue(() => store.readConversationLog(sessionId),
      (rows) => rows.some((row) => row.assistant?.text === "Already saved."), "saved first reply");
    await controller.closeAllForSession(sessionId);
    const items = [
      { id: "before-restart", phase: "final_answer", text: "Already saved.", type: "agentMessage" },
      { id: "during-restart", phase: "final_answer", text: "Recovered while the goal continues.", type: "agentMessage" }
    ];
    captures.threadSnapshotTurns = [{ id: turnId, status: "inProgress", items }];
    captures.onProviderCreated = (provider) => {
      provider.threadId = threadId;
      provider.turnId = turnId;
      provider.status = "inProgress";
      provider.listThreadTurns = async () => ({ data: captures.threadSnapshotTurns });
      const resume = provider.resumeThread;
      provider.resumeThread = (...args) => {
        assert.ok(captures.subscribers.size, "the observer must precede resume");
        return resume(...args);
      };
    };
    const restarted = createCodexTerminalController(controllerOptions);
    try {
      assert.equal((await restarted.reconcileThreads([{ sessionId }])).ok, true);
      assert.equal((await restarted.ensureThread(sessionId)).ok, true);
      for (const item of items) {
        emitCodexNotification(captures.subscribers, assistantItemCompleted({
          itemId: item.id, phase: item.phase, text: item.text, threadId, turnId
        }));
      }
      await restarted.closeAllForSession(sessionId);
      assert.deepEqual((await store.readConversationLog(sessionId)).flatMap((row) => row.assistant ? [row.assistant.text] : []), items.map((item) => item.text));
      const run = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(run.active, true);
      assert.equal(run.outerTurnId, "restart-goal");
      assert.equal(run.providerGoalStatus, "active");
      assert.equal(captures.turns.length, 1);
    } finally {
      await restarted.closeAllForSession(sessionId);
    }
  });
});

for (const verified of [true, false]) {
  test(`startup observation failure retains its main-thread owner before registration (exit verified: ${verified})`, async () => {
    await withAgentMessageController(async ({ captures, controller, controllerOptions, sessionId, store }) => {
      await controller.sendMessage(sessionId, { message: "Work", messageId: "startup-owner" });
      const { threadId, turnId } = captures.provider;
      await controller.closeAllForSession(sessionId);
      captures.stopRuntimes = 0;
      captures.stopRuntimeResult = { stopped: verified };
      let resumes = 0;
      captures.onProviderCreated = (provider) => {
        provider.threadId = threadId;
        provider.turnId = turnId;
        provider.ensureAvailable = async () => { throw new Error("Initial connection failed"); };
        provider.resumeThread = async () => {
          resumes += 1;
          throw new Error("Must not resume");
        };
        provider.stopThreadForObservationLoss = async () => { throw new Error("Control unavailable"); };
      };
      const restarted = createCodexTerminalController(controllerOptions);
      try {
        assert.equal((await restarted.reconcileThreads([{ sessionId }])).ok, false);
        const run = await store.readAgentRun(sessionId, "codex_app_server");
        assert.equal(run.providerStatus, "observation_lost");
        assert.equal(run.active, !verified);
        assert.equal(resumes, 0);
        assert.equal(captures.turns.length, 1);
        if (!verified) {
          const sent = await restarted.sendMessage(sessionId, { message: "Must not overlap", messageId: "blocked-startup" });
          assert.equal(sent.ok, false);
          captures.stopRuntimeResult = { stopped: true };
          const stopped = await restarted.interruptTurn(sessionId, { threadId });
          assert.equal(stopped.ok, true, JSON.stringify(stopped));
          assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, false);
        }
      } finally {
        captures.stopRuntimeResult = { stopped: true };
        await restarted.closeAllForSession(sessionId);
      }
    });
  });
}

test("shared Codex runtime loss settles providers that own only temporary conversations", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const session = await runtime.getSession(sessionId);
    const secondId = "session-2";
    const secondSource = path.join(path.dirname(path.dirname(session.metadata.source_path)), secondId, "source");
    await mkdir(secondSource, { recursive: true });
    await store.createSession({
      sessionId: secondId,
      runtimeKind: "genesis",
      metadata: { ...session.metadata, source_path: secondSource }
    });
    const first = await controller.createConversation(sessionId, { ephemeral: true });
    assert.equal(first.ok, true, JSON.stringify(first));
    const firstProvider = captures.provider;
    await controller.startConversationTurn(sessionId, { conversationId: first.conversationId, ephemeral: true, message: "First temporary" });
    captures.onProviderCreated = (provider) => { provider.threadId = "22222222-2222-4222-8222-222222222222"; };
    const second = await controller.createConversation(secondId, { ephemeral: true });
    assert.equal(second.ok, true, JSON.stringify(second));
    await controller.startConversationTurn(secondId, { conversationId: second.conversationId, ephemeral: true, message: "Second temporary" });
    assert.equal(captures.providerOptions[0].runtimeDir, captures.providerOptions[1].runtimeDir);
    firstProvider.stopThreadForObservationLoss = async () => { throw new Error("Socket lost"); };
    try {
      await firstProvider.failObservation(new Error("Observation lost"));
      assert.equal(captures.stopRuntimes, 1);
      for (const [id, conversationId] of [[sessionId, first.conversationId], [secondId, second.conversationId]]) {
        assert.equal(await controller.hasActiveTemporaryConversation(id), false);
        assert.equal((await controller.readConversation(id, { conversationId, ephemeral: true })).status, "interrupted");
        assert.deepEqual(await store.readConversationLog(id), []);
      }
      assert.equal(captures.turns.length, 2);
    } finally {
      await controller.closeAllForSession(secondId);
    }
  });
});

test("a failed startup history write stops the owned turn and remains recoverable", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await controller.sendMessage(sessionId, { message: "Work", messageId: "failed-history-owner" });
    const provider = captures.provider;
    captures.threadSnapshotTurns = [{ id: provider.turnId, status: "inProgress", items: [{
      id: "snapshot-final", type: "agentMessage", phase: "final_answer", text: "Recovered reply."
    }] }];
    provider.connectionGeneration = "reattached";
    provider.listThreadTurns = async () => ({ data: captures.threadSnapshotTurns });
    let stops = 0;
    provider.stopThreadForObservationLoss = async () => {
      stops += 1;
      provider.status = "idle";
    };
    const write = store.writeConversationAssistantMessage;
    store.writeConversationAssistantMessage = async () => { throw new Error("History write failed"); };
    try {
      await controller.ensureThread(sessionId);
      await waitForSessionValue(() => store.readAgentRun(sessionId, "codex_app_server"),
        (run) => run?.providerStatus === "observation_lost" && !run.active, "verified stop for history-write failure");
      assert.equal(stops, 1);
      assert.equal((await store.readConversationLog(sessionId)).filter((row) => row.assistant).length, 0);
    } finally {
      store.writeConversationAssistantMessage = write;
    }
    provider.resumeThread = async () => { throw new Error("Recovery must not resume"); };
    assert.equal((await controller.ensureThread(sessionId)).ok, true);
    assert.equal((await controller.ensureThread(sessionId)).ok, true);
    assert.deepEqual((await store.readConversationLog(sessionId)).flatMap((row) => row.assistant ? [row.assistant.text] : []), ["Recovered reply."]);
    assert.equal(captures.turns.length, 1);
  });
});

for (const fallback of [false, true]) {
  test(`Codex retains its stop owner until stop persistence succeeds (process fallback: ${fallback})`, async () => {
    await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
      await controller.sendMessage(sessionId, { message: "Work", messageId: "stop-write-owner" });
      const provider = captures.provider;
      provider.stopThreadForObservationLoss = async () => {
        if (fallback) throw new Error("Control unavailable");
        provider.status = "idle";
      };
      const write = store.writeAgentRunEvent;
      store.writeAgentRunEvent = (...args) => {
        if (args[2]?.event?.kind === "codex-observation-stopped") throw new Error("Stop state could not be saved");
        return write(...args);
      };
      try {
        await assert.rejects(provider.failObservation(new Error("Observation lost")), /Stop state could not be saved/);
        assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).active, true);
        assert.ok(provider.observationFailure);
        assert.equal(provider.closed, 0, "failed persistence must retain the owner for Stop retry");
      } finally {
        store.writeAgentRunEvent = write;
      }
      const stopped = await controller.interruptTurn(sessionId, { threadId: provider.threadId });
      assert.equal(stopped.ok, true, JSON.stringify(stopped));
      const run = await store.readAgentRun(sessionId, "codex_app_server");
      assert.equal(run.active, false);
      assert.equal(run.providerStatus, "observation_lost");
      assert.equal(captures.turns.length, 1);
    });
  });
}

test("durable Codex chats keep native history and goal ownership across browser and controller lifetimes", async () => {
  await withConversationController(async ({ captures, controller, subscribers, projectService, calls, session }) => {
    const context = { runtime: await projectService.createRuntime(), session, routingConversationId: "saved-temporary" };
    controller = throughCommonScopedConversation(controller, context);
    const events = [];
    captures.persistentHistory = [];
    const { conversationId } = await controller.createConversation("session-1", { persistent: true });
    assert.notEqual(captures.threads.at(-1).ephemeral, true);
    captures.onSendTurn = ({ settings }) => {
      assert.ok(subscribers.size, "observation must exist before Send");
      execFileSync("sh", ["-c", "printf 'Saved edit' > durable-edit.txt"], { cwd: settings.cwd });
    };
    const started = await controller.startConversationTurn("session-1", {
      conversationId, persistent: true, messageId: "input", message: "Edit files"
    }, { onEvent: event => events.push(structuredClone(event)) });
    emitCodexNotification(subscribers, { method: "item/agentMessage/delta", params: {
      threadId: conversationId, turnId: started.runId, itemId: "answer", delta: "Edited."
    } });
    captures.persistentHistory.push({ id: "turn-1", status: "completed", items: [
      { id: "user", type: "userMessage", clientId: "input", content: [{ type: "inputText", text: "Edit files" }] },
      { id: "thought", type: "reasoning", summary: ["Checking files"] },
      { id: "answer", type: "agentMessage", phase: "final_answer", text: "Edited." }
    ] });
    captures.persistentStatus = "idle";
    captures.persistentGoal = { status: "active", objective: "Long goal" };
    let result = await controller.readConversation("session-1", { conversationId, persistent: true, messageId: "input" });
    assert.equal(result.admitted, true);
    assert.equal(result.status, "inProgress", "an active goal owns the interval between native turns");
    assert.equal(await controller.hasActiveTemporaryConversation("session-1"), true);
    assert.deepEqual(result.messages.map((message) => message.text), ["Checking files", "Edited."]);
    const firstOutputId = events[0].message.outputId;
    assert.match(firstOutputId, /^codex-[a-f0-9]{64}$/u);
    assert.equal(result.messages[1].outputId, firstOutputId, "saved output keeps its exact native live-item identity");
    assert.notEqual(result.messages[1].id, firstOutputId, "history and live identities remain distinct");
    assert.equal(Object.hasOwn(result.messages[0], "outputId"), false, "reasoning does not acquire an assistant-item identity");
    assert.equal(calls.some(([method]) => method === "stopObserved"), false, "browser reads must not stop work");
    captures.persistentHistory.push({ id: "turn-2", status: "completed", items: [
      { id: "answer", type: "agentMessage", phase: "final_answer", text: "Edited again." }
    ] });
    result = await controller.readConversation("session-1", { conversationId, persistent: true });
    assert.equal(new Set(result.messages.map((message) => message.id)).size, 3,
      "provider item ids reused by another turn must remain distinct");
    for (const message of result.messages) assert.match(message.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
    const secondOutputId = result.messages.at(-1).outputId;
    assert.match(secondOutputId, /^codex-[a-f0-9]{64}$/u);
    assert.notEqual(secondOutputId, firstOutputId, "another native turn reusing the item id has its own output identity");
    await controller.closeAllForSession("session-1");
    assert.equal(captures.persistentGoal.status, "paused");
    assert.deepEqual(captures.deletes, [], "runtime shutdown must preserve durable native chats");
    const restarted = throughCommonScopedConversation(createRestartedController({ captures, projectService, subscribers: new Set() }), context);
    try {
      result = await restarted.readConversation("session-1", { conversationId, persistent: true });
      assert.equal(result.messages.at(-1).text, "Edited again.");
      assert.deepEqual(result.messages.filter(message => message.role === "assistant").map(message => message.outputId),
        [firstOutputId, secondOutputId], "native output identities survive controller restart");
      assert.equal(captures.turns.length, 1, "restoration must not send a new turn");
      await restarted.stopConversation("session-1", { conversationId, persistent: true });
      await restarted.deleteConversation("session-1", { conversationId, persistent: true });
      assert.deepEqual(captures.deletes, [conversationId]);
      assert.equal(await readFile(path.join(session.metadata.source_path, "durable-edit.txt"), "utf8"), "Saved edit");
    } finally { await restarted.closeAllForSession("session-1"); }
  });
});

test("connected durable chat reads reuse observation without rebuilding the execution environment", async () => {
  await withConversationController(async ({ captures, controller }) => {
    captures.persistentHistory = [{ id: "saved-turn", status: "completed", items: [
      { id: "answer", type: "agentMessage", phase: "final_answer", text: "Saved reply" }
    ] }];
    const { conversationId } = await controller.createConversation("session-1", { persistent: true });
    let environmentReads = 0;
    captures.onProjectEnvironment = () => { environmentReads += 1; };
    for (let i = 0; i < 2; i += 1) {
      const result = await controller.readConversation("session-1", { conversationId, persistent: true });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.messages.at(-1).text, "Saved reply");
    }
    assert.equal(environmentReads, 0, "polling uses the connected native observer");
    captures.connected = false;
    await controller.readConversation("session-1", { conversationId, persistent: true });
    assert.ok(environmentReads > 0, "reconnection still prepares the current environment");
    captures.connected = true;
    environmentReads = 0;
    const sent = await controller.startConversationTurn("session-1", {
      conversationId, persistent: true, messageId: "next", message: "Continue"
    });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.ok(environmentReads > 0, "Send still prepares the current execution environment");
  });
});

test("a fresh Codex observer pauses an unobserved temporary goal before exposing recovery", async () => {
  await withConversationController(async ({ captures, controller, calls }) => {
    captures.persistentHistory = [];
    captures.persistentGoal = { status: "active", objective: "Do work" };
    captures.persistentStatus = "idle";
    const restored = await controller.readConversation("session-1", { conversationId: "saved-native", persistent: true });
    assert.equal(restored.status, "interrupted");
    assert.equal(captures.persistentGoal.status, "paused");
    assert.ok(calls.some(([method, id]) => method === "stopObserved" && id === "saved-native"));
    assert.deepEqual(captures.turns, []);
  });
});


test("persistent Codex streams reply deltas from Send through completion", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    captures.persistentHistory = [];
    const { conversationId } = await controller.createConversation("session-1", { persistent: true });
    const events = [];
    captures.onSendTurn = ({ turnId }) => {
      emitCodexNotification(subscribers, { method: "item/agentMessage/delta", params: {
        threadId: conversationId, turnId, itemId: "answer", delta: '{"kind":"reply","text":"Hello '
      } });
    };
    const started = await controller.startConversationTurn("session-1", {
      conversationId, persistent: true, messageId: "streaming", message: "Hello"
    }, { onEvent: (event) => events.push(event) });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(events[0]?.text, '{"kind":"reply","text":"Hello ', "capture text sent before the start acknowledgement");
    const params = { threadId: conversationId, turnId: started.runId, itemId: "answer" };
    emitCodexNotification(subscribers, { method: "item/agentMessage/delta", params: { ...params, delta: "world" } });
    assert.equal(events[1].text, "world");
    assert.equal(events[1].messageId, "answer");
    assert.deepEqual(events[1].message.nativeIdentity, { threadId: conversationId, turnId: started.runId });
    assert.equal(events[1].message.turnId, `${conversationId}:${started.runId}`);
    assert.equal(events[1].message.delta, "world");
    assert.match(events[1].message.messageId, /^codex-[a-f0-9]{64}$/u);
    assert.equal(events[1].message.outputId, events[1].message.messageId);
    assert.notEqual(events[1].message.messageId, events[1].messageId, "normalized output identity does not reuse a bare provider item id");
    emitCodexNotification(subscribers, { method: "turn/completed", params: {
      threadId: conversationId, turn: { id: started.runId, status: "completed" }
    } });
    emitCodexNotification(subscribers, { method: "item/agentMessage/delta", params: { ...params, delta: "late" } });
    assert.equal(events.length, 2);
  });
});

test("persistent Codex waits beyond three minutes but retains completion, Stop, connection loss and explicit deadlines", async (t) => {
  for (const outcome of ["complete", "stop", "disconnect", "deadline"]) {
    await withConversationController(async ({ captures, controller, subscribers }) => {
      captures.persistentHistory = [];
      const { conversationId } = await controller.createConversation("session-1", { persistent: true });
      const started = await controller.startConversationTurn("session-1", {
        conversationId, persistent: true, messageId: "slow-turn", message: "Continue the investigation"
      });
      assert.equal(started.ok, true, JSON.stringify(started));
      captures.persistentHistory = [{ id: started.runId, status: "inProgress", items: [] }];
      captures.persistentStatus = "inProgress";
      t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
      try {
        const count = subscribers.size;
        let settled = false;
        const pending = controller.waitForConversationTurn("session-1", {
          conversationId, runId: started.runId, persistent: true,
          ...(outcome === "deadline" ? { timeoutMs: 200_000 } : {})
        });
        void pending.then(() => { settled = true; });
        await waitForSessionValue(() => subscribers.size, (size) => size > count, "native completion watcher");
        t.mock.timers.tick(180_001);
        await flushPromises();
        assert.equal(settled, false, "an interactive turn is not a three-minute Helper job");
        if (outcome === "complete") {
          completeDetachedTurn(subscribers, { threadId: conversationId, turnId: started.runId, text: "Investigation finished" });
        } else if (outcome === "stop") {
          assert.equal((await controller.stopConversation("session-1", { conversationId, persistent: true })).ok, true);
        } else if (outcome === "disconnect") {
          captures.connectionGeneration += 1;
          t.mock.timers.tick(1000);
        } else {
          t.mock.timers.tick(19_999);
        }
        const result = await pending;
        assert.equal(result.ok, outcome === "complete", JSON.stringify(result));
        if (outcome === "complete") assert.equal(result.rawText, "Investigation finished");
        else assert.match(result.error, outcome === "stop" ? /stopped/i : outcome === "disconnect" ? /connection.*lost/i : /timed out/i);
        assert.equal(captures.turns.length, 1, "waiting never resends the request");
      } finally {
        t.mock.timers.reset();
      }
    });
  }
});

test("temporary Codex steers its exact active native conversation without starting a second turn", async () => {
  await withConversationController(async ({ captures, controller, calls, projectService, session }) => {
    controller = throughCommonScopedConversation(controller, {
      runtime: await projectService.createRuntime(), session, routingConversationId: "saved-temporary"
    });
    captures.persistentHistory = [];
    const { conversationId } = await controller.createConversation("session-1", { persistent: true });
    const first = await controller.startConversationTurn("session-1", { conversationId, persistent: true, messageId: "first", message: "Investigate" });
    const steered = await controller.startConversationTurn("session-1", { conversationId, persistent: true, steer: true, messageId: "guidance", message: "Read logs first" });
    assert.equal(steered.ok, true);
    assert.equal(steered.runId, first.runId);
    assert.equal(steered.deliveryMode, "steer");
    assert.equal(captures.turns.length, 1);
    assert.deepEqual(calls.find(([kind]) => kind === "steer")[1], {
      threadId: conversationId, turnId: first.runId, message: "Read logs first", options: { clientUserMessageId: "guidance" }
    });
  });
});

test("Main browser facade uses the original native owner and action authority without Colleague", { timeout: 30_000 }, async () => {
  const actions = createActionCatalogue();
  const access = { allowed: true, user: { ...os.userInfo(), role: "owner" } };
  await withAgentMessageController(async ({ captures, projectService, runtime, sessionId, store, terminalService }) => {
    registerVibe64ActionContext(actions, {
      projectContext: {
        projectsRoot: path.dirname(runtime.projectContextRoot),
        async readWorkspaceProject() {
          return { project: { projectRoot: runtime.projectContextRoot, projectRuntimeRoot: runtime.stateRoot } };
        }
      },
      resolveUser: async () => access.user,
      async authorizeProject({ slug }) {
        if (!access.allowed || slug !== "test-project") {
          throw Object.assign(new Error("Project access denied."), { statusCode: 403 });
        }
      }
    });
    const sessions = createSessionService({ actions, project: projectService, terminals: terminalService });
    actions.register({ contributorId: "test.main-terminals", domain: "vibe64-terminals",
      actions: createTerminalActions({ terminals: terminalService }).map(definition => ({
        channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition
      })) });
    actions.register({ contributorId: "test.main-sessions", domain: "vibe64-sessions",
      actions: createSessionActions({ sessions }).map(definition => ({
        channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition
      })) });
    const app = Fastify();
    const http = createCapabilityHttpRuntime({ fastify: app, actions });
    const config = {
      surfaceDefinitions: { app: { enabled: true, requiresWorkspace: false } },
      assistantSurfaces: { app: { settingsSurfaceId: "app", configScope: "global" } }
    };
    const hosting = createCapabilityRuntime({
      providers: [Vibe64ConversationsProvider, AssistantFeature],
      inputs: { "runtime.actions": actions, "runtime.http": http, "runtime.config": config,
        "runtime.env": {}, "vibe64.sessions": sessions }
    });
    let release;
    try {
      await hosting.start();
      http.start();
      await app.ready();
      assert.equal(hosting.diagnostics().capabilityIds.includes("vibe64.colleague"), false);
      assert.equal(hosting.diagnostics().providerOrder.filter(id => id === "assistant.runtime").length, 1);
      assert.equal(http.router.list().filter(route => route.method === "GET" &&
        route.path === "/api/assistant/:surfaceId/conversations/:conversationId").length, 1);
      assert.equal(actions.listDefinitions().some(action => action.id === "vibe64.colleague.conversation.subscribe"), false);

      const id = mainConversationId({ projectSlug: "test-project", sessionId });
      const url = `/api/assistant/app/conversations/${encodeURIComponent(id)}`;
      const headers = { host: "localhost", origin: "http://localhost", "x-jskit-surface": "app" };
      async function request(method, suffix = "", payload) {
        return app.inject({ method, url: `${url}${suffix}`, headers, ...(payload ? { payload } : {}) });
      }
      const before = (await store.readSession(sessionId)).metadata;
      for (let index = 1; index <= 23; index += 1) {
        await store.writeConversationUserMessage(sessionId, { messageId: `historical-${index}`, text: `Earlier question ${index}` });
        await store.writeConversationAssistantMessage(sessionId, { messageId: `historical-answer-${index}`, text: `Earlier answer ${index}` });
      }
      const history = await store.readConversationLog(sessionId);
      const initial = await request("GET");
      assert.equal(initial.statusCode, 200, initial.body);
      assert.equal(initial.json().id, id);
      assert.equal(initial.json().pagination.limit, 20);
      assert.deepEqual(initial.json().conversationLog, history.slice(3));
      assert.equal(initial.json().configuration, undefined);
      assert.equal(initial.json().capabilities.goals, true);
      assert.equal(captures.provider, null, "opening a browser reader does not prepare a native provider");
      const initialGoal = await request("GET", "/goal");
      assert.equal(initialGoal.statusCode, 200, initialGoal.body);
      assert.equal(initialGoal.json().status, "available");
      assert.equal(initialGoal.json().goal, null);
      assert.equal(initialGoal.json().target.segmentId, null);
      assert.equal(initialGoal.json().target.capabilities.goalCommands.set.delivery, "control");
      assert.equal(captures.provider, null, "canonical goal reads retain original passive preparation");
      assert.deepEqual((await store.readSession(sessionId)).metadata, before);
      const older = await request("GET", `?beforeTurnId=${encodeURIComponent(initial.json().pagination.nextBeforeTurnId)}&limit=20`);
      assert.equal(older.statusCode, 200, older.body);
      assert.deepEqual(older.json().conversationLog, history.slice(0, 3));

      const requestContext = { surface: "app", channel: "internal", requestMeta: { request: { headers } } };
      const events = [];
      await actions.execute({ actionId: "vibe64.conversation.subscribe",
        input: { targetSurfaceId: "app", conversationId: id }, context: requestContext,
        deps: { onEvent: event => events.push(event), onRelease: value => { release = value; } } });
      const retained = await sessions.browserConversations.open({ id, context: requestContext });
      captures.onProviderCreated = provider => {
        provider.interruptTurn = async () => { provider.status = "interrupted"; return { interrupted: true }; };
      };
      for (const forged of [{ actor: { id: "forged" } }, { context: { sessionId } }, { host: { nativeTools: true } }]) {
        const rejected = await request("POST", "/messages", { messageId: "forged", text: "Never send", ...forged });
        assert.equal(rejected.statusCode, 400, rejected.body);
      }
      assert.equal(captures.turns.length, 0);
      const input = { messageId: "main-browser-send", text: "Read the actual source", data: {
        displayMessage: "A visible request", originId: "main-browser-test"
      } };
      const sent = await request("POST", "/messages", input);
      assert.equal(sent.statusCode, 202, sent.body);
      assert.equal(sent.json().ok, true, sent.body);
      assert.equal(sent.json().delivered, true);
      for (const field of ["session", "turnId", "threadId", "nativeIdentity", "status", "workdir"]) {
        assert.equal(Object.hasOwn(sent.json(), field), false, `Product acceptance must not fabricate or expose ${field}`);
      }
      const duplicate = await request("POST", "/messages", input);
      assert.equal(duplicate.statusCode, 202, duplicate.body);
      assert.deepEqual(duplicate.json(), { ok: true, delivered: true, messageId: input.messageId, refreshRecommended: false },
        "the original session result projects delivery, without the native owner's duplicate field");
      assert.equal(captures.turns.length, 1);
      assert.equal(captures.threadStarts.length, 1);
      const accepted = (await store.readConversationLog(sessionId)).filter(turn => turn.user?.messageId === input.messageId);
      assert.equal(accepted.length, 1);
      assert.equal(accepted[0].user.text, "A visible request");
      assert.equal(accepted[0].metadata.runtime, undefined, "the original history has no reconstructed runtime-v3 metadata");
      assert.equal((await terminalService.agentSessionState(sessionId, { runtime })).turn.id, captures.provider.turnId);
      assert.ok(events.some(event => event.type === "accepted"));
      assert.ok(events.every(event => event.conversationId === id && !Object.hasOwn(event, "session") && !Object.hasOwn(event, "nativeResult")));

      const eventCount = events.length;
      access.allowed = false;
      assert.equal((await request("GET")).statusCode, 403);
      await assert.rejects(retained.read(), { statusCode: 403 });
      for (const subscriber of captures.subscribers) subscriber({ method: "item/agentMessage/delta", params: {
        threadId: captures.provider.threadId, turnId: captures.provider.turnId, itemId: "revoked-live-reply", delta: "Private progress"
      } });
      await waitForSessionValue(() => store.readConversationStream(sessionId),
        stream => stream?.messages.some(message => message.text === "Private progress"), "the existing owner to publish after access revocation");
      assert.equal(events.length, eventCount, "the same runtime reauthorizes each retained browser publication");
      assert.equal((await request("POST", "/messages", { messageId: "revoked", text: "Do not send" })).statusCode, 403);
      assert.equal(captures.turns.length, 1);
      access.allowed = true;
      const postTurnWrites = [];
      const runSessionExclusive = store.runSessionExclusive;
      const onSessionChanged = captures.onSessionChanged;
      let idlePublished = false;
      captures.onSessionChanged = async (id, event) => {
        if (id === sessionId && event.reason === "codex-app-server-turn-idle") idlePublished = true;
        await onSessionChanged?.(id, event);
      };
      store.runSessionExclusive = (...args) => {
        const pending = runSessionExclusive(...args);
        if (idlePublished && args[0] === sessionId && args[1] === "agent-write-mode" &&
            ["assistant-routing", "prepare-workspace"].includes(args[3]?.operation)) {
          postTurnWrites.push({ operation: args[3].operation, pending });
        }
        return pending;
      };
      try {
        const stopped = await request("POST", "/cancel", {});
        assert.equal(stopped.statusCode, 200, stopped.body);
        assert.equal(stopped.json().ok, true, stopped.body);
        assert.equal(stopped.json().operationOutcome, "interrupted", stopped.body);
        assert.equal(Object.hasOwn(stopped.json(), "interrupted"), false,
          "the original normal Stop result does not flatten its native RPC result");
        assert.equal(captures.provider.status, "interrupted");
        const stoppedRun = await store.readAgentRun(sessionId, "codex_app_server");
        assert.equal(stoppedRun.active, false);
        assert.equal(stoppedRun.providerStatus, "interrupted");
        assert.deepEqual(postTurnWrites.map(write => write.operation).sort(), ["assistant-routing", "prepare-workspace"],
          "the original idle publication schedules both application write operations");
        // Native Stop does not await the original background routing/setup work.
        // Join those exact gate promises before the single zero-wait selection.
        await Promise.all(postTurnWrites.map(write => write.pending));
      } finally {
        store.runSessionExclusive = runSessionExclusive;
        captures.onSessionChanged = onSessionChanged;
      }
      const selected = await request("POST", "/selection", { selection: {
        assistantRouting: { mode: "senior", review: false, workflowEngineId: "codex" }
      } });
      assert.equal(selected.statusCode, 200, selected.body);
      assert.equal(selected.json().ok, true, selected.body);
      assert.equal(JSON.parse((await store.readSession(sessionId)).metadata.assistant_routing).mode, "senior");
      assert.equal(captures.turns.length, 1, "selecting the existing workflow changes policy without sending work");
      const goal = await request("POST", "/goal", { action: "set", expectedSegmentId: null,
        objective: "Reject client representation flags", canonical: true });
      assert.equal(goal.statusCode, 400, goal.body);
      assert.equal(captures.turns.length, 1, "the canonical route cannot accept a client representation flag");
      assert.equal((await store.readSession(sessionId)).metadata.runtime, undefined);
    } finally {
      access.allowed = true;
      release?.();
      await hosting.shutdown();
      await app.close();
    }
  }, { actions, throughTerminalService: true });
});

test("Main browser delivery inspection preserves original receipts while native work continues", { timeout: 15_000 }, async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    let authorized = true;
    const hostProvider = controller.conversationProvider;
    const common = createConversationRuntime({ engine: "codex", authorize: async () => authorized,
      host: { nativeTools: true, conversation: ({ id, context, input, operation }) => operation === "dispose"
        ? prepareSessionConversationDisposal(hostProvider, id, context, input)
        : createSessionConversationBinding(hostProvider, id, {
        ...context, prepareInput: async input => input
      }) }
    });
    captures.onConversationChanged = event => common.publishNative(event);
    captures.onProviderCreated = provider => {
      provider.interruptTurn = async () => { provider.status = "interrupted"; return { interrupted: true }; };
    };
    try {
      const conversation = await common.open({ id: sessionId, context: { runtime } });
      assert.deepEqual(await conversation.inspectDelivery({ messageId: "never-sent" }), { status: "unknown", messageId: "never-sent" });
      assert.equal(captures.provider, null, "inspection without a native identity cannot start a provider");
      const sent = await conversation.send({ messageId: "inspect-working", text: "Keep working" });
      assert.equal((await conversation.read()).status, "working");
      assert.deepEqual(await conversation.inspectDelivery({ messageId: "inspect-working" }), {
        status: "accepted", messageId: "inspect-working", turnId: sent.turnId, duplicate: true
      }, "an actual authored receipt remains readable during the original active turn");
      await waitForSessionValue(() => store.readMetadataValue(sessionId, "assistant_changeover"),
        value => value && !JSON.parse(value).engines.codex.pending, "the original send to finish its journal commit");
      const originalHistory = await store.readConversationLog(sessionId);
      const originalJournal = await store.readMetadataValue(sessionId, "assistant_changeover");
      const nativeHistory = (await captures.provider.readThread()).turns;
      captures.threadSnapshotTurns = [...nativeHistory, {
        id: "native-receipt-only", status: "completed", items: [{ type: "userMessage", id: "native-item-only",
          clientId: "native-only-accepted", content: [{ type: "text", text: "Known only to native history" }] }]
      }];
      const nativeOnly = await conversation.inspectDelivery({ messageId: "native-only-accepted" });
      assert.deepEqual(nativeOnly, { status: "accepted", messageId: "native-only-accepted", duplicate: true });
      assert.equal(Object.hasOwn(nativeOnly, "turnId"), false, "native identity is not a fabricated authored turn");
      assert.deepEqual(await conversation.inspectDelivery({ messageId: "still-unknown" }), { status: "unknown", messageId: "still-unknown" });
      assert.deepEqual(await store.readConversationLog(sessionId), originalHistory);
      assert.equal(await store.readMetadataValue(sessionId, "assistant_changeover"), originalJournal);
      assert.equal(captures.turns.length, 1, "inspection never resubmits a prompt");

      const readThread = captures.provider.readThread;
      captures.provider.readThread = async (...args) => {
        const result = await readThread(...args);
        authorized = false;
        return result;
      };
      await assert.rejects(conversation.inspectDelivery({ messageId: "native-only-accepted" }), { code: "conversation_forbidden" });
      authorized = true;
      captures.provider.readThread = readThread;
      assert.equal((await conversation.cancel()).stopped, true);
      await conversation.wait();

      const journal = JSON.parse(await store.readMetadataValue(sessionId, "assistant_changeover"));
      const pending = { messageId: "recovered-pending", threadId: captures.provider.threadId, attempted: true,
        message: "Retained native prompt", displayMessage: "Retained authored text", displayAttachments: [],
        turnMetadata: { engineId: "codex" }, seen: journal.engines.codex.seen };
      journal.engines.codex.pending = pending;
      await store.writeMetadataValue(sessionId, "assistant_changeover", JSON.stringify(journal));
      captures.threadSnapshotTurns.push({ id: "native-pending", status: "completed", items: [{
        type: "userMessage", id: "native-pending-item", clientId: pending.messageId,
        content: [{ type: "text", text: pending.message }]
      }] });
      const writeMetadata = store.writeMetadataValue;
      let receiptBeforeClear = false;
      store.writeMetadataValue = async (id, name, value) => {
        if (name === "assistant_changeover" && !JSON.parse(value).engines.codex.pending) {
          receiptBeforeClear = await store.conversationMessageIdExists(sessionId, pending.messageId);
          assert.equal(receiptBeforeClear, true, "the original recovery owner writes the authored receipt before clearing its journal");
        }
        return writeMetadata(id, name, value);
      };
      let recovered;
      try { recovered = await conversation.inspectDelivery({ messageId: pending.messageId }); }
      finally { store.writeMetadataValue = writeMetadata; }
      assert.equal(recovered.status, "accepted");
      const row = (await store.readConversationLog(sessionId)).find(turn => turn.user?.messageId === pending.messageId);
      assert.equal(row.user.text, pending.displayMessage);
      assert.equal(recovered.turnId, row.turnId);
      assert.equal(receiptBeforeClear, true);
      assert.equal(JSON.parse(await store.readMetadataValue(sessionId, "assistant_changeover")).engines.codex.pending, undefined);
      assert.equal(captures.turns.length, 1, "recovery uses native evidence without sending again");
      assert.equal((await store.readSession(sessionId)).metadata.runtime, undefined);
    } finally {
      authorized = true;
      await common.close();
    }
  }, { bindConversation: true });
});

test("Main Codex canonical goals preserve original result policy, pinned targets and passive availability", { timeout: 15_000 }, async t => {
  await withAgentMessageController(async ({ captures, controllerOptions, projectService, runtime, sessionId, store, terminalService }) => {
    const options = { runtime, vibe64User: { ...os.userInfo(), role: "owner" } };
    await writeCodexAuthMarker(controllerOptions.env.VIBE64_SYSTEM_ROOT, { connected: true, loginId: randomUUID() });
    const selection = { ...JSON.parse((await store.readSession(sessionId)).metadata.assistant_selection), selectionSource: "explicit" };
    await createAssistantRoutingStore({ systemRoot: controllerOptions.env.VIBE64_SYSTEM_ROOT }).write({
      codex: { senior: selection, junior: selection }
    }, 0);
    await store.writeMetadataValue(sessionId, "assistant_routing", JSON.stringify({ mode: "senior", workflowEngineId: "codex" }));
    const actions = createActionCatalogue();
    registerVibe64ActionContext(actions, {
      projectContext: { projectsRoot: path.dirname(runtime.projectContextRoot), async readWorkspaceProject() {
        return { project: { projectRoot: runtime.projectContextRoot, projectRuntimeRoot: runtime.stateRoot } };
      } },
      resolveUser: async () => options.vibe64User,
      authorizeProject: async ({ slug }) => assert.equal(slug, "test-project")
    });
    const sessions = createSessionService({ actions, project: projectService, terminals: terminalService });
    actions.register({ contributorId: "test.canonical-main-goals", domain: "vibe64",
      actions: [...createSessionActions({ sessions }), ...createTerminalActions({ terminals: terminalService })]
        .map(definition => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
    const goalFacade = await sessions.browserConversations.open({
      id: mainConversationId({ projectSlug: "test-project", sessionId }), context: { channel: "internal", surface: "app" }
    });
    const goalProject = (await actions.execute({ actionId: ACTION_READ_CONVERSATION_CONTEXT,
      input: { projectSlug: "test-project", sessionId }, context: { channel: "internal", surface: "app" } })).project;
    // Keep raw service calls in the same project namespace; each command still supplies its own actor.
    await runWithProjectRequestContext({ ...goalProject, vibe64User: null }, async () => {
      const acknowledgement = createDeterministicHold();
      const releaseAcknowledgement = () => acknowledgement.release();
      t.signal.addEventListener("abort", releaseAcknowledgement, { once: true });
      let goal = null;
      let available = true;
      let clearFailure = null;
      const nativeCalls = [];
      captures.onProviderCreated = provider => {
        provider.isAvailable = () => available && provider.closed === 0;
        provider.readGoal = async threadId => { nativeCalls.push(["read", threadId]); return { goal }; };
        provider.setGoal = async (threadId, input) => {
          nativeCalls.push(["set", threadId, input]);
          assert.ok(captures.subscribers.size, "the original observer exists before goal activation");
          assert.equal(captures.threadStarts.length, 1);
          goal = { ...input, threadId, status: "active", createdAt: 100, tokensUsed: 0, timeUsedSeconds: 0 };
          acknowledgement.enter();
          await acknowledgement.wait;
          return { goal };
        };
        provider.setGoalStatus = async (threadId, status) => {
          nativeCalls.push(["status", threadId, status]);
          goal = { ...goal, status };
          return { goal };
        };
        provider.clearGoal = async threadId => {
          nativeCalls.push(["clear", threadId]);
          if (clearFailure) throw clearFailure;
          goal = null;
          return {};
        };
        provider.interruptTurn = async () => assert.fail("An initial goal command has no ordinary turn to interrupt");
      };
      const writeMetadata = store.writeMetadataValue;
      const pinWrites = [];
      store.writeMetadataValue = async (id, name, value) => {
        if (name === "assistant_routing_goal") {
          const pin = JSON.parse(value);
          const namespace = codexTerminalNamespace(id);
          const admission = freezeTerminalNamespaceAdmission(namespace, { owner: "canonical-goal-policy-proof" });
          try {
            assert.equal(admission.ok, true, "application result policy runs after the original namespace admission releases");
          } finally { if (admission.ok) thawTerminalNamespaceAdmission(namespace, { owner: "canonical-goal-policy-proof" }); }
          assert.equal((await store.readAgentRun(id, "codex_app_server")).providerGoalStatus, goal?.status || "",
            "the original goal reconciliation precedes the application pin");
          pinWrites.push(pin);
        }
        return writeMetadata(id, name, value);
      };
      let setting;
      let stopping;
      try {
        const firstRead = await goalFacade.readGoal();
        assert.equal(firstRead.status, "available");
        assert.equal(firstRead.goal, null);
        assert.equal(firstRead.target.segmentId, null);
        assert.equal(firstRead.target.capabilities.goalBudgets, true);
        assert.equal(captures.provider, null, "an unstarted goal read does not acquire a native provider");
        let settled = false;
        setting = goalFacade.updateGoal({ action: "set", expectedSegmentId: null,
          expectedGoalId: null, objective: "Keep the original control", tokenBudget: 5000 })
          .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
        await waitForSessionValue(() => ({ settled, dispatched: nativeCalls.some(([kind]) => kind === "set") }),
          value => value.settled || value.dispatched, "canonical goal dispatch");
        if (settled) assert.fail(`Canonical Set ended before native acknowledgement: ${JSON.stringify(await setting)}`);
        assert.equal(settled, false);
        assert.equal((await store.readSession(sessionId)).metadata.assistant_routing_goal, undefined);
        assert.equal((await store.readConversationLog(sessionId)).length, 0);
        assert.equal((await store.runSessionExclusive(sessionId, "agent-write-mode", () => null)).acquired, false,
          "the original service Set owns agent-write admission through its acknowledgement");
        let stopSettled = false;
        stopping = terminalService.interruptAgentTurn(sessionId, {}, { ...options, session: await store.readSession(sessionId) })
          .then(value => { stopSettled = true; return { value }; }, error => { stopSettled = true; return { error }; });
        await flushPromises();
        assert.equal(stopSettled, false, "service Stop waits for the original routing admission gate");
        assert.equal(settled, false);
        assert.equal(nativeCalls.some(([kind]) => kind === "status" || kind === "clear"), false);
        acknowledgement.release();
        const completed = await setting;
        assert.equal(completed.error, undefined);
        const stopped = await stopping;
        assert.equal(stopped.error, undefined);
        assert.equal(stopped.value.ok, true, JSON.stringify(stopped.value));
        assert.equal(stopped.value.operationOutcome, "already_idle", "ordinary Stop does not pause the native goal");
        assert.equal(nativeCalls.some(([kind]) => kind === "status" || kind === "clear"), false);
        const created = completed.value;
        assert.equal(created.status, "active", JSON.stringify(created));
        assert.equal(created.tokenBudget, 5000);
        assert.equal(created.updatedAt, undefined, "the raw native fixture has no invented update timestamp");
        assert.equal(pinWrites.length, 1);
        assert.equal(pinWrites[0].objective, "Keep the original control");
        const threadId = captures.provider.threadId;
        const segmentId = `codex:${threadId}`;
        assert.equal(created.id, createHash("sha256").update(JSON.stringify([threadId, 100, goal.objective])).digest("hex"));
        assert.equal(nativeCalls.filter(([kind]) => kind === "set").length, 1);
        assert.equal(captures.turns.length, 0, "native controls never manufacture a prompt turn");
        assert.doesNotMatch(JSON.stringify(created), /"(?:nativeResult|session|threadId|completeResult)"\s*:/u);
        const readView = await goalFacade.readGoal();
        const visible = readView.goal;
        assert.equal(readView.target.segmentId, segmentId);
        assert.equal(readView.target.capabilities.goalCommands.pause.delivery, "control");
        assert.equal(visible.id, created.id);
        assert.equal(visible.objective, "Keep the original control", "display decoration does not replace the native identity tuple");
        const exactPin = (await store.readSession(sessionId)).metadata.assistant_routing_goal;
        available = false;
        const providerCount = captures.providerOptions.length;
        const readsBeforeUnavailable = nativeCalls.filter(([kind]) => kind === "read").length;
        assert.deepEqual(await terminalService.readAgentGoal(sessionId, options), { status: "unavailable", goal: null });
        await assert.rejects(terminalService.readAgentGoal(sessionId, options, { canonical: true }), {
          code: "conversation_goal_unavailable", statusCode: 503
        });
        assert.equal((await store.readSession(sessionId)).metadata.assistant_routing_goal, exactPin);
        assert.equal(captures.providerOptions.length, providerCount);
        assert.equal(nativeCalls.filter(([kind]) => kind === "read").length, readsBeforeUnavailable,
          "passive unavailable reads neither acquire a provider nor request native status");
        available = true;
        const differentSelection = { ...selection, engineId: "claude", agentId: "claude", modelProviderId: "anthropic", modelId: "sonnet" };
        await store.writeMetadataValue(sessionId, "assistant_selection", JSON.stringify(differentSelection));
        const stopOptions = { runtime, vibe64User: { username: "reader", role: "member" } };
        const pinnedRead = await terminalService.readAgentGoal(sessionId, stopOptions, { canonical: true });
        assert.equal(pinnedRead.goal.id, created.id);
        assert.equal(pinnedRead.target.segmentId, segmentId);
        assert.equal(pinnedRead.routing.selection.engineId, "codex");
        const controls = { ...stopOptions, expectedSegmentId: segmentId, expectedGoalId: created.id };
        const callsBeforeStale = nativeCalls.filter(([kind]) => kind !== "read").length;
        await assert.rejects(terminalService.updateAgentGoal(sessionId, { ...controls, action: "pause", expectedGoalId: "stale" }, { canonical: true }), /goal changed/);
        assert.equal(nativeCalls.filter(([kind]) => kind !== "read").length, callsBeforeStale);
        assert.equal((await store.readSession(sessionId)).metadata.assistant_routing_goal, exactPin);
        const paused = await terminalService.updateAgentGoal(sessionId, { ...controls, action: "pause" }, { canonical: true });
        assert.equal(paused.status, "paused");
        assert.deepEqual(nativeCalls.filter(([kind]) => kind === "status"), [["status", threadId, "paused"]]);
        const pausedPin = (await store.readSession(sessionId)).metadata.assistant_routing_goal;
        assert.equal(JSON.parse(pausedPin).status, "paused");
        await store.writeMetadataValue(sessionId, "assistant_selection", JSON.stringify(selection));
        const resumed = await terminalService.updateAgentGoal(sessionId, { ...options, action: "resume",
          expectedSegmentId: segmentId, expectedGoalId: created.id }, { canonical: true });
        assert.equal(resumed.status, "active");
        assert.equal(resumed.id, created.id);
        assert.deepEqual(nativeCalls.filter(([kind]) => kind === "status"), [["status", threadId, "paused"], ["status", threadId, "active"]]);
        const resumedPin = (await store.readSession(sessionId)).metadata.assistant_routing_goal;
        assert.equal(JSON.parse(resumedPin).objective, "Keep the original control");
        await store.writeMetadataValue(sessionId, "assistant_selection", JSON.stringify(differentSelection));
        clearFailure = new Error("Native clear was rejected");
        await assert.rejects(terminalService.updateAgentGoal(sessionId, { ...controls, action: "cancel" }, { canonical: true }), error => error === clearFailure);
        assert.equal((await store.readSession(sessionId)).metadata.assistant_routing_goal, resumedPin);
        assert.equal(goal.status, "active");
        clearFailure = null;
        assert.equal(await terminalService.updateAgentGoal(sessionId, { ...controls, action: "cancel" }, { canonical: true }), null);
        assert.equal(JSON.parse((await store.readSession(sessionId)).metadata.assistant_routing_goal).status, "complete");
        assert.equal((await store.readSession(sessionId)).metadata.assistant_selection, JSON.stringify(differentSelection),
          "pinned read and stop controls do not rebind the visible assistant");
        assert.deepEqual((await store.readConversationLog(sessionId)), []);
        const metadata = (await store.readSession(sessionId)).metadata;
        assert.equal(metadata.runtime, undefined);
        assert.equal(metadata.assistant_changeover, undefined);
        assert.equal(captures.turns.length, 0);
      } finally {
        acknowledgement.release();
        available = true;
        try { await Promise.all([setting, stopping]); }
        finally {
          store.writeMetadataValue = writeMetadata;
          t.signal.removeEventListener("abort", releaseAcknowledgement);
        }
      }
    });
  }, { throughTerminalService: true });
});

test("concurrent Main reconciliation retains the cached fallback until prune can finish", { timeout: 15_000 }, async (t) => {
  const previousDebug = process.env.VIBE64_SESSION_DEBUG;
  const diagnostics = [];
  const debug = t.mock.method(console, "info", (line) => {
    const prefix = "[VIBE64_SESSION_DEBUG] ";
    if (typeof line === "string" && line.startsWith(prefix)) {
      diagnostics.push(JSON.parse(line.slice(prefix.length)));
    }
  });
  process.env.VIBE64_SESSION_DEBUG = "1";
  try {
    await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => (
      runWithProjectRequestContext({ targetRoot: runtime.projectContextRoot }, async () => {
        assert.equal((await controller.ensureThread(sessionId)).ok, true);
        const provider = captures.provider;
        const threadId = provider.threadId;
        const loaded = createDeterministicHold();
        const fallback = createDeterministicHold();
        const pending = [];
        const settled = { first: false, second: false, prune: false };
        const previousCreated = captures.onProviderCreated;
        const getSession = runtime.getSession;
        const decorated = [];
        let listAttempts = 0;
        let resumeAttempts = 0;
        let observeSecond = false;
        let secondRead = false;
        const decorate = (current) => {
          const listLoadedThreads = current.listLoadedThreads;
          const resumeThread = current.resumeThread;
          decorated.push({ current, listLoadedThreads, resumeThread });
          current.listLoadedThreads = async () => {
            listAttempts += 1;
            loaded.enter();
            await loaded.wait;
            return { data: [] };
          };
          current.resumeThread = async (...args) => {
            resumeAttempts += 1;
            fallback.enter();
            await fallback.wait;
            return resumeThread(...args);
          };
        };
        decorate(provider);
        captures.onProviderCreated = (current) => {
          previousCreated?.(current);
          decorate(current);
        };
        runtime.getSession = (...args) => {
          if (observeSecond) secondRead = true;
          return getSession(...args);
        };
        try {
          const first = controller.reconcileThreads([{ sessionId }])
            .finally(() => { settled.first = true; });
          pending.push(first);
          await waitForSessionValue(() => listAttempts, (value) => value === 1, "the first loaded-thread attempt");

          // No helper records exist, and the first caller is held in the provider.
          // This read follows the second caller's reconciliation generation increment.
          observeSecond = true;
          const second = controller.reconcileThreads([{ sessionId }])
            .finally(() => { settled.second = true; });
          pending.push(second);
          await waitForSessionValue(() => secondRead, Boolean, "the second Main reconciliation to enter");
          observeSecond = false;

          loaded.release();
          await waitForSessionValue(() => resumeAttempts, (value) => value === 1, "the native readiness fallback");
          const prune = controller.reconcileThreads([])
            .finally(() => { settled.prune = true; });
          pending.push(prune);
          const waiting = await waitForSessionValue(
            () => diagnostics.find((entry) => entry.event === "server.codexTerminal.appServerThread.reconcile.pruneWait.start"),
            Boolean,
            "prune to wait for the cached fallback"
          );
          assert.equal(waiting.pendingCount, 1);
          assert.deepEqual(settled, { first: false, second: false, prune: false });
          assert.equal(listAttempts, 1);
          assert.equal(resumeAttempts, 1);
          assert.equal(provider.closed, 0, "prune must not release the provider while native readiness is pending");
          assert.equal(diagnostics.some((entry) => entry.event === "server.codexTerminal.appServerThread.reconcile.pruneWait.done"), false);

          fallback.release();
          const [firstResult, secondResult, pruned] = await Promise.all([first, second, prune]);
          assert.equal(firstResult.ok, true, JSON.stringify(firstResult));
          assert.equal(secondResult.ok, true, JSON.stringify(secondResult));
          assert.equal(pruned.ok, true, JSON.stringify(pruned));
          assert.equal(firstResult.results[0].codexThreadId, threadId);
          assert.deepEqual(secondResult.results[0], firstResult.results[0]);
          assert.equal(listAttempts, 1, "both reconcilers must share the same loaded attempt");
          assert.equal(resumeAttempts, 1, "both reconcilers must share the same readiness fallback");
          assert.equal(provider.closed, 1);
          assert.equal(diagnostics.filter((entry) => entry.event === "server.codexTerminal.appServerThread.reconcile.pruneWait.done").length, 1);

          const fresh = controller.reconcileThreads([{ sessionId }]);
          pending.push(fresh);
          const freshResult = await fresh;
          assert.equal(freshResult.ok, true, JSON.stringify(freshResult));
          assert.equal(freshResult.results[0].providerKey, firstResult.results[0].providerKey);
          assert.equal(freshResult.results[0].codexThreadId, threadId);
          assert.equal(listAttempts, 2, "settled reconciliation must release its cache entry");
          assert.equal(resumeAttempts, 2);
          assert.notEqual(captures.provider, provider);
          assert.equal(captures.threadStarts.length, 1);
          assert.equal(captures.turns.length, 0, "reconciliation must not send a new turn");
        } finally {
          loaded.release();
          fallback.release();
          await Promise.allSettled(pending);
          runtime.getSession = getSession;
          captures.onProviderCreated = previousCreated;
          for (const { current, listLoadedThreads, resumeThread } of decorated) {
            current.listLoadedThreads = listLoadedThreads;
            current.resumeThread = resumeThread;
          }
        }
      })
    ));
  } finally {
    debug.mock.restore();
    if (previousDebug === undefined) delete process.env.VIBE64_SESSION_DEBUG;
    else process.env.VIBE64_SESSION_DEBUG = previousDebug;
  }
});

test("ordinary detached resume preserves its target and falls back to start only for a falsy native result", {
  timeout: 15_000
}, async (t) => {
  for (const missingThread of [false, true]) {
    await t.test(missingThread ? "falsy resume starts a replacement" : "successful resume retains its target", async () => {
      await withConversationController(async ({ calls, captures, controller, projectRuntimeRoot, session, subscribers }) => {
        const requestedThreadId = "retained-interactive-thread";
        const threadId = missingThread ? "conversation-1" : requestedThreadId;
        const prompt = "Continue this ordinary detached conversation.";
        const text = "The ordinary detached answer.";
        const events = [];
        let subscribersAtSend = 0;
        if (missingThread) captures.resumeThreadResult = null;
        captures.onSendTurn = () => { subscribersAtSend = subscribers.size; };
        const pending = controller.streamDetachedChatTurn(session.sessionId, {
          ephemeral: true,
          prompt,
          threadId: requestedThreadId
        }, { onEvent: event => events.push(event) });
        void pending.catch(() => null);
        await Promise.race([
          waitForCapturedTurns(captures, 1),
          pending.then(result => assert.fail(`Detached turn ended before native Send: ${JSON.stringify(result)}`))
        ]);
        completeDetachedTurn(subscribers, { text, threadId, turnId: "turn-1" });
        const result = await pending;

        const threadSettings = codexAppServerThreadSettings({
          cwd: session.metadata.source_path,
          hostContext: {
            conversationKind: "temporary",
            scope: "session",
            session: {
              managedDatabaseRefresh: false,
              managedEnvironment: false,
              managedGit: false,
              managedPreview: false
            }
          }
        });
        assert.deepEqual(captures.resumes, [{ settings: threadSettings, threadId: requestedThreadId }]);
        assert.deepEqual(captures.threads, missingThread ? [{ ...threadSettings, ephemeral: true }] : []);
        assert.deepEqual(calls.filter(([operation]) => ["resume", "thread", "turn"].includes(operation)).map(([operation]) => operation),
          missingThread ? ["resume", "thread", "turn"] : ["resume", "turn"]);
        assert.equal("ephemeral" in captures.resumes[0].settings, false);
        assert.equal(captures.resumes[0].settings.sandbox, "danger-full-access");
        assert.deepEqual(captures.resumes[0].settings.config, {
          model_reasoning_effort: "xhigh", model_reasoning_summary: "concise"
        });
        assert.deepEqual(captures.turns, [{
          input: [prompt],
          settings: codexAppServerTurnSettings({ cwd: session.metadata.source_path }),
          threadId
        }]);
        assert.deepEqual(captures.turns[0].settings.sandboxPolicy, {
          networkAccess: "enabled", type: "externalSandbox"
        });
        assert.ok(subscribersAtSend > 0, "The existing detached watcher is subscribed before native Send");
        assert.deepEqual(result, { ok: true, text, threadId, turnId: "turn-1" });
        assert.deepEqual(events.filter(event => ["thread", "turn", "completed"].includes(event.type)), [
          { threadId, type: "thread" },
          { status: "inProgress", threadId, turnId: "turn-1", type: "turn" },
          { status: "completed", text, threadId, turnId: "turn-1", type: "completed" }
        ]);
        assert.ok(events.some(event => event.type === "notification"), "Native notifications reach the ordinary stream");
        assert.ok(events.every(event => event.threadId === threadId), "Every stream event keeps the selected native target");
        assert.equal(captures.configReads.length, 0);
        assert.equal(captures.hookLists.length, 1);
        assert.deepEqual(captures.deletes, []);
        assert.deepEqual(await createCodexHelperThreadLedger({ projectRuntimeRoot }).readAll(), { failures: [], records: [] });
      });
    });
  }
});


test("startup unsubscribe preserves no-thread isolation and retries retained cleanup failures", async (t) => {
  await t.test("a missing native thread does not read the project namespace", async () => {
    await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
      const session = await store.readSession(sessionId);
      let namespaceReads = 0;
      const slug = {
        toString() {
          namespaceReads += 1;
          throw new Error("Unexpected project namespace read.");
        }
      };
      await runWithProjectRequestContext({ slug }, async () => {
        assert.throws(() => codexTerminalNamespace(sessionId), /Unexpected project namespace read/u);
        namespaceReads = 0;
        const result = await controller.unsubscribeKnownAppServerThreads([
          null, "", session, ` ${sessionId} `, { id: sessionId }
        ]);
        assert.deepEqual(result, {
          failed: [],
          ok: true,
          results: [{ ok: true, providerOptions: null, sessionId, status: "notSubscribed" }],
          sessionCount: 1
        });
        assert.equal(namespaceReads, 0);
        assert.equal(captures.provider, null);
        assert.deepEqual(captures.providerOptions, []);
      });
    });
  });

  await t.test("unsubscribe and finally-retirement failures retain the same provider for retry", async () => {
    await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
      const prepared = await controller.ensureThread(sessionId);
      assert.equal(prepared.ok, true, JSON.stringify(prepared));
      const session = await store.readSession(sessionId);
      const provider = captures.provider;
      const providerCount = captures.providerOptions.length;
      const close = provider.close;
      const calls = [];
      let rejectUnsubscribe = true;
      let rejectClose = true;
      provider.unsubscribeThread = async (threadId) => {
        calls.push(["unsubscribe", threadId]);
        if (rejectUnsubscribe) throw new Error("Startup unsubscribe rejected.");
        return { status: "unsubscribed" };
      };
      provider.close = () => {
        calls.push(["close"]);
        if (rejectClose) throw Object.assign(new Error("Retained client close rejected."), {
          code: "test_retained_client_close",
          retryable: true
        });
        return close.call(provider);
      };
      try {
        const failedUnsubscribe = await controller.unsubscribeKnownAppServerThreads([session]);
        assert.deepEqual(failedUnsubscribe, {
          failed: [{ error: "Startup unsubscribe rejected.", sessionId }],
          ok: false,
          results: [],
          sessionCount: 1
        });
        assert.deepEqual(calls, [["unsubscribe", provider.threadId]]);
        assert.equal(provider.closed, 0);

        rejectUnsubscribe = false;
        const failedRetirement = await controller.unsubscribeKnownAppServerThreads([session]);
        assert.equal(failedRetirement.ok, false);
        assert.deepEqual(failedRetirement.failed, [{
          code: "test_retained_client_close",
          error: "Retained client close rejected.",
          retryable: true,
          sessionId
        }]);
        assert.equal(failedRetirement.results.length, 1);
        assert.equal(failedRetirement.results[0].status, "unsubscribed");
        assert.equal(failedRetirement.results[0].threadId, provider.threadId);
        assert.equal(failedRetirement.sessionCount, 1);
        assert.deepEqual(calls, [
          ["unsubscribe", provider.threadId], ["unsubscribe", provider.threadId], ["close"]
        ]);
        assert.equal(provider.closed, 0);

        rejectClose = false;
        const retried = await controller.unsubscribeKnownAppServerThreads([session]);
        assert.equal(retried.ok, true, JSON.stringify(retried));
        assert.deepEqual(retried.failed, []);
        assert.equal(retried.results.length, 1);
        assert.equal(retried.results[0].status, "unsubscribed");
        assert.equal(retried.results[0].threadId, provider.threadId);
        assert.equal(retried.sessionCount, 1);
        assert.deepEqual(calls, [
          ["unsubscribe", provider.threadId], ["unsubscribe", provider.threadId], ["close"],
          ["unsubscribe", provider.threadId], ["close"]
        ]);
        assert.equal(provider.closed, 1);
        assert.equal(captures.provider, provider);
        assert.equal(captures.providerOptions.length, providerCount);
      } finally {
        delete provider.unsubscribeThread;
        provider.close = close;
      }
    });
  });
});


test("Codex real provider cold resume composes retained Public hook preparation before native resume", async () => {
  const threadId = randomUUID();
  const protocol = [];
  let provider;
  let options;
  let status = "notLoaded";
  let workdir;
  await withConversationController(async ({ controller, projectService, projectContextRoot,
    projectRuntimeRoot, session, temporaryRoot, captures }) => {
    workdir = session.metadata.source_path;
    const store = createVibe64SessionStore({
      projectContextRoot,
      projectRuntimeRoot,
      projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
    });
    await store.createSession({
      metadata: session.metadata,
      runtimeKind: "genesis",
      sessionId: session.sessionId
    });
    const readAgentRun = store.readAgentRun.bind(store);
    store.readAgentRun = async (...args) => {
      protocol.push({ method: "before-resume", args });
      return readAgentRun(...args);
    };
    projectService.createSessionStore = () => store;

    const { native } = await controller.prepareConversationHost("session-1", {}, "create");
    const context = await native.runOwner.conversationContext("session-1", { conversationId: threadId }, {});
    assert.notEqual(context.ok, false, context.error || "native conversation context must be available");
    assert.equal(context.provider, provider, "the retained owner captures the actual Public subclass");
    assert.ok(provider instanceof CodexAppServerAgentProvider);
    const result = await provider.resumeThread(threadId, {
      cwd: session.metadata.source_path,
      model: "gpt-5.5"
    });

    assert.equal(result.id, threadId);
    assert.deepEqual(protocol.map(({ method }) => method), [
      "before-resume", "thread/read", "config/read", "config/batchWrite",
      "hooks/list", "before-resume", "thread/resume", "thread/read"
    ]);
    for (const guard of protocol.filter(({ method }) => method === "before-resume")) {
      assert.equal(guard.args[0], "session-1");
      assert.equal(guard.args[1], "codex_app_server");
    }
    const trust = protocol.find(({ method }) => method === "config/batchWrite").params;
    assert.deepEqual(trust.edits, [{
      keyPath: `projects.${JSON.stringify(session.metadata.source_path)}.trust_level`,
      value: "trusted",
      mergeStrategy: "upsert"
    }]);
    const resume = protocol.find(({ method }) => method === "thread/resume").params;
    assert.equal(resume.threadId, threadId);
    assert.equal(resume.excludeTurns, true);
    assert.equal(resume.cwd, session.metadata.source_path);
    assert.deepEqual(resume.config["hooks.state"], {
      "test:write-hook": { trusted_hash: "sha256:current-project-hook" }
    });
    assert.equal(resume.modelProvider, "openai");
    const input = await vibe64DriverInputFromRegistry({
      data: JSON.parse(options.terminalEnv.GENESIS_HOST_CONTEXT_RESOLVER_DATA),
      providerSessionId: threadId,
      scope: "session"
    });
    assert.equal(input.conversationKind, "temporary");
    assert.deepEqual(captures.turns, [], "control recovery authors no user turn");
    assert.deepEqual(captures.threads, [], "control recovery creates no replacement conversation");
  }, {
    providerFactory(providerOptions, { calls, subscribers, captures }) {
      options = providerOptions;
      const fixture = createProvider(calls, subscribers, captures, providerOptions);
      // Only transport/process/account snapshots are controlled here. The real
      // provider and its retained Public preparation callbacks remain intact.
      let connected = true;
      const client = {
        isOpen() { return connected; },
        close() { connected = false; },
        async request(method, params) {
          protocol.push({ method, params });
          if (method === "thread/read") {
            assert.equal(params.threadId, threadId);
            assert.equal(params.includeTurns, false);
            return { thread: { id: threadId, historyMode: "paginated", modelProvider: "openai", status: { type: status } } };
          }
          if (method === "config/read") {
            const binding = await vibe64DriverInputFromRegistry({
              data: JSON.parse(providerOptions.terminalEnv.GENESIS_HOST_CONTEXT_RESOLVER_DATA),
              providerSessionId: threadId,
              scope: "session"
            });
            assert.equal(binding.conversationKind, "temporary", "Public registration precedes native project trust");
            return { config: { projects: {} } };
          }
          if (method === "config/batchWrite") return { status: "ok" };
          if (method === "hooks/list") {
            assert.deepEqual(params.cwds, [workdir]);
            return { data: [{ cwd: workdir, hooks: [{
              source: "project", enabled: true, key: "test:write-hook",
              currentHash: "sha256:current-project-hook", trustStatus: "untrusted"
            }, {
              source: "plugin", enabled: true, key: "test:unrelated-hook",
              currentHash: "sha256:unrelated-hook", trustStatus: "untrusted"
            }] }] };
          }
          if (method === "thread/resume") {
            status = "idle";
            return { thread: { id: threadId, historyMode: "paginated", status: { type: status } }, modelProvider: "openai" };
          }
          assert.fail(`Unexpected native request ${method}; recovery must not infer an authored turn.`);
        }
      };
      provider = new CodexAppServerAgentProvider(providerOptions);
      provider.client = client;
      provider.runtime = { ...captures.runtimeInfo, executionId: "replacement-process" };
      provider.initializeResult = { userAgent: captures.serverUserAgent };
      provider.activeClient = async () => client;
      provider.ensureRuntime = fixture.ensureRuntime;
      provider.currentRuntimeInfo = fixture.currentRuntimeInfo;
      provider.stopRuntime = fixture.stopRuntime;
      provider.assertRuntimeAuthReady = async () => {};
      return provider;
    }
  });
});

test("Codex real provider refreshes Public commands and current instructions without authored work", async () => {
  const threadId = randomUUID();
  const protocol = [];
  const commandService = createCodexGitCommandService({ projectService: {} });
  let provider;
  let options;
  let nativeEnvironment;
  await withConversationController(async ({ controller, projectService, projectRuntimeRoot,
    projectContextRoot, session, temporaryRoot, captures }) => {
    execFileSync("git", ["init", "--quiet"], { cwd: session.metadata.source_path });
    execFileSync("git", ["-c", "user.name=Composition test", "-c", "user.email=composition@example.test",
      "commit", "--quiet", "--allow-empty", "-m", "Initial managed source"], { cwd: session.metadata.source_path });
    const store = createVibe64SessionStore({
      projectContextRoot,
      projectRuntimeRoot,
      projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
    });
    await store.createSession({
      metadata: session.metadata,
      runtimeKind: "genesis",
      sessionId: session.sessionId
    });
    projectService.createSessionStore = () => store;
    const { native } = await controller.prepareConversationHost("session-1", {}, "create");
    const context = await native.runOwner.conversationContext("session-1", { conversationId: threadId }, {});
    assert.equal(context.provider, provider);
    const hostContext = { conversationKind: "temporary", scope: "session", session: {
      managedDatabaseRefresh: false, managedEnvironment: false, managedGit: true, managedPreview: false
    } };
    await provider.startThread({ cwd: session.metadata.source_path, model: "gpt-5.5", hostContext });
    const firstEnvironment = { ...nativeEnvironment };
    assert.equal(await agentSessionCommandEnvironmentIsHealthy(firstEnvironment), true);
    const firstPrompt = protocol.find(({ method }) => method === "thread/start").params.developerInstructions;
    const registry = await vibe64HostContextRegistry(projectService.agentRuntimeRoot);
    await registry.register(threadId, { ...hostContext, conversationKind: "main" }, session.metadata.source_path);
    const replacement = await prepareCodexGitCommand({
      commandService: createCodexGitCommandService({ projectService: {} }),
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(temporaryRoot, "attachments") },
      sessionId: session.sessionId,
      stateRoot: projectRuntimeRoot
    });
    assert.notEqual(replacement.env.VIBE64_CODEX_GIT_COMMAND_GENERATION, firstEnvironment.VIBE64_CODEX_GIT_COMMAND_GENERATION);
    // The original control-change subscriber may recover before this explicit
    // operation; both enter the same per-thread coordinator.
    let callerOperations = 0;
    await provider.withThreadEnvironment(threadId, {}, async () => {
      callerOperations += 1;
    });
    assert.equal(callerOperations, 1);
    assert.equal(captures.providerOptions.length, 1, "transient controls retain the same provider owner");
    assert.equal(await agentSessionCommandEnvironmentIsHealthy(nativeEnvironment), true);
    assert.notEqual(nativeEnvironment.VIBE64_CODEX_GIT_COMMAND_GENERATION, firstEnvironment.VIBE64_CODEX_GIT_COMMAND_GENERATION);
    const resumes = protocol.filter(({ method }) => method === "thread/resume");
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0].params.threadId, threadId);
    assert.notEqual(resumes[0].params.developerInstructions, firstPrompt);
    assert.deepEqual(resumes[0].params.config.shell_environment_policy.set, nativeEnvironment);
    const acknowledgements = protocol.filter(({ method }) => method === "thread/inject_items");
    assert.equal(acknowledgements.length, 1);
    assert.equal(acknowledgements[0].params.items[0].role, "developer");
    assert.ok(acknowledgements[0].params.items[0].content[0].text.endsWith(resumes[0].params.developerInstructions));
    assert.equal(protocol.filter(({ method }) => method === "thread/shellCommand").length, 1);
    assert.equal(protocol.some(({ method }) => method === "hooks/list"), false, "loaded controls do not imply process replacement");
    assert.deepEqual(captures.turns, []);
  }, {
    codexGitCommand: commandService,
    providerFactory(providerOptions, { calls, subscribers, captures }) {
      options = providerOptions;
      const fixture = createProvider(calls, subscribers, captures, providerOptions);
      let connected = true;
      const client = {
        isOpen() { return connected; },
        close() { connected = false; },
        async request(method, params) {
          protocol.push({ method, params });
          if (method === "thread/start" || method === "thread/resume") {
            nativeEnvironment = { ...params.config.shell_environment_policy.set };
            return { thread: { id: threadId, historyMode: "paginated", modelProvider: "openai", status: { type: "idle" } }, modelProvider: "openai" };
          }
          if (method === "thread/name/set") return {};
          if (method === "thread/read") return { thread: { id: threadId, historyMode: "paginated", modelProvider: "openai", status: { type: "idle" }, turns: [] } };
          if (method === "thread/goal/get") return { goal: null };
          if (method === "thread/unsubscribe") return { status: "unsubscribed" };
          if (method === "thread/inject_items") return {};
          if (method === "thread/shellCommand") {
            const turnId = randomUUID();
            const item = { id: randomUUID(), type: "commandExecution", command: params.command, exitCode: 0,
              aggregatedOutput: execFileSync("/bin/sh", ["-c", params.command], { env: { ...process.env, ...nativeEnvironment }, encoding: "utf8" }) };
            for (const notification of [
              { method: "turn/started", params: { threadId, turn: { id: turnId } } },
              { method: "item/started", params: { threadId, turnId, item } },
              { method: "item/completed", params: { threadId, turnId, item } },
              { method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } }
            ]) provider.publishNotification(notification);
            return {};
          }
          assert.fail(`Unexpected native request ${method}; recovery must not author user work.`);
        }
      };
      provider = new CodexAppServerAgentProvider(providerOptions);
      provider.client = client;
      provider.runtime = { ...captures.runtimeInfo, executionId: "same-process" };
      provider.initializeResult = { userAgent: captures.serverUserAgent };
      provider.activeClient = async () => client;
      provider.ensureRuntime = fixture.ensureRuntime;
      provider.currentRuntimeInfo = fixture.currentRuntimeInfo;
      provider.stopRuntime = fixture.stopRuntime;
      provider.assertRuntimeAuthReady = async () => {};
      return provider;
    }
  });
  assert.ok(options, "the real provider factory was used");
});

test("Codex real provider restores the same-account Helper after an actual auth generation refresh", async () => {
  const accountRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-helper-composition-"));
  const toolHomeSource = path.join(accountRoot, "selected-home");
  const systemRoot = path.join(accountRoot, "system");
  const authPath = path.join(toolHomeSource, ".codex", "auth.json");
  const threadId = randomUUID();
  const protocol = [];
  const providers = [];
  let activeProvider;
  let nextTurn = 0;
  let threadCwd;
  const loginId = randomUUID();
  await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
  const writeAccount = (accessToken) => writeFile(authPath, JSON.stringify({
    auth_mode: "chatgpt", OPENAI_API_KEY: null,
    tokens: { account_id: "fixture-account", access_token: accessToken, refresh_token: "unused-fixture-refresh" }
  }), { mode: 0o600 });
  await writeAccount("fixture-access-one");
  await writeCodexAuthMarker(systemRoot, { connected: true, loginId, generation: "one" });
  // The original application Helper shares the interactive account/runtime.
  // Only its established native connection/process is controlled; real Vibe64
  // login identity, generation checks, Helper ledger and resume stay intact.
  const providerFactory = (providerOptions, { calls, subscribers, captures }) => {
    const fixture = createProvider(calls, subscribers, captures, providerOptions);
    const provider = new CodexAppServerAgentProvider(providerOptions);
    providers.push(provider);
    activeProvider = provider;
    assert.equal(provider.isHelperProvider(), false, "original managed Helpers share the interactive provider policy");
    let connected = true;
    let initialized = false;
    const client = {
      isOpen() { return connected; },
      close() { connected = false; },
      async request(method, params) {
        protocol.push({ method, threadId: params.threadId });
        if (method === "model/list") return { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "Fixture model",
          isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" }], nextCursor: null };
        if (method === "config/read") return { config: { mcp_servers: {} } };
        if (method === "hooks/list") return { data: [{ cwd: params.cwds[0], hooks: [], errors: [] }] };
        if (method === "thread/start") {
          threadCwd = params.cwd;
          return { thread: { id: threadId, historyMode: "paginated", modelProvider: "openai", cwd: threadCwd, turns: [] } };
        }
        if (method === "thread/name/set") return {};
        if (method === "thread/read") return { thread: { id: threadId, historyMode: "paginated", modelProvider: "openai", cwd: threadCwd, status: { type: "idle" }, turns: [] } };
        if (method === "thread/resume") return { thread: { id: threadId, historyMode: "paginated" }, modelProvider: "openai" };
        if (method === "thread/list") {
          assert.equal(params.cwd, threadCwd);
          return { data: params.archived ? [] : [{ id: threadId, cwd: threadCwd }], nextCursor: null };
        }
        if (method === "thread/loaded/list") return { data: [threadId], nextCursor: null };
        if (method === "thread/goal/get") return { goal: null };
        if (method === "thread/unsubscribe") return { status: "unsubscribed" };
        if (method === "thread/delete") return { deleted: true, threadId };
        if (method === "turn/start") {
          const turnId = `turn-${++nextTurn}`;
          captures.turns.push({ input: params.input, settings: params, threadId: params.threadId, turnId });
          return { turn: { id: turnId, status: "inProgress" } };
        }
        assert.fail(`Unexpected Helper native request ${method}.`);
      }
    };
    provider.client = client;
    provider.runtime = { ...captures.runtimeInfo, authStateSignature: "", runtimeDir: providerOptions.runtimeDir, executionId: randomUUID() };
    provider.initializeResult = { userAgent: captures.serverUserAgent };
    provider.connectionGeneration = 1;
    provider.ensureRuntime = async () => {
      await mkdir(provider.runtime.runtimeDir, { recursive: true, mode: 0o700 });
      return provider.runtime;
    };
    provider.activeClient = async () => {
      if (!initialized) {
        const current = await provider.currentRuntimeInfo();
        provider.runtime.accountIdentitySignature = current.accountIdentitySignature;
        provider.runtime.authStateSignature = current.authStateSignature;
        initialized = true;
      }
      return client;
    };
    provider.stopRuntime = fixture.stopRuntime;
    return provider;
  };
  try {
    await withConversationController(async ({ controller, captures, session, projectService,
      projectRuntimeRoot, simulateControllerCrash }) => {
      const profile = sourceExplanationHelperProfile();
      const firstPending = controller.runDetachedChatTurn("session-1", {
        executionProfile: profile, outputSchema: sourceExplanationOutputSchema(), prompt: "Save this Helper under its selected account."
      });
      await waitForCapturedTurns(captures, 1);
      completeDetachedTurn(new Set([notification => activeProvider.publishNotification(notification)]), {
        threadId, turnId: "turn-1", text: JSON.stringify({ answer: "Saved." })
      });
      const first = await firstPending;
      assert.equal(first.ok, true, JSON.stringify(first));
      const ledger = createCodexHelperThreadLedger({ projectRuntimeRoot });
      const before = (await ledger.readAll()).records[0];
      const firstRuntime = await activeProvider.currentRuntimeInfo();
      simulateControllerCrash();
      activeProvider.close();
      await writeAccount("fixture-access-two");
      await writeCodexAuthMarker(systemRoot, { connected: true, loginId, generation: "two" });
      const refreshed = restartedCaptures(captures);
      const restored = createRestartedController({ session, captures: refreshed, projectService,
        codexToolHomeSource: toolHomeSource, codexSystemRoot: systemRoot, providerFactory });
      try {
        const followUp = restored.runDetachedChatTurn("session-1", {
          executionProfile: profile, outputSchema: sourceExplanationOutputSchema(), prompt: "Continue once after token refresh.", threadId
        });
        await waitForCapturedTurns(refreshed, 1);
        assert.ok(activeProvider instanceof CodexAppServerAgentProvider);
        const currentRuntime = await activeProvider.currentRuntimeInfo();
        assert.equal(currentRuntime.accountIdentitySignature, firstRuntime.accountIdentitySignature);
        assert.notEqual(currentRuntime.authStateSignature, firstRuntime.authStateSignature);
        assert.deepEqual(protocol.filter(({ method }) => method === "thread/resume").map(row => row.threadId), [threadId]);
        completeDetachedTurn(new Set([notification => activeProvider.publishNotification(notification)]), {
          threadId, turnId: "turn-2", text: JSON.stringify({ answer: "Same selected account resumed." })
        });
        assert.equal((await followUp).ok, true);
        const after = (await ledger.readAll()).records[0];
        assert.equal(after.ownershipId, before.ownershipId);
        assert.equal(after.threadId, before.threadId);
        assert.equal(protocol.filter(({ method }) => method === "thread/start").length, 1);
        assert.equal(protocol.filter(({ method }) => method === "turn/start").length, 2, "only the two explicit fixture prompts are authored");
        assert.equal(protocol.some(({ method }) => method === "account/login/start"), false,
          "the controlled established connection is not proof of a native login");
        assert.equal(protocol.filter(({ method }) => method === "thread/delete").length, 0);
      } finally {
        await restored.closeAllForSession("session-1");
      }
    }, { providerFactory, codexToolHomeSource: toolHomeSource, codexSystemRoot: systemRoot });
  } finally {
    for (const provider of providers) provider.close();
    await rm(accountRoot, { recursive: true, force: true });
  }
});
