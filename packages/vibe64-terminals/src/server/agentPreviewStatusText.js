// The Preview command's arguments and text: parsing them, waiting for readiness, and the status, logs
// and start output it prints.

import { setTimeout as delay } from "node:timers/promises";
import { WEB_LAUNCH_READINESS_TIMEOUT_SECONDS } from "./launchTargetTerminal.js";
import { PREVIEW_PROXY_TOKEN_QUERY_PARAM } from "../shared/launchPreviewProtocol.js";
import { previewLastPath, previewLogPath } from "./previewDiagnosticFiles.js";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { previewApplicationIdentityLabel } from "@local/vibe64-core/shared/previewIdentity";

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
    return normalizeText(args[index + 1]);
  }
  const prefix = `${name}=`;
  const entry = args.find((arg) => String(arg || "").startsWith(prefix));
  return entry ? normalizeText(entry.slice(prefix.length)) : "";
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
    Boolean(normalizeText(status?.previewTarget?.href));
}

function activeTerminalExited(status, terminalSessionId = "") {
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

function previewPageUrl(baseUrl = "", route = "", options = {}) {
  const {
    inheritBaseSearch = false
  } = options;
  const normalizedBaseUrl = normalizeText(baseUrl);
  const normalizedRoute = normalizeText(route);
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

function previewInspectionUrl(status = {}, options = {}) {
  const {
    previewState = null
  } = options;
  const previewTarget = isRecord(status.previewTarget) ? status.previewTarget : {};
  const proxyUrl = previewReady(status) ? previewEndpoint(previewTarget.href)?.url || "" : "";
  const route = normalizeText(previewState?.route);
  if (proxyUrl) {
    return route
      ? previewPageUrl(proxyUrl, route, {
        inheritBaseSearch: true
      }) || proxyUrl
      : proxyUrl;
  }
  return "";
}

function previewCurrentPage(previewState, options = {}) {
  const {
    browserUrl = ""
  } = options;
  const route = normalizeText(previewState?.route);
  if (!route) {
    return null;
  }
  return {
    url: browserUrl,
    observedAt: normalizeText(previewState?.updatedAt),
    route,
    title: normalizeText(previewState?.title)
  };
}

function previewTerminal(status = {}) {
  const terminal = isRecord(status.activeTerminal) ? status.activeTerminal : null;
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
  const metadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const session = { sessionRoot: metadata.sessionRoot };
  return previewLastPath(session) ? {
    latest: previewLastPath(session),
    log: previewLogPath(session)
  } : null;
}

function previewStatusSummary(status = {}, options = {}) {
  const {
    previewState = null
  } = options;
  const lastOutputTarget = isRecord(status.lastOutputTarget) ? status.lastOutputTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const openTarget = isRecord(status.openTarget) ? status.openTarget : {};
  const previewTarget = isRecord(status.previewTarget) ? status.previewTarget : {};
  const applicationUrl = normalizeText(lastOutputTarget.agentHref || activeMetadata.targetUrl || openTarget.href);
  const browserUrl = previewInspectionUrl(status, { previewState });
  const browserEndpoint = previewReady(status) ? previewEndpoint(previewTarget.href) : null;
  const identityTypes = (Array.isArray(status.previewIdentity?.identityTypes)
    ? status.previewIdentity.identityTypes
    : [])
    .map(normalizeText)
    .filter(Boolean);
  const identities = (Array.isArray(status.previewIdentity?.identities)
    ? status.previewIdentity.identities
    : [])
    .map((identity) => ({
      name: normalizeText(identity?.name),
      type: normalizeText(identity?.type)
    }))
    .filter((identity) => identity.name && identity.type);
  const skippedIdentities = (Array.isArray(status.previewIdentity?.skippedIdentities)
    ? status.previewIdentity.skippedIdentities
    : [])
    .map((identity) => ({
      name: normalizeText(identity?.name),
      position: Number(identity?.position) || 0,
      reason: normalizeText(identity?.reason)
    }));
  const identityFileProblem = normalizeText(status.previewIdentity?.fileProblem);
  // What a restart waiting for the run's database step, or a Stop that cut it, says.
  const note = ["restart_waiting_for_prepare", "prepare_cut"].includes(normalizeText(status.preview?.reason))
    ? normalizeText(status.preview?.message)
    : "";
  return {
    currentPage: previewCurrentPage(previewState, {
      browserUrl
    }),
    diagnostics: {
      ...previewDiagnostics(status),
      directApplicationEndpoint: previewEndpoint(applicationUrl),
      // A browser-test run's target with several app servers: worker i's, the first being the endpoint above.
      ...(Array.isArray(activeMetadata.testWorkers) && activeMetadata.testWorkers.length > 1
        ? { testWorkers: activeMetadata.testWorkers.map(({ index, url }) => ({ index, url })) }
        : {})
    },
    endpoints: {
      browser: browserEndpoint
    },
    defaultIdentity: normalizeText(status.previewIdentity?.defaultIdentityName),
    identities,
    identityTypes,
    // Only when the project's identity file has invalid entries or is not an identity list.
    ...(skippedIdentities.length > 0 ? { skippedIdentities } : {}),
    ...(identityFileProblem ? { identityFileProblem } : {}),
    ...(note ? { note } : {}),
    outputTargetId: outputTargetIdFromStatus(status),
    stoppedIntent: status.preview?.stoppedIntent === true,
    ready: previewReady(status),
    stale: previewTarget.stale === true || normalizeText(previewTarget.recovery?.reason) === "server_source_changed",
    terminal: previewTerminal(status)
  };
}

function previewSummaryLines(summary = {}) {
  return [
    `Preview ready: ${summary.ready ? "yes" : "no"}`,
    `Preview running: ${summary.terminal?.running ? "yes" : "no"}`,
    `Preview explicitly stopped: ${summary.stoppedIntent ? "yes" : "no"}`,
    summary.note ? `Preview note: ${summary.note}` : "",
    summary.outputTargetId ? `Output target: ${summary.outputTargetId}` : "",
    summary.endpoints?.browser?.url ? `Browser URL (Preview proxy): ${summary.endpoints.browser.url}` : "Browser URL: unavailable",
    summary.currentPage?.route ? `Current page: ${summary.currentPage.route}` : "Current page: not observed",
    summary.currentPage?.url ? `Current page URL (Preview proxy): ${summary.currentPage.url}` : "",
    summary.terminal?.id ? `Terminal: ${summary.terminal.id} (${summary.terminal.status || "unknown"})` : "",
    summary.identities?.length
      ? `Managed app identities: ${summary.identities.map((identity) => identity.name).join(", ")}`
      : summary.skippedIdentities?.length || summary.identityFileProblem
        ? "Managed app identities: none usable"
        : "Managed app identities: none configured - save the accounts the person names or confirms with vibe64-helper preview identities save; see vibe64-helper spec preview-identities",
    ...(summary.skippedIdentities || []).map((identity) => (
      `Skipped managed app ${previewApplicationIdentityLabel(identity)}: ${identity.reason}`
    )),
    summary.identityFileProblem ? `Managed app identities file: ${summary.identityFileProblem}` : "",
    summary.skippedIdentities?.length || summary.identityFileProblem
      ? "Preview cannot sign in as a skipped identity. Rename or remove skipped identities only as the person asks: " +
        "in Dashboard > App access, or by saving the complete list with vibe64-helper preview identities save (vibe64-helper spec preview-identities)."
      : "",
    `Stale: ${summary.stale ? "yes" : "no"}`
  ].filter(Boolean);
}

function statusStdout(summary = {}, options = {}) {
  const {
    json = false
  } = options;
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

function logsStdout(status = {}, options = {}) {
  const {
    json = false,
    lines = DEFAULT_PREVIEW_LOG_LINES
  } = options;
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

function previewStartStdout(summary = {}, options = {}) {
  const {
    command = "ensure",
    json = false
  } = options;
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
    // A restart whose run was in its database step waited for it (`waitedForPrepare`) rather than cut it, unless it
    // was still running when the restart's wait ended (`prepareCut`).
    payload.prepareCut
      ? "The database step was still running when the restart stopped waiting for it, so the restart cut it."
      : payload.waitedForPrepare ? "Waited for the database step to finish before restarting." : "",
    ...previewSummaryLines(payload)
  ].filter(Boolean).join("\n") + "\n";
}

function outputTargetIdFromStatus(status = {}) {
  const lastOutputTarget = isRecord(status.lastOutputTarget) ? status.lastOutputTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  return normalizeText(lastOutputTarget.id || activeMetadata.outputTargetId);
}

/**
 * The run a Preview wait follows: its id, when it started and its target.
 * @param {object | null} terminal
 * @param {string} fallbackCreatedAt when the run's own start time is unknown
 */
function followedPreviewRun(terminal, fallbackCreatedAt = "") {
  return {
    createdAt: normalizeText(terminal?.createdAt) || fallbackCreatedAt,
    id: normalizeText(terminal?.id),
    outputTargetId: normalizeText(terminal?.metadata?.outputTargetId)
  };
}

/**
 * Waits for the session's Preview to be ready. Given the run a start returned, it waits for that run, and
 * follows a newer run of the same target that replaced it (another start's) to readiness. It fails at once
 * when its run exited, or went with no such replacement (Stop, another target, nothing running), and on
 * a timeout only while a run it follows is still starting.
 * @param {object} launchTarget
 * @param {string} sessionId
 * @param {{ signal?: AbortSignal | null, terminal?: object | null, timeoutMs?: number }} [options]
 *   terminal: the run the start returned (its id, createdAt and metadata.outputTargetId)
 */
async function waitForPreviewReady(launchTarget, sessionId = "", options = {}) {
  const {
    terminal = null,
    signal = null,
    timeoutMs = DEFAULT_PREVIEW_WAIT_TIMEOUT_MS
  } = options;
  const deadline = Date.now() + timeoutMs;
  let followed = followedPreviewRun(terminal, new Date().toISOString());
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
    const active = isRecord(latestStatus?.activeTerminal) ? latestStatus.activeTerminal : null;
    const activeId = normalizeText(active?.id);
    if (followed.id && activeId !== followed.id && (activeId || !active)) {
      const replacement = followedPreviewRun(active);
      if (!activeId || replacement.createdAt <= followed.createdAt ||
          (followed.outputTargetId && replacement.outputTargetId !== followed.outputTargetId)) {
        return {
          ok: false,
          status: latestStatus
        };
      }
      followed = { ...replacement, outputTargetId: replacement.outputTargetId || followed.outputTargetId };
    }
    if (previewReady(latestStatus) && (!followed.id || activeId === followed.id)) {
      return {
        ok: true,
        status: latestStatus
      };
    }
    if (activeTerminalExited(latestStatus, followed.id)) {
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
