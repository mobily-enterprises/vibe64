import crypto, { randomUUID } from "node:crypto";
import http from "node:http";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeText } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64ErrorResponse, vibe64StatusCode } from "@local/vibe64-core/server/serverResponses";

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
  } catch (cause) {
    if (DEAD_UNIX_COMMAND_SOCKET_CODES.has(String(cause?.code || ""))) return false;
    // An uncertain probe must not retire a live listener and invalidate every
    // assistant that inherited its controls. Only a proven dead socket is replaceable.
    logOperationalEvent(entry.commandService?.logger, "warn", {
      component: "vibe64.agent_controls", event: "vibe64.agent_controls.health_unavailable",
      sessionId, socketPath, generationId: entry.generationId, code: cause?.code || ""
    }, "Managed assistant control health could not be verified; existing listener retained.");
    throw Object.assign(new Error("Managed assistant control health could not be verified. Retry the connection; existing command credentials and work have been retained.", { cause }), {
      code: "vibe64_agent_control_unavailable", retryable: true
    });
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

// The per-session control servers of one agent command. Each server listens on
// its own Unix socket and accepts only requests that carry its random token,
// its session and its generation; the agent receives all three in its
// environment. `routes` maps each route path to { handle, token, status }:
// `handle` receives { commandService, input, request, response, sessionId }
// and returns the JSON result, or undefined after writing the response itself;
// `token` names the entry token the route accepts (default "token"); `status`
// maps a result to its HTTP status (default 200). `<routePrefix>/health` is
// served for every server.
function createSessionCommandServers({
  routePrefix,
  routes = {},
  extraTokens = [],
  label,
  maxBytes,
  invalidJsonError,
  tooLargeError,
  notFound,
  rejection,
  requestFailure,
  errorBody = (payload) => payload,
  directoryMode,
  healthTimeoutMs = 2000
} = {}) {
  const healthPath = `${routePrefix}/health`;
  const servers = new Map();
  const preparations = new Map();

  async function serve(entry, request, response) {
    try {
      const route = request.method !== "POST"
        ? null
        : request.url === healthPath ? { token: "token" } : routes[request.url];
      if (!route) {
        sendJsonCommandResponse(response, 404, notFound);
        return;
      }
      const input = await readJsonCommandRequest(request, { invalidJsonError, maxBytes, tooLargeError });
      const tokenMatches = normalizeText(input.token) === entry[route.token || "token"];
      const sessionMatches = normalizeText(input.sessionId) === entry.sessionId;
      if (!tokenMatches || !sessionMatches || normalizeText(input.generationId) !== entry.generationId) {
        if (tokenMatches && sessionMatches) reportUnixCommandControlChange(entry, "rejected", normalizeText(input.generationId));
        sendJsonCommandResponse(response, rejection.statusCode, rejection.payload);
        return;
      }
      if (request.url === healthPath) {
        sendJsonCommandResponse(response, 200, { generationId: entry.generationId, ok: true, sessionId: entry.sessionId });
        return;
      }
      const result = await route.handle({
        commandService: entry.commandService, input, request, response, sessionId: entry.sessionId
      });
      if (result !== undefined && !response.destroyed) {
        sendJsonCommandResponse(response, route.status ? route.status(result) : 200, result);
      }
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      const payload = vibe64ErrorResponse(error, requestFailure);
      sendJsonCommandResponse(response, vibe64StatusCode(payload), errorBody(payload));
    }
  }

  function healthy(entry, sessionId, socketPath) {
    return unixJsonCommandServerIsHealthy(entry, { healthPath, sessionId, socketPath, timeoutMs: healthTimeoutMs });
  }

  async function prepare(commandService, sessionId, socketPath) {
    const existing = servers.get(socketPath);
    if (existing?.commandService === commandService && existing.sessionId === sessionId &&
      await healthy(existing, sessionId, socketPath)) {
      return existing;
    }
    await closeUnixJsonCommandServer(servers, socketPath, existing);
    await mkdir(path.dirname(socketPath), { recursive: true, ...(directoryMode ? { mode: directoryMode } : {}) });
    await removeDeadUnixJsonCommandSocket(socketPath, {
      healthPath,
      ownerErrorMessage: `The managed ${label} socket is owned by an unverified listener.`,
      timeoutMs: healthTimeoutMs
    });
    const entry = { commandService, generationId: randomUUID(), sessionId, socketPath, token: randomUUID() };
    for (const name of extraTokens) entry[name] = randomUUID();
    entry.server = http.createServer((request, response) => serve(entry, request, response));
    await listenUnixJsonCommandServer(entry.server, socketPath);
    servers.set(socketPath, entry);
    if (!await healthy(entry, sessionId, socketPath)) {
      await closeUnixJsonCommandServer(servers, socketPath, entry);
      await rm(socketPath, { force: true }).catch(() => null);
      throw Object.assign(new Error(`Managed ${label} control did not pass its ownership health check.`), {
        code: "vibe64_agent_control_unavailable"
      });
    }
    return entry;
  }

  // Returns the session's live server on socketPath, starting a new one with
  // fresh credentials when none is healthy. Preparations of one socket run
  // one at a time.
  async function ensure({ commandService, sessionId = "", socketPath = "" } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    for (let pending = preparations.get(socketPath); pending; pending = preparations.get(socketPath)) {
      await pending.catch(() => null);
    }
    const preparation = prepare(commandService, normalizedSessionId, socketPath);
    preparations.set(socketPath, preparation);
    try {
      return await preparation;
    } finally {
      if (preparations.get(socketPath) === preparation) preparations.delete(socketPath);
    }
  }

  async function close(socketPath = "") {
    await preparations.get(socketPath)?.catch(() => null);
    const entry = servers.get(socketPath);
    await closeUnixJsonCommandServer(servers, socketPath, entry, "session-closed");
    await rm(socketPath, { force: true }).catch(() => null);
    return entry?.server ? 1 : 0;
  }

  async function closeForSession(sessionId = "") {
    await Promise.all([...preparations.values()].map((preparation) => preparation.catch(() => null)));
    const normalizedSessionId = normalizeText(sessionId);
    let closed = 0;
    for (const [socketPath, entry] of [...servers.entries()]) {
      if (entry.sessionId === normalizedSessionId) closed += await close(socketPath);
    }
    return closed;
  }

  return Object.freeze({ close, closeForSession, ensure });
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
  createSessionCommandServers,
  removeDeadUnixJsonCommandSocket,
  requestUnixJsonCommand,
  sendJsonCommandResponse,
  shortCommandHash,
  subscribeUnixCommandControlChanges,
  unixCommandSocketPath,
  unixCommandSocketIsPresent,
  unixJsonCommandServerIsHealthy
};
