function text(value = "") {
  return String(value || "").trim();
}

function shortVibe64SessionId(sessionId = "") {
  return text(sessionId).replace(/^\d{4}-/u, "");
}

function vibe64SessionPullRequest(session = {}) {
  try {
    const source = JSON.parse(session?.metadata?.github_pull_request || "null");
    return source?.headRepository && source?.headBranch ? source : null;
  } catch { return null; }
}

function vibe64SessionDisplayTitle(session = {}) {
  const label = text(session.sessionName || session.metadata?.label);
  if (label) {
    return label;
  }
  const shortId = shortVibe64SessionId(session.sessionId);
  return shortId ? `Session ${shortId}` : "";
}

function vibe64SessionStatusLabel(status = "") {
  return text(status || "active").replaceAll("_", " ");
}

function vibe64SessionStatusColor(status = "") {
  const value = text(status);
  if (value === "blocked") {
    return "error";
  }
  return "primary";
}

function isArchivedVibe64Session(session = {}) {
  return text(session.status) === "archived";
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
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
};
