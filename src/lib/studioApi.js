import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";

const BOOTSTRAP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/bootstrap",
  strictParams: false
});

const TARGET_APP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/target-app",
  strictParams: false
});

const APP_SETUP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/app-setup",
  strictParams: false
});

const CURRENT_APP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/current-app",
  strictParams: false
});

const ISSUE_SESSIONS_ENDPOINT = `${CURRENT_APP_ENDPOINT}/issue-sessions`;
const BOOTSTRAP_TERMINAL_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/terminal`;
const TARGET_APP_TERMINAL_ENDPOINT = `${TARGET_APP_ENDPOINT}/terminal`;
const APP_SETUP_TERMINAL_ENDPOINT = `${APP_SETUP_ENDPOINT}/terminal`;
const BOOTSTRAP_STREAM_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/stream`;
const TARGET_APP_STREAM_ENDPOINT = `${TARGET_APP_ENDPOINT}/stream`;
const APP_SETUP_STREAM_ENDPOINT = `${APP_SETUP_ENDPOINT}/stream`;
const CURRENT_APP_TEST_TERMINAL_ENDPOINT = `${CURRENT_APP_ENDPOINT}/app-test-terminal`;
const NPM_SCRIPTS_ENDPOINT = `${CURRENT_APP_ENDPOINT}/npm-scripts`;
const NPM_SCRIPT_TERMINAL_ENDPOINT = `${CURRENT_APP_ENDPOINT}/npm-script-terminal`;

const studioHttpClient = createTransientRetryHttpClient({
  credentials: "include",
  csrf: {
    enabled: false
  }
});

let lastResolvedStudioGate = null;

function rememberStudioGate(gate) {
  lastResolvedStudioGate = gate || null;
  return gate;
}

function consumeStudioGate(route) {
  if (!lastResolvedStudioGate || lastResolvedStudioGate.route !== route) {
    return null;
  }

  const gate = lastResolvedStudioGate;
  lastResolvedStudioGate = null;
  return gate;
}

async function readBootstrapStatus() {
  return studioHttpClient.get(BOOTSTRAP_ENDPOINT);
}

async function readTargetAppStatus() {
  return studioHttpClient.get(TARGET_APP_ENDPOINT);
}

async function readAppSetupStatus() {
  return studioHttpClient.get(APP_SETUP_ENDPOINT);
}

async function readCurrentApp() {
  return studioHttpClient.get(CURRENT_APP_ENDPOINT);
}

async function readNpmScripts() {
  return studioHttpClient.get(NPM_SCRIPTS_ENDPOINT);
}

async function saveStarredNpmScripts(scriptNames = []) {
  return studioHttpClient.put(`${NPM_SCRIPTS_ENDPOINT}/starred`, {
    scriptNames
  });
}

async function resetStarredNpmScripts() {
  return studioHttpClient.delete(`${NPM_SCRIPTS_ENDPOINT}/starred`);
}

function withQuery(endpoint, params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalizedValue = String(value || "").trim();
    if (normalizedValue) {
      searchParams.set(key, normalizedValue);
    }
  }
  const query = searchParams.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}

async function listIssueSessions(options = {}) {
  return studioHttpClient.get(withQuery(ISSUE_SESSIONS_ENDPOINT, {
    archive: options.archive
  }));
}

async function createIssueSession() {
  return studioHttpClient.post(ISSUE_SESSIONS_ENDPOINT, {});
}

async function readIssueSession(sessionId) {
  return studioHttpClient.get(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}`);
}

async function readIssueSessionDiff(sessionId) {
  return studioHttpClient.get(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/diff`);
}

async function runIssueSessionStep(sessionId, input = {}) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/step`, input);
}

async function abandonIssueSession(sessionId) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/abandon`, {});
}

async function rewindIssueSession(sessionId, stepId) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/rewind`, {
    stepId
  });
}

function issueSessionCodexTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = `${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/codex-terminal`;
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function issueSessionStepTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = `${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/step-terminal`;
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function currentAppTestTerminalEndpoint(terminalSessionId = "") {
  return terminalSessionId
    ? `${CURRENT_APP_TEST_TERMINAL_ENDPOINT}/${encodeURIComponent(terminalSessionId)}`
    : CURRENT_APP_TEST_TERMINAL_ENDPOINT;
}

function npmScriptTerminalEndpoint(terminalSessionId = "") {
  return terminalSessionId
    ? `${NPM_SCRIPT_TERMINAL_ENDPOINT}/${encodeURIComponent(terminalSessionId)}`
    : NPM_SCRIPT_TERMINAL_ENDPOINT;
}

function issueSessionAppTestTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = `${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/app-test-terminal`;
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function resolveWebSocketUrl(pathname) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}

function issueSessionCodexTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${issueSessionCodexTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function issueSessionStepTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${issueSessionStepTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function currentAppTestTerminalWebSocketUrl(terminalSessionId) {
  return resolveWebSocketUrl(`${currentAppTestTerminalEndpoint(terminalSessionId)}/ws`);
}

function npmScriptTerminalWebSocketUrl(terminalSessionId) {
  return resolveWebSocketUrl(`${npmScriptTerminalEndpoint(terminalSessionId)}/ws`);
}

function issueSessionAppTestTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${issueSessionAppTestTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

async function startIssueSessionCodexTerminal(sessionId) {
  return studioHttpClient.post(issueSessionCodexTerminalEndpoint(sessionId), {});
}

async function startIssueSessionStepTerminal(sessionId) {
  return studioHttpClient.post(issueSessionStepTerminalEndpoint(sessionId), {});
}

async function startCurrentAppTestTerminal() {
  return studioHttpClient.post(currentAppTestTerminalEndpoint(), {});
}

async function startNpmScriptTerminal(scriptName) {
  return studioHttpClient.post(npmScriptTerminalEndpoint(), {
    scriptName
  });
}

async function startIssueSessionAppTestTerminal(sessionId) {
  return studioHttpClient.post(issueSessionAppTestTerminalEndpoint(sessionId), {});
}

async function closeIssueSessionCodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(issueSessionCodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function readIssueSessionCodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.get(issueSessionCodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function closeIssueSessionStepTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(issueSessionStepTerminalEndpoint(sessionId, terminalSessionId));
}

async function closeCurrentAppTestTerminal(terminalSessionId) {
  return studioHttpClient.delete(currentAppTestTerminalEndpoint(terminalSessionId));
}

async function closeNpmScriptTerminal(terminalSessionId) {
  return studioHttpClient.delete(npmScriptTerminalEndpoint(terminalSessionId));
}

async function closeIssueSessionAppTestTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(issueSessionAppTestTerminalEndpoint(sessionId, terminalSessionId));
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

async function uploadIssueSessionCodexAttachment(sessionId, file) {
  const arrayBuffer = await file.arrayBuffer();
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/codex-attachments`, {
    contentType: String(file.type || ""),
    dataBase64: arrayBufferToBase64(arrayBuffer),
    fileName: String(file.name || "attachment")
  });
}

async function saveIssueSessionCodexThread(sessionId, threadId) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/codex-thread`, {
    threadId
  });
}

async function saveIssueSessionCodexPromptHandoff(sessionId, {
  outputStart = 0,
  signature = ""
} = {}) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/codex-prompt-handoff`, {
    outputStart: String(Math.max(0, Number(outputStart || 0))),
    signature
  });
}

async function resolveStudioGate() {
  const bootstrap = await readBootstrapStatus();
  if (bootstrap?.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      route: "/bootup-setup",
      tab: "bootup"
    });
  }

  const targetApp = await readTargetAppStatus();
  if (targetApp?.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      route: "/bootup-setup",
      tab: "app-bootup",
      targetApp
    });
  }

  const appSetup = await readAppSetupStatus();
  if (appSetup?.ready !== true) {
    return rememberStudioGate({
      appSetup,
      bootstrap,
      route: "/bootup-setup",
      tab: "app-setup",
      targetApp
    });
  }

  return rememberStudioGate({
    appSetup,
    bootstrap,
    route: "/home",
    targetApp
  });
}

export {
  APP_SETUP_ENDPOINT,
  APP_SETUP_STREAM_ENDPOINT,
  APP_SETUP_TERMINAL_ENDPOINT,
  BOOTSTRAP_ENDPOINT,
  BOOTSTRAP_STREAM_ENDPOINT,
  BOOTSTRAP_TERMINAL_ENDPOINT,
  CURRENT_APP_ENDPOINT,
  ISSUE_SESSIONS_ENDPOINT,
  NPM_SCRIPT_TERMINAL_ENDPOINT,
  NPM_SCRIPTS_ENDPOINT,
  TARGET_APP_ENDPOINT,
  TARGET_APP_STREAM_ENDPOINT,
  TARGET_APP_TERMINAL_ENDPOINT,
  abandonIssueSession,
  closeIssueSessionCodexTerminal,
  closeCurrentAppTestTerminal,
  closeIssueSessionAppTestTerminal,
  closeIssueSessionStepTerminal,
  closeNpmScriptTerminal,
  createIssueSession,
  consumeStudioGate,
  currentAppTestTerminalEndpoint,
  currentAppTestTerminalWebSocketUrl,
  issueSessionCodexTerminalEndpoint,
  issueSessionCodexTerminalWebSocketUrl,
  issueSessionAppTestTerminalEndpoint,
  issueSessionAppTestTerminalWebSocketUrl,
  issueSessionStepTerminalWebSocketUrl,
  listIssueSessions,
  npmScriptTerminalEndpoint,
  npmScriptTerminalWebSocketUrl,
  readAppSetupStatus,
  readBootstrapStatus,
  readCurrentApp,
  readIssueSession,
  readIssueSessionCodexTerminal,
  readIssueSessionDiff,
  readNpmScripts,
  readTargetAppStatus,
  resolveStudioGate,
  resetStarredNpmScripts,
  rewindIssueSession,
  runIssueSessionStep,
  saveIssueSessionCodexPromptHandoff,
  saveIssueSessionCodexThread,
  saveStarredNpmScripts,
  startCurrentAppTestTerminal,
  startIssueSessionAppTestTerminal,
  startIssueSessionCodexTerminal,
  startIssueSessionStepTerminal,
  startNpmScriptTerminal,
  studioHttpClient,
  uploadIssueSessionCodexAttachment
};
