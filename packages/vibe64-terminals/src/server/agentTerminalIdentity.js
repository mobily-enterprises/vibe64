import path from "node:path";

const MAX_AGENT_IDENTITY_VALUE_LENGTH = 512;

export const AGENT_TERMINAL_IDENTITY_STATUS = Object.freeze({
  ATTENTION_REQUIRED: "attention_required",
  FAILED: "failed",
  PENDING: "pending",
  READY: "ready"
});

export const AGENT_TERMINAL_RESUME_STRATEGY = Object.freeze({
  NOT_RESUMABLE: "not-resumable",
  PROVIDER_NATIVE: "provider-native",
  TERMINAL_REUSE: "terminal-reuse"
});

function normalizeIdentityText(value) {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > MAX_AGENT_IDENTITY_VALUE_LENGTH ||
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    return "";
  }
  return normalized;
}

export function normalizeAgentProvider(value) {
  const provider = normalizeIdentityText(value).toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(provider)) {
    return "";
  }
  return provider;
}

export function normalizeAgentConversationId(value) {
  return normalizeIdentityText(value);
}

export function normalizeAgentResumeStrategy(value) {
  const strategy = normalizeIdentityText(value);
  return Object.values(AGENT_TERMINAL_RESUME_STRATEGY).includes(strategy)
    ? strategy
    : "";
}

export function normalizeAgentIdentityStatus(value) {
  const status = normalizeIdentityText(value);
  return Object.values(AGENT_TERMINAL_IDENTITY_STATUS).includes(status)
    ? status
    : "";
}

export function normalizeAgentWorkdir(value) {
  const workdir = String(value || "").trim();
  if (!workdir) {
    return "";
  }
  return path.resolve(workdir);
}

export function agentTerminalIdentityForWorkdir(session = {}, {
  provider = "",
  validateConversationId = normalizeAgentConversationId,
  workdir = ""
} = {}) {
  const metadata = session.metadata || {};
  const normalizedProvider = normalizeAgentProvider(provider);
  const recordedProvider = normalizeAgentProvider(metadata.agent_identity_provider);
  if (!normalizedProvider || recordedProvider !== normalizedProvider) {
    return null;
  }

  const status = normalizeAgentIdentityStatus(metadata.agent_identity_status);
  if (status !== AGENT_TERMINAL_IDENTITY_STATUS.READY) {
    return null;
  }

  const conversationId = validateConversationId(metadata.agent_identity_conversation_id);
  if (!conversationId) {
    return null;
  }

  const normalizedWorkdir = normalizeAgentWorkdir(workdir);
  const recordedWorkdir = normalizeAgentWorkdir(metadata.agent_identity_workdir);
  if (!normalizedWorkdir || !recordedWorkdir || recordedWorkdir !== normalizedWorkdir) {
    return null;
  }

  return {
    capturedAt: normalizeIdentityText(metadata.agent_identity_captured_at),
    conversationId,
    provider: normalizedProvider,
    resumeStrategy: normalizeAgentResumeStrategy(metadata.agent_identity_resume_strategy),
    source: "agent_identity",
    status,
    terminalSessionId: normalizeIdentityText(metadata.agent_identity_terminal_session_id),
    workdir: recordedWorkdir
  };
}

export function agentTerminalIdentityState(session = {}, {
  provider = "",
  validateConversationId = normalizeAgentConversationId,
  workdir = ""
} = {}) {
  const identity = agentTerminalIdentityForWorkdir(session, {
    provider,
    validateConversationId,
    workdir
  });
  if (identity) {
    return identity;
  }
  const metadata = session.metadata || {};
  const normalizedProvider = normalizeAgentProvider(provider);
  const recordedProvider = normalizeAgentProvider(metadata.agent_identity_provider);
  if (!normalizedProvider || recordedProvider !== normalizedProvider) {
    return null;
  }
  return {
    capturedAt: normalizeIdentityText(metadata.agent_identity_captured_at),
    conversationId: "",
    error: String(metadata.agent_identity_error || "").trim(),
    provider: normalizedProvider,
    resumeStrategy: normalizeAgentResumeStrategy(metadata.agent_identity_resume_strategy),
    source: "agent_identity",
    status: normalizeAgentIdentityStatus(metadata.agent_identity_status),
    terminalSessionId: normalizeIdentityText(metadata.agent_identity_terminal_session_id),
    workdir: normalizeAgentWorkdir(metadata.agent_identity_workdir)
  };
}
