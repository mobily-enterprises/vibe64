import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
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
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

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

function projectLocalRoot(targetRoot) {
  return path.join(targetRoot, ".vibe64-local");
}

function createTestSessionStore({
  targetRoot,
  ...options
} = {}) {
  return createVibe64SessionStore({
    ...options,
    projectLocalRoot: projectLocalRoot(targetRoot),
    targetRoot
  });
}

function resolveTestSessionPaths({
  sessionId = "",
  targetRoot
} = {}) {
  return resolveVibe64SessionPaths({
    sessionId,
    stateRoot: projectLocalRoot(targetRoot),
    targetRoot
  });
}

test("vibe64 session store creates inspectable session state under .vibe64-local", async () => {
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
    await assertPathExists(paths.artifactsRoot);
    await assertPathExists(paths.backgroundTasksRoot);
    await assertPathExists(paths.commandLifecyclesRoot);
    await assertPathExists(paths.privateInputsRoot);

    assert.equal(await readFile(paths.currentStepPath, "utf8"), "session_created\n");
    assert.equal(await readFile(paths.statusPath, "utf8"), "active\n");
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
    assert.match(artifactPath, /\.vibe64-local\/sessions\/active\/state_contract\/artifacts\/summary\.txt$/u);
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
        error: "Create the session worktree before starting Codex.",
        message: "Codex app-server preparation failed.",
        retry: {
          clientAction: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL,
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
      error: "Create the session worktree before starting Codex.",
      eventKinds: ["started", "failed"],
      id: "codex_app_server",
      label: "Codex app-server",
      retry: {
        clientAction: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL,
        label: "Retry Codex"
      },
      status: "failed"
    });
    assert.deepEqual((await store.readSession("background_task_status")).backgroundTasks.map((entry) => entry.id), [
      "codex_app_server"
    ]);
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
      codexPromptHandoff: {
        kind: "codex_prompt_handoff",
        prompt: "Make a plan.",
        promptId: "make_plan",
        terminalInput: "Make a plan."
      },
      status: "prompt_ready",
      stepId: "plan_and_execute"
    });

    assert.equal(actionResult.codexPromptHandoff.handoffId, "000001-make_plan.json:make_plan");
    assert.equal(actionResult.codexPromptHandoff.actionId, "make_plan");
    assert.equal(actionResult.codexPromptHandoff.attemptFile, "000001-make_plan.json");
    assert.equal(actionResult.codexPromptHandoff.attemptNumber, 1);

    const sessionActionResult = await store.readActionResult("prompt_handoff_ids", "make_plan");
    const session = await store.readSession("prompt_handoff_ids");
    assert.equal(
      sessionActionResult.codexPromptHandoff.handoffId,
      "000001-make_plan.json:make_plan"
    );
    assert.equal(
      session.actionAttempts[0].codexPromptHandoff.handoffId,
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
      text: "Worktree created."
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
            text: "Worktree created."
          }
        ],
        system: {
          at: "2026-05-16T01:02:03.456Z",
          role: "system",
          text: "Worktree created."
        },
        thinking: [],
        turnId: "000003",
        user: null
      }
    ]);
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
    await delay(0);
    const second = storeB.mutateSession("serialized_mutation", async () => {
      events.push("second-start");
      await storeB.writeMetadataValue("serialized_mutation", "second", "done");
      events.push("second-end");
    });
    await delay(0);

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

    await store.compactClosedSession("closed_session");

    await assertPathMissing(paths.sessionRoot);
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
    assert.match(nestedPath, /\.vibe64-local\/sessions\/active\/safe_123\/artifacts\/tmp\/create_issue\.title\.txt$/u);
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
