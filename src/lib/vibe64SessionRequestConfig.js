import {
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/vibe64RequestConfig.js";

const VIBE64_SESSIONS_API_SUFFIX = "/vibe64/sessions";
const VIBE64_API_SUFFIX = "/vibe64";
const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const DEFAULT_MAX_OPEN_SESSIONS = 5;
const SELECTED_SESSION_STORAGE_KEY = "vibe64:selected-session-id";

function vibe64SessionsQueryKey(surfaceId, ownershipFilter) {
  return ["vibe64", surfaceId, ownershipFilter, "sessions"];
}

function vibe64SessionQueryKey(surfaceId, ownershipFilter) {
  return ["vibe64", surfaceId, ownershipFilter, "session"];
}

function encodePathSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function vibe64SessionPath(sessionsApiPath = "", sessionId = "", suffix = "") {
  return `${sessionsApiPath}/${encodePathSegment(sessionId)}${suffix}`;
}

function vibe64ProjectToolPath(vibe64ApiPath = "", toolId = "", suffix = "") {
  return `${vibe64ApiPath}/tools/${encodePathSegment(toolId)}${suffix}`;
}

function vibe64ProjectToolRunPath(vibe64ApiPath = "", toolId = "") {
  return vibe64ProjectToolPath(vibe64ApiPath, toolId, "/run");
}

function vibe64ProjectToolFixPath(vibe64ApiPath = "", toolId = "") {
  return vibe64ProjectToolPath(vibe64ApiPath, toolId, "/fix");
}

function vibe64ProjectToolTerminalPath(vibe64ApiPath = "", toolId = "", terminalSessionId = "") {
  return vibe64ProjectToolPath(
    vibe64ApiPath,
    toolId,
    terminalSessionId ? `/terminal/${encodePathSegment(terminalSessionId)}` : "/terminal"
  );
}

function vibe64ActionPath(sessionsApiPath = "", sessionId = "", actionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, `/actions/${encodePathSegment(actionId)}`);
}

function vibe64IntentPath(sessionsApiPath = "", sessionId = "", intentId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, `/intents/${encodePathSegment(intentId)}`);
}

function vibe64ArtifactPreviewPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/artifact-preview");
}

function vibe64CodexAttachmentPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/codex-attachments");
}

function vibe64ConversationLogPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/conversation-log");
}

function vibe64TerminalFailureFixRequestPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/terminal-failure-fix-request");
}

function vibe64TerminalFailureFixPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/terminal-failure-fix");
}

function vibe64CommandTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/command-terminal/${encodePathSegment(terminalSessionId)}` : "/command-terminal"
  );
}

function vibe64LaunchTargetOpenPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/launch-target/open");
}

function vibe64LaunchTargetsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/launch-targets");
}

function vibe64LaunchTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/launch-terminal/${encodePathSegment(terminalSessionId)}` : "/launch-terminal"
  );
}

function vibe64LaunchTerminalStopPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return `${vibe64LaunchTerminalPath(sessionsApiPath, sessionId, terminalSessionId)}/stop`;
}

function vibe64ShellTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/shell-terminal/${encodePathSegment(terminalSessionId)}` : "/shell-terminal"
  );
}

function vibe64ArtifactPreviewQueryKey(surfaceId, ownershipFilter, sessionId = "", previewId = "") {
  const key = [
    "vibe64",
    surfaceId,
    ownershipFilter,
    "artifact-preview",
    encodePathSegment(sessionId)
  ];
  const encodedPreviewId = encodePathSegment(previewId);
  if (encodedPreviewId) {
    key.push(encodedPreviewId);
  }
  return key;
}

function vibe64ConversationLogQueryKey(surfaceId, ownershipFilter, sessionId = "") {
  return [
    "vibe64",
    surfaceId,
    ownershipFilter,
    "conversation-log",
    encodePathSegment(sessionId)
  ];
}

function vibe64LaunchTargetsQueryKey(surfaceId, ownershipFilter, sessionId = "") {
  return [
    "vibe64",
    surfaceId,
    ownershipFilter,
    "launch-targets",
    encodePathSegment(sessionId)
  ];
}

function commandInputFromContext(context = {}) {
  return context?.input && typeof context.input === "object" && !Array.isArray(context.input)
    ? context.input
    : {};
}

export {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  DEFAULT_MAX_OPEN_SESSIONS,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  vibe64ActionPath,
  vibe64ArtifactPreviewPath,
  vibe64ArtifactPreviewQueryKey,
  vibe64CodexAttachmentPath,
  vibe64CommandTerminalPath,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey,
  vibe64IntentPath,
  vibe64LaunchTargetOpenPath,
  vibe64LaunchTargetsPath,
  vibe64LaunchTargetsQueryKey,
  vibe64LaunchTerminalPath,
  vibe64LaunchTerminalStopPath,
  vibe64ProjectToolFixPath,
  vibe64ProjectToolRunPath,
  vibe64ProjectToolTerminalPath,
  vibe64SessionPath,
  vibe64SessionQueryKey,
  vibe64ShellTerminalPath,
  vibe64SessionsQueryKey,
  vibe64TerminalFailureFixRequestPath,
  vibe64TerminalFailureFixPath,
  commandInputFromContext
};
