import {
  resolveWebSocketUrl,
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64AgentTerminalPath,
  vibe64GlobalCodexTerminalPath,
  vibe64OutputRunPath
} from "@/lib/vibe64SessionRequestConfig.js";

const VIBE64_ENDPOINT = studioApiPath("vibe64");
const VIBE64_SESSIONS_ENDPOINT = `${VIBE64_ENDPOINT}/sessions`;

function appendQueryParam(url = "", key = "", value = "") {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return url;
  }
  const separator = String(url || "").includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(normalizedValue)}`;
}

function vibe64AgentTerminalWebSocketUrl(sessionId, terminalSessionId) {
  const endpoint = appendQueryParam(
    `${vibe64AgentTerminalPath(VIBE64_SESSIONS_ENDPOINT, sessionId, terminalSessionId)}/ws`,
    "originId",
    vibe64BrowserTabOriginId()
  );
  return resolveWebSocketUrl(endpoint);
}

function vibe64GlobalCodexTerminalWebSocketUrl(_scopeId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64GlobalCodexTerminalPath(VIBE64_ENDPOINT, terminalSessionId)}/ws`);
}

function vibe64OutputTerminalWebSocketUrl(sessionId, terminalSessionId, sessionsEndpoint = VIBE64_SESSIONS_ENDPOINT) {
  return resolveWebSocketUrl(
    `${vibe64OutputRunPath(sessionsEndpoint, sessionId, terminalSessionId)}/ws`
  );
}

export {
  vibe64AgentTerminalWebSocketUrl,
  vibe64GlobalCodexTerminalWebSocketUrl,
  vibe64OutputTerminalWebSocketUrl
};
