const AI_STUDIO_SURFACE_ID = "home";
const AI_STUDIO_SESSIONS_API_SUFFIX = "/studio/current-app/ai-studio/sessions";
const DEFAULT_MAX_OPEN_SESSIONS = 3;
const SELECTED_SESSION_STORAGE_KEY = "jskit-ai-studio:selected-ai-studio-session-id";

const LOCAL_STUDIO_COMMAND_OPTIONS = Object.freeze({
  headers: Object.freeze({
    "csrf-token": "ai-studio-local-command"
  })
});

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
  aiStudioSessionPath,
  aiStudioSessionQueryKey,
  aiStudioSessionsQueryKey,
  commandInputFromContext
};
