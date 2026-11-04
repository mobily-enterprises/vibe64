import { appendFile, readFile, writeFile } from "node:fs/promises";
import stripAnsi from "strip-ansi";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { previewDiagnosticsSessionRoot, previewLastPath, previewLogPath } from "./previewDiagnosticFiles.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// The diagnostic record of each Preview launch step, written to the session's
// latest-launch file and appended to its launch log, and the latest record
// read back.

const PREVIEW_OUTPUT_TAIL_LIMIT = 12000;

function previewDiagnosticOutputTail(output = "") {
  const text = stripAnsi(String(output || ""));
  return text.length > PREVIEW_OUTPUT_TAIL_LIMIT
    ? text.slice(text.length - PREVIEW_OUTPUT_TAIL_LIMIT)
    : text;
}

function previewDiagnosticError(error = null) {
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return {
      message: error
    };
  }
  return {
    message: String(error?.message || error || ""),
    ...(error?.code ? { code: String(error.code) } : {}),
    ...(error?.details?.admission?.id ? { resourceAdmissionId: String(error.details.admission.id).slice(0, 128) } : {}),
    ...(error?.statusCode ? { statusCode: error.statusCode } : {})
  };
}

async function writePreviewDiagnostic(session = {}, record = {}, options = {}) {
  const {
    append = true,
    latest = true
  } = options;
  const sessionRoot = previewDiagnosticsSessionRoot(session);
  if (!sessionRoot) {
    return;
  }
  const normalizedRecord = {
    at: new Date().toISOString(),
    schemaVersion: 1,
    sessionId: String(record.sessionId || session.sessionId || "").trim(),
    sessionRoot,
    status: String(record.status || "failed").trim() || "failed",
    sessionSourceRoot: String(record.sessionSourceRoot || sessionSourcePath(session) || "").trim(),
    ...(record.reason ? { reason: String(record.reason) } : {}),
    ...(record.outputTargetId ? { outputTargetId: normalizeText(record.outputTargetId) } : {}),
    ...(record.cwd ? { cwd: String(record.cwd) } : {}),
    ...(record.commandPreview ? { commandPreview: String(record.commandPreview) } : {}),
    ...(record.terminalSessionId ? { terminalSessionId: String(record.terminalSessionId) } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record.error ? { error: previewDiagnosticError(record.error) } : {}),
    ...(record.message ? { message: String(record.message) } : {}),
    ...(record.outputTail ? { outputTail: previewDiagnosticOutputTail(record.outputTail) } : {}),
    ...(record.details && typeof record.details === "object" && !Array.isArray(record.details) ? { details: record.details } : {})
  };
  try {
    if (latest) {
      await writeFile(previewLastPath(session), `${JSON.stringify(normalizedRecord, null, 2)}\n`, "utf8");
    }
    if (append) {
      await appendFile(previewLogPath(session), `${JSON.stringify(normalizedRecord)}\n`, "utf8");
    }
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.previewDiagnostics.error", {
      error: vibe64SessionDebugError(error),
      sessionId: record.sessionId || session.sessionId || "",
      sessionRoot
    }, {
      level: "warn"
    });
  }
}

/**
 * The session's latest launch record, or null when there is none or it cannot
 * be read.
 */
async function readLatestPreviewDiagnostic(session) {
  const latestPath = previewLastPath(session);
  return latestPath ? await readFile(latestPath, "utf8")
    .then((text) => JSON.parse(text)).catch(() => null) : null;
}

export {
  readLatestPreviewDiagnostic,
  writePreviewDiagnostic
};
