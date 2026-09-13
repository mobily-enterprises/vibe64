import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";

import {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID
} from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import {
  Vibe64SessionRuntime
} from "../../packages/vibe64-runtime/src/server/runtime.js";
import {
  serializeVibe64AssistantSelection
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  SESSION_RENEWAL_STATUS,
  readSessionRenewalState
} from "../../packages/vibe64-sessions/src/server/sessionRenewalState.js";
import {
  createSessionRenewalController
} from "../../packages/vibe64-sessions/src/server/sessionRenewal.js";
import {
  createAgentEnvCommandService,
  prepareAgentEnvCommand
} from "../../packages/vibe64-terminals/src/server/agentEnvCommand.js";
import {
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
} from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import {
  storeCodexAttachment
} from "../../packages/vibe64-terminals/src/server/codexAttachments.js";
import {
  createService as createTerminalService
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  codexTerminalNamespace,
  outputTargetTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import {
  createService as createProjectService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  startTerminalSession
} from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import {
  defineSessionRenewalHandoverText,
  sessionRenewalManualHandoverTemplate
} from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";
import {
  managedSessionSourceRoot,
  projectRuntimeRoot,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);
const PREDECESSOR_ID = "renewal-resource-predecessor";
const ASSISTANT_SELECTION = Object.freeze({
  agentId: "codex",
  catalogRevision: `sha256:${"1".repeat(64)}`,
  engineId: "codex",
  modelId: "gpt-5.5",
  modelProviderId: "openai",
  schema: "vibe64.assistant-selection.v1",
  variantId: "high"
});

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

async function eventually(operation, predicate, attempts = 300) {
  let latest;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await operation();
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(
    `Timed out waiting for the integrated renewal state. Latest: ${JSON.stringify(latest)}`
  );
}

async function initializeGitWorktree(sourceRoot) {
  await mkdir(sourceRoot, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: sourceRoot });
  await execFileAsync("git", ["config", "user.name", "Vibe64 test"], { cwd: sourceRoot });
  await execFileAsync("git", ["config", "user.email", "vibe64-test@example.invalid"], {
    cwd: sourceRoot
  });
  await writeFile(path.join(sourceRoot, "README.md"), "# Renewal resource proof\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: sourceRoot });
  await execFileAsync("git", ["commit", "-m", "Create renewal resource proof"], {
    cwd: sourceRoot
  });
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })).stdout.trim();
}

function sourceMetadata(targetRoot, sessionId, commit) {
  return {
    agent_identity_conversation_id: sessionId === PREDECESSOR_ID ? "thread-predecessor" : "",
    assistant_selection: serializeVibe64AssistantSelection(ASSISTANT_SELECTION),
    base_branch: "main",
    base_commit: commit,
    canonical_commit: commit,
    repository_mode: "github",
    source_default_branch: "main",
    source_kind: "session_clone",
    source_path: sourcePath(targetRoot, sessionId),
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
    source_remote_url: "https://example.invalid/renewal-resource-proof.git"
  };
}

function stoppedRuntimeMetadata(runtimeDir) {
  return {
    pid: 99_999_999,
    processExitVerifiedAt: "2026-08-25T00:00:00.000Z",
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
  };
}

function handoverText(commit) {
  return [
    "# Session handover",
    "## Objective",
    "Continue the exact saved project work.",
    "## Decisions",
    "Keep the existing architecture.",
    "## Saved source",
    "- Authority: github",
    "- Repository: https://example.invalid/renewal-resource-proof.git",
    "- Ref: refs/heads/main",
    `- Commit: ${commit}`,
    "## Touched areas",
    "The current project source.",
    "## Verification",
    "The source is clean and canonical-current.",
    "## Unresolved work",
    "Continue the requested implementation.",
    "## Next action",
    "Inspect the approved handover and continue."
  ].join("\n");
}

function projectServiceProxy(projectService, runtime) {
  return new Proxy({}, {
    get(_target, property) {
      if (property === "createRuntime") {
        return async () => runtime;
      }
      if (property === "createSessionStore") {
        return async () => runtime.store;
      }
      if (property === "projectExecutionEnvironment") {
        return async () => ({});
      }
      const value = Reflect.get(projectService, property);
      return typeof value === "function" ? value.bind(projectService) : value;
    }
  });
}

async function createLiveResourceSet({
  attachmentRoot,
  commandProject,
  env,
  session,
  targetRoot
}) {
  const sessionId = session.sessionId;
  const wrapperRoot = path.join(path.dirname(targetRoot), "cmd", sessionId);
  const envCommands = createAgentEnvCommandService({
    projectService: commandProject
  });
  const previewCommands = createAgentPreviewCommandService({
    launchTarget: {
      async launchStatus() {
        return { ok: true, previewTarget: { available: false, href: "" } };
      },
      async selectPreviewIdentity() {
        return { ok: true };
      }
    }
  });
  const preparedEnv = await prepareAgentEnvCommand({
    commandService: envCommands,
    sessionId,
    wrapperHostDir: wrapperRoot
  });
  assert.equal(preparedEnv.ok, true);
  assert.equal(await pathExists(preparedEnv.hostSocketPath), true);
  const preparedPreview = await prepareAgentPreviewCommand({
    commandService: previewCommands,
    env,
    sessionId,
    wrapperHostDir: wrapperRoot
  });
  assert.equal(preparedPreview.ok, true);
  assert.equal(await pathExists(preparedPreview.hostSocketPath), true);
  const assistantNamespace = codexTerminalNamespace(sessionId);
  const launchNamespace = outputTargetTerminalNamespace(sessionId);
  const assistant = startTerminalSession({
    args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
    command: process.execPath,
    commandPreview: "assistant renewal proof",
    cwd: session.metadata.source_path,
    namespace: assistantNamespace
  });
  const launch = startTerminalSession({
    args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
    command: process.execPath,
    commandPreview: "preview renewal proof",
    cwd: session.metadata.source_path,
    namespace: launchNamespace
  });
  const attachment = await storeCodexAttachment({
    env: {
      ...env,
      VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot
    },
    executionRoot: session.metadata.source_path,
    input: {
      contentType: "text/plain",
      fileName: "renewal-proof.txt",
      stream: Readable.from(["attachment owned by the predecessor\n"])
    },
    sessionId
  });
  assert.equal(attachment.ok, true, JSON.stringify(attachment));
  assert.equal(await pathExists(attachment.path), true);
  assert.equal(listTerminalSessions({ namespace: assistantNamespace }).length, 1);
  assert.equal(listTerminalSessions({ namespace: launchNamespace }).length, 1);
  return {
    assistant,
    assistantNamespace,
    attachment,
    envCommands,
    envSocketPath: preparedEnv.hostSocketPath,
    launch,
    launchNamespace,
    previewCommands,
    previewSocketPath: preparedPreview.hostSocketPath
  };
}

async function assertLiveProcessesClosed(resources) {
  assert.equal(listTerminalSessions({ namespace: resources.assistantNamespace }).length, 0);
  assert.equal(listTerminalSessions({ namespace: resources.launchNamespace }).length, 0);
  assert.equal(await pathExists(resources.envSocketPath), false);
  assert.equal(await pathExists(resources.previewSocketPath), false);
}

async function relaunchPredecessorResources(context, predecessor, targetRoot) {
  const wrapperRoot = path.join(path.dirname(targetRoot), "cmd", predecessor.sessionId);
  const preparedEnv = await prepareAgentEnvCommand({
    commandService: context.resources.envCommands,
    sessionId: predecessor.sessionId,
    wrapperHostDir: wrapperRoot
  });
  assert.equal(preparedEnv.ok, true);
  assert.equal(await pathExists(preparedEnv.hostSocketPath), true);
  const preparedPreview = await prepareAgentPreviewCommand({
    commandService: context.resources.previewCommands,
    env: context.env,
    sessionId: predecessor.sessionId,
    wrapperHostDir: wrapperRoot
  });
  assert.equal(preparedPreview.ok, true);
  assert.equal(await pathExists(preparedPreview.hostSocketPath), true);
  const assistant = startTerminalSession({
    args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
    command: process.execPath,
    commandPreview: "post-rollback assistant proof",
    cwd: predecessor.metadata.source_path,
    namespace: context.resources.assistantNamespace
  });
  const preview = startTerminalSession({
    args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
    command: process.execPath,
    commandPreview: "post-rollback preview proof",
    cwd: predecessor.metadata.source_path,
    namespace: context.resources.launchNamespace
  });
  assert.equal(assistant.ok, true);
  assert.equal(preview.ok, true);
  assert.equal(
    listTerminalSessions({ namespace: context.resources.assistantNamespace }).length,
    1
  );
  assert.equal(
    listTerminalSessions({ namespace: context.resources.launchNamespace }).length,
    1
  );
}

async function renewalHarness(targetRoot, {
  loseFirstAttachmentReleaseResponse = false,
  failSuccessorCreation = false
} = {}) {
  const projectSessionSourceRoot = managedSessionSourceRoot(targetRoot);
  const predecessorSource = sourcePath(targetRoot, PREDECESSOR_ID);
  const commit = await initializeGitWorktree(predecessorSource);
  const runtimeDir = path.join(
    targetRoot,
    "runtime-state",
    "codex-app-server-renewal-resource-proof"
  );
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    path.join(runtimeDir, "runtime.json"),
    `${JSON.stringify(stoppedRuntimeMetadata(runtimeDir), null, 2)}\n`,
    "utf8"
  );
  const runtime = new Vibe64SessionRuntime({
    createSessionSource: async ({ expectedCommit = "", session, store }) => {
      if (session.sessionId === PREDECESSOR_ID) {
        return;
      }
      if (failSuccessorCreation) {
        const error = new Error("Injected successor clone failure before commit.");
        error.code = "injected_successor_clone_failure";
        error.retryable = true;
        throw error;
      }
      const successorSource = sourcePath(targetRoot, session.sessionId);
      await mkdir(path.dirname(successorSource), { recursive: true });
      await execFileAsync("git", ["clone", "--no-hardlinks", predecessorSource, successorSource]);
      const actualCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: successorSource
      })).stdout.trim();
      assert.equal(actualCommit, expectedCommit);
      for (const [name, value] of Object.entries(
        sourceMetadata(targetRoot, session.sessionId, actualCommit)
      )) {
        await store.writeMetadataValueForRenewal(session.sessionId, name, value);
      }
    },
    inspectSourceByDefault: false,
    projectContextRoot: targetRoot,
    projectRuntimeRoot: projectRuntimeRoot(targetRoot),
    projectSessionSourceRoot
  });
  await runtime.createSession({
    metadata: {
      ...sourceMetadata(targetRoot, PREDECESSOR_ID, commit),
      agent_transport_runtime_dir: runtimeDir
    },
    sessionId: PREDECESSOR_ID
  });
  const projectService = createProjectService({
    env: {},
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    })
  });
  const resourceCalls = [];
  const resourceRoot = path.join(targetRoot, "managed-resources");
  const predecessorResource = path.join(resourceRoot, PREDECESSOR_ID);
  await mkdir(predecessorResource, { recursive: true });
  await writeFile(path.join(predecessorResource, "database.marker"), "owned\n", "utf8");
  projectService.setResourceEnvironmentProvider({
    async environmentForResources() {
      return { environment: {} };
    },
    async removeSessionResources(input) {
      resourceCalls.push(input);
      await rm(path.join(resourceRoot, input.sessionId), {
        force: true,
        recursive: true
      });
      return { ok: true };
    }
  });
  const commandProject = projectServiceProxy(projectService, runtime);
  const attachmentRoot = path.join(targetRoot, "attachments");
  const env = {
    VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot,
    VIBE64_RUNTIME_NAMESPACE: `renewal-resource-${randomUUID()}`,
    VIBE64_RUNTIME_PACK_ROOT: path.join(targetRoot, "runtime-packs")
  };
  const codexToolHomeSource = path.join(targetRoot, "codex-tool-home");
  await mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true });
  await writeFile(
    path.join(codexToolHomeSource, ".codex", "auth.json"),
    `${JSON.stringify({
      OPENAI_API_KEY: "renewal-resource-proof-key",
      auth_mode: "api_key"
    })}\n`,
    "utf8"
  );
  const terminalService = createTerminalService({
    codexTerminalController: {
      codexToolHomeRequired: false,
      codexToolHomeSource
    },
    env,
    projectService: commandProject
  });
  const predecessor = await runtime.getSession(PREDECESSOR_ID, {
    inspectSource: false
  });
  const resources = await createLiveResourceSet({
    attachmentRoot,
    commandProject,
    env,
    session: predecessor,
    targetRoot
  });
  let attachmentReleaseCalls = 0;
  const terminals = {
    ...terminalService,
    async assertSessionRenewalIdle() {
      return { idle: true, ok: true };
    },
    async checkSessionUpdates() {
      return {
        canonicalCommit: commit,
        relationship: "current",
        sessionCurrent: true,
        updateAvailable: false
      };
    },
    createSessionRenewalManualHandoverTemplate(input) {
      return sessionRenewalManualHandoverTemplate(input);
    },
    async generateSessionRenewalHandover(sessionId, _input, options) {
      await options.beforeStart({
        session: await runtime.getSession(sessionId, { inspectSource: false })
      });
      return {
        handover: handoverText(commit),
        threadId: "thread-predecessor",
        turnId: "turn-handover"
      };
    },
    async inspectSessionWork(_sessionId, { session: inspectedSession } = {}) {
      return {
        baseCommit: commit,
        canonicalCommit: commit,
        changedPaths: [],
        dirty: false,
        relationship: "current",
        sessionHead: commit,
        sessionMatchesCanonical: true,
        unsaved: false,
        worktreeClean: true,
        worktreeTopLevel: inspectedSession.sourcePath || inspectedSession.metadata?.source_path
      };
    },
    async releaseRenewalPredecessorAttachments(session, options) {
      attachmentReleaseCalls += 1;
      const result = await terminalService.releaseRenewalPredecessorAttachments(
        session,
        options
      );
      if (loseFirstAttachmentReleaseResponse && attachmentReleaseCalls === 1) {
        const error = new Error("Injected response loss after exact attachment release.");
        error.code = "injected_attachment_release_response_loss";
        error.retryable = true;
        throw error;
      }
      return result;
    },
    async seedSessionRenewalHandover(_sessionId, input) {
      return {
        handoverHash: input.handoverHash,
        message: "Ready to continue.",
        sourceCommit: commit,
        threadId: "thread-successor",
        turnId: "turn-seed"
      };
    },
    validateSessionRenewalHandover(handover, { source }) {
      return defineSessionRenewalHandoverText(handover, {
        requireStructure: true,
        source
      });
    }
  };
  const controller = createSessionRenewalController({
    project: {
      async createRuntime() {
        return runtime;
      },
      releaseSessionResources(input) {
        return projectService.releaseSessionResources(input);
      }
    },
    async resolveSuccessorAssistantSelection(requested, { session, vibe64User }) {
      assert.equal(requested, undefined);
      assert.equal(session.sessionId, PREDECESSOR_ID);
      assert.equal(session.metadata.assistant_selection, serializeVibe64AssistantSelection(ASSISTANT_SELECTION));
      assert.deepEqual(vibe64User, { id: "resource-proof-owner", name: "Resource proof owner" });
      return ASSISTANT_SELECTION;
    },
    setupRunner: {
      isRunning() {
        return false;
      },
      async startRenewal() {
        return { state: { status: "unconfigured" } };
      },
      async wait() {
        return { status: "unconfigured" };
      }
    },
    terminals
  });
  return {
    attachmentReleaseCallCount: () => attachmentReleaseCalls,
    commit,
    controller,
    env,
    predecessorResource,
    projectService,
    resourceCalls,
    resources,
    runtime,
    runtimeDir,
    terminalService
  };
}

async function requestAndConfirmRenewal(context, operationKey) {
  await context.controller.requestSessionRenewalDraft(PREDECESSOR_ID, {
    operationKey,
    vibe64User: { id: "resource-proof-owner", name: "Resource proof owner" }
  });
  const review = await eventually(
    () => readSessionRenewalState(context.runtime, PREDECESSOR_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
  );
  await context.controller.confirmSessionRenewal(PREDECESSOR_ID, {
    expectedHash: review.draft.hash,
    expectedRevision: review.draft.revision,
    operationKey: review.operationKey,
    vibe64User: { id: "resource-proof-owner", name: "Resource proof owner" }
  });
  return review;
}

async function closeHarness(context) {
  await Promise.allSettled([
    context.resources.envCommands.closeAllForSession(PREDECESSOR_ID),
    context.resources.previewCommands.closeAllForSession(PREDECESSOR_ID),
    closeTerminalSessionsForNamespace(context.resources.assistantNamespace),
    closeTerminalSessionsForNamespace(context.resources.launchNamespace),
    context.terminalService.close()
  ]);
}

test("completed renewal removes every predecessor process, command, attachment, and managed resource", {
  timeout: 60_000
}, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const context = await renewalHarness(targetRoot);
    try {
      await context.runtime.store.writeConversationUserMessage(PREDECESSOR_ID, { text: "Configure calendar." });
      const integrationTurn = await context.runtime.store.writeConversationAssistantMessage(PREDECESSOR_ID, {
        text: '```vibe64-integration\n{"integrationId":"calendar"}\n```'
      });
      const integrationRequest = { turnId: integrationTurn.turnId, requestId: integrationTurn.integrationSetup.requestId };
      await context.runtime.store.completeIntegrationSetupRequest(PREDECESSOR_ID, {
        ...integrationRequest, configurationHash: "a".repeat(64), verifiedAt: "2026-09-11T08:00:00Z"
      });
      await requestAndConfirmRenewal(context, "renewal:actual-resource-success");
      const completed = await eventually(
        () => readSessionRenewalState(context.runtime, PREDECESSOR_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED &&
          state?.maintenance?.status === "completed",
        600
      );

      await assertLiveProcessesClosed(context.resources);
      assert.equal(await pathExists(context.resources.attachment.path), false);
      assert.equal(await pathExists(context.runtimeDir), false);
      assert.equal(await pathExists(context.predecessorResource), false);
      assert.equal(context.resourceCalls.length, 1);
      assert.equal(context.resourceCalls[0].sessionId, PREDECESSOR_ID);
      assert.equal(
        path.resolve(context.resourceCalls[0].sourceRoot),
        path.resolve(sourcePath(targetRoot, PREDECESSOR_ID))
      );
      const predecessor = await context.runtime.getSessionForRenewal(PREDECESSOR_ID, {
        inspectSource: false
      });
      const successor = await context.runtime.getSession(completed.commit.successorSessionId, {
        inspectSource: false
      });
      assert.equal(predecessor.archived, true);
      assert.equal(predecessor.status, "archived");
      assert.equal(successor.status, "active");
      assert.equal(successor.metadata.renewed_from, PREDECESSOR_ID);
      const oldRequest = await context.runtime.store.readIntegrationSetupRequest(PREDECESSOR_ID, integrationRequest.turnId);
      assert.equal(oldRequest.outcome, "completed");
      assert.equal(oldRequest.continuation.status, "pending");
      const successorLog = await context.runtime.store.readConversationLog(successor.sessionId);
      assert.equal(successorLog.some((turn) => turn.integrationSetup), false,
        "Renewal carries the handover, not actionable predecessor integration requests.");
      await assert.rejects(context.runtime.store.claimIntegrationContinuation(successor.sessionId, {
        ...integrationRequest, continuationMessageId: oldRequest.continuationMessageId,
        engineId: "codex", threadId: "successor-thread"
      }), { code: "vibe64_integration_setup_request_changed" });

    } finally {
      await closeHarness(context);
    }
  });
});

test("post-commit attachment release is idempotent when its first response is lost", {
  timeout: 60_000
}, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const context = await renewalHarness(targetRoot, {
      loseFirstAttachmentReleaseResponse: true
    });
    try {
      await requestAndConfirmRenewal(context, "renewal:attachment-response-loss");
      const completed = await eventually(
        () => readSessionRenewalState(context.runtime, PREDECESSOR_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED &&
          state?.maintenance?.status === "completed",
        600
      );

      assert.equal(context.attachmentReleaseCallCount(), 2);
      assert.equal(completed.maintenance.steps.attachmentsReleased, true);
      assert.equal(await pathExists(context.resources.attachment.path), false);
      await assertLiveProcessesClosed(context.resources);
      assert.equal(await pathExists(context.runtimeDir), false);
      assert.equal(await pathExists(context.predecessorResource), false);
      assert.equal(context.resourceCalls.length, 1);
    } finally {
      await closeHarness(context);
    }
  });
});

test("an injected pre-commit clone failure restores the predecessor, its attachment, and resource admission", {
  timeout: 60_000
}, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const context = await renewalHarness(targetRoot, {
      failSuccessorCreation: true
    });
    try {
      await requestAndConfirmRenewal(context, "renewal:actual-resource-rollback");
      const failed = await eventually(
        () => readSessionRenewalState(context.runtime, PREDECESSOR_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
      );

      assert.equal(failed.error.code, "injected_successor_clone_failure");
      const predecessor = await context.runtime.getSession(PREDECESSOR_ID, {
        inspectSource: false
      });
      assert.equal(predecessor.status, "active");
      assert.notEqual(predecessor.archived, true);
      assert.equal(await pathExists(predecessor.metadata.source_path), true);
      await assertLiveProcessesClosed(context.resources);
      assert.equal(await pathExists(context.resources.attachment.path), true);
      assert.equal(
        await readFile(context.resources.attachment.path, "utf8"),
        "attachment owned by the predecessor\n"
      );
      assert.equal(await pathExists(context.runtimeDir), true);
      assert.equal(await pathExists(context.predecessorResource), true);
      assert.equal(context.resourceCalls.length, 0);

      await relaunchPredecessorResources(context, predecessor, targetRoot);

      const runtimeProof = JSON.parse(await readFile(
        path.join(context.runtimeDir, "runtime.json"),
        "utf8"
      ));
      assert.equal(runtimeProof.processState, "stopped");
      assert.ok(runtimeProof.processExitVerifiedAt);
    } finally {
      await closeHarness(context);
    }
  });
});
