// The Preview command's arguments and text: parsing them, waiting for readiness, and the status, logs
// and start output it prints.

import { setTimeout as delay } from "node:timers/promises";
import { WEB_LAUNCH_READINESS_TIMEOUT_SECONDS } from "./launchTargetTerminal.js";
import { PREVIEW_PROXY_TOKEN_QUERY_PARAM } from "../shared/launchPreviewProtocol.js";
import { previewLastPath, previewLogPath } from "./previewDiagnosticFiles.js";
import { trimmedText } from "./trimmedText.js";
import { isRecord } from "./isRecord.js";

const DEFAULT_PREVIEW_LOG_LINES = 200;
// Let the launch probe finish and publish its result before the command times out.
const DEFAULT_PREVIEW_WAIT_TIMEOUT_MS = (WEB_LAUNCH_READINESS_TIMEOUT_SECONDS + 30) * 1000;
const MAX_PREVIEW_LOG_LINES = 5000;
const PREVIEW_WAIT_POLL_INTERVAL_MS = 500;

function hasFlag(args = [], flag = "") {
  return args.includes(flag);
}

function optionValue(args = [], name = "") {
  const index = args.indexOf(name);
  if (index >= 0) {
    return trimmedText(args[index + 1]);
  }
  const prefix = `${name}=`;
  const entry = args.find((arg) => String(arg || "").startsWith(prefix));
  return entry ? trimmedText(entry.slice(prefix.length)) : "";
}

function parsePreviewCommandArgs(args = []) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg || "").trim()).filter(Boolean) : [];
  const command = values.find((arg) => !arg.startsWith("-")) || "";
  const targetOptions = values.filter((value) => value === "--target" || value.startsWith("--target="));
  const targetId = optionValue(values, "--target");
  return {
    command,
    error: targetOptions.length && (command !== "ensure" || targetOptions.length > 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(targetId))
      ? "Use --target once with an exact declared target id on vibe64-helper preview ensure."
      : "",
    json: hasFlag(values, "--json"),
    lines: normalizeLogLines(optionValue(values, "--lines")),
    timeoutMs: normalizeTimeoutMs(optionValue(values, "--timeout-ms")),
    targetId,
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

function previewReady(status) {
  const testOwnsPreview = ["starting", "running", "restoring"].includes(status?.previewTestRun?.state);
  return (status?.preview?.stoppedIntent !== true || testOwnsPreview) && status?.previewTarget?.available !== false &&
    Boolean(trimmedText(status?.previewTarget?.href));
}

function activeTerminalExited(status, terminalSessionId = "") {
  const terminal = status?.activeTerminal || {};
  if (terminalSessionId && trimmedText(terminal.id) && trimmedText(terminal.id) !== trimmedText(terminalSessionId)) {
    return false;
  }
  return trimmedText(terminal.status) === "exited";
}

function previewEndpoint(value = "") {
  const url = trimmedText(value);
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
  const normalizedBaseUrl = trimmedText(baseUrl);
  const normalizedRoute = trimmedText(route);
  if (!normalizedBaseUrl || !normalizedRoute.startsWith("/")) {
    return "";
  }
  try {
    const base = new URL(normalizedBaseUrl);
    const page = new URL(normalizedRoute, base);
    if (page.origin !== base.origin) {
      return "";
    }
    if (inheritBaseSearch) {
      for (const [name, value] of base.searchParams) {
        if (name === PREVIEW_PROXY_TOKEN_QUERY_PARAM) {
          page.searchParams.set(name, value);
        } else if (!page.searchParams.has(name)) {
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
  const proxyUrl = previewReady(status) ? previewEndpoint(previewTarget.href)?.url || "" : "";
  const route = trimmedText(previewState?.route);
  if (proxyUrl) {
    return route
      ? previewPageUrl(proxyUrl, route, {
          inheritBaseSearch: true
        }) || proxyUrl
      : proxyUrl;
  }
  return "";
}

function previewCurrentPage(previewState, {
  browserUrl = ""
} = {}) {
  const route = trimmedText(previewState?.route);
  if (!route) {
    return null;
  }
  return {
    url: browserUrl,
    observedAt: trimmedText(previewState?.updatedAt),
    route,
    title: trimmedText(previewState?.title)
  };
}

function previewTerminal(status = {}) {
  const terminal = isRecord(status.activeTerminal) ? status.activeTerminal : null;
  if (!terminal) {
    return null;
  }
  return {
    command: trimmedText(terminal.commandPreview),
    createdAt: trimmedText(terminal.createdAt),
    exitCode: terminal.exitCode ?? null,
    id: trimmedText(terminal.id),
    running: terminal.running === true,
    status: trimmedText(terminal.status)
  };
}

function previewDiagnostics(status = {}) {
  const metadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const session = { sessionRoot: metadata.sessionRoot };
  return previewLastPath(session) ? {
    latest: previewLastPath(session),
    log: previewLogPath(session)
  } : null;
}

function previewStatusSummary(status = {}, {
  previewState = null
} = {}) {
  const lastOutputTarget = isRecord(status.lastOutputTarget) ? status.lastOutputTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const openTarget = isRecord(status.openTarget) ? status.openTarget : {};
  const previewTarget = isRecord(status.previewTarget) ? status.previewTarget : {};
  const applicationUrl = trimmedText(lastOutputTarget.agentHref || activeMetadata.targetUrl || openTarget.href);
  const browserUrl = previewInspectionUrl(status, { previewState });
  const browserEndpoint = previewReady(status) ? previewEndpoint(previewTarget.href) : null;
  const identityTypes = (Array.isArray(status.previewIdentity?.identityTypes)
    ? status.previewIdentity.identityTypes
    : [])
    .map(trimmedText)
    .filter(Boolean);
  const identities = (Array.isArray(status.previewIdentity?.identities)
    ? status.previewIdentity.identities
    : [])
    .map((identity) => ({
      name: trimmedText(identity?.name),
      type: trimmedText(identity?.type)
    }))
    .filter((identity) => identity.name && identity.type);
  return {
    currentPage: previewCurrentPage(previewState, {
      browserUrl
    }),
    diagnostics: {
      ...previewDiagnostics(status),
      directApplicationEndpoint: previewEndpoint(applicationUrl)
    },
    endpoints: {
      browser: browserEndpoint
    },
    defaultIdentity: trimmedText(status.previewIdentity?.defaultIdentityName),
    identities,
    identityTypes,
    outputTargetId: outputTargetIdFromStatus(status),
    stoppedIntent: status.preview?.stoppedIntent === true,
    ready: previewReady(status),
    stale: previewTarget.stale === true || trimmedText(previewTarget.recovery?.reason) === "server_source_changed",
    terminal: previewTerminal(status)
  };
}

function previewSummaryLines(summary = {}) {
  return [
    `Preview ready: ${summary.ready ? "yes" : "no"}`,
    `Preview running: ${summary.terminal?.running ? "yes" : "no"}`,
    `Preview explicitly stopped: ${summary.stoppedIntent ? "yes" : "no"}`,
    summary.outputTargetId ? `Output target: ${summary.outputTargetId}` : "",
    summary.endpoints?.browser?.url ? `Browser URL (Preview proxy): ${summary.endpoints.browser.url}` : "Browser URL: unavailable",
    summary.currentPage?.route ? `Current page: ${summary.currentPage.route}` : "Current page: not observed",
    summary.currentPage?.url ? `Current page URL (Preview proxy): ${summary.currentPage.url}` : "",
    summary.terminal?.id ? `Terminal: ${summary.terminal.id} (${summary.terminal.status || "unknown"})` : "",
    summary.identities?.length
      ? `Managed app identities: ${summary.identities.map((identity) => identity.name).join(", ")}`
      : "Managed app identities: none configured - save the accounts the person names or confirms with vibe64-helper preview identities save; see vibe64-helper spec preview-identities",
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
  const output = previewLogTail(status.activeTerminal?.output, lines);
  const payload = {
    diagnostics: previewDiagnostics(status),
    outputTargetId: outputTargetIdFromStatus(status),
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

function outputTargetIdFromStatus(status = {}) {
  const lastOutputTarget = isRecord(status.lastOutputTarget) ? status.lastOutputTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  return trimmedText(lastOutputTarget.id || activeMetadata.outputTargetId);
}

async function waitForPreviewReady(launchTarget, sessionId = "", {
  terminalSessionId = "",
  signal = null,
  timeoutMs = DEFAULT_PREVIEW_WAIT_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let latestStatus = null;
  while (Date.now() <= deadline) {
    signal?.throwIfAborted();
    latestStatus = await launchTarget.launchStatus(sessionId);
    if (latestStatus?.ok === false) {
      return {
        ok: false,
        status: latestStatus
      };
    }
    if (previewReady(latestStatus) && (!terminalSessionId || latestStatus.activeTerminal?.id === terminalSessionId)) {
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

export {
  logsStdout,
  parsePreviewCommandArgs,
  previewInspectionUrl,
  previewStartStdout,
  previewStatusSummary,
  previewSummaryLines,
  statusStdout,
  waitForPreviewReady
};
