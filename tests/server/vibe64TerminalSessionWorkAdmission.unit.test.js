import assert from "node:assert/strict";
import { createAssistantRoutingStore } from "../../packages/vibe64-core/src/server/assistantRoutingStore.js";
import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { controllerHarness } from "../fixtures/opencodeController.js";
import { runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";

import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID
} from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
} from "../../packages/vibe64-runtime/src/server/codexAttachmentPaths.js";
import {
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive
} from "../../packages/vibe64-runtime/src/server/agentWriteLock.js";
import {
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  createService as createTerminalService
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  addGenesisStack,
  genesisPackageBinDirectory,
  initializeGenesisProject,
  inspectGenesisSkills
} from "../../packages/vibe64-genesis/src/server/index.js";

const execFileAsync = promisify(execFile);
const CODEX_SELECTION = { engineId: "codex", agentId: "codex", modelProviderId: "openai",
  modelId: "gpt-6-sol", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function agentWriteLockHarness({ holdFirst = false, secondValue = null } = {}) {
  let active = false;
  let attemptNumber = 0;
  const attempts = [];
  const firstEntered = deferred();
  const firstFinished = deferred();
  const releaseFirst = deferred();

  async function runSessionExclusive(sessionId, operationName, operation, options = {}) {
    attemptNumber += 1;
    const currentAttempt = attemptNumber;
    attempts.push({
      operationName,
      sessionId,
      ...(Number(options.waitMs) > 0 ? { waitMs: Number(options.waitMs) } : {})
    });
    if (active) {
      if (Number(options.waitMs) > 0) {
        await firstFinished.promise;
      } else {
        return {
          acquired: false,
          value: null
        };
      }
    }
    active = true;
    if (currentAttempt === 1) {
      firstEntered.resolve();
      if (holdFirst) {
        await releaseFirst.promise;
      }
    }
    try {
      return {
        acquired: true,
        value: currentAttempt === 2 && secondValue !== null
          ? secondValue
          : await operation()
      };
    } finally {
      active = false;
      if (currentAttempt === 1) {
        firstFinished.resolve();
      }
    }
  }

  return {
    attempts,
    get held() { return active; },
    firstEntered: firstEntered.promise,
    releaseFirst: releaseFirst.resolve,
    store: {
      runSessionExclusive,
      runSessionExclusiveForRenewal: runSessionExclusive
    }
  };
}

async function terminalServiceFixture(t, lock, {
  assistantSelection = null,
  logger = null,
  opencodeTerminalController = {},
  publishSessionChanged = {}
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-work-admission-"));
  const sourcePath = path.join(root, "managed", "sessions", "active", "session-1", "source");
  const projectContextRoot = path.join(root, "authority");
  const projectRuntimeRoot = path.join(root, "runtime");
  const attachmentRoot = path.join(root, "attachments");
  const codexToolHomeSource = path.join(root, "codex-home");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true })
  ]);
  await writeFile(path.join(codexToolHomeSource, ".codex", "auth.json"), JSON.stringify({ auth_mode: "apikey" }));
  const session = {
    metadata: {
      ...(assistantSelection ? { assistant_selection: JSON.stringify(assistantSelection) } : {}),
      ...(assistantSelection?.engineId === "codex" ? { agent_identity_conversation_id: "pre-existing-thread" } : {}),
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "session-1",
    sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-1"),
    status: "active",
    workspaceSetup: {
      status: "unconfigured"
    }
  };
  const sessionStore = createVibe64SessionStore({
    logger,
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(root, "managed", "sessions")
  });
  await sessionStore.createSession({
    metadata: session.metadata,
    runtimeKind: "genesis",
    sessionId: session.sessionId
  });
  const runtime = {
    async getSession() {
      return session;
    },
    projectContextRoot,
    async resolvePromptEnvironment() { return {}; },
    stateRoot: projectRuntimeRoot,
    store: {
      ...sessionStore,
      ...lock.store,
      async writeMetadataValue(_sessionId, name, value) {
        await sessionStore.writeMetadataValue(_sessionId, name, value);
        session.metadata[name] = value;
        if (name === "workspace_setup") {
          session.workspaceSetup = JSON.parse(value);
        }
      }
    }
  };
  const projectService = {
    currentServiceDataRoot() {
      return path.join(root, "service-data");
    },
    createSessionStore() {
      return {};
    },
    createRuntime() {
      return runtime;
    },
    currentTargetRoot() {
      return projectContextRoot;
    },
    async projectExecutionEnvironment() {
      return {};
    },
    async readCurrentProject() {
      return {
        projectContextRoot,
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
  const service = createTerminalService({
    logger,
    codexTerminalController: {
      codexToolHomeRequired: false,
      codexToolHomeSource
    },
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot,
      VIBE64_SYSTEM_ROOT: path.join(root, "system"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService,
    opencodeTerminalController,
    publishSessionChanged
  });
  t.after(async () => {
    await service.close();
    await rm(root, { force: true, recursive: true });
  });
  return {
    attachmentRoot,
    projectService,
    root,
    runtime,
    service,
    session
  };
}

async function outdatedSkillFixture(projectRoot) {
  await execFileAsync("git", ["init", "--quiet"], { cwd: projectRoot });
  const compilerRoot = path.join(projectRoot, "node_modules/genesis-compiler");
  await mkdir(compilerRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    dependencies: { "genesis-compiler": "0.0.0-fixture" }
  }));
  await writeFile(path.join(compilerRoot, "package.json"), JSON.stringify({
    name: "genesis-compiler", version: "0.0.0-fixture"
  }));
  await cp(
    path.join(genesisPackageBinDirectory(), "../genesis-compiler/skills"),
    path.join(compilerRoot, "skills"),
    { recursive: true }
  );
  await initializeGenesisProject({ projectRoot });
  const skillPath = path.join(projectRoot, ".agents/skills/genesis-project/SKILL.md");
  const original = await readFile(skillPath, "utf8");
  const expected = `${original}\nUpdated installed skill guidance.\n`;
  await writeFile(path.join(compilerRoot, "skills/genesis-project/SKILL.md"), expected);
  assert.equal((await inspectGenesisSkills({ projectRoot })).status, "outdated");
  return { skillPath, original, expected };
}

for (const temporary of [false, true]) test(`${temporary ? "temporary" : "main"} assistant work refreshes skills under both write locks and preserves source customization`, async (t) => {
  const lock = agentWriteLockHarness();
  const events = [];
  const { service, session, projectService } = await terminalServiceFixture(t, lock, {
    opencodeTerminalController: {
      createServerProcess() { throw new Error("The test does not start an AI provider."); }
    },
    publishSessionChanged: { agentTerminal: async (_sessionId, event) => events.push(event) }
  });
  const projectRoot = session.metadata.source_path;
  const { skillPath, expected } = await outdatedSkillFixture(projectRoot);
  const pluginPath = path.join(projectRoot, ".opencode/plugins/genesis-project-guidance.js");
  const expectedPlugin = await readFile(pluginPath, "utf8");
  await writeFile(pluginPath, "// Outdated generated adapter\n");
  const customPath = path.join(projectRoot, ".agents/skills/genesis-program/SKILL.md");
  const custom = `${await readFile(customPath, "utf8")}\nKeep the project's custom rule.\n`;
  await writeFile(customPath, custom);
  let sourceWrites = 0;
  projectService.runProjectSourceExclusive = async (operation, options) => {
    assert.equal(lock.held, true);
    assert.equal(options.operation, "sync-agent-skills");
    sourceWrites += 1;
    return operation();
  };

  // Provider delivery is unavailable in this fixture; preparation is deterministic.
  const send = () => temporary
    ? service.startAgentConversationTurn(session.sessionId, { conversationId: "temporary", message: "Continue." }, { engineId: "opencode" })
    : service.sendAgentMessage(session.sessionId, { message: "Continue." }, { engineId: "opencode" });
  await send().catch(() => null);
  assert.equal(sourceWrites, 1);
  assert.equal(await readFile(skillPath, "utf8"), expected);
  assert.equal(await readFile(pluginPath, "utf8"), expectedPlugin);
  assert.equal(await readFile(customPath, "utf8"), custom);
  assert.equal(events.some((event) => event.reason === "agent-skills-updated"), true);
  await send().catch(() => null);
  assert.equal(sourceWrites, 1);
});

test("missing project-pinned skills leave chat delivery and preparation recovery available", async (t) => {
  const lock = agentWriteLockHarness();
  const warnings = [];
  const events = [];
  const { service, session, projectService } = await terminalServiceFixture(t, lock, {
    logger: { warn(event) { warnings.push(event); } },
    publishSessionChanged: { agentTerminal: async (_sessionId, event) => events.push(event) }
  });
  const projectRoot = session.metadata.source_path;
  const { skillPath, original } = await outdatedSkillFixture(projectRoot);
  await rm(path.join(projectRoot, "node_modules/genesis-compiler"), { recursive: true });
  session.workspaceSetup = { status: "succeeded", recipeHash: "unchanged-install-command" };
  projectService.runProjectSourceExclusive = async () => assert.fail("Unavailable skills must not change source.");

  await assert.rejects(inspectGenesisSkills({ projectRoot }), { code: "AGENT_SKILL_UNAVAILABLE" });
  // Delivery reaches assistant admission; this fixture has no durable selection.
  await assert.rejects(service.sendAgentMessage(session.sessionId,
    { message: "Help repair dependencies." }, { engineId: "opencode" }),
  { code: "vibe64_assistant_selection_invalid" });
  assert.equal(session.workspaceSetup.status, "required");
  assert.equal(session.workspaceSetup.recipeHash, "");
  assert.match(session.workspaceSetup.diagnostic, /genesis-compiler/u);
  assert.equal(events.some((event) => event.reason === "workspace-setup-updated"), true);
  assert.equal(warnings.some((event) => event.event === "vibe64.agent_skills.preparation_required"), true);
  assert.equal(await readFile(skillPath, "utf8"), original);
  await assert.rejects(access(path.join(projectRoot, "node_modules/genesis-compiler")), { code: "ENOENT" });
});

test("incomplete project contracts defer skill refresh without blocking repair chat", async (t) => {
  const warnings = [];
  const { service, session, projectService } = await terminalServiceFixture(t, agentWriteLockHarness(), {
    logger: { warn(event) { warnings.push(event); } }
  });
  const projectRoot = session.metadata.source_path;
  await execFileAsync("git", ["init", "--quiet"], { cwd: projectRoot });
  await initializeGenesisProject({ projectRoot });
  await addGenesisStack({ projectRoot, pieces: ["jskit"] });
  const stackPath = path.join(projectRoot, "genesis/stack.md");
  const stack = (await readFile(stackPath, "utf8"))
    .replace(/\n## Resource estimates\n[\s\S]*?(?=\n## |$)/u, "");
  await writeFile(stackPath, stack);
  session.workspaceSetup = { status: "succeeded", recipeHash: "existing-setup" };
  projectService.runProjectSourceExclusive = async () => assert.fail("Incomplete contracts must not change source.");
  await assert.rejects(inspectGenesisSkills({ projectRoot }), { code: "STACK_PROJECT_CONTRACTS_INCOMPLETE" });
  await assert.rejects(service.sendAgentMessage(session.sessionId,
    { message: "Help repair project setup." }, { engineId: "opencode" }),
  { code: "vibe64_assistant_selection_invalid" });
  assert.deepEqual(session.workspaceSetup, { status: "succeeded", recipeHash: "existing-setup" });
  assert.equal(await readFile(stackPath, "utf8"), stack);
  assert.equal(warnings.some((event) => event.event === "vibe64.agent_skills.refresh_deferred"), true);
});

test("assistant inspection and active-turn steering leave outdated skills untouched", async (t) => {
  const lock = agentWriteLockHarness();
  const { service, session, projectService } = await terminalServiceFixture(t, lock, {
    opencodeTerminalController: {
      createServerProcess() { throw new Error("The test does not start an AI provider."); }
    }
  });
  const { skillPath, original } = await outdatedSkillFixture(session.metadata.source_path);
  let sourceWrites = 0;
  projectService.runProjectSourceExclusive = async () => {
    sourceWrites += 1;
    assert.fail("This operation must remain read-only.");
  };
  await service.ensureAgentSession(session.sessionId, { engineId: "opencode" }).catch(() => null);
  assert.equal(await readFile(skillPath, "utf8"), original);
  session.agentRuns = [{ state: "active", runId: "main-turn" }];
  await service.sendAgentMessage(session.sessionId, { message: "One more detail." }, { engineId: "opencode" }).catch(() => null);
  assert.equal(await readFile(skillPath, "utf8"), original);
  assert.equal(sourceWrites, 0);
});

test("integration continuation recovers provider acceptance after local write failure without resending", async (t) => {
  let historyUnavailable = true;
  const provider = await controllerHarness({
    withCommandBoundary: true,
    beforeMessages() { if (historyUnavailable) throw new Error("History unavailable."); }
  });
  t.after(async () => {
    await provider.controller.closeAllForProject();
    await rm(provider.root, { recursive: true, force: true });
  });
  const lock = { store: {} };
  const { service, runtime, session, root } = await terminalServiceFixture(t, lock, {
    opencodeTerminalController: provider.controllerOptions
  });
  session.metadata.assistant_selection = provider.session.metadata.assistant_selection;
  const code = { ...JSON.parse(session.metadata.assistant_selection), selectionSource: "explicit" };
  await createAssistantRoutingStore({ systemRoot: path.join(root, "system") }).write({ opencode: { plan: code, code } }, 0);
  service.configureAssistantRuntime({
    readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "shared-deepseek" }),
    resolveConnection: provider.controllerOptions.resolveConnection,
    listConnections: provider.controllerOptions.listConnections
  });
  await service.ensureAgentSession(session.sessionId);
  runtime.renderPrompt = async (_sessionId, input) => ({ prompt: input.request });
  await runtime.store.writeConversationUserMessage(session.sessionId, { text: "Configure mail." });
  const turn = await runtime.store.writeConversationAssistantMessage(session.sessionId, {
    text: 'Configure mail.\n\n```vibe64-integration\n{"integrationId":"mail"}\n```'
  });
  const input = { turnId: turn.turnId, requestId: turn.integrationSetup.requestId };
  const completion = await runtime.store.completeIntegrationSetupRequest(session.sessionId, {
    ...input, configurationHash: "a".repeat(64), verifiedAt: "2026-09-11T08:00:00.000Z"
  });
  const writeUser = runtime.store.writeConversationUserMessage;
  runtime.store.writeConversationUserMessage = async () => { throw new Error("Local disk write failed."); };
  const missing = await service.resumeIntegrationContinuation(session.sessionId, input);
  assert.equal(missing.code, "vibe64_integration_configuration_unavailable");
  for (const current of [
    { baseHash: "b".repeat(64), configuration: { integrations: { mail: {} } } },
    { baseHash: "a".repeat(64), configuration: { integrations: {} } }
  ]) {
    const changed = await service.resumeIntegrationContinuation(session.sessionId, input, {
      readIntegrationConfiguration: async () => ({ ok: true, ...current })
    });
    assert.equal(changed.code, "vibe64_integration_configuration_changed");
    assert.equal(changed.integrationSetup.continuation.status, "pending");
    assert.equal(provider.promptCalls.length, 0);
  }
  const contenders = await Promise.all([0, 1].map(() => service.resumeIntegrationContinuation(session.sessionId, input, {
    readIntegrationConfiguration: async () => ({ ok: true, baseHash: "a".repeat(64),
      configuration: { integrations: { mail: {} } } })
  })));
  const uncertain = contenders[0];
  assert.equal(contenders[1].code, "vibe64_integration_continuation_unconfirmed");
  assert.equal(contenders[1].integrationSetup.continuationMessageId, completion.continuationMessageId);
  assert.equal(uncertain.code, "vibe64_integration_continuation_unconfirmed");
  assert.equal(uncertain.integrationSetup.continuation.status, "sending");
  assert.equal(provider.promptCalls.length, 1);
  runtime.store.writeConversationUserMessage = writeUser;
  const stillUnknown = await service.resumeIntegrationContinuation(session.sessionId, input);
  assert.equal(stillUnknown.code, "vibe64_integration_continuation_unconfirmed");
  assert.equal(provider.promptCalls.length, 1);
  historyUnavailable = false;
  const recovered = await service.resumeIntegrationContinuation(session.sessionId, input);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.integrationSetup.continuation.status, "accepted");
  assert.equal(recovered.integrationSetup.continuationMessageId, completion.continuationMessageId);
  assert.equal((await service.resumeIntegrationContinuation(session.sessionId, input)).ok, true);
  assert.equal(provider.promptCalls.length, 1);
});

test("integration continuation uses a member's shared Code destination without changing Plan preferences or adding review", async (t) => {
  const provider = await controllerHarness();
  t.after(async () => { await provider.controller.closeAllForProject(); await rm(provider.root, { recursive: true, force: true }); });
  const completed = Promise.withResolvers();
  const { service, runtime, session, root } = await terminalServiceFixture(t, { store: {} }, {
    opencodeTerminalController: provider.controllerOptions,
    publishSessionChanged: { agentTerminal: async (_id, event) => {
      if (event.payload?.assistantRoutingRequest?.status === "done") completed.resolve();
    } }
  });
  const shared = { ...JSON.parse(provider.session.metadata.assistant_selection), selectionSource: "explicit" };
  const personal = { ...shared, modelProviderId: "personal", modelId: "personal-model" };
  session.metadata.assistant_selection = JSON.stringify(shared);
  const preferences = JSON.stringify({ mode: "plan", workflowEngineId: "opencode", review: true, override: personal });
  await runtime.store.writeMetadataValue(session.sessionId, "assistant_routing", preferences);
  await createAssistantRoutingStore({ systemRoot: path.join(root, "system") }).write({ opencode: {
    plan: personal, code: personal, sharedBackup: shared
  } }, 0);
  service.configureAssistantRuntime({
    listConnections: provider.controllerOptions.listConnections,
    resolveConnection: provider.controllerOptions.resolveConnection,
    readAssistantAccess: async ({ modelProviderId }) => ({ available: true, ownerOnly: modelProviderId === "personal", connectionIdentity: `connection:${modelProviderId}` })
  });
  runtime.renderPrompt = async (_id, input) => ({ prompt: input.request });
  await runtime.store.writeConversationUserMessage(session.sessionId, { text: "Configure mail." });
  const turn = await runtime.store.writeConversationAssistantMessage(session.sessionId, {
    text: 'Configure mail.\n\n```vibe64-integration\n{"integrationId":"mail"}\n```'
  });
  const input = { turnId: turn.turnId, requestId: turn.integrationSetup.requestId };
  await runtime.store.completeIntegrationSetupRequest(session.sessionId, {
    ...input, configurationHash: "a".repeat(64), verifiedAt: "2026-09-11T08:00:00Z"
  });
  const result = await service.resumeIntegrationContinuation(session.sessionId, input, {
    vibe64User: { username: "member", role: "member" },
    readIntegrationConfiguration: async () => ({ ok: true, baseHash: "a".repeat(64), configuration: { integrations: { mail: {} } } })
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.integrationSetup.continuation.status, "accepted");
  await completed.promise;
  assert.equal(provider.promptCalls.length, 1);
  assert.deepEqual(provider.promptCalls[0].input.model, { providerID: "deepseek", id: "deepseek-chat", variant: "high" });
  assert.match(provider.promptCalls[0].input.prompt.text, /Vibe64 mode: code/);
  const route = JSON.parse(session.metadata.assistant_routing_request);
  assert.equal(route.resolvedMode, "code");
  assert.equal(route.review, false);
  assert.equal(route.decision.backupUsed, true);
  assert.equal(route.submittedBy.username, "member");
  assert.equal(session.metadata.assistant_routing, preferences);
});

test("integration continuation cannot execute for an archived or renewal-quiesced session", async (t) => {
  for (const state of ["archived", "renewal-quiesced"]) {
    const { service, runtime, session } = await terminalServiceFixture(t, { store: {} });
    await runtime.store.writeConversationUserMessage(session.sessionId, { text: "Configure mail." });
    const turn = await runtime.store.writeConversationAssistantMessage(session.sessionId, {
      text: 'Configure mail.\n\n```vibe64-integration\n{"integrationId":"mail"}\n```'
    });
    const input = { turnId: turn.turnId, requestId: turn.integrationSetup.requestId };
    await runtime.store.completeIntegrationSetupRequest(session.sessionId, {
      ...input, configurationHash: "a".repeat(64), verifiedAt: "2026-09-11T08:00:00Z"
    });
    if (state === "archived") {
      await runtime.store.writeStatus(session.sessionId, "archived");
      await runtime.store.publishSessionArchive(session.sessionId);
    } else {
      await runtime.store.quiesceSessionForRenewal({ sourceSessionId: session.sessionId,
        renewalId: "integration-renewal", quiescedAt: "2026-09-11T08:01:00Z" });
    }
    let requestReads = 0;
    const readRequest = runtime.store.readIntegrationSetupRequest;
    runtime.store.readIntegrationSetupRequest = async (...args) => { requestReads += 1; return readRequest(...args); };
    await assert.rejects(service.resumeIntegrationContinuation(session.sessionId, input), {
      code: state === "archived" ? "vibe64_session_archived" : "vibe64_session_renewal_quiesced"
    });
    assert.equal(requestReads, 0, "Session admission must reject before request or provider processing.");
    assert.equal((await readRequest(session.sessionId, input.turnId)).continuation.status, "pending");
  }
});

test("output attempts invalidate output state in other clients", async (t) => {
  const published = [];
  const lock = agentWriteLockHarness();
  const { service, session } = await terminalServiceFixture(t, lock, {
    publishSessionChanged: {
      async outputTarget(sessionId, payload) {
        published.push({ payload, sessionId });
      }
    }
  });

  const result = await service.startOutputTargetTerminal(session.sessionId, {
    outputTargetId: "missing",
    originId: "tab:preview-a"
  });

  assert.equal(result.ok, false);
  assert.deepEqual(published, [{
    payload: {
      originId: "tab:preview-a",
      reason: "output-target-started"
    },
    sessionId: session.sessionId
  }]);
});

test("workspace setup admission uses the session agent-write lock", async (t) => {
  const lock = agentWriteLockHarness({ holdFirst: true });
  const { service, session } = await terminalServiceFixture(t, lock);

  const preparing = service.prepareWorkspaceSetup(session.sessionId, {
    retry: true
  });
  await lock.firstEntered;
  const competing = await service.prepareWorkspaceSetup(session.sessionId, {
    retry: true
  });

  assert.deepEqual(competing, {
    code: "vibe64_agent_write_mode_busy",
    error: "Another assistant operation is starting. Try again in a moment.",
    ok: false,
    retryable: true
  });
  lock.releaseFirst();
  const prepared = await preparing;
  assert.equal(typeof prepared.state.status, "string");
  assert.deepEqual(lock.attempts, [
    { operationName: "agent-write-mode", sessionId: session.sessionId },
    { operationName: "agent-write-mode", sessionId: session.sessionId }
  ]);
});

test("foreground chat waits for workspace setup admission instead of failing", async (t) => {
  const provider = await controllerHarness();
  t.after(async () => { await provider.controller.closeAllForProject(); await rm(provider.root, { recursive: true, force: true }); });
  const lock = agentWriteLockHarness({
    holdFirst: true
  });
  const { service, session, runtime } = await terminalServiceFixture(t, lock, {
    assistantSelection: provider.selection, opencodeTerminalController: provider.controllerOptions
  });
  runtime.renderPrompt = async (_id, input) => ({ prompt: input.request });
  service.configureAssistantRuntime({ listConnections: provider.controllerOptions.listConnections,
    resolveConnection: provider.controllerOptions.resolveConnection });

  const preparing = service.prepareWorkspaceSetup(session.sessionId, {
    retry: true
  });
  await lock.firstEntered;
  let sendSettled = false;
  const sending = service.sendAgentMessage(session.sessionId, {
    message: "Send this after setup.",
    messageId: "message-after-workspace-setup"
  }).finally(() => {
    sendSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sendSettled, false);
  lock.releaseFirst();
  await preparing;
  const result = await sending;

  assert.equal(result.delivered, true, JSON.stringify(result));
  assert.equal(provider.promptCalls.length, 1);
  assert.deepEqual(lock.attempts.slice(0, 2), [
    { operationName: "agent-write-mode", sessionId: session.sessionId },
    {
      operationName: "agent-write-mode",
      sessionId: session.sessionId,
      waitMs: 60_000
    }
  ]);
});

test("assistant preparation waits for overlapping admission instead of reporting unknown status", async (t) => {
  const lock = agentWriteLockHarness({
    holdFirst: true,
    secondValue: { ok: true }
  });
  const { service, session } = await terminalServiceFixture(t, lock, { assistantSelection: CODEX_SELECTION });
  const preparing = service.prepareWorkspaceSetup(session.sessionId, { retry: true });
  await lock.firstEntered;
  let settled = false;
  const checking = service.ensureAgentSession(session.sessionId).finally(() => {
    settled = true;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
  } finally {
    lock.releaseFirst();
    await preparing;
  }
  assert.equal((await checking).ok, true);
  assert.equal(lock.attempts[1].waitMs, 10_000);
});

test("assistant reconciliation retains structured failure diagnostics", async (t) => {
  const warnings = [];
  const lock = agentWriteLockHarness();
  const { service, runtime, session } = await terminalServiceFixture(t, lock, {
    assistantSelection: CODEX_SELECTION,
    logger: { warn(fields) { warnings.push(fields); } }
  });
  runtime.store.runSessionExclusive = async () => ({ acquired: false });
  const busy = await service.ensureAgentSession(session.sessionId, {
    vibe64User: { username: "matt", role: "member", password: "never-log-this" }
  });
  assert.equal(busy.code, "vibe64_agent_write_mode_busy");
  assert.equal(warnings[0].event, "vibe64.agent_session.reconciliation_failed");
  assert.equal(warnings[0].code, busy.code);
  assert.equal(warnings[0].sessionId, session.sessionId);
  assert.equal(warnings[0].username, "matt");
  assert.equal(typeof warnings[0].durationMs, "number");

  const failure = Object.assign(new Error("Provider connection failed"), { code: "provider_unavailable" });
  runtime.store.runSessionExclusive = async () => { throw failure; };
  const failed = await runWithProjectRequestContext({ vibe64User: { username: "merc", role: "owner" } }, () => (
    service.ensureAgentSession(session.sessionId, { vibe64User: { username: "matt" } })
  ));
  assert.equal(failed.ok, false);
  assert.equal(failed.code, failure.code);
  assert.equal(failed.error, failure.message);
  assert.equal(warnings[1].code, failure.code);
  assert.equal(warnings[1].event, "vibe64.agent_session.reconciliation_failed");
  assert.equal(warnings[1].username, "merc");

  await service.ensureAgentSession(session.sessionId);
  assert.equal(warnings[2].username, null);
  assert.doesNotMatch(JSON.stringify(warnings), /never-log-this|password/u);
});

test("assistant reconciliation identifies the member rejected by an owner-only connection", async (t) => {
  const warnings = [];
  const { service, session } = await terminalServiceFixture(t, agentWriteLockHarness(), {
    assistantSelection: { ...CODEX_SELECTION, engineId: "opencode", agentId: "build", modelProviderId: "personal" },
    logger: { warn(fields) { warnings.push(fields); } }
  });
  service.configureAssistantRuntime({ readAssistantAccess: async () => ({ ownerOnly: true }) });
  await assert.rejects(service.ensureAgentSession(session.sessionId, {
    engineId: "opencode",
    vibe64User: { username: "matt", role: "member" }
  }), { code: "vibe64_assistant_owner_required" });
  assert.equal(warnings[0].code, "vibe64_assistant_owner_required");
  assert.equal(warnings[0].username, "matt");
});

test("message failure logs identify the authenticated actor without copying message input", async (t) => {
  const warnings = [];
  const { service, runtime, session } = await terminalServiceFixture(t, agentWriteLockHarness(), {
    logger: { warn(fields) { warnings.push(fields); } }
  });
  runtime.store.runSessionExclusive = async () => ({ acquired: false });
  await assert.rejects(runWithProjectRequestContext({ vibe64User: { username: "matt", role: "member" } }, () => (
    service.sendAgentMessage(session.sessionId, {
      message: "private-message-text", username: "spoofed-user"
    }, { vibe64User: { username: "merc" } })
  )), { code: "vibe64_agent_write_mode_busy" });
  const event = warnings.find((entry) => entry.event === "vibe64.agent_message.delivery_failed");
  assert.equal(event.username, "matt");
  assert.doesNotMatch(JSON.stringify(event), /private-message-text|spoofed-user/u);
});

for (const method of ["saveSessionWork", "updateSessionWork"]) {
  test(`${method} waits behind preparation and admits repository work exactly once`, { timeout: 15_000 }, async (t) => {
    const contended = deferred();
    const { runtime, service, session } = await terminalServiceFixture(t, { store: {} }, {
      logger: {
        info() {},
        warn(event) { if (event.event === "vibe64.session_lock.contended") contended.resolve(event); }
      }
    });
    const entered = deferred();
    const release = deferred();
    const preparing = runVibe64AgentWriteExclusive(runtime, session.sessionId, async () => {
      entered.resolve();
      await release.promise;
    }, { operation: "prepare-agent-session" });
    await entered.promise;
    const admitted = new Error("Repository admission reached; no Git or AI work needed for this test");
    let acquisitions = 0;
    const requested = service[method](session.sessionId, {
      onRepositoryWriteAcquired() { acquisitions += 1; throw admitted; }
    }).catch((error) => error);
    try {
      const contention = await contended.promise;
      assert.equal(contention.waitMs, 10_000);
      assert.equal(contention.owner.operation, "prepare-agent-session");
      assert.equal(acquisitions, 0);
    } finally {
      release.resolve();
      await preparing;
    }
    assert.equal(await requested, admitted);
    assert.equal(acquisitions, 1);
  });
}

test("Save rechecks active assistant work after waiting for preparation", { timeout: 15_000 }, async (t) => {
  const contended = deferred();
  const { runtime, service, session } = await terminalServiceFixture(t, { store: {} }, {
    logger: { info() {}, warn(event) { if (event.event.endsWith(".contended")) contended.resolve(); } }
  });
  const entered = deferred();
  const release = deferred();
  const preparing = runVibe64AgentWriteExclusive(runtime, session.sessionId, async () => {
    entered.resolve();
    await release.promise;
  }, { operation: "prepare-agent-session" });
  await entered.promise;
  const requested = service.saveSessionWork(session.sessionId, {
    onRepositoryWriteAcquired() { assert.fail("Active assistant must prevent repository work"); }
  }).catch((error) => error);
  try {
    await contended.promise;
    session.agentRuns = [{ active: true, state: "active", runId: "started-during-wait" }];
  } finally {
    release.resolve();
    await preparing;
  }
  assert.equal((await requested).code, "vibe64_session_save_agent_active");
});

test("Save preparation timeout returns an actionable retry without starting repository work", async (t) => {
  const { runtime, service, session } = await terminalServiceFixture(t, { store: {} });
  runtime.store.runSessionExclusive = async (_sessionId, _lockName, _operation, options) => {
    assert.equal(options.waitMs, 10_000);
    return { acquired: false, value: null, blockingOperation: "prepare-agent-session" };
  };
  await assert.rejects(service.saveSessionWork(session.sessionId, {
    onRepositoryWriteAcquired() { assert.fail("Timed out Save must not start"); }
  }), {
    code: "vibe64_agent_write_mode_busy",
    message: "The assistant is still reconnecting. Wait until it is ready, then try again.",
    details: { blockingOperation: "prepare-agent-session" },
    retryable: true
  });
});

test("rebase, assistant preparation and temporary repair identify their lock requests", async (t) => {
  const lock = agentWriteLockHarness();
  const { service, runtime, session } = await terminalServiceFixture(t, lock, { assistantSelection: CODEX_SELECTION });
  const operations = [];
  runtime.store.runSessionExclusive = async (_sessionId, _lockName, _operation, options) => {
    operations.push(options.operation);
    return { acquired: false };
  };
  await assert.rejects(service.updateSessionWork(session.sessionId), {
    code: "vibe64_agent_write_mode_busy"
  });
  assert.equal((await service.ensureAgentSession(session.sessionId)).code, "vibe64_agent_write_mode_busy");
  assert.equal((await service.streamDetachedAgentChatTurn(session.sessionId)).code, "vibe64_agent_write_mode_busy");
  assert.deepEqual(operations, ["update-session-work", "prepare-agent-session", "stream-temporary-chat"]);
});

test("workspace setup reuses an already-held session agent-write lock", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-workspace-nested-lock-"));
  const sourcePath = path.join(root, "managed", "session-1", "source");
  const projectContextRoot = path.join(root, "authority");
  const projectRuntimeRoot = path.join(root, "runtime");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true })
  ]);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot
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
  const runtime = {
    getSession(sessionId) {
      return store.readSession(sessionId);
    },
    projectContextRoot,
    async resolvePromptEnvironment() { return {}; },
    stateRoot: projectRuntimeRoot,
    store
  };
  const projectService = {
    createSessionStore() {
      return store;
    },
    createRuntime() {
      return runtime;
    },
    currentTargetRoot() {
      return projectContextRoot;
    },
    async projectExecutionEnvironment() {
      return {};
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
  const service = createTerminalService({
    codexTerminalController: { codexToolHomeRequired: false },
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: path.join(root, "attachments"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService
  });
  t.after(async () => {
    await service.close();
    await rm(root, { force: true, recursive: true });
  });

  const nested = await runVibe64AgentWriteExclusive(
    runtime,
    "session-1",
    () => service.prepareWorkspaceSetup("session-1", {
      retry: true,
      runtime
    })
  );

  assert.equal(nested.acquired, true);
  assert.equal(typeof nested.value.state.status, "string");
  assert.notEqual(nested.value.code, "vibe64_agent_write_mode_busy");
});

test("repository update checks do not occupy assistant-write admission", async (t) => {
  const lock = agentWriteLockHarness({ holdFirst: true });
  const { runtime, service, session } = await terminalServiceFixture(t, lock);
  const activeAgent = runVibe64AgentWriteExclusive(
    runtime,
    session.sessionId,
    async () => null
  );
  await lock.firstEntered;
  session.metadata.source_path = "";

  await assert.rejects(
    () => service.checkSessionUpdates(session.sessionId),
    { code: "vibe64_codex_git_command_source_missing" }
  );
  assert.equal(lock.attempts.length, 1);

  lock.releaseFirst();
  assert.equal((await activeAgent).acquired, true);
});

test("renewal workspace setup privately resumes a pending successor while public setup rejects it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-renewal-workspace-setup-"));
  const projectContextRoot = path.join(root, "authority");
  const projectRuntimeRoot = path.join(root, "runtime");
  const sourcePath = path.join(root, "managed", "sessions", "active", "renewal-successor", "source");
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  await execFileAsync("git", ["init", "--quiet", sourcePath]);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot
  });
  await store.createSession({
    runtimeKind: "genesis",
    sessionId: "renewal-source"
  });
  await store.quiesceSessionForRenewal({
    renewalId: "workspace-setup-renewal",
    sourceSessionId: "renewal-source"
  });
  await store.createRenewalPendingSession({
    actorDisplayName: "Ada",
    actorId: "ada-owner",
    confirmedAt: "2026-08-24T01:01:00.000Z",
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      workspace_setup: JSON.stringify({
        startedAt: "2026-08-24T01:02:00.000Z",
        status: "running",
        updatedAt: "2026-08-24T01:02:00.000Z"
      })
    },
    renewalId: "workspace-setup-renewal",
    renewedFrom: "renewal-source",
    runtimeKind: "genesis",
    sessionId: "renewal-successor"
  });
  const runtime = {
    async getSession(sessionId) {
      const session = await store.readSession(sessionId);
      return {
        ...session,
        workspaceSetup: JSON.parse(session.metadata.workspace_setup)
      };
    },
    async getSessionForRenewal(sessionId) {
      const session = await store.readSessionForRenewal(sessionId);
      return {
        ...session,
        workspaceSetup: JSON.parse(session.metadata.workspace_setup)
      };
    },
    projectContextRoot,
    async resolvePromptEnvironment() { return {}; },
    stateRoot: projectRuntimeRoot,
    store
  };
  const projectService = {
    createSessionStore() {
      return store;
    },
    createRuntime() {
      return runtime;
    },
    currentTargetRoot() {
      return projectContextRoot;
    },
    async projectExecutionEnvironment() {
      return {};
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
  const service = createTerminalService({
    codexTerminalController: { codexToolHomeRequired: false },
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: path.join(root, "attachments"),
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService
  });
  t.after(async () => {
    await service.close();
    await rm(root, { force: true, recursive: true });
  });

  await assert.rejects(
    () => service.prepareWorkspaceSetup("renewal-successor", {
      retry: true,
      runtime
    }),
    { code: "vibe64_session_renewal_private" }
  );

  const privateAttempt = await service.prepareRenewalWorkspaceSetup("renewal-successor", {
    retry: true,
    runtime
  });
  assert.equal(privateAttempt.state.status, "unconfigured");
  const successor = await store.readSessionForRenewal("renewal-successor");
  assert.equal(
    JSON.parse(successor.metadata.workspace_setup).status,
    "unconfigured"
  );
  await assert.rejects(
    () => store.readSession("renewal-successor"),
    { code: "vibe64_session_renewal_private" }
  );
});

test("renewal terminal cleanup accepts a restored active predecessor for a later renewal", async (t) => {
  const lock = agentWriteLockHarness();
  const { root, runtime, service, session } = await terminalServiceFixture(t, lock);
  const transitionStore = createVibe64SessionStore({
    projectContextRoot: path.join(root, "renewal-authority"),
    projectRuntimeRoot: path.join(root, "renewal-runtime")
  });
  await transitionStore.createSession({
    runtimeKind: "genesis",
    sessionId: session.sessionId
  });
  await transitionStore.quiesceSessionForRenewal({
    renewalId: "finished-renewal",
    sourceSessionId: session.sessionId
  });
  const restored = await transitionStore.restoreSessionAfterRenewalCancellation({
    renewalId: "finished-renewal",
    restoredAt: "2026-08-25T01:00:00.000Z",
    sourceSessionId: session.sessionId
  });
  const runtimeDir = path.join(root, "codex-app-server-restored-renewal");
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    path.join(runtimeDir, "runtime.json"),
    `${JSON.stringify({
      pid: 99_999_999,
      processExitVerifiedAt: "2026-08-25T01:00:01.000Z",
      processIdentity: {
        commandHash: "0123456789ab",
        platform: "linux-proc",
        runtimeToken: "11111111-1111-4111-8111-111111111111",
        startTimeTicks: "1",
        version: 1
      },
      processState: "stopped",
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      runtimeDir,
      schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
      transport: "unix"
    }, null, 2)}\n`,
    "utf8"
  );
  session.metadata.agent_transport_runtime_dir = runtimeDir;
  Object.assign(session.metadata, restored.metadata);
  session.status = restored.status;
  assert.equal(session.metadata.renewal_restored_id, "finished-renewal");
  assert.equal(session.metadata.renewal_quiesced_id, undefined);

  const closed = await service.closeRenewalPredecessorSessionTerminals(session, {
    renewalId: "later-renewal",
    runtime
  });

  assert.equal(closed.ok, true);
  const requiesced = await transitionStore.quiesceSessionForRenewal({
    renewalId: "later-renewal",
    sourceSessionId: session.sessionId
  });
  assert.equal(requiesced.metadata.renewal_quiesced_id, "later-renewal");
  assert.equal(requiesced.metadata.renewal_restored_id, undefined);
});

test("renewal terminal cleanup rejects foreign quiescence and already-renewed predecessors", async (t) => {
  const lock = agentWriteLockHarness();
  const { runtime, service, session } = await terminalServiceFixture(t, lock);

  session.metadata.renewal_quiesced_id = "foreign-renewal";
  await assert.rejects(
    () => service.closeRenewalPredecessorSessionTerminals(session, {
      renewalId: "requested-renewal",
      runtime
    }),
    { name: "TypeError" }
  );

  session.status = "renewal_quiesced";
  await assert.rejects(
    () => service.closeRenewalPredecessorSessionTerminals(session, {
      renewalId: "requested-renewal",
      runtime
    }),
    { name: "TypeError" }
  );

  session.status = "active";
  delete session.metadata.renewal_quiesced_id;
  session.metadata.renewed_to = "renewal-successor";
  await assert.rejects(
    () => service.closeRenewalPredecessorSessionTerminals(session, {
      renewalId: "requested-renewal",
      runtime
    }),
    { name: "TypeError" }
  );
});

test("concurrent attachment uploads wait for one another and all retain their bytes", async (t) => {
  const waiting = new Set();
  const batchWaiting = deferred();
  const logger = {
    info() {},
    warn(event) {
      if (event.operation === "upload-agent-attachment" &&
          ["vibe64.session_lock.contended", "vibe64.session_lock.rejected"].includes(event.event)) {
        waiting.add(event.attemptId);
        if (waiting.size === 5) batchWaiting.resolve();
      }
    }
  };
  const { service, session } = await terminalServiceFixture(t, { store: {} }, { logger });
  const started = deferred();
  const release = deferred();
  const first = service.uploadAgentAttachment(session.sessionId, {
    fileName: "file-0.txt",
    stream: Readable.from((async function *() {
      started.resolve();
      yield "file-0";
      await release.promise;
    })())
  });
  await started.promise;
  const remaining = Array.from({ length: 5 }, (_, index) => service.uploadAgentAttachment(session.sessionId, {
    fileName: `file-${index + 1}.txt`,
    stream: Readable.from([`file-${index + 1}`])
  }));
  try {
    await batchWaiting.promise;
  } finally {
    release.resolve();
  }
  const results = await Promise.all([first, ...remaining]);
  for (const [index, result] of results.entries()) {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(await readFile(result.path, "utf8"), `file-${index}`);
  }
  assert.equal(new Set(results.map((result) => result.attachmentId)).size, 6);
});

test("an upload waiting behind renewal rechecks session admission before writing", async (t) => {
  const waiting = deferred();
  const { runtime, service, session } = await terminalServiceFixture(t, { store: {} }, {
    logger: {
      info() {},
      warn(event) {
        if (event.operation === "upload-agent-attachment" && event.event === "vibe64.session_lock.contended") {
          waiting.resolve();
        }
      }
    }
  });
  const entered = deferred();
  const release = deferred();
  const renewal = runVibe64RenewalAgentWriteExclusive(runtime, session.sessionId, async () => {
    entered.resolve();
    await release.promise;
    await runtime.store.quiesceSessionForRenewal({
      sourceSessionId: session.sessionId,
      renewalId: "queued-upload-renewal",
      quiescedAt: "2026-09-17T03:30:00Z"
    });
  });
  await entered.promise;
  let consumed = false;
  const uploading = service.uploadAgentAttachment(session.sessionId, {
    fileName: "queued.txt",
    stream: Readable.from((async function *() {
      consumed = true;
      yield "must not be stored";
    })())
  });
  const rejected = assert.rejects(uploading, { code: "vibe64_session_renewal_quiesced" });
  try {
    await waiting.promise;
    assert.equal(consumed, false);
  } finally {
    release.resolve();
  }
  await renewal;
  await rejected;
  assert.equal(consumed, false);
});

test("an active attachment upload finishes before renewal can freeze and cleanup the session", async (t) => {
  const lock = agentWriteLockHarness();
  const { runtime, service, session } = await terminalServiceFixture(t, lock);
  const streamStarted = deferred();
  const releaseStream = deferred();
  const events = [];
  const stream = Readable.from((async function *attachmentBytes() {
    events.push("upload-stream-started");
    streamStarted.resolve();
    yield "partial";
    await releaseStream.promise;
    yield "-complete";
  })());

  const uploading = service.uploadAgentAttachment(session.sessionId, {
    fileName: "renewal-race.txt",
    stream
  }).then((result) => {
    events.push("upload-completed");
    return result;
  });
  await streamStarted.promise;

  const prematureRenewal = await runVibe64RenewalAgentWriteExclusive(
    runtime,
    session.sessionId,
    async () => {
      events.push("renewal-entered-too-early");
    }
  );
  assert.equal(prematureRenewal.acquired, false);
  assert.equal(prematureRenewal.value.code, "vibe64_agent_write_mode_busy");

  releaseStream.resolve();
  const uploaded = await uploading;
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.equal(await readFile(uploaded.path, "utf8"), "partial-complete");

  const releaseRenewal = deferred();
  const renewalEntered = deferred();
  const renewal = runVibe64RenewalAgentWriteExclusive(
    runtime,
    session.sessionId,
    async () => {
      events.push("renewal-entered");
      renewalEntered.resolve();
      await releaseRenewal.promise;
      events.push("renewal-finished");
    }
  );
  await renewalEntered.promise;

  const blockedDelete = await service.deleteAgentAttachment(session.sessionId, {
    attachmentId: uploaded.attachmentId
  });
  assert.equal(blockedDelete.ok, false);
  assert.equal(blockedDelete.code, "vibe64_agent_write_mode_busy");
  assert.equal(await readFile(uploaded.path, "utf8"), "partial-complete");

  releaseRenewal.resolve();
  assert.equal((await renewal).acquired, true);
  const deleted = await service.deleteAgentAttachment(session.sessionId, {
    attachmentId: uploaded.attachmentId
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  await assert.rejects(() => access(uploaded.path), { code: "ENOENT" });
  assert.deepEqual(events, [
    "upload-stream-started",
    "upload-completed",
    "renewal-entered",
    "renewal-finished"
  ]);
});

for (const personalMember of [false, true]) {
  test(`Save publishes captured work with unconfigured Economy and ${personalMember ? "a member's personal main chat" : "unavailable AI"}`, async (t) => {
    const events = [];
    const { projectService, root, service, session } = await terminalServiceFixture(t, { store: {} });
    if (personalMember) {
      service.configureAssistantRuntime({ readAssistantAccess: async () => ({ ownerOnly: true }) });
      session.metadata.assistant_selection = JSON.stringify({
        engineId: "opencode", agentId: "build", modelProviderId: "test", modelId: "test-model",
        catalogRevision: `sha256:${"a".repeat(64)}`, variantId: ""
      });
    }
    const baseline = path.join(root, "baseline");
    const source = session.metadata.source_path;
    const git = async (cwd, args) => {
      const result = await execFileAsync("git", args, {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Save Test", GIT_AUTHOR_EMAIL: "save@example.test",
          GIT_COMMITTER_NAME: "Save Test", GIT_COMMITTER_EMAIL: "save@example.test"
        }
      });
      return result.stdout.trim();
    };
    await git(root, ["init", "--initial-branch=main", baseline]);
    await initializeGenesisProject({ projectRoot: baseline });
    await writeFile(path.join(baseline, "app.txt"), "initial\n");
    await git(baseline, ["add", "."]);
    await git(baseline, ["commit", "-m", "Initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-1"]);
    Object.assign(session.metadata, {
      base_branch: "main", base_commit: baseCommit, branch: "vibe64/session-1"
    });
    projectService.readCurrentProject = async () => ({
      slug: "test-project",
      sourceRoot: baseline,
      repository: { mode: "local_source", defaultBranch: "main" }
    });
    projectService.runProjectSourceExclusive = async (operation) => operation();
    await writeFile(path.join(source, "app.txt"), "important work\n");
    const saved = await service.saveSessionWork(session.sessionId, {
      operationId: "save-without-assistant",
      vibe64User: personalMember ? { username: "member", role: "member" } : null,
      onProgress(event) { events.push(event); }
    });
    assert.equal(saved.status, "saved");
    assert.equal(await git(baseline, ["rev-parse", "HEAD"]), saved.saveCommit);
    assert.equal(await readFile(path.join(baseline, "app.txt"), "utf8"), "important work\n");
    const checkpoint = events.find((event) => event.checkpointTree);
    assert.equal(await git(baseline, ["log", "-1", "--format=%s"]),
      `Save work ${checkpoint.checkpointTree.slice(0, 12)}`);
    assert.ok(events.some((event) => event.stage === "message-fallback"));
    if (personalMember) {
      assert.equal(events.find((event) => event.stage === "message-fallback").code, "vibe64_assistant_routing_invalid");
    }
    assert.equal(saved.commitTitleExecutionProfile, null);
  });
}


test("purpose access enables a member's configured chat after a personal turn while keeping steering on its native connection", async (t) => {
  const provider = await controllerHarness();
  t.after(async () => { await provider.controller.closeAllForProject(); await rm(provider.root, { recursive: true, force: true }); });
  const { service, session, root } = await terminalServiceFixture(t, { store: {} }, { opencodeTerminalController: provider.controllerOptions });
  const shared = { ...JSON.parse(provider.session.metadata.assistant_selection), selectionSource: "explicit" };
  const personal = { ...shared, modelProviderId: "personal", modelId: "personal-model" };
  session.metadata.assistant_selection = JSON.stringify(personal);
  session.metadata.assistant_routing = JSON.stringify({ mode: "code", workflowEngineId: "opencode", review: true });
  await createAssistantRoutingStore({ systemRoot: path.join(root, "system") }).write({ opencode: {
    plan: personal, code: shared, router: shared, economy: shared, sharedBackup: shared
  } }, 0);
  service.configureAssistantRuntime({
    listConnections: provider.controllerOptions.listConnections,
    resolveConnection: provider.controllerOptions.resolveConnection,
    readAssistantAccess: async ({ modelProviderId }) => ({ available: true, ownerOnly: modelProviderId === "personal", connectionIdentity: `connection:${modelProviderId}` })
  });
  const options = { vibe64User: { username: "member", role: "member" } };
  session.agentRuns = [{ active: true }];
  const active = await service.inspectAssistantAccess(session.sessionId, options);
  assert.equal(active.steering, true);
  assert.equal(active.canUse, false, "steering cannot substitute another model while a personal native turn is active");
  assert.equal(active.canRequestMessage, true);
  assert.equal(active.purposes.code.available, true, active.purposes.code.message);
  assert.equal(active.purposes.prompt_hint.available, true);
  assert.equal(active.purposes.auto.available, false);
  session.agentRuns = [];
  const idle = await service.inspectAssistantAccess(session.sessionId, options);
  assert.equal(idle.steering, false);
  assert.equal(idle.canUse, true, idle.purposes.code.message);
  assert.equal(idle.canRequestMessage, false);
  assert.equal(idle.purposes.review.effectiveSelection.modelId, shared.modelId);
  assert.equal(provider.promptCalls.length, 0, "availability never sends work to a provider");
  service.configureAssistantRuntime({
    async resolveAssistantUser(actor) {
      assert.equal(actor.username, "member");
      throw Object.assign(new Error("The submitting user no longer has workspace access."), {
        code: "vibe64_assistant_actor_unavailable"
      });
    }
  });
  await assert.rejects(service.inspectAssistantAccess(session.sessionId, options), { code: "vibe64_assistant_actor_unavailable" });
  await assert.rejects(service.requireAssistantSelectionAccess(shared, options), { code: "vibe64_assistant_actor_unavailable" });
  assert.equal(provider.promptCalls.length, 0);
});
