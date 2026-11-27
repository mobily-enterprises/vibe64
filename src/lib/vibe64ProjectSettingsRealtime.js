import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

// What Project settings shows, and which changes can change it. Its two reads come from the source session's files
// (below), that session's connections as prepared, the number of open sessions (the shared database choice) and the
// project's own settings, whose every save announces a project change. An agent's turn changes none of it unless its
// checkpoint says it changed one of those files, so the page never reloads on a turn's status.
const ENGINEERING_FILES = Object.freeze(["genesis/engineering.md"]);
const SETTINGS_FILES = Object.freeze(["genesis/collaboration.md", "genesis/stack.md", "vibe64.connections.json"]);
// Changes to any session of the project: the open sessions decide the shared database choice, and a new session can
// become the source of a page that names none.
const PROJECT_SESSION_REASONS = new Set(["session-archived", "session-created", "session-renewal-completed"]);
// Changes to the source session after which its files, or its connections as prepared, can differ; a failed checkpoint
// cannot say what its turn changed.
const SOURCE_SESSION_REASONS = new Set([
  "session-starter-applied",
  "session-turn-checkpoint-failed",
  "session-update-completed",
  "workspace-setup-completed"
]);
const TURN_CHECKPOINT_REASON = "session-turn-checkpoint-updated";
// Project changes that can change the settings: every save (an action's change, which gives no reason) and the
// repository workflow. A runtime opening or closing, a message, an approval or a GitHub issue never does.
const PROJECT_SETTINGS_REASONS = new Set(["repository-workflow-settings"]);
const NO_READS = Object.freeze({ engineering: false, settings: false });
const BOTH_READS = Object.freeze({ engineering: true, settings: true });

function text(value) {
  return String(value || "").trim();
}

function eventPayload(event) {
  return normalizeObject(normalizeObject(event).payload);
}

function sameProject(payload, projectSlug) {
  return Boolean(text(projectSlug)) && text(payload.projectSlug) === text(projectSlug);
}

/**
 * Which of the page's reads changed source paths affect. Whether a connection is unused comes from the manifests the
 * session installs from, wherever they are, so a page that shows connections reads its settings again after any change;
 * unknown paths affect both reads.
 * @param {string[] | undefined} paths
 * @param {boolean} showsConnections
 */
function readsForPaths(paths, showsConnections) {
  if (!Array.isArray(paths)) return BOTH_READS;
  return {
    engineering: paths.some((file) => ENGINEERING_FILES.includes(file)),
    settings: showsConnections ? paths.length > 0 : paths.some((file) => SETTINGS_FILES.includes(file))
  };
}

/**
 * The page's reads a session summary makes stale: none for a turn's status, and for a turn's checkpoint only those its
 * changed files affect.
 * @param {object} event the realtime event
 * @param {{ projectSlug: string, sessionId: string, showsConnections: boolean }} scope the page's project, source
 *   session (the route's, or the one the settings were read from) and whether it shows connections
 * @returns {{ engineering: boolean, settings: boolean }}
 */
function projectSettingsSummaryReads(event, { projectSlug, sessionId, showsConnections }) {
  const payload = eventPayload(event);
  if (!sameProject(payload, projectSlug)) return NO_READS;
  const reason = text(payload.reason);
  if (PROJECT_SESSION_REASONS.has(reason)) return BOTH_READS;
  if (!text(sessionId) || text(payload.sessionId) !== text(sessionId)) return NO_READS;
  if (reason === TURN_CHECKPOINT_REASON) return readsForPaths(payload.turnChangedPaths, showsConnections);
  return SOURCE_SESSION_REASONS.has(reason) ? BOTH_READS : NO_READS;
}

/**
 * The page's reads a source editor change makes stale: one to a file it reads in its source session.
 * @param {object} event the realtime event
 * @param {{ projectSlug: string, sessionId: string, showsConnections: boolean }} scope
 */
function projectSettingsFileChangeReads(event, { projectSlug, sessionId, showsConnections }) {
  const payload = eventPayload(event);
  if (!sameProject(payload, projectSlug) || !text(sessionId) || text(payload.sessionId) !== text(sessionId)) {
    return NO_READS;
  }
  return readsForPaths([text(payload.path)], showsConnections);
}

/**
 * Whether a project change can change this project's settings.
 * @param {object} event the realtime event
 * @param {string} projectSlug
 */
function projectSettingsProjectChangeShouldReload(event, projectSlug) {
  const payload = eventPayload(event);
  const reason = text(payload.reason);
  return sameProject(payload, projectSlug) && (!reason || PROJECT_SETTINGS_REASONS.has(reason));
}

export {
  projectSettingsFileChangeReads,
  projectSettingsProjectChangeShouldReload,
  projectSettingsSummaryReads
};
