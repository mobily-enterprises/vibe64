import crypto from "node:crypto";
import http from "node:http";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  readSessionUiSyncStateForSession
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";

const AGENT_PREVIEW_COMMAND_NAME = "vibe64-preview";
const AGENT_PREVIEW_COMMAND_SOCKET_NAME = "preview-command.sock";
const AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;
const DEFAULT_PREVIEW_LOG_LINES = 200;
const DEFAULT_PREVIEW_WAIT_TIMEOUT_MS = 90_000;
const MAX_PREVIEW_LOG_LINES = 5000;
const PREVIEW_WAIT_POLL_INTERVAL_MS = 500;
const VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID";
const VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SOCKET";
const VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_TOKEN";

const commandServers = new Map();

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function stableHash(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 16);
}

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_COMMAND_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_COMMAND_SOCKET_NAME);
}

function readRequestBuffer(request, {
  maxBytes = AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES
} = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Vibe64 preview command input is too large.");
        error.code = "vibe64_agent_preview_command_input_too_large";
        reject(error);
        request.destroy(error);
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function readRequestJson(request) {
  const text = await readRequestBuffer(request);
  try {
    const parsed = JSON.parse(text || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    const error = new Error("Vibe64 preview command input must be valid JSON.");
    error.code = "vibe64_agent_preview_command_invalid_json";
    throw error;
  }
}

function sendJson(response, statusCode, payload = {}) {
  const text = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(text),
    "Content-Type": "application/json"
  });
  response.end(text);
}

function wrapperScriptSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const commandName = path.basename(process.argv[1] || "");

function fail(message, code = 1) {
  process.stderr.write(String(message || "Vibe64 preview command failed.") + "\\n");
  process.exit(code);
}

function requestSocket({ body, socketPath }) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/agent-preview-command/run",
      socketPath
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.once("end", () => resolve({
        statusCode: response.statusCode,
        text
      }));
    });
    request.once("error", reject);
    request.end(requestBody);
  });
}

if (commandName !== ${JSON.stringify(AGENT_PREVIEW_COMMAND_NAME)}) {
  fail("Vibe64 preview command wrapper was invoked with an unsupported command.");
}

const socketPath = process.env.${VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV} || "";
const sessionId = process.env.${VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV} || "";
const token = process.env.${VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV} || "";

if (!socketPath || !sessionId || !token) {
  fail("Vibe64 preview command identity is not available for this session.");
}

const response = await requestSocket({
  socketPath,
  body: {
    args: process.argv.slice(2),
    cwd: process.cwd(),
    sessionId,
    token
  }
}).catch((error) => {
  fail(error?.message || error || "Vibe64 preview command request failed.");
});

let payload = {};
try {
  payload = JSON.parse(response.text || "{}");
} catch {
  fail(response.text || "Vibe64 preview command returned invalid JSON.");
}

if (payload.stdout) {
  process.stdout.write(String(payload.stdout));
  if (!String(payload.stdout).endsWith("\\n")) {
    process.stdout.write("\\n");
  }
}
if (payload.stderr) {
  process.stderr.write(String(payload.stderr));
  if (!String(payload.stderr).endsWith("\\n")) {
    process.stderr.write("\\n");
  }
}
if (payload.ok === false && !payload.stderr && payload.error) {
  process.stderr.write(String(payload.error) + "\\n");
}

const exitCode = Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0);
process.exit(exitCode);
`;
}

async function writeWrapper({
  wrapperHostDir = ""
} = {}) {
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!normalizedWrapperHostDir) {
    return false;
  }
  await mkdir(normalizedWrapperHostDir, {
    recursive: true
  });
  const filePath = wrapperHostPath(normalizedWrapperHostDir);
  await writeExecutableFileIfChanged(filePath, wrapperScriptSource());
  return true;
}

function responseError(message = "", code = "vibe64_agent_preview_command_failed", extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
  };
}

function usageText() {
  return [
    "Usage:",
    "  vibe64-preview status [--json]",
    "  vibe64-preview logs [--lines <count>] [--json]",
    "  vibe64-preview restart [--wait] [--json] [--timeout-ms <ms>]",
    "",
    "This is the only preview server the agent may use for this Vibe64 session.",
    "Do not start npm, Vite, Next, JSKIT, or any other development server on another port."
  ].join("\n") + "\n";
}

function hasFlag(args = [], flag = "") {
  return args.includes(flag);
}

function optionValue(args = [], name = "") {
  const index = args.indexOf(name);
  if (index >= 0) {
    return normalizeText(args[index + 1]);
  }
  const prefix = `${name}=`;
  const entry = args.find((arg) => String(arg || "").startsWith(prefix));
  return entry ? normalizeText(entry.slice(prefix.length)) : "";
}

function parsePreviewCommandArgs(args = []) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg || "").trim()).filter(Boolean) : [];
  const command = values.find((arg) => !arg.startsWith("-")) || "";
  return {
    args: values,
    command,
    json: hasFlag(values, "--json"),
    lines: normalizeLogLines(optionValue(values, "--lines")),
    timeoutMs: normalizeTimeoutMs(optionValue(values, "--timeout-ms")),
    wait: hasFlag(values, "--wait")
  };
}

function normalizeLogLines(value = "") {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, MAX_PREVIEW_LOG_LINES)
    : DEFAULT_PREVIEW_LOG_LINES;
}

function normalizeTimeoutMs(value = "") {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : DEFAULT_PREVIEW_WAIT_TIMEOUT_MS;
}

function previewReady(status = {}) {
  return status?.previewTarget?.available !== false && Boolean(normalizeText(status?.previewTarget?.href));
}

function activeTerminalExited(status = {}, terminalSessionId = "") {
  const terminal = status?.activeTerminal || {};
  if (terminalSessionId && normalizeText(terminal.id) && normalizeText(terminal.id) !== normalizeText(terminalSessionId)) {
    return false;
  }
  return normalizeText(terminal.status) === "exited";
}

function previewEndpoint(value = "") {
  const url = normalizeText(value);
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const defaultPort = parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : 0;
    return {
      host: parsed.host,
      hostname: parsed.hostname,
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      port: Number(parsed.port) || defaultPort,
      protocol: parsed.protocol.replace(/:$/u, ""),
      url: parsed.toString()
    };
  } catch {
    return null;
  }
}

function previewPageUrl(baseUrl = "", route = "") {
  const normalizedBaseUrl = normalizeText(baseUrl);
  const normalizedRoute = normalizeText(route);
  if (!normalizedBaseUrl || !normalizedRoute.startsWith("/")) {
    return "";
  }
  try {
    return new URL(normalizedRoute, normalizedBaseUrl).toString();
  } catch {
    return "";
  }
}

function previewCurrentPage(previewState = {}, {
  agentUrl = "",
  browserUrl = ""
} = {}) {
  const route = normalizeText(previewState?.route);
  if (!route) {
    return null;
  }
  return {
    agentUrl: previewPageUrl(agentUrl, route),
    browserUrl: previewPageUrl(browserUrl, route),
    href: normalizeText(previewState?.href),
    observedAt: normalizeText(previewState?.updatedAt),
    projectSlug: normalizeText(previewState?.projectSlug),
    route,
    title: normalizeText(previewState?.title)
  };
}

function previewTerminal(status = {}) {
  const terminal = isRecord(status?.activeTerminal) ? status.activeTerminal : null;
  if (!terminal) {
    return null;
  }
  return {
    command: normalizeText(terminal.commandPreview),
    createdAt: normalizeText(terminal.createdAt),
    exitCode: terminal.exitCode ?? null,
    id: normalizeText(terminal.id),
    running: terminal.running === true,
    status: normalizeText(terminal.status)
  };
}

function previewDiagnostics(status = {}) {
  const metadata = isRecord(status?.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const sessionRoot = normalizeText(metadata.sessionRoot);
  return sessionRoot ? {
    latest: path.join(sessionRoot, "preview-last.json"),
    log: path.join(sessionRoot, "preview-log.jsonl")
  } : null;
}

function previewStatusSummary(status = {}, {
  previewState = null
} = {}) {
  const lastLaunchTarget = isRecord(status.lastLaunchTarget) ? status.lastLaunchTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const openTarget = isRecord(status.openTarget) ? status.openTarget : {};
  const previewTarget = isRecord(status.previewTarget) ? status.previewTarget : {};
  const agentUrl = normalizeText(lastLaunchTarget.agentHref || activeMetadata.previewProxyTargetHref || activeMetadata.targetUrl || openTarget.href);
  const browserUrl = normalizeText(openTarget.href || previewTarget.targetHref);
  const agentEndpoint = previewEndpoint(agentUrl);
  const browserEndpoint = previewEndpoint(browserUrl);
  return {
    currentPage: previewCurrentPage(previewState, {
      agentUrl: agentEndpoint?.url,
      browserUrl: browserEndpoint?.url
    }),
    diagnostics: previewDiagnostics(status),
    endpoints: {
      agent: agentEndpoint,
      browser: browserEndpoint,
      previewProxy: normalizeText(previewTarget.href) ? {
        url: normalizeText(previewTarget.href)
      } : null
    },
    launchTargetId: normalizeText(lastLaunchTarget.id || activeMetadata.launchTargetId),
    ready: previewReady(status),
    stale: previewTarget.stale === true || normalizeText(previewTarget.recovery?.reason) === "server_source_changed",
    terminal: previewTerminal(status)
  };
}

function statusStdout(summary = {}, {
  json = false
} = {}) {
  if (json) {
    return JSON.stringify(summary, null, 2) + "\n";
  }
  return [
    `Preview ready: ${summary.ready ? "yes" : "no"}`,
    `Preview running: ${summary.terminal?.running ? "yes" : "no"}`,
    summary.launchTargetId ? `Launch target: ${summary.launchTargetId}` : "",
    summary.endpoints?.agent?.url ? `Agent URL: ${summary.endpoints.agent.url}` : "",
    summary.endpoints?.agent?.hostname ? `Agent host: ${summary.endpoints.agent.hostname}` : "",
    summary.endpoints?.agent?.port ? `Agent port: ${summary.endpoints.agent.port}` : "",
    summary.endpoints?.browser?.url ? `Browser URL: ${summary.endpoints.browser.url}` : "",
    summary.endpoints?.previewProxy?.url ? `Preview proxy URL: ${summary.endpoints.previewProxy.url}` : "",
    summary.currentPage?.route ? `Current page: ${summary.currentPage.route}` : "Current page: not observed",
    summary.currentPage?.agentUrl ? `Current page agent URL: ${summary.currentPage.agentUrl}` : "",
    summary.terminal?.id ? `Terminal: ${summary.terminal.id} (${summary.terminal.status || "unknown"})` : "",
    `Stale: ${summary.stale ? "yes" : "no"}`
  ].filter(Boolean).join("\n") + "\n";
}

function previewLogTail(output = "", lines = DEFAULT_PREVIEW_LOG_LINES) {
  const normalizedOutput = String(output || "").replace(/\r\n/gu, "\n");
  const trailingNewline = normalizedOutput.endsWith("\n");
  const entries = normalizedOutput.split("\n");
  if (trailingNewline) {
    entries.pop();
  }
  const tail = entries.slice(-normalizeLogLines(lines)).join("\n");
  return tail && trailingNewline ? `${tail}\n` : tail;
}

function logsStdout(status = {}, summary = {}, {
  json = false,
  lines = DEFAULT_PREVIEW_LOG_LINES
} = {}) {
  const output = previewLogTail(status?.activeTerminal?.output, lines);
  const payload = {
    diagnostics: summary.diagnostics,
    launchTargetId: summary.launchTargetId,
    lineLimit: normalizeLogLines(lines),
    output,
    terminal: summary.terminal
  };
  if (json) {
    return JSON.stringify(payload, null, 2) + "\n";
  }
  const header = [
    summary.terminal?.id
      ? `Managed preview logs: ${summary.terminal.id} (${summary.terminal.status || "unknown"})`
      : "Managed preview logs: no terminal",
    `Showing up to ${payload.lineLimit} lines.`,
    summary.diagnostics?.log ? `Preview diagnostic log: ${summary.diagnostics.log}` : ""
  ].filter(Boolean).join("\n");
  return `${header}\n\n${output || "No managed preview server output is available."}${output.endsWith("\n") ? "" : "\n"}`;
}

function restartStdout(summary = {}, {
  json = false
} = {}) {
  if (json) {
    return JSON.stringify(summary, null, 2) + "\n";
  }
  return [
    `Restarted preview${summary.launchTargetId ? ` ${summary.launchTargetId}` : ""}.`,
    `Preview ready: ${summary.ready ? "yes" : "no"}`,
    summary.endpoints?.agent?.url ? `Agent URL: ${summary.endpoints.agent.url}` : "",
    summary.endpoints?.agent?.hostname ? `Agent host: ${summary.endpoints.agent.hostname}` : "",
    summary.endpoints?.agent?.port ? `Agent port: ${summary.endpoints.agent.port}` : "",
    summary.endpoints?.browser?.url ? `Browser URL: ${summary.endpoints.browser.url}` : "",
    summary.endpoints?.previewProxy?.url ? `Preview proxy URL: ${summary.endpoints.previewProxy.url}` : "",
    summary.currentPage?.route ? `Current page: ${summary.currentPage.route}` : ""
  ].filter(Boolean).join("\n") + "\n";
}

function launchInputFromStatus(status = {}) {
  const lastLaunchTarget = isRecord(status.lastLaunchTarget) ? status.lastLaunchTarget : {};
  if (isRecord(lastLaunchTarget.launchInput)) {
    return lastLaunchTarget.launchInput;
  }
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  return isRecord(activeMetadata.launchInput) ? activeMetadata.launchInput : {};
}

function launchTargetIdFromStatus(status = {}) {
  const lastLaunchTarget = isRecord(status.lastLaunchTarget) ? status.lastLaunchTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  return normalizeText(lastLaunchTarget.id || activeMetadata.launchTargetId);
}

async function waitForPreviewReady(launchTarget, sessionId = "", {
  terminalSessionId = "",
  timeoutMs = DEFAULT_PREVIEW_WAIT_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let latestStatus = null;
  while (Date.now() <= deadline) {
    latestStatus = await launchTarget.launchStatus(sessionId);
    if (latestStatus?.ok === false) {
      return {
        ok: false,
        status: latestStatus
      };
    }
    if (previewReady(latestStatus)) {
      return {
        ok: true,
        status: latestStatus
      };
    }
    if (activeTerminalExited(latestStatus, terminalSessionId)) {
      return {
        ok: false,
        status: latestStatus
      };
    }
    await delay(PREVIEW_WAIT_POLL_INTERVAL_MS);
  }
  return {
    ok: false,
    status: latestStatus,
    timeout: true
  };
}

function logPreviewCommandResult(logger, result = {}, fields = {}) {
  const ok = result?.ok !== false && Number(result?.exitCode || 0) === 0;
  return logOperationalEvent(logger, ok ? "info" : "warn", {
    code: result?.code || "",
    command: normalizeText(fields.command),
    component: "vibe64.agent_preview_command",
    cwd: normalizeText(fields.cwd),
    durationMs: Number(fields.durationMs || 0),
    event: "vibe64.agent_preview_command.finished",
    exitCode: Number(result?.exitCode ?? (ok ? 0 : 1)),
    ok,
    outputTail: ok ? "" : sanitizeLogText(result.stderr || result.error || "").slice(-1000),
    sessionId: normalizeText(fields.sessionId)
  }, "Vibe64 agent preview command finished.");
}

function createAgentPreviewCommandService({
  launchTarget = null,
  logger = null,
  readSessionUiState = readSessionUiSyncStateForSession
} = {}) {
  function statusSummary(status = {}, sessionId = "") {
    let uiState = null;
    try {
      uiState = typeof readSessionUiState === "function"
        ? readSessionUiState(sessionId)
        : null;
    } catch {
      uiState = null;
    }
    return previewStatusSummary(status, {
      previewState: uiState?.preview || null
    });
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const parsed = parsePreviewCommandArgs(input.args);
    const sessionId = normalizeText(input.sessionId);
    const baseFields = {
      command: parsed.command,
      cwd: normalizeText(input.cwd),
      sessionId
    };
    const finish = (result = {}) => {
      logPreviewCommandResult(logger, result, {
        ...baseFields,
        durationMs: Date.now() - startedAtMs
      });
      return result;
    };

    if (!sessionId) {
      return finish(responseError("Vibe64 preview command session id is required.", "vibe64_agent_preview_command_session_required"));
    }
    if (!launchTarget || typeof launchTarget.launchStatus !== "function" || typeof launchTarget.startTerminal !== "function") {
      return finish(responseError("Vibe64 preview control is not available.", "vibe64_agent_preview_command_unavailable"));
    }
    if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
      return finish({
        exitCode: 0,
        ok: true,
        stdout: usageText()
      });
    }
    if (parsed.command === "status") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview status failed."}\n`
        });
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: statusStdout(statusSummary(status, sessionId), {
          json: parsed.json
        })
      });
    }
    if (parsed.command === "logs") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview logs failed."}\n`
        });
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: logsStdout(status, statusSummary(status, sessionId), {
          json: parsed.json,
          lines: parsed.lines
        })
      });
    }
    if (parsed.command !== "restart") {
      return finish(responseError(`Unknown Vibe64 preview command: ${parsed.command}`, "vibe64_agent_preview_command_unknown", {
        exitCode: 2,
        stderr: usageText()
      }));
    }

    const beforeStatus = await launchTarget.launchStatus(sessionId);
    if (beforeStatus?.ok === false) {
      return finish({
        ...beforeStatus,
        exitCode: 1,
        stderr: `${beforeStatus.error || "Vibe64 preview status failed."}\n`
      });
    }
    const launchTargetId = launchTargetIdFromStatus(beforeStatus);
    if (!launchTargetId) {
      return finish(responseError("No managed Vibe64 launch target has been started for this session.", "vibe64_agent_preview_command_no_launch_target", {
        exitCode: 1
      }));
    }
    const started = await launchTarget.startTerminal(sessionId, {
      forceRestart: true,
      launchInput: launchInputFromStatus(beforeStatus),
      launchTargetId
    });
    if (started?.ok === false) {
      return finish({
        ...started,
        exitCode: 1,
        stderr: `${started.error || "Vibe64 preview restart failed."}\n`
      });
    }
    let status = await launchTarget.launchStatus(sessionId);
    let timedOut = false;
    if (parsed.wait) {
      const waited = await waitForPreviewReady(launchTarget, sessionId, {
        terminalSessionId: started.id,
        timeoutMs: parsed.timeoutMs
      });
      status = waited.status || status;
      timedOut = waited.timeout === true;
      if (!waited.ok) {
        const summary = statusSummary(status || {}, sessionId);
        return finish(responseError(
          timedOut
            ? "Timed out waiting for Vibe64 preview to become ready."
            : "Vibe64 preview did not become ready.",
          timedOut ? "vibe64_agent_preview_command_wait_timeout" : "vibe64_agent_preview_command_not_ready",
          {
            exitCode: 1,
            stdout: restartStdout({
              ...summary,
              restarted: true,
              timedOut
            }, {
              json: parsed.json
            })
          }
        ));
      }
    }
    return finish({
      exitCode: 0,
      ok: true,
      stdout: restartStdout({
        ...statusSummary(status || {}, sessionId),
        restarted: true
      }, {
        json: parsed.json
      })
    });
  }

  return Object.freeze({
    run
  });
}

function verifyRequestToken(input = {}, expectedToken = "") {
  return normalizeText(input.token) && normalizeText(input.token) === normalizeText(expectedToken);
}

function commandServerToken({
  sessionId = "",
  socketPath = "",
  wrapperHostDir = ""
} = {}) {
  return stableHash([
    "agent-preview-command-token",
    normalizeText(sessionId),
    normalizeText(socketPath),
    normalizeText(wrapperHostDir)
  ].join("\n"));
}

async function ensureAgentPreviewCommandServer({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const socketPath = commandSocketHostPath(wrapperHostDir);
  const existing = commandServers.get(socketPath);
  if (existing?.commandService === commandService) {
    return existing.promise || existing;
  }
  if (existing?.promise) {
    await existing.promise.catch(() => null);
    const current = commandServers.get(socketPath);
    if (current?.commandService === commandService) {
      return current.promise || current;
    }
  }
  if (existing?.server) {
    await new Promise((resolve) => {
      existing.server.close(() => resolve());
    }).catch(() => null);
    commandServers.delete(socketPath);
  }
  const promise = (async () => {
    await mkdir(path.dirname(socketPath), {
      recursive: true
    });
    await rm(socketPath, {
      force: true
    });
    const token = commandServerToken({
      sessionId,
      socketPath,
      wrapperHostDir
    });
    const server = http.createServer(async (request, response) => {
      try {
        if (request.method === "POST" && request.url === "/agent-preview-command/run") {
          const input = await readRequestJson(request);
          if (!verifyRequestToken(input, token)) {
            sendJson(response, 403, responseError("Vibe64 preview command token is invalid.", "vibe64_agent_preview_command_token_invalid"));
            return;
          }
          sendJson(response, 200, await commandService.run(input));
          return;
        }
        sendJson(response, 404, responseError("Unknown Vibe64 preview command route.", "vibe64_agent_preview_command_route_not_found"));
      } catch (error) {
        const payload = vibe64ErrorResponse(error, {
          fallbackCode: "vibe64_agent_preview_command_request_failed",
          fallbackMessage: "Vibe64 preview command request failed."
        });
        sendJson(response, vibe64StatusCode(payload), payload);
      }
    });
    const listenResult = await new Promise((resolve, reject) => {
      const handleError = (error) => {
        if (error?.code === "EADDRINUSE") {
          resolve("reused");
          return;
        }
        reject(error);
      };
      server.once("error", handleError);
      server.listen(socketPath, () => {
        server.off("error", handleError);
        resolve("listening");
      });
    });
    if (listenResult === "reused") {
      server.close(() => null);
      const current = commandServers.get(socketPath);
      if (current?.server) {
        return current;
      }
    } else {
      server.unref?.();
    }
    const stored = {
      commandService,
      server: listenResult === "reused" ? null : server,
      token
    };
    commandServers.set(socketPath, stored);
    return stored;
  })();
  commandServers.set(socketPath, {
    commandService,
    promise
  });
  try {
    return await promise;
  } catch (error) {
    if (commandServers.get(socketPath)?.promise === promise) {
      commandServers.delete(socketPath);
    }
    throw error;
  }
}

async function prepareAgentPreviewCommand({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!commandService || !normalizedSessionId || !normalizedWrapperHostDir) {
    return {
      env: {},
      ok: false
    };
  }
  await writeWrapper({
    wrapperHostDir: normalizedWrapperHostDir
  });
  const server = await ensureAgentPreviewCommandServer({
    commandService,
    sessionId: normalizedSessionId,
    wrapperHostDir: normalizedWrapperHostDir
  });
  return {
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token
    },
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
};
