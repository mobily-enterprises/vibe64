import {
  resolveWebSocketUrl,
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";

const VIBE64_ENDPOINT = studioApiPath("vibe64");
const VIBE64_SESSIONS_ENDPOINT = `${VIBE64_ENDPOINT}/sessions`;
const VIBE64_GLOBAL_CODEX_TERMINAL_ENDPOINT = `${VIBE64_ENDPOINT}/codex-terminal`;
const VIBE64_TOOLS_ENDPOINT = `${VIBE64_ENDPOINT}/tools`;
const VIBE64_FIX_CODEX_JOBS_ENDPOINT = `${VIBE64_ENDPOINT}/fix-codex-jobs`;

function vibe64SessionEndpoint(sessionId, suffix = "") {
  return `${VIBE64_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}${suffix}`;
}

function vibe64CodexTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = vibe64SessionEndpoint(sessionId, "/codex-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function vibe64CodexTerminalControlEndpoint(sessionId, terminalSessionId, suffix = "") {
  return `${vibe64CodexTerminalEndpoint(sessionId, terminalSessionId)}/control${suffix}`;
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

function vibe64ProjectToolRunEndpoint(toolId) {
  return vibe64ProjectToolEndpoint(toolId, "/run");
}

function vibe64ProjectToolFixEndpoint(toolId) {
  return vibe64ProjectToolEndpoint(toolId, "/fix");
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

function vibe64CurrentStepInputEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/current-step/input");
}

function vibe64TerminalFailureFixRequestEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/terminal-failure-fix-request");
}

function vibe64TerminalFailureFixEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/terminal-failure-fix");
}

function vibe64CodexTurnInterruptEndpoint(sessionId) {
  return vibe64SessionEndpoint(sessionId, "/codex-turn/interrupt");
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

function vibe64ShellTerminalControlEndpoint(sessionId, terminalSessionId, suffix = "") {
  return `${vibe64ShellTerminalEndpoint(sessionId, terminalSessionId)}/control${suffix}`;
}

function vibe64CodexTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64CodexTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
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

function vibe64ShellTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${vibe64ShellTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function normalizeVibe64ProjectToolFixInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    actionId: String(source.actionId || ""),
    actionLabel: String(source.actionLabel || ""),
    attemptedCommand: String(source.attemptedCommand || ""),
    closeError: String(source.closeError || ""),
    commandPreview: String(source.commandPreview || ""),
    exitCode: source.exitCode == null ? "" : String(source.exitCode),
    output: String(source.output || ""),
    terminalSessionId: String(source.terminalSessionId || ""),
    terminalStatus: String(source.terminalStatus || ""),
    toolId: String(source.toolId || ""),
    toolLabel: String(source.toolLabel || ""),
    userMessage: String(source.userMessage || "")
  };
}

async function readVibe64SessionDiff(sessionId) {
  return studioHttpClient.get(vibe64SessionEndpoint(sessionId, "/diff"));
}

async function startVibe64CodexTerminal(sessionId) {
  return studioHttpClient.post(vibe64CodexTerminalEndpoint(sessionId), {});
}

async function interruptVibe64CodexTurn(sessionId) {
  return studioHttpClient.post(vibe64CodexTurnInterruptEndpoint(sessionId), {});
}

async function startVibe64GlobalCodexTerminal() {
  return studioHttpClient.post(vibe64GlobalCodexTerminalEndpoint(), {});
}

async function readVibe64GlobalCodexTerminalState() {
  return studioHttpClient.get(vibe64GlobalCodexTerminalEndpoint());
}

async function closeVibe64CodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(vibe64CodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function closeVibe64GlobalCodexTerminal(_scopeId, terminalSessionId) {
  return studioHttpClient.delete(vibe64GlobalCodexTerminalEndpoint(terminalSessionId));
}

async function readVibe64CodexTerminalControlSnapshot(sessionId, terminalSessionId) {
  return studioHttpClient.get(vibe64CodexTerminalControlEndpoint(sessionId, terminalSessionId, "/snapshot"));
}

async function checkVibe64CodexTerminalText(sessionId, terminalSessionId, text = "") {
  return studioHttpClient.post(vibe64CodexTerminalControlEndpoint(sessionId, terminalSessionId, "/check-text"), {
    text: String(text || "")
  });
}

async function sendVibe64CodexTerminalText(sessionId, terminalSessionId, text = "") {
  return studioHttpClient.post(vibe64CodexTerminalControlEndpoint(sessionId, terminalSessionId, "/text"), {
    text: String(text || "")
  });
}

async function readVibe64ShellTerminalControlSnapshot(sessionId, terminalSessionId) {
  return studioHttpClient.get(vibe64ShellTerminalControlEndpoint(sessionId, terminalSessionId, "/snapshot"));
}

async function readVibe64ShellTerminalQuiet(sessionId, terminalSessionId) {
  return studioHttpClient.get(vibe64ShellTerminalControlEndpoint(sessionId, terminalSessionId, "/quiet"));
}

async function checkVibe64ShellTerminalText(sessionId, terminalSessionId, text = "") {
  return studioHttpClient.post(vibe64ShellTerminalControlEndpoint(sessionId, terminalSessionId, "/check-text"), {
    text: String(text || "")
  });
}

async function sendVibe64ShellTerminalText(sessionId, terminalSessionId, text = "") {
  return studioHttpClient.post(vibe64ShellTerminalControlEndpoint(sessionId, terminalSessionId, "/text"), {
    text: String(text || "")
  });
}

async function sendVibe64ShellTerminalKey(sessionId, terminalSessionId, key = "") {
  return studioHttpClient.post(vibe64ShellTerminalControlEndpoint(sessionId, terminalSessionId, "/key"), {
    key: String(key || "")
  });
}

async function startVibe64CommandTerminal(sessionId, input = {}) {
  return studioHttpClient.post(vibe64CommandTerminalEndpoint(sessionId), input);
}

async function readVibe64ProjectTools() {
  return studioHttpClient.get(VIBE64_TOOLS_ENDPOINT);
}

async function runVibe64ProjectTool(toolId, input = {}) {
  return studioHttpClient.post(vibe64ProjectToolRunEndpoint(toolId), input);
}

async function closeVibe64ProjectToolTerminal(toolId, terminalSessionId) {
  return studioHttpClient.delete(vibe64ProjectToolTerminalEndpoint(toolId, terminalSessionId));
}

async function startVibe64ProjectToolFixJob(toolId, input = {}) {
  return studioHttpClient.post(vibe64ProjectToolFixEndpoint(toolId), normalizeVibe64ProjectToolFixInput({
    ...input,
    toolId: input?.toolId || toolId
  }));
}

async function closeVibe64FixCodexTerminal(jobId, terminalSessionId) {
  return studioHttpClient.delete(vibe64FixCodexTerminalEndpoint(jobId, terminalSessionId));
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

async function startVibe64SessionTerminalFixJob(sessionId, input = {}) {
  const payload = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  return studioHttpClient.post(vibe64TerminalFailureFixEndpoint(sessionId), payload);
}

export {
  vibe64CodexTerminalWebSocketUrl,
  vibe64GlobalCodexTerminalWebSocketUrl,
  vibe64CommandTerminalWebSocketUrl,
  vibe64FixCodexTerminalWebSocketUrl,
  vibe64ArtifactReadinessStreamEndpoint,
  vibe64LaunchTerminalWebSocketUrl,
  vibe64ProjectToolTerminalWebSocketUrl,
  vibe64ShellTerminalWebSocketUrl,
  normalizeVibe64ProjectToolFixInput,
  closeVibe64CodexTerminal,
  closeVibe64FixCodexTerminal,
  closeVibe64GlobalCodexTerminal,
  closeVibe64CommandTerminal,
  closeVibe64ProjectToolTerminal,
  checkVibe64CodexTerminalText,
  checkVibe64ShellTerminalText,
  buildVibe64TerminalFailureFixRequest,
  interruptVibe64CodexTurn,
  readVibe64CodexTerminalControlSnapshot,
  readVibe64GlobalCodexTerminalState,
  readVibe64ArtifactReadiness,
  readVibe64SessionDiff,
  readVibe64ProjectTools,
  readVibe64ShellTerminalControlSnapshot,
  readVibe64ShellTerminalQuiet,
  runVibe64ProjectTool,
  sendVibe64CodexTerminalText,
  sendVibe64ShellTerminalKey,
  sendVibe64ShellTerminalText,
  submitVibe64CurrentStepInput,
  startVibe64CodexTerminal,
  startVibe64GlobalCodexTerminal,
  startVibe64CommandTerminal,
  startVibe64SessionTerminalFixJob,
  startVibe64ProjectToolFixJob
};
