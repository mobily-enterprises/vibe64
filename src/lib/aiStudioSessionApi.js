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

function aiStudioCodexTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function aiStudioCommandTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

async function readAiStudioArtifacts(sessionId) {
  return studioHttpClient.get(aiStudioSessionEndpoint(sessionId, "/artifacts"));
}

async function saveAiStudioArtifacts(sessionId, artifacts = {}) {
  return studioHttpClient.put(aiStudioSessionEndpoint(sessionId, "/artifacts"), {
    artifacts
  });
}

async function startAiStudioCodexTerminal(sessionId) {
  return studioHttpClient.post(aiStudioCodexTerminalEndpoint(sessionId), {});
}

async function closeAiStudioCodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function startAiStudioCommandTerminal(sessionId, actionId, input = {}) {
  return studioHttpClient.post(aiStudioCommandTerminalEndpoint(sessionId), {
    actionId,
    input
  });
}

async function closeAiStudioCommandTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(chunks.join(""));
}

async function uploadAiStudioCodexAttachment(sessionId, file) {
  const arrayBuffer = await file.arrayBuffer();
  return studioHttpClient.post(aiStudioSessionEndpoint(sessionId, "/codex-attachments"), {
    contentType: String(file.type || ""),
    dataBase64: arrayBufferToBase64(arrayBuffer),
    fileName: String(file.name || "attachment")
  });
}

async function saveAiStudioCodexThread(sessionId, threadId) {
  return studioHttpClient.post(aiStudioSessionEndpoint(sessionId, "/codex-thread"), {
    threadId
  });
}

async function saveAiStudioCodexPromptHandoff(sessionId, {
  outputStart = 0,
  signature = ""
} = {}) {
  return studioHttpClient.post(aiStudioSessionEndpoint(sessionId, "/codex-prompt-handoff"), {
    outputStart: String(Math.max(0, Number(outputStart || 0))),
    signature
  });
}

export {
  aiStudioCodexTerminalEndpoint,
  aiStudioCodexTerminalWebSocketUrl,
  aiStudioCommandTerminalEndpoint,
  aiStudioCommandTerminalWebSocketUrl,
  closeAiStudioCodexTerminal,
  closeAiStudioCommandTerminal,
  readAiStudioArtifacts,
  saveAiStudioArtifacts,
  saveAiStudioCodexPromptHandoff,
  saveAiStudioCodexThread,
  startAiStudioCodexTerminal,
  startAiStudioCommandTerminal,
  uploadAiStudioCodexAttachment
};
