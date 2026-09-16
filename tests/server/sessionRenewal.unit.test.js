import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSessionRenewalController,
  inspectSessionRenewalEligibility
} from "../../packages/vibe64-sessions/src/server/sessionRenewal.js";
import {
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  createSessionRenewalDraft,
  createSessionRenewalState,
  readSessionRenewalState
} from "../../packages/vibe64-sessions/src/server/sessionRenewalState.js";
import {
  defineSessionRenewalHandoverText,
  sessionRenewalManualHandoverTemplate
} from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";
import {
  inspectSessionWork as inspectGitSessionWork
} from "../../packages/vibe64-terminals/src/server/sessionWorkSave.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const OLD_SESSION_ID = "session-old";
const COMMIT = "a".repeat(40);
const ASSISTANT_SELECTION = Object.freeze({
  agentId: "codex",
  catalogRevision: `sha256:${"b".repeat(64)}`,
  engineId: "codex",
  modelId: "gpt-5.6",
  modelProviderId: "openai",
  variantId: "high"
});
const HANDOVER = [
  "# Session handover",
  "## Objective",
  "Continue the exact saved project work.",
  "## Decisions",
  "Keep the existing architecture.",
  "## Saved source",
  "- Authority: github",
  "- Repository: https://example.test/project.git",
  "- Ref: refs/heads/main",
  `- Commit: ${COMMIT}`,
  "## Touched areas",
  "The current project source.",
  "## Verification",
  "The source is clean and canonical-current.",
  "## Unresolved work",
  "Continue the requested implementation.",
  "## Next action",
  "Inspect the approved handover and continue."
].join("\n");

async function eventually(operation, predicate, attempts = 100, pollIntervalMs = 0) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await operation();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => {
      if (pollIntervalMs > 0) {
        setTimeout(resolve, pollIntervalMs);
        return;
      }
      setImmediate(resolve);
    });
  }
  assert.fail("Timed out waiting for the renewal state.");
}

function workflowBarrier() {
  let signalStarted;
  let release;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  return {
    barrier: {
      started: signalStarted,
      wait
    },
    release,
    started
  };
}

function runLocalCommand(request = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "vibe64@example.test",
        GIT_AUTHOR_NAME: "Vibe64 Test",
        GIT_COMMITTER_EMAIL: "vibe64@example.test",
        GIT_COMMITTER_NAME: "Vibe64 Test",
        ...(request.env || {})
      }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({
      code: "command_failed",
      error: error.message,
      ok: false,
      output: `${stdout}${stderr}`,
      stderr,
      stdout
    }));
    child.once("close", (code) => resolve({
      ...(code === 0 ? {} : { code: "command_failed" }),
      ok: code === 0,
      output: stdout,
      stderr,
      stdout
    }));
    if (request.input !== undefined && request.input !== null) {
      child.stdin.end(request.input);
    } else {
      child.stdin.end();
    }
  });
}

async function runGit(cwd, args = []) {
  const result = await runLocalCommand({
    args,
    command: "git",
    cwd
  });
  if (result.ok !== true) {
    assert.fail(result.stderr || result.output || `git ${args.join(" ")} failed`);
  }
  return String(result.stdout || "").trim();
}

async function createRealGitSuccessorFixture(root, {
  withSubmodule = false
} = {}) {
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const sourcePath = path.join(root, "successor-source");
  await runGit(root, ["init", "--bare", "--initial-branch=main", remote]);
  await runGit(root, ["clone", remote, seed]);
  await Promise.all([
    writeFile(path.join(seed, ".gitignore"), "node_modules/\ndist/\n", "utf8"),
    writeFile(path.join(seed, "app.txt"), "initial\n", "utf8")
  ]);
  await runGit(seed, ["add", ".gitignore", "app.txt"]);
  if (withSubmodule) {
    const submoduleRemote = path.join(root, "submodule.git");
    const submoduleSeed = path.join(root, "submodule-seed");
    await runGit(root, [
      "init",
      "--bare",
      "--initial-branch=main",
      submoduleRemote
    ]);
    await runGit(root, ["clone", submoduleRemote, submoduleSeed]);
    await writeFile(path.join(submoduleSeed, "module.txt"), "module initial\n", "utf8");
    await runGit(submoduleSeed, ["add", "module.txt"]);
    await runGit(submoduleSeed, ["commit", "-m", "initial submodule"]);
    await runGit(submoduleSeed, ["push", "origin", "main"]);
    await runGit(seed, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submoduleRemote,
      "vendor/dependency"
    ]);
    await runGit(seed, ["add", ".gitmodules", "vendor/dependency"]);
  }
  await runGit(seed, ["commit", "-m", "initial"]);
  await runGit(seed, ["push", "origin", "main"]);
  const canonicalCommit = await runGit(seed, ["rev-parse", "HEAD"]);
  await runGit(root, ["clone", "--branch", "main", remote, sourcePath]);
  await runGit(sourcePath, ["checkout", "-b", "vibe64/renewal-successor"]);
  if (withSubmodule) {
    await runGit(sourcePath, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "--recursive"
    ]);
  }
  return {
    canonicalCommit,
    project: {
      githubRepository: { cloneUrl: remote },
      path: path.join(root, "project-namespace"),
      projectRuntimeRoot: path.join(root, "project-runtime"),
      repository: { defaultBranch: "main", mode: "github" },
      repositoryMode: "github"
    },
    remote,
    seed,
    sourcePath
  };
}

function fixture({
  agentWriteLockMisses = 0,
  activationFailure = false,
  archiveBarrier = null,
  archiveFailure = "",
  closeBarrier = null,
  closeErrors = [],
  cleanupFailure = false,
  commitTransitionPostWriteErrors = [],
  commitTransitionPreWriteErrors = [],
  creationBarrier = null,
  creationErrors = [],
  discardErrors = [],
  eligibilityBarrier = null,
  finalSelectionFailure = false,
  generationBarrier = null,
  generationError = null,
  inspectSessionWorkImplementation = null,
  maintenanceStateWriteFailures = [],
  oldThreadId = "thread-old",
  processExitProofReleaseFailures = 0,
  quiesceFailures = 0,
  releaseFailure = false,
  successorDiscardTransitionPostWriteErrors = [],
  successorDiscardTransitionPreWriteErrors = [],
  successorSourcePath = "",
  resolveRenewalActor = null,
  restoreWritableBarrier = null,
  restoreWritableErrors = [],
  seedBarrier = null,
  seedErrors = [],
  setupBarrier = null,
  setupStatus = "succeeded",
  successorCloseErrors = [],
  successorProcessExitProofAuthorizationErrors = [],
  successorProcessExitProofReleaseErrors = [],
  successorRuntimeRoot = "",
  successorAssistantSelection = ASSISTANT_SELECTION,
  temporaryAgentActive = false,
  workflowLockHeld = false,
  workflowLockRetryMs = 1_000,
  canonicalCommit = COMMIT
} = {}) {
  const artifacts = new Map();
  const renewalArtifacts = new Map();
  const events = [];
  const calls = {
    attachmentRelease: 0,
    close: 0,
    cleanupOrder: [],
    compact: 0,
    commitArchive: 0,
    commitSelection: 0,
    commitSuccessor: 0,
    cleanup: 0,
    createActor: null,
    createMetadata: null,
    create: 0,
    createSourceContext: null,
    discard: 0,
    discardTransitionWrites: 0,
    eligibility: 0,
    expectedCommit: "",
    freeze: 0,
    generate: 0,
    maintenanceWrites: [],
    ordering: [],
    processExitProofRelease: 0,
    successorProcessExitProofRelease: 0,
    release: 0,
    releaseInput: null,
    selectionRequests: [],
    renewalClose: null,
    restore: 0,
    restoreClosing: 0,
    restoreWritable: 0,
    rollback: 0,
    rollbackActivation: 0,
    seed: 0,
    seedInput: null,
    seedSessionMetadata: null,
    setup: 0,
    thaw: 0,
    quiesce: 0,
    quiesceRecovery: 0,
    workflowLockAttempts: 0,
    workflowLockMisses: 0
  };
  let conversation = {
    newestTurnId: "turn-before",
    totalTurnCount: 20
  };
  let currentSetupStatus = setupStatus;
  let currentArchiveFailure = archiveFailure;
  let currentActivationFailure = activationFailure;
  let currentCleanupFailure = cleanupFailure;
  let currentFinalSelectionFailure = finalSelectionFailure;
  let currentGenerationError = generationError;
  let currentReleaseFailure = releaseFailure;
  let currentTemporaryAgentActive = temporaryAgentActive;
  let currentWorkflowLockHeld = workflowLockHeld === true;
  let remainingAgentWriteLockMisses = agentWriteLockMisses;
  let remainingProcessExitProofReleaseFailures = Math.max(
    0,
    Number(processExitProofReleaseFailures) || 0
  );
  let remainingQuiesceFailures = quiesceFailures;
  const currentRestoreWritableErrors = [...restoreWritableErrors];
  const currentCloseErrors = [...closeErrors];
  const currentCreationErrors = [...creationErrors];
  const currentCommitTransitionPostWriteErrors = [...commitTransitionPostWriteErrors];
  const currentCommitTransitionPreWriteErrors = [...commitTransitionPreWriteErrors];
  const currentDiscardErrors = [...discardErrors];
  const currentMaintenanceStateWriteFailures = [...maintenanceStateWriteFailures];
  const currentSeedErrors = [...seedErrors];
  const currentSuccessorCloseErrors = [...successorCloseErrors];
  const currentSuccessorDiscardTransitionPostWriteErrors = [
    ...successorDiscardTransitionPostWriteErrors
  ];
  const currentSuccessorDiscardTransitionPreWriteErrors = [
    ...successorDiscardTransitionPreWriteErrors
  ];
  const currentSuccessorProcessExitProofAuthorizationErrors = [
    ...successorProcessExitProofAuthorizationErrors
  ];
  const currentSuccessorProcessExitProofReleaseErrors = [
    ...successorProcessExitProofReleaseErrors
  ];
  let currentSessionId = OLD_SESSION_ID;
  const sessionWorkOverrides = new Map();
  const terminalAdmissions = new Map();
  const sessions = new Map([[OLD_SESSION_ID, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      ...(oldThreadId ? { agent_identity_conversation_id: oldThreadId } : {}),
      base_branch: "main",
      base_commit: canonicalCommit,
      canonical_commit: canonicalCommit,
      repository_mode: "github",
      source_default_branch: "main",
      source_kind: "session_clone",
      source_path: "/tmp/session-old",
      source_remote_url: "https://example.test/project.git"
    },
    sessionId: OLD_SESSION_ID,
    sourceReady: true,
    status: "active",
    workspaceSetup: { status: "succeeded" }
  }]]);
  const exclusiveLocks = new Set();
  const stateMutationChains = new Map();

  const store = {
    async listSessionRenewalStateSessionIds() {
      return [...artifacts.keys()].sort();
    },
    async listSessionsForRenewal() {
      return [...sessions.values()].filter((session) => !session.archived && [
        "active",
        "blocked",
        "renewal_activating",
        "renewal_pending",
        "renewal_quiesced"
      ].includes(session.status));
    },
    async mutateSession(_sessionId, operation) {
      return operation();
    },
    async mutateSessionForRenewal(sessionId, operation) {
      if (!sessions.has(sessionId)) {
        const error = new Error("Unknown session");
        error.code = "vibe64_session_not_found";
        throw error;
      }
      return operation();
    },
    async readArtifact(sessionId) {
      return artifacts.get(sessionId) || "";
    },
    async readSessionRenewalStateRecord(sessionId) {
      return artifacts.get(sessionId) || "";
    },
    async readBackgroundTask() {
      return null;
    },
    async readSessionSourceDescriptor(sessionId) {
      return {
        metadata: { ...sessions.get(sessionId)?.metadata },
        sessionId
      };
    },
    async readStatusForRenewal(sessionId) {
      return sessions.get(sessionId)?.status || "";
    },
    async transitionRenewalSuccessor({
      acknowledgedAt,
      handoverDeliveredAt,
      renewalId,
      sourceSessionId,
      successorSessionId
    }) {
      assert.equal(sessions.get(sourceSessionId).status, "renewal_quiesced");
      assert.ok(acknowledgedAt || handoverDeliveredAt);
      const metadata = sessions.get(successorSessionId).metadata;
      metadata.renewal_id = renewalId;
      metadata.renewal_handover_delivered_at = handoverDeliveredAt || acknowledgedAt;
      if (acknowledgedAt) {
        metadata.renewal_acknowledged_at = acknowledgedAt;
      }
    },
    async activateRenewalSuccessor({ renewalId, sourceSessionId, successorSessionId }) {
      const source = sessions.get(sourceSessionId);
      assert.equal(source.status, "renewal_quiesced");
      assert.equal(source.preparedArchive, true);
      assert.equal(source.preparedMetadata.renewal_id, renewalId);
      assert.equal(source.preparedMetadata.renewed_to, successorSessionId);
      const successor = sessions.get(successorSessionId);
      if (successor.status === "renewal_pending") {
        successor.metadata.renewal_activation_prepared_at = new Date().toISOString();
        successor.status = "renewal_activating";
      }
      assert.equal(successor.status, "renewal_activating");
      if (currentActivationFailure) {
        const error = new Error("Activation unavailable");
        error.code = "activation_failed";
        throw error;
      }
      return successor;
    },
    async rollbackRenewalSuccessorActivation({ renewalId, sourceSessionId, successorSessionId }) {
      const successor = sessions.get(successorSessionId);
      assert.equal(successor.metadata.renewal_id, renewalId);
      assert.equal(successor.metadata.renewed_from, sourceSessionId);
      if (successor.status === "renewal_activating") {
        successor.status = "renewal_pending";
        delete successor.metadata.renewal_activation_prepared_at;
      }
      assert.equal(successor.status, "renewal_pending");
      calls.rollbackActivation += 1;
      return successor;
    },
    async commitRenewalSuccessor({
      committedAt,
      renewalId,
      sourceSessionId,
      successorSessionId
    }) {
      const successor = sessions.get(successorSessionId);
      assert.equal(successor.metadata.renewal_id, renewalId);
      assert.equal(successor.metadata.renewed_from, sourceSessionId);
      if (successor.status === "renewal_activating") {
        successor.metadata.renewal_activated_at = committedAt;
        successor.status = "active";
        calls.commitSuccessor += 1;
      }
      assert.equal(successor.status, "active");
      assert.equal(successor.metadata.renewal_activated_at, committedAt);
      return successor;
    },
    async prepareRenewalSessionArchive({ renewalId, sourceSessionId, successorSessionId }) {
      calls.compact += 1;
      if (archiveBarrier) {
        archiveBarrier.started?.();
        await archiveBarrier.wait;
      }
      if (currentArchiveFailure === "compact") {
        const error = new Error("Archive unavailable");
        error.code = "archive_failed";
        error.retryable = true;
        throw error;
      }
      const source = sessions.get(sourceSessionId);
      const successor = sessions.get(successorSessionId);
      source.preparedArchive = true;
      source.preparedMetadata = {
        ...source.metadata,
        ...successor.metadata,
        renewal_archived_at: new Date().toISOString(),
        renewal_id: renewalId,
        renewal_selected_before_archive:
          currentSessionId === sourceSessionId ? sourceSessionId : "none",
        renewed_to: successorSessionId
      };
      return {
        archivedAt: source.preparedMetadata.renewal_archived_at,
        index: {
          metadata: { ...source.preparedMetadata }
        }
      };
    },
    async restoreRenewalClosingSession({ sourceSessionId }) {
      calls.restoreClosing += 1;
      const source = sessions.get(sourceSessionId);
      source.preparedArchive = false;
      delete source.preparedMetadata;
      assert.equal(source.status, "renewal_quiesced");
    },
    async commitRenewalArchive({ renewalId, sourceSessionId, successorSessionId }) {
      const source = sessions.get(sourceSessionId);
      if (!source.archived) {
        assert.equal(source.status, "renewal_quiesced");
        assert.equal(source.preparedArchive, true);
        assert.equal(source.preparedMetadata.renewal_id, renewalId);
        assert.equal(source.preparedMetadata.renewed_to, successorSessionId);
        source.metadata = { ...source.preparedMetadata };
        source.status = "archived";
        source.archived = true;
        source.archiveRetained = true;
        if (currentSessionId === sourceSessionId) {
          currentSessionId = "";
        }
      }
      return {
        archivedAt: source.metadata.renewal_archived_at,
        index: {
          metadata: { ...source.metadata }
        }
      };
    },
    async finalizeRenewalArchiveCommit({ renewalId, sourceSessionId, successorSessionId }) {
      const source = sessions.get(sourceSessionId);
      assert.equal(source.archived, true);
      assert.equal(source.metadata.renewal_id, renewalId);
      assert.equal(source.metadata.renewed_to, successorSessionId);
      source.archiveRetained = false;
      source.preparedArchive = false;
      delete source.preparedMetadata;
      calls.commitArchive += 1;
      return source;
    },
    async removeRenewalPendingSession({ sessionId }) {
      sessions.delete(sessionId);
      return { removed: true, sessionId };
    },
    async runSessionExclusive(sessionId, _name, operation) {
      if (sessions.get(sessionId)?.status === "renewal_quiesced") {
        const error = new Error("Session renewal is in progress.");
        error.code = "vibe64_session_renewal_quiesced";
        throw error;
      }
      if (remainingAgentWriteLockMisses > 0) {
        remainingAgentWriteLockMisses -= 1;
        return {
          acquired: false,
          value: {
            code: "vibe64_session_renewal_agent_busy",
            error: "Another assistant operation is starting. Try again in a moment."
          }
        };
      }
      return { acquired: true, value: await operation() };
    },
    async runSessionExclusiveForRenewal(sessionId, name, operation) {
      const key = `${sessionId}:${name}`;
      if (exclusiveLocks.has(key)) {
        calls.workflowLockMisses += 1;
        return { acquired: false, value: null };
      }
      exclusiveLocks.add(key);
      try {
        return { acquired: true, value: await operation() };
      } finally {
        exclusiveLocks.delete(key);
      }
    },
    async runSessionRenewalStateExclusive(sessionId, operation) {
      const previous = stateMutationChains.get(sessionId) || Promise.resolve();
      let release = () => null;
      const current = new Promise((resolve) => {
        release = resolve;
      });
      stateMutationChains.set(sessionId, previous.then(() => current));
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (stateMutationChains.get(sessionId) === current) {
          stateMutationChains.delete(sessionId);
        }
      }
    },
    async runSessionRenewalWorkflowExclusive(sessionId, operation) {
      calls.workflowLockAttempts += 1;
      if (currentWorkflowLockHeld) {
        calls.workflowLockMisses += 1;
        return { acquired: false, value: null };
      }
      return store.runSessionExclusiveForRenewal(sessionId, "renewal-workflow", operation);
    },
    async readArtifactForRenewal(sessionId, relativePath) {
      return renewalArtifacts.get(`${sessionId}:${relativePath}`) || "";
    },
    async writeJsonArtifactForRenewal(sessionId, relativePath, value) {
      const authorizationError = currentSuccessorProcessExitProofAuthorizationErrors.shift();
      if (authorizationError) {
        throw authorizationError;
      }
      renewalArtifacts.set(
        `${sessionId}:${relativePath}`,
        `${JSON.stringify(value, null, 2)}\n`
      );
      calls.cleanupOrder.push("authorize-process-exit-proof-release");
    },
    async writeSessionRenewalStateRecord(sessionId, value) {
      const previous = artifacts.get(sessionId);
      const previousState = previous ? JSON.parse(previous) : null;
      let maintenanceWritePhase = "";
      if (
        value.status === SESSION_RENEWAL_STATUS.COMPLETED &&
        value.maintenance &&
        previousState?.maintenance
      ) {
        if (
          Number(value.maintenance.attempt) >
            Number(previousState.maintenance.attempt)
        ) {
          maintenanceWritePhase = "attempt";
        } else if (
          value.maintenance.status === "failed" &&
          previousState.maintenance.status !== "failed"
        ) {
          maintenanceWritePhase = "failed";
        } else if (
          value.maintenance.status === "completed" &&
          previousState.maintenance.status !== "completed"
        ) {
          maintenanceWritePhase = "completed";
        } else {
          const completedStep = Object.keys(value.maintenance.steps || {})
            .find((name) => (
              value.maintenance.steps[name] === true &&
              previousState.maintenance.steps?.[name] !== true
            ));
          if (completedStep) {
            maintenanceWritePhase = `step:${completedStep}`;
          }
        }
      }
      if (maintenanceWritePhase) {
        calls.maintenanceWrites.push(maintenanceWritePhase);
        const failure = currentMaintenanceStateWriteFailures[0];
        if (failure?.phase === maintenanceWritePhase) {
          currentMaintenanceStateWriteFailures.shift();
          throw failure.error;
        }
      }
      const writesFirstCommitMarker = Boolean(
        value.commit?.committedAt && !previousState?.commit?.committedAt
      );
      if (writesFirstCommitMarker) {
        const preWriteCommitError = currentCommitTransitionPreWriteErrors.shift();
        if (preWriteCommitError) {
          throw preWriteCommitError;
        }
      }
      if (value.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING) {
        calls.discardTransitionWrites += 1;
        const preWriteError = currentSuccessorDiscardTransitionPreWriteErrors.shift();
        if (preWriteError) {
          throw preWriteError;
        }
      }
      artifacts.set(sessionId, `${JSON.stringify(value, null, 2)}\n`);
      if (writesFirstCommitMarker) {
        const postWriteCommitError = currentCommitTransitionPostWriteErrors.shift();
        if (postWriteCommitError) {
          throw postWriteCommitError;
        }
      }
      if (value.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING) {
        const postWriteError = currentSuccessorDiscardTransitionPostWriteErrors.shift();
        if (postWriteError) {
          throw postWriteError;
        }
      }
    },
    async writeMetadataValueForRenewal(sessionId, name, value) {
      sessions.get(sessionId).metadata[name] = value;
    },
    async finalizeRenewalCurrentSession({ renewalId, sourceSessionId, successorSessionId }) {
      if (currentFinalSelectionFailure) {
        const error = new Error("Selection unavailable");
        error.code = "selection_failed";
        throw error;
      }
      const source = sessions.get(sourceSessionId);
      const successor = sessions.get(successorSessionId);
      assert.equal(source.preparedMetadata.renewal_id, renewalId);
      assert.equal(successor.status, "renewal_activating");
      const selectedBeforeArchive = source.preparedMetadata.renewal_selected_before_archive;
      return {
        changed: false,
        selectedBeforeArchive,
        sessionId: currentSessionId,
        successorWillBeSelected:
          selectedBeforeArchive === sourceSessionId &&
          (!currentSessionId || currentSessionId === sourceSessionId)
      };
    },
    async commitRenewalCurrentSession({ renewalId, sourceSessionId, successorSessionId }) {
      const source = sessions.get(sourceSessionId);
      const successor = sessions.get(successorSessionId);
      assert.equal(source.metadata.renewal_id, renewalId);
      assert.equal(successor.status, "active");
      const selectedBeforeArchive = source.metadata.renewal_selected_before_archive;
      if (
        selectedBeforeArchive === sourceSessionId &&
        (!currentSessionId || [sourceSessionId, successorSessionId].includes(currentSessionId))
      ) {
        if (currentSessionId !== successorSessionId) {
          calls.commitSelection += 1;
        }
        currentSessionId = successorSessionId;
      }
      return {
        changed: currentSessionId === successorSessionId,
        selectedBeforeArchive,
        sessionId: currentSessionId
      };
    }
  };
  const runtime = {
    store,
    async quiesceSessionForRenewal({ renewalId, sourceSessionId }) {
      const session = sessions.get(sourceSessionId);
      if (session.status === "renewal_quiesced") {
        const currentRenewalId = String(
          session.metadata.renewal_quiesced_id || ""
        ).trim();
        if (currentRenewalId && currentRenewalId !== renewalId) {
          const error = new Error("Session is quiesced for another renewal");
          error.code = "vibe64_session_renewal_conflict";
          throw error;
        }
        if (!currentRenewalId) {
          calls.quiesceRecovery += 1;
          session.metadata.renewal_quiesced_id = renewalId;
          session.metadata.renewal_quiesced_at ||= new Date().toISOString();
        }
        return session;
      }
      assert.equal(session.status, "active");
      calls.ordering.push("quiesce-attempt");
      if (remainingQuiesceFailures > 0) {
        remainingQuiesceFailures -= 1;
        const error = new Error("Quiescence unavailable");
        error.code = "quiesce_failed";
        throw error;
      }
      calls.quiesce += 1;
      calls.ordering.push("quiesce");
      assert.equal(terminalAdmissions.get(sourceSessionId), renewalId);
      assert.ok(calls.ordering.includes("close-exited"));
      session.status = "renewal_quiesced";
      session.metadata.renewal_quiesced_at = new Date().toISOString();
      session.metadata.renewal_quiesced_id = renewalId;
      return session;
    },
    async restoreSessionAfterRenewalCancellation({ renewalId, sourceSessionId }) {
      const session = sessions.get(sourceSessionId);
      if (session.status === "active") {
        return session;
      }
      assert.equal(session.status, "renewal_quiesced");
      assert.equal(session.metadata.renewal_quiesced_id, renewalId);
      if (restoreWritableBarrier) {
        restoreWritableBarrier.started?.();
        await restoreWritableBarrier.wait;
      }
      const restoreError = currentRestoreWritableErrors.shift();
      if (restoreError) {
        throw restoreError;
      }
      calls.restoreWritable += 1;
      session.status = "active";
      session.metadata.renewal_restored_at = new Date().toISOString();
      session.metadata.renewal_restored_id = renewalId;
      delete session.metadata.renewal_quiesced_at;
      delete session.metadata.renewal_quiesced_id;
      return session;
    },
    async commitRenewalSessionSourceRemoval() {
      calls.cleanup += 1;
      if (currentCleanupFailure) {
        const error = new Error("Source cleanup unavailable");
        error.code = "source_cleanup_failed";
        throw error;
      }
      return { removed: true };
    },
    async createRenewalSession({
      actorDisplayName,
      actorId,
      metadata,
      renewedFrom,
      renewalId,
      sessionId,
      sourceContext
    }) {
      assert.equal(sessions.get(renewedFrom).status, "renewal_quiesced");
      calls.create += 1;
      if (creationBarrier) {
        creationBarrier.started?.();
        await creationBarrier.wait;
      }
      const creationError = currentCreationErrors.shift();
      if (creationError) {
        throw creationError;
      }
      calls.expectedCommit = sourceContext?.expectedCommit || "";
      calls.createActor = { id: actorId, name: actorDisplayName };
      calls.createMetadata = metadata;
      calls.createSourceContext = sourceContext;
      if (sessions.has(sessionId)) {
        return sessions.get(sessionId);
      }
      const successor = {
        agentRuns: [],
        backgroundTasks: [],
        metadata: {
          ...(metadata || {}),
          ...(successorRuntimeRoot
            ? {
                agent_transport_runtime_dir: path.join(successorRuntimeRoot, sessionId)
              }
            : {}),
          base_branch: "main",
          base_commit: canonicalCommit,
          canonical_commit: canonicalCommit,
          repository_mode: "github",
          renewal_id: renewalId,
          renewed_from: renewedFrom,
          source_default_branch: "main",
          source_kind: "session_clone",
          source_path: successorSourcePath || `/tmp/${sessionId}`,
          source_remote_url: "https://example.test/project.git"
        },
        sessionId,
        sourceReady: true,
        status: "renewal_pending",
        workspaceSetup: { status: currentSetupStatus }
      };
      sessions.set(sessionId, successor);
      return successor;
    },
    async discardRenewalSession(sessionId) {
      calls.cleanupOrder.push("discard-successor");
      calls.discard += 1;
      const discardedSourcePath = String(
        sessions.get(sessionId)?.metadata?.source_path || ""
      ).trim();
      sessions.delete(sessionId);
      for (const key of [...renewalArtifacts.keys()]) {
        if (key.startsWith(`${sessionId}:`)) {
          renewalArtifacts.delete(key);
        }
      }
      const error = currentDiscardErrors.shift();
      if (error) {
        throw error;
      }
      if (successorSourcePath && discardedSourcePath === successorSourcePath) {
        await rm(discardedSourcePath, { force: true, recursive: true });
      }
      return { removed: true, sessionId };
    },
    async finalizeRenewalCurrentSession(options) {
      return store.finalizeRenewalCurrentSession(options);
    },
    async activateRenewalSession(options) {
      return store.activateRenewalSuccessor(options);
    },
    async getSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        const error = new Error("Unknown session");
        error.code = "vibe64_session_not_found";
        throw error;
      }
      if (["renewal_activating", "renewal_pending"].includes(session.status)) {
        const error = new Error("Private renewal session");
        error.code = "vibe64_session_renewal_private";
        throw error;
      }
      return session;
    },
    async getSessionForRenewal(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        const error = new Error("Unknown session");
        error.code = "vibe64_session_not_found";
        throw error;
      }
      return session;
    },
    async readConversationLogPage() {
      return { pagination: { ...conversation } };
    },
    async restoreSessionSourceAfterRenewalFailure() {
      calls.restore += 1;
      return { restored: true };
    },
    async prepareSessionSourceForRenewal() {
      assert.equal(sessions.get(OLD_SESSION_ID).status, "renewal_quiesced");
      sessions.get(OLD_SESSION_ID).metadata.source_recovery_saved = "yes";
      return { prepared: true, staged: false };
    },
    async stagePreparedSessionSourceForRenewal() {
      assert.equal(sessions.get(OLD_SESSION_ID).status, "renewal_quiesced");
      assert.equal(
        sessions.get(OLD_SESSION_ID).metadata.source_recovery_saved,
        "yes"
      );
      sessions.get(OLD_SESSION_ID).sourceReady = false;
      return { staged: true };
    },
    async updateCurrentSession(sessionId) {
      currentSessionId = sessionId;
      return sessions.get(sessionId);
    }
  };
  const terminals = {
    async checkSessionUpdates() {
      calls.eligibility += 1;
      if (
        eligibilityBarrier &&
        calls.eligibility >= Math.max(1, Number(eligibilityBarrier.fromCall) || 1)
      ) {
        eligibilityBarrier.started?.();
        await eligibilityBarrier.wait;
      }
      return {
        canonicalCommit,
        canonicalSource: {
          authority: "github",
          commit: canonicalCommit,
          ref: "refs/heads/main",
          repository: "https://example.test/project.git"
        },
        relationship: "current",
        sessionCurrent: true,
        updateAvailable: false
      };
    },
    async closeRenewalPredecessorSessionTerminals(session, options) {
      calls.close += 1;
      calls.ordering.push("close-start");
      assert.ok(terminalAdmissions.has(session.sessionId));
      assert.equal(options.renewalId, terminalAdmissions.get(session.sessionId));
      assert.equal(options.runtime, runtime);
      assert.ok(["active", "renewal_quiesced"].includes(session.status));
      if (closeBarrier) {
        await closeBarrier;
      }
      const closeError = currentCloseErrors.shift();
      if (closeError) {
        throw closeError;
      }
      calls.ordering.push("close-exited");
    },
    async closeRenewalSuccessorSessionTerminals(session, options) {
      calls.cleanupOrder.push("close-terminals");
      calls.renewalClose = {
        options,
        session: {
          ...session,
          metadata: { ...(session.metadata || {}) }
        }
      };
      const error = currentSuccessorCloseErrors.shift();
      if (error) {
        throw error;
      }
      const runtimeDir = session.metadata.agent_transport_runtime_dir;
      if (runtimeDir) {
        await mkdir(runtimeDir, { recursive: true });
        await writeFile(
          path.join(runtimeDir, "runtime.json"),
          `${JSON.stringify({ processState: "stopped", renewalId: options.renewalId })}\n`,
          "utf8"
        );
      }
    },
    async releaseRenewalPredecessorProcessExitProof(session, options) {
      calls.processExitProofRelease += 1;
      calls.ordering.push("process-exit-proof-release");
      assert.equal(session.archived, true);
      assert.equal(session.status, "archived");
      assert.equal(options.renewalId, session.metadata.renewal_id);
      assert.equal(options.runtime, runtime);
      if (remainingProcessExitProofReleaseFailures > 0) {
        remainingProcessExitProofReleaseFailures -= 1;
        const error = new Error("Process-exit proof release unavailable");
        error.code = "vibe64_session_renewal_process_exit_proof_release_failed";
        error.retryable = true;
        throw error;
      }
      return { ok: true, released: true };
    },
    async releaseRenewalPredecessorAttachments(session, options) {
      assert.equal(session.archived, true);
      assert.equal(session.status, "archived");
      assert.equal(options.renewalId, session.metadata.renewal_id);
      assert.equal(options.runtime, runtime);
      calls.attachmentRelease += 1;
      return { alreadyReleased: false, released: true };
    },
    async releaseRenewalSuccessorProcessExitProof(session, options) {
      calls.cleanupOrder.push("release-process-exit-proof");
      calls.successorProcessExitProofRelease += 1;
      assert.equal(session.status, "renewal_pending");
      assert.equal(options.renewalId, session.metadata.renewal_id);
      assert.equal(options.runtime, runtime);
      assert.equal(options.authorization.renewalId, options.renewalId);
      assert.equal(options.authorization.sourceSessionId, session.metadata.renewed_from);
      assert.equal(options.authorization.successorSessionId, session.sessionId);
      assert.equal(
        options.authorization.runtimeDir,
        session.metadata.agent_transport_runtime_dir || ""
      );
      const runtimeDir = session.metadata.agent_transport_runtime_dir;
      if (runtimeDir) {
        await rm(runtimeDir, { force: true, recursive: true });
      }
      const error = currentSuccessorProcessExitProofReleaseErrors.shift();
      if (error) {
        throw error;
      }
      return { ok: true, released: true };
    },
    createSessionRenewalManualHandoverTemplate(input) {
      return sessionRenewalManualHandoverTemplate(input);
    },
    async freezeSessionTerminalAdmissionForRenewal(sessionId, { renewalId }) {
      const current = terminalAdmissions.get(sessionId);
      assert.ok(!current || current === renewalId);
      terminalAdmissions.set(sessionId, renewalId);
      calls.freeze += 1;
      calls.ordering.push("freeze");
      return { frozen: true, ok: true };
    },
    async generateSessionRenewalHandover(sessionId, _input, options) {
      calls.generate += 1;
      await options.beforeStart({ session: sessions.get(sessionId) });
      if (
        generationBarrier &&
        calls.generate >= Math.max(1, Number(generationBarrier.fromCall) || 1)
      ) {
        generationBarrier.started?.();
        await generationBarrier.wait;
      }
      if (currentGenerationError) {
        throw currentGenerationError;
      }
      conversation = {
        newestTurnId: "turn-handover",
        totalTurnCount: 21
      };
      return {
        handover: HANDOVER.replace(COMMIT, canonicalCommit),
        threadId: "thread-old",
        turnId: "turn-handover"
      };
    },
    async inspectSessionWork(sessionId) {
      if (typeof inspectSessionWorkImplementation === "function") {
        return inspectSessionWorkImplementation(sessions.get(sessionId));
      }
      const worktreePath = String(
        sessions.get(sessionId)?.metadata?.source_path || ""
      ).trim();
      return {
        baseCommit: canonicalCommit,
        canonicalCommit,
        changedPaths: [],
        dirty: false,
        relationship: "current",
        sessionHead: canonicalCommit,
        sessionMatchesCanonical: true,
        unsaved: false,
        worktreeClean: true,
        worktreePath,
        worktreeTopLevel: worktreePath,
        ...(sessionWorkOverrides.get(sessionId) || {})
      };
    },
    async assertSessionRenewalIdle() {
      if (currentTemporaryAgentActive) {
        const error = new Error(
          "Wait for Temporary AI work to finish before renewing this session."
        );
        error.code = "vibe64_session_renewal_temporary_agent_active";
        error.retryable = true;
        throw error;
      }
    },
    async seedSessionRenewalHandover(sessionId, input, options = {}) {
      calls.seed += 1;
      calls.seedInput = input;
      calls.seedSessionMetadata = { ...(options.session?.metadata || {}) };
      const runtimeDir = sessions.get(sessionId)?.metadata?.agent_transport_runtime_dir;
      if (runtimeDir) {
        await mkdir(runtimeDir, { recursive: true });
        await writeFile(
          path.join(runtimeDir, "runtime.json"),
          `${JSON.stringify({ processState: "running", sessionId })}\n`,
          "utf8"
        );
      }
      if (
        seedBarrier &&
        calls.seed >= Math.max(1, Number(seedBarrier.fromCall) || 1)
      ) {
        seedBarrier.started?.();
        await seedBarrier.wait;
      }
      const error = currentSeedErrors.shift();
      if (error) {
        throw error;
      }
      return {
        handoverHash: input.handoverHash,
        message: "Ready to continue.",
        sourceCommit: canonicalCommit,
        threadId: "thread-new",
        turnId: "turn-seed"
      };
    },
    async thawSessionTerminalAdmissionForRenewal(sessionId, { renewalId }) {
      const current = terminalAdmissions.get(sessionId);
      assert.ok(!current || current === renewalId);
      terminalAdmissions.delete(sessionId);
      calls.thaw += 1;
      calls.ordering.push("thaw");
      return { frozen: false, ok: true };
    },
    validateSessionRenewalHandover(handover, { source }) {
      return defineSessionRenewalHandoverText(handover, {
        requireStructure: true,
        source
      });
    }
  };
  const setupRunner = {
    isRunning() {
      return false;
    },
    async startRenewal() {
      calls.setup += 1;
      if (setupBarrier) {
        setupBarrier.started?.();
        await setupBarrier.wait;
      }
      return {
        state: { status: currentSetupStatus }
      };
    },
    async wait() {
      return { status: currentSetupStatus };
    }
  };
  const project = {
    async createRuntime() {
      return runtime;
    },
    async releaseSessionResources(input) {
      if (input?.session?.status === "renewal_pending") {
        calls.cleanupOrder.push("release-resources");
      }
      calls.release += 1;
      calls.releaseInput = input;
      if (currentReleaseFailure) {
        const error = new Error("Resource release unavailable");
        error.code = "resource_release_failed";
        throw error;
      }
    }
  };
  const newController = (overrides = {}) => createSessionRenewalController({
    project,
    publishSessionChanged: async (_sessionId, event) => events.push(event),
    resolveRenewalActor,
    resolveSuccessorAssistantSelection: async (requested, options) => {
      calls.selectionRequests.push({ requested, ...options });
      return requested && Object.keys(requested).length > 0
        ? requested
        : successorAssistantSelection;
    },
    setupRunner,
    terminals,
    workflowLockRetryMs,
    ...overrides
  });
  const controller = newController();

  return {
    artifacts,
    calls,
    controller,
    events,
    get currentSessionId() {
      return currentSessionId;
    },
    newController,
    project,
    runtime,
    sessions,
    setupRunner,
    terminals,
    terminalAdmissions,
    setConversation(value) {
      conversation = value;
    },
    setArchiveFailure(value) {
      currentArchiveFailure = value;
    },
    setActivationFailure(value) {
      currentActivationFailure = value;
    },
    setAgentWriteLockMisses(value) {
      remainingAgentWriteLockMisses = Math.max(0, Number(value) || 0);
    },
    setCleanupFailure(value) {
      currentCleanupFailure = value;
    },
    setFinalSelectionFailure(value) {
      currentFinalSelectionFailure = value;
    },
    setGenerationError(value) {
      currentGenerationError = value;
    },
    setProcessExitProofReleaseFailures(value) {
      remainingProcessExitProofReleaseFailures = Math.max(0, Number(value) || 0);
    },
    setReleaseFailure(value) {
      currentReleaseFailure = value;
    },
    setSessionWork(sessionId, value = {}) {
      sessionWorkOverrides.set(sessionId, { ...value });
    },
    setSetupStatus(value) {
      currentSetupStatus = value;
      for (const session of sessions.values()) {
        if (session.sessionId !== OLD_SESSION_ID) {
          session.workspaceSetup = { status: value };
        }
      }
    },
    setTemporaryAgentActive(value) {
      currentTemporaryAgentActive = value === true;
    },
    setWorkflowLockHeld(value) {
      currentWorkflowLockHeld = value === true;
    }
  };
}

async function reviewedRenewal(context, operationKey = "renewal:test") {
  await context.controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
    operationKey,
    vibe64User: { id: "user-1", name: "Jo" }
  });
  return eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
  );
}

test("draft generation is durable, exact, and idempotent", async () => {
  const context = fixture();
  const first = await context.controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
    operationKey: "renewal:test"
  });
  const second = await context.controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
    operationKey: "renewal:test"
  });
  assert.equal(first.renewal.renewalId, second.renewal.renewalId);

  const state = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (current) => current?.status === SESSION_RENEWAL_STATUS.REVIEW
  );
  assert.equal(state.draft.text, HANDOVER);
  assert.equal(state.basis.canonicalCommit, COMMIT);
  assert.deepEqual(state.basis.conversation, {
    newestTurnId: "turn-handover",
    totalTurnCount: 21
  });
  assert.equal(context.calls.generate, 1);
});

test("renewal uses verified project authority despite missing or stale session source metadata", async (t) => {
  for (const stale of [false, true]) {
    await t.test(stale ? "stale metadata" : "missing metadata", async () => {
      const context = fixture();
      const metadata = context.sessions.get(OLD_SESSION_ID).metadata;
      for (const name of ["repository_mode", "source_default_branch", "base_branch", "source_remote_url"]) {
        if (stale) {
          metadata[name] = "stale";
        } else {
          delete metadata[name];
        }
      }
      const reviewed = await reviewedRenewal(context);
      assert.deepEqual(reviewed.basis.source, {
        authority: "github",
        commit: COMMIT,
        ref: "refs/heads/main",
        repository: "https://example.test/project.git"
      });
      await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
        expectedHash: reviewed.draft.hash,
        expectedRevision: reviewed.draft.revision,
        operationKey: reviewed.operationKey
      });
      await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
      );
      assert.equal(context.calls.generate, 1);
      assert.equal(context.calls.seedInput.handover, reviewed.draft.text);
    });
  }
});

test("draft requests cannot create renewal state for a non-active session", async (t) => {
  const scenarios = [{
    prepare() {},
    sessionId: "session-does-not-exist",
    title: "nonexistent"
  }, {
    prepare(context) {
      Object.assign(context.sessions.get(OLD_SESSION_ID), {
        archived: true,
        status: "archived"
      });
    },
    sessionId: OLD_SESSION_ID,
    title: "archived"
  }, {
    prepare(context) {
      context.sessions.set("session-hidden-successor", {
        agentRuns: [],
        backgroundTasks: [],
        metadata: {
          renewal_id: "renewal:hidden",
          renewed_from: OLD_SESSION_ID,
          source_path: "/tmp/session-hidden-successor"
        },
        sessionId: "session-hidden-successor",
        sourceReady: true,
        status: "renewal_pending",
        workspaceSetup: { status: "succeeded" }
      });
    },
    sessionId: "session-hidden-successor",
    title: "hidden renewal successor"
  }];

  for (const scenario of scenarios) {
    await t.test(scenario.title, async () => {
      const context = fixture();
      scenario.prepare(context);

      await assert.rejects(
        () => context.controller.requestSessionRenewalDraft(scenario.sessionId, {
          operationKey: `renewal:invalid-${scenario.title}`
        })
      );

      assert.equal(context.artifacts.has(scenario.sessionId), false);
      assert.equal(context.calls.generate, 0);
    });
  }
});

test("restart discovery resumes draft generation before any renewal metadata exists", async () => {
  const context = fixture();
  const state = createSessionRenewalState({
    actor: { id: "user-1", name: "Jo" },
    operationKey: "renewal:restart-draft",
    sessionId: OLD_SESSION_ID
  });
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...state,
    generation: {
      attempt: 1,
      operationId: "renewal:restart-draft-generation"
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();
  const reviewed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

  assert.deepEqual(resumed.discoveredSessionIds, [OLD_SESSION_ID]);
  assert.deepEqual(resumed.resumedSessionIds, [OLD_SESSION_ID]);
  assert.deepEqual(resumed.failures, []);
  assert.equal(reviewed.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(context.calls.generate, 1);
});

test("two controller instances use one filesystem workflow lock for draft generation", async () => {
  let signalStarted;
  let releaseGeneration;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const wait = new Promise((resolve) => {
    releaseGeneration = resolve;
  });
  const context = fixture({
    generationBarrier: {
      started: signalStarted,
      wait
    }
  });
  await context.controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
    operationKey: "renewal:cross-process"
  });
  await started;

  const second = await context.newController().requestSessionRenewalDraft(
    OLD_SESSION_ID,
    { operationKey: "renewal:cross-process" }
  );
  assert.equal(second.renewal.status, SESSION_RENEWAL_STATUS.RUNNING);
  assert.equal(context.calls.generate, 1);
  assert.equal(context.calls.workflowLockMisses, 1);

  releaseGeneration();
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
  );
  assert.equal(context.calls.generate, 1);
});

test("boot recovery retries a contended workflow lock without another request", async () => {
  const context = fixture({
    workflowLockHeld: true,
    workflowLockRetryMs: 10
  });
  const state = createSessionRenewalState({
    actor: { id: "user-1", name: "Jo" },
    operationKey: "renewal:boot-lock-retry",
    sessionId: OLD_SESSION_ID
  });
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...state,
    generation: {
      attempt: 1,
      operationId: "renewal:boot-lock-retry-generation"
    }
  }, null, 2)}\n`);

  const projectScope = new AsyncLocalStorage();
  const scopedProject = {
    ...context.project,
    async createRuntime(input) {
      assert.equal(projectScope.getStore(), "project-a");
      return context.project.createRuntime(input);
    }
  };
  const controller = context.newController({ project: scopedProject });

  const first = await projectScope.run(
    "project-a",
    () => controller.resumeSessionRenewals()
  );
  const second = await projectScope.run(
    "project-a",
    () => controller.resumeSessionRenewals()
  );

  assert.deepEqual(first.resumedSessionIds, [OLD_SESSION_ID]);
  assert.deepEqual(second.resumedSessionIds, [OLD_SESSION_ID]);
  assert.equal(context.calls.generate, 0);
  assert.equal(context.calls.workflowLockAttempts, 2);
  assert.equal(context.calls.workflowLockMisses, 2);

  await eventually(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    return context.calls.workflowLockAttempts;
  }, (attempts) => attempts >= 3);
  assert.equal(context.calls.workflowLockAttempts, 3);
  assert.equal(context.calls.workflowLockMisses, 3);

  context.setWorkflowLockHeld(false);
  const reviewed = await eventually(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    return readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  }, (current) => current?.status === SESSION_RENEWAL_STATUS.REVIEW);

  assert.equal(reviewed.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(context.calls.generate, 1);
  assert.equal(context.calls.workflowLockAttempts, 4);
  assert.equal(context.calls.workflowLockMisses, 3);
});

test("renewal shutdown drains a held boot scan and admits no later recovery work", async () => {
  const context = fixture();
  const state = createSessionRenewalState({
    actor: { id: "user-1", name: "Jo" },
    operationKey: "renewal:shutdown-held-scan",
    sessionId: OLD_SESSION_ID
  });
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...state,
    generation: {
      attempt: 1,
      operationId: "renewal:shutdown-held-scan-generation"
    }
  }, null, 2)}\n`);

  let signalScanStarted;
  let releaseScan;
  const scanStarted = new Promise((resolve) => {
    signalScanStarted = resolve;
  });
  const heldScan = new Promise((resolve) => {
    releaseScan = resolve;
  });
  const listStateSessionIds = context.runtime.store.listSessionRenewalStateSessionIds;
  context.runtime.store.listSessionRenewalStateSessionIds = async () => {
    signalScanStarted();
    await heldScan;
    return listStateSessionIds();
  };
  const controller = context.newController();

  const recovery = controller.resumeSessionRenewals();
  await scanStarted;
  let shutdownSettled = false;
  const shutdown = controller.closeSessionRenewalWork().then(() => {
    shutdownSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);

  releaseScan();
  const [report] = await Promise.all([recovery, shutdown]);
  assert.deepEqual(report, {
    discoveredSessionIds: [],
    failures: [],
    resumedSessionIds: []
  });
  assert.equal(context.calls.workflowLockAttempts, 0);

  await controller.resumeSessionRenewals();
  assert.equal(
    context.calls.workflowLockAttempts,
    0,
    "a closed renewal controller must not start another workflow"
  );
  for (const methodName of [
    "cancelSessionRenewal",
    "confirmSessionRenewal",
    "requestSessionRenewalDraft",
    "retrySessionRenewal",
    "updateSessionRenewalDraft"
  ]) {
    await assert.rejects(
      async () => controller[methodName](OLD_SESSION_ID, {}),
      { code: "vibe64_session_renewal_closing" },
      `${methodName} must reject work that starts after shutdown`
    );
  }
});

test("renewal shutdown drains an invalidated provider turn without publishing its late result", async () => {
  const generation = workflowBarrier();
  const context = fixture({
    generationBarrier: generation.barrier
  });

  await context.controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
    operationKey: "renewal:shutdown-provider-turn"
  });
  await generation.started;
  let shutdownSettled = false;
  const shutdown = context.controller.closeSessionRenewalWork().then(() => {
    shutdownSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);

  generation.release();
  await shutdown;
  const state = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

  assert.equal(state.stage, SESSION_RENEWAL_STAGE.DRAFT_GENERATING);
  assert.equal(state.status, SESSION_RENEWAL_STATUS.RUNNING);
  assert.equal(context.calls.generate, 1);
  assert.equal(
    context.events.some((event) => event.reason === "session-renewal-draft-updated"),
    false
  );
});

test("renewal shutdown clears a pending workflow-lock retry before it can run", async () => {
  const context = fixture({
    workflowLockHeld: true,
    workflowLockRetryMs: 10_000
  });
  const state = createSessionRenewalState({
    actor: { id: "user-1", name: "Jo" },
    operationKey: "renewal:shutdown-lock-retry",
    sessionId: OLD_SESSION_ID
  });
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...state,
    generation: {
      attempt: 1,
      operationId: "renewal:shutdown-lock-retry-generation"
    }
  }, null, 2)}\n`);
  const clearedTimers = [];
  const timers = [];
  const controller = context.newController({
    clearTimeoutFn(timer) {
      clearedTimers.push(timer);
    },
    setTimeoutFn(callback, delayMs) {
      const timer = {
        callback,
        delayMs,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        }
      };
      timers.push(timer);
      return timer;
    }
  });

  await controller.resumeSessionRenewals();
  assert.equal(context.calls.workflowLockAttempts, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 10_000);
  assert.equal(timers[0].unrefCalled, true);

  await controller.closeSessionRenewalWork();
  assert.deepEqual(clearedTimers, [timers[0]]);
  context.setWorkflowLockHeld(false);
  await timers[0].callback();
  await controller.resumeSessionRenewals();

  assert.equal(context.calls.workflowLockAttempts, 1);
  assert.equal(context.calls.generate, 0);
});

test("same-named sessions in two hosted projects schedule by durable renewal identity", async () => {
  const first = fixture();
  const second = fixture();
  const projectScope = new AsyncLocalStorage();
  const current = () => {
    const context = projectScope.getStore();
    assert.ok(context, "hosted project context must remain attached");
    return context;
  };
  const project = {
    createRuntime() {
      return current().runtime;
    },
    releaseSessionResources(input) {
      return current().project.releaseSessionResources(input);
    }
  };
  const terminals = new Proxy({}, {
    get(_target, name) {
      const operation = current().terminals[name];
      return typeof operation === "function"
        ? (...args) => operation(...args)
        : operation;
    }
  });
  const setupRunner = new Proxy({}, {
    get(_target, name) {
      const operation = current().setupRunner[name];
      return typeof operation === "function"
        ? (...args) => operation(...args)
        : operation;
    }
  });
  const controller = createSessionRenewalController({
    project,
    setupRunner,
    terminals
  });

  await Promise.all([
    projectScope.run(first, () => controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
      operationKey: "renewal:hosted-first"
    })),
    projectScope.run(second, () => controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
      operationKey: "renewal:hosted-second"
    }))
  ]);
  await Promise.all([
    eventually(
      () => readSessionRenewalState(first.runtime, OLD_SESSION_ID),
      (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
    ),
    eventually(
      () => readSessionRenewalState(second.runtime, OLD_SESSION_ID),
      (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
    )
  ]);

  assert.equal(first.calls.generate, 1);
  assert.equal(second.calls.generate, 1);
  assert.notEqual(
    (await readSessionRenewalState(first.runtime, OLD_SESSION_ID)).renewalId,
    (await readSessionRenewalState(second.runtime, OLD_SESSION_ID)).renewalId
  );
});

test("inspection by another actor is read-only throughout private successor work", async (t) => {
  for (const scenario of [
    { calls: "create", fixtureOption: "creationBarrier", name: "clone" },
    { calls: "setup", fixtureOption: "setupBarrier", name: "setup", setupStatus: "running" },
    { calls: "seed", fixtureOption: "seedBarrier", name: "seed" },
    { calls: "compact", fixtureOption: "archiveBarrier", name: "archive" }
  ]) {
    await t.test(scenario.name, async () => {
      const gate = workflowBarrier();
      const context = fixture({
        [scenario.fixtureOption]: gate.barrier,
        ...(scenario.setupStatus ? { setupStatus: scenario.setupStatus } : {})
      });
      const reviewed = await reviewedRenewal(context, `renewal:poll-${scenario.name}`);
      await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
        expectedHash: reviewed.draft.hash,
        expectedRevision: reviewed.draft.revision,
        operationKey: reviewed.operationKey,
        vibe64User: { id: "actor-a", name: "Actor A" }
      });
      await gate.started;

      const before = context.artifacts.get(OLD_SESSION_ID);
      const beforeState = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
      const polling = context.newController();
      const first = await polling.inspectSessionRenewal(OLD_SESSION_ID, {
        vibe64User: { id: "actor-b", name: "Actor B" }
      });
      const second = await polling.inspectSessionRenewal(OLD_SESSION_ID, {
        vibe64User: { id: "actor-b", name: "Actor B" }
      });
      const healthyRetry = await polling.retrySessionRenewal(OLD_SESSION_ID, {
        operationKey: reviewed.operationKey,
        vibe64User: { id: "actor-b", name: "Actor B" }
      });

      assert.equal(context.artifacts.get(OLD_SESSION_ID), before);
      assert.equal(first.renewal.revision, beforeState.revision);
      assert.equal(second.renewal.revision, beforeState.revision);
      assert.equal(healthyRetry.renewal.revision, beforeState.revision);
      assert.deepEqual(beforeState.continuedBy, { id: "actor-a", name: "Actor A" });
      assert.equal(context.calls[scenario.calls], 1);
      assert.notEqual(first.viewerScope, "");
      assert.equal(first.viewerScope, second.viewerScope);

      if (scenario.name === "setup") {
        context.setSetupStatus("succeeded");
      }
      gate.release();
      await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
      );
    });
  }
});

test("restart discovery isolates an unreadable renewal artifact from another resumable session", async () => {
  const context = fixture();
  const secondSessionId = "session-second";
  context.sessions.set(secondSessionId, {
    ...context.sessions.get(OLD_SESSION_ID),
    metadata: {
      ...context.sessions.get(OLD_SESSION_ID).metadata,
      source_path: "/tmp/session-second"
    },
    sessionId: secondSessionId
  });
  context.artifacts.set(OLD_SESSION_ID, "{not-json\n");
  const state = createSessionRenewalState({
    actor: { id: "user-2", name: "Dee" },
    operationKey: "renewal:second-restart",
    sessionId: secondSessionId
  });
  context.artifacts.set(secondSessionId, `${JSON.stringify({
    ...state,
    generation: {
      attempt: 1,
      operationId: "renewal:second-generation"
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();

  assert.deepEqual(resumed.discoveredSessionIds, [secondSessionId]);
  assert.deepEqual(resumed.resumedSessionIds, [secondSessionId]);
  assert.equal(resumed.failures.length, 1);
  assert.equal(resumed.failures[0].sessionId, OLD_SESSION_ID);
  assert.equal(resumed.failures[0].code, "vibe64_session_renewal_state_invalid");
  assert.equal(
    (await readSessionRenewalState(context.runtime, secondSessionId)).status,
    SESSION_RENEWAL_STATUS.REVIEW
  );
});

test("an unreadable old thread becomes an explicit editable manual draft", async () => {
  const error = new Error("Unreadable");
  error.code = "vibe64_session_renewal_thread_unreadable";
  const context = fixture({ generationError: error });
  const state = await reviewedRenewal(context);

  assert.equal(
    state.draft.text,
    sessionRenewalManualHandoverTemplate({ source: state.basis.source })
  );
  assert.equal(state.draft.origin, "manual");
  assert.equal(state.manualRequired, true);
  assert.equal(state.error.code, error.code);
});

test("a failed predecessor model becomes an explicit editable manual draft", async () => {
  const error = new Error("Authentication failed");
  error.code = "vibe64_session_renewal_turn_failed";
  const context = fixture({ generationError: error });
  const state = await reviewedRenewal(context);

  assert.equal(
    state.draft.text,
    sessionRenewalManualHandoverTemplate({ source: state.basis.source })
  );
  assert.equal(state.draft.origin, "manual");
  assert.equal(state.manualRequired, true);
  assert.equal(state.error.code, error.code);
});

for (const code of [
  "vibe64_codex_app_server_start_failed",
  "vibe64_opencode_start_failed",
  "vibe64_opencode_start_timeout"
]) {
  test(`an unavailable predecessor provider becomes a manual draft (${code})`, async () => {
    const error = new Error("The predecessor provider could not start");
    error.code = code;
    const context = fixture({ generationError: error });
    const state = await reviewedRenewal(context);

    assert.equal(
      state.draft.text,
      sessionRenewalManualHandoverTemplate({ source: state.basis.source })
    );
    assert.equal(state.draft.origin, "manual");
    assert.equal(state.manualRequired, true);
    assert.equal(state.error.code, code);
  });
}

test("a manual handover completes when the unreadable predecessor has no recorded thread id", async () => {
  const error = new Error("Unreadable");
  error.code = "vibe64_session_renewal_thread_unreadable";
  const context = fixture({ generationError: error, oldThreadId: "" });
  const reviewed = await reviewedRenewal(context);
  await assert.rejects(
    () => context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    }),
    { code: "vibe64_session_renewal_manual_handover_incomplete" }
  );
  assert.equal(context.calls.create, 0);
  assert.equal(context.calls.quiesce, 0);
  const updated = await context.controller.updateSessionRenewalDraft(OLD_SESSION_ID, {
    draft: HANDOVER,
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });

  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: updated.renewal.draft.hash,
    expectedRevision: updated.renewal.draft.revision,
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );

  assert.equal(completed.successor.threadId, "thread-new");
  assert.equal(context.calls.seedInput.forbiddenThreadId, "");
  assert.equal(context.sessions.get(OLD_SESSION_ID).archived, true);
});

test("an invalid generated handover preserves bounded output for manual correction", async () => {
  const rawOutput = "Generated text that needs the required handover sections.";
  const error = new Error("Invalid generated handover");
  error.code = "vibe64_session_renewal_handover_invalid";
  error.details = { rawOutput };
  const context = fixture({ generationError: error });
  const state = await reviewedRenewal(context);

  assert.equal(state.draft.text, rawOutput);
  assert.equal(state.draft.origin, "manual");
  assert.equal(state.manualRequired, true);
  assert.equal(state.error.code, error.code);
  assert.match(state.error.message, /review and edit/iu);
});

test("an oversized invalid provider response becomes an exact manual template", async () => {
  const error = new Error("Invalid generated handover");
  error.code = "vibe64_session_renewal_handover_source_mismatch";
  error.details = { rawOutput: "x".repeat(20_001) };
  const context = fixture({ generationError: error });
  const state = await reviewedRenewal(context);

  assert.equal(
    state.draft.text,
    sessionRenewalManualHandoverTemplate({ source: state.basis.source })
  );
  assert.equal(state.manualRequired, true);
  assert.match(state.error.message, /editable handover template/iu);
});

test("manual confirmation requires every heading and the exact Saved source envelope", async (t) => {
  for (const scenario of [{
    code: "vibe64_session_renewal_handover_invalid",
    draft: "# Session handover\n\nContinue carefully.",
    title: "missing required headings"
  }, {
    code: "vibe64_session_renewal_handover_source_mismatch",
    draft: HANDOVER.replace(`- Commit: ${COMMIT}`, `- Commit: ${"b".repeat(40)}`),
    title: "canonical source mismatch"
  }]) {
    await t.test(scenario.title, async () => {
      const error = new Error("Unreadable");
      error.code = "vibe64_session_renewal_thread_unreadable";
      const context = fixture({ generationError: error });
      const reviewed = await reviewedRenewal(context);
      const updated = await context.controller.updateSessionRenewalDraft(OLD_SESSION_ID, {
        draft: scenario.draft,
        expectedHash: reviewed.draft.hash,
        expectedRevision: reviewed.draft.revision,
        operationKey: reviewed.operationKey
      });

      await assert.rejects(
        context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
          expectedHash: updated.renewal.draft.hash,
          expectedRevision: updated.renewal.draft.revision,
          operationKey: reviewed.operationKey
        }),
        { code: scenario.code }
      );
      assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
      assert.equal(context.calls.freeze, 0);
      assert.equal(context.calls.close, 0);
    });
  }
});

test("draft edits use optimistic concurrency and cancellation is terminal", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context);
  const updated = await context.controller.updateSessionRenewalDraft(OLD_SESSION_ID, {
    draft: "Edited handover\n",
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  assert.equal(updated.renewal.draft.text, "Edited handover\n");
  await assert.rejects(
    context.controller.updateSessionRenewalDraft(OLD_SESSION_ID, {
      draft: "Stale",
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    }),
    { code: "vibe64_session_renewal_draft_stale" }
  );
  const cancelled = await context.controller.cancelSessionRenewal(OLD_SESSION_ID, {
    expectedHash: updated.renewal.draft.hash,
    expectedRevision: updated.renewal.draft.revision,
    operationKey: reviewed.operationKey
  });
  assert.equal(cancelled.renewal.status, SESSION_RENEWAL_STATUS.CANCELLED);
});

test("draft update, cancellation, and cancelled request replays are domain-idempotent", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context, "renewal:idempotent-review");
  const updateInput = {
    draft: "Edited once\n",
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  };
  const firstUpdate = await context.controller.updateSessionRenewalDraft(
    OLD_SESSION_ID,
    updateInput
  );
  const replayedUpdate = await context.controller.updateSessionRenewalDraft(
    OLD_SESSION_ID,
    updateInput
  );
  assert.deepEqual(replayedUpdate.renewal.draft, firstUpdate.renewal.draft);

  const cancelInput = {
    expectedHash: firstUpdate.renewal.draft.hash,
    expectedRevision: firstUpdate.renewal.draft.revision,
    operationKey: reviewed.operationKey
  };
  const firstCancel = await context.controller.cancelSessionRenewal(
    OLD_SESSION_ID,
    cancelInput
  );
  const replayedCancel = await context.controller.cancelSessionRenewal(
    OLD_SESSION_ID,
    cancelInput
  );
  const replayedRequest = await context.controller.requestSessionRenewalDraft(
    OLD_SESSION_ID,
    { operationKey: reviewed.operationKey }
  );
  assert.equal(replayedCancel.renewal.renewalId, firstCancel.renewal.renewalId);
  assert.equal(replayedRequest.renewal.status, SESSION_RENEWAL_STATUS.CANCELLED);
  assert.equal(replayedRequest.renewal.renewalId, firstCancel.renewal.renewalId);

  const restarted = await context.controller.requestSessionRenewalDraft(
    OLD_SESSION_ID,
    { operationKey: "renewal:after-cancel" }
  );
  assert.notEqual(restarted.renewal.renewalId, firstCancel.renewal.renewalId);
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
  );
});

test("confirmation and retry replays return the completed renewal with confirmer attribution", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context, "renewal:confirmed-replay");
  const confirmation = {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey,
    vibe64User: { id: "confirmer-2", name: "Rae" }
  };
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, confirmation);
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  const confirmedReplay = await context.controller.confirmSessionRenewal(
    OLD_SESSION_ID,
    confirmation
  );
  const retryReplay = await context.controller.retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey
  });

  assert.equal(confirmedReplay.renewal.renewalId, completed.renewalId);
  assert.equal(retryReplay.renewal.renewalId, completed.renewalId);
  assert.deepEqual(context.calls.createActor, { id: "confirmer-2", name: "Rae" });
  assert.equal(context.calls.releaseInput.session.sessionId, OLD_SESSION_ID);
  assert.equal(context.calls.releaseInput.session.archived, true);
});

test("a confirmation replay resumes a durably approved workflow that was never scheduled", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context, "renewal:lost-confirm-response");
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "actor-a", name: "Actor A" },
    continuedBy: { id: "actor-a", name: "Actor A" },
    revision: reviewed.revision + 1,
    stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      replacementCeiling: 2
    }
  }, null, 2)}\n`);

  const replay = await context.newController().confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey,
    vibe64User: { id: "actor-a", name: "Actor A" }
  });

  assert.equal(replay.renewal.status, SESSION_RENEWAL_STATUS.RUNNING);
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(context.calls.create, 1);
  assert.equal(context.calls.seed, 1);
});

test("a saved source failure can be retried through quota exhaustion to a reviewed manual handover", async () => {
  const quotaError = new Error("You've hit your usage limit.");
  quotaError.code = "vibe64_session_renewal_turn_failed";
  const context = fixture({ generationError: quotaError });
  context.setSessionWork(OLD_SESSION_ID, {
    changedPaths: ["src/app.js"], dirty: true, unsaved: true
  });
  await context.controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
    operationKey: "renewal:unsaved-and-quota"
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(failed.error.code, "vibe64_session_renewal_source_not_ready");
  assert.equal(failed.error.retryable, true);

  // A deployed version persisted this flag as false. Reload and retry that
  // exact operation without deleting its state or bypassing the source check.
  context.artifacts.set(OLD_SESSION_ID, JSON.stringify({
    ...failed, error: { ...failed.error, retryable: false }
  }));
  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: failed.operationKey
  });
  const stillDirty = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(stillDirty.error.code, "vibe64_session_renewal_source_not_ready");
  assert.equal(context.calls.create, 0);
  assert.equal(context.calls.quiesce, 0);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");

  context.setSessionWork(OLD_SESSION_ID, {});
  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: failed.operationKey
  });
  const reviewed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
  );
  assert.equal(reviewed.renewalId, failed.renewalId);
  assert.equal(reviewed.draft.origin, "manual");
  assert.equal(reviewed.manualRequired, true);
  assert.equal(reviewed.error.code, quotaError.code);
  assert.equal(reviewed.draft.text, sessionRenewalManualHandoverTemplate({ source: reviewed.basis.source }));
  const updated = await context.controller.updateSessionRenewalDraft(OLD_SESSION_ID, {
    draft: HANDOVER,
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const selected = {
    agentId: "build", catalogRevision: `sha256:${"c".repeat(64)}`,
    engineId: "opencode", modelId: "glm-4.7-flash", modelProviderId: "zai", variantId: ""
  };
  await context.newController().confirmSessionRenewal(OLD_SESSION_ID, {
    assistantSelection: selected,
    expectedHash: updated.renewal.draft.hash,
    expectedRevision: updated.renewal.draft.revision,
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(completed.renewalId, failed.renewalId);
  assert.equal(completed.successor.assistantSelection.engineId, "opencode");
  assert.equal(context.calls.seedInput.handover, HANDOVER);
  assert.equal(context.calls.create, 1);
  assert.equal(context.sessions.get(OLD_SESSION_ID).archived, true);
});

test("one explicit failed-draft retry claims a fresh provider operation and actor", async () => {
  const providerFailure = new Error("Provider turn failed");
  providerFailure.code = "provider_failed";
  providerFailure.retryable = true;
  const gate = workflowBarrier();
  gate.barrier.fromCall = 2;
  const context = fixture({
    generationBarrier: gate.barrier,
    generationError: providerFailure
  });
  await context.controller.requestSessionRenewalDraft(OLD_SESSION_ID, {
    operationKey: "renewal:retry-generation",
    vibe64User: { id: "actor-a", name: "Actor A" }
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(failed.generation.attempt, 1);
  const firstOperationId = failed.generation.operationId;
  context.setGenerationError(null);

  const retryBPromise = context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: failed.operationKey,
    vibe64User: { id: "actor-b", name: "Actor B" }
  });
  await gate.started;
  const retryC = await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: failed.operationKey,
    vibe64User: { id: "actor-c", name: "Actor C" }
  });
  await retryBPromise;
  const claimed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

  assert.equal(retryC.renewal.status, SESSION_RENEWAL_STATUS.RUNNING);
  assert.equal(claimed.generation.attempt, 2);
  assert.notEqual(claimed.generation.operationId, firstOperationId);
  assert.deepEqual(claimed.continuedBy, { id: "actor-b", name: "Actor B" });
  assert.equal(claimed.status, SESSION_RENEWAL_STATUS.RUNNING);

  gate.release();
  const reviewed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
  );
  assert.equal(reviewed.generation.attempt, 2);
  assert.equal(context.calls.generate, 2);
});

test("confirmation keeps the handover for review when the conversation changed", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context);
  context.setConversation({
    newestTurnId: "turn-newer",
    totalTurnCount: 22
  });
  const result = await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  assert.equal(result.renewal.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(result.renewal.draft.text, reviewed.draft.text);
  assert.equal(result.renewal.draft.hash, reviewed.draft.hash);
  assert.equal(result.renewal.draft.revision, reviewed.draft.revision + 1);
  assert.equal(result.renewal.error.code, "vibe64_session_renewal_review_stale");
  assert.equal(context.calls.generate, 1);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.deepEqual(context.calls.ordering.slice(-4), [
    "freeze",
    "close-start",
    "close-exited",
    "thaw"
  ]);
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("unverified predecessor process exit leaves the source active and thaws admission", async () => {
  const closeError = new Error("A predecessor process did not confirm exit.");
  closeError.code = "vibe64_session_renewal_process_exit_unverified";
  closeError.retryable = true;
  const context = fixture({ closeErrors: [closeError] });
  const reviewed = await reviewedRenewal(context);

  await assert.rejects(
    context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    }),
    { code: closeError.code }
  );

  const state = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(state.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(state.stage, SESSION_RENEWAL_STAGE.DRAFT_READY);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
  assert.equal(context.calls.close, 1);
  assert.equal(context.calls.quiesce, 0);
  assert.deepEqual(context.calls.ordering.slice(-3), [
    "freeze",
    "close-start",
    "thaw"
  ]);
});

test("failed quiescence returns to review and a changed source cannot be frozen on retry", async () => {
  const context = fixture({ quiesceFailures: 1 });
  const reviewed = await reviewedRenewal(context);
  const confirmation = {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  };

  await assert.rejects(
    context.controller.confirmSessionRenewal(OLD_SESSION_ID, confirmation),
    { code: "quiesce_failed" }
  );
  const restored = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(restored.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(restored.stage, SESSION_RENEWAL_STAGE.DRAFT_READY);
  assert.equal(restored.approved, null);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);

  context.setConversation({
    newestTurnId: "turn-after-failed-quiescence",
    totalTurnCount: 22
  });
  const result = await context.controller.confirmSessionRenewal(OLD_SESSION_ID, confirmation);
  assert.equal(result.renewal.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(result.renewal.draft.text, reviewed.draft.text);
  assert.equal(context.calls.generate, 1);
  assert.equal(context.calls.quiesce, 0);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("simultaneous duplicate confirmation coalesces one exact renewal workflow", async () => {
  let releaseClose;
  const closeBarrier = new Promise((resolve) => {
    releaseClose = resolve;
  });
  const context = fixture({ closeBarrier });
  const reviewed = await reviewedRenewal(context);
  const confirmation = {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  };

  const first = context.controller.confirmSessionRenewal(OLD_SESSION_ID, confirmation);
  await eventually(
    async () => context.calls.close,
    (closeCount) => closeCount === 1
  );
  const second = context.controller.confirmSessionRenewal(OLD_SESSION_ID, confirmation);
  releaseClose();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.renewal.renewalId, reviewed.renewalId);
  assert.deepEqual(secondResult, firstResult);
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(context.calls.close, 2);
});

test("simultaneous confirmations do not coalesce different draft guards", async () => {
  let releaseClose;
  const closeBarrier = new Promise((resolve) => {
    releaseClose = resolve;
  });
  const context = fixture({ closeBarrier });
  const reviewed = await reviewedRenewal(context);
  const confirmation = {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  };

  const accepted = context.controller.confirmSessionRenewal(OLD_SESSION_ID, confirmation);
  await eventually(
    async () => context.calls.close,
    (closeCount) => closeCount === 1
  );
  const stale = context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    ...confirmation,
    expectedHash: "0".repeat(64)
  });
  releaseClose();

  await accepted;
  await assert.rejects(stale, {
    code: "vibe64_session_renewal_draft_stale"
  });
});

test("a cancellation that wins during confirmation eligibility remains terminal", async () => {
  const eligibility = workflowBarrier();
  const context = fixture({
    eligibilityBarrier: { ...eligibility.barrier, fromCall: 2 }
  });
  const reviewed = await reviewedRenewal(
    context,
    "renewal:cancel-during-confirmation"
  );
  const input = {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  };

  const confirming = context.controller.confirmSessionRenewal(OLD_SESSION_ID, input);
  await eligibility.started;
  const cancelled = await context.controller.cancelSessionRenewal(
    OLD_SESSION_ID,
    input
  );
  assert.equal(cancelled.renewal.status, SESSION_RENEWAL_STATUS.CANCELLED);
  assert.equal(cancelled.renewal.stage, SESSION_RENEWAL_STAGE.CANCELLED);

  eligibility.release();
  await assert.rejects(confirming, {
    code: "vibe64_session_renewal_confirm_not_available"
  });

  const durable = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(durable.status, SESSION_RENEWAL_STATUS.CANCELLED);
  assert.equal(durable.stage, SESSION_RENEWAL_STAGE.CANCELLED);
  assert.equal(Boolean(durable.approved), false);
  assert.equal(context.calls.quiesce, 0);
  assert.equal(context.calls.create, 0);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("confirmed renewal creates a hidden successor and selects it only after acknowledgement and archive", async () => {
  const context = fixture();
  Object.assign(context.sessions.get(OLD_SESSION_ID).metadata, {
    agent_settings_model: "gpt-5.5",
    agent_settings_provider: "codex",
    agent_settings_thinking: "high"
  });
  const reviewed = await reviewedRenewal(context);
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey,
    vibe64User: { id: "user-1", name: "Jo" }
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  await context.controller.inspectSessionRenewal(OLD_SESSION_ID);

  assert.equal(context.calls.close, 2);
  assert.equal(context.calls.seed, 1);
  assert.equal(context.calls.expectedCommit, COMMIT);
  assert.deepEqual(JSON.parse(context.calls.createMetadata.assistant_selection), {
    ...ASSISTANT_SELECTION,
    schema: "vibe64.assistant-selection.v1"
  });
  assert.equal(
    context.calls.seedSessionMetadata.assistant_selection,
    context.calls.createMetadata.assistant_selection
  );
  assert.equal(Object.hasOwn(context.calls.createMetadata, "agent_settings_model"), false);
  assert.deepEqual(completed.successor.assistantSelection, {
    ...ASSISTANT_SELECTION,
    schema: "vibe64.assistant-selection.v1"
  });
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "archived");
  assert.equal(context.sessions.get(completed.successor.sessionId).status, "active");
  assert.equal(context.currentSessionId, completed.successor.sessionId);
  assert.equal(completed.successor.threadId, "thread-new");
  assert.deepEqual(context.calls.ordering.slice(0, 5), [
    "freeze",
    "close-start",
    "close-exited",
    "quiesce-attempt",
    "quiesce"
  ]);
  assert.ok(context.calls.processExitProofRelease >= 1);
  assert.ok(
    context.calls.ordering.indexOf("process-exit-proof-release") <
      context.calls.ordering.indexOf("thaw")
  );
  assert.equal(context.calls.ordering.at(-1), "thaw");
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("renewal durably uses an explicitly selected assistant engine for its successor", async () => {
  const selected = {
    agentId: "build",
    catalogRevision: `sha256:${"c".repeat(64)}`,
    engineId: "opencode",
    modelId: "glm-4.7-flash",
    modelProviderId: "zai",
    variantId: ""
  };
  const context = fixture();
  const reviewed = await reviewedRenewal(context);

  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    assistantSelection: selected,
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );

  assert.deepEqual(context.calls.selectionRequests[0].requested, selected);
  assert.equal(completed.successor.assistantSelection.engineId, "opencode");
  assert.deepEqual(JSON.parse(context.calls.createMetadata.assistant_selection), {
    ...selected,
    schema: "vibe64.assistant-selection.v1"
  });
});

test("an unavailable successor assistant is rejected before the predecessor is stopped", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context);
  const selectionError = new Error("The selected assistant is unavailable.");
  selectionError.code = "vibe64_assistant_selection_unavailable";
  const controller = context.newController({
    resolveSuccessorAssistantSelection: async () => {
      throw selectionError;
    }
  });

  await assert.rejects(
    () => controller.confirmSessionRenewal(OLD_SESSION_ID, {
      assistantSelection: ASSISTANT_SELECTION,
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    }),
    (error) => error === selectionError
  );

  const durable = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(durable.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(context.calls.freeze, 0);
  assert.equal(context.calls.close, 0);
  assert.equal(context.calls.quiesce, 0);
  assert.equal(context.calls.create, 0);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
});

test("a model failure after handover admission still completes with the exact successor", async () => {
  const providerError = new Error("Authentication failed");
  providerError.code = "vibe64_session_renewal_turn_failed";
  providerError.details = {
    handoverPromptAccepted: true,
    threadId: "thread-new",
    turnId: "turn-failed"
  };
  providerError.retryable = true;
  const context = fixture({ seedErrors: [providerError] });
  const reviewed = await reviewedRenewal(context);
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(context.calls.discard, 0);
  assert.deepEqual(context.calls.cleanupOrder, ["close-terminals"]);
  assert.equal(context.calls.renewalClose.session.sessionId.startsWith("renewal-"), true);
  assert.equal(context.calls.renewalClose.session.status, "renewal_pending");
  assert.equal(
    context.calls.renewalClose.session.metadata.renewal_id,
    context.calls.renewalClose.options.renewalId
  );
  assert.equal(context.calls.renewalClose.options.runtime, context.runtime);
  assert.equal(context.calls.seed, 1);
  assert.equal(completed.successor.attempt, 1);
  assert.equal(completed.successor.threadId, "thread-new");
  assert.equal(completed.successor.turnId, "turn-failed");
  assert.ok(completed.successor.handoverDeliveredAt);
  assert.deepEqual(completed.successor.handoverError, {
    code: "vibe64_session_renewal_turn_failed",
    message: "Authentication failed",
    retryable: true
  });
  assert.equal(context.currentSessionId, completed.successor.sessionId);
  assert.equal(context.sessions.get(completed.successor.sessionId).status, "active");
  assert.ok(
    context.sessions.get(completed.successor.sessionId).metadata.renewal_handover_delivered_at
  );
  assert.equal(
    context.sessions.get(completed.successor.sessionId).metadata.renewal_acknowledged_at,
    undefined
  );
});

test("a provider error before handover admission cannot archive the predecessor", async () => {
  const providerError = new Error("Provider request was not admitted");
  providerError.code = "vibe64_session_renewal_turn_failed";
  providerError.retryable = true;
  const context = fixture({ seedErrors: [providerError] });
  const reviewed = await reviewedRenewal(context);

  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );

  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING);
  assert.equal(context.calls.discard, 0);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.currentSessionId, OLD_SESSION_ID);
  assert.equal(
    context.sessions.get(failed.successor.sessionId).status,
    "renewal_pending"
  );
});

test("persistently non-fresh successors consume one durable replacement allowance per user action", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const wrongThread = () => {
      const error = new Error("Successor history is not fresh");
      error.code = "vibe64_session_renewal_fresh_thread_required";
      error.retryable = true;
      return error;
    };
    const secondSeed = workflowBarrier();
    const successorRuntimeRoot = path.join(temporaryRoot, "successor-runtimes");
    const context = fixture({
      seedBarrier: { ...secondSeed.barrier, fromCall: 2 },
      seedErrors: Array.from({ length: 4 }, wrongThread),
      successorRuntimeRoot
    });
    const reviewed = await reviewedRenewal(
      context,
      "renewal:persistently-non-fresh-successors"
    );

    await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    });
    await secondSeed.started;

    const replacementRunning = await readSessionRenewalState(
      context.runtime,
      OLD_SESSION_ID
    );
    assert.equal(replacementRunning.status, SESSION_RENEWAL_STATUS.RUNNING);
    assert.equal(replacementRunning.successor.attempt, 2);
    assert.equal(replacementRunning.successor.replacementCeiling, 2);

    await context.newController().resumeSessionRenewals();
    const afterRestartRecovery = await readSessionRenewalState(
      context.runtime,
      OLD_SESSION_ID
    );
    assert.equal(afterRestartRecovery.successor.attempt, 2);
    assert.equal(afterRestartRecovery.successor.replacementCeiling, 2);
    secondSeed.release();

    const firstFailure = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
    );
    assert.equal(
      firstFailure.error.code,
      "vibe64_session_renewal_successor_replacement_limit_reached"
    );
    assert.equal(firstFailure.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING);
    assert.equal(firstFailure.successor.attempt, 2);
    assert.equal(firstFailure.successor.replacementCeiling, 2);
    assert.equal(context.calls.create, 2);
    assert.equal(context.calls.seed, 2);
    assert.equal(context.calls.discard, 2);
    assert.equal(context.sessions.size, 1);
    assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
    assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
    assert.deepEqual(await readdir(successorRuntimeRoot), []);

    const countsBeforeIdleRecovery = {
      create: context.calls.create,
      discard: context.calls.discard,
      seed: context.calls.seed
    };
    await context.newController().resumeSessionRenewals();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual({
      create: context.calls.create,
      discard: context.calls.discard,
      seed: context.calls.seed
    }, countsBeforeIdleRecovery);

    const closesBeforeRetry = context.calls.close;
    await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
      operationKey: reviewed.operationKey
    });
    const secondFailure = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => (
        state?.status === SESSION_RENEWAL_STATUS.FAILED &&
        state.revision > firstFailure.revision
      )
    );

    assert.equal(
      secondFailure.error.code,
      "vibe64_session_renewal_successor_replacement_limit_reached"
    );
    assert.equal(secondFailure.successor.attempt, 4);
    assert.equal(secondFailure.successor.replacementCeiling, 4);
    assert.equal(context.calls.create, 4);
    assert.equal(context.calls.seed, 4);
    assert.equal(context.calls.discard, 4);
    assert.equal(context.calls.close - closesBeforeRetry, 3);
    assert.equal(context.sessions.size, 1);
    assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
    assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
    assert.deepEqual(await readdir(successorRuntimeRoot), []);
  });
});

test("successor discard intent distinguishes pre-write failure from cleanup and retries exactly", async () => {
  const wrongThread = () => {
    const error = new Error("Successor history is not fresh");
    error.code = "vibe64_session_renewal_fresh_thread_required";
    error.retryable = true;
    return error;
  };
  const transitionFailure = new Error("State marker write unavailable");
  transitionFailure.code = "simulated_discard_marker_pre_write_failure";
  const context = fixture({
    seedErrors: [wrongThread(), wrongThread()],
    successorDiscardTransitionPreWriteErrors: [transitionFailure]
  });
  const reviewed = await reviewedRenewal(context, "renewal:discard-marker-pre-write");

  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );

  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING);
  assert.equal(failed.error.code, "vibe64_session_renewal_successor_discard_transition_failed");
  assert.deepEqual(failed.error.details, {
    causeCode: "simulated_discard_marker_pre_write_failure",
    phase: "transition"
  });
  assert.equal(context.calls.discardTransitionWrites, 1);
  assert.deepEqual(context.calls.cleanupOrder, []);
  assert.equal(context.calls.discard, 0);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.sessions.get(failed.successor.sessionId).status, "renewal_pending");

  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(completed.successor.attempt, 2);
  assert.match(completed.successor.sessionId, /-2$/u);
  assert.equal(context.calls.discardTransitionWrites, 2);
  assert.equal(context.calls.discard, 1);
  assert.equal(context.calls.seed, 3);
});

test("a discard-transition retry permits only its current seed and one replacement", async () => {
  const wrongThread = () => {
    const error = new Error("Successor history is not fresh");
    error.code = "vibe64_session_renewal_fresh_thread_required";
    error.retryable = true;
    return error;
  };
  const transitionFailure = new Error("State marker write unavailable");
  transitionFailure.code = "simulated_discard_marker_pre_write_failure";
  const context = fixture({
    seedErrors: Array.from({ length: 3 }, wrongThread),
    successorDiscardTransitionPreWriteErrors: [transitionFailure]
  });
  const reviewed = await reviewedRenewal(
    context,
    "renewal:bounded-discard-transition-retry"
  );

  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const transitionFailed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(transitionFailed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING);
  assert.equal(context.calls.seed, 1);

  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey
  });
  const boundedFailure = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => (
      state?.status === SESSION_RENEWAL_STATUS.FAILED &&
      state.revision > transitionFailed.revision
    )
  );

  assert.equal(
    boundedFailure.error.code,
    "vibe64_session_renewal_successor_replacement_limit_reached"
  );
  assert.equal(boundedFailure.successor.attempt, 2);
  assert.equal(boundedFailure.successor.replacementCeiling, 2);
  assert.equal(context.calls.seed, 3);
  assert.equal(context.calls.create, 2);
  assert.equal(context.calls.discard, 2);
  assert.equal(context.sessions.size, 1);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
});

test("successor discard intent recovers an error thrown after the exact state write", async () => {
  const wrongThreadError = new Error("Successor history is not fresh");
  wrongThreadError.code = "vibe64_session_renewal_fresh_thread_required";
  wrongThreadError.retryable = true;
  const postWriteFailure = new Error("State marker release interrupted");
  postWriteFailure.code = "simulated_discard_marker_post_write_failure";
  const context = fixture({
    seedErrors: [wrongThreadError],
    successorDiscardTransitionPostWriteErrors: [postWriteFailure]
  });
  const reviewed = await reviewedRenewal(context, "renewal:discard-marker-post-write");

  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );

  assert.equal(completed.successor.attempt, 2);
  assert.equal(context.calls.discardTransitionWrites, 1);
  assert.equal(context.calls.discard, 1);
  assert.deepEqual(context.calls.cleanupOrder, [
    "close-terminals",
    "release-resources",
    "authorize-process-exit-proof-release",
    "release-process-exit-proof",
    "discard-successor"
  ]);
});

test("repeated invalid successors leave no process runtime tombstones across restart", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const wrongThread = () => {
      const error = new Error("Successor history is not fresh");
      error.code = "vibe64_session_renewal_fresh_thread_required";
      error.retryable = true;
      return error;
    };
    const releaseInterrupted = new Error(
      "Process stopped and its proof was released before the controller restarted."
    );
    releaseInterrupted.code = "vibe64_session_renewal_process_exit_proof_release_failed";
    releaseInterrupted.retryable = true;
    const successorRuntimeRoot = path.join(temporaryRoot, "successor-runtimes");
    const context = fixture({
      releaseFailure: true,
      seedErrors: [wrongThread(), wrongThread()],
      successorProcessExitProofReleaseErrors: [releaseInterrupted],
      successorRuntimeRoot
    });
    let controller = context.controller;
    try {
      const reviewed = await reviewedRenewal(context, "renewal:repeated-invalid-successors");

      await controller.confirmSessionRenewal(OLD_SESSION_ID, {
        expectedHash: reviewed.draft.hash,
        expectedRevision: reviewed.draft.revision,
        operationKey: reviewed.operationKey
      });
      // Real filesystem cleanup needs elapsed polling, not only event-loop turns.
      const stoppedBeforeRelease = await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED,
        100,
        10
      );
      const firstSuccessorId = stoppedBeforeRelease.successor.sessionId;
      assert.equal(stoppedBeforeRelease.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING);
      assert.deepEqual(await readdir(successorRuntimeRoot), [firstSuccessorId]);

      context.setReleaseFailure(false);
      await controller.closeSessionRenewalWork();
      controller = context.newController();
      await controller.retrySessionRenewal(OLD_SESSION_ID, {
        operationKey: reviewed.operationKey
      });
      const releasedBeforeDiscard = await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED,
        100,
        10
      );
      assert.equal(releasedBeforeDiscard.successor.sessionId, firstSuccessorId);
      assert.equal(releasedBeforeDiscard.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING);
      assert.deepEqual(await readdir(successorRuntimeRoot), []);

      await controller.closeSessionRenewalWork();
      controller = context.newController();
      await controller.retrySessionRenewal(OLD_SESSION_ID, {
        operationKey: reviewed.operationKey
      });
      const completed = await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED,
        100,
        10
      );

      assert.equal(completed.successor.attempt, 3);
      assert.match(completed.successor.sessionId, /-3$/u);
      assert.equal(context.calls.discard, 2);
      assert.equal(context.calls.successorProcessExitProofRelease, 3);
      assert.equal(context.sessions.has(firstSuccessorId), false);
      assert.deepEqual(
        (await readdir(successorRuntimeRoot)).sort(),
        [completed.successor.sessionId]
      );
    } finally {
      await controller.closeSessionRenewalWork();
    }
  });
});

test("invalid successor disposal resumes exactly after each destructive cleanup boundary", async (t) => {
  const wrongThread = () => {
    const error = new Error("Successor history is not fresh");
    error.code = "vibe64_session_renewal_fresh_thread_required";
    error.retryable = true;
    return error;
  };
  const cleanupError = (message) => {
    const error = new Error(message);
    error.code = "simulated_process_exit";
    error.retryable = true;
    return error;
  };
  for (const scenario of [
    {
      expectedCauseCode: "simulated_process_exit",
      expectedPhase: "terminal_close",
      fixtureOptions: { successorCloseErrors: [cleanupError("after terminal close")] },
      name: "terminal close"
    },
    {
      expectedCauseCode: "resource_release_failed",
      expectedPhase: "resource_release",
      fixtureOptions: { releaseFailure: true },
      name: "resource release",
      repair: (context) => context.setReleaseFailure(false)
    },
    {
      expectedCauseCode: "simulated_process_exit",
      expectedPhase: "proof_authorization",
      fixtureOptions: {
        successorProcessExitProofAuthorizationErrors: [
          cleanupError("before process-exit proof authorization")
        ]
      },
      name: "process-exit proof authorization"
    },
    {
      expectedCauseCode: "simulated_process_exit",
      expectedPhase: "proof_release",
      fixtureOptions: {
        successorProcessExitProofReleaseErrors: [
          cleanupError("after process-exit proof release")
        ]
      },
      name: "process-exit proof release"
    },
    {
      expectedCauseCode: "simulated_process_exit",
      expectedPhase: "discard",
      fixtureOptions: { discardErrors: [cleanupError("after exact record removal")] },
      name: "source and record removal"
    }
  ]) {
    await t.test(scenario.name, async () => {
      const context = fixture({
        ...scenario.fixtureOptions,
        seedErrors: [wrongThread()]
      });
      const reviewed = await reviewedRenewal(
        context,
        `renewal:discard-${scenario.name.replaceAll(" ", "-")}`
      );
      await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
        expectedHash: reviewed.draft.hash,
        expectedRevision: reviewed.draft.revision,
        operationKey: reviewed.operationKey
      });
      const failed = await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
      );

      assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING);
      assert.equal(failed.error.code, "vibe64_session_renewal_successor_discard_failed");
      assert.deepEqual(failed.error.details, {
        causeCode: scenario.expectedCauseCode,
        phase: scenario.expectedPhase
      });
      assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
      scenario.repair?.(context);
      await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
        operationKey: reviewed.operationKey
      });
      const completed = await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
      );
      assert.equal(completed.successor.attempt, 2);
      assert.match(completed.successor.sessionId, /-2$/u);
      assert.equal(context.calls.seed, 2);
    });
  }
});

test("restart resumes successor discard after predecessor restore and after state reset", async (t) => {
  for (const scenario of [
    { name: "restored before discard state reset", stage: SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING },
    { name: "discard state reset before requiescence", stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING }
  ]) {
    await t.test(scenario.name, async () => {
      const context = fixture();
      const reviewed = await reviewedRenewal(
        context,
        `renewal:discard-restart-${scenario.name.replaceAll(" ", "-")}`
      );
      const attempt = scenario.stage === SESSION_RENEWAL_STAGE.OLD_QUIESCING ? 2 : 1;
      context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
        ...reviewed,
        approved: reviewed.draft,
        confirmedBy: { id: "actor-a", name: "Actor A" },
        continuedBy: { id: "actor-a", name: "Actor A" },
        revision: reviewed.revision + 1,
        stage: scenario.stage,
        status: SESSION_RENEWAL_STATUS.RUNNING,
        successor: {
          assistantSelection: ASSISTANT_SELECTION,
          attempt,
          replacementCeiling: 2
        }
      }, null, 2)}\n`);

      await context.newController().resumeSessionRenewals();
      const completed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
      assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
      assert.equal(completed.successor.attempt, 2);
      assert.match(completed.successor.sessionId, /-2$/u);
      assert.equal(context.calls.create, 1);
    });
  }
});

test("successor setup failure leaves the predecessor open and a new controller resumes the exact stage", async () => {
  const context = fixture({ setupStatus: "failed" });
  const reviewed = await reviewedRenewal(context);
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.sessions.get(failed.successor.sessionId).status, "renewal_pending");
  assert.equal(context.currentSessionId, OLD_SESSION_ID);

  context.setSetupStatus("succeeded");
  const restartedController = context.newController();
  await restartedController.retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  await restartedController.inspectSessionRenewal(OLD_SESSION_ID);
  assert.equal(context.currentSessionId, completed.successor.sessionId);
  assert.equal(context.calls.close, 3);
  assert.equal(context.calls.generate, 1);
  assert.equal(context.calls.discard, 0);
});

test("workspace setup source changes discard the private successor and restore the predecessor", async () => {
  const setup = workflowBarrier();
  const context = fixture({
    setupBarrier: setup.barrier,
    setupStatus: "running"
  });
  const reviewed = await reviewedRenewal(context, "renewal:setup-source-change");
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  await setup.started;
  const successorId = [...context.sessions.keys()]
    .find((sessionId) => sessionId !== OLD_SESSION_ID);
  assert.ok(successorId);
  context.setSetupStatus("succeeded");
  context.setSessionWork(successorId, {
    changedPaths: ["package-lock.json"],
    dirty: true,
    sessionMatchesCanonical: false,
    unsaved: true
  });
  setup.release();

  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(failed.error.code, "vibe64_session_renewal_successor_source_invalid");
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING);
  assert.equal(failed.successor.attempt, 2);
  assert.equal(failed.successor.sessionId, undefined);
  assert.equal(context.calls.discard, 1);
  assert.equal(context.sessions.has(successorId), false);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.currentSessionId, OLD_SESSION_ID);
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("acknowledgement HEAD changes discard the private successor and restore the predecessor", async () => {
  const seed = workflowBarrier();
  const context = fixture({ seedBarrier: seed.barrier });
  const reviewed = await reviewedRenewal(context, "renewal:ack-source-change");
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  await seed.started;
  const successorId = [...context.sessions.keys()]
    .find((sessionId) => sessionId !== OLD_SESSION_ID);
  assert.ok(successorId);
  context.setSessionWork(successorId, {
    relationship: "ahead",
    sessionHead: "b".repeat(40),
    sessionMatchesCanonical: false
  });
  seed.release();

  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(failed.error.code, "vibe64_session_renewal_successor_source_invalid");
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING);
  assert.equal(failed.successor.attempt, 2);
  assert.equal(failed.successor.sessionId, undefined);
  assert.equal(context.calls.discard, 1);
  assert.equal(context.sessions.has(successorId), false);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.currentSessionId, OLD_SESSION_ID);
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("successor proof rejects a source path inherited from a parent Git worktree", async () => {
  const setup = workflowBarrier();
  const context = fixture({
    setupBarrier: setup.barrier,
    setupStatus: "running"
  });
  const reviewed = await reviewedRenewal(context, "renewal:nested-worktree");
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  await setup.started;
  const successorId = [...context.sessions.keys()]
    .find((sessionId) => sessionId !== OLD_SESSION_ID);
  assert.ok(successorId);
  context.setSetupStatus("succeeded");
  context.setSessionWork(successorId, {
    worktreeTopLevel: "/tmp"
  });
  setup.release();

  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(failed.error.code, "vibe64_session_renewal_successor_source_invalid");
  assert.equal(context.calls.discard, 1);
  assert.equal(context.sessions.has(successorId), false);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.currentSessionId, OLD_SESSION_ID);
});

async function runRealGitSuccessorProofScenario({
  mutate,
  phase = "setup",
  withSubmodule = false
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-renewal-git-proof-"));
  try {
    const gitFixture = await createRealGitSuccessorFixture(root, { withSubmodule });
    const barrier = workflowBarrier();
    const context = fixture({
      canonicalCommit: gitFixture.canonicalCommit,
      inspectSessionWorkImplementation: async (session) => {
        if (session.sessionId === OLD_SESSION_ID) {
          const worktreePath = String(session.metadata.source_path || "").trim();
          return {
            baseCommit: gitFixture.canonicalCommit,
            canonicalCommit: gitFixture.canonicalCommit,
            changedPaths: [],
            dirty: false,
            relationship: "current",
            sessionHead: gitFixture.canonicalCommit,
            sessionMatchesCanonical: true,
            unsaved: false,
            worktreeClean: true,
            worktreePath,
            worktreeTopLevel: worktreePath
          };
        }
        return inspectGitSessionWork({
          project: gitFixture.project,
          runCommand: runLocalCommand,
          session: {
            ...session,
            sourcePath: gitFixture.sourcePath
          }
        });
      },
      ...(phase === "acknowledgement"
        ? { seedBarrier: barrier.barrier }
        : {
            setupBarrier: barrier.barrier,
            setupStatus: "running"
          }),
      successorSourcePath: gitFixture.sourcePath
    });
    const reviewed = await reviewedRenewal(
      context,
      `renewal:real-git-${phase}-${Math.random()}`
    );
    await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    });
    await barrier.started;
    const successorId = [...context.sessions.keys()]
      .find((sessionId) => sessionId !== OLD_SESSION_ID);
    assert.ok(successorId);
    if (phase === "setup") {
      context.setSetupStatus("succeeded");
    }
    await mutate({
      context,
      gitFixture,
      successorId
    });
    barrier.release();
    const failed = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED,
      300,
      25
    );
    assert.equal(failed.error.code, "vibe64_session_renewal_successor_source_invalid");
    assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING);
    assert.equal(failed.successor.sessionId, undefined);
    assert.equal(context.calls.discard, 1);
    assert.equal(context.sessions.has(successorId), false);
    assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
    assert.equal(context.currentSessionId, OLD_SESSION_ID);
    assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
    await assert.rejects(
      () => readdir(gitFixture.sourcePath),
      { code: "ENOENT" }
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("real Git successor proof accepts ignored dependency and build artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-renewal-git-proof-"));
  try {
    const gitFixture = await createRealGitSuccessorFixture(root);
    const setup = workflowBarrier();
    const context = fixture({
      canonicalCommit: gitFixture.canonicalCommit,
      inspectSessionWorkImplementation: async (session) => {
        if (session.sessionId === OLD_SESSION_ID) {
          const worktreePath = String(session.metadata.source_path || "").trim();
          return {
            baseCommit: gitFixture.canonicalCommit,
            canonicalCommit: gitFixture.canonicalCommit,
            changedPaths: [],
            dirty: false,
            relationship: "current",
            sessionHead: gitFixture.canonicalCommit,
            sessionMatchesCanonical: true,
            unsaved: false,
            worktreeClean: true,
            worktreePath,
            worktreeTopLevel: worktreePath
          };
        }
        return inspectGitSessionWork({
          project: gitFixture.project,
          runCommand: runLocalCommand,
          session: { ...session, sourcePath: gitFixture.sourcePath }
        });
      },
      setupBarrier: setup.barrier,
      setupStatus: "running",
      successorSourcePath: gitFixture.sourcePath
    });
    const reviewed = await reviewedRenewal(context, "renewal:real-git-ignored");
    await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    });
    await setup.started;
    await Promise.all([
      mkdir(path.join(gitFixture.sourcePath, "node_modules", "package"), {
        recursive: true
      }),
      mkdir(path.join(gitFixture.sourcePath, "dist", "assets"), {
        recursive: true
      })
    ]);
    await Promise.all([
      writeFile(
        path.join(gitFixture.sourcePath, "node_modules", "package", "index.js"),
        "ignored dependency\n",
        "utf8"
      ),
      writeFile(
        path.join(gitFixture.sourcePath, "dist", "assets", "app.js"),
        "ignored build\n",
        "utf8"
      )
    ]);
    context.setSetupStatus("succeeded");
    setup.release();
    const completed = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED,
      300,
      25
    );
    assert.equal(context.calls.discard, 0);
    assert.equal(context.currentSessionId, completed.successor.sessionId);
    assert.equal(context.sessions.has(completed.successor.sessionId), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("real Git successor proof rejects every mutable source topology and restores exactly", async (t) => {
  for (const scenario of [
    {
      name: "staged tracked change after setup",
      async mutate({ gitFixture }) {
        await writeFile(path.join(gitFixture.sourcePath, "app.txt"), "staged\n", "utf8");
        await runGit(gitFixture.sourcePath, ["add", "app.txt"]);
      }
    },
    {
      name: "unstaged tracked change after setup",
      async mutate({ gitFixture }) {
        await writeFile(path.join(gitFixture.sourcePath, "app.txt"), "unstaged\n", "utf8");
      }
    },
    {
      name: "nonignored untracked change after setup",
      async mutate({ gitFixture }) {
        await writeFile(path.join(gitFixture.sourcePath, "unexpected.txt"), "untracked\n", "utf8");
      }
    },
    {
      name: "dirty tracked submodule after setup",
      withSubmodule: true,
      async mutate({ gitFixture }) {
        await writeFile(
          path.join(gitFixture.sourcePath, "vendor", "dependency", "module.txt"),
          "dirty submodule\n",
          "utf8"
        );
      }
    },
    {
      name: "canonical drift after setup",
      async mutate({ context, gitFixture, successorId }) {
        await writeFile(path.join(gitFixture.seed, "app.txt"), "canonical advanced\n", "utf8");
        await runGit(gitFixture.seed, ["add", "app.txt"]);
        await runGit(gitFixture.seed, ["commit", "-m", "advance canonical"]);
        await runGit(gitFixture.seed, ["push", "origin", "main"]);
        const canonicalCommit = await runGit(gitFixture.seed, ["rev-parse", "HEAD"]);
        await runGit(gitFixture.sourcePath, ["fetch", "origin", "main"]);
        context.sessions.get(successorId).metadata.canonical_commit = canonicalCommit;
      }
    },
    {
      name: "HEAD drift after acknowledgement",
      phase: "acknowledgement",
      async mutate({ gitFixture }) {
        await writeFile(path.join(gitFixture.sourcePath, "head-drift.txt"), "drift\n", "utf8");
        await runGit(gitFixture.sourcePath, ["add", "head-drift.txt"]);
        await runGit(gitFixture.sourcePath, ["commit", "-m", "drift after acknowledgement"]);
      }
    }
  ]) {
    await t.test(scenario.name, () => runRealGitSuccessorProofScenario(scenario));
  }
});

test("failure is durably paused before predecessor restoration at every successor stage", async (t) => {
  const workflowFailure = (label) => {
    const error = new Error(`${label} failed`);
    error.code = `simulated_${label}_failure`;
    error.retryable = true;
    return error;
  };
  for (const scenario of [
    {
      expectedStage: SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING,
      fixtureOptions: { creationErrors: [workflowFailure("creation")] },
      name: "creation"
    },
    {
      expectedStage: SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP,
      fixtureOptions: { setupStatus: "failed" },
      name: "setup"
    },
    {
      expectedStage: SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING,
      fixtureOptions: { seedErrors: [workflowFailure("seeding")] },
      name: "seeding"
    }
  ]) {
    await t.test(scenario.name, async () => {
      const restoreGate = workflowBarrier();
      const context = fixture({
        ...scenario.fixtureOptions,
        restoreWritableBarrier: restoreGate.barrier
      });
      const reviewed = await reviewedRenewal(context, `renewal:failure-order-${scenario.name}`);
      await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
        expectedHash: reviewed.draft.hash,
        expectedRevision: reviewed.draft.revision,
        operationKey: reviewed.operationKey
      });
      await restoreGate.started;

      const paused = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
      assert.equal(paused.status, SESSION_RENEWAL_STATUS.RUNNING);
      assert.equal(paused.stage, SESSION_RENEWAL_STAGE.FAILURE_RESTORING);
      assert.equal(paused.failure.stage, scenario.expectedStage);
      assert.equal(context.sessions.get(OLD_SESSION_ID).status, "renewal_quiesced");
      assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), true);

      restoreGate.release();
      await eventually(
        async () => context.sessions.get(OLD_SESSION_ID).status,
        (status) => status === "active"
      );
      assert.equal(
        (await readSessionRenewalState(context.runtime, OLD_SESSION_ID)).stage,
        scenario.expectedStage
      );
      assert.equal(
        (await readSessionRenewalState(context.runtime, OLD_SESSION_ID)).status,
        SESSION_RENEWAL_STATUS.FAILED
      );
      assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
    });
  }
});

test("restart completes durable failure restoration before exposing FAILED", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context, "renewal:failure-restoration-restart");
  const source = context.sessions.get(OLD_SESSION_ID);
  source.status = "renewal_quiesced";
  context.terminalAdmissions.set(OLD_SESSION_ID, reviewed.renewalId);
  const failureError = {
    code: "simulated_setup_failure",
    message: "setup failed",
    retryable: true
  };
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "actor-a", name: "Actor A" },
    continuedBy: { id: "actor-a", name: "Actor A" },
    error: failureError,
    failure: {
      error: failureError,
      stage: SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP
    },
    revision: reviewed.revision + 1,
    stage: SESSION_RENEWAL_STAGE.FAILURE_RESTORING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      sessionId: "renewal-restart-successor"
    }
  }, null, 2)}\n`);

  await context.newController().resumeSessionRenewals();

  const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(failed.status, SESSION_RENEWAL_STATUS.FAILED);
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP);
  assert.equal(failed.error.code, "simulated_setup_failure");
  assert.equal(source.status, "active");
  assert.equal(context.calls.quiesceRecovery, 1);
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("restart never restores a predecessor quiesced by another renewal", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context, "renewal:foreign-quiescence");
  const source = context.sessions.get(OLD_SESSION_ID);
  source.status = "renewal_quiesced";
  source.metadata.renewal_quiesced_id = "another-renewal";
  context.terminalAdmissions.set(OLD_SESSION_ID, reviewed.renewalId);
  const failureError = {
    code: "simulated_setup_failure",
    message: "setup failed",
    retryable: true
  };
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "actor-a", name: "Actor A" },
    continuedBy: { id: "actor-a", name: "Actor A" },
    error: failureError,
    failure: {
      error: failureError,
      stage: SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP
    },
    revision: reviewed.revision + 1,
    stage: SESSION_RENEWAL_STAGE.FAILURE_RESTORING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      sessionId: "renewal-foreign-successor"
    }
  }, null, 2)}\n`);

  await context.newController().resumeSessionRenewals();

  const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(failed.status, SESSION_RENEWAL_STATUS.FAILED);
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.FAILURE_RESTORING);
  assert.equal(failed.error.code, "vibe64_session_renewal_restore_failed");
  assert.equal(source.status, "renewal_quiesced");
  assert.equal(source.metadata.renewal_quiesced_id, "another-renewal");
  assert.equal(context.calls.quiesceRecovery, 0);
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), true);
});

test("one explicit retry restores a paused predecessor and continues the claimed workflow", async () => {
  const restoreError = new Error("Writable restoration unavailable");
  restoreError.code = "restore_unavailable";
  restoreError.retryable = true;
  const context = fixture({
    restoreWritableErrors: [restoreError],
    setupStatus: "failed"
  });
  const reviewed = await reviewedRenewal(context, "renewal:failure-restoration-retry");
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const paused = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED &&
      state.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING
  );
  assert.equal(paused.error.code, "vibe64_session_renewal_restore_failed");
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "renewal_quiesced");

  context.setSetupStatus("succeeded");
  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey,
    vibe64User: { id: "actor-b", name: "Actor B" }
  });

  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.deepEqual(completed.continuedBy, { id: "actor-b", name: "Actor B" });
  assert.equal(context.sessions.get(completed.successor.sessionId).status, "active");
  assert.equal(context.calls.restoreWritable, 1);
});

test("actor recovery failure discards private archive preparation and restores the predecessor", async () => {
  const context = fixture({
    resolveRenewalActor: async () => {
      const error = new Error("Persisted actor unavailable");
      error.code = "vibe64_session_renewal_actor_unavailable";
      error.retryable = true;
      throw error;
    }
  });
  const reviewed = await reviewedRenewal(context, "renewal:archive-actor-failure");
  const successorSessionId = "renewal-actor-successor";
  const source = context.sessions.get(OLD_SESSION_ID);
  source.status = "renewal_quiesced";
  source.metadata.renewal_quiesced_at = "2026-08-24T03:59:00.000Z";
  source.metadata.renewal_quiesced_id = reviewed.renewalId;
  source.metadata.source_recovery_saved = "yes";
  source.preparedArchive = true;
  source.preparedMetadata = {
    ...source.metadata,
    renewal_id: reviewed.renewalId,
    renewed_to: successorSessionId
  };
  context.sessions.set(successorSessionId, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      renewal_id: reviewed.renewalId,
      renewed_from: OLD_SESSION_ID
    },
    sessionId: successorSessionId,
    sourceReady: true,
    status: "renewal_pending",
    workspaceSetup: { status: "succeeded" }
  });
  context.terminalAdmissions.set(OLD_SESSION_ID, reviewed.renewalId);
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "removed-actor", name: "Removed" },
    continuedBy: { id: "removed-actor", name: "Removed" },
    revision: reviewed.revision + 1,
    stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      acknowledgedAt: "2026-08-24T04:00:00.000Z",
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      sessionId: successorSessionId
    }
  }, null, 2)}\n`);

  await context.newController().resumeSessionRenewals();

  const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(failed.status, SESSION_RENEWAL_STATUS.FAILED);
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.OLD_ARCHIVING);
  assert.equal(failed.error.code, "vibe64_session_renewal_actor_unavailable");
  assert.equal(source.status, "active");
  assert.equal(source.preparedArchive, false);
  assert.equal(context.sessions.get(successorSessionId).status, "renewal_pending");
  assert.equal(context.calls.restoreClosing, 1);
  assert.equal(context.calls.restore, 1);
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("restart completes durable private-archive failure restoration", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context, "renewal:archive-failure-restart");
  const successorSessionId = "renewal-failure-successor";
  const source = context.sessions.get(OLD_SESSION_ID);
  source.status = "renewal_quiesced";
  source.metadata.renewal_quiesced_at = "2026-08-24T03:59:00.000Z";
  source.metadata.renewal_quiesced_id = reviewed.renewalId;
  source.metadata.source_recovery_saved = "yes";
  source.preparedArchive = true;
  source.preparedMetadata = {
    ...source.metadata,
    renewal_id: reviewed.renewalId,
    renewed_to: successorSessionId
  };
  context.sessions.set(successorSessionId, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      renewal_id: reviewed.renewalId,
      renewed_from: OLD_SESSION_ID
    },
    sessionId: successorSessionId,
    sourceReady: true,
    status: "renewal_pending",
    workspaceSetup: { status: "succeeded" }
  });
  context.terminalAdmissions.set(OLD_SESSION_ID, reviewed.renewalId);
  const failureError = {
    code: "simulated_archive_failure",
    message: "archive failed",
    retryable: true
  };
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "actor-a", name: "Actor A" },
    continuedBy: { id: "actor-a", name: "Actor A" },
    error: failureError,
    failure: {
      error: failureError,
      stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING
    },
    revision: reviewed.revision + 1,
    stage: SESSION_RENEWAL_STAGE.FAILURE_RESTORING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      acknowledgedAt: "2026-08-24T04:00:00.000Z",
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      sessionId: successorSessionId
    }
  }, null, 2)}\n`);

  await context.newController().resumeSessionRenewals();

  const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(failed.status, SESSION_RENEWAL_STATUS.FAILED);
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.OLD_ARCHIVING);
  assert.equal(failed.error.code, "simulated_archive_failure");
  assert.equal(source.status, "active");
  assert.equal(source.preparedArchive, false);
  assert.equal(context.sessions.get(successorSessionId).status, "renewal_pending");
  assert.equal(context.calls.restoreClosing, 1);
  assert.equal(context.calls.restore, 1);
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
});

test("retry discards a hidden successor and retains the handover when the predecessor basis changed", async () => {
  const context = fixture({ setupStatus: "failed" });
  const reviewed = await reviewedRenewal(context);
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  const staleSuccessorId = failed.successor.sessionId;
  context.setSetupStatus("succeeded");
  context.setConversation({
    newestTurnId: "turn-after-failure",
    totalTurnCount: 22
  });

  await context.controller.retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey
  });
  const retained = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.REVIEW
  );

  assert.equal(context.sessions.has(staleSuccessorId), false);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(retained.approved, null);
  assert.equal(retained.successor, null);
  assert.equal(retained.draft.text, failed.approved.text);
  assert.equal(retained.draft.hash, failed.approved.hash);
  assert.equal(retained.generation.attempt, failed.generation.attempt);
  assert.equal(context.calls.discard, 1);
  assert.equal(context.calls.generate, 1);
  await context.newController().confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: retained.draft.hash,
    expectedRevision: retained.draft.revision,
    operationKey: retained.operationKey
  });
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(context.calls.generate, 1);
});

test("retry recovers a saved handover with legacy authority without generating another one", async () => {
  const context = fixture({ setupStatus: "failed" });
  const reviewed = await reviewedRenewal(context);
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  const text = failed.approved.text
    .replace("- Authority: github", "- Authority: local_source")
    .replace("## Touched areas", "Preserve this handover note.\n\n## Touched areas");
  const savedDraft = createSessionRenewalDraft(text, { origin: "edited" });
  context.artifacts.set(OLD_SESSION_ID, JSON.stringify({
    ...failed,
    approved: savedDraft,
    draft: savedDraft,
    basis: {
      ...failed.basis,
      source: { ...failed.basis.source, authority: "local_source" }
    }
  }));
  delete context.sessions.get(OLD_SESSION_ID).metadata.repository_mode;
  context.setSetupStatus("succeeded");

  const result = await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: failed.operationKey
  });
  const retained = result.renewal;
  assert.equal(retained.status, SESSION_RENEWAL_STATUS.REVIEW);
  assert.equal(retained.basis.source.authority, "github");
  assert.equal(retained.draft.text, text.replace("- Authority: local_source", "- Authority: github"));
  assert.equal(retained.draft.origin, "edited");
  assert.equal(context.calls.generate, 1);
  await context.newController().confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: retained.draft.hash,
    expectedRevision: retained.draft.revision,
    operationKey: retained.operationKey
  });
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(context.calls.generate, 1);
  assert.equal(context.calls.seedInput.handover, retained.draft.text);
});

test("restart recovery resumes an exact quiesced predecessor with a hidden successor", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context);
  const successorSessionId = "session-successor-restart";
  context.sessions.set(successorSessionId, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      renewal_id: reviewed.renewalId,
      renewed_from: OLD_SESSION_ID,
      source_path: `/tmp/${successorSessionId}`
    },
    sessionId: successorSessionId,
    sourceReady: true,
    status: "renewal_pending",
    workspaceSetup: { status: "succeeded" }
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID), {
    status: "renewal_quiesced"
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID).metadata, {
    renewal_quiesced_at: "2026-08-24T03:59:00.000Z",
    renewal_quiesced_id: reviewed.renewalId
  });
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      acknowledgedAt: "2026-08-24T04:00:00.000Z",
      assistantSelection: ASSISTANT_SELECTION,
      sessionId: successorSessionId,
      threadId: "thread-new",
      turnId: "turn-seed"
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();

  assert.deepEqual(resumed.discoveredSessionIds, [OLD_SESSION_ID]);
  assert.deepEqual(resumed.resumedSessionIds, [OLD_SESSION_ID]);
  assert.equal(context.calls.compact, 1);
  assert.equal(context.currentSessionId, successorSessionId);
  assert.equal(
    context.sessions.get(successorSessionId).metadata.renewal_finalized_at.length > 0,
    true
  );
});

test("restart rejects a published predecessor without a durable commit marker", async () => {
  const context = fixture();
  const reviewed = await reviewedRenewal(context);
  const successorSessionId = "session-successor-published";
  context.sessions.set(successorSessionId, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      renewal_id: reviewed.renewalId,
      renewed_from: OLD_SESSION_ID,
      source_path: `/tmp/${successorSessionId}`
    },
    sessionId: successorSessionId,
    sourceReady: true,
    status: "renewal_pending",
    workspaceSetup: { status: "succeeded" }
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID), {
    archiveRetained: true,
    archived: true,
    status: "archived"
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID).metadata, {
    renewal_id: reviewed.renewalId,
    renewal_selected_before_archive: OLD_SESSION_ID,
    renewed_to: successorSessionId
  });
  await context.runtime.updateCurrentSession("");
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    predecessorArchivedAt: "2026-08-24T04:01:00.000Z",
    stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      acknowledgedAt: "2026-08-24T04:00:00.000Z",
      assistantSelection: ASSISTANT_SELECTION,
      sessionId: successorSessionId,
      threadId: "thread-new",
      turnId: "turn-seed"
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();

  assert.deepEqual(resumed.discoveredSessionIds, []);
  assert.deepEqual(resumed.resumedSessionIds, []);
  assert.equal(resumed.failures.length, 1);
  assert.equal(resumed.failures[0].sessionId, OLD_SESSION_ID);
  assert.equal(resumed.failures[0].code, "vibe64_session_renewal_state_invalid");
  assert.equal(context.calls.compact, 0);
  await assert.rejects(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    { code: "vibe64_session_renewal_state_invalid" }
  );
  assert.equal(context.currentSessionId, "");
  assert.equal(context.sessions.get(OLD_SESSION_ID).archived, true);
  assert.equal(context.sessions.get(successorSessionId).status, "renewal_pending");
});

test("post-commit recovery completes without restoring the persisted actor", async () => {
  let actorResolutionCount = 0;
  const context = fixture({
    async resolveRenewalActor() {
      actorResolutionCount += 1;
      const unavailable = new Error("Actor unavailable");
      unavailable.code = "vibe64_session_renewal_actor_unavailable";
      unavailable.retryable = true;
      throw unavailable;
    }
  });
  const reviewed = await reviewedRenewal(context);
  const successorSessionId = "session-successor-actorless-activation";
  context.sessions.set(successorSessionId, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      renewal_activation_prepared_at: "2026-08-24T04:01:30.000Z",
      renewal_id: reviewed.renewalId,
      renewed_from: OLD_SESSION_ID,
      source_path: `/tmp/${successorSessionId}`
    },
    sessionId: successorSessionId,
    sourceReady: true,
    status: "renewal_activating",
    workspaceSetup: { status: "succeeded" }
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID), {
    archiveRetained: true,
    archived: true,
    status: "archived"
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID).metadata, {
    renewal_archived_at: "2026-08-24T04:01:00.000Z",
    renewal_id: reviewed.renewalId,
    renewal_selected_before_archive: OLD_SESSION_ID,
    renewed_to: successorSessionId
  });
  await context.runtime.updateCurrentSession("");
  const committedAt = "2026-08-24T04:02:00.000Z";
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    commit: {
      committedAt,
      selectedBeforeArchive: OLD_SESSION_ID,
      sourceSessionId: OLD_SESSION_ID,
      successorSessionId,
      successorWillBeSelected: true
    },
    confirmedBy: { id: "removed-user", name: "Removed" },
    maintenance: {
      attempt: 0,
      error: null,
      status: "pending",
      steps: {
        admissionThawed: false,
        archiveFinalized: false,
        predecessorProcessProofReleased: false,
        resourcesReleased: false,
        sourceRemoved: false,
        successorFinalized: false
      },
      updatedAt: committedAt
    },
    predecessorArchivedAt: "2026-08-24T04:01:00.000Z",
    stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      acknowledgedAt: "2026-08-24T04:00:00.000Z",
      assistantSelection: ASSISTANT_SELECTION,
      sessionId: successorSessionId,
      threadId: "thread-new",
      turnId: "turn-seed"
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();
  const completed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

  assert.deepEqual(resumed.failures, []);
  assert.deepEqual(resumed.resumedSessionIds, [OLD_SESSION_ID]);
  assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
  assert.equal(context.currentSessionId, successorSessionId);
  assert.equal(actorResolutionCount, 0);
});

test("actor recovery never repairs a published predecessor without a commit marker", async () => {
  let actorResolutionCount = 0;
  const context = fixture({
    async resolveRenewalActor() {
      actorResolutionCount += 1;
      const unavailable = new Error("Actor unavailable");
      unavailable.code = "vibe64_session_renewal_actor_unavailable";
      unavailable.retryable = true;
      throw unavailable;
    }
  });
  const reviewed = await reviewedRenewal(context);
  const successorSessionId = "session-successor-published-before-stage-write";
  context.sessions.set(successorSessionId, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      renewal_id: reviewed.renewalId,
      renewed_from: OLD_SESSION_ID,
      source_path: `/tmp/${successorSessionId}`
    },
    sessionId: successorSessionId,
    sourceReady: true,
    status: "renewal_pending",
    workspaceSetup: { status: "succeeded" }
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID), {
    archiveRetained: true,
    archived: true,
    status: "archived"
  });
  Object.assign(context.sessions.get(OLD_SESSION_ID).metadata, {
    renewal_id: reviewed.renewalId,
    renewal_selected_before_archive: OLD_SESSION_ID,
    renewed_to: successorSessionId
  });
  await context.runtime.updateCurrentSession("");
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "removed-user", name: "Removed" },
    stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      acknowledgedAt: "2026-08-24T04:00:00.000Z",
      assistantSelection: ASSISTANT_SELECTION,
      sessionId: successorSessionId,
      threadId: "thread-new",
      turnId: "turn-seed"
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();
  const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

  assert.deepEqual(resumed.failures, []);
  assert.deepEqual(resumed.resumedSessionIds, [OLD_SESSION_ID]);
  assert.equal(failed.status, SESSION_RENEWAL_STATUS.FAILED);
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.FAILURE_RESTORING);
  assert.equal(failed.error.code, "vibe64_session_renewal_restore_failed");
  assert.equal(failed.commit, undefined);
  assert.equal(context.sessions.get(OLD_SESSION_ID).archived, true);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "archived");
  assert.equal(context.sessions.get(successorSessionId).status, "renewal_pending");
  assert.equal(context.currentSessionId, "");
  assert.equal(actorResolutionCount, 1);
});

test("automatic recovery resolves the persisted confirmer through the trusted host actor resolver", async () => {
  const resolvedUser = {
    displayName: "Rae Current",
    gid: 1001,
    home: "/home/rae",
    id: "confirmer-2",
    uid: 1001
  };
  const resolutions = [];
  const context = fixture({
    async resolveRenewalActor(actor, recovery) {
      resolutions.push({ actor, recovery });
      return resolvedUser;
    }
  });
  const reviewed = await reviewedRenewal(context);
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "confirmer-2", name: "Rae" },
    stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      replacementCeiling: 2
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();
  const completed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

  assert.deepEqual(resumed.failures, []);
  assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
  assert.equal(resolutions.length, 1);
  assert.deepEqual(resolutions[0].actor, { id: "confirmer-2", name: "Rae" });
  assert.equal(resolutions[0].recovery.sessionId, OLD_SESSION_ID);
  assert.equal(context.calls.createSourceContext.vibe64User, resolvedUser);
  assert.deepEqual(context.calls.createActor, { id: "confirmer-2", name: "Rae" });
});

test("automatic recovery prefers the last trusted collaborator who continued the transition", async () => {
  const resolutions = [];
  const context = fixture({
    async resolveRenewalActor(actor, recovery) {
      resolutions.push({ actor, recovery });
      return {
        displayName: actor.name,
        id: actor.id,
        username: actor.id
      };
    }
  });
  const reviewed = await reviewedRenewal(context);
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "confirmer-2", name: "Rae" },
    continuedBy: { id: "collaborator-3", name: "Kai" },
    stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      replacementCeiling: 2
    }
  }, null, 2)}\n`);

  await context.newController().resumeSessionRenewals();
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
  assert.deepEqual(resolutions[0].actor, { id: "collaborator-3", name: "Kai" });
  assert.deepEqual(context.calls.createActor, { id: "collaborator-3", name: "Kai" });
  assert.equal(context.calls.createSourceContext.vibe64User.id, "collaborator-3");
});

test("active OLD_QUIESCING recovery never closes predecessor work that is not idle", async (t) => {
  const scenarios = [{
    code: "vibe64_session_renewal_agent_active",
    prepare(context) {
      context.sessions.get(OLD_SESSION_ID).agentRuns = [{ state: "active" }];
    },
    title: "main assistant turn"
  }, {
    code: "vibe64_session_renewal_temporary_agent_active",
    prepare(context) {
      context.setTemporaryAgentActive(true);
    },
    title: "Temporary AI workspace turn"
  }, {
    code: "vibe64_agent_write_mode_busy",
    prepare(context) {
      context.setAgentWriteLockMisses(1);
    },
    title: "agent-write admission"
  }];

  for (const scenario of scenarios) {
    await t.test(scenario.title, async () => {
      const context = fixture();
      const reviewed = await reviewedRenewal(context);
      context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
        ...reviewed,
        approved: reviewed.draft,
        confirmedBy: { id: "confirmer-2", name: "Rae" },
        stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
        status: SESSION_RENEWAL_STATUS.RUNNING,
        successor: {
          assistantSelection: ASSISTANT_SELECTION,
          attempt: 1,
          replacementCeiling: 2
        }
      }, null, 2)}\n`);
      scenario.prepare(context);

      const resumed = await context.newController().resumeSessionRenewals();
      const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

      assert.equal(resumed.failures.length, 0);
      assert.equal(failed.status, SESSION_RENEWAL_STATUS.FAILED);
      assert.equal(failed.error.code, scenario.code);
      assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
      assert.equal(context.calls.freeze, 0);
      assert.equal(context.calls.close, 0);
      assert.equal(context.calls.quiesce, 0);
      assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
    });
  }
});

test("unavailable automatic actor recovery pauses durably until an explicit retry takes over", async () => {
  const unavailable = new Error("Actor unavailable");
  unavailable.code = "vibe64_session_renewal_actor_unavailable";
  unavailable.retryable = true;
  const context = fixture({
    async resolveRenewalActor() {
      throw unavailable;
    }
  });
  const reviewed = await reviewedRenewal(context);
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "removed-user", name: "Removed" },
    stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      replacementCeiling: 2
    }
  }, null, 2)}\n`);

  const resumed = await context.newController().resumeSessionRenewals();
  const paused = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(resumed.failures.length, 0);
  assert.equal(paused.status, SESSION_RENEWAL_STATUS.FAILED);
  assert.equal(paused.error.code, unavailable.code);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");

  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey,
    vibe64User: { id: "collaborator-3", name: "Kai" }
  });
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  const completed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.deepEqual(completed.confirmedBy, { id: "removed-user", name: "Removed" });
  assert.deepEqual(completed.continuedBy, { id: "collaborator-3", name: "Kai" });
  assert.equal(context.calls.createSourceContext.vibe64User.id, "collaborator-3");
  assert.deepEqual(context.calls.createActor, { id: "collaborator-3", name: "Kai" });
});

test("actor recovery failure after acknowledgement restores the unpublished predecessor", async () => {
  const unavailable = new Error("Actor unavailable");
  unavailable.code = "vibe64_session_renewal_actor_unavailable";
  unavailable.retryable = true;
  const context = fixture({
    async resolveRenewalActor() {
      throw unavailable;
    }
  });
  const reviewed = await reviewedRenewal(context, "renewal:acknowledged-actor-failure");
  const successorId = "renewal-acknowledged-successor";
  context.sessions.set(successorId, {
    agentRuns: [],
    backgroundTasks: [],
    metadata: {
      base_branch: "main",
      base_commit: COMMIT,
      canonical_commit: COMMIT,
      renewal_id: reviewed.renewalId,
      renewed_from: OLD_SESSION_ID,
      repository_mode: "github",
      source_default_branch: "main",
      source_kind: "session_clone",
      source_path: `/tmp/${successorId}`,
      source_remote_url: "https://example.test/project.git"
    },
    sessionId: successorId,
    sourceReady: true,
    status: "renewal_pending",
    workspaceSetup: { status: "succeeded" }
  });
  context.sessions.get(OLD_SESSION_ID).status = "renewal_quiesced";
  context.sessions.get(OLD_SESSION_ID).metadata.renewal_quiesced_id = reviewed.renewalId;
  context.terminalAdmissions.set(OLD_SESSION_ID, reviewed.renewalId);
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "removed-user", name: "Removed" },
    continuedBy: { id: "removed-user", name: "Removed" },
    revision: reviewed.revision + 1,
    stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACKNOWLEDGED,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      acknowledgedAt: "2026-08-24T04:00:00.000Z",
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      sessionId: successorId,
      threadId: "thread-new",
      turnId: "turn-seed"
    }
  }, null, 2)}\n`);

  await context.newController().resumeSessionRenewals();
  const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  assert.equal(failed.status, SESSION_RENEWAL_STATUS.FAILED);
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.SUCCESSOR_ACKNOWLEDGED);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);

  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey,
    vibe64User: { id: "actor-b", name: "Actor B" }
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.deepEqual(completed.continuedBy, { id: "actor-b", name: "Actor B" });
  assert.equal(context.sessions.get(successorId).status, "active");
});

test("collaborator continuation after boot recovery cannot race a newly active predecessor turn", async () => {
  const unavailable = new Error("Actor unavailable");
  unavailable.code = "vibe64_session_renewal_actor_unavailable";
  unavailable.retryable = true;
  const context = fixture({
    async resolveRenewalActor() {
      throw unavailable;
    }
  });
  const reviewed = await reviewedRenewal(context);
  context.artifacts.set(OLD_SESSION_ID, `${JSON.stringify({
    ...reviewed,
    approved: reviewed.draft,
    confirmedBy: { id: "removed-user", name: "Removed" },
    stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    successor: {
      assistantSelection: ASSISTANT_SELECTION,
      attempt: 1,
      replacementCeiling: 2
    }
  }, null, 2)}\n`);

  await context.newController().resumeSessionRenewals();
  context.sessions.get(OLD_SESSION_ID).agentRuns = [{ state: "active" }];
  await assert.rejects(
    () => context.newController().retrySessionRenewal(OLD_SESSION_ID, {
      operationKey: reviewed.operationKey,
      vibe64User: { id: "collaborator-3", name: "Kai" }
    }),
    { code: "vibe64_session_renewal_agent_active" }
  );
  const failed = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);

  assert.equal(failed.error.code, "vibe64_session_renewal_actor_unavailable");
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.calls.freeze, 0);
  assert.equal(context.calls.close, 0);

  context.sessions.get(OLD_SESSION_ID).agentRuns = [];
  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey,
    vibe64User: { id: "collaborator-3", name: "Kai" }
  });
  await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  assert.deepEqual(context.calls.createActor, { id: "collaborator-3", name: "Kai" });
});

test("archive failure restores the acknowledged predecessor before exposing a retry", async () => {
  const context = fixture({ archiveFailure: "compact" });
  const reviewed = await reviewedRenewal(context);
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const failed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
  );
  assert.equal(failed.stage, SESSION_RENEWAL_STAGE.OLD_ARCHIVING);
  assert.equal(failed.predecessorArchivedAt, undefined);
  assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
  assert.equal(context.sessions.get(failed.successor.sessionId).status, "renewal_pending");
  assert.equal(context.currentSessionId, OLD_SESSION_ID);
  assert.equal(context.calls.restore, 1);

  context.setArchiveFailure("");
  await context.newController().retrySessionRenewal(OLD_SESSION_ID, {
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.status === SESSION_RENEWAL_STATUS.COMPLETED
  );
  await context.controller.inspectSessionRenewal(OLD_SESSION_ID);
  assert.equal(context.currentSessionId, completed.successor.sessionId);
  assert.equal(context.calls.compact, 2);
});

test("pre-commit activation and selection failures restore the predecessor and hide the successor", async (t) => {
  async function reachRestoredFailure(context) {
    const reviewed = await reviewedRenewal(context);
    await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    });
    const failed = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => state?.status === SESSION_RENEWAL_STATUS.FAILED
    );
    const successor = context.sessions.get(failed.successor.sessionId);
    assert.equal(failed.commit, undefined);
    assert.equal(failed.successor.availableAt, undefined);
    assert.notEqual(context.sessions.get(OLD_SESSION_ID).archived, true);
    assert.equal(context.sessions.get(OLD_SESSION_ID).status, "active");
    assert.equal(context.currentSessionId, OLD_SESSION_ID);
    assert.equal(successor.status, "renewal_pending");
    await assert.rejects(
      () => context.runtime.getSession(successor.sessionId),
      (error) => error?.code === "vibe64_session_renewal_private"
    );
    assert.equal(
      context.events.some((event) => event.reason === "session-renewal-failed"),
      true
    );
    assert.equal(
      context.events.some((event) => event.reason === "session-renewal-successor-available"),
      false
    );
    return { failed, reviewed };
  }

  await t.test("activation preparation", async () => {
    const context = fixture({ activationFailure: true });
    const { failed, reviewed } = await reachRestoredFailure(context);
    assert.equal(failed.error.code, "activation_failed");
    assert.equal(context.calls.rollbackActivation, 1);

    context.setActivationFailure(false);
    await context.controller.retrySessionRenewal(OLD_SESSION_ID, {
      operationKey: reviewed.operationKey
    });
    const completed = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => state?.maintenance?.status === "completed"
    );
    assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
    assert.equal(context.currentSessionId, completed.successor.sessionId);
  });

  await t.test("selection preparation", async () => {
    const context = fixture({ finalSelectionFailure: true });
    const { failed, reviewed } = await reachRestoredFailure(context);
    assert.equal(failed.error.code, "selection_failed");
    assert.equal(context.calls.rollbackActivation, 1);

    context.setFinalSelectionFailure(false);
    await context.controller.retrySessionRenewal(OLD_SESSION_ID, {
      operationKey: reviewed.operationKey
    });
    const completed = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => state?.maintenance?.status === "completed"
    );
    assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
    assert.equal(context.currentSessionId, completed.successor.sessionId);
  });

  await t.test("commit marker persistence before write", async () => {
    const error = new Error("Commit marker unavailable");
    error.code = "commit_marker_failed";
    const context = fixture({
      commitTransitionPreWriteErrors: [error]
    });
    const { failed, reviewed } = await reachRestoredFailure(context);
    assert.equal(failed.error.code, "commit_marker_failed");
    assert.equal(context.calls.rollbackActivation, 1);

    await context.controller.retrySessionRenewal(OLD_SESSION_ID, {
      operationKey: reviewed.operationKey
    });
    const completed = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => state?.maintenance?.status === "completed"
    );
    assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
    assert.equal(context.currentSessionId, completed.successor.sessionId);
  });
});

test("an error after the commit marker write recovers forward without restoring the predecessor", async () => {
  const error = new Error("Commit marker response lost");
  error.code = "commit_marker_response_lost";
  const context = fixture({
    commitTransitionPostWriteErrors: [error]
  });
  const reviewed = await reviewedRenewal(context);

  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const completed = await eventually(
    () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
    (state) => state?.maintenance?.status === "completed"
  );

  assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
  assert.ok(completed.commit?.committedAt);
  assert.equal(context.sessions.get(OLD_SESSION_ID).archived, true);
  assert.equal(context.sessions.get(completed.successor.sessionId).status, "active");
  assert.equal(context.currentSessionId, completed.successor.sessionId);
  assert.equal(context.calls.restore, 0);
  assert.equal(context.calls.rollbackActivation, 0);
  assert.equal(
    context.events.filter((event) => event.reason === "session-renewal-completed").length,
    1
  );
  assert.equal(
    context.events.some((event) => event.reason === "session-renewal-failed"),
    false
  );
});

test("post-commit maintenance failures stay completed, visible, and retry each cleanup boundary", async (t) => {
  async function reachFailedMaintenance(context) {
    const reviewed = await reviewedRenewal(context);
    await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
      expectedHash: reviewed.draft.hash,
      expectedRevision: reviewed.draft.revision,
      operationKey: reviewed.operationKey
    });
    const completed = await eventually(
      () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
      (state) => (
        state?.status === SESSION_RENEWAL_STATUS.COMPLETED &&
        state?.maintenance?.status === "failed"
      )
    );
    const successor = context.sessions.get(completed.successor.sessionId);
    assert.ok(completed.commit?.committedAt);
    assert.ok(completed.successor.availableAt);
    assert.equal(context.currentSessionId, successor.sessionId);
    assert.equal(successor.status, "active");
    assert.equal(context.sessions.get(OLD_SESSION_ID).archived, true);
    assert.equal(context.sessions.get(OLD_SESSION_ID).archiveRetained, false);
    assert.equal(
      context.events.some((event) => event.reason === "session-renewal-failed"),
      false
    );
    assert.equal(
      context.events.filter((event) => event.reason === "session-renewal-successor-available").length,
      1
    );
    assert.equal(
      context.events.filter((event) => event.reason === "session-renewal-completed").length,
      1
    );
    return completed;
  }

  async function waitForAutomaticMaintenance(context) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
      if (state?.maintenance?.status === "completed") {
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("Timed out waiting for automatic post-commit maintenance.");
  }

  await t.test("source-stage removal", async () => {
    const context = fixture({ cleanupFailure: true, workflowLockRetryMs: 10 });
    const failedMaintenance = await reachFailedMaintenance(context);
    assert.equal(failedMaintenance.maintenance.error.code, "source_cleanup_failed");
    await new Promise((resolve) => setTimeout(resolve, 35));
    const backedOff = await readSessionRenewalState(context.runtime, OLD_SESSION_ID);
    assert.equal(backedOff.status, SESSION_RENEWAL_STATUS.COMPLETED);
    assert.ok(backedOff.maintenance.attempt >= 2);
    assert.ok(context.calls.cleanup <= 4);
    context.setCleanupFailure(false);

    const completed = await waitForAutomaticMaintenance(context);
    assert.equal(context.currentSessionId, completed.successor.sessionId);
    assert.ok(context.calls.cleanup >= 2);
    assert.ok(context.sessions.get(completed.successor.sessionId).metadata.renewal_finalized_at);
    assert.equal(context.sessions.get(OLD_SESSION_ID).archiveRetained, false);
  });

  await t.test("predecessor process-exit proof release", async () => {
    const context = fixture({
      processExitProofReleaseFailures: 1,
      workflowLockRetryMs: 10
    });
    const failedMaintenance = await reachFailedMaintenance(context);
    assert.equal(
      failedMaintenance.maintenance.error.code,
      "vibe64_session_renewal_process_exit_proof_release_failed"
    );
    assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), true);
    const failedReleaseAttempts = context.calls.processExitProofRelease;
    assert.ok(failedReleaseAttempts >= 1);
    context.setProcessExitProofReleaseFailures(0);

    const completed = await waitForAutomaticMaintenance(context);
    assert.equal(context.currentSessionId, completed.successor.sessionId);
    assert.equal(context.terminalAdmissions.has(OLD_SESSION_ID), false);
    assert.ok(context.calls.processExitProofRelease > failedReleaseAttempts);
    assert.ok(context.sessions.get(completed.successor.sessionId).metadata.renewal_finalized_at);
  });

  await t.test("provider resource release", async () => {
    const context = fixture({ releaseFailure: true, workflowLockRetryMs: 10 });
    const failedMaintenance = await reachFailedMaintenance(context);
    assert.equal(failedMaintenance.maintenance.error.code, "resource_release_failed");
    assert.equal(
      context.sessions.get(failedMaintenance.successor.sessionId).metadata.renewal_finalized_at,
      undefined
    );
    context.setReleaseFailure(false);

    const completed = await waitForAutomaticMaintenance(context);
    assert.equal(context.currentSessionId, completed.successor.sessionId);
    assert.ok(context.sessions.get(completed.successor.sessionId).metadata.renewal_finalized_at);
  });
});

test("post-commit maintenance ledger response loss resumes across restart", async (t) => {
  const phases = [
    "attempt",
    "step:archiveFinalized",
    "step:attachmentsReleased",
    "step:sourceRemoved",
    "step:predecessorProcessProofReleased",
    "step:admissionThawed",
    "step:resourcesReleased",
    "step:successorFinalized",
    "completed"
  ];
  for (const phase of phases) {
    await t.test(phase, async () => {
      const responseLoss = new Error(`Lost ${phase} ledger response`);
      responseLoss.code = "simulated_maintenance_ledger_response_loss";
      const context = fixture({
        maintenanceStateWriteFailures: [{ error: responseLoss, phase }],
        workflowLockRetryMs: 60_000
      });
      const reviewed = await reviewedRenewal(
        context,
        `renewal:maintenance-ledger-${phase.replaceAll(":", "-")}`
      );
      await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
        expectedHash: reviewed.draft.hash,
        expectedRevision: reviewed.draft.revision,
        operationKey: reviewed.operationKey
      });
      await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => (
          context.calls.maintenanceWrites.includes(phase) &&
          state?.status === SESSION_RENEWAL_STATUS.COMPLETED &&
          state?.maintenance?.status !== "completed"
        ),
        200
      );
      await context.controller.closeSessionRenewalWork();
      const restarted = context.newController();
      await restarted.resumeSessionRenewals();
      const completed = await eventually(
        () => readSessionRenewalState(context.runtime, OLD_SESSION_ID),
        (state) => state?.maintenance?.status === "completed",
        200
      );

      assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
      assert.ok(
        context.calls.maintenanceWrites.filter((entry) => entry === phase).length >= 2
      );
      assert.ok(completed.maintenance.attempt >= 1);
      assert.equal(
        context.events.filter((event) => event.reason === "session-renewal-completed").length,
        1
      );
      await restarted.closeSessionRenewalWork();
    });
  }
});

test("a failed maintenance-ledger write schedules one bounded retry without spinning", async () => {
  const responseLoss = new Error("Lost failed-maintenance ledger response");
  responseLoss.code = "simulated_failed_maintenance_ledger_response_loss";
  const context = fixture({
    cleanupFailure: true,
    maintenanceStateWriteFailures: [{ error: responseLoss, phase: "failed" }],
    workflowLockRetryMs: 10
  });
  const reviewed = await reviewedRenewal(context, "renewal:failed-ledger-response");
  await context.controller.confirmSessionRenewal(OLD_SESSION_ID, {
    expectedHash: reviewed.draft.hash,
    expectedRevision: reviewed.draft.revision,
    operationKey: reviewed.operationKey
  });
  const failed = await eventually(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  }, (state) => state?.maintenance?.status === "failed", 200);

  assert.equal(failed.status, SESSION_RENEWAL_STATUS.COMPLETED);
  assert.equal(failed.maintenance.error.code, "source_cleanup_failed");
  assert.equal(
    context.calls.maintenanceWrites.filter((phase) => phase === "failed").length,
    2
  );
  assert.ok(context.calls.cleanup >= 2);
  assert.ok(context.calls.cleanup <= 3);
  context.setCleanupFailure(false);

  const completed = await eventually(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return readSessionRenewalState(context.runtime, OLD_SESSION_ID);
  }, (state) => state?.maintenance?.status === "completed", 200);
  assert.equal(completed.status, SESSION_RENEWAL_STATUS.COMPLETED);
});

test("eligibility rejects active work, dirty source, and stale canonical source", async (t) => {
  const baseSession = {
    agentRuns: [],
    metadata: {
      base_branch: "main",
      repository_mode: "github",
      source_default_branch: "main"
    },
    sessionId: OLD_SESSION_ID,
    status: "active",
    workspaceSetup: { status: "succeeded" }
  };
  async function inspect({
    check = {},
    session = {},
    task = null,
    work = {}
  } = {}) {
    const current = {
      ...baseSession,
      ...session
    };
    const runtime = {
      store: {
        async readBackgroundTask() {
          return task;
        },
        async readSessionSourceDescriptor() {
          return { metadata: current.metadata };
        }
      },
      async getSession() {
        return current;
      },
      async readConversationLogPage() {
        return { pagination: { newestTurnId: "turn", totalTurnCount: 3 } };
      }
    };
    return inspectSessionRenewalEligibility({
      runtime,
      session: current,
      setupRunner: { isRunning: () => false },
      terminals: {
        async checkSessionUpdates() {
          return {
            canonicalCommit: COMMIT,
            canonicalSource: {
              authority: "github",
              commit: COMMIT,
              ref: "refs/heads/main",
              repository: "https://example.test/project.git"
            },
            relationship: "current",
            sessionCurrent: true,
            updateAvailable: false,
            ...check
          };
        },
        async inspectSessionWork() {
          return {
            canonicalCommit: COMMIT,
            changedPaths: [],
            dirty: false,
            sessionHead: COMMIT,
            sessionMatchesCanonical: true,
            unsaved: false,
            ...work
          };
        }
      }
    });
  }

  await t.test("active assistant", async () => {
    await assert.rejects(
      inspect({ session: { agentRuns: [{ state: "active" }] } }),
      { code: "vibe64_session_renewal_agent_active" }
    );
  });
  await t.test("goal resumed before its next native turn", async () => {
    const run = {
      state: "completed",
      providerThreadId: "current-thread",
      providerGoalThreadId: "current-thread",
      providerGoalStatus: "active"
    };
    await assert.rejects(inspect({ session: { agentRuns: [run] } }), {
      code: "vibe64_session_renewal_agent_active"
    });
    for (const providerGoalStatus of ["paused", "blocked", "complete", ""]) {
      await inspect({ session: { agentRuns: [{ ...run, providerGoalStatus }] } });
    }
    await inspect({ session: { agentRuns: [{ ...run, providerGoalThreadId: "old-thread" }] } });
  });
  await t.test("active Save", async () => {
    await assert.rejects(
      inspect({ task: { status: "running" } }),
      { code: "vibe64_session_renewal_repository_operation_running" }
    );
  });
  await t.test("dirty source", async () => {
    await assert.rejects(
      inspect({ work: { changedPaths: ["src/app.js"], dirty: true, unsaved: true } }),
      { code: "vibe64_session_renewal_source_not_ready" }
    );
  });
  await t.test("stale source", async () => {
    await assert.rejects(
      inspect({ check: { relationship: "behind", sessionCurrent: false, updateAvailable: true } }),
      { code: "vibe64_session_renewal_source_not_ready" }
    );
  });
});
