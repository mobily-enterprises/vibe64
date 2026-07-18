import crypto from "node:crypto";
import http from "node:http";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "@local/vibe64-core/server/previewAuth";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  readSessionUiSyncStateForSession
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  agentPlaywrightCommandSource,
  agentPreviewBrowserWorkerSource,
  agentPreviewWrapperSource,
  runtimePackBinPaths,
  runtimePackRoot
} from "@local/vibe64-execution/server";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";

const AGENT_PREVIEW_COMMAND_NAME = "vibe64-preview";
const AGENT_PLAYWRIGHT_COMMAND_NAME = "vibe64-playwright";
const AGENT_PREVIEW_BROWSER_WORKER_NAME = "vibe64-preview-browser-worker";
const AGENT_PREVIEW_BROWSER_SOCKET_NAME = "preview-browser.sock";
const AGENT_PREVIEW_BROWSER_METADATA_NAME = "preview-browser.json";
const AGENT_PREVIEW_COMMAND_SOCKET_NAME = "preview-command.sock";
const AGENT_PREVIEW_COMMAND_CONTRACT_VERSION = "7";
const AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;
const AGENT_PREVIEW_COMMAND_ROUTES = new Set([
  "/agent-preview-command/health",
  "/agent-preview-command/identity",
  "/agent-preview-command/run"
]);
const DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PREVIEW_LOG_LINES = 200;
const DEFAULT_PREVIEW_WAIT_TIMEOUT_MS = 90_000;
const MAX_PREVIEW_LOG_LINES = 5000;
const PREVIEW_WAIT_POLL_INTERVAL_MS = 500;
const VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID";
const VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SOCKET";
const VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_TOKEN";
const VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION";

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

function agentPlaywrightHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PLAYWRIGHT_COMMAND_NAME);
}

function browserWorkerHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_WORKER_NAME);
}

function browserSocketHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_SOCKET_NAME);
}

function browserMetadataHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_METADATA_NAME);
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

async function writeWrapper({
  agentPlaywrightSource = "",
  browserWorkerSource = "",
  previewWrapperSource = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!normalizedWrapperHostDir) {
    return false;
  }
  await mkdir(normalizedWrapperHostDir, {
    recursive: true
  });
  await Promise.all([
    writeExecutableFileIfChanged(
      wrapperHostPath(normalizedWrapperHostDir),
      previewWrapperSource
    ),
    writeExecutableFileIfChanged(
      browserWorkerHostPath(normalizedWrapperHostDir),
      browserWorkerSource
    ),
    writeExecutableFileIfChanged(
      agentPlaywrightHostPath(normalizedWrapperHostDir),
      agentPlaywrightSource
    )
  ]);
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
    "  vibe64-preview ensure [--wait] [--json] [--timeout-ms <ms>]",
    "  vibe64-preview status [--json]",
    "  vibe64-preview inspect-url",
    "  vibe64-preview screenshot [--output <path>]",
    "  vibe64-preview browser ensure",
    "  vibe64-preview browser eval < playwright-code.js",
    "  vibe64-preview browser identity <you|guest|existing-user-identifier>",
    "  vibe64-preview browser screenshot [--output <path>]",
    "  vibe64-preview browser status",
    "  vibe64-preview browser reset",
    "  vibe64-preview browser close",
    "  vibe64-preview logs [--lines <count>] [--json]",
    "  vibe64-preview restart [--wait] [--json] [--timeout-ms <ms>]",
    "  vibe64-playwright test [playwright test arguments]",
    "  vibe64-playwright npm-run <package-script> [-- script arguments]",
    "",
    "Screenshot commands emit JSON metadata for a uniquely named, immutable PNG.",
    "This is the canonical preview server for the configured primary application.",
    "Do not start a duplicate copy of that application on another port.",
    "A distinct secondary application explicitly requested by the user, such as a legacy reference app, may run separately without replacing this preview."
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
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    const defaultPort = parsed.protocol === "https:" ? 443 : 80;
    return {
      hostname: parsed.hostname,
      port: Number(parsed.port) || defaultPort,
      url: parsed.toString()
    };
  } catch {
    return null;
  }
}

function previewPageUrl(baseUrl = "", route = "", {
  inheritBaseSearch = false
} = {}) {
  const normalizedBaseUrl = normalizeText(baseUrl);
  const normalizedRoute = normalizeText(route);
  if (!normalizedBaseUrl || !normalizedRoute.startsWith("/")) {
    return "";
  }
  try {
    const base = new URL(normalizedBaseUrl);
    const page = new URL(normalizedRoute, base);
    if (inheritBaseSearch) {
      for (const [name, value] of base.searchParams) {
        if (!page.searchParams.has(name)) {
          page.searchParams.append(name, value);
        }
      }
    }
    return page.toString();
  } catch {
    return "";
  }
}

function previewInspectionUrl(status = {}, {
  previewState = null
} = {}) {
  const previewTarget = isRecord(status.previewTarget) ? status.previewTarget : {};
  const proxyUrl = normalizeText(previewTarget.href);
  const route = normalizeText(previewState?.route);
  if (proxyUrl) {
    return route
      ? previewPageUrl(proxyUrl, route, {
          inheritBaseSearch: true
        }) || proxyUrl
      : proxyUrl;
  }
  const summary = previewStatusSummary(status, {
    previewState
  });
  return normalizeText(summary.currentPage?.agentUrl || summary.endpoints?.agent?.url);
}

function previewCurrentPage(previewState = {}, {
  agentUrl = ""
} = {}) {
  const route = normalizeText(previewState?.route);
  if (!route) {
    return null;
  }
  return {
    agentUrl: previewPageUrl(agentUrl, route),
    observedAt: normalizeText(previewState?.updatedAt),
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
      agentUrl: agentEndpoint?.url
    }),
    diagnostics: previewDiagnostics(status),
    endpoints: {
      agent: agentEndpoint,
      browser: browserEndpoint
    },
    launchTargetId: normalizeText(lastLaunchTarget.id || activeMetadata.launchTargetId),
    ready: previewReady(status),
    stale: previewTarget.stale === true || normalizeText(previewTarget.recovery?.reason) === "server_source_changed",
    terminal: previewTerminal(status)
  };
}

function previewSummaryLines(summary = {}) {
  return [
    `Preview ready: ${summary.ready ? "yes" : "no"}`,
    `Preview running: ${summary.terminal?.running ? "yes" : "no"}`,
    summary.launchTargetId ? `Launch target: ${summary.launchTargetId}` : "",
    summary.endpoints?.agent?.url ? `Agent URL: ${summary.endpoints.agent.url}` : "",
    summary.endpoints?.agent?.hostname ? `Agent host: ${summary.endpoints.agent.hostname}` : "",
    summary.endpoints?.agent?.port ? `Agent port: ${summary.endpoints.agent.port}` : "",
    summary.endpoints?.browser?.url ? `Browser URL: ${summary.endpoints.browser.url}` : "",
    summary.currentPage?.route ? `Current page: ${summary.currentPage.route}` : "Current page: not observed",
    summary.currentPage?.agentUrl ? `Current page agent URL: ${summary.currentPage.agentUrl}` : "",
    summary.terminal?.id ? `Terminal: ${summary.terminal.id} (${summary.terminal.status || "unknown"})` : "",
    `Stale: ${summary.stale ? "yes" : "no"}`
  ].filter(Boolean);
}

function statusStdout(summary = {}, {
  json = false
} = {}) {
  return json
    ? JSON.stringify(summary, null, 2) + "\n"
    : previewSummaryLines(summary).join("\n") + "\n";
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

function logsStdout(status = {}, {
  json = false,
  lines = DEFAULT_PREVIEW_LOG_LINES
} = {}) {
  const output = previewLogTail(status?.activeTerminal?.output, lines);
  const payload = {
    diagnostics: previewDiagnostics(status),
    launchTargetId: launchTargetIdFromStatus(status),
    lineLimit: normalizeLogLines(lines),
    output,
    terminal: previewTerminal(status)
  };
  if (json) {
    return JSON.stringify(payload, null, 2) + "\n";
  }
  const header = [
    payload.terminal?.id
      ? `Managed preview logs: ${payload.terminal.id} (${payload.terminal.status || "unknown"})`
      : "Managed preview logs: no terminal",
    `Showing up to ${payload.lineLimit} lines.`,
    payload.diagnostics?.log ? `Preview diagnostic log: ${payload.diagnostics.log}` : ""
  ].filter(Boolean).join("\n");
  return `${header}\n\n${output || "No managed preview server output is available."}${output.endsWith("\n") ? "" : "\n"}`;
}

function previewStartStdout(summary = {}, {
  command = "ensure",
  json = false
} = {}) {
  const payload = command === "restart"
    ? {
        ...summary,
        restarted: true
      }
    : {
        ...summary,
        ensured: true
      };
  if (json) {
    return JSON.stringify(payload, null, 2) + "\n";
  }
  return [
    command === "restart" ? "Restarted preview." : "Preview is ready.",
    ...previewSummaryLines(payload)
  ].join("\n") + "\n";
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
  const browserWorkers = new Map();
  const sessionViewers = new Map();

  function registerViewer(sessionId = "", vibe64User = null) {
    const normalizedSessionId = normalizeText(sessionId);
    const email = normalizeText(vibe64User?.email).toLowerCase();
    const login = normalizeText(vibe64User?.username || vibe64User?.login);
    const userId = normalizeText(vibe64User?.id || vibe64User?.userId);
    if (!normalizedSessionId) {
      return false;
    }
    if (!email && !login && !userId) {
      sessionViewers.delete(normalizedSessionId);
      return false;
    }
    sessionViewers.set(normalizedSessionId, {
      displayName: normalizeText(
        vibe64User?.displayName || vibe64User?.name || login || email || userId
      ) || login || email || userId,
      ...(email ? { email } : {}),
      ...(login ? { login, username: login } : {}),
      ...(userId ? { id: userId, userId } : {})
    });
    return true;
  }

  async function authorizeBrowserIdentity(sessionId = "", identity = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const requested = normalizeText(identity);
    const reservedIdentity = requested.toLowerCase();
    if (!normalizedSessionId) {
      return responseError(
        "Vibe64 preview command session id is required.",
        "vibe64_agent_preview_command_session_required"
      );
    }
    if (!requested) {
      return responseError(
        "Choose you, guest, or an existing application user's identifier.",
        "vibe64_agent_preview_identity_required"
      );
    }
    if (!launchTarget || typeof launchTarget.selectPreviewIdentity !== "function") {
      return responseError(
        "Vibe64 preview identity control is not available.",
        "vibe64_agent_preview_identity_unavailable"
      );
    }
    if (reservedIdentity === "you") {
      const viewer = sessionViewers.get(normalizedSessionId);
      if (!viewer) {
        return responseError(
          "The Vibe64 user who authorized this agent turn is unavailable. Send the agent a new message, then retry.",
          "vibe64_agent_preview_viewer_unavailable"
        );
      }
      return launchTarget.selectPreviewIdentity(normalizedSessionId, {
        mode: "viewer",
        vibe64User: viewer
      });
    }
    if (reservedIdentity === "guest") {
      return launchTarget.selectPreviewIdentity(normalizedSessionId, {
        mode: "guest"
      });
    }
    return launchTarget.selectPreviewIdentity(normalizedSessionId, {
      identityValue: requested,
      mode: "user"
    });
  }

  function registerBrowserWorker(sessionId = "", descriptor = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const socketPath = normalizeText(descriptor.socketPath);
    if (!normalizedSessionId || !socketPath) {
      return false;
    }
    const sessionWorkers = browserWorkers.get(normalizedSessionId) || new Map();
    sessionWorkers.set(socketPath, {
      ...descriptor,
      sessionId: normalizedSessionId,
      socketPath
    });
    browserWorkers.set(normalizedSessionId, sessionWorkers);
    return true;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const sessionWorkers = browserWorkers.get(normalizedSessionId) || new Map();
    browserWorkers.delete(normalizedSessionId);
    sessionViewers.delete(normalizedSessionId);
    let closed = 0;
    for (const descriptor of sessionWorkers.values()) {
      await closeRegisteredBrowserWorker(descriptor);
      closed += 1;
    }
    await closeAgentPreviewCommandServersForSession(normalizedSessionId);
    return {
      closed,
      ok: true
    };
  }

  async function releaseControlForSession(sessionId = "") {
    await closeAgentPreviewCommandServersForSession(sessionId);
    return {
      ok: true
    };
  }

  function statusSummary(status = {}, sessionId = "") {
    const uiState = typeof readSessionUiState === "function"
      ? readSessionUiState(sessionId)
      : null;
    return previewStatusSummary(status, {
      previewState: uiState?.preview || null
    });
  }

  function inspectionUrl(status = {}, sessionId = "") {
    const uiState = typeof readSessionUiState === "function"
      ? readSessionUiState(sessionId)
      : null;
    return previewInspectionUrl(status, {
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
    if (!launchTarget || typeof launchTarget.launchStatus !== "function") {
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
    if (parsed.command === "inspect-url") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview status failed."}\n`
        });
      }
      const url = inspectionUrl(status, sessionId);
      if (!url) {
        return finish(responseError(
          "Managed preview inspection URL is unavailable. Run vibe64-preview ensure --wait --json first.",
          "vibe64_agent_preview_command_inspection_url_unavailable",
          {
            exitCode: 1
          }
        ));
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: `${url}\n`
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
        stdout: logsStdout(status, {
          json: parsed.json,
          lines: parsed.lines
        })
      });
    }
    if (!["ensure", "restart"].includes(parsed.command)) {
      return finish(responseError(`Unknown Vibe64 preview command: ${parsed.command}`, "vibe64_agent_preview_command_unknown", {
        exitCode: 2,
        stderr: usageText()
      }));
    }
    const ensuring = parsed.command === "ensure";
    if (ensuring && typeof launchTarget.ensurePreview !== "function") {
      return finish(responseError("Vibe64 managed preview startup is not available.", "vibe64_agent_preview_command_ensure_unavailable"));
    }
    if (!ensuring && typeof launchTarget.restartPreview !== "function") {
      return finish(responseError("Vibe64 preview restart is not available.", "vibe64_agent_preview_command_restart_unavailable"));
    }

    let started;
    if (ensuring) {
      started = await launchTarget.ensurePreview(sessionId);
    } else {
      started = await launchTarget.restartPreview(sessionId);
    }
    if (started?.ok === false) {
      return finish({
        ...started,
        exitCode: 1,
        stderr: `${started.error || (ensuring ? "Vibe64 managed preview could not start." : "Vibe64 preview restart failed.")}\n`
      });
    }
    let status = await launchTarget.launchStatus(sessionId);
    if (parsed.wait) {
      const waited = await waitForPreviewReady(launchTarget, sessionId, {
        terminalSessionId: started.id,
        timeoutMs: parsed.timeoutMs
      });
      status = waited.status || status;
      if (!waited.ok) {
        const timedOut = waited.timeout === true;
        const summary = statusSummary(status || {}, sessionId);
        return finish(responseError(
          timedOut
            ? "Timed out waiting for Vibe64 preview to become ready."
            : "Vibe64 preview did not become ready.",
          timedOut ? "vibe64_agent_preview_command_wait_timeout" : "vibe64_agent_preview_command_not_ready",
          {
            exitCode: 1,
            stdout: previewStartStdout({
              ...summary,
              timedOut
            }, {
              command: parsed.command,
              json: parsed.json
            })
          }
        ));
      }
    }
    return finish({
      exitCode: 0,
      ok: true,
      stdout: previewStartStdout(statusSummary(status || {}, sessionId), {
        command: parsed.command,
        json: parsed.json
      })
    });
  }

  return Object.freeze({
    authorizeBrowserIdentity,
    closeAllForSession,
    registerBrowserWorker,
    registerViewer,
    releaseControlForSession,
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

function browserWorkerToken({
  commandToken = "",
  sessionId = ""
} = {}) {
  return crypto
    .createHash("sha256")
    .update([
      "vibe64-preview-browser",
      normalizeText(sessionId),
      normalizeText(commandToken)
    ].join("\n"))
    .digest("hex");
}

function normalizedBrowserProcessGroups(value = []) {
  const groups = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const groupId = Number(entry?.groupId);
    const startTimeTicks = normalizeText(entry?.startTimeTicks);
    if (Number.isSafeInteger(groupId) && groupId > 1 && startTimeTicks) {
      groups.set(groupId, {
        groupId,
        startTimeTicks
      });
    }
  }
  return [...groups.values()].sort((left, right) => left.groupId - right.groupId);
}

function browserWorkerMetadataSignature(metadata = {}, token = "") {
  return crypto
    .createHash("sha256")
    .update([
      normalizeText(token),
      normalizeText(metadata.contractVersion),
      String(metadata.pid || ""),
      normalizeText(metadata.socketPath),
      normalizeText(metadata.startTimeTicks),
      normalizeText(metadata.startedAt),
      normalizeText(metadata.workerScriptPath),
      JSON.stringify(normalizedBrowserProcessGroups(metadata.browserProcessGroups))
    ].join("\n"))
    .digest("hex");
}

function browserWorkerRequest({
  input = {},
  socketPath = "",
  token = "",
  timeoutMs = 2000
} = {}) {
  const body = JSON.stringify({
    ...input,
    token
  });
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/command",
      socketPath,
      timeout: timeoutMs
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error("Managed browser close timed out.")));
    request.end(body);
  });
}

async function processGroupIsAlive(groupId) {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) {
    return false;
  }
  try {
    for (const entry of await readdir("/proc", {
      withFileTypes: true
    })) {
      if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
        continue;
      }
      const identity = await registeredProcessIdentity(Number(entry.name));
      if (identity?.groupId === groupId && identity.state !== "Z") {
        return true;
      }
    }
    return false;
  } catch {
    try {
      process.kill(-groupId, 0);
      return true;
    } catch {
      return false;
    }
  }
}

async function registeredProcessIdentity(pid) {
  try {
    const statText = await readFile(`/proc/${pid}/stat`, "utf8");
    const closeIndex = statText.lastIndexOf(") ");
    const fields = statText.slice(closeIndex + 2).trim().split(/\s+/u);
    return {
      groupId: Number(fields[2]),
      startTimeTicks: String(fields[19] || ""),
      state: String(fields[0] || "")
    };
  } catch {
    return null;
  }
}

async function registeredProcessGroupIsAlive(entry = {}) {
  const groupId = Number(entry?.groupId);
  const identity = await registeredProcessIdentity(groupId);
  return Boolean(
    identity &&
    identity.groupId === groupId &&
    identity.startTimeTicks === normalizeText(entry?.startTimeTicks) &&
    await processGroupIsAlive(groupId)
  );
}

async function registeredWorkerMetadata(descriptor = {}) {
  try {
    const metadata = JSON.parse(await readFile(descriptor.metadataPath, "utf8"));
    const pid = Number(metadata?.pid);
    const identity = await registeredProcessIdentity(pid);
    if (
      metadata?.socketPath !== descriptor.socketPath ||
      metadata?.workerScriptPath !== descriptor.workerScriptPath ||
      metadata?.signature !== browserWorkerMetadataSignature(metadata, descriptor.token)
    ) {
      return null;
    }
    if (!identity) {
      const startedAtMs = Date.parse(normalizeText(metadata.startedAt));
      const ownsBrowserGroup = (await Promise.all(
        normalizedBrowserProcessGroups(metadata?.browserProcessGroups)
          .map((entry) => registeredProcessGroupIsAlive(entry))
      )).some(Boolean);
      return Number.isFinite(startedAtMs) &&
        Date.now() - startedAtMs < 24 * 60 * 60 * 1000 &&
        (await processGroupIsAlive(pid) || ownsBrowserGroup)
        ? metadata
        : null;
    }
    if (identity.groupId !== pid || identity.startTimeTicks !== String(metadata?.startTimeTicks || "")) {
      return null;
    }
    if (identity.state === "Z") {
      return metadata;
    }
    try {
      const commandLine = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
      if (!commandLine.includes(descriptor.workerScriptPath) || !commandLine.includes(descriptor.socketPath)) {
        return null;
      }
    } catch {
      // Signed metadata and the matching process identity already establish ownership.
    }
    return metadata;
  } catch {
    return null;
  }
}

async function terminateProcessGroup(groupId, expectedStartTimeTicks = "") {
  if (expectedStartTimeTicks) {
    const identity = await registeredProcessIdentity(groupId);
    if (
      !identity ||
      identity.groupId !== groupId ||
      identity.startTimeTicks !== normalizeText(expectedStartTimeTicks)
    ) {
      return;
    }
  }
  if (!await processGroupIsAlive(groupId)) {
    return;
  }
  try {
    process.kill(-groupId, "SIGTERM");
  } catch {
    try {
      process.kill(groupId, "SIGTERM");
    } catch {
      return;
    }
  }
  for (let attempt = 0; attempt < 20 && await processGroupIsAlive(groupId); attempt += 1) {
    await delay(50);
  }
  if (!await processGroupIsAlive(groupId)) {
    return;
  }
  try {
    process.kill(-groupId, "SIGKILL");
  } catch {
    try {
      process.kill(groupId, "SIGKILL");
    } catch {
      // The process group exited before the fallback signal was sent.
    }
  }
}

async function terminateRegisteredWorker(metadata = null) {
  const pid = Number(metadata?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return;
  }
  const browserGroups = [];
  for (const entry of normalizedBrowserProcessGroups(metadata?.browserProcessGroups)) {
    if (await registeredProcessGroupIsAlive(entry)) {
      browserGroups.push(entry);
    }
  }
  await Promise.all([
    terminateProcessGroup(pid, metadata?.startTimeTicks),
    ...browserGroups.map((entry) => terminateProcessGroup(entry.groupId, entry.startTimeTicks))
  ]);
}

async function closeRegisteredBrowserWorker(descriptor = {}) {
  const metadata = await registeredWorkerMetadata(descriptor);
  await browserWorkerRequest({
    input: {
      command: "close"
    },
    socketPath: descriptor.socketPath,
    token: descriptor.token
  }).catch(() => null);
  await terminateRegisteredWorker(metadata);
  await Promise.all([
    rm(descriptor.socketPath, {
      force: true
    }),
    rm(descriptor.metadataPath, {
      force: true
    })
  ]).catch(() => null);
}

async function closeAgentPreviewCommandServersForSession(sessionId = "") {
  const normalizedSessionId = normalizeText(sessionId);
  for (const [socketPath, entryValue] of [...commandServers.entries()]) {
    const entry = entryValue?.promise
      ? await entryValue.promise.catch(() => null)
      : entryValue;
    if (normalizeText(entry?.sessionId) !== normalizedSessionId) {
      continue;
    }
    if (entry?.server) {
      await new Promise((resolve) => entry.server.close(() => resolve())).catch(() => null);
    }
    commandServers.delete(socketPath);
    await rm(socketPath, {
      force: true
    }).catch(() => null);
  }
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
        if (request.method !== "POST" || !AGENT_PREVIEW_COMMAND_ROUTES.has(request.url)) {
          sendJson(response, 404, responseError("Unknown Vibe64 preview command route.", "vibe64_agent_preview_command_route_not_found"));
          return;
        }
        const input = await readRequestJson(request);
        if (!verifyRequestToken(input, token) || normalizeText(input.sessionId) !== normalizeText(sessionId)) {
          sendJson(response, 403, responseError("Vibe64 preview command token is invalid.", "vibe64_agent_preview_command_token_invalid"));
          return;
        }
        if (request.url === "/agent-preview-command/health") {
          sendJson(response, 200, {
            ok: true,
            sessionId: normalizeText(sessionId)
          });
          return;
        }
        if (request.url === "/agent-preview-command/identity") {
          const payload = await commandService.authorizeBrowserIdentity(
            sessionId,
            input.identity
          );
          sendJson(response, vibe64StatusCode(payload), payload);
          return;
        }
        if (request.url === "/agent-preview-command/run") {
          sendJson(response, 200, await commandService.run(input));
          return;
        }
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
      sessionId: normalizeText(sessionId),
      socketPath,
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
  browserIdleTimeoutMs = DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS,
  browserControlHealthFailureLimit = 4,
  browserControlHealthIntervalMs = 15_000,
  commandService,
  env = process.env,
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
  const packRoot = runtimePackRoot({
    env
  });
  const [nodeBinDir] = runtimePackBinPaths("node22", {
    env
  });
  const managedNodePath = path.join(nodeBinDir, "node");
  const managedNpmPath = path.join(nodeBinDir, "npm");
  const workerScriptPath = browserWorkerHostPath(normalizedWrapperHostDir);
  const playwrightModulePath = path.join(
    packRoot,
    "playwright",
    "runtime",
    "lib",
    "node_modules",
    "playwright"
  );
  await writeWrapper({
    agentPlaywrightSource: agentPlaywrightCommandSource({
      managedNodePath,
      managedNpmPath,
      managedPreviewPath: wrapperHostPath(normalizedWrapperHostDir),
      runtimeRoot: packRoot
    }),
    browserWorkerSource: agentPreviewBrowserWorkerSource({
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      controlHealthFailureLimit: browserControlHealthFailureLimit,
      controlHealthIntervalMs: browserControlHealthIntervalMs,
      identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
      idleTimeoutMs: browserIdleTimeoutMs,
      playwrightModulePath
    }),
    previewWrapperSource: agentPreviewWrapperSource({
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      managedNodePath,
      workerScriptPath
    }),
    wrapperHostDir: normalizedWrapperHostDir
  });
  const server = await ensureAgentPreviewCommandServer({
    commandService,
    sessionId: normalizedSessionId,
    wrapperHostDir: normalizedWrapperHostDir
  });
  const workerDescriptor = {
    contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
    metadataPath: browserMetadataHostPath(normalizedWrapperHostDir),
    socketPath: browserSocketHostPath(normalizedWrapperHostDir),
    token: browserWorkerToken({
      commandToken: server.token,
      sessionId: normalizedSessionId
    }),
    workerScriptPath
  };
  commandService.registerBrowserWorker?.(normalizedSessionId, workerDescriptor);
  return {
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token
    },
    hostBrowserMetadataPath: workerDescriptor.metadataPath,
    hostBrowserSocketPath: workerDescriptor.socketPath,
    hostBrowserWorkerPath: workerScriptPath,
    hostPlaywrightWrapperPath: agentPlaywrightHostPath(normalizedWrapperHostDir),
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_PLAYWRIGHT_COMMAND_NAME,
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
};
