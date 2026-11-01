import { VIBE64_ASSISTANT_ENGINE_IDS } from "../shared/assistantSelection.js";
import {
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  effectiveVibe64AgentExecutionSettings
} from "../shared/agentSettings.js";
import {
  codexAppServerThreadSettings as nativeCodexAppServerThreadSettings,
  codexAppServerTurnSettings as nativeCodexAppServerTurnSettings
} from "@jskit-ai/assistant-core/server/codex-configuration";
import { isPlainRecord } from "../shared/isPlainRecord.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

// Codex session defaults and the thread and turn settings session threads and
// helper threads share.
const CODEX_SESSION_AGENT_PROVIDER = VIBE64_ASSISTANT_ENGINE_IDS.CODEX;
const CODEX_SESSION_MODEL = VIBE64_CODEX_DEFAULT_MODEL;
const CODEX_SESSION_REASONING_EFFORT = VIBE64_CODEX_DEFAULT_THINKING;
const CODEX_SESSION_REASONING_SUMMARY = "concise";
const CODEX_SESSION_APPROVAL_POLICY = "never";
const CODEX_SESSION_SANDBOX = "danger-full-access";
const CODEX_SESSION_READ_ONLY_SANDBOX = "read-only";

function normalizeWorkdir(value = "") {
  return toText(value);
}

function codexEffectiveAgentExecutionSettings(agentSettings = {}) {
  return effectiveVibe64AgentExecutionSettings(agentSettings);
}

function codexAppServerThreadSettings({
  agentSettings = {},
  config = null,
  cwd = "",
  systemPrompt = null,
  hostContext = null,
  model = ""
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw new Error("Codex app-server thread requires a working directory.");
  }
  const effectiveSettings = codexEffectiveAgentExecutionSettings(agentSettings);
  return nativeCodexAppServerThreadSettings({
    effectiveSettings,
    config,
    cwd: normalizedCwd,
    systemPrompt,
    hostContext,
    model,
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    reasoningSummary: CODEX_SESSION_REASONING_SUMMARY,
    sandbox: CODEX_SESSION_SANDBOX
  });
}

function codexAppServerTurnSettings({
  agentSettings = {},
  cwd = "",
  effort = "",
  model = ""
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw new Error("Codex app-server turn requires a working directory.");
  }
  const effectiveSettings = codexEffectiveAgentExecutionSettings(agentSettings);
  return nativeCodexAppServerTurnSettings({
    effectiveSettings,
    cwd: normalizedCwd,
    effort,
    model,
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    reasoningSummary: CODEX_SESSION_REASONING_SUMMARY,
    externalSandbox: true
  });
}

export {
  CODEX_SESSION_AGENT_PROVIDER,
  CODEX_SESSION_APPROVAL_POLICY,
  CODEX_SESSION_MODEL,
  CODEX_SESSION_READ_ONLY_SANDBOX,
  CODEX_SESSION_REASONING_EFFORT,
  CODEX_SESSION_REASONING_SUMMARY,
  CODEX_SESSION_SANDBOX,
  codexAppServerThreadSettings,
  codexAppServerTurnSettings,
  codexEffectiveAgentExecutionSettings,
  isPlainRecord,
  normalizeWorkdir
};
