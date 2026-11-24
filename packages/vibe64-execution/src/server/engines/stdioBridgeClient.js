// The editor's side of a stdio bridge's handover (stdioBridge.js): before a planned stop drops the socket, it asks the
// bridge to wait for a reconnect; whoever takes the native process over reconnects from the output offset it has.
import { writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  STDIO_BRIDGE_HANDOVER_FILE,
  STDIO_BRIDGE_MAX_WAIT_MS,
  STDIO_BRIDGE_RESUME,
  STDIO_BRIDGE_RESUME_LINE_BYTES,
  STDIO_BRIDGE_RESUMED
} from "./stdioBridgeProtocol.js";

/**
 * Asks the bridge behind `socketPath` to wait up to `waitMs` for one reconnect when its socket next drops. It is
 * synchronous, so a listener of the server's stop can call it; the bridge uses it once.
 * @param {string} socketPath
 * @param {{ waitMs: number }} options
 */
function handOverStdioBridge(socketPath, { waitMs }) {
  if (!Number.isFinite(waitMs) || waitMs <= 0 || waitMs > STDIO_BRIDGE_MAX_WAIT_MS) {
    throw new RangeError(`A stdio bridge handover waits between 1 and ${STDIO_BRIDGE_MAX_WAIT_MS} ms.`);
  }
  writeFileSync(path.join(path.dirname(socketPath), STDIO_BRIDGE_HANDOVER_FILE), JSON.stringify({ waitMs }), { mode: 0o600 });
}

function connectOnce(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath, allowHalfOpen: true });
    socket.once("connect", () => resolve(socket));
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

/**
 * Reconnects to a bridge that waits after a handover. Resolves with its socket, paused, whose next byte is the
 * output's byte `offset`; it rejects with `vibe64_stdio_resume_refused` when the bridge no longer holds that offset
 * (the bridge then ends its process group).
 * @param {string} socketPath
 * @param {number} offset the output bytes already taken
 * @param {{ connectTimeoutMs?: number }} [options]
 * @returns {Promise<import("node:net").Socket>}
 */
async function resumeStdioBridge(socketPath, offset, { connectTimeoutMs = 5_000 } = {}) {
  const deadline = Date.now() + connectTimeoutMs;
  let socket = null;
  while (!socket) {
    socket = await connectOnce(socketPath).catch(async (error) => {
      if (!["ENOENT", "ECONNREFUSED"].includes(error.code) || Date.now() >= deadline) throw error;
      await delay(20);
      return null;
    });
  }
  socket.write(`${STDIO_BRIDGE_RESUME} ${offset}\n`);
  const answer = await new Promise((resolve, reject) => {
    let head = Buffer.alloc(0);
    function finish(error, line) {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(line);
    }
    function onData(chunk) {
      head = Buffer.concat([head, chunk]);
      const newline = head.indexOf(10);
      if (newline === -1) {
        if (head.length > STDIO_BRIDGE_RESUME_LINE_BYTES) finish(new Error("The stdio bridge's answer is malformed."));
        return;
      }
      socket.pause();
      if (newline + 1 < head.length) socket.unshift(head.subarray(newline + 1));
      finish(null, head.subarray(0, newline).toString("latin1"));
    }
    function onEnd() {
      finish(null, head.toString("latin1").trim());
    }
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", finish);
  }).catch((error) => {
    socket.destroy();
    throw error;
  });
  if (answer !== STDIO_BRIDGE_RESUMED) {
    socket.destroy();
    throw Object.assign(new Error(`The stdio bridge refused the reconnect: ${answer || "no answer"}.`), {
      code: "vibe64_stdio_resume_refused"
    });
  }
  return socket;
}

export {
  handOverStdioBridge,
  resumeStdioBridge
};
