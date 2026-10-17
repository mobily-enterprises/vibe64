import {
  normalizeDevelopmentDatabaseScope
} from "@local/vibe64-core/server/studioProjectContext";

const DEFAULT_MAX_OPEN_SESSIONS = 3;

function text(value = "") {
  return String(value || "").trim();
}

function normalizedOpenSessions(value = []) {
  return (Array.isArray(value) ? value : []).map((session = {}) => ({
    label: text(session.sessionName || session.metadata?.label || session.sessionId),
    sessionId: text(session.sessionId)
  }));
}

function blockingSessionsDescription(openSessions = []) {
  const labels = openSessions.map((session) => session.label).filter(Boolean);
  if (openSessions.length === 1) {
    return labels[0] ? `the open session “${labels[0]}”` : "the open session";
  }
  return labels.length > 0
    ? `all ${openSessions.length} open sessions (${labels.join(", ")})`
    : `all ${openSessions.length} open sessions`;
}

function scopeOptionPolicy(scope = "", openSessions = [], allowSharedDatabaseSessions = false) {
  const openSessionCount = openSessions.length;
  const blockingSessions = blockingSessionsDescription(openSessions);
  const projectAvailable = openSessionCount <= 1 || scope === "project" && allowSharedDatabaseSessions;
  return {
    project: {
      available: projectAvailable,
      ...(projectAvailable
        ? {}
        : {
            disabledReason: scope === "project"
              ? `A shared database allows one open session, but this project has ${openSessionCount}. Close ${blockingSessions}.`
              : `A shared database allows one open session, but this project has ${openSessionCount}. Close ${blockingSessions} before choosing it.`
          })
    },
    session: {
      available: true
    }
  };
}

function developmentDatabasePolicy({
  managed = false,
  openSessions = [],
  scope = "session",
  allowSharedDatabaseSessions = false
} = {}) {
  const normalizedSessions = normalizedOpenSessions(openSessions);
  const openSessionCount = normalizedSessions.length;
  const normalizedScope = managed
    ? normalizeDevelopmentDatabaseScope(scope)
    : "external";
  const shared = managed && normalizedScope === "project";
  const maxOpenSessions = shared && allowSharedDatabaseSessions !== true ? 1 : DEFAULT_MAX_OPEN_SESSIONS;
  const canCreate = openSessionCount < maxOpenSessions;
  const creation = {
    canCreate,
    mode: "direct",
    showCreateAction: shared ? canCreate : true,
    ...(!canCreate
      ? {
          disabledReason: shared
            ? openSessionCount === 1
              ? "This project shares one development database. Archive its open session before creating another."
              : `This project shares one development database and already has ${openSessionCount} open sessions. Archive sessions before creating another.`
            : `Studio allows up to ${maxOpenSessions} open sessions. Archive one before creating another.`
        }
      : {})
  };
  const limits = {
    maxOpenSessions,
    openSessionCount
  };
  if (!managed) {
    return {
      creation,
      developmentDatabase: {
        managed: false,
        scope: "external"
      },
      limits
    };
  }
  return {
    creation,
    developmentDatabase: {
      allowSharedDatabaseSessions: allowSharedDatabaseSessions === true,
      canChange: openSessionCount === 0,
      ...(openSessionCount > 0
        ? {
            disabledReason: `Close ${blockingSessionsDescription(normalizedSessions)} before changing the development database.`
          }
        : {}),
      managed: true,
      openSessionCount,
      options: scopeOptionPolicy(normalizedScope, normalizedSessions, allowSharedDatabaseSessions === true),
      scope: normalizedScope
    },
    limits
  };
}

export {
  DEFAULT_MAX_OPEN_SESSIONS,
  developmentDatabasePolicy
};
