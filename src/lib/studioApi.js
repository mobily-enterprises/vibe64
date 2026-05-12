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

async function runIssueSessionStep(sessionId, input = {}) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/step`, input);
}

async function abandonIssueSession(sessionId) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/abandon`, {});
}

function issueSessionCodexTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = `${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/codex-terminal`;
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function resolveWebSocketUrl(pathname) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}

function issueSessionCodexTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${issueSessionCodexTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

async function startIssueSessionCodexTerminal(sessionId) {
  return studioHttpClient.post(issueSessionCodexTerminalEndpoint(sessionId), {});
}

async function closeIssueSessionCodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(issueSessionCodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function saveIssueSessionCodexThread(sessionId, threadId) {
  return studioHttpClient.post(`${ISSUE_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}/codex-thread`, {
    threadId
  });
}

async function resolveStudioGate() {
  const bootstrap = await readBootstrapStatus();
  if (bootstrap?.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      route: "/bootup"
    });
  }

  const targetApp = await readTargetAppStatus();
  if (targetApp?.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      route: "/app-bootup",
      targetApp
    });
  }

  const appSetup = await readAppSetupStatus();
  if (appSetup?.ready !== true) {
    return rememberStudioGate({
      appSetup,
      bootstrap,
      route: "/app-setup",
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
  TARGET_APP_ENDPOINT,
  TARGET_APP_STREAM_ENDPOINT,
  TARGET_APP_TERMINAL_ENDPOINT,
  abandonIssueSession,
  closeIssueSessionCodexTerminal,
  createIssueSession,
  consumeStudioGate,
  issueSessionCodexTerminalEndpoint,
  issueSessionCodexTerminalWebSocketUrl,
  listIssueSessions,
  readAppSetupStatus,
  readBootstrapStatus,
  readCurrentApp,
  readIssueSession,
  readTargetAppStatus,
  resolveStudioGate,
  runIssueSessionStep,
  saveIssueSessionCodexThread,
  startIssueSessionCodexTerminal,
  studioHttpClient
};
