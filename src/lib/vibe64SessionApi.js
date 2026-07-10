import {
  resolveWebSocketUrl,
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";

const VIBE64_ENDPOINT = studioApiPath("vibe64");
const VIBE64_SESSIONS_ENDPOINT = `${VIBE64_ENDPOINT}/sessions`;
const VIBE64_GLOBAL_CODEX_TERMINAL_ENDPOINT = `${VIBE64_ENDPOINT}/codex-terminal`;
const VIBE64_TOOLS_ENDPOINT = `${VIBE64_ENDPOINT}/tools`;
const VIBE64_FIX_CODEX_JOBS_ENDPOINT = `${VIBE64_ENDPOINT}/fix-codex-jobs`;

function vibe64SessionEndpoint(sessionId, suffix = "") {
  return `${VIBE64_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}${suffix}`;
}

function vibe64AgentTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/agent-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64GlobalCodexTerminalEndpoint(terminalSessionId = "") {
  return terminalSessionId
    ? `${VIBE64_GLOBAL_CODEX_TERMINAL_ENDPOINT}/${encodeURIComponent(terminalSessionId)}`
    : VIBE64_GLOBAL_CODEX_TERMINAL_ENDPOINT;
}

function vibe64CommandTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/command-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64ProjectToolEndpoint(toolId, suffix = "") {
  return `${VIBE64_TOOLS_ENDPOINT}/${encodeURIComponent(toolId)}${suffix}`;
}

function vibe64ProjectToolTerminalEndpoint(toolId, terminalSessionId = "") {
  const base = vibe64ProjectToolEndpoint(toolId, "/terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64FixCodexTerminalEndpoint(jobId, terminalSessionId = "") {
  const base = `${VIBE64_FIX_CODEX_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/terminal`;
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64ArtifactReadinessEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/artifact-readiness");
}

function vibe64ArtifactReadinessStreamEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/artifact-readiness/stream");
}

function vibe64ArtifactReadinessWebSocketUrl(sessionId) {
  return resolveWebSocketUrl(vibe64SessionEndpoint(sessionId, "/artifact-readiness/ws"));
}

function appendQueryParam(url = "", key = "", value = "") {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return url;
  }
  const separator = String(url || "").includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(normalizedValue)}`;
}

function vibe64LaunchTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/launch-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64AgentTerminalWebSocketUrl(sessionId, terminalSessionId) {
  const endpoint = appendQueryParam(
    `${vibe64AgentTerminalEndpoint(sessionId, terminalSessionId)}/ws`,
    "originId",
    vibe64BrowserTabOriginId()
  );
  return resolveWebSocketUrl(endpoint);
}

function vibe64GlobalCodexTerminalWebSocketUrl(_scopeId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64GlobalCodexTerminalEndpoint(terminalSessionId)}/ws`);
}

function vibe64CommandTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64CommandTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function vibe64ProjectToolTerminalWebSocketUrl(toolId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64ProjectToolTerminalEndpoint(toolId, terminalSessionId)}/ws`);
}

function vibe64FixCodexTerminalWebSocketUrl(jobId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64FixCodexTerminalEndpoint(jobId, terminalSessionId)}/ws`);
}

function vibe64LaunchTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64LaunchTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

export {
  vibe64AgentTerminalWebSocketUrl,
  vibe64GlobalCodexTerminalWebSocketUrl,
  vibe64CommandTerminalWebSocketUrl,
  vibe64FixCodexTerminalWebSocketUrl,
  vibe64ArtifactReadinessEndpoint,
  vibe64ArtifactReadinessStreamEndpoint,
  vibe64ArtifactReadinessWebSocketUrl,
  vibe64LaunchTerminalWebSocketUrl,
  vibe64ProjectToolTerminalWebSocketUrl,
  VIBE64_TOOLS_ENDPOINT
};
