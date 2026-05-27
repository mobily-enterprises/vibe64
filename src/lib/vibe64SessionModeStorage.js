import {
  browserLocalStorage
} from "@/lib/browserLocalStorage.js";

const VIBE64_SESSION_MODES = Object.freeze({
  AUTOPILOT: "autopilot",
  INSPECT: "inspect"
});
const DEFAULT_VIBE64_SESSION_MODE = VIBE64_SESSION_MODES.AUTOPILOT;
const SESSION_MODE_STORAGE_PREFIX = "vibe64:session-mode:";

function normalizeVibe64SessionMode(value = "", fallback = DEFAULT_VIBE64_SESSION_MODE) {
  const mode = String(value || "").trim();
  switch (mode) {
    case VIBE64_SESSION_MODES.AUTOPILOT:
    case VIBE64_SESSION_MODES.INSPECT:
      return mode;
    default:
      return fallback;
  }
}

function vibe64SessionModeStorageKey(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  return normalizedSessionId
    ? `${SESSION_MODE_STORAGE_PREFIX}${encodeURIComponent(normalizedSessionId)}`
    : "";
}

function readVibe64SessionMode(sessionId = "", fallback = DEFAULT_VIBE64_SESSION_MODE) {
  const storageKey = vibe64SessionModeStorageKey(sessionId);
  if (!storageKey) {
    return normalizeVibe64SessionMode("", fallback);
  }
  try {
    return normalizeVibe64SessionMode(browserLocalStorage()?.getItem(storageKey), fallback);
  } catch {
    return normalizeVibe64SessionMode("", fallback);
  }
}

function writeVibe64SessionMode(sessionId = "", mode = DEFAULT_VIBE64_SESSION_MODE) {
  const storageKey = vibe64SessionModeStorageKey(sessionId);
  if (!storageKey) {
    return "";
  }
  const normalizedMode = normalizeVibe64SessionMode(mode);
  try {
    browserLocalStorage()?.setItem(storageKey, normalizedMode);
  } catch {
    // Browser storage can be unavailable in private or constrained contexts.
  }
  return normalizedMode;
}

function vibe64SessionModeFromRouteQuery(query = {}) {
  const rawMode = Array.isArray(query?.mode) ? query.mode[0] : query?.mode;
  return normalizeVibe64SessionMode(rawMode, "");
}

function vibe64SessionModeRouteQuery(query = {}, mode = DEFAULT_VIBE64_SESSION_MODE) {
  const nextQuery = {
    ...query
  };
  if (normalizeVibe64SessionMode(mode) === VIBE64_SESSION_MODES.INSPECT) {
    nextQuery.mode = VIBE64_SESSION_MODES.INSPECT;
  } else {
    delete nextQuery.mode;
  }
  return nextQuery;
}

function vibe64SessionModeRouteSynced(query = {}, mode = DEFAULT_VIBE64_SESSION_MODE) {
  const normalizedMode = normalizeVibe64SessionMode(mode);
  const hasMode = Object.prototype.hasOwnProperty.call(query || {}, "mode");
  if (normalizedMode === VIBE64_SESSION_MODES.INSPECT) {
    return query?.mode === VIBE64_SESSION_MODES.INSPECT;
  }
  return !hasMode;
}

export {
  VIBE64_SESSION_MODES,
  DEFAULT_VIBE64_SESSION_MODE,
  vibe64SessionModeFromRouteQuery,
  vibe64SessionModeRouteQuery,
  vibe64SessionModeRouteSynced,
  vibe64SessionModeStorageKey,
  normalizeVibe64SessionMode,
  readVibe64SessionMode,
  writeVibe64SessionMode
};
