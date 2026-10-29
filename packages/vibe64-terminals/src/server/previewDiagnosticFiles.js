import path from "node:path";

// The Preview launcher writes these beside the session; the agent's
// `vibe64-helper preview status/logs` report the same paths, and a host's
// storage report finds them through this module's package export.
const PREVIEW_LOG_FILE_NAME = "preview-log.jsonl";
const PREVIEW_LAST_FILE_NAME = "preview-last.json";

function previewDiagnosticsSessionRoot(session = {}) {
  return String(session?.sessionRoot || "").trim();
}

function previewLogPath(session = {}) {
  const sessionRoot = previewDiagnosticsSessionRoot(session);
  return sessionRoot ? path.join(sessionRoot, PREVIEW_LOG_FILE_NAME) : "";
}

function previewLastPath(session = {}) {
  const sessionRoot = previewDiagnosticsSessionRoot(session);
  return sessionRoot ? path.join(sessionRoot, PREVIEW_LAST_FILE_NAME) : "";
}

export {
  previewDiagnosticsSessionRoot,
  previewLastPath,
  previewLogPath
};
