// What a session records about its launched output target and Preview stop, and reading and clearing it.

import { serializeLaunchRestartBaseline } from "./launchRestart.js";

/** @typedef {ReturnType<typeof import("@local/vibe64-runtime/server/sessionStore").createVibe64SessionStore>} Vibe64SessionStore */

const OUTPUT_METADATA = Object.freeze({
  agentHref: "output_target_agent_href",
  href: "output_target_open_href",
  id: "output_target_id",
  kind: "output_target_open_kind",
  label: "output_target_label",
  openLabel: "output_target_open_label",
  previewAuth: "output_target_preview_auth",
  parameters: "output_target_parameters",
  restartBaseline: "output_target_restart_baseline",
  sessionRoot: "output_target_session_root",
  startedAt: "output_target_started_at",
  terminalId: "output_target_terminal_id"
});
const OUTPUT_METADATA_NAMES = Object.freeze(Object.values(OUTPUT_METADATA));
const PREVIEW_STOPPED_METADATA = "output_target_preview_stopped";
const PREVIEW_STOP_ERROR_METADATA = "output_target_preview_stop_error";

function normalizeOpenTarget(value = {}) {
  return {
    href: String(value.href || "").trim(),
    kind: String(value.kind || "url").trim() || "url",
    label: String(value.label || "Open").trim() || "Open"
  };
}

function launchIsReady(metadata = {}) {
  return metadata.launchReady === true || metadata.launchReady === "true";
}

function openTargetFromMetadata(metadata = {}) {
  const href = String(metadata[OUTPUT_METADATA.href] || "").trim();
  if (!href) {
    return null;
  }
  return normalizeOpenTarget({
    href,
    kind: metadata[OUTPUT_METADATA.kind],
    label: metadata[OUTPUT_METADATA.openLabel]
  });
}

function outputTargetFromMetadata(metadata = {}) {
  const id = String(metadata[OUTPUT_METADATA.id] || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    outputParameters: JSON.parse(metadata[OUTPUT_METADATA.parameters] || "{}"),
    agentHref: String(metadata[OUTPUT_METADATA.agentHref] || "").trim(),
    label: String(metadata[OUTPUT_METADATA.label] || id).trim() || id,
    openTarget: openTargetFromMetadata(metadata),
    startedAt: String(metadata[OUTPUT_METADATA.startedAt] || "").trim()
  };
}

function previewStopState(metadata = {}) {
  const value = metadata[PREVIEW_STOPPED_METADATA];
  if (value !== undefined && value !== "" && value !== "true" && value !== "false") {
    throw Object.assign(new Error("Saved Preview stop state is invalid. Stop Preview explicitly before retrying Start."), {
      code: "vibe64_preview_stop_state_invalid"
    });
  }
  return {
    stopped: value === "true",
    error: String(metadata[PREVIEW_STOP_ERROR_METADATA] || "").trim()
  };
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {object} options
 * @param {boolean} options.stopped
 * @param {string} [options.error]
 */
async function writePreviewStopState(store, sessionId, { stopped, error = "" }) {
  await store.mutateSession(sessionId, async () => {
    await store.writeMetadataValue(sessionId, PREVIEW_STOPPED_METADATA, stopped ? "true" : "false");
    await store.writeMetadataValue(sessionId, PREVIEW_STOP_ERROR_METADATA, String(error || ""));
  });
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [options]
 * @param {boolean} [options.preserveSelection]
 */
async function clearLaunchMetadata(store, sessionId = "", { preserveSelection = false } = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !store) {
    return false;
  }
  const names = preserveSelection
    ? OUTPUT_METADATA_NAMES.filter((name) => ![OUTPUT_METADATA.id, OUTPUT_METADATA.label, OUTPUT_METADATA.parameters].includes(name))
    : OUTPUT_METADATA_NAMES;
  await store.mutateSession(normalizedSessionId, async () => {
    await Promise.all(names.map((name) => store.deleteMetadataValue(normalizedSessionId, name)));
  });
  return true;
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {string} [terminalSessionId]
 */
async function clearLaunchMetadataForTerminal(store, sessionId = "", terminalSessionId = "") {
  const normalizedTerminalSessionId = String(terminalSessionId || "").trim();
  if (
    !normalizedTerminalSessionId ||
    !store
  ) {
    return false;
  }
  const currentTerminalId = String(
    await store.readMetadataValue(sessionId, OUTPUT_METADATA.terminalId) || ""
  ).trim();
  if (currentTerminalId !== normalizedTerminalSessionId) {
    return false;
  }
  const preserveSelection = await store.readMetadataValue(sessionId, PREVIEW_STOPPED_METADATA) === "true";
  return clearLaunchMetadata(store, sessionId, { preserveSelection });
}

// The application URL the agent's own checks use, beside the browser-facing Preview.
function launchAgentHref(metadata = {}) {
  return String(
    metadata.agentTargetHref ||
    metadata.targetUrl ||
    normalizeOpenTarget(metadata.openTarget || {}).href ||
    ""
  ).trim();
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {object} [terminalSession]
 */
async function writeLaunchMetadata(store, sessionId, terminalSession = {}) {
  const metadata = terminalSession.metadata || {};
  const openTarget = normalizeOpenTarget(metadata.openTarget || {});
  if (!metadata.outputTargetId || !openTarget.href) {
    return;
  }
  const agentHref = launchAgentHref(metadata);
  await store.mutateSession(sessionId, async () => {
    await Promise.all([
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.agentHref, agentHref),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.id, metadata.outputTargetId),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.parameters, JSON.stringify(metadata.outputParameters || {})),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.label, metadata.outputTargetLabel || metadata.outputTargetId),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.kind, openTarget.kind),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.openLabel, openTarget.label),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.href, openTarget.href),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.previewAuth, metadata.previewAuth || ""),
      store.writeMetadataValue(
        sessionId,
        OUTPUT_METADATA.restartBaseline,
        serializeLaunchRestartBaseline(metadata.launchRestartBaseline)
      ),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.sessionRoot, metadata.sessionRoot || ""),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.startedAt, new Date().toISOString()),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.terminalId, terminalSession.id || "")
    ]);
  });
}

export {
  clearLaunchMetadata,
  clearLaunchMetadataForTerminal,
  launchAgentHref,
  launchIsReady,
  normalizeOpenTarget,
  OUTPUT_METADATA,
  outputTargetFromMetadata,
  previewStopState,
  writeLaunchMetadata,
  writePreviewStopState
};
