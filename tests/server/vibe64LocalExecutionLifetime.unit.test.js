import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createVibe64ConversationExecution,
  runVibe64Command,
  stopVibe64Execution
} from "@local/vibe64-execution/server";

const executionIndex = fileURLToPath(new URL("../../packages/vibe64-execution/src/server/index.js", import.meta.url));
const reaperPath = fileURLToPath(new URL("../../packages/vibe64-execution/src/server/engines/detachedReaper.js", import.meta.url));
const posix = process.platform !== "win32";

function groupExists(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(50);
  }
  return predicate();
}

async function reaperProcesses() {
  if (process.platform !== "linux") return [];
  const found = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    const commandLine = await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "");
    if (commandLine.split("\0").includes(reaperPath)) found.push(Number(entry));
  }
  return found;
}

// A separate server process starts one detached service and then ends the way
// a crash, kill -9 or the forced shutdown ends it: without any cleanup.
async function startServiceInAnotherServer(root, { ignoreTerm = true } = {}) {
  const serverPath = path.join(root, "server-a.mjs");
  const service = `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""} setInterval(() => {}, 1000);`;
  await writeFile(serverPath, `
    import { runVibe64Command } from ${JSON.stringify(pathToFileURL(executionIndex).href)};
    const result = await runVibe64Command({
      command: process.execPath, args: ["-e", ${JSON.stringify(service)}],
      cwd: ${JSON.stringify(root)}, mode: "detached", purpose: "codex",
      execution: { ownerId: "lifetime-test" }, logPath: ${JSON.stringify(path.join(root, "service.log"))}
    });
    process.stdout.write(JSON.stringify({ ok: result.ok, pid: result.pid, executionId: result.execution?.id }) + "\\n");
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 200);
  `);
  const server = spawn(process.execPath, [serverPath], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  await new Promise((resolve) => server.once("exit", resolve));
  return JSON.parse(output.trim());
}

test("a local detached service ends with the server that started it, even when it ignores SIGTERM", { skip: !posix }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-lifetime-"));
  let started;
  try {
    started = await startServiceInAnotherServer(root);
    assert.equal(started.ok, true);
    assert.equal(Number.isSafeInteger(started.pid), true);
    // The reaper sends SIGTERM, waits 3 s for the group and then sends SIGKILL.
    assert.equal(await waitFor(() => !groupExists(started.pid), 8_000), true,
      "the earlier server's service is still running after that server ended");

    // A restarted server never saw this ID. Restored-ID recovery is proven
    // empty, so a saved Claude or helper execution ID no longer blocks its chat.
    const restored = await stopVibe64Execution(started.executionId, { allowMissingRecordScopeRecovery: true });
    assert.deepEqual(restored, { executionId: started.executionId, ok: true, scopeEmpty: true, stopped: false });
    const conversation = createVibe64ConversationExecution();
    assert.equal((await conversation.stop(started.executionId)).scopeEmpty, true);
  } finally {
    if (started?.pid && groupExists(started.pid)) process.kill(-started.pid, "SIGKILL");
    await rm(root, { force: true, recursive: true });
  }
});

test("an execution ID unknown to this server is proven empty only for restored-ID recovery", async () => {
  const unknown = randomUUID();
  const ordinary = await stopVibe64Execution(unknown);
  assert.equal(ordinary.code, "vibe64_execution_not_found");
  assert.equal(ordinary.scopeEmpty, false);
  const restored = await stopVibe64Execution(unknown, { allowMissingRecordScopeRecovery: true });
  assert.equal(restored.scopeEmpty, posix);
});

test("the server's detached reaper exists only while a detached execution runs", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-reaper-"));
  try {
    assert.deepEqual(await reaperProcesses(), []);
    const result = await runVibe64Command({
      command: "sleep", args: ["30"], cwd: root, mode: "detached", purpose: "codex",
      execution: { ownerId: "reaper-test" }
    });
    assert.equal(result.ok, true, result.output);
    assert.equal(await waitFor(async () => (await reaperProcesses()).length === 1, 2_000), true,
      "a running detached execution has one reaper");
    const stopped = await stopVibe64Execution(result.execution.id);
    assert.equal(stopped.scopeEmpty, true);
    assert.equal(await waitFor(async () => (await reaperProcesses()).length === 0, 2_000), true,
      "the reaper ends once no detached execution remains");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
