import {
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/aiStudioRequestConfig.js";

const AI_STUDIO_SESSIONS_API_SUFFIX = "/ai-studio/sessions";
const AI_STUDIO_SESSION_CHANGED_EVENT = "ai-studio.session.changed";
const DEFAULT_MAX_OPEN_SESSIONS = 5;
const SELECTED_SESSION_STORAGE_KEY = "ai-studio:selected-session-id";

function aiStudioSessionsQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "sessions"];
}

function aiStudioSessionQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "session"];
}

function encodePathSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function aiStudioSessionPath(sessionsApiPath = "", sessionId = "", suffix = "") {
  return `${sessionsApiPath}/${encodePathSegment(sessionId)}${suffix}`;
}

function aiStudioActionPath(sessionsApiPath = "", sessionId = "", actionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, `/actions/${encodePathSegment(actionId)}`);
}

function aiStudioIntentPath(sessionsApiPath = "", sessionId = "", intentId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, `/intents/${encodePathSegment(intentId)}`);
}

function aiStudioArtifactPreviewPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/artifact-preview");
}

function aiStudioCodexAttachmentPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/codex-attachments");
}

function aiStudioCommandTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return aiStudioSessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/command-terminal/${encodePathSegment(terminalSessionId)}` : "/command-terminal"
  );
}

function aiStudioLaunchTargetOpenPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/launch-target/open");
}

function aiStudioLaunchTargetsPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/launch-targets");
}

function aiStudioLaunchTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return aiStudioSessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/launch-terminal/${encodePathSegment(terminalSessionId)}` : "/launch-terminal"
  );
}

function aiStudioLaunchTerminalStopPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return `${aiStudioLaunchTerminalPath(sessionsApiPath, sessionId, terminalSessionId)}/stop`;
}

function aiStudioShellTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return aiStudioSessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/shell-terminal/${encodePathSegment(terminalSessionId)}` : "/shell-terminal"
  );
}

function aiStudioArtifactPreviewQueryKey(surfaceId, ownershipFilter, sessionId = "", previewId = "") {
  const key = [
    "ai-studio",
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

function aiStudioLaunchTargetsQueryKey(surfaceId, ownershipFilter, sessionId = "") {
  return [
    "ai-studio",
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
  AI_STUDIO_SESSION_CHANGED_EVENT,
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  DEFAULT_MAX_OPEN_SESSIONS,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioActionPath,
  aiStudioArtifactPreviewPath,
  aiStudioArtifactPreviewQueryKey,
  aiStudioCodexAttachmentPath,
  aiStudioCommandTerminalPath,
  aiStudioIntentPath,
  aiStudioLaunchTargetOpenPath,
  aiStudioLaunchTargetsPath,
  aiStudioLaunchTargetsQueryKey,
  aiStudioLaunchTerminalPath,
  aiStudioLaunchTerminalStopPath,
  aiStudioSessionPath,
  aiStudioSessionQueryKey,
  aiStudioShellTerminalPath,
  aiStudioSessionsQueryKey,
  commandInputFromContext
};
