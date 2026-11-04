import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function shortVibe64SessionId(sessionId = "") {
  return normalizeText(sessionId).replace(/^\d{4}-/u, "");
}

// A session's pull request source, or null; a caller without a session passes null.
function vibe64SessionPullRequest(session) {
  try {
    const source = JSON.parse(normalizeObject(session).metadata?.github_pull_request || "null");
    return source?.headRepository && source?.headBranch ? source : null;
  } catch { return null; }
}

// A session's own name, or "" when it has none.
function vibe64SessionShortLabel(session = {}) {
  return normalizeText(session.sessionName || session.metadata?.label);
}

// The one title a session shows everywhere: its name, else its short id.
function vibe64SessionDisplayTitle(session = {}) {
  const label = vibe64SessionShortLabel(session);
  if (label) {
    return label;
  }
  const shortId = shortVibe64SessionId(session.sessionId);
  return shortId ? `Session ${shortId}` : "";
}

function vibe64SessionStatusLabel(status = "") {
  return normalizeText(status || "active").replaceAll("_", " ");
}

function vibe64SessionStatusColor(status = "") {
  const value = normalizeText(status);
  if (value === "blocked") {
    return "error";
  }
  return "primary";
}

function isArchivedVibe64Session(session = {}) {
  return normalizeText(session.status) === "archived";
}

function isOpenVibe64Session(session = {}) {
  return !isArchivedVibe64Session(session);
}

function vibe64SessionRevision(session = null) {
  const revision = Number(session?.revision);
  return Number.isFinite(revision) ? revision : null;
}

export {
  isArchivedVibe64Session,
  isOpenVibe64Session,
  shortVibe64SessionId,
  vibe64SessionDisplayTitle,
  vibe64SessionPullRequest,
  vibe64SessionRevision,
  vibe64SessionShortLabel,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
};
