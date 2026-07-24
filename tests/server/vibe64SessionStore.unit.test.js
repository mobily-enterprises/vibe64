import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_INITIAL_STEP,
  VIBE64_SESSION_STATUS,
  Vibe64SessionRuntime,
  createVibe64SessionStore,
  isValidVibe64SessionId,
  resolveVibe64SessionPaths
} from "@local/vibe64-runtime/server";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "@local/vibe64-core/shared";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const sessionStoreMutationWorker = new URL("./fixtures/sessionStoreMutationWorker.mjs", import.meta.url).pathname;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function assertPathExists(filePath) {
  await assert.doesNotReject(access(filePath));
}

async function assertPathMissing(filePath) {
  await assert.rejects(
    () => access(filePath),
    (error) => error?.code === "ENOENT"
  );
}

function startSessionStoreMutationWorker(args) {
  const child = fork(sessionStoreMutationWorker, args, {
    silent: true
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Session mutation worker exited with ${signal || `code ${code}`}: ${stderr.trim() || "no stderr"}`
      ));
    });
  });
  completed.catch(() => null);
  return {
    child,
    completed,
    stderr: () => stderr
  };
}

function waitForSessionStoreMutationWorkerMessage(worker, type) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      worker.child.off("close", onClose);
      worker.child.off("error", onError);
      worker.child.off("message", onMessage);
    }
    function onClose(code, signal) {
      cleanup();
      reject(new Error(
        `Session mutation worker exited before ${type} with ${signal || `code ${code}`}: ` +
        `${worker.stderr().trim() || "no stderr"}`
      ));
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onMessage(message) {
      if (message?.type !== type) {
        return;
      }
      cleanup();
      resolve(message);
    }
    worker.child.on("close", onClose);
    worker.child.on("error", onError);
    worker.child.on("message", onMessage);
  });
}

function sendSessionStoreMutationWorkerMessage(worker, message) {
  return new Promise((resolve, reject) => {
    worker.child.send(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function projectLocalRoot(targetRoot) {
  return projectRuntimeRoot(targetRoot);
}

function createTestSessionStore({
  targetRoot,
  ...options
} = {}) {
  return createVibe64SessionStore({
    ...options,
    projectLocalRoot: projectLocalRoot(targetRoot),
    projectSessionSourceRoot: options.projectSessionSourceRoot || projectLocalRoot(targetRoot),
    targetRoot
  });
}

function resolveTestSessionPaths({
  projectSessionSourceRoot = "",
  sessionId = "",
  targetRoot
} = {}) {
  return resolveVibe64SessionPaths({
    projectSessionSourceRoot: projectSessionSourceRoot || projectLocalRoot(targetRoot),
    sessionId,
    stateRoot: projectLocalRoot(targetRoot),
    targetRoot
  });
}

test("vibe64 session store creates inspectable session state under the runtime root", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const session = await store.createSession({
      metadata: {
        adapter: "fake"
      },
      sessionId: "store_session"
    });

    const paths = resolveTestSessionPaths({
      sessionId: "store_session",
      targetRoot
    });

    assert.equal(session.sessionId, "store_session");
    assert.equal(session.targetRoot, targetRoot);
    assert.equal(session.currentStep, VIBE64_INITIAL_STEP);
    assert.equal(session.status, VIBE64_SESSION_STATUS.ACTIVE);
    assert.equal(session.metadata.adapter, "fake");
    assert.equal(session.manifest.product, "vibe64");
    assert.equal(session.manifest.schemaVersion, 1);

    await assertPathExists(paths.manifestPath);
    await assertPathExists(paths.currentStepPath);
    await assertPathExists(paths.statusPath);
    await assertPathExists(paths.metadataRoot);
    await assertPathExists(paths.agentRunsRoot);
    await assertPathExists(paths.agentTasksRoot);
    await assertPathExists(paths.artifactsRoot);
    await assertPathExists(paths.backgroundTasksRoot);
    await assertPathExists(paths.commandLifecyclesRoot);
    await assertPathExists(paths.privateInputsRoot);

    assert.equal(await readFile(paths.currentStepPath, "utf8"), "session_created\n");
    assert.equal(await readFile(paths.statusPath, "utf8"), "active\n");
  });
});

test("vibe64 session store persists the current focused task and keeps task history", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    await store.createSession({
      sessionId: "agent_tasks"
    });

    await store.writeCurrentAgentTask("agent_tasks", {
      createdAt: "2026-07-16T01:00:00.000Z",
      id: "task-1",
      label: "First task",
      state: "completed",
      turns: []
    });
    await store.writeCurrentAgentTask("agent_tasks", {
      createdAt: "2026-07-16T02:00:00.000Z",
      id: "task-2",
      label: "Current task",
      state: "running",
      turns: [{
        role: "user",
        text: "Start"
      }]
    });
    await store.writeAgentTask("agent_tasks", {
      ...await store.readAgentTask("agent_tasks", "task-1"),
      handoffPending: false
    });

    const session = await store.readSession("agent_tasks");
    const tasks = await store.readAgentTasks("agent_tasks");

    assert.equal(session.agentTask.id, "task-2");
    assert.equal(session.agentTask.state, "running");
    assert.deepEqual(tasks.map((task) => task.id), ["task-1", "task-2"]);
    assert.equal(tasks[0].handoffPending, false);
  });
});

test("vibe64 session store tracks the current session outside the active session directory", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const projectSessionSourceRoot = path.join(targetRoot, "managed-project");
    const store = createTestSessionStore({
      projectSessionSourceRoot,
      targetRoot
    });
    await store.createSession({
      sessionId: "session-a"
    });
    await store.createSession({
      sessionId: "session-b"
    });
    const paths = resolveTestSessionPaths({
      projectSessionSourceRoot,
      sessionId: "session-a",
      targetRoot
    });
    await mkdir(path.join(projectSessionSourceRoot, "sessions", "active", "session-a", "source"), {
      recursive: true
    });

    await store.updateCurrentSession("session-a");

    assert.equal((await lstat(paths.currentSessionAliasPath)).isSymbolicLink(), true);
    assert.equal(await readlink(paths.currentSessionAliasPath), path.join("active", "session-a"));
    assert.equal(
      await stat(path.join(paths.currentSessionAliasPath, "source")).then((entry) => entry.isDirectory()),
      true
    );
    await assertPathMissing(path.join(projectLocalRoot(targetRoot), "sessions", "selected"));
    assert.deepEqual((await readdir(paths.activeSessionsRoot)).sort(), ["session-a", "session-b"]);
    assert.deepEqual((await store.listSessions()).map((session) => session.sessionId), ["session-a", "session-b"]);

    await store.updateCurrentSession("session-b");
    assert.equal(await readlink(paths.currentSessionAliasPath), path.join("active", "session-b"));

    await store.updateCurrentSession("");
    await assertPathMissing(paths.currentSessionAliasPath);

    await assert.rejects(
      () => store.updateCurrentSession("missing-session"),
      (error) => error?.code === "vibe64_session_not_found"
    );
  });
});

test("vibe64 session store requires the managed source root before updating the current session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
      projectLocalRoot: projectLocalRoot(targetRoot),
      targetRoot
    });

    await assert.rejects(
      () => store.updateCurrentSession(""),
      (error) => error?.code === "vibe64_project_session_source_root_required"
    );
    await assertPathMissing(path.join(projectLocalRoot(targetRoot), "sessions", "selected"));
  });
});

test("vibe64 session store never overwrites a real current-session alias path", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    await store.createSession({
      sessionId: "session-a"
    });
    const paths = resolveTestSessionPaths({
      sessionId: "session-a",
      targetRoot
    });
    await writeFile(paths.currentSessionAliasPath, "keep me\n", "utf8");

    await assert.rejects(
      () => store.updateCurrentSession("session-a"),
      (error) => error?.code === "vibe64_current_session_alias_conflict"
    );
    assert.equal(await readFile(paths.currentSessionAliasPath, "utf8"), "keep me\n");
  });
});

test("artifact readiness does not read large artifacts into memory", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    const sessionId = "large_artifact_readiness";
    const largeArtifact = "x".repeat((64 * 1024) + 1);

    await store.createSession({
      sessionId
    });
    await store.writeArtifact(sessionId, "large.bin", largeArtifact);

    const sessionPaths = resolveTestSessionPaths({
      sessionId,
      targetRoot
    });
    const fileStat = await stat(path.join(sessionPaths.artifactsRoot, "large.bin"));
    const expectedFingerprint = createHash("sha256")
      .update(`metadata:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`)
      .digest("hex");
    const session = await store.readSession(sessionId);

    assert.deepEqual(session.artifactReadiness["large.bin"], {
      exists: true,
      fingerprint: expectedFingerprint,
      nonEmpty: true
    });
  });
});

test("vibe64 session store writes private input files without exposing values in session reads", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "private_input_session"
    });

    const reference = await store.writePrivateInput("private_input_session", "seed_api_key", {
      fields: [
        {
          label: "Seed API key",
          name: "apiKey"
        }
      ],
      owner: {
        id: "seed_api_key",
        kind: "intent"
      },
      stepId: "seed_application_defined",
      stepStatus: "waiting_for_input",
      values: {
        apiKey: "sk-private-test"
      }
    });
    const paths = resolveTestSessionPaths({
      sessionId: "private_input_session",
      targetRoot
    });

    assert.equal(reference.relativePath, "private-inputs/000001-seed_api_key.json");
    assert.deepEqual(await readdir(paths.privateInputsRoot), ["000001-seed_api_key.json"]);
    const record = JSON.parse(await readFile(reference.path, "utf8"));
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.values.apiKey, "sk-private-test");
    assert.equal(record.stepId, "seed_application_defined");

    const session = await store.readSession("private_input_session");
    assert.equal(session.privateInputsRoot, paths.privateInputsRoot);
    assert.equal(JSON.stringify(session).includes("sk-private-test"), false);
  });
});

test("vibe64 session store reads and writes metadata, artifacts, status, current step, and command logs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "state_contract"
    });

    await store.writeStatus("state_contract", "blocked");
    await store.writeCurrentStep("state_contract", "install_dependencies");
    await store.writeStepState("state_contract", "install_dependencies", {
      status: "attempting_execution"
    });
    await store.writeMetadataValue("state_contract", "adapter", "cpp-cmake");
    const artifactPath = await store.writeArtifact("state_contract", "summary.txt", "hello\n");
	    await store.appendCommandLogEntry("state_contract", {
	      actionId: "configure",
	      status: "ok"
	    });
	    await store.writeCommandLifecycleEvent("state_contract", "2-configure", {
	      event: {
	        kind: "starting"
	      },
	      patch: {
	        actionId: "configure",
	        phase: "starting",
	        stepId: "install_dependencies",
	        stepRevision: 2
	      }
	    });
	    await store.writeCommandLifecycleEvent("state_contract", "2-configure", {
	      event: {
	        kind: "result_written"
	      },
	      patch: {
	        outcome: "completed",
	        phase: "result_written"
	      }
	    });
	    await store.writeCommandLifecycleEvent("state_contract", "2-configure", {
	      event: {
	        kind: "started"
	      },
	      patch: {
	        phase: "started",
	        terminalSessionId: "terminal-1"
	      }
	    });
	    await store.writeAgentRunEvent("state_contract", "codex_app_server", {
	      event: {
	        kind: "started"
	      },
	      patch: {
	        provider: "codex",
	        providerInterface: "app-server",
	        providerStatus: "inProgress",
	        providerThreadId: "thread-1",
	        providerTurnId: "turn-1",
	        state: "active",
	        stepId: "install_dependencies",
	        stepStatus: "awaiting_agent_result"
	      }
	    });
	    await store.writeAgentRunEvent("state_contract", "codex_app_server", {
	      event: {
	        kind: "interrupted",
	        message: "Stopped by user."
	      },
	      patch: {
	        error: "Stopped by user.",
	        providerStatus: "interrupted",
	        state: "interrupted"
	      }
	    });

	    const session = await store.readSession("state_contract");
    assert.equal(session.status, "blocked");
    assert.equal(session.currentStep, "install_dependencies");
    assert.equal(session.stepRevision, 2);
    assert.equal(session.stepStatesRoot.endsWith("/step-state"), true);
	    assert.equal(session.metadata.adapter, "cpp-cmake");
	    assert.deepEqual(session.currentCommandLifecycle && {
	      actionId: session.currentCommandLifecycle.actionId,
	      eventKinds: session.currentCommandLifecycle.events.map((event) => event.kind),
	      id: session.currentCommandLifecycle.id,
	      outcome: session.currentCommandLifecycle.outcome,
	      phase: session.currentCommandLifecycle.phase,
	      status: session.currentCommandLifecycle.status,
	      stepId: session.currentCommandLifecycle.stepId,
	      stepRevision: session.currentCommandLifecycle.stepRevision,
	      terminalSessionId: session.currentCommandLifecycle.terminalSessionId
	    }, {
	      actionId: "configure",
	      eventKinds: ["starting", "result_written", "started"],
	      id: "2-configure",
	      outcome: "completed",
	      phase: "result_written",
	      status: "result_written",
	      stepId: "install_dependencies",
	      stepRevision: 2,
	      terminalSessionId: "terminal-1"
	    });
	    assert.deepEqual(session.agentRuns.map((run) => ({
	      active: run.active,
	      eventKinds: run.events.map((event) => event.kind),
	      id: run.id,
	      provider: run.provider,
	      providerStatus: run.providerStatus,
	      providerTurnId: run.providerTurnId,
	      state: run.state,
	      stepId: run.stepId
	    })), [
	      {
	        active: false,
	        eventKinds: ["started", "interrupted"],
	        id: "codex_app_server",
	        provider: "codex",
	        providerStatus: "interrupted",
	        providerTurnId: "turn-1",
	        state: "interrupted",
	        stepId: "install_dependencies"
	      }
	    ]);
    assert.deepEqual(await store.readStepState("state_contract", "install_dependencies"), {
      at: "2026-05-16T01:02:03.000Z",
      status: "attempting_execution",
      stepId: "install_dependencies"
    });
    assert.equal(await store.readMetadataValue("state_contract", "adapter"), "cpp-cmake");
    assert.equal(await store.readArtifact("state_contract", "summary.txt"), "hello\n");
    assert.equal(await store.artifactExists("state_contract", "summary.txt"), true);
    assert.equal(artifactPath, path.join(projectLocalRoot(targetRoot), "sessions", "active", "state_contract", "artifacts", "summary.txt"));
    assert.equal(typeof session.artifactReadiness["summary.txt"].fingerprint, "string");
    assert.equal(session.artifactReadiness["summary.txt"].fingerprint.length, 64);

    await store.writeArtifact("state_contract", "summary.txt", "updated\n");
    const updatedSession = await store.readSession("state_contract");
    assert.notEqual(
      updatedSession.artifactReadiness["summary.txt"].fingerprint,
      session.artifactReadiness["summary.txt"].fingerprint
    );

    await store.deleteStepState("state_contract", "install_dependencies");
    assert.equal(await store.readStepState("state_contract", "install_dependencies"), null);

    const commandLog = await store.readCommandLog("state_contract");
    assert.deepEqual(commandLog, [
      {
        actionId: "configure",
        at: "2026-05-16T01:02:03.000Z",
        status: "ok"
      }
    ]);

    const summary = await store.readSessionSummary("state_contract");
    assert.deepEqual({
      completedStepCount: summary.completedStepCount,
      currentStep: summary.currentStep,
      hasArtifactReadiness: "artifactReadiness" in summary,
      hasCommandLifecycles: "commandLifecycles" in summary,
      hasPresentation: "presentation" in summary,
      metadata: summary.metadata,
      sessionId: summary.sessionId,
      sessionRoot: summary.sessionRoot,
      status: summary.status,
      stepMachine: summary.stepMachine,
      targetRoot: summary.targetRoot
    }, {
      completedStepCount: 0,
      currentStep: "install_dependencies",
      hasArtifactReadiness: false,
      hasCommandLifecycles: false,
      hasPresentation: false,
      metadata: {
        adapter: "cpp-cmake"
      },
      sessionId: "state_contract",
      sessionRoot: path.join(projectLocalRoot(targetRoot), "sessions", "active", "state_contract"),
      status: "blocked",
      stepMachine: null,
      targetRoot
    });
  });
});

test("vibe64 session summaries include current step lifecycle state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      initialStep: "plan_and_execute",
      sessionId: "summary_step_state"
    });
    await store.writeStepState("summary_step_state", "plan_and_execute", {
      message: "Codex is thinking.",
      status: "awaiting_agent_result"
    });

    const summary = await store.readSessionSummary("summary_step_state");

    assert.deepEqual({
      hasArtifactReadiness: "artifactReadiness" in summary,
      hasCommandLifecycles: "commandLifecycles" in summary,
      hasPresentation: "presentation" in summary,
      sessionId: summary.sessionId,
      stepMachine: summary.stepMachine
    }, {
      hasArtifactReadiness: false,
      hasCommandLifecycles: false,
      hasPresentation: false,
      sessionId: "summary_step_state",
      stepMachine: {
        at: "2026-05-16T01:02:03.000Z",
        message: "Codex is thinking.",
        status: "awaiting_agent_result",
        stepId: "plan_and_execute"
      }
    });
  });
});

test("vibe64 session store reads the bounded source descriptor without session history", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    const sourcePath = path.join(targetRoot, "sessions", "active", "source_descriptor", "source");
    await store.createSession({
      metadata: {
        base_commit: "abc123",
        repository_mode: "github",
        source_kind: "session_clone",
        source_path: sourcePath,
        source_path_authority: "managed_session_source",
        unrelated_large_history_field: "must not be projected",
        workflow_repository_profile: "canonical_git"
      },
      sessionId: "source_descriptor"
    });

    const descriptor = await store.readSessionSourceDescriptor("source_descriptor");

    assert.deepEqual(descriptor, {
      metadata: {
        base_commit: "abc123",
        repository_mode: "github",
        source: "",
        source_kind: "session_clone",
        source_path: sourcePath,
        source_path_authority: "managed_session_source",
        source_removed: "",
        workflow_repository_profile: "canonical_git"
      },
      sessionId: "source_descriptor",
      sessionRoot: path.join(
        projectLocalRoot(targetRoot),
        "sessions",
        "active",
        "source_descriptor"
      ),
      targetRoot
    });
  });
});

test("vibe64 session store persists background task status with retry metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "background_task_status"
    });

    await store.writeBackgroundTaskEvent("background_task_status", "codex_app_server", {
      event: {
        kind: "started"
      },
      patch: {
        kind: "codex_app_server",
        label: "Codex app-server",
        message: "Preparing Codex.",
        status: "running"
      }
    });
    await store.writeBackgroundTaskEvent("background_task_status", "codex_app_server", {
      event: {
        kind: "failed"
      },
      patch: {
        error: "Create the session clone before starting Codex.",
        message: "Codex app-server preparation failed.",
        retry: {
          clientAction: VIBE64_CLIENT_CONTROL_ACTIONS.START_AGENT_TERMINAL,
          label: "Retry Codex"
        },
        status: "failed"
      }
    });

    const task = await store.readBackgroundTask("background_task_status", "codex_app_server");
    assert.deepEqual({
      error: task.error,
      eventKinds: task.events.map((event) => event.kind),
      id: task.id,
      label: task.label,
      retry: task.retry,
      status: task.status
    }, {
      error: "Create the session clone before starting Codex.",
      eventKinds: ["started", "failed"],
      id: "codex_app_server",
      label: "Codex app-server",
      retry: {
        clientAction: VIBE64_CLIENT_CONTROL_ACTIONS.START_AGENT_TERMINAL,
        label: "Retry Codex"
      },
      status: "failed"
    });
    assert.deepEqual((await store.readSession("background_task_status")).backgroundTasks.map((entry) => entry.id), [
      "codex_app_server"
    ]);
  });
});

test("vibe64 session store can reject stale background task updates atomically", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "background_task_guard"
    });

    await store.writeBackgroundTaskEvent("background_task_guard", "codex_app_server", {
      event: {
        kind: "ready",
        status: "ready"
      },
      patch: {
        healthAttemptId: "new-attempt",
        status: "ready"
      }
    });

    const result = await store.writeBackgroundTaskEvent("background_task_guard", "codex_app_server", {
      event: {
        kind: "failed",
        status: "failed"
      },
      patch: {
        error: "Old startup attempt timed out.",
        healthAttemptId: "old-attempt",
        status: "failed"
      },
      shouldWrite: ({ previous = {} } = {}) => previous.healthAttemptId === "old-attempt"
    });

    assert.equal(result.status, "ready");
    assert.equal(result.error || "", "");
    assert.equal(result.healthAttemptId, "new-attempt");
    assert.deepEqual(result.events.map((event) => event.kind), ["ready"]);
    const task = await store.readBackgroundTask("background_task_guard", "codex_app_server");
    assert.equal(task.status, "ready");
    assert.deepEqual(task.events.map((event) => event.kind), ["ready"]);
  });
});

test("vibe64 session store assigns stable ids to Codex prompt handoffs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "prompt_handoff_ids"
    });

    const actionResult = await store.writeActionResult("prompt_handoff_ids", "make_plan", {
      agentPromptHandoff: {
        kind: "agent_prompt_handoff",
        prompt: "Make a plan.",
        promptId: "make_plan",
        terminalInput: "Make a plan."
      },
      status: "prompt_ready",
      stepId: "plan_and_execute"
    });

    assert.equal(actionResult.agentPromptHandoff.handoffId, "000001-make_plan.json:make_plan");
    assert.equal(actionResult.agentPromptHandoff.actionId, "make_plan");
    assert.equal(actionResult.agentPromptHandoff.attemptFile, "000001-make_plan.json");
    assert.equal(actionResult.agentPromptHandoff.attemptNumber, 1);

    const sessionActionResult = await store.readActionResult("prompt_handoff_ids", "make_plan");
    const session = await store.readSession("prompt_handoff_ids");
    assert.equal(
      sessionActionResult.agentPromptHandoff.handoffId,
      "000001-make_plan.json:make_plan"
    );
    assert.equal(
      session.actionAttempts[0].agentPromptHandoff.handoffId,
      "000001-make_plan.json:make_plan"
    );
  });
});

test("vibe64 session store persists conversation turns as one file per message", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "conversation_log"
    });

    await store.writeConversationUserMessage("conversation_log", {
      text: "What should we change?"
    });
    await store.writeConversationThinkingMessage("conversation_log", {
      text: "Checked the current form structure."
    });
    await store.writeConversationAssistantMessage("conversation_log", {
      text: "Change the form layout."
    });
    await store.writeConversationUserMessage("conversation_log", {
      text: "Keep it simple."
    });
    await store.writeConversationSystemMessage("conversation_log", {
      text: "Session clone created."
    });

    const paths = resolveTestSessionPaths({
      sessionId: "conversation_log",
      targetRoot
    });
    const turnIds = await readdir(paths.conversationLogRoot);

    assert.deepEqual(turnIds.sort(), ["000001", "000002", "000003"]);
    assert.deepEqual((await readdir(path.join(paths.conversationLogRoot, "000001"))).sort(), [
      "assistant.20260516T010203456Z.md",
      "thinking.20260516T010203456Z.md",
      "user.20260516T010203456Z.md"
    ]);
    assert.deepEqual(await store.readConversationLog("conversation_log"), [
      {
        assistant: {
          at: "2026-05-16T01:02:03.456Z",
          role: "assistant",
          text: "Change the form layout."
        },
        messages: [
          {
            at: "2026-05-16T01:02:03.456Z",
            role: "user",
            text: "What should we change?"
          },
          {
            at: "2026-05-16T01:02:03.456Z",
            role: "thinking",
            text: "Checked the current form structure."
          },
          {
            at: "2026-05-16T01:02:03.456Z",
            role: "assistant",
            text: "Change the form layout."
          }
        ],
        thinking: [
          {
            at: "2026-05-16T01:02:03.456Z",
            role: "thinking",
            text: "Checked the current form structure."
          }
        ],
        turnId: "000001",
        user: {
          at: "2026-05-16T01:02:03.456Z",
          role: "user",
          text: "What should we change?"
        }
      },
      {
        assistant: null,
        messages: [
          {
            at: "2026-05-16T01:02:03.456Z",
            role: "user",
            text: "Keep it simple."
          }
        ],
        thinking: [],
        turnId: "000002",
        user: {
          at: "2026-05-16T01:02:03.456Z",
          role: "user",
          text: "Keep it simple."
        }
      },
      {
        assistant: null,
        messages: [
          {
            at: "2026-05-16T01:02:03.456Z",
            role: "system",
            text: "Session clone created."
          }
        ],
        system: {
          at: "2026-05-16T01:02:03.456Z",
          role: "system",
          text: "Session clone created."
        },
        thinking: [],
        turnId: "000003",
        user: null
      }
    ]);
  });
});

test("vibe64 session store durably deduplicates provider messages by message id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "conversation_message_ids"
    });
    await store.writeConversationUserMessage("conversation_message_ids", {
      text: "Keep following the goal."
    });

    const first = await store.writeConversationThinkingMessage("conversation_message_ids", {
      messageId: "codex-progress-abc123",
      text: "Inspecting the active goal."
    });
    const duplicate = await store.writeConversationThinkingMessage("conversation_message_ids", {
      messageId: "codex-progress-abc123",
      text: "This duplicate must not replace the first message."
    });

    assert.equal(first.turnId, "000001");
    assert.equal(duplicate, null);
    const paths = resolveTestSessionPaths({
      sessionId: "conversation_message_ids",
      targetRoot
    });
    assert.deepEqual(
      (await readdir(path.join(paths.conversationLogRoot, "000001")))
        .filter((fileName) => fileName.startsWith("thinking.")),
      ["thinking.20260516T010203456Z.codex-progress-abc123.md"]
    );
    assert.deepEqual(
      (await store.readConversationLog("conversation_message_ids"))[0].thinking,
      [{
        at: "2026-05-16T01:02:03.456Z",
        messageId: "codex-progress-abc123",
        role: "thinking",
        text: "Inspecting the active goal."
      }]
    );
  });
});

test("vibe64 session store updates one durable assistant response bundle in place", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "conversation_response_bundle"
    });

    await store.writeConversationUserMessage("conversation_response_bundle", {
      text: "Answer, including any steering updates."
    });
    const initial = await store.writeConversationAssistantMessage("conversation_response_bundle", {
      text: "Initial answer."
    });
    const updated = await store.upsertConversationAssistantMessage("conversation_response_bundle", {
      text: "Initial answer.\n\nLate steering answer.",
      turnId: initial.turnId
    });

    const paths = resolveTestSessionPaths({
      sessionId: "conversation_response_bundle",
      targetRoot
    });
    const assistantFiles = (await readdir(path.join(paths.conversationLogRoot, initial.turnId)))
      .filter((name) => name.startsWith("assistant."));
    assert.equal(assistantFiles.length, 1);
    assert.equal(updated.assistant?.text, "Initial answer.\n\nLate steering answer.");
    assert.equal(
      (await store.readConversationLog("conversation_response_bundle"))[0].assistant?.text,
      "Initial answer.\n\nLate steering answer."
    );
  });
});

test("vibe64 session store reads conversation log pages by turn cursor", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "conversation_log_page"
    });

    for (let index = 1; index <= 7; index += 1) {
      await store.writeConversationUserMessage("conversation_log_page", {
        text: `User turn ${index}`
      });
      await store.writeConversationAssistantMessage("conversation_log_page", {
        text: `Assistant turn ${index}`
      });
    }

    const latestPage = await store.readConversationLogPage("conversation_log_page", {
      limit: 3
    });
    assert.deepEqual(latestPage.conversationLog.map((turn) => turn.turnId), [
      "000005",
      "000006",
      "000007"
    ]);
    assert.deepEqual(latestPage.pagination, {
      beforeTurnId: "",
      count: 3,
      hasMoreBefore: true,
      limit: 3,
      newestTurnId: "000007",
      nextBeforeTurnId: "000005",
      oldestTurnId: "000005",
      totalTurnCount: 7
    });

    const middlePage = await store.readConversationLogPage("conversation_log_page", {
      beforeTurnId: latestPage.pagination.nextBeforeTurnId,
      limit: 3
    });
    assert.deepEqual(middlePage.conversationLog.map((turn) => turn.turnId), [
      "000002",
      "000003",
      "000004"
    ]);
    assert.deepEqual(middlePage.pagination, {
      beforeTurnId: "000005",
      count: 3,
      hasMoreBefore: true,
      limit: 3,
      newestTurnId: "000004",
      nextBeforeTurnId: "000002",
      oldestTurnId: "000002",
      totalTurnCount: 7
    });

    const oldestPage = await store.readConversationLogPage("conversation_log_page", {
      beforeTurnId: middlePage.pagination.nextBeforeTurnId,
      limit: 3
    });
    assert.deepEqual(oldestPage.conversationLog.map((turn) => turn.turnId), [
      "000001"
    ]);
    assert.deepEqual(oldestPage.pagination, {
      beforeTurnId: "000002",
      count: 1,
      hasMoreBefore: false,
      limit: 3,
      newestTurnId: "000001",
      nextBeforeTurnId: "",
      oldestTurnId: "000001",
      totalTurnCount: 7
    });
  });
});

test("vibe64 session store updates streaming thinking on the open user turn", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "streaming_thinking"
    });

    assert.equal(
      await store.writeConversationThinkingMessage("streaming_thinking", {
        requireOpenTurn: true,
        text: "No user turn exists yet."
      }),
      null
    );
    assert.deepEqual(await store.readConversationLog("streaming_thinking"), []);

    await store.writeConversationUserMessage("streaming_thinking", {
      text: "What did you check?"
    });
    await store.writeConversationThinkingMessage("streaming_thinking", {
      at: "2026-05-16T01:02:04.000Z",
      requireOpenTurn: true,
      text: "Checked package metadata."
    });
    await store.writeConversationThinkingMessage("streaming_thinking", {
      at: "2026-05-16T01:02:04.000Z",
      requireOpenTurn: true,
      text: "Checked package metadata and routes."
    });

    const paths = resolveTestSessionPaths({
      sessionId: "streaming_thinking",
      targetRoot
    });
    assert.deepEqual((await readdir(path.join(paths.conversationLogRoot, "000001"))).sort(), [
      "thinking.20260516T010204000Z.md",
      "user.20260516T010203456Z.md"
    ]);
    assert.equal(
      await readFile(path.join(paths.conversationLogRoot, "000001", "thinking.20260516T010204000Z.md"), "utf8"),
      "Checked package metadata and routes.\n"
    );
  });
});

test("vibe64 session store updates streaming thinking without an open user turn", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "workflow_thinking"
    });

    await store.writeConversationSystemMessage("workflow_thinking", {
      text: "Execute seed plan."
    });
    const first = await store.writeConversationThinkingMessage("workflow_thinking", {
      at: "2026-05-16T01:02:04.000Z",
      text: "Installing dependencies."
    });
    const second = await store.writeConversationThinkingMessage("workflow_thinking", {
      at: "2026-05-16T01:02:04.000Z",
      text: "Installing dependencies and running tests."
    });

    assert.equal(first.turnId, "000002");
    assert.equal(second.turnId, "000002");
    const paths = resolveTestSessionPaths({
      sessionId: "workflow_thinking",
      targetRoot
    });
    assert.deepEqual((await readdir(path.join(paths.conversationLogRoot, "000002"))).sort(), [
      "thinking.20260516T010204000Z.md"
    ]);
    assert.equal(
      await readFile(path.join(paths.conversationLogRoot, "000002", "thinking.20260516T010204000Z.md"), "utf8"),
      "Installing dependencies and running tests.\n"
    );
  });
});

test("vibe64 session store does not backfill stale open user turns", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "stale_open_turn"
    });

    await store.writeConversationUserMessage("stale_open_turn", {
      text: "This first send failed before Codex accepted it."
    });
    await store.writeConversationSystemMessage("stale_open_turn", {
      text: "Execute plan."
    });

    assert.equal(
      await store.writeConversationThinkingMessage("stale_open_turn", {
        requireOpenTurn: true,
        text: "This should not attach to the failed send."
      }),
      null
    );
    await store.writeConversationAssistantMessage("stale_open_turn", {
      text: "Implementation finished."
    });

    const conversationLog = await store.readConversationLog("stale_open_turn");
    assert.equal(conversationLog.length, 3);
    assert.equal(conversationLog[0].user?.text, "This first send failed before Codex accepted it.");
    assert.equal(conversationLog[0].assistant, null);
    assert.deepEqual(conversationLog[0].thinking, []);
    assert.equal(conversationLog[1].system?.text, "Execute plan.");
    assert.equal(conversationLog[2].assistant?.text, "Implementation finished.");
    assert.equal(conversationLog[2].user, null);
  });
});

test("vibe64 session store serializes per-session mutations and bumps revision once per committed boundary", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const storeA = createTestSessionStore({
      targetRoot
    });
    const storeB = createTestSessionStore({
      targetRoot
    });
    const created = await storeA.createSession({
      sessionId: "serialized_mutation"
    });
    const events = [];
    let releaseFirst = () => null;

    const first = storeA.mutateSession("serialized_mutation", async () => {
      events.push("first-start");
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
      await storeA.writeMetadataValue("serialized_mutation", "first", "done");
      events.push("first-end");
    });
    for (let attempt = 0; attempt < 100 && events.length === 0; attempt += 1) {
      await delay(5);
    }
    const second = storeB.mutateSession("serialized_mutation", async () => {
      events.push("second-start");
      await storeB.writeMetadataValue("serialized_mutation", "second", "done");
      events.push("second-end");
    });
    await delay(5);

    assert.deepEqual(events, ["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);

    const session = await storeA.readSession("serialized_mutation");
    assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
    assert.equal(session.metadata.first, "done");
    assert.equal(session.metadata.second, "done");
    assert.equal(created.revision, 1);
    assert.equal(session.revision, 3);
    assert.equal(session.manifest.revision, 3);
    assert.equal(created.stepRevision, 1);
    assert.equal(session.stepRevision, 1);
    assert.equal(session.manifest.stepRevision, 1);
    assert.equal(Boolean(session.updatedAt), true);
  });
});

test("vibe64 session mutation boundaries retain detached nested writes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const storeA = createTestSessionStore({
      targetRoot
    });
    const storeB = createTestSessionStore({
      targetRoot
    });
    await storeA.createSession({
      sessionId: "detached_nested_mutation"
    });
    const events = [];
    let releaseChild = () => null;
    let markChildStarted = () => null;
    const childStarted = new Promise((resolve) => {
      markChildStarted = resolve;
    });
    const childGate = new Promise((resolve) => {
      releaseChild = resolve;
    });
    let child = null;

    const outer = storeA.mutateSession("detached_nested_mutation", async () => {
      child = storeA.mutateSession("detached_nested_mutation", async () => {
        events.push("child-start");
        markChildStarted();
        await childGate;
        await storeA.writeMetadataValue("detached_nested_mutation", "child", "done");
        events.push("child-end");
      });
      await childStarted;
    });
    await childStarted;
    const competing = storeB.mutateSession("detached_nested_mutation", async () => {
      events.push("competing-start");
      await storeB.writeMetadataValue("detached_nested_mutation", "competing", "done");
    });
    await delay(20);
    assert.deepEqual(events, ["child-start"]);

    releaseChild();
    await Promise.all([outer, child, competing]);

    const session = await storeA.readSession("detached_nested_mutation");
    assert.deepEqual(events, ["child-start", "child-end", "competing-start"]);
    assert.equal(session.metadata.child, "done");
    assert.equal(session.metadata.competing, "done");
    assert.equal(session.revision, 3);
  });
});

test("vibe64 session store serializes mutations across Node processes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    await store.createSession({
      sessionId: "cross_process_mutation"
    });
    const projectStateRoot = projectLocalRoot(targetRoot);
    const firstEnteredPath = path.join(targetRoot, "first-entered");
    const secondEnteredPath = path.join(targetRoot, "second-entered");
    const workers = [];

    try {
      const first = startSessionStoreMutationWorker([
        projectStateRoot,
        targetRoot,
        "cross_process_mutation",
        "first_process",
        firstEnteredPath,
        "hold"
      ]);
      workers.push(first);
      await waitForSessionStoreMutationWorkerMessage(first, "entered");
      await assertPathExists(firstEnteredPath);

      const second = startSessionStoreMutationWorker([
        projectStateRoot,
        targetRoot,
        "cross_process_mutation",
        "second_process",
        secondEnteredPath,
        "run"
      ]);
      workers.push(second);
      await waitForSessionStoreMutationWorkerMessage(second, "mutation-requested");
      await assertPathMissing(secondEnteredPath);

      await sendSessionStoreMutationWorkerMessage(first, {
        type: "release"
      });
      await Promise.all(workers.map((worker) => worker.completed));
      await assertPathExists(secondEnteredPath);
      const session = await store.readSession("cross_process_mutation");
      assert.equal(session.metadata.first_process, "done");
      assert.equal(session.metadata.second_process, "done");
      assert.equal(session.revision, 3);
    } finally {
      for (const worker of workers) {
        if (worker.child.exitCode == null && worker.child.signalCode == null) {
          worker.child.kill();
        }
      }
      await Promise.allSettled(workers.map((worker) => worker.completed));
    }
  });
});

test("vibe64 session exclusivity remains held for detached work started inside the lease", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const storeA = createTestSessionStore({
      targetRoot
    });
    const storeB = createTestSessionStore({
      targetRoot
    });
    await storeA.createSession({
      sessionId: "detached_exclusive_work"
    });
    let releaseChild = () => null;
    let markChildStarted = () => null;
    const childStarted = new Promise((resolve) => {
      markChildStarted = resolve;
    });
    const childGate = new Promise((resolve) => {
      releaseChild = resolve;
    });
    let child = null;

    const outer = storeA.runSessionExclusive(
      "detached_exclusive_work",
      "delivery",
      async () => {
        child = storeA.runSessionExclusive(
          "detached_exclusive_work",
          "delivery",
          async () => {
            markChildStarted();
            await childGate;
          }
        );
        await childStarted;
      }
    );
    await childStarted;

    assert.deepEqual(
      await storeB.runSessionExclusive(
        "detached_exclusive_work",
        "delivery",
        async () => "must-not-run"
      ),
      {
        acquired: false,
        value: null
      }
    );

    releaseChild();
    await Promise.all([outer, child]);
    assert.deepEqual(
      await storeB.runSessionExclusive(
        "detached_exclusive_work",
        "delivery",
        async () => "claimed"
      ),
      {
        acquired: true,
        value: "claimed"
      }
    );
  });
});

test("vibe64 session store exposes the explicit issue word as the session name", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    await store.createSession({
      sessionId: "named_session"
    });

    await store.writeArtifact("named_session", "issue_word", "#Booking\n");

    const namedFromArtifact = await store.readSession("named_session");
    assert.equal(namedFromArtifact.sessionName, "Booking");
    assert.equal(namedFromArtifact.metadata.issue_word, undefined);
    assert.equal(await store.readMetadataValue("named_session", "issue_word"), "");

    await store.writeIssueWordMetadata("named_session", "API Auth");

    const namedFromMetadata = await store.readSession("named_session");
    assert.equal(namedFromMetadata.sessionName, "API");
    assert.equal(namedFromMetadata.metadata.issue_word, "API");

    await store.writeSessionLabel("named_session", "app-server restart");

    const namedFromSessionLabel = await store.readSession("named_session");
    assert.equal(namedFromSessionLabel.sessionName, "app-server");
    assert.equal(namedFromSessionLabel.metadata.issue_word, "app-server");
    assert.equal(namedFromSessionLabel.metadata.work_word, "app-server");
    assert.equal(await store.readArtifact("named_session", "issue_word"), "app-server\n");
    assert.equal(await store.readArtifact("named_session", "work_word"), "app-server\n");
  });
});

test("vibe64 session store persists a prompt context snapshot", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    await store.createSession({
      sessionId: "prompt_context_snapshot"
    });

    const paths = resolveTestSessionPaths({
      sessionId: "prompt_context_snapshot",
      targetRoot
    });
    const snapshot = await store.writePromptContextSnapshot("prompt_context_snapshot", {
      adapter: {
        id: "fake",
        label: "Fake adapter",
        managedServices: [
          {
            id: "database",
            kind: "mysql"
          }
        ],
        promptContext: {
          database_contract: "Use the managed database."
        }
      },
      createdAt: "2026-05-16T01:02:03.000Z",
      schemaVersion: 1
    });

    assert.deepEqual(await store.readPromptContextSnapshot("prompt_context_snapshot"), snapshot);
    assert.deepEqual((await store.readSession("prompt_context_snapshot")).promptContextSnapshot, snapshot);
    assert.equal(
      await readFile(paths.promptContextSnapshotPath, "utf8"),
      `${JSON.stringify(snapshot, null, 2)}\n`
    );
  });
});

test("vibe64 session store allocates deterministic available ids and lists sessions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const first = await store.createSession();
    const second = await store.createSession();
    const sessions = await store.listSessions();

    assert.equal(first.sessionId, "2026-05-16_01-02-03");
    assert.equal(second.sessionId, "2026-05-16_01-02-03_2");
    assert.deepEqual(sessions.map((session) => session.sessionId), [
      "2026-05-16_01-02-03",
      "2026-05-16_01-02-03_2"
    ]);
  });
});

test("vibe64 session store filters session lists by status before full reads", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });

    await store.createSession({
      sessionId: "active_session"
    });
    await store.createSession({
      sessionId: "blocked_session"
    });
    await store.createSession({
      sessionId: "abandoned_session"
    });
    await store.createSession({
      sessionId: "finished_session"
    });
    await store.writeStatus("blocked_session", VIBE64_SESSION_STATUS.BLOCKED);
    await store.writeStatus("abandoned_session", VIBE64_SESSION_STATUS.ABANDONED);
    await store.writeStatus("finished_session", VIBE64_SESSION_STATUS.FINISHED);

    const openSessions = await store.listSessions({
      statusGroup: "open"
    });
    const closedSessions = await store.listSessions({
      statusGroup: "closed"
    });
    const abandonedSessions = await store.listSessions({
      statusGroup: "closed",
      statuses: [VIBE64_SESSION_STATUS.ABANDONED]
    });

    assert.deepEqual(openSessions.map((session) => session.sessionId), [
      "active_session",
      "blocked_session"
    ]);
    assert.deepEqual(closedSessions.map((session) => session.sessionId), [
      "abandoned_session",
      "finished_session"
    ]);
    assert.deepEqual(abandonedSessions.map((session) => session.sessionId), [
      "abandoned_session"
    ]);
  });
});

test("vibe64 session store compacts closed sessions into closed status archives", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    await store.createSession({
      metadata: {
        workflow_definition: "coding"
      },
      sessionId: "closed_session"
    });
    await store.writeArtifact("closed_session", "summary.txt", "Archived hello.\n");
    await store.writeConversationUserMessage("closed_session", {
      text: "Please remember this."
    });
    await store.writeConversationAssistantMessage("closed_session", {
      text: "Stored in the archive."
    });
    await store.writeStatus("closed_session", VIBE64_SESSION_STATUS.ABANDONED);

    const paths = resolveTestSessionPaths({
      sessionId: "closed_session",
      targetRoot
    });
    const archivePath = path.join(projectLocalRoot(targetRoot), "sessions", "closed", "abandoned", "closed_session.tar.gz");
    const metadataPath = path.join(projectLocalRoot(targetRoot), "sessions", "closed", "abandoned", "closed_session.json");

    await store.updateCurrentSession("closed_session");

    await store.compactClosedSession("closed_session");

    await assertPathMissing(paths.sessionRoot);
    await assertPathMissing(paths.currentSessionAliasPath);
    await assertPathExists(archivePath);
    await assertPathExists(metadataPath);

    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const metadataText = await readFile(metadataPath, "utf8");
    assert.equal(metadata.kind, "vibe64.closed_session_archive");
    assert.equal(metadata.sessionId, "closed_session");
    assert.equal(metadata.status, VIBE64_SESSION_STATUS.ABANDONED);
    assert.equal(Object.hasOwn(metadata, "summary"), false);
    assert.equal(metadata.index.sessionId, "closed_session");
    assert.equal(metadata.index.status, VIBE64_SESSION_STATUS.ABANDONED);
    assert.equal(metadata.index.sessionRoot, "");
    assert.equal(metadata.index.metadata.workflow_definition, "coding");
    assert.equal(Object.hasOwn(metadata.index, "completedSteps"), false);
    assert.equal(Object.hasOwn(metadata.index, "stepMachine"), false);
    assert.equal(metadataText.includes("Please remember this."), false);
    assert.equal(metadataText.includes("Stored in the archive."), false);

    const closedSummaries = await store.listSessionSummaries({
      statusGroup: "closed"
    });
    assert.deepEqual(closedSummaries.map((session) => session.sessionId), ["closed_session"]);
    assert.equal(closedSummaries[0].archived, true);
    assert.equal(closedSummaries[0].archivePath, archivePath);
    assert.equal(closedSummaries[0].sessionRoot, "");

    assert.equal(await store.readArtifact("closed_session", "summary.txt"), "Archived hello.\n");
    assert.deepEqual((await store.readConversationLog("closed_session")).map((turn) => ({
      assistant: turn.assistant?.text,
      user: turn.user?.text
    })), [
      {
        assistant: "Stored in the archive.",
        user: "Please remember this."
      }
    ]);

    const archivedSession = await store.readSession("closed_session");
    assert.equal(archivedSession.archived, true);
    assert.equal(archivedSession.archivePath, archivePath);
    assert.equal(archivedSession.sessionRoot, "");
    assert.equal(archivedSession.artifactsRoot, "");
  });
});

test("vibe64 session store keeps the current alias when compacting another session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });
    await store.createSession({
      sessionId: "current_session"
    });
    await store.createSession({
      sessionId: "closed_session"
    });
    await store.updateCurrentSession("current_session");
    await store.writeStatus("closed_session", VIBE64_SESSION_STATUS.FINISHED);

    await store.compactClosedSession("closed_session");

    const paths = resolveTestSessionPaths({
      targetRoot
    });
    assert.equal(await readlink(paths.currentSessionAliasPath), path.join("active", "current_session"));
  });
});

test("vibe64 session store never reuses ids from closed archives", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let tick = 0;
    const store = createTestSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const first = await store.createSession();
    await store.writeStatus(first.sessionId, VIBE64_SESSION_STATUS.FINISHED);
    await store.compactClosedSession(first.sessionId);

    await assert.rejects(
      () => store.createSession({
        sessionId: first.sessionId
      }),
      /Vibe64 session already exists/u
    );

    const second = await store.createSession({
      metadata: {
        tick: String(tick += 1)
      }
    });
    assert.equal(second.sessionId, "2026-05-16_01-02-03_2");
  });
});

test("vibe64 runtime delegates session operations to the store", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const created = await runtime.createSession({
      sessionId: "runtime_session"
    });
    const loaded = await runtime.getSession("runtime_session");
    const sessions = await runtime.listSessions();

    assert.equal(created.sessionId, "runtime_session");
    assert.equal(loaded.sessionId, "runtime_session");
    assert.deepEqual(sessions.map((session) => session.sessionId), ["runtime_session"]);
  });
});

test("vibe64 session ids, artifact paths, and metadata names reject unsafe values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });

    assert.equal(isValidVibe64SessionId("safe_123"), true);
    assert.equal(isValidVibe64SessionId("../unsafe"), false);
    await assert.rejects(
      () => store.createSession({
        sessionId: "../unsafe"
      }),
      /Invalid vibe64 session id/u
    );

    await store.createSession({
      sessionId: "safe_123"
    });
    await assert.rejects(
      () => store.writeArtifact("safe_123", "../outside.txt", "bad"),
      /Invalid vibe64 artifact path/u
    );
    await assert.rejects(
      () => store.writeArtifact("safe_123", "tmp/../outside.txt", "bad"),
      /Invalid vibe64 artifact path/u
    );
    await assert.rejects(
      () => store.writeArtifact("safe_123", "tmp//issue.md", "bad"),
      /Invalid vibe64 artifact path/u
    );

    const nestedPath = await store.writeArtifact("safe_123", "tmp/create_issue.title.txt", "Title\n");
    const session = await store.readSession("safe_123");
    assert.equal(nestedPath, path.join(projectLocalRoot(targetRoot), "sessions", "active", "safe_123", "artifacts", "tmp", "create_issue.title.txt"));
    assert.equal(await store.readArtifact("safe_123", "tmp/create_issue.title.txt"), "Title\n");
    assert.equal(session.artifactReadiness["tmp/create_issue.title.txt"].nonEmpty, true);

    await assert.rejects(
      () => store.writeMetadataValue("safe_123", "../outside", "bad"),
      /Invalid vibe64 metadata name/u
    );
  });
});

test("vibe64 session store rejects invalid statuses before creating a session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createTestSessionStore({
      targetRoot
    });

    await assert.rejects(
      () => store.createSession({
        sessionId: "bad_status",
        status: "confused"
      }),
      /Invalid vibe64 session status/u
    );
    await assert.rejects(
      () => store.readSession("bad_status"),
      /Unknown vibe64 session/u
    );
  });
});
