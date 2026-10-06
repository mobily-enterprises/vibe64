import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64ConversationExecution } from "../../packages/vibe64-execution/src/server/conversationExecution.js";
import { inspectVibe64Service, installVibe64ManagedExecutionProvider } from "../../packages/vibe64-execution/src/server/managedExecution.js";

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-conversation-execution-test-"));
  const ids = [];
  const host = createVibe64ConversationExecution({ credentialHome: { home: root },
    onStarted: id => ids.push(id), ...options });
  t.after(async () => {
    for (const id of ids) await host.stop(id);
    await rm(root, { recursive: true, force: true });
  });
  return { host, root, start: input => host.start({ command: process.execPath, cwd: root,
    env: { PATH: process.env.PATH }, ...input }) };
}

test("conversation execution preserves output and exit status after input EOF", { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const native = await f.start({ stream: true, args: ["--input-type=module", "-e", `
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(JSON.stringify({ received: input, loggedIn: true }));
  `] });
  native.stdin.end("account probe");
  const chunks = [];
  for await (const chunk of native.stdout) chunks.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { received: "account probe", loggedIn: true });
  assert.deepEqual(await native.exited, { code: 0, signal: null });
  assert.equal(native.running, false);
  assert.equal((await f.host.stop(native.id)).scopeEmpty, true);
});

test("conversation execution observes a server failure without calling it a successful start receipt", { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const native = await f.start({ args: ["-e", "setTimeout(() => process.exit(7), 50)"] });
  assert.deepEqual(await native.exited, { code: 7, signal: null });
  assert.equal(native.running, false);
});

test("managed execution exposes bounded native startup logs and its observed process id", async t => {
  let request;
  const f = await fixture(t, {
    commandRunner: async value => { request = value; return { ok: true, pid: 456, execution: { id: "log-proof" } }; },
    inspectExecution: async () => ({ ok: true, running: true }),
    stopExecution: async () => ({ scopeEmpty: true })
  });
  const native = await f.start();
  assert.equal(native.pid, 456);
  assert.deepEqual(native.readLogs(), { stderr: "", stdout: "" });
  await writeFile(request.logPath, "earlier logs" + "x".repeat(64 * 1024 - 4) + "tail");
  const logs = native.readLogs();
  assert.equal(logs.stderr.length, 64 * 1024);
  assert.equal(logs.stderr.endsWith("tail"), true);
  assert.equal(logs.stderr.includes("earlier logs"), false);
});

test("startup failures keep the host receipt and retry policy and require an execution identity", async t => {
  for (const result of [
    { ok: false, output: " host capacity is busy ", code: "vibe64_opencode_start_failed", execution: { admitted: false }, retryable: true },
    { ok: true, execution: { id: " " } }
  ]) {
    let request;
    const f = await fixture(t, {
      commandRunner: async value => { request = value; return result; },
      inspectExecution: async () => assert.fail("A rejected execution must not be observed."),
      stopExecution: async () => assert.fail("A rejected execution has no process to stop.")
    });
    await assert.rejects(f.start(), error => {
      assert.equal(error.message, result.output?.trim() || "The native process could not start.");
      assert.equal(error.code, result.code);
      assert.equal(error.execution, result.execution);
      assert.equal(error.retryable, result.retryable === true);
      return true;
    });
    await assert.rejects(stat(path.dirname(request.logPath)), { code: "ENOENT" });
  }
});

test("native private home and state directories reach the process through the credential policy", { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const env = Object.fromEntries(["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]
    .map(name => [name, path.join(f.root, "native", name.toLowerCase())]));
  const native = await f.start({ stream: true, env: { ...env, PATH: process.env.PATH }, args: ["-e",
    `process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([name]) => ${JSON.stringify(Object.keys(env))}.includes(name)))))`] });
  native.stdin.end();
  const chunks = [];
  for await (const chunk of native.stdout) chunks.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), env);
  assert.equal((await native.exited).code, 0);
  await assert.rejects(f.start({ env: { HOME: "relative" } }), /absolute directory/);
});

test("the gateway drains a native process after its streaming client closes", { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const native = await f.start({ stream: true, args: ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"] });
  await new Promise(resolve => native.stdout.once("data", resolve));
  native.stdout.destroy();
  assert.equal((await f.host.stop(native.id)).scopeEmpty, true);
  await native.exited;
  assert.equal(native.running, false);
});

test("restored executions are cleaned up through the gateway's durable identity", async () => {
  const calls = [];
  const host = createVibe64ConversationExecution({ stopExecution: async (id, options) => {
    calls.push({ id, options });
    return { scopeEmpty: id === "owned-saved-execution", stopped: id === "owned-saved-execution" };
  } });
  assert.equal((await host.stop("owned-saved-execution")).scopeEmpty, true);
  assert.equal((await host.stop("unowned-execution")).scopeEmpty, false);
  assert.equal(calls[0].id, "owned-saved-execution");
  assert.equal(calls[0].options.allowMissingRecordScopeRecovery, true);
});

test("failed cleanup retains the execution and its files until the host proves the scope empty", async t => {
  let request;
  let allowed = false;
  const f = await fixture(t, {
    commandRunner: async value => { request = value; return { ok: true, execution: { id: "cleanup-proof" } }; },
    inspectExecution: async () => ({ ok: true, running: true }),
    stopExecution: async () => ({ scopeEmpty: allowed })
  });
  const native = await f.start();
  const directory = path.dirname(request.logPath);
  assert.equal((await f.host.stop(native.id)).scopeEmpty, false);
  assert.equal(native.running, true);
  assert.equal((await stat(directory)).isDirectory(), true);
  allowed = true;
  assert.equal((await f.host.stop(native.id)).scopeEmpty, true);
  assert.equal(native.running, false);
  assert.deepEqual(await native.exited, { code: null, signal: null });
  await assert.rejects(stat(directory), { code: "ENOENT" });
});

test("an unavailable observation rejects exit evidence without acknowledging cleanup", async t => {
  let stopped = 0;
  const f = await fixture(t, {
    commandRunner: async () => ({ ok: true, execution: { id: "observation-failure" } }),
    inspectExecution: async () => { throw new Error("host unavailable"); },
    stopExecution: async () => { stopped++; return { scopeEmpty: true }; }
  });
  const native = await f.start();
  await assert.rejects(native.exited, /host unavailable/);
  assert.equal(native.running, false);
  assert.equal(stopped, 0);
  assert.equal((await f.host.stop(native.id)).scopeEmpty, true);
});

test("early process exit ends streaming startup and retains a failed stop proof", async t => {
  let allowed = false;
  let request;
  const f = await fixture(t, {
    commandRunner: async value => { request = value; return { ok: true, execution: { id: "early-exit" } }; },
    inspectExecution: async () => ({ ok: true, running: false, exitCode: 127 }),
    stopExecution: async () => ({ scopeEmpty: allowed })
  });
  await assert.rejects(f.start({ stream: true }), error => {
    assert.match(error.message, /exited before its stream was ready/);
    assert.deepEqual(error.stopProof, { scopeEmpty: false });
    return true;
  });
  assert.equal((await stat(path.dirname(request.logPath))).isDirectory(), true);
  allowed = true;
});

test("the host gateway translates native exit observations without fabricating absent evidence", async t => {
  let observation;
  const release = installVibe64ManagedExecutionProvider({
    runCommand: async () => {}, stopExecution: async () => {}, inspectExecution: async () => observation
  });
  t.after(release);
  for (const [fields, expected] of [
    [{ scopeEmpty: false, execMainCode: "0", execMainStatus: "0" }, { running: true, exitCode: null, signal: null }],
    [{ scopeEmpty: true, execMainCode: "1", execMainStatus: "0" }, { running: false, exitCode: 0, signal: null }],
    [{ scopeEmpty: false, execMainCode: "exited", execMainStatus: "7" }, { running: false, exitCode: 7, signal: null }],
    [{ scopeEmpty: true, execMainCode: "2", execMainStatus: "15" }, { running: false, exitCode: null, signal: "SIGTERM" }],
    [{ scopeEmpty: true, execMainCode: "killed", execMainStatus: "SIGKILL" }, { running: false, exitCode: null, signal: "SIGKILL" }],
    [{ scopeEmpty: true, loadState: "not-found" }, { running: false, exitCode: null, signal: null }],
    [{}, { running: null, exitCode: null, signal: null }]
  ]) {
    observation = { ok: true, ...fields };
    const { running, exitCode, signal } = await inspectVibe64Service("host-execution");
    assert.deepEqual({ running, exitCode, signal }, expected);
  }
});
