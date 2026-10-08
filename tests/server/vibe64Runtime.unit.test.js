import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_SESSION_STATUS,
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  WORKSPACE_SETUP_METADATA_NAME,
  writeWorkspaceSetupState
} from "@local/vibe64-runtime/server/workspaceSetupState";
import {
  renderTestGenesisPrompt,
  managedSessionSourceRoot,
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

test("session runtime never derives private state from a project context path", () => {
  assert.throws(
    () => new Vibe64SessionRuntime({
      projectContextRoot: "/var/lib/vibe64/merc/projects/example"
    }),
    (error) => error?.code === "vibe64_project_runtime_root_required"
  );
});

test("reading session state never resolves prompt environment and prompt rendering shares its lazy resolution", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let environmentReads = 0;
    const environment = { PLATFORM_VALUE: "platform" };
    const runtime = new Vibe64SessionRuntime({
      inspectSourceByDefault: false,
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      promptEnvironment: async () => {
        environmentReads += 1;
        return environment;
      },
      promptRenderer: async ({ environment: resolved }) => {
        assert.equal(resolved, environment);
        return { prompt: "Composed" };
      }
    });
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "lazy-environment"),
      runtimeKind: "genesis",
      sessionId: "lazy-environment"
    });
    await mkdir(sourcePath(targetRoot, "lazy-environment"), { recursive: true });
    await runtime.getSession("lazy-environment");
    await runtime.listSessionSummaries({ statusGroup: "open" });
    assert.equal(environmentReads, 0);
    await Promise.all([
      runtime.renderPrompt("lazy-environment", { task: "deslop", request: "Review this commit." }),
      runtime.resolvePromptEnvironment()
    ]);
    assert.equal(environmentReads, 1);
  });
});

test("plain runtime creates a Genesis session and awaits source materialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const calls = [];
    const runtime = new Vibe64SessionRuntime({
      createSessionSource: async ({ session, store, vibe64User }) => {
        calls.push({
          sessionId: session.sessionId,
          vibe64User
        });
        const metadata = sourceMetadata(targetRoot, session.sessionId);
        await mkdir(metadata.source_path, {
          recursive: true
        });
        await Promise.all(Object.entries(metadata).map(([name, value]) => (
          store.writeMetadataValue(session.sessionId, name, value)
        )));
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });

    const created = await runtime.createSession({
      sessionId: "plain-session",
      sourceContext: {
        vibe64User: {
          username: "ada"
        }
      }
    });

    assert.deepEqual(calls, [{
      sessionId: "plain-session",
      vibe64User: {
        username: "ada"
      }
    }]);
    assert.equal(created.companion.id, "genesis");
    assert.equal(created.sourcePath, sourcePath(targetRoot, "plain-session"));
    assert.equal(created.sourceReady, true);
    assert.equal(Object.hasOwn(created, "standaloneSourceRoot"), false);
    assert.equal(Object.hasOwn(created, "targetRoot"), false);
    assert.deepEqual(created.workspaceSetup, {
      currentLabel: "",
      diagnostic: "",
      finishedAt: "",
      recipeHash: "",
      startedAt: "",
      status: "unconfigured",
      transcript: "",
      updatedAt: ""
    });
    assert.equal(Object.hasOwn(created, "actions"), false);
    assert.equal(Object.hasOwn(created, "agentTask"), false);
    assert.equal(Object.hasOwn(created, "artifactReadiness"), false);
    assert.equal(Object.hasOwn(created, "artifactsRoot"), false);
    assert.equal(Object.hasOwn(created, "commandLifecycles"), false);
    assert.equal(Object.hasOwn(created, "currentStep"), false);
    assert.equal(Object.hasOwn(created, "reportPath"), false);
    assert.equal(Object.hasOwn(created, "workflow"), false);
  });
});

test("plain runtime rejects a standalone authority folder presented as session source", async () => {
  await withTemporaryRoot(async (standaloneSourceRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: standaloneSourceRoot,
      projectRuntimeRoot: projectRuntimeRoot(standaloneSourceRoot)
    });
    await assert.rejects(runtime.createSession({
      metadata: {
        repository_mode: "local_source",
        source_path: standaloneSourceRoot
      },
      sessionId: "standalone-session"
    }), (error) => error?.code === "vibe64_session_source_creator_required");
  });
});

test("plain runtime exposes compact workspace setup state without leaking its storage field", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.createSession({
      metadata: sourceMetadata(targetRoot, "setup-state-session"),
      sessionId: "setup-state-session"
    });
    await writeWorkspaceSetupState(runtime.store, "setup-state-session", {
      currentLabel: "Install dependencies",
      recipeHash: "sha256:recipe",
      startedAt: "2026-08-15T01:00:00.000Z",
      status: "running",
      updatedAt: "2026-08-15T01:00:00.000Z"
    });

    const session = await runtime.getSession("setup-state-session", {
      inspectSource: false
    });
    assert.equal(session.workspaceSetup.status, "running");
    assert.equal(session.workspaceSetup.currentLabel, "Install dependencies");
    assert.equal(Object.hasOwn(session.metadata, WORKSPACE_SETUP_METADATA_NAME), false);
  });
});

test("plain runtime uses Genesis onboarding for the first user turn, then ordinary work", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      promptRenderer: renderTestGenesisPrompt,
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.createSession({
      metadata: sourceMetadata(targetRoot, "prompt-session"),
      sessionId: "prompt-session"
    });

    const firstPrompt = await runtime.renderPrompt("prompt-session", {
      request: "Add book search.",
      task: "work"
    });

    assert.deepEqual(firstPrompt.context, {
      genesis: true,
      task: "start"
    });
    assert.match(firstPrompt.prompt, /Test Genesis prompt for start/u);

    await runtime.writeConversationUserMessage("prompt-session", {
      text: "Build a book catalogue."
    });
    const nextPrompt = await runtime.renderPrompt("prompt-session", {
      request: "Use JSKIT.",
      task: "work"
    });
    assert.equal(nextPrompt.context.task, "work");
  });
});

test("a delivered renewal handover keeps the successor's first visible prompt in work mode", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      promptRenderer: renderTestGenesisPrompt,
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await Promise.all([
      mkdir(sourcePath(targetRoot, "renewal-seeded"), { recursive: true }),
      mkdir(sourcePath(targetRoot, "renewal-delivered"), { recursive: true }),
      mkdir(sourcePath(targetRoot, "renewal-partial"), { recursive: true })
    ]);
    const renewalMetadata = {
      agent_briefing_delivered: "yes",
      agent_renewal_seed_acknowledged_at: "2026-08-24T01:03:00.000Z",
      agent_renewal_seed_handover_hash: "a".repeat(64),
      agent_renewal_seed_operation_id: "renewal:seed:one",
      agent_renewal_seed_thread_id: "successor-thread",
      agent_renewal_seed_turn_id: "successor-turn",
      renewed_from: "renewal-source",
      renewal_id: "renewal-one"
    };
    await runtime.store.createSession({
      metadata: {
        ...sourceMetadata(targetRoot, "renewal-delivered"),
        renewal_handover_delivered_at: "2026-08-24T01:03:00.000Z",
        renewed_from: "renewal-source",
        renewal_id: "renewal-delivered"
      },
      runtimeKind: "genesis",
      sessionId: "renewal-delivered"
    });
    await runtime.store.createSession({
      metadata: {
        ...sourceMetadata(targetRoot, "renewal-seeded"),
        ...renewalMetadata
      },
      runtimeKind: "genesis",
      sessionId: "renewal-seeded"
    });
    await runtime.store.createSession({
      metadata: {
        ...sourceMetadata(targetRoot, "renewal-partial"),
        ...renewalMetadata,
        agent_renewal_seed_turn_id: ""
      },
      runtimeKind: "genesis",
      sessionId: "renewal-partial"
    });

    const seededPrompt = await runtime.renderPrompt("renewal-seeded", {
      request: "Continue from the approved handover.",
      task: "work"
    });
    const partialPrompt = await runtime.renderPrompt("renewal-partial", {
      request: "Continue from the approved handover.",
      task: "work"
    });
    const deliveredPrompt = await runtime.renderPrompt("renewal-delivered", {
      request: "Continue after the provider is available.",
      task: "work"
    });

    assert.equal(seededPrompt.context.task, "work");
    assert.equal(deliveredPrompt.context.task, "work");
    assert.equal(partialPrompt.context.task, "start");
  });
});

test("plain runtime refuses to return a session without chat-ready source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });

    await assert.rejects(
      () => runtime.createSession({ sessionId: "missing-source" }),
      { code: "vibe64_session_source_creator_required" }
    );
    const blocked = await runtime.store.readSession("missing-source");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.metadata.source_creation_failed, "yes");
    assert.deepEqual(
      (await runtime.listSessionSummaries({ statusGroup: "open" })).map((session) => session.sessionId),
      ["missing-source"]
    );
  });
});

test("prompt rendering never falls back to a project context directory", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let rendered = false;
    await mkdir(path.join(targetRoot, ".git"), {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      promptRenderer() {
        rendered = true;
        return {};
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.store.createSession({
      runtimeKind: "genesis",
      sessionId: "namespace-only"
    });

    await assert.rejects(
      () => runtime.renderPrompt("namespace-only", {
        request: "Inspect this project."
      }),
      { code: "vibe64_session_source_required" }
    );
    assert.equal(rendered, false);
  });
});

test("plain runtime excludes open state records whose managed source no longer exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "ghost-session"),
      runtimeKind: "genesis",
      sessionId: "ghost-session"
    });

    assert.deepEqual(await runtime.listSessionSummaries({ statusGroup: "open" }), []);
    assert.deepEqual(await runtime.listSessions({ statusGroup: "open" }), []);
  });
});

test("session summaries can report unavailable records without hiding healthy sessions or repairing state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    for (const sessionId of ["healthy", "missing", "unsupported", "failed-creation", "archiving"]) {
      await runtime.store.createSession({
        metadata: {
          ...sourceMetadata(targetRoot, sessionId),
          ...(sessionId === "failed-creation" ? { source_creation_failed: "yes" } : {}),
          ...(sessionId === "archiving" ? { session_archive_operation: JSON.stringify({ status: "running" }) } : {})
        },
        runtimeKind: sessionId === "unsupported" ? "obsolete-runtime" : "genesis",
        sessionId
      });
    }
    await mkdir(sourcePath(targetRoot, "healthy"), { recursive: true });
    const before = await runtime.store.readSession("missing");
    const summaries = await runtime.listSessionSummaries({ statusGroup: "open", includeUnavailable: true });
    assert.deepEqual(summaries.filter(s => !s.unavailable).map(s => s.sessionId).sort(), ["archiving", "failed-creation", "healthy"]);
    assert.equal(summaries.find(s => s.sessionId === "missing").unavailable.code, "vibe64_session_source_required");
    assert.equal(summaries.find(s => s.sessionId === "unsupported").unavailable.code, "vibe64_session_runtime_unsupported");
    assert.equal(summaries.find(s => s.sessionId === "missing").sourcePath, sourcePath(targetRoot, "missing"));
    assert.deepEqual(await runtime.store.readSession("missing"), before);
    await assert.rejects(() => access(sourcePath(targetRoot, "missing")), { code: "ENOENT" });
    await assert.rejects(() => runtime.getSession("unsupported"), { code: "vibe64_session_runtime_unsupported" });
    assert.deepEqual((await runtime.listSessions()).map(s => s.sessionId).sort(), ["archiving", "failed-creation", "healthy"]);

    await mkdir(sourcePath(targetRoot, "missing"), { recursive: true });
    const checked = await runtime.listSessionSummaries({ statusGroup: "open", includeUnavailable: true });
    assert.equal(checked.find(s => s.sessionId === "missing").unavailable, undefined);
    assert.equal(checked.find(s => s.sessionId === "unsupported").unavailable.code, "vibe64_session_runtime_unsupported");

    await runtime.store.writeStatus("healthy", "archived");
    await runtime.store.writeStatus("unsupported", "archived");
    const archived = await runtime.listSessionSummaries({ statusGroup: "archived", includeUnavailable: true });
    assert.equal(archived.find(s => s.sessionId === "healthy").unavailable, undefined);
    assert.equal(archived.find(s => s.sessionId === "unsupported").unavailable.code, "vibe64_session_runtime_unsupported");
  });
});

test("plain runtime lists archive summaries without hydrating full session archives", async () => {
  const listOptions = { statusGroup: "archived" };
  let summaryReads = 0;
  const runtime = new Vibe64SessionRuntime({
    store: {
      async listSessions() {
        assert.fail("summary listing must not read full sessions");
      },
      async listSessionSummaries(options) {
        summaryReads += 1;
        assert.deepEqual(options, listOptions);
        return [{
          archived: true,
          archivedAt: "2026-09-04T02:31:35.800Z",
          manifest: {
            createdAt: "2026-08-28T21:30:51.000Z",
            revision: 1,
            runtimeKind: "genesis",
            updatedAt: "2026-09-04T02:31:35.800Z"
          },
          metadata: {},
          revision: 1,
          sessionId: "2026-08-28_21-30-51",
          sessionName: "WHS review",
          status: "archived"
        }];
      }
    }
  });

  const sessions = await runtime.listSessionSummaries(listOptions);

  assert.equal(summaryReads, 1);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "2026-08-28_21-30-51");
  assert.equal(sessions[0].status, "archived");
});

test("a blocked session whose source creation failed can be archived", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const projectSessionSourceRoot = managedSessionSourceRoot(targetRoot);
    const failedSourcePath = sourcePath(targetRoot, "failed-source");
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot,
    });

    await assert.rejects(
      () => runtime.createSession({ sessionId: "failed-source" }),
      { code: "vibe64_session_source_creator_required" }
    );
    await mkdir(failedSourcePath, {
      recursive: true
    });

    const archived = await runtime.archiveSession("failed-source");
    assert.equal(archived.status, "archived");
    assert.equal(archived.archived, true);
    assert.deepEqual(await runtime.listSessions({ statusGroup: "open" }), []);
    await assert.rejects(() => access(failedSourcePath));
  });
});

test("an archive failure after source recovery remains marked for a safe retry", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "recoverable-archive";
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.createSession({
      metadata: sourceMetadata(targetRoot, sessionId),
      sessionId
    });
    runtime.archiveSessionSource = async () => {
      await runtime.store.writeMetadataValue(sessionId, "source_recovery_saved", "yes");
      throw new Error("Worktree removal raced a preview writer.");
    };

    await assert.rejects(
      () => runtime.archiveSession(sessionId),
      /Worktree removal raced a preview writer/u
    );

    const session = await runtime.getSession(sessionId, {
      inspectSource: false
    });
    assert.equal(session.status, "active");
    assert.equal(session.metadata.session_closing_reason, "archived");
    assert.equal(session.metadata.source_recovery_saved, "yes");
  });
});

test("plain runtime hides sessions using an unsupported runtime record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.store.createSession({
      runtimeKind: "obsolete-runtime",
      sessionId: "old-session"
    });

    await assert.rejects(
      () => runtime.getSession("old-session"),
      { code: "vibe64_session_runtime_unsupported" }
    );
    assert.deepEqual(await runtime.listSessions(), []);
  });
});

test("renewal runtime materializes a private successor through the explicit store boundary", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const calls = [];
    const runtime = new Vibe64SessionRuntime({
      createSessionSource: async ({ session, store }) => {
        calls.push(session.sessionId);
        const metadata = sourceMetadata(targetRoot, session.sessionId);
        await mkdir(metadata.source_path, { recursive: true });
        await Promise.all(Object.entries(metadata).map(([name, value]) => (
          store.writeMetadataValue(session.sessionId, name, value)
        )));
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: managedSessionSourceRoot(targetRoot)
    });
    await mkdir(sourcePath(targetRoot, "renewal-source"), { recursive: true });
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "renewal-source"),
      runtimeKind: "genesis",
      sessionId: "renewal-source"
    });
    await runtime.quiesceSessionForRenewal({
      renewalId: "runtime-create-renewal",
      sourceSessionId: "renewal-source"
    });
    await runtime.store.createRenewalPendingSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      renewalId: "runtime-create-renewal",
      renewedFrom: "renewal-source",
      runtimeKind: "genesis",
      sessionId: "renewal-successor",
      startedAt: "2026-08-24T01:00:00.000Z"
    });

    const successor = await runtime.createRenewalSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      renewalId: "runtime-create-renewal",
      renewedFrom: "renewal-source",
      sessionId: "renewal-successor",
      startedAt: "2026-08-24T01:00:00.000Z"
    });

    assert.deepEqual(calls, ["renewal-successor"]);
    assert.equal(successor.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);
    assert.equal(successor.sourcePath, sourcePath(targetRoot, "renewal-successor"));
    assert.equal(
      (await runtime.getSessionForRenewal("renewal-successor", { inspectSource: false })).status,
      VIBE64_SESSION_STATUS.RENEWAL_PENDING
    );
    assert.equal((await runtime.createRenewalSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      renewalId: "runtime-create-renewal",
      renewedFrom: "renewal-source",
      sessionId: "renewal-successor",
      startedAt: "2026-08-24T01:00:00.000Z"
    })).sessionId, "renewal-successor");
    assert.deepEqual(calls, ["renewal-successor"]);
    await assert.rejects(
      () => runtime.createRenewalSession({
        actorDisplayName: "Ada",
        actorId: "ada-owner",
        confirmedAt: "2026-08-24T02:01:00.000Z",
        renewalId: "runtime-create-renewal",
        renewedFrom: "renewal-source",
        sessionId: "renewal-successor",
        startedAt: "2026-08-24T01:00:00.000Z"
      }),
      { code: "vibe64_session_renewal_conflict" }
    );
    await assert.rejects(
      () => runtime.getSession("renewal-successor", { inspectSource: false }),
      { code: "vibe64_session_renewal_private" }
    );
  });
});

test("renewal runtime replaces only an exact partial managed successor clone", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const calls = [];
    const runtime = new Vibe64SessionRuntime({
      createSessionSource: async ({ session, store }) => {
        calls.push(session.sessionId);
        const metadata = sourceMetadata(targetRoot, session.sessionId);
        await mkdir(metadata.source_path, { recursive: true });
        await Promise.all(Object.entries(metadata).map(([name, value]) => (
          store.writeMetadataValueForRenewal(session.sessionId, name, value)
        )));
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: managedSessionSourceRoot(targetRoot)
    });
    await mkdir(sourcePath(targetRoot, "renewal-source"), { recursive: true });
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "renewal-source"),
      runtimeKind: "genesis",
      sessionId: "renewal-source"
    });
    await runtime.quiesceSessionForRenewal({
      renewalId: "runtime-partial-renewal",
      sourceSessionId: "renewal-source"
    });
    await runtime.store.createRenewalPendingSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      renewalId: "runtime-partial-renewal",
      renewedFrom: "renewal-source",
      runtimeKind: "genesis",
      sessionId: "renewal-successor",
      startedAt: "2026-08-24T01:00:00.000Z"
    });
    const partialRoot = path.dirname(sourcePath(targetRoot, "renewal-successor"));
    const siblingRoot = path.dirname(sourcePath(targetRoot, "unrelated-successor"));
    await Promise.all([
      mkdir(path.join(partialRoot, "source", ".git"), { recursive: true }),
      mkdir(path.join(siblingRoot, "source"), { recursive: true })
    ]);

    const successor = await runtime.createRenewalSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      renewalId: "runtime-partial-renewal",
      renewedFrom: "renewal-source",
      sessionId: "renewal-successor",
      startedAt: "2026-08-24T01:00:00.000Z"
    });

    assert.deepEqual(calls, ["renewal-successor"]);
    assert.equal(successor.sourcePath, sourcePath(targetRoot, "renewal-successor"));
    await access(path.join(siblingRoot, "source"));
  });
});

test("failed renewal materialization removes only its private record and managed source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      createSessionSource: async ({ session }) => {
        await mkdir(sourcePath(targetRoot, session.sessionId), { recursive: true });
        throw new Error("clone failed");
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: managedSessionSourceRoot(targetRoot)
    });
    await mkdir(sourcePath(targetRoot, "renewal-source"), { recursive: true });
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "renewal-source"),
      runtimeKind: "genesis",
      sessionId: "renewal-source"
    });
    await runtime.quiesceSessionForRenewal({
      renewalId: "runtime-failed-renewal",
      sourceSessionId: "renewal-source"
    });

    await assert.rejects(
      () => runtime.createRenewalSession({
        actorId: "ada-owner",
        confirmedAt: "2026-08-24T01:01:00.000Z",
        renewalId: "runtime-failed-renewal",
        renewedFrom: "renewal-source",
        sessionId: "renewal-successor"
      }),
      /clone failed/u
    );
    await assert.rejects(
      () => runtime.store.readSessionForRenewal("renewal-successor"),
      { code: "vibe64_session_not_found" }
    );
    await assert.rejects(
      () => access(path.dirname(sourcePath(targetRoot, "renewal-successor"))),
      { code: "ENOENT" }
    );
    assert.equal(
      (await runtime.getSession("renewal-source", { inspectSource: false })).status,
      VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
    );
  });
});

test("renewal retry rejects mismatched durable source ownership without repairing it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let materializationCalls = 0;
    const runtime = new Vibe64SessionRuntime({
      createSessionSource: async () => {
        materializationCalls += 1;
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: managedSessionSourceRoot(targetRoot)
    });
    await mkdir(sourcePath(targetRoot, "renewal-source"), { recursive: true });
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "renewal-source"),
      runtimeKind: "genesis",
      sessionId: "renewal-source"
    });
    await runtime.quiesceSessionForRenewal({
      renewalId: "runtime-mismatched-renewal",
      sourceSessionId: "renewal-source"
    });
    await runtime.store.createRenewalPendingSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      metadata: {
        source_kind: "session_clone",
        source_path: path.join(targetRoot, "wrong", "sessions", "active", "renewal-successor", "source"),
        source_path_authority: "managed_session_source"
      },
      renewalId: "runtime-mismatched-renewal",
      renewedFrom: "renewal-source",
      runtimeKind: "genesis",
      sessionId: "renewal-successor",
      startedAt: "2026-08-24T01:00:00.000Z"
    });

    await assert.rejects(
      () => runtime.createRenewalSession({
        actorDisplayName: "Ada",
        actorId: "ada-owner",
        confirmedAt: "2026-08-24T01:01:00.000Z",
        renewalId: "runtime-mismatched-renewal",
        renewedFrom: "renewal-source",
        sessionId: "renewal-successor",
        startedAt: "2026-08-24T01:00:00.000Z"
      }),
      { code: "vibe64_session_source_not_attached" }
    );
    assert.equal(materializationCalls, 0);
    assert.equal(
      (await runtime.store.readSessionForRenewal("renewal-successor")).metadata.source_path,
      path.join(targetRoot, "wrong", "sessions", "active", "renewal-successor", "source")
    );
  });
});

test("plain runtime cannot expose or use a private renewal successor", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: targetRoot
    });
    await Promise.all([
      mkdir(sourcePath(targetRoot, "renewal-source"), { recursive: true }),
      mkdir(sourcePath(targetRoot, "renewal-successor"), { recursive: true })
    ]);
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "renewal-source"),
      runtimeKind: "genesis",
      sessionId: "renewal-source"
    });
    await runtime.quiesceSessionForRenewal({
      renewalId: "renewal-runtime",
      sourceSessionId: "renewal-source"
    });
    await runtime.store.createRenewalPendingSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      metadata: sourceMetadata(targetRoot, "renewal-successor"),
      renewalId: "renewal-runtime",
      renewedFrom: "renewal-source",
      runtimeKind: "genesis",
      sessionId: "renewal-successor"
    });
    const hidden = await runtime.store.readSessionForRenewal("renewal-successor");
    assert.equal(hidden.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);

    for (const operation of [
      () => runtime.getSession("renewal-successor", { inspectSource: false }),
      () => runtime.updateCurrentSession("renewal-successor"),
      () => runtime.sessionView(hidden, { inspectSource: false }),
      () => runtime.inspectSourceForSession(hidden),
      () => runtime.assertSourceHealthy(hidden),
      () => runtime.renderPrompt("renewal-successor", { request: "Keep working." }),
      () => runtime.readConversationLog("renewal-successor"),
      () => runtime.readConversationLogPage("renewal-successor"),
      () => runtime.writeConversationUserMessage("renewal-successor", { text: "Hello" }),
      () => runtime.writeConversationAssistantMessage("renewal-successor", { text: "Hello" }),
      () => runtime.writeConversationCommentaryMessage("renewal-successor", { text: "Hello" }),
      () => runtime.writeConversationThinkingMessage("renewal-successor", { text: "Hello" }),
      () => runtime.writeConversationSystemMessage("renewal-successor", { text: "Hello" }),
      () => runtime.readAgentRun("renewal-successor", "codex"),
      () => runtime.writeAgentRunEvent("renewal-successor", "codex", {})
    ]) {
      await assert.rejects(operation, {
        code: "vibe64_session_renewal_private"
      });
    }
    assert.deepEqual(
      (await runtime.listSessions({ statusGroup: "all" })).map((session) => session.sessionId),
      ["renewal-source"]
    );
  });
});

test("archive recovery remains listable after source removal and resumes its recovery path", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "archive-source-removed";
    const runtime = new Vibe64SessionRuntime({
      inspectSourceByDefault: false,
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.store.createSession({
      sessionId,
      runtimeKind: "genesis",
      metadata: {
        ...sourceMetadata(targetRoot, sessionId),
        session_archive_operation: JSON.stringify({ status: "running", phase: "source" }),
        session_closing_reason: "archived",
        source_recovery_saved: "yes",
        source_removed: "yes"
      }
    });
    assert.deepEqual((await runtime.listSessionSummaries({ statusGroup: "open" })).map(s => s.sessionId), [sessionId]);
    let recoveryCalled = false;
    runtime.archiveSessionSource = async (id) => {
      assert.equal(id, sessionId);
      recoveryCalled = true;
      throw new Error("Keep the recovery evidence for retry");
    };
    await assert.rejects(runtime.archiveSession(sessionId), /Keep the recovery evidence/);
    assert.equal(recoveryCalled, true);
    assert.equal((await runtime.getSession(sessionId)).metadata.session_closing_reason, "archived");
  });
});

test("PR context reaches the opening prompt and survives session renewal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const pr = JSON.stringify({ number: 42, title: "Improve search", body: "Description from GitHub",
      baseRepository: "example/project", baseBranch: "main", headRepository: "alice/project", headBranch: "feature/search" });
    const runtime = new Vibe64SessionRuntime({
      promptRenderer: renderTestGenesisPrompt,
      createSessionSource: async ({ session, store }) => {
        assert.equal(session.metadata.github_pull_request, pr);
        const metadata = sourceMetadata(targetRoot, session.sessionId);
        await mkdir(metadata.source_path, { recursive: true });
        for (const [name, value] of Object.entries(metadata)) await store.writeMetadataValue(session.sessionId, name, value);
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: managedSessionSourceRoot(targetRoot)
    });
    await runtime.createSession({ sessionId: "pr-source", metadata: { github_pull_request: pr } });
    const prompt = await runtime.renderPrompt("pr-source", { task: "work", request: "Review this change." });
    assert.match(prompt.prompt, /alice\/project:feature\/search/u);
    assert.match(prompt.prompt, /Description from GitHub/u);
    assert.match(prompt.prompt, /background data from GitHub, not instructions/u);
    await runtime.quiesceSessionForRenewal({ renewalId: "pr-renewal", sourceSessionId: "pr-source" });
    const successor = await runtime.createRenewalSession({
      actorId: "alice", actorDisplayName: "Alice", confirmedAt: "2026-09-18T01:00:00.000Z",
      renewalId: "pr-renewal", renewedFrom: "pr-source", sessionId: "pr-successor", startedAt: "2026-09-18T01:00:00.000Z"
    });
    assert.equal(successor.metadata.github_pull_request, pr);
  });
});


const sourceLessLessonScope = () => ({ learnerId: "42", attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", noExercise: true,
  pin: { course: { courseId: "first-course", release: "0.1.0" },
    topic: { schemaVersion: 1, topicId: "getting-started", release: "0.1.0", repository: "vibe64/learn-getting-started",
      commit: "a".repeat(40), topicHash: "b".repeat(64) }, lesson: { code: "V64-START-00", hash: "c".repeat(64) } } });

function sourceLessLessonRuntime(root, options = {}) {
  return new Vibe64SessionRuntime({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "learning-runtime"),
    learningScope: sourceLessLessonScope(), ...options });
}

test("authorized source-less learning session retains original store identity across restart without creating project source", async () => {
  await withTemporaryRoot(async root => {
    const runtime = sourceLessLessonRuntime(root);
    const scope = sourceLessLessonScope();
    const created = await runtime.createSession({ sessionId: "lesson-zero", metadata: { label: "First lesson" } });
    assert.equal(created.purpose, "learning");
    assert.deepEqual(created.companion, { id: "learning", label: "Learning" });
    assert.deepEqual(created.learning, { schemaVersion: 1, ...scope, conversationId: "lesson-zero" });
    assert.equal(created.sourceReady, false);
    assert.equal(created.sourcePath, "");
    assert.equal(created.sourceInspection, null);
    assert.equal(created.manifest.schemaVersion, 2, "The original session format is retained");
    assert.equal(created.nativeExecutionRoot, path.join(runtime.store.paths("lesson-zero").sessionRoot, "native"));
    assert.equal(await runtime.getNativeExecutionRoot("lesson-zero"), created.nativeExecutionRoot);
    assert.deepEqual((await runtime.listSessions()).map(value => value.sessionId), ["lesson-zero"]);
    assert.equal((await runtime.listSessionSummaries())[0].purpose, "learning");
    await assert.rejects(() => access(path.join(created.sessionRoot, "source")), { code: "ENOENT" });
    const before = await runtime.store.readSession("lesson-zero");
    const restarted = sourceLessLessonRuntime(root);
    assert.deepEqual(await restarted.store.readSession("lesson-zero"), before);
    assert.deepEqual(await restarted.getSession("lesson-zero"), created);
    assert.deepEqual(await restarted.store.readSessionSourceDescriptor("lesson-zero"), {
      metadata: Object.fromEntries(["base_commit", "canonical_commit", "repository_mode", "source", "source_kind", "source_path", "source_path_authority", "source_removed"].map(name => [name, ""])),
      projectContextRoot: root, sessionId: "lesson-zero", sessionRoot: created.sessionRoot
    });
    assert.deepEqual(await restarted.renderPrompt("lesson-zero", { request: "Teach me" }), { prompt: "Teach me" });
    await assert.rejects(() => restarted.getLearningInstructions("lesson-zero"), { code: "vibe64_learning_instructions_unavailable" });
  });
});

test("learning construction cannot be enabled by caller metadata or source provisioning flags", async () => {
  await withTemporaryRoot(async root => {
    const working = new Vibe64SessionRuntime({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root) });
    await assert.rejects(() => working.createSession({ sessionId: "caller-purpose", metadata: { purpose: "learning" } }),
      { code: "vibe64_session_source_creator_required" });
    const learning = sourceLessLessonRuntime(root);
    await assert.rejects(() => learning.createSession({ sessionId: "forged-binding", metadata: { learning_session: "{}" } }),
      { code: "vibe64_learning_scope_invalid" });
    assert.throws(() => sourceLessLessonRuntime(root, { createSessionSource: async () => assert.fail("No source creation") }),
      { code: "vibe64_learning_scope_invalid" });
    assert.throws(() => sourceLessLessonRuntime(root, { projectSessionSourceRoot: managedSessionSourceRoot(root) }),
      { code: "vibe64_learning_scope_invalid" });
    assert.throws(() => sourceLessLessonRuntime(root, { store: working.store }), { code: "vibe64_learning_scope_invalid" });
    for (const patch of [{ noExercise: false }, { learnerId: "" }, { attemptId: "another" }, { mode: "learning" }, { pin: {} }]) {
      assert.throws(() => sourceLessLessonRuntime(root, { learningScope: { ...sourceLessLessonScope(), ...patch } }),
        { code: "vibe64_learning_scope_invalid" });
    }
  });
});

test("missing or aliased learning native directory fails execution and passive reads never recreate it", async () => {
  await withTemporaryRoot(async root => {
    const { rm, symlink } = await import("node:fs/promises");
    const runtime = sourceLessLessonRuntime(root);
    const created = await runtime.createSession({ sessionId: "missing-learning-cwd" });
    const before = await runtime.store.readSession(created.sessionId);
    await rm(created.nativeExecutionRoot, { recursive: true });
    assert.equal((await runtime.getSession(created.sessionId)).sourceReady, false);
    const summaries = await runtime.listSessionSummaries({ includeUnavailable: true });
    assert.equal(summaries[0].unavailable.code, "vibe64_learning_native_directory_unavailable");
    assert.deepEqual(await runtime.listSessions(), []);
    await assert.rejects(() => runtime.getNativeExecutionRoot(created.sessionId), { code: "vibe64_learning_native_directory_unavailable" });
    await assert.rejects(() => access(created.nativeExecutionRoot), { code: "ENOENT" });
    assert.deepEqual(await runtime.store.readSession(created.sessionId), before);
    const foreign = path.join(root, "foreign-directory");
    await mkdir(foreign);
    await symlink(foreign, created.nativeExecutionRoot);
    await assert.rejects(() => runtime.getNativeExecutionRoot(created.sessionId), { code: "vibe64_learning_native_directory_unavailable" });
  });
});

test("archived source-less learning history retains exact binding without requiring or retargeting its active cwd", async () => {
  await withTemporaryRoot(async root => {
    const runtime = sourceLessLessonRuntime(root);
    const created = await runtime.createSession({ sessionId: "archived-learning" });
    await runtime.writeConversationUserMessage(created.sessionId, { messageId: "original-learner-question", text: "Teach me" });
    await runtime.writeConversationAssistantMessage(created.sessionId, { messageId: "original-native-answer", outputId: "native-output", text: "Welcome" });
    const log = await runtime.readConversationLog(created.sessionId);
    const archived = await runtime.archiveSession(created.sessionId);
    assert.equal(archived.archived, true);
    assert.deepEqual(archived.learning, created.learning);
    assert.equal(archived.nativeExecutionRoot, "");
    await assert.rejects(() => access(created.nativeExecutionRoot), { code: "ENOENT" });
    const restarted = sourceLessLessonRuntime(root);
    assert.deepEqual(await restarted.readConversationLog(created.sessionId), log);
    assert.deepEqual((await restarted.getSession(created.sessionId)).learning, created.learning);
    assert.equal((await restarted.listSessionSummaries({ statusGroup: "archived" }))[0].nativeExecutionRoot, "");
    await assert.rejects(() => restarted.getNativeExecutionRoot(created.sessionId), { code: "vibe64_learning_session_inactive" });
  });
});


test("learning instructions use only the fresh exact owner and reject stale, absent or invalid results", async () => {
  await withTemporaryRoot(async root => {
    let result = "Teach this exact pin.";
    let reads = 0;
    const runtime = sourceLessLessonRuntime(root, {
      promptRenderer: async () => assert.fail("Learning never renders Genesis"),
      promptEnvironment: async () => assert.fail("Learning never reads project Env"),
      learningInstructions: async sessionId => { assert.equal(sessionId, "fresh-teaching"); reads += 1; return result; }
    });
    await runtime.createSession({ sessionId: "fresh-teaching" });
    assert.equal(await runtime.getLearningInstructions("fresh-teaching"), result);
    result = "Updated progress on the same pin.";
    assert.equal(await runtime.getLearningInstructions("fresh-teaching"), result);
    assert.equal(reads, 2);
    assert.deepEqual(await runtime.renderPrompt("fresh-teaching", { request: "Can you repeat that?" }), { prompt: "Can you repeat that?" });
    assert.equal(reads, 2, "The actual authored request is separate from native system instructions");
    for (result of [null, "", "a".repeat(128 * 1024 + 1)]) {
      await assert.rejects(() => runtime.getLearningInstructions("fresh-teaching"), { code: "vibe64_learning_instructions_invalid" });
    }
    const late = sourceLessLessonRuntime(root, { learningInstructions: async () => {
      await runtime.store.writeStatus("fresh-teaching", "blocked"); return "Late instructions";
    } });
    await assert.rejects(() => late.getLearningInstructions("fresh-teaching"), { code: "vibe64_learning_session_inactive" });
    await assert.rejects(() => runtime.renderPrompt("fresh-teaching", { request: "Cannot run" }), { code: "vibe64_learning_session_inactive" });
  });
});


test("closing learning session cannot expose execution or instructions or admit another request", async () => {
  await withTemporaryRoot(async root => {
    let instructionsRead = false;
    const runtime = sourceLessLessonRuntime(root, { learningInstructions: async () => { instructionsRead = true; return "Teach"; } });
    await runtime.createSession({ sessionId: "closing-learning" });
    await runtime.markSessionClosing("closing-learning", { reason: "archived" });
    for (const operation of [() => runtime.getNativeExecutionRoot("closing-learning"), () => runtime.getLearningInstructions("closing-learning"),
      () => runtime.renderPrompt("closing-learning", { request: "Continue" })]) {
      await assert.rejects(operation, { code: "vibe64_learning_session_inactive" });
    }
    assert.equal(instructionsRead, false);
    assert.equal((await runtime.getSession("closing-learning")).purpose, "learning", "Retained history remains readable during close");
  });
});


test("source-bearing Learning uses the original source creator, Genesis environment and retained conversation", async () => {
  await withTemporaryRoot(async root => {
    const scope = { ...sourceLessLessonScope(), noExercise: false };
    const environment = { PRACTICE_VALUE: "original environment" };
    let sourceCreates = 0, environmentReads = 0, instructionReads = 0;
    const runtime = new Vibe64SessionRuntime({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root),
      projectSessionSourceRoot: managedSessionSourceRoot(root), learningScope: scope, inspectSourceByDefault: false,
      createSessionSource: async ({ session, store, originalActor }) => {
        assert.equal(originalActor, "learner42"); sourceCreates++;
        const metadata = sourceMetadata(root, session.sessionId);
        await mkdir(metadata.source_path, { recursive: true });
        for (const [name, value] of Object.entries(metadata)) await store.writeMetadataValue(session.sessionId, name, value);
      },
      promptEnvironment: async () => { environmentReads++; return environment; },
      promptRenderer: async ({ projectRoot, environment: actual, action, input }) => {
        assert.equal(projectRoot, sourcePath(root, "practice-learning")); assert.equal(actual, environment);
        assert.equal(action.genesisTask, "start"); assert.equal(input.request, "Explain the exercise.");
        return { prompt: "Original Genesis exercise prompt" };
      },
      learningInstructions: async id => { assert.equal(id, "practice-learning"); instructionReads++; return "Teach this exact practice pin."; }
    });
    const created = await runtime.createSession({ sessionId: "practice-learning", sourceContext: { originalActor: "learner42" } });
    assert.equal(sourceCreates, 1); assert.equal(created.sourceReady, true); assert.equal(created.sourcePath, sourcePath(root, created.sessionId));
    assert.equal(created.nativeExecutionRoot, created.sourcePath); assert.equal(created.purpose, "learning");
    assert.deepEqual(created.learning, { schemaVersion: 1, ...scope, conversationId: created.sessionId });
    assert.equal(await runtime.getNativeExecutionRoot(created.sessionId), created.sourcePath);
    await assert.rejects(access(path.join(created.sessionRoot, "native")), { code: "ENOENT" });
    assert.deepEqual(await runtime.renderPrompt(created.sessionId, { request: "Explain the exercise." }), { prompt: "Original Genesis exercise prompt" });
    assert.equal(environmentReads, 1); assert.equal(instructionReads, 0);
    assert.equal(await runtime.getLearningInstructions(created.sessionId), "Teach this exact practice pin.");
    assert.equal(instructionReads, 1, "Training system instructions remain separate from the original source prompt");
    await runtime.writeConversationUserMessage(created.sessionId, { messageId: "practice-question", text: "Teach this exercise." });
    await runtime.writeConversationAssistantMessage(created.sessionId, { messageId: "practice-answer", text: "Here is the retained explanation." });
    const history = await runtime.readConversationLog(created.sessionId);
    const restarted = new Vibe64SessionRuntime({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root),
      projectSessionSourceRoot: managedSessionSourceRoot(root), learningScope: scope, inspectSourceByDefault: false });
    assert.deepEqual(await restarted.readConversationLog(created.sessionId), history);
    assert.deepEqual((await restarted.getSession(created.sessionId)).learning, created.learning);
    assert.equal((await restarted.listSessionSummaries())[0].nativeExecutionRoot, created.sourcePath);
    await restarted.markSessionClosing(created.sessionId);
    for (const operation of [() => restarted.getNativeExecutionRoot(created.sessionId),
      () => restarted.renderPrompt(created.sessionId, { request: "New work" }), () => restarted.getLearningInstructions(created.sessionId)]) {
      await assert.rejects(operation, { code: "vibe64_learning_session_inactive" });
    }
    assert.equal(await restarted.getNativeExecutionRoot(created.sessionId, { allowClosing: true }), created.sourcePath);
  });
});

test("source-bearing Learning preserves original unattached-source failure and unavailable-source archive refusal", async () => {
  await withTemporaryRoot(async root => {
    const options = { projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root),
      projectSessionSourceRoot: managedSessionSourceRoot(root), learningScope: { ...sourceLessLessonScope(), noExercise: false },
      inspectSourceByDefault: false };
    const unattached = new Vibe64SessionRuntime({ ...options, createSessionSource: async () => {} });
    await assert.rejects(unattached.createSession({ sessionId: "unattached-practice" }), { code: "vibe64_session_source_not_attached" });
    const failed = await unattached.store.readSession("unattached-practice");
    assert.equal(failed.status, "blocked"); assert.equal(failed.metadata.source_creation_failed, "yes");
    assert.equal(JSON.parse(failed.metadata.learning_session).noExercise, false);
    await assert.rejects(access(path.join(failed.sessionRoot, "native")), { code: "ENOENT" });
    const runtime = new Vibe64SessionRuntime({ ...options, sourceInspectionError: new Error("Controlled unavailable inspection") });
    const created = await runtime.createSession({ sessionId: "missing-practice", metadata: sourceMetadata(root, "missing-practice") });
    const summaries = await runtime.listSessionSummaries({ includeUnavailable: true });
    assert.equal(summaries.find(row => row.sessionId === created.sessionId).unavailable.code, "vibe64_session_source_required");
    assert.deepEqual(await runtime.listSessions(), [await runtime.getSession("unattached-practice")]);
    await assert.rejects(runtime.archiveSession(created.sessionId), { code: "vibe64_source_inspection_unavailable" });
    assert.equal((await runtime.store.readSession(created.sessionId)).status, "active");
    assert.equal((await runtime.store.readSession(created.sessionId)).metadata.source_path, sourcePath(root, created.sessionId));
  });
});
