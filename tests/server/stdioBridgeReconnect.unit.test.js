import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The stdio bridge between the editor and a native AI process (stdioBridge.js) can be picked up again after its
// socket drops, so a planned editor stop need not end the AI process with it. Three safeguards keep that from ever
// corrupting the stream:
//   (a) the bridge waits for a reconnect only when a handover file sits beside its socket (written as the editor's
//       stop begins), and only for the time it names; any other drop ends the process group as before;
//   (b) a reconnect names the output offset it has, and the bridge replays from a bounded ring of what it sent,
//       refusing an offset older than the ring (and ending the group);
//   (c) after a reconnect the bridge passes input on in whole lines only, so a second drop can never leave the native
//       process a partial line; a drop while the native process holds a partial line ends the group. The first
//       connection stays byte for byte what it was.

const BRIDGE = fileURLToPath(new URL("../../packages/vibe64-execution/src/server/engines/stdioBridge.js", import.meta.url));
const RESUME = "vibe64-stdio-resume";

async function startBridge(t, script, { ringBytes } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-stdio-reconnect-"));
  const socketPath = path.join(root, "stream.sock");
  const bridge = spawn(process.execPath, [BRIDGE, socketPath, "", process.execPath, "--input-type=module", "-e", script], {
    detached: true,
    env: { ...process.env, ...(ringBytes ? { VIBE64_STDIO_BRIDGE_RING_BYTES: String(ringBytes) } : {}) },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  bridge.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => bridge.once("exit", (code, signal) => resolve({ code, signal, at: Date.now() })));
  t.after(async () => {
    // The bridge leads its own process group: this ends the group the test started, by its own id.
    try { process.kill(-bridge.pid, "SIGKILL"); } catch { /* The group has ended. */ }
    await rm(root, { recursive: true, force: true });
  });
  return { bridge, exited, root, socketPath, stderr: () => stderr };
}

async function connect(socketPath, deadlineMs = 10_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: socketPath, allowHalfOpen: true });
        socket.once("connect", () => resolve(socket));
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
    } catch (error) {
      if (!["ENOENT", "ECONNREFUSED"].includes(error.code) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

/** Reads until `enough(bytes)`, or the end; then pauses, so nothing more is taken from the socket. */
function readUntil(socket, enough) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    function onData(chunk) {
      chunks.push(chunk);
      length += chunk.length;
      if (enough(Buffer.concat(chunks, length))) finish();
    }
    function finish() {
      socket.pause();
      socket.off("data", onData);
      socket.off("end", finish);
      socket.off("error", reject);
      resolve(Buffer.concat(chunks, length));
    }
    socket.on("data", onData);
    socket.once("end", finish);
    socket.once("error", reject);
    socket.resume();
  });
}

async function readAll(socket) {
  const chunks = [];
  for await (const chunk of socket) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** A reconnect: the resume line, then the bridge's one-line answer, then the stream from that offset. */
async function resume(socketPath, offset) {
  const socket = await connect(socketPath, 2_000);
  socket.write(`${RESUME} ${offset}\n`);
  const head = await readUntil(socket, (bytes) => bytes.includes(10));
  const newline = head.indexOf(10);
  const answer = head.subarray(0, newline === -1 ? head.length : newline).toString();
  const rest = newline === -1 ? Buffer.alloc(0) : head.subarray(newline + 1);
  return { answer, rest, socket };
}

const handover = (socketPath, waitMs) => writeFile(path.join(path.dirname(socketPath), "handover"), JSON.stringify({ waitMs }));

// Lines 0..count-1, a few at a time, then the process ends by itself.
const SEQUENCE = (count) => `
  for (let line = 0; line < ${count}; line += 1) {
    process.stdout.write(\`line \${line}\\n\`);
    if (line % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 2));
  }
`;
const sequence = (count) => Array.from({ length: count }, (_, line) => `line ${line}\n`).join("");
const LINES = (bytes) => bytes.toString().split("\n").length - 1;

test("a drop with a handover is picked up again from its offset: nothing lost, nothing doubled", { timeout: 20_000 }, async (t) => {
  const f = await startBridge(t, SEQUENCE(3000));
  const first = await connect(f.socketPath);
  const before = await readUntil(first, (bytes) => LINES(bytes) >= 400);
  await handover(f.socketPath, 5_000);
  first.destroy();
  await new Promise((resolve) => setTimeout(resolve, 200));

  const again = await resume(f.socketPath, before.length);
  assert.equal(again.answer, "vibe64-stdio-resumed", f.stderr());
  const after = Buffer.concat([again.rest, await readAll(again.socket)]);
  assert.equal(Buffer.concat([before, after]).toString(), sequence(3000), "every line once, in order");
  const exit = await f.exited;
  assert.deepEqual([exit.code, exit.signal], [0, null], f.stderr());
  assert.equal(existsSync(path.join(f.root, "handover")), false, "a handover is used once");
});

test("input after a reconnect reaches the native process, and a second drop needs a second handover", { timeout: 20_000 }, async (t) => {
  const f = await startBridge(t, "process.stdin.on('data', (chunk) => process.stdout.write(`in:${chunk}`)); setInterval(() => {}, 1000);");
  const first = await connect(f.socketPath);
  // The first connection is the bridge as it always was: a partial line goes straight through.
  first.write("abc");
  assert.equal((await readUntil(first, (bytes) => bytes.length >= 6)).toString(), "in:abc");
  first.write("\n");
  const echoed = await readUntil(first, (bytes) => bytes.length >= 4);
  assert.equal(echoed.toString(), "in:\n");
  const offset = 6 + echoed.length;
  await handover(f.socketPath, 5_000);
  first.destroy();

  const again = await resume(f.socketPath, offset);
  assert.equal(again.answer, "vibe64-stdio-resumed", f.stderr());
  // After a reconnect, input goes on in whole lines: the partial "x" waits for its newline.
  again.socket.write("x");
  again.socket.write("yz\nnext");
  const lines = await readUntil(again.socket, (bytes) => bytes.toString().includes("\n"));
  assert.equal(Buffer.concat([again.rest, lines]).toString(), "in:xyz\n", "one whole line, without the partial one after it");
  // A drop now (no handover) ends the group, and the native process never saw the partial "next".
  const droppedAt = Date.now();
  again.socket.destroy();
  const exit = await f.exited;
  assert.ok(exit.at - droppedAt < 1_000, `the group ended ${exit.at - droppedAt} ms after a drop without a handover`);
});

test("a drop without a handover ends the native process group at once, as before", { timeout: 20_000 }, async (t) => {
  const f = await startBridge(t, `${SEQUENCE(100)} setInterval(() => {}, 1000);`);
  const first = await connect(f.socketPath);
  await readUntil(first, (bytes) => LINES(bytes) >= 10);
  const droppedAt = Date.now();
  first.destroy();
  const exit = await f.exited;
  assert.ok(exit.at - droppedAt < 1_000, `the group ended ${exit.at - droppedAt} ms after the drop`);
  await assert.rejects(connect(f.socketPath, 200), "nothing waits for a reconnect");
});

test("a handover nobody takes up ends the group once its wait is over", { timeout: 20_000 }, async (t) => {
  const f = await startBridge(t, `${SEQUENCE(100)} setInterval(() => {}, 1000);`);
  const first = await connect(f.socketPath);
  await readUntil(first, (bytes) => LINES(bytes) >= 10);
  await handover(f.socketPath, 400);
  const droppedAt = Date.now();
  first.destroy();
  const exit = await f.exited;
  const waited = exit.at - droppedAt;
  assert.ok(waited >= 350 && waited < 1_400, `the group ended ${waited} ms after the drop, not about 400 ms`);
});

test("a reconnect from an offset older than the bridge's ring is refused and ends the group", { timeout: 20_000 }, async (t) => {
  const f = await startBridge(t, `${SEQUENCE(2000)} setInterval(() => {}, 1000);`, { ringBytes: 4096 });
  const first = await connect(f.socketPath);
  await readUntil(first, (bytes) => LINES(bytes) >= 1500);
  await handover(f.socketPath, 5_000);
  first.destroy();

  const again = await resume(f.socketPath, 0);
  assert.match(again.answer, /^vibe64-stdio-refused /u);
  const refusedAt = Date.now();
  const exit = await f.exited;
  assert.ok(exit.at - refusedAt < 1_000, `the group ended ${exit.at - refusedAt} ms after the refusal`);
});

test("a drop while the native process holds a partial input line ends the group, handover or not", { timeout: 20_000 }, async (t) => {
  const f = await startBridge(t, "process.stdin.on('data', (chunk) => process.stdout.write(`in:${chunk}`)); setInterval(() => {}, 1000);");
  const first = await connect(f.socketPath);
  first.write("half a li");
  await readUntil(first, (bytes) => bytes.length >= 12);
  await handover(f.socketPath, 5_000);
  const droppedAt = Date.now();
  first.destroy();
  const exit = await f.exited;
  assert.ok(exit.at - droppedAt < 1_000, `the group ended ${exit.at - droppedAt} ms after the drop`);
});
