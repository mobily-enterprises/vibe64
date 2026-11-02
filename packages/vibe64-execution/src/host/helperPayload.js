// The request the helper acts on: read from standard input or from a managed execution's payload file,
// bounded, and normalized.

import {
  closeSync,
  fstatSync,
  readSync,
  unlinkSync
} from "node:fs";
import path from "node:path";

import { MANAGED_ROOT, safeUsername, workspaceFromDaemonUsername } from "./hostAccounts.js";
import { openDirectoryBelow, openedPath, readOwnedFile } from "./hostFiles.js";

// The largest payload, read from standard input or a payload file, is a JSON
// envelope carrying a command's standard input as base64. The largest such input
// is an architecture inspection request, which the System Graph service bounds
// at ARCHITECTURE_INSPECTION_INPUT_MAX_BYTES. The helper's modules import only
// Node built-ins and each other, so a System Graph test keeps the two in step.
// The rest of the envelope keeps the 1 MiB the whole payload was allowed before.
const LARGEST_COMMAND_INPUT_BYTES = 4 * 1024 * 1024;
const PAYLOAD_ENVELOPE_BYTES = 1024 * 1024;
const INPUT_LIMIT_BYTES = 4 * Math.ceil(LARGEST_COMMAND_INPUT_BYTES / 3) + PAYLOAD_ENVELOPE_BYTES;
const MANAGED_EXECUTION_REQUEST_PAYLOAD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const STDIN_READ_BUFFER_BYTES = 64 * 1024;
const STDIN_READ_RETRY_DELAY_MS = 10;
const STDIN_READ_TIMEOUT_MS = 15_000;
const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64.exec-helper.payload";
const EXEC_HELPER_PAYLOAD_SCHEMA_VERSION = 1;

// A caller whose terminal holds the helper's standard input passes that
// execution's payload as a file in its workspace's payload directory instead.
// That directory sits in the workspace's shared temporary directory, which
// other users can rearrange, so root opens it without following links, reads
// only the daemon's own regular file there and removes it through the same
// open directory.
function consumeManagedExecutionRequestPayload(payloadPath = "", owner = {}, { managedRoot = MANAGED_ROOT } = {}) {
  const workspaceRoot = path.join(managedRoot, workspaceFromDaemonUsername(safeUsername(owner.username)));
  const parts = ["tmp", "managed-execution-payloads"];
  const name = path.basename(String(payloadPath));
  if (payloadPath !== path.join(workspaceRoot, ...parts, name) || !MANAGED_EXECUTION_REQUEST_PAYLOAD_NAME_PATTERN.test(name)) {
    throw new Error("Vibe64 exec helper rejected an unsafe managed execution payload path.");
  }
  const directory = openDirectoryBelow(workspaceRoot, parts);
  try {
    if (fstatSync(directory).uid !== owner.uid) {
      throw new Error("Vibe64 exec helper refused a managed execution payload directory owned by another user.");
    }
    const input = readOwnedFile(directory, name, { maxBytes: INPUT_LIMIT_BYTES, uid: owner.uid });
    unlinkSync(openedPath(directory, name));
    return parsePayload(input);
  } finally {
    closeSync(directory);
  }
}

function assertNormalizedPayload(payload = {}) {
  if (
    payload?.schema !== EXEC_HELPER_PAYLOAD_SCHEMA ||
    payload?.schemaVersion !== EXEC_HELPER_PAYLOAD_SCHEMA_VERSION
  ) {
    throw new Error("Vibe64 exec helper rejected a non-normalized execution payload.");
  }
}

function readPayload() {
  return parsePayload(readStdin());
}

// A payload that is not JSON is never repeated back.
function parsePayload(input = "") {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    throw new Error("Vibe64 exec helper payload is not valid JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Vibe64 exec helper payload must be a JSON object.");
  }
  return payload;
}

function readStdin() {
  const chunks = [];
  const buffer = Buffer.allocUnsafe(STDIN_READ_BUFFER_BYTES);
  const retrySignal = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + STDIN_READ_TIMEOUT_MS;
  let totalBytes = 0;

  while (true) {
    try {
      const bytesRead = readSync(0, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > INPUT_LIMIT_BYTES) {
        throw new Error("Vibe64 exec helper payload is too large.");
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    } catch (error) {
      if (error?.code === "EINTR") {
        continue;
      }
      if (
        (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") &&
        Date.now() < deadline
      ) {
        Atomics.wait(retrySignal, 0, 0, STDIN_READ_RETRY_DELAY_MS);
        continue;
      }
      if (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") {
        throw new Error("Vibe64 exec helper timed out waiting for its payload.");
      }
      throw error;
    }
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export {
  assertNormalizedPayload,
  consumeManagedExecutionRequestPayload,
  INPUT_LIMIT_BYTES,
  readPayload
};
