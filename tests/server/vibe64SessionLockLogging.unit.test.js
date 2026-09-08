import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { projectRuntimeRoot, withTemporaryRoot } from "./vibe64TestHelpers.js";

async function fixture(targetRoot, onLog = () => {}) {
  const events = [];
  const record = (fields) => {
    events.push(fields);
    onLog(fields);
  };
  const store = createVibe64SessionStore({
    projectContextRoot: targetRoot,
    projectRuntimeRoot: projectRuntimeRoot(targetRoot),
    logger: { info: record, warn: record }
  });
  await store.createSession({ runtimeKind: "genesis", sessionId: "lock-diagnostics" });
  return {
    store,
    events,
    run: (operation, callback, waitMs = 0) => runVibe64AgentWriteExclusive(
      { store }, "lock-diagnostics", callback, { operation, waitMs }
    )
  };
}

test("lock rejection preserves cross-process holder identity after the lock disappears", { timeout: 10_000 }, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { store, events, run } = await fixture(targetRoot);
    const storeModule = new URL("../../packages/vibe64-runtime/src/server/sessionStore.js", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { once } from "node:events";
      import { createVibe64SessionStore } from ${JSON.stringify(storeModule)};
      const store = createVibe64SessionStore({
        projectContextRoot: process.argv[1], projectRuntimeRoot: process.argv[2]
      });
      await store.runSessionExclusive("lock-diagnostics", "agent-write-mode", async () => {
        const release = once(process, "message");
        process.send("held");
        await release;
      }, { operation: "ensure-agent-session" });
      process.disconnect();
    `, targetRoot, projectRuntimeRoot(targetRoot)], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const exited = once(child, "exit");
    try {
      await Promise.race([
        once(child, "message"),
        exited.then(() => { throw new Error("Lock holder exited before acquiring the lock"); })
      ]);
      const ownerPath = path.join(store.paths().sessionsRoot, ".locks/lock-diagnostics/agent-write-mode.lock/owner.json");
      const owner = JSON.parse(await readFile(ownerPath, "utf8"));
      const rejected = await run("stream-temporary-chat", () => assert.fail("must not enter"));
      assert.equal(rejected.value.code, "vibe64_agent_write_mode_busy");
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.event, "vibe64.session_lock.rejected");
      assert.equal(event.operation, "stream-temporary-chat");
      assert.equal(event.sessionId, "lock-diagnostics");
      assert.equal(event.projectRoot, targetRoot);
      assert.equal(event.waitMs, 0);
      assert.equal(event.owner.operation, "ensure-agent-session");
      assert.equal(event.owner.pid, child.pid);
      assert.equal(event.owner.attemptId, owner.attemptId);
      assert.notEqual(event.attemptId, owner.attemptId);
      assert.ok(event.owner.heldMs >= 0);
      assert.ok(event.waitedMs >= 0);
      assert.ok(!JSON.stringify(events).includes(owner.token));
      child.send("release");
      assert.equal((await exited)[0], 0);
      await assert.rejects(access(ownerPath), { code: "ENOENT" });
      assert.equal(event.owner.operation, "ensure-agent-session");
    } finally {
      if (child.exitCode === null) child.kill();
      await exited;
    }
  });
});

test("waiting logs one contention and correlated acquisition/release, without nested lock noise", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const contended = Promise.withResolvers();
    const { events, run } = await fixture(targetRoot, (event) => {
      if (event.event === "vibe64.session_lock.contended") contended.resolve();
    });
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holder = run("ensure-agent-session", async () => {
      await run("nested-operation", () => "nested");
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const waiter = run("update-session-work", () => "updated", 1000);
    try {
      await contended.promise;
    } finally {
      release.resolve();
      await holder;
    }
    assert.equal((await waiter).value, "updated");
    assert.equal(events.filter((event) => event.event.endsWith(".contended")).length, 1);
    assert.ok(!events.some((event) => event.operation === "nested-operation"));
    const updateEvents = events.filter((event) => event.operation === "update-session-work");
    assert.deepEqual(updateEvents.map((event) => event.event), [
      "vibe64.session_lock.contended", "vibe64.session_lock.acquired", "vibe64.session_lock.released"
    ]);
    assert.equal(new Set(updateEvents.map((event) => event.attemptId)).size, 1);
    assert.ok(updateEvents[1].waitedMs >= 0);
    assert.ok(updateEvents[2].heldMs >= 0);
  });
});

test("wait timeout logs its blocker once and a final rejection rather than each poll", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { events, run } = await fixture(targetRoot);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holder = run("prepare-workspace", async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    try {
      const result = await run("update-session-work", () => assert.fail("must not enter"), 60);
      assert.equal(result.acquired, false);
      const blockedEvents = events.filter((event) => event.operation === "update-session-work");
      assert.deepEqual(blockedEvents.map((event) => event.event), [
        "vibe64.session_lock.contended", "vibe64.session_lock.rejected"
      ]);
      assert.equal(blockedEvents[1].owner.operation, "prepare-workspace");
      assert.ok(blockedEvents[1].waitedMs >= 60);
    } finally {
      release.resolve();
      await holder;
    }
  });
});

test("operation failure releases the lock, and a broken logger cannot change admission", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { run } = await fixture(targetRoot, () => { throw new Error("logger unavailable"); });
    const failure = new Error("operation failed");
    await assert.rejects(run("update-session-work", () => { throw failure; }), (error) => error === failure);
    assert.equal((await run("update-session-work", () => "retried")).value, "retried");
  });
});

test("preparation timeout identifies the actual blocker without exposing lock ownership secrets", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { run } = await fixture(targetRoot);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const holder = run("prepare-agent-session", async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    let result;
    try {
      result = await run("save-session-work", () => assert.fail("must not save during preparation"), 60);
      assert.equal(result.acquired, false);
      assert.equal(result.value.code, "vibe64_agent_write_mode_busy");
      assert.equal(result.value.retryable, true);
      assert.equal(result.value.error, "The assistant is still reconnecting. Wait until it is ready, then try again.");
      assert.deepEqual(result.value.details, { blockingOperation: "prepare-agent-session" });
      assert.equal(/token|pid|projectRoot|attemptId/.test(JSON.stringify(result.value)), false);
    } finally {
      release.resolve();
      await holder;
    }
    assert.equal(result.value.details.blockingOperation, "prepare-agent-session");
    assert.equal((await run("save-session-work", () => "saved", 60)).value, "saved");
  });
});
