import {
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/aiStudioRequestConfig.js";

const AI_STUDIO_SESSIONS_API_SUFFIX = "/ai-studio/sessions";
const DEFAULT_MAX_OPEN_SESSIONS = 3;
const SELECTED_SESSION_STORAGE_KEY = "ai-studio:selected-session-id";

function aiStudioSessionsQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "sessions"];
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

function aiStudioArtifactsPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/artifacts");
}

function aiStudioCodexPromptHandoffPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/codex-prompt-handoff");
}

function aiStudioCodexAttachmentPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/codex-attachments");
}

function aiStudioCodexThreadPath(sessionsApiPath = "", sessionId = "") {
  return aiStudioSessionPath(sessionsApiPath, sessionId, "/codex-thread");
}

function aiStudioArtifactsQueryKey(surfaceId, ownershipFilter, sessionId = "", actionId = "") {
  const key = [
    "ai-studio",
    surfaceId,
    ownershipFilter,
    "session-artifacts",
    encodePathSegment(sessionId)
  ];
  const encodedActionId = encodePathSegment(actionId);
  if (encodedActionId) {
    key.push(encodedActionId);
  }
  return key;
}

function commandInputFromContext(context = {}) {
  return context?.input && typeof context.input === "object" && !Array.isArray(context.input)
    ? context.input
    : {};
}

export {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  DEFAULT_MAX_OPEN_SESSIONS,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioActionPath,
  aiStudioArtifactsPath,
  aiStudioArtifactsQueryKey,
  aiStudioCodexAttachmentPath,
  aiStudioCodexPromptHandoffPath,
  aiStudioCodexThreadPath,
  aiStudioSessionPath,
  aiStudioSessionsQueryKey,
  commandInputFromContext
};
