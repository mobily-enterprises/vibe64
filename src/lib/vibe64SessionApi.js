import {
  resolveWebSocketUrl,
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";

const VIBE64_ENDPOINT = studioApiPath("vibe64");
const VIBE64_SESSIONS_ENDPOINT = `${VIBE64_ENDPOINT}/sessions`;

function vibe64SessionEndpoint(sessionId, suffix = "") {
  return `${VIBE64_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}${suffix}`;
}

function vibe64CodexTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/codex-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64CommandTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/command-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64ArtifactReadinessEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/artifact-readiness");
}

function vibe64CurrentStepInputEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/current-step/input");
}

function vibe64TerminalFailureFixRequestEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/terminal-failure-fix-request");
}

function vibe64ArtifactReadinessStreamEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/artifact-readiness/stream");
}

function vibe64LaunchTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/launch-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64ShellTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/shell-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64CodexTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64CodexTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function vibe64CommandTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64CommandTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function vibe64LaunchTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64LaunchTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function vibe64ShellTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64ShellTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

async function readVibe64SessionDiff(sessionId) {
  return studioHttpClient.get(vibe64SessionEndpoint(sessionId, "/diff"));
}

async function startVibe64CodexTerminal(sessionId) {
  return studioHttpClient.post(vibe64CodexTerminalEndpoint(sessionId), {});
}

async function closeVibe64CodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(vibe64CodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function startVibe64CommandTerminal(sessionId, input = {}) {
  return studioHttpClient.post(vibe64CommandTerminalEndpoint(sessionId), input);
}

async function closeVibe64CommandTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(vibe64CommandTerminalEndpoint(sessionId, terminalSessionId));
}

async function readVibe64ArtifactReadiness(sessionId) {
  return studioHttpClient.get(vibe64ArtifactReadinessEndpoint(sessionId));
}

async function submitVibe64CurrentStepInput(sessionId, input = {}) {
  const payload = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  return studioHttpClient.post(vibe64CurrentStepInputEndpoint(sessionId), {
    ...payload,
    kind: payload.kind || "ready"
  });
}

async function buildVibe64TerminalFailureFixRequest(sessionId, input = {}) {
  const payload = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  return studioHttpClient.post(vibe64TerminalFailureFixRequestEndpoint(sessionId), payload);
}

export {
  vibe64CodexTerminalWebSocketUrl,
  vibe64CommandTerminalWebSocketUrl,
  vibe64ArtifactReadinessStreamEndpoint,
  vibe64LaunchTerminalWebSocketUrl,
  vibe64ShellTerminalWebSocketUrl,
  closeVibe64CodexTerminal,
  closeVibe64CommandTerminal,
  buildVibe64TerminalFailureFixRequest,
  readVibe64ArtifactReadiness,
  readVibe64SessionDiff,
  submitVibe64CurrentStepInput,
  startVibe64CodexTerminal,
  startVibe64CommandTerminal
};
