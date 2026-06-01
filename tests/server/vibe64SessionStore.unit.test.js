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

test("vibe64 session store creates inspectable session state under .vibe64", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const session = await store.createSession({
      metadata: {
        adapter: "fake"
      },
      sessionId: "store_session"
    });

    const paths = resolveVibe64SessionPaths({
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
    await assertPathExists(paths.artifactsRoot);
    await assertPathExists(paths.backgroundTasksRoot);
    await assertPathExists(paths.commandLifecyclesRoot);

    assert.equal(await readFile(paths.currentStepPath, "utf8"), "session_created\n");
    assert.equal(await readFile(paths.statusPath, "utf8"), "active\n");
  });
});

test("vibe64 session store reads and writes metadata, artifacts, status, current step, and command logs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
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
    assert.deepEqual(await store.readStepState("state_contract", "install_dependencies"), {
      at: "2026-05-16T01:02:03.000Z",
      status: "attempting_execution",
      stepId: "install_dependencies"
    });
    assert.equal(await store.readMetadataValue("state_contract", "adapter"), "cpp-cmake");
    assert.equal(await store.readArtifact("state_contract", "summary.txt"), "hello\n");
    assert.equal(await store.artifactExists("state_contract", "summary.txt"), true);
    assert.match(artifactPath, /\.vibe64\/sessions\/active\/state_contract\/artifacts\/summary\.txt$/u);
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
      status: summary.status
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
      status: "blocked"
    });
  });
});

test("vibe64 session store persists background task status with retry metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "background_task_status"
    });

    await store.writeBackgroundTaskEvent("background_task_status", "codex_bootstrap", {
      event: {
        kind: "started"
      },
      patch: {
        kind: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "Preparing Codex.",
        status: "running"
      }
    });
    await store.writeBackgroundTaskEvent("background_task_status", "codex_bootstrap", {
      event: {
        kind: "failed"
      },
      patch: {
        error: "Create the session worktree before starting Codex.",
        message: "Codex bootstrap failed.",
        retry: {
          clientAction: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL,
          label: "Retry Codex"
        },
        status: "failed"
      }
    });

    const task = await store.readBackgroundTask("background_task_status", "codex_bootstrap");
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
      id: "codex_bootstrap",
      label: "Codex bootstrap",
      retry: {
        clientAction: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL,
        label: "Retry Codex"
      },
      status: "failed"
    });
    assert.deepEqual((await store.readSession("background_task_status")).backgroundTasks.map((entry) => entry.id), [
      "codex_bootstrap"
    ]);
  });
});

test("vibe64 session store assigns stable ids to Codex prompt handoffs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
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
    const store = createVibe64SessionStore({
      clock: () => new Date("2026-05-16T01:02:03.456Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "conversation_log"
    });

    await store.writeConversationUserMessage("conversation_log", {
      text: "What should we change?"
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

    const paths = resolveVibe64SessionPaths({
      sessionId: "conversation_log",
      targetRoot
    });
    const turnIds = await readdir(paths.conversationLogRoot);

    assert.deepEqual(turnIds.sort(), ["000001", "000002", "000003"]);
    assert.deepEqual((await readdir(path.join(paths.conversationLogRoot, "000001"))).sort(), [
      "assistant.20260516T010203456Z.md",
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
            role: "assistant",
            text: "Change the form layout."
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
        turnId: "000003",
        user: null
      }
    ]);
  });
});

test("vibe64 session store serializes per-session mutations and bumps revision once per committed boundary", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const storeA = createVibe64SessionStore({
      targetRoot
    });
    const storeB = createVibe64SessionStore({
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
    const store = createVibe64SessionStore({
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
  });
});

test("vibe64 session store persists a prompt context snapshot", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
      targetRoot
    });
    await store.createSession({
      sessionId: "prompt_context_snapshot"
    });

    const paths = resolveVibe64SessionPaths({
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
    const store = createVibe64SessionStore({
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
    const store = createVibe64SessionStore({
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
    const store = createVibe64SessionStore({
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
    assert.match(nestedPath, /\.vibe64\/sessions\/active\/safe_123\/artifacts\/tmp\/create_issue\.title\.txt$/u);
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
    const store = createVibe64SessionStore({
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
