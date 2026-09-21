import crypto from "node:crypto";
import http from "node:http";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

const controlListeners = new Set();

function subscribeUnixCommandControlChanges(listener) {
  controlListeners.add(listener);
  return () => controlListeners.delete(listener);
}

function reportUnixCommandControlChange(entry, reason, receivedGeneration = "") {
  const event = { socketPath: entry.socketPath, sessionId: entry.sessionId,
    generationId: entry.generationId, reason };
  logOperationalEvent(entry.commandService?.logger, reason === "rejected" ? "warn" : "info", {
    component: "vibe64.agent_controls", event: `vibe64.agent_controls.${reason}`,
    ...event, receivedGeneration: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(receivedGeneration) ? receivedGeneration : ""
  }, "Managed assistant control lifecycle changed.");
  for (const listener of controlListeners) listener(event);
}

const DEAD_UNIX_COMMAND_SOCKET_CODES = new Set([
  "ECONNREFUSED",
  "ENOENT",
  "ENOTSOCK"
]);

function commandRequestError({
  code = "",
  message = ""
} = {}) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function shortCommandHash(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 16);
}

function unixCommandSocketPath(identity, { env = process.env } = {}) {
  const owner = typeof process.getuid === "function" ? process.getuid() : "user";
  const root = path.resolve(String(env.TMPDIR || "").trim() || tmpdir());
  const socketPath = path.join(root, `v64-${owner}-${shortCommandHash(identity)}.sock`);
  const maxBytes = process.platform === "darwin" ? 103 : 107;
  if (Buffer.byteLength(socketPath, "utf8") > maxBytes) {
    throw commandRequestError({
      code: "vibe64_agent_control_path_too_long",
      message: "The assistant cannot start because the server's temporary directory path is too long. Ask the workspace administrator to shorten TMPDIR, then retry."
    });
  }
  return socketPath;
}

async function unixCommandSocketIsPresent(socketPath = "") {
  try {
    return (await stat(socketPath)).isSocket();
  } catch {
    return false;
  }
}

async function unixJsonCommandServerIsHealthy(entry = {}, {
  healthPath = "",
  sessionId = "",
  socketPath = "",
  timeoutMs = 2000
} = {}) {
  if (!entry.server || !await unixCommandSocketIsPresent(socketPath)) {
    return false;
  }
  try {
    const response = await requestUnixJsonCommand({
      body: {
        generationId: entry.generationId,
        sessionId,
        token: entry.token
      },
      path: healthPath,
      socketPath,
      timeoutMs
    });
    const healthy = response.statusCode === 200 &&
      response.payload?.ok === true &&
      String(response.payload?.generationId || "").trim() === String(entry.generationId || "").trim() &&
      String(response.payload?.sessionId || "").trim() === String(sessionId || "").trim();
    if (healthy && !entry.readyReported) {
      entry.readyReported = true;
      reportUnixCommandControlChange(entry, "ready");
    }
    return healthy;
  } catch {
    return false;
  }
}

async function closeUnixJsonCommandServer(commandServers, socketPath = "", entry = null, reason = "replaced") {
  if (entry?.server) {
    await new Promise((resolve) => entry.server.close(() => resolve())).catch(() => null);
    reportUnixCommandControlChange(entry, reason);
  }
  if (commandServers.get(socketPath) === entry) {
    commandServers.delete(socketPath);
  }
}

async function closeUnixJsonCommandServersForSession(commandServers, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  let closed = 0;
  for (const [socketPath, entryValue] of [...commandServers.entries()]) {
    const entry = entryValue?.promise
      ? await entryValue.promise.catch(() => null)
      : entryValue;
    if (String(entry?.sessionId || "").trim() !== normalizedSessionId) {
      continue;
    }
    closed += entry?.server ? 1 : 0;
    await closeUnixJsonCommandServer(commandServers, socketPath, entry, "session-closed");
    await rm(socketPath, { force: true }).catch(() => null);
  }
  return closed;
}

async function removeDeadUnixJsonCommandSocket(socketPath = "", {
  healthPath = "",
  ownerErrorMessage = "The Unix command socket is owned by an unverified listener.",
  timeoutMs = 2000
} = {}) {
  if (!await unixCommandSocketIsPresent(socketPath)) {
    return;
  }
  try {
    await requestUnixJsonCommand({
      body: {},
      path: healthPath,
      socketPath,
      timeoutMs
    });
  } catch (error) {
    if (DEAD_UNIX_COMMAND_SOCKET_CODES.has(String(error?.code || ""))) {
      await rm(socketPath, { force: true });
      return;
    }
    throw error;
  }
  const error = new Error(ownerErrorMessage);
  error.code = "vibe64_agent_control_owner_unverified";
  throw error;
}

async function listenUnixJsonCommandServer(server, socketPath = "") {
  await new Promise((resolve, reject) => {
    const handleError = (error) => reject(error);
    server.once("error", handleError);
    server.listen(socketPath, () => {
      server.off("error", handleError);
      resolve();
    });
  });
  server.unref?.();
}

function requestUnixJsonCommand({
  body = {},
  path = "/",
  socketPath = "",
  timeoutMs = 2000
} = {}) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path,
      socketPath,
      timeout: timeoutMs
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.once("end", () => {
        let payload = null;
        try {
          payload = JSON.parse(text || "{}");
        } catch {
          payload = null;
        }
        resolve({
          payload,
          statusCode: Number(response.statusCode || 0),
          text
        });
      });
    });
    request.once("error", reject);
    request.once("timeout", () => {
      const error = new Error("Unix command request timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.end(requestBody);
  });
}

async function readJsonCommandRequest(request, {
  invalidJsonError = {},
  maxBytes,
  tooLargeError = {}
} = {}) {
  const chunks = [];
  let size = 0;

  const text = await new Promise((resolve, reject) => {
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = commandRequestError(tooLargeError);
        reject(error);
        request.destroy(error);
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    throw commandRequestError(invalidJsonError);
  }
}

function sendJsonCommandResponse(response, statusCode, payload = {}) {
  const text = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(text),
    "Content-Type": "application/json"
  });
  response.end(text);
}

export {
  closeUnixJsonCommandServer,
  closeUnixJsonCommandServersForSession,
  listenUnixJsonCommandServer,
  readJsonCommandRequest,
  reportUnixCommandControlChange,
  removeDeadUnixJsonCommandSocket,
  requestUnixJsonCommand,
  sendJsonCommandResponse,
  shortCommandHash,
  subscribeUnixCommandControlChanges,
  unixCommandSocketPath,
  unixCommandSocketIsPresent,
  unixJsonCommandServerIsHealthy
};
