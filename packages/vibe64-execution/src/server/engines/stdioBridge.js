// Runs inside Vibe64's managed execution scope. Only bytes cross this private
// socket: the native process keeps its protocol, authentication and history.
//
// The first connection carries the native process's bytes as they are, both
// ways. When it drops, the bridge ends its process group, unless a handover
// file sits beside the socket (written as the editor's planned stop begins):
// then it waits that long for one reconnect, which names the output offset it
// has and gets everything from there out of a bounded ring of what was sent.
// A drop while the native process holds a partial input line ends the group
// all the same, and after a reconnect input goes on in whole lines only, so a
// later drop never leaves one (stdioBridgeProtocol.js).
import { spawn } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  STDIO_BRIDGE_HANDOVER_FILE,
  STDIO_BRIDGE_MAX_WAIT_MS,
  STDIO_BRIDGE_REFUSED,
  STDIO_BRIDGE_RESUME,
  STDIO_BRIDGE_RESUME_LINE_BYTES,
  STDIO_BRIDGE_RESUMED
} from "./stdioBridgeProtocol.js";

// An empty umask argument keeps the one this process inherited.
const [socketPath, umask, command, ...args] = process.argv.slice(2);
if (!socketPath || !command) throw new Error("The stdio bridge requires a socket and command.");
if (umask) process.umask(Number.parseInt(umask, 8));
// The ring of output a reconnect can be replayed from. Tests make it small; the native process never sees the setting.
const ringLimit = Number.parseInt(process.env.VIBE64_STDIO_BRIDGE_RING_BYTES || "", 10) > 0
  ? Number.parseInt(process.env.VIBE64_STDIO_BRIDGE_RING_BYTES, 10)
  : 1024 * 1024;
delete process.env.VIBE64_STDIO_BRIDGE_RING_BYTES;
const handoverPath = path.join(path.dirname(socketPath), STDIO_BRIDGE_HANDOVER_FILE);
const RESUME_LINE_MS = 5_000;

let child;
let connected = false;
let socket = null;
let outputEnded = false;
// Every output byte so far, and the last of them a reconnect can be replayed from.
let outputOffset = 0;
const ring = [];
let ringLength = 0;
// Whether the native process has a partial input line; after a reconnect, the bytes held until their newline.
let lineOpen = false;
let heldInput = null;

function endGroup() {
  if (process.platform !== "win32") process.kill(-process.pid, "SIGTERM");
  else child.kill();
}

function remember(chunk) {
  outputOffset += chunk.length;
  ring.push(chunk);
  ringLength += chunk.length;
  while (ringLength - ring[0].length >= ringLimit) ringLength -= ring.shift().length;
  if (ringLength > ringLimit) {
    ring[0] = ring[0].subarray(ringLength - ringLimit);
    ringLength = ringLimit;
  }
}

/** The output from `offset` on, or null when the ring no longer holds it. */
function outputFrom(offset) {
  if (!Number.isSafeInteger(offset) || offset > outputOffset || offset < outputOffset - ringLength) return null;
  return Buffer.concat(ring, ringLength).subarray(ringLength - (outputOffset - offset));
}

/** The handover beside the socket, used once: how long to wait for a reconnect, or null when there is none. */
function takeHandover() {
  let text = "";
  try {
    text = readFileSync(handoverPath, "utf8");
  } catch {
    return null;
  }
  rmSync(handoverPath, { force: true });
  let waitMs = NaN;
  try {
    waitMs = Number(JSON.parse(text)?.waitMs);
  } catch {
    // A handover that does not parse is none.
  }
  return Number.isFinite(waitMs) && waitMs > 0 ? Math.min(waitMs, STDIO_BRIDGE_MAX_WAIT_MS) : null;
}

function sendInput(connection, bytes) {
  if (bytes.length === 0 || child.stdin.destroyed || child.stdin.writableEnded) return;
  if (!child.stdin.write(bytes)) {
    connection.pause();
    child.stdin.once("drain", () => connection.resume());
  }
}

function attach(connection, { resumed }) {
  socket = connection;
  connection.on("data", (chunk) => {
    if (!resumed) {
      lineOpen = chunk[chunk.length - 1] !== 10;
      sendInput(connection, chunk);
      return;
    }
    heldInput = heldInput ? Buffer.concat([heldInput, chunk]) : chunk;
    const end = heldInput.lastIndexOf(10) + 1;
    if (end === 0) return;
    sendInput(connection, heldInput.subarray(0, end));
    heldInput = heldInput.subarray(end);
  });
  let waitMs = null;
  // Input EOF may precede the reply, so it reaches the native process; after a handover the end is the drop itself.
  connection.on("end", () => {
    waitMs = takeHandover();
    if (waitMs === null) child.stdin.end();
    else connection.destroy();
  });
  // Scope cleanup still belongs to the host; a fully broken stream can
  // terminate the bridge's owned process group early.
  connection.on("error", () => {});
  connection.on("close", () => {
    socket = null;
    heldInput = null;
    waitMs ??= takeHandover();
    if (outputEnded || child.exitCode !== null || child.signalCode !== null) return;
    if (waitMs === null || lineOpen) return endGroup();
    // Nothing more is taken from the native process until the reconnect, so the ring holds what the drop cut off.
    child.stdout.pause();
    waitForReconnect(waitMs);
  });
  if (outputEnded) connection.end();
  else child.stdout.resume();
}

function waitForReconnect(waitMs) {
  rmSync(socketPath, { force: true });
  let answered = false;
  const waiting = net.createServer({ allowHalfOpen: true }, (connection) => {
    if (answered) return connection.destroy();
    answered = true;
    waiting.close();
    clearTimeout(deadline);
    readResumeLine(connection);
  });
  waiting.on("error", () => endGroup());
  waiting.listen(socketPath, () => chmodSync(socketPath, 0o600));
  const deadline = setTimeout(() => {
    waiting.close();
    endGroup();
  }, waitMs);
}

function readResumeLine(connection) {
  let line = Buffer.alloc(0);
  const refuse = (reason) => {
    connection.end(`${STDIO_BRIDGE_REFUSED} ${reason}\n`, () => endGroup());
    setTimeout(endGroup, 500).unref();
  };
  const timer = setTimeout(() => refuse("no-resume-line"), RESUME_LINE_MS);
  connection.on("error", () => {});
  function onData(chunk) {
    line = Buffer.concat([line, chunk]);
    const newline = line.indexOf(10);
    if (newline === -1) {
      if (line.length > STDIO_BRIDGE_RESUME_LINE_BYTES) {
        connection.off("data", onData);
        clearTimeout(timer);
        refuse("malformed");
      }
      return;
    }
    connection.off("data", onData);
    connection.off("close", onClose);
    clearTimeout(timer);
    connection.pause();
    const [word, offsetText, extra] = line.subarray(0, newline).toString("latin1").split(" ");
    const replay = word === STDIO_BRIDGE_RESUME && extra === undefined && /^\d+$/u.test(offsetText || "")
      ? outputFrom(Number(offsetText))
      : undefined;
    if (replay === undefined) return refuse("malformed");
    if (replay === null) return refuse("offset-not-held");
    connection.write(`${STDIO_BRIDGE_RESUMED}\n`);
    connection.write(replay);
    const input = line.subarray(newline + 1);
    attach(connection, { resumed: true });
    if (input.length > 0) connection.emit("data", input);
    connection.resume();
  }
  function onClose() {
    clearTimeout(timer);
    endGroup();
  }
  connection.on("data", onData);
  connection.once("close", onClose);
}

const server = net.createServer({ allowHalfOpen: true }, (connection) => {
  if (connected) return connection.destroy();
  connected = true;
  server.close();
  // Claude's own Git probes leave stdin open. Identify Claude itself as their
  // parent; exec preserves this PID while keeping Bash tool pipelines intact.
  child = spawn("/bin/sh", ["-c",
    'export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=$$; exec "$@"',
    "vibe64-stdio", command, ...args
  ], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  child.on("error", () => socket?.destroy());
  child.stdin.on("error", () => socket?.destroy());
  child.stdout.on("data", (chunk) => {
    remember(chunk);
    if (!socket) return;
    if (!socket.write(chunk)) {
      child.stdout.pause();
      socket.once("drain", () => {
        if (socket) child.stdout.resume();
      });
    }
  });
  child.stdout.once("end", () => {
    outputEnded = true;
    socket?.end();
  });
  child.on("close", (code, signal) => {
    socket?.end();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  attach(connection, { resumed: false });
});
server.on("error", (error) => {
  throw error;
});
// Set the socket's mode synchronously: the listening callback runs before any
// connection is handled, and the first connection closes the server, which
// removes the socket. A chmod queued behind other thread-pool work could run
// after that, fail and end the bridge with the client's first bytes unread
// (the client then reads ECONNRESET).
server.listen(socketPath, () => chmodSync(socketPath, 0o600));
setTimeout(() => {
  if (!connected) process.exit(1);
}, 30_000).unref();
