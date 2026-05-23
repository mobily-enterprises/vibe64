import {
  resolveWebSocketUrl,
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";

const AI_STUDIO_ENDPOINT = studioApiPath("ai-studio");
const AI_STUDIO_SESSIONS_ENDPOINT = `${AI_STUDIO_ENDPOINT}/sessions`;

function aiStudioSessionEndpoint(sessionId, suffix = "") {
  return `${AI_STUDIO_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}${suffix}`;
}

function aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = aiStudioSessionEndpoint(sessionId, "/codex-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = aiStudioSessionEndpoint(sessionId, "/command-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function aiStudioArtifactReadinessEndpoint(sessionId) {
  return aiStudioSessionEndpoint(sessionId, "/artifact-readiness");
}

function aiStudioCurrentStepInputEndpoint(sessionId) {
  return aiStudioSessionEndpoint(sessionId, "/current-step/input");
}

function aiStudioArtifactReadinessStreamEndpoint(sessionId) {
  return aiStudioSessionEndpoint(sessionId, "/artifact-readiness/stream");
}

function aiStudioLaunchTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = aiStudioSessionEndpoint(sessionId, "/launch-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function aiStudioShellTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = aiStudioSessionEndpoint(sessionId, "/shell-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function aiStudioCodexTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function aiStudioCommandTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function aiStudioLaunchTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioLaunchTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function aiStudioShellTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioShellTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

async function readAiStudioSessionDiff(sessionId) {
  return studioHttpClient.get(aiStudioSessionEndpoint(sessionId, "/diff"));
}

async function startAiStudioCodexTerminal(sessionId) {
  return studioHttpClient.post(aiStudioCodexTerminalEndpoint(sessionId), {});
}

async function closeAiStudioCodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function startAiStudioCommandTerminal(sessionId, input = {}) {
  return studioHttpClient.post(aiStudioCommandTerminalEndpoint(sessionId), input);
}

async function closeAiStudioCommandTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId));
}

async function readAiStudioArtifactReadiness(sessionId) {
  return studioHttpClient.get(aiStudioArtifactReadinessEndpoint(sessionId));
}

async function submitAiStudioCurrentStepInput(sessionId, input = {}) {
  const payload = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  return studioHttpClient.post(aiStudioCurrentStepInputEndpoint(sessionId), {
    ...payload,
    kind: payload.kind || "ready"
  });
}

export {
  aiStudioCodexTerminalWebSocketUrl,
  aiStudioCommandTerminalWebSocketUrl,
  aiStudioArtifactReadinessStreamEndpoint,
  aiStudioLaunchTerminalWebSocketUrl,
  aiStudioShellTerminalWebSocketUrl,
  closeAiStudioCodexTerminal,
  closeAiStudioCommandTerminal,
  readAiStudioArtifactReadiness,
  readAiStudioSessionDiff,
  submitAiStudioCurrentStepInput,
  startAiStudioCodexTerminal,
  startAiStudioCommandTerminal
};
