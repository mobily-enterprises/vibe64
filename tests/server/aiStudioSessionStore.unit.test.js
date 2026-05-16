import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  AI_STUDIO_INITIAL_STEP,
  AI_STUDIO_SESSION_STATUS,
  AiStudioSessionRuntime,
  createAiStudioSessionStore,
  isValidAiStudioSessionId,
  resolveAiStudioSessionPaths
} from "../../server/lib/aiStudio/index.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

async function assertPathExists(filePath) {
  await assert.doesNotReject(access(filePath));
}

test("ai-studio session store creates inspectable session state under .ai-studio", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createAiStudioSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const session = await store.createSession({
      metadata: {
        adapter: "fake"
      },
      sessionId: "store_session"
    });

    const paths = resolveAiStudioSessionPaths({
      sessionId: "store_session",
      targetRoot
    });

    assert.equal(session.sessionId, "store_session");
    assert.equal(session.targetRoot, targetRoot);
    assert.equal(session.currentStep, AI_STUDIO_INITIAL_STEP);
    assert.equal(session.status, AI_STUDIO_SESSION_STATUS.ACTIVE);
    assert.equal(session.metadata.adapter, "fake");
    assert.equal(session.manifest.product, "ai-studio");
    assert.equal(session.manifest.schemaVersion, 1);

    await assertPathExists(paths.manifestPath);
    await assertPathExists(paths.currentStepPath);
    await assertPathExists(paths.statusPath);
    await assertPathExists(paths.metadataRoot);
    await assertPathExists(paths.artifactsRoot);

    assert.equal(await readFile(paths.currentStepPath, "utf8"), "session_created\n");
    assert.equal(await readFile(paths.statusPath, "utf8"), "active\n");
  });
});

test("ai-studio session store reads and writes metadata, artifacts, status, current step, and command logs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createAiStudioSessionStore({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await store.createSession({
      sessionId: "state_contract"
    });

    await store.writeStatus("state_contract", "blocked");
    await store.writeCurrentStep("state_contract", "install_dependencies");
    await store.writeMetadataValue("state_contract", "adapter", "cpp-cmake");
    const artifactPath = await store.writeArtifact("state_contract", "notes/summary.txt", "hello\n");
    await store.appendCommandLogEntry("state_contract", {
      actionId: "configure",
      status: "ok"
    });

    const session = await store.readSession("state_contract");
    assert.equal(session.status, "blocked");
    assert.equal(session.currentStep, "install_dependencies");
    assert.equal(session.metadata.adapter, "cpp-cmake");
    assert.equal(await store.readMetadataValue("state_contract", "adapter"), "cpp-cmake");
    assert.equal(await store.readArtifact("state_contract", "notes/summary.txt"), "hello\n");
    assert.equal(await store.artifactExists("state_contract", "notes/summary.txt"), true);
    assert.match(artifactPath, /\.ai-studio\/sessions\/active\/state_contract\/artifacts\/notes\/summary\.txt$/u);

    const commandLog = await store.readCommandLog("state_contract");
    assert.deepEqual(commandLog, [
      {
        actionId: "configure",
        at: "2026-05-16T01:02:03.000Z",
        status: "ok"
      }
    ]);
  });
});

test("ai-studio session store allocates deterministic available ids and lists sessions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createAiStudioSessionStore({
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

test("ai-studio runtime delegates session operations to the store", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
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

test("ai-studio session ids and child paths reject unsafe values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createAiStudioSessionStore({
      targetRoot
    });

    assert.equal(isValidAiStudioSessionId("safe_123"), true);
    assert.equal(isValidAiStudioSessionId("../unsafe"), false);
    await assert.rejects(
      () => store.createSession({
        sessionId: "../unsafe"
      }),
      /Invalid ai-studio session id/u
    );

    await store.createSession({
      sessionId: "safe_123"
    });
    await assert.rejects(
      () => store.writeArtifact("safe_123", "../outside.txt", "bad"),
      /Invalid ai-studio artifact path/u
    );
    await assert.rejects(
      () => store.writeMetadataValue("safe_123", "../outside", "bad"),
      /Invalid ai-studio metadata name/u
    );
  });
});

test("ai-studio session store rejects invalid statuses before creating a session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createAiStudioSessionStore({
      targetRoot
    });

    await assert.rejects(
      () => store.createSession({
        sessionId: "bad_status",
        status: "confused"
      }),
      /Invalid ai-studio session status/u
    );
    await assert.rejects(
      () => store.readSession("bad_status"),
      /Unknown ai-studio session/u
    );
  });
});
