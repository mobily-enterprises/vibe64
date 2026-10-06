import { validateConversationOutputSchema } from "@jskit-ai/assistant-core/server/conversation";
import { sendPreparedCodexAppServerHelperTurn } from "@jskit-ai/assistant-core/server/codex-turn";
import {
  ensureCodexAppServerThread, sendCodexAppServerPrompt,
  resumeExactCodexAppServerThread, startFreshCodexAppServerThread,
  defineCodexRenewalThreadIds, codexRenewalThreadError
} from "@jskit-ai/assistant-core/server/codex-provider";
import {
  createCodexAppServerIsolation, codexAppServerProjectHookTrustConfig,
  codexAppServerThreadSettings as nativeCodexAppServerThreadSettings,
  codexAppServerTurnSettings as nativeCodexAppServerTurnSettings
} from "@jskit-ai/assistant-core/server/codex-configuration";

import { MINIMUM_CODEX_VERSION } from "./minimumCodexVersion.js";
import {
  CODEX_APP_SERVER_PROVIDER_ID,
  codexCliResumeCommand
} from "./codexAppServerProvider.js";
import {
  normalizeAgentText
} from "./agentProviders.js";
import {
  vibe64SessionDebugLog
} from "./sessionDebugLog.js";
import {
  VIBE64_AGENT_PROVIDER_IDS,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  effectiveVibe64AgentExecutionSettings
} from "../shared/agentSettings.js";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileResolution
} from "../shared/agentExecutionProfiles.js";

const CODEX_SESSION_AGENT_PROVIDER = "codex";
const CODEX_SESSION_MODEL = VIBE64_CODEX_DEFAULT_MODEL;
const CODEX_SESSION_REASONING_EFFORT = VIBE64_CODEX_DEFAULT_THINKING;
const CODEX_SESSION_REASONING_SUMMARY = "concise";
const CODEX_SESSION_APPROVAL_POLICY = "never";
const CODEX_SESSION_SANDBOX = "danger-full-access";
const CODEX_SESSION_READ_ONLY_SANDBOX = "read-only";
const CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE =
  "vibe64_session_renewal_thread_unreadable";
const CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE =
  "vibe64_session_renewal_fresh_thread_required";
const CODEX_SESSION_RENEWAL_BASELINE_METADATA =
  "agent_renewal_seed_thread_baseline";
const CODEX_SESSION_RENEWAL_BASELINE_SCHEMA =
  "vibe64.codex-renewal-thread-baseline.v1";
const CODEX_SESSION_RENEWAL_THREAD_CLAIM_METADATA =
  "agent_renewal_seed_thread_claim";
const CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA =
  "vibe64.codex-renewal-thread-claim.v1";
const CODEX_APP_SERVER_HELPER_SANDBOX = "read-only";
const CODEX_APP_SERVER_HELPER_USER_AGENT_MAX_LENGTH = 512;
const CODEX_APP_SERVER_HELPER_MCP_SERVER_MAX_COUNT = 128;
const CODEX_APP_SERVER_HELPER_MCP_SERVER_NAME_MAX_LENGTH = 256;
const CODEX_APP_SERVER_HELPER_CONFIG_RESPONSE_MAX_BYTES = 256 * 1024;
const CODEX_APP_SERVER_HELPER_HOOK_MAX_COUNT = 256;
const CODEX_APP_SERVER_HELPER_HOOK_ERROR_MAX_COUNT = 256;
const CODEX_APP_SERVER_HELPER_HOOK_FIELD_MAX_LENGTH = 2048;
const CODEX_APP_SERVER_HELPER_HOOK_FINGERPRINT_MAX_LENGTH = 256 * 1024;
const CODEX_APP_SERVER_HELPER_HOOK_RESPONSE_MAX_BYTES = 512 * 1024;
const CODEX_APP_SERVER_HELPER_DEVELOPER_INSTRUCTIONS_MAX_LENGTH = 8192;
const CODEX_APP_SERVER_HELPER_THREAD_SOURCE = "vibe64-helper";
const CODEX_APP_SERVER_HELPER_BASE_INSTRUCTIONS = [
  "Complete only the bounded structured task in the user input.",
  "Return one response matching the supplied JSON schema.",
  "Do not use tools, environments, network access, or repository writes."
].join(" ");
const CODEX_APP_SERVER_HELPER_TOOL_FEATURES = Object.freeze([
  "apps",
  "artifact",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode",
  "code_mode_host",
  "computer_use",
  "current_time_reminder",
  "default_mode_request_user_input",
  "deferred_executor",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "psp",
  "recommended_plugins",
  "request_permissions_tool",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "sleep_tool",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "token_budget",
  "unified_exec",
  "unified_exec_zsh_fork",
  "view_image"
]);
const codexAppServerHelperIsolation = createCodexAppServerIsolation({
  clientName: "vibe64",
  minimumVersion: MINIMUM_CODEX_VERSION,
  disabledFeatures: CODEX_APP_SERVER_HELPER_TOOL_FEATURES,
  limits: {
    userAgentMaxLength: CODEX_APP_SERVER_HELPER_USER_AGENT_MAX_LENGTH,
    mcpServerMaxCount: CODEX_APP_SERVER_HELPER_MCP_SERVER_MAX_COUNT,
    mcpServerNameMaxLength: CODEX_APP_SERVER_HELPER_MCP_SERVER_NAME_MAX_LENGTH,
    configResponseMaxBytes: CODEX_APP_SERVER_HELPER_CONFIG_RESPONSE_MAX_BYTES,
    hookMaxCount: CODEX_APP_SERVER_HELPER_HOOK_MAX_COUNT,
    hookErrorMaxCount: CODEX_APP_SERVER_HELPER_HOOK_ERROR_MAX_COUNT,
    hookFieldMaxLength: CODEX_APP_SERVER_HELPER_HOOK_FIELD_MAX_LENGTH,
    hookFingerprintMaxLength: CODEX_APP_SERVER_HELPER_HOOK_FINGERPRINT_MAX_LENGTH,
    hookResponseMaxBytes: CODEX_APP_SERVER_HELPER_HOOK_RESPONSE_MAX_BYTES
  },
  createError: codexAppServerHelperPolicyError
});
const assertCodexAppServerHelperCompatibility = codexAppServerHelperIsolation.assertCompatibility;

function normalizeWorkdir(value = "") {
  return normalizeAgentText(value);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function codexAppServerHelperPolicyError(message = "", details = {}) {
  return new Vibe64AgentExecutionProfileError(
    VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
    normalizeAgentText(message) || "Codex cannot prove the helper execution policy.",
    details
  );
}

function codexAppServerHelperProfile(executionProfile = null) {
  const profile = defineVibe64AgentExecutionProfileResolution(executionProfile);
  if (
    profile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER ||
    profile.providerId !== VIBE64_AGENT_PROVIDER_IDS.CODEX
  ) {
    throw codexAppServerHelperPolicyError(
      "Codex helper execution requires a server-resolved Codex helper profile.",
      {
        profileId: profile.profileId,
        providerId: profile.providerId
      }
    );
  }
  return profile;
}

function codexAppServerHelperOutputSchema(outputSchema, profile) {
  return validateConversationOutputSchema(outputSchema, {
    maxOutputCharacters: profile.limits.maxOutputCharacters,
    createError: codexAppServerHelperPolicyError
  });
}

function assertCodexAppServerHelperOutputWithinLimit({
  executionProfile = null,
  rawOutput = ""
} = {}) {
  const profile = codexAppServerHelperProfile(executionProfile);
  const output = String(rawOutput ?? "");
  if (output.length > profile.limits.maxOutputCharacters) {
    throw new Vibe64AgentExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "Codex helper output exceeds the resolved output limit.",
      {
        maxOutputCharacters: profile.limits.maxOutputCharacters,
        outputCharacters: output.length
      }
    );
  }
  return output;
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
    effectiveSettings, config, cwd: normalizedCwd, systemPrompt, hostContext, model,
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    reasoningSummary: CODEX_SESSION_REASONING_SUMMARY,
    sandbox: CODEX_SESSION_SANDBOX
  });
}

function codexAppServerThreadStartSettings(options = {}) {
  return codexAppServerHelperIsolation.threadStartSettings(codexAppServerThreadSettings(options), "vibe64");
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
    effectiveSettings, cwd: normalizedCwd, effort, model,
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    reasoningSummary: CODEX_SESSION_REASONING_SUMMARY,
    externalSandbox: true
  });
}

function codexAppServerHelperThreadSettings({
  config = null,
  cwd = "",
  systemPrompt = "",
  executionProfile = null
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw codexAppServerHelperPolicyError(
      "Codex helper thread requires a working directory."
    );
  }
  if (!isPlainRecord(config) || !codexAppServerHelperIsolation.hasConfiguration(config)) {
    throw codexAppServerHelperPolicyError(
      "Codex helper thread requires verified tool-isolation configuration."
    );
  }
  const profile = codexAppServerHelperProfile(executionProfile);
  const normalizedSystemPrompt = normalizeAgentText(systemPrompt);
  if (normalizedSystemPrompt.length > CODEX_APP_SERVER_HELPER_DEVELOPER_INSTRUCTIONS_MAX_LENGTH) {
    throw new Vibe64AgentExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "Codex helper developer instructions exceed their request limit.",
      {
        maxDeveloperInstructionCharacters: CODEX_APP_SERVER_HELPER_DEVELOPER_INSTRUCTIONS_MAX_LENGTH
      }
    );
  }
  return codexAppServerHelperIsolation.threadSettings({
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    baseInstructions: CODEX_APP_SERVER_HELPER_BASE_INSTRUCTIONS,
    config,
    cwd: normalizedCwd,
    effectiveSettings: profile,
    sandbox: CODEX_APP_SERVER_HELPER_SANDBOX,
    systemPrompt: normalizedSystemPrompt
  });
}

function codexAppServerHelperThreadStartSettings(options = {}) {
  return codexAppServerHelperIsolation.threadStartSettings(
    codexAppServerHelperThreadSettings(options),
    CODEX_APP_SERVER_HELPER_THREAD_SOURCE
  );
}

function codexAppServerHelperThreadResumeSettings(options = {}) {
  return codexAppServerHelperIsolation.threadResumeSettings(
    codexAppServerHelperThreadSettings(options)
  );
}

function codexAppServerHelperTurnSettings({
  cwd = "",
  executionProfile = null,
  outputSchema = null
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw codexAppServerHelperPolicyError(
      "Codex helper turn requires a working directory."
    );
  }
  const profile = codexAppServerHelperProfile(executionProfile);
  return codexAppServerHelperIsolation.turnSettings({
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    cwd: normalizedCwd,
    effectiveSettings: profile,
    outputSchema: codexAppServerHelperOutputSchema(outputSchema, profile)
  });
}

function codexAppServerHelperThreadStartPreparation({
  systemPrompt = "",
  ephemeral = false,
  executionProfile = null
} = {}) {
  const profile = codexAppServerHelperProfile(executionProfile);
  return {
    inspection: { effort: profile.thinking, summary: "none" },
    prepared(enforcement) {
      return Object.freeze({
        enforcement,
        executionProfile: profile,
        settings: { ...codexAppServerHelperThreadStartSettings({
          config: enforcement.config,
          cwd: enforcement.executionCwd,
          systemPrompt,
          executionProfile: profile
        }), ...(ephemeral ? { ephemeral: true } : {}) }
      });
    }
  };
}

async function prepareCodexAppServerHelperThreadStartSettings({
  systemPrompt = "",
  ephemeral = false,
  executionProfile = null,
  provider = null
} = {}) {
  const preparation = codexAppServerHelperThreadStartPreparation({ systemPrompt, ephemeral, executionProfile });
  const enforcement = await codexAppServerHelperIsolation.inspect(provider, preparation.inspection);
  return preparation.prepared(enforcement);
}

async function startCodexAppServerHelperThread(options = {}) {
  let executionProfile;
  const result = await codexAppServerHelperIsolation.start(options.provider, async () => {
    const prepared = await prepareCodexAppServerHelperThreadStartSettings(options);
    executionProfile = prepared.executionProfile;
    return prepared;
  });
  return Object.freeze({
    enforcement: result.enforcement,
    executionProfile,
    thread: result.thread,
    threadId: result.threadId
  });
}

function codexAppServerHelperThreadResumePreparation({
  systemPrompt = "",
  executionProfile = null
} = {}) {
  const profile = codexAppServerHelperProfile(executionProfile);
  return {
    inspection: { effort: profile.thinking, summary: "none" },
    prepared(enforcement) {
      return {
        enforcement,
        executionProfile: profile,
        settings: codexAppServerHelperThreadResumeSettings({
          config: enforcement.config,
          cwd: enforcement.executionCwd,
          systemPrompt,
          executionProfile: profile
        })
      };
    }
  };
}

async function prepareCodexAppServerHelperThreadResumeSettings({
  systemPrompt = "",
  executionProfile = null,
  provider = null
} = {}) {
  const preparation = codexAppServerHelperThreadResumePreparation({ systemPrompt, executionProfile });
  const enforcement = await codexAppServerHelperIsolation.inspect(provider, preparation.inspection);
  return preparation.prepared(enforcement);
}

async function resumeCodexAppServerHelperThread({
  systemPrompt = "",
  executionProfile = null,
  provider = null,
  threadId = ""
} = {}) {
  let profile;
  const result = await codexAppServerHelperIsolation.resume(provider, threadId, async () => {
    const prepared = await prepareCodexAppServerHelperThreadResumeSettings({ systemPrompt, executionProfile, provider });
    profile = prepared.executionProfile;
    return prepared;
  });
  return Object.freeze({
    enforcement: result.enforcement,
    executionProfile: profile,
    thread: result.thread,
    threadId: result.threadId
  });
}

function prepareCodexAppServerHelperTurn({
  executionProfile = null,
  outputSchema = null,
  prompt = "",
  provider = null,
  threadId = ""
} = {}) {
  if (typeof provider?.sendTurn !== "function") {
    throw codexAppServerHelperPolicyError(
      "Codex helper execution cannot send an app-server turn."
    );
  }
  const profile = codexAppServerHelperProfile(executionProfile);
  const input = String(prompt ?? "").trim();
  if (!input) {
    throw codexAppServerHelperPolicyError("Codex helper prompt is empty.");
  }
  if (input.length > profile.limits.maxInputCharacters) {
    throw new Vibe64AgentExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "Codex helper prompt exceeds the resolved input limit.",
      {
        inputCharacters: input.length,
        maxInputCharacters: profile.limits.maxInputCharacters
      }
    );
  }
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId) {
    throw codexAppServerHelperPolicyError(
      "Codex helper turn requires an app-server thread id."
    );
  }
  return {
    executionProfile: profile,
    input,
    threadId: normalizedThreadId,
    turnSettings(cwd) {
      return codexAppServerHelperTurnSettings({ cwd, executionProfile: profile, outputSchema });
    }
  };
}

async function sendCodexAppServerHelperTurn({
  executionProfile = null,
  outputSchema = null,
  prompt = "",
  provider = null,
  threadId = ""
} = {}) {
  const prepared = prepareCodexAppServerHelperTurn({ executionProfile, outputSchema, prompt, provider, threadId });
  return sendPreparedCodexAppServerHelperTurn(provider, prepared, codexAppServerHelperIsolation);
}

function codexAppServerRuntimeMetadata(runtime = {}) {
  return {
    endpoint: normalizeAgentText(runtime.endpoint),
    runtimeDir: normalizeAgentText(runtime.runtimeDir),
    socketPath: normalizeAgentText(runtime.socketPath),
    transport: normalizeAgentText(runtime.transport)
  };
}

function codexAppServerIdentityMetadata({
  modelProviderId = "openai",
  appServerRuntime = {},
  capturedAt = new Date().toISOString(),
  terminalSessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  const normalizedThreadId = normalizeAgentText(threadId);
  const normalizedWorkdir = normalizeWorkdir(workdir);
  if (!normalizedThreadId || !normalizedWorkdir) {
    throw new Error("Codex app-server identity requires a thread id and workdir.");
  }
  const runtimeMetadata = codexAppServerRuntimeMetadata(appServerRuntime);
  const hostCli = runtimeMetadata.endpoint
    ? codexCliResumeCommand({
        endpoint: runtimeMetadata.endpoint,
        threadId: normalizedThreadId
      }).command
    : "";
  const prefix = modelProviderId === "openai" ? "codex" : `codex_${modelProviderId}`;
  return {
    [`${prefix}_conversation_id`]: normalizedThreadId,
    [`${prefix}_conversation_workdir`]: normalizedWorkdir,
    agent_identity_model_provider: modelProviderId,
    agent_identity_captured_at: capturedAt,
    agent_identity_conversation_id: normalizedThreadId,
    agent_identity_error: "",
    agent_identity_provider: CODEX_SESSION_AGENT_PROVIDER,
    agent_identity_resume_strategy: "provider-native",
    agent_identity_status: "ready",
    agent_identity_terminal_session_id: normalizeAgentText(terminalSessionId),
    agent_identity_updated_at: capturedAt,
    agent_identity_workdir: normalizedWorkdir,
    agent_resume_command: hostCli,
    agent_transport_endpoint: runtimeMetadata.endpoint,
    agent_transport_execution_id: normalizeAgentText(appServerRuntime.executionId),
    agent_transport_id: CODEX_APP_SERVER_PROVIDER_ID,
    agent_transport_kind: runtimeMetadata.transport,
    agent_transport_runtime_dir: runtimeMetadata.runtimeDir,
    agent_transport_socket_path: runtimeMetadata.socketPath
  };
}

async function writeCodexAppServerIdentityMetadata({
  additionalMetadata = {},
  appServerRuntime = {},
  renewalInternal = false,
  runtime,
  sessionId = "",
  terminalSessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  const supplemental = additionalMetadata &&
    typeof additionalMetadata === "object" &&
    !Array.isArray(additionalMetadata)
    ? Object.fromEntries(Object.entries(additionalMetadata)
        .filter(([name]) => normalizeAgentText(name).startsWith("agent_renewal_"))
        .map(([name, value]) => [normalizeAgentText(name), normalizeAgentText(value)]))
    : {};
  const metadata = {
    ...supplemental,
    ...codexAppServerIdentityMetadata({
      modelProviderId: appServerRuntime.modelProviderId || "openai",
      appServerRuntime,
      terminalSessionId,
      threadId,
      workdir
    })
  };
  const mutateSession = renewalInternal
    ? runtime.store.mutateSessionForRenewal?.bind(runtime.store)
    : runtime.store.mutateSession?.bind(runtime.store);
  const writeMetadataValue = renewalInternal
    ? runtime.store.writeMetadataValueForRenewal?.bind(runtime.store)
    : runtime.store.writeMetadataValue?.bind(runtime.store);
  if (typeof mutateSession !== "function" || typeof writeMetadataValue !== "function") {
    throw new TypeError(renewalInternal
      ? "Renewed assistant identity requires explicit internal renewal metadata access."
      : "Assistant identity metadata access is unavailable.");
  }
  await mutateSession(sessionId, async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      writeMetadataValue(sessionId, name, String(value || ""))
    )));
  });
  return metadata;
}

function persistedCodexSessionRenewalThreadBaseline(session = {}, {
  operationId = "",
  workdir = ""
} = {}) {
  const metadata = isPlainRecord(session.metadata) ? session.metadata : {};
  const rawBaseline = normalizeAgentText(
    metadata[CODEX_SESSION_RENEWAL_BASELINE_METADATA]
  );
  if (!rawBaseline) {
    return null;
  }
  let baseline = null;
  try {
    baseline = JSON.parse(rawBaseline);
  } catch {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread baseline is unreadable."
    );
  }
  const persistedOperationId = normalizeAgentText(baseline?.operationId);
  const persistedWorkdir = normalizeWorkdir(baseline?.workdir);
  if (
    !isPlainRecord(baseline) ||
    normalizeAgentText(baseline.schemaVersion) !== CODEX_SESSION_RENEWAL_BASELINE_SCHEMA ||
    persistedOperationId !== normalizeAgentText(operationId) ||
    persistedWorkdir !== normalizeWorkdir(workdir) ||
    !Array.isArray(baseline.threadIds)
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread baseline does not belong to this exact renewal operation."
    );
  }
  return defineCodexRenewalThreadIds(baseline.threadIds, {
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
  });
}

function persistedCodexSessionRenewalThreadClaim(session = {}, {
  operationId = "",
  workdir = ""
} = {}) {
  const metadata = isPlainRecord(session.metadata) ? session.metadata : {};
  const rawClaim = normalizeAgentText(
    metadata[CODEX_SESSION_RENEWAL_THREAD_CLAIM_METADATA]
  );
  if (!rawClaim) {
    return null;
  }
  let claim = null;
  try {
    claim = JSON.parse(rawClaim);
  } catch {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread claim is unreadable."
    );
  }
  const claimedThreadIds = defineCodexRenewalThreadIds([claim?.threadId], {
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
  });
  const claimedOperationId = normalizeAgentText(claim?.operationId);
  const claimedWorkdir = normalizeWorkdir(claim?.workdir);
  if (
    !isPlainRecord(claim) ||
    normalizeAgentText(claim.schemaVersion) !== CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA ||
    claimedOperationId !== normalizeAgentText(operationId) ||
    claimedWorkdir !== normalizeWorkdir(workdir)
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread claim does not belong to this exact renewal operation."
    );
  }
  return Object.freeze({
    operationId: claimedOperationId,
    threadId: claimedThreadIds[0],
    workdir: claimedWorkdir
  });
}

async function writeCodexSessionRenewalThreadBaseline({
  operationId = "",
  runtime,
  sessionId = "",
  threadIds = [],
  workdir = ""
} = {}) {
  const writeMetadataValue = runtime?.store?.writeMetadataValueForRenewal?.bind(runtime.store);
  if (typeof writeMetadataValue !== "function") {
    throw new TypeError(
      "Renewed assistant thread baseline requires explicit internal renewal metadata access."
    );
  }
  const baseline = JSON.stringify({
    operationId: normalizeAgentText(operationId),
    schemaVersion: CODEX_SESSION_RENEWAL_BASELINE_SCHEMA,
    threadIds: defineCodexRenewalThreadIds(threadIds, {
      errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
    }),
    workdir: normalizeWorkdir(workdir)
  });
  await writeMetadataValue(
    sessionId,
    CODEX_SESSION_RENEWAL_BASELINE_METADATA,
    baseline
  );
  return baseline;
}

async function writeCodexSessionRenewalThreadClaim({
  operationId = "",
  runtime,
  sessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  const writeMetadataValue = runtime?.store?.writeMetadataValueForRenewal?.bind(runtime.store);
  if (typeof writeMetadataValue !== "function") {
    throw new TypeError(
      "Renewed assistant thread claim requires explicit internal renewal metadata access."
    );
  }
  const [normalizedThreadId] = defineCodexRenewalThreadIds([threadId], {
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE
  });
  const claim = JSON.stringify({
    operationId: normalizeAgentText(operationId),
    schemaVersion: CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA,
    threadId: normalizedThreadId,
    workdir: normalizeWorkdir(workdir)
  });
  await writeMetadataValue(
    sessionId,
    CODEX_SESSION_RENEWAL_THREAD_CLAIM_METADATA,
    claim
  );
  return claim;
}

function codexAppServerRenewalResumePreparation({
  agentSettings = {},
  hostContext = null,
  expectedThreadId = "",
  provider,
  session = {},
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeWorkdir(workdir);
  const persistedThreadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
  const normalizedExpectedThreadId = normalizeAgentText(expectedThreadId) || persistedThreadId;
  if (!normalizedExpectedThreadId || persistedThreadId !== normalizedExpectedThreadId) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
      "The old assistant thread is no longer the exact readable main thread for this session.",
      {
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId
      }
    );
  }
  return {
    expectedThreadId: normalizedExpectedThreadId,
    provider,
    workdir: normalizedWorkdir,
    errorCode: CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
    projectHooks: true,
    settings(cwd, config) {
      return {
        threadSettings: codexAppServerThreadSettings({ agentSettings, config, cwd, hostContext })
      };
    }
  };
}

async function resumeExactCodexAppServerThreadForSession(options = {}) {
  return resumeExactCodexAppServerThread(codexAppServerRenewalResumePreparation(options));
}

function codexAppServerRenewalSeedPreparation({
  additionalMetadata = {},
  agentSettings = {},
  hostContext = null,
  expectedThreadId = "",
  forbiddenThreadId = "",
  operationId = "",
  provider,
  readOnly = false,
  runtime,
  session = {},
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeWorkdir(workdir);
  const normalizedExpectedThreadId = normalizeAgentText(expectedThreadId);
  const normalizedForbiddenThreadId = normalizeAgentText(forbiddenThreadId);
  const normalizedOperationId = normalizeAgentText(operationId);
  const persistedThreadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
  const persistedOperationId = normalizeAgentText(
    session.metadata?.agent_renewal_seed_operation_id
  );
  const persistedClaim = persistedCodexSessionRenewalThreadClaim(session, {
    operationId: normalizedOperationId,
    workdir: normalizedWorkdir
  });
  const claimedThreadId = normalizeAgentText(persistedClaim?.threadId);
  if (
    persistedOperationId &&
    normalizedOperationId &&
    persistedOperationId !== normalizedOperationId
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session already belongs to a different renewal operation.",
      {
        operationId: normalizedOperationId,
        persistedOperationId
      }
    );
  }
  if (
    (persistedThreadId || persistedOperationId || normalizedExpectedThreadId) &&
    !claimedThreadId
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session has assistant identity metadata without its atomic renewal thread claim.",
      {
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId,
        persistedOperationId
      }
    );
  }
  if (
    claimedThreadId &&
    (
      (persistedThreadId && persistedThreadId !== claimedThreadId) ||
      (normalizedExpectedThreadId && normalizedExpectedThreadId !== claimedThreadId)
    )
  ) {
    throw codexRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session already owns a different assistant thread; Vibe64 will not reuse or replace it.",
      {
        claimedThreadId,
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId
      }
    );
  }
  return {
    provider,
    resumableThreadId: claimedThreadId,
    forbiddenThreadId: normalizedForbiddenThreadId,
    operationId: normalizedOperationId,
    workdir: normalizedWorkdir,
    errorCode: CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
    applicationName: "Vibe64",
    projectHooks: true,
    settings(cwd, config) {
      const ordinaryThreadSettings = codexAppServerThreadSettings({ agentSettings, config, cwd, hostContext });
      const ordinaryThreadStartSettings = codexAppServerThreadStartSettings({ agentSettings, config, cwd, hostContext });
      return {
        threadSettings: readOnly
          ? { ...ordinaryThreadSettings, sandbox: CODEX_SESSION_READ_ONLY_SANDBOX }
          : ordinaryThreadSettings,
        threadStartSettings: readOnly
          ? { ...ordinaryThreadStartSettings, sandbox: CODEX_SESSION_READ_ONLY_SANDBOX }
          : ordinaryThreadStartSettings
      };
    },
    identity: {
      readBaseline: () => persistedCodexSessionRenewalThreadBaseline(session, {
        operationId: normalizedOperationId,
        workdir: normalizedWorkdir
      }),
      writeBaseline: (threadIds) => writeCodexSessionRenewalThreadBaseline({
        operationId: normalizedOperationId,
        runtime,
        sessionId: session.sessionId,
        threadIds,
        workdir: normalizedWorkdir
      }),
      async write({ appServerRuntime, threadId, workdir }) {
        if (!persistedClaim) {
          await writeCodexSessionRenewalThreadClaim({
            operationId: normalizedOperationId,
            runtime,
            sessionId: session.sessionId,
            threadId,
            workdir
          });
        }
        await writeCodexAppServerIdentityMetadata({
          additionalMetadata: {
            ...additionalMetadata,
            ...(normalizedOperationId
              ? { agent_renewal_seed_operation_id: normalizedOperationId }
              : {}),
            agent_renewal_seed_thread_id: threadId
          },
          appServerRuntime,
          renewalInternal: true,
          runtime,
          sessionId: session.sessionId,
          threadId,
          workdir
        });
      }
    }
  };
}

async function startFreshCodexAppServerThreadForSession(options = {}) {
  return startFreshCodexAppServerThread(codexAppServerRenewalSeedPreparation(options));
}

function codexAppServerThreadIdForSession(session = {}, workdir = "") {
  const metadata = session.metadata || {};
  if (metadata.agent_identity_provider !== "codex") {
    return normalizeWorkdir(workdir) && normalizeWorkdir(metadata.codex_conversation_workdir) === normalizeWorkdir(workdir)
      ? normalizeAgentText(metadata.codex_conversation_id) : "";
  }
  if (metadata.agent_transport_id !== CODEX_APP_SERVER_PROVIDER_ID) {
    return "";
  }
  const recordedWorkdir = normalizeWorkdir(metadata.agent_identity_workdir);
  const expectedWorkdir = normalizeWorkdir(workdir);
  if (!recordedWorkdir || !expectedWorkdir || recordedWorkdir !== expectedWorkdir) {
    return "";
  }
  if (metadata.agent_identity_provider && metadata.agent_identity_provider !== CODEX_SESSION_AGENT_PROVIDER) {
    return "";
  }
  if (metadata.agent_identity_status && metadata.agent_identity_status !== "ready") {
    return "";
  }
  return normalizeAgentText(metadata.agent_identity_conversation_id);
}

function codexAppServerThreadPreparationForSession({
  agentSettings = {},
  hostContext = null,
  observeThread,
  provider,
  runtime,
  session = {},
  workdir = ""
} = {}) {
  return {
    observeThread,
    provider,
    workdir,
    projectHooks: true,
    settings(normalizedWorkdir, config) {
      const threadSettings = codexAppServerThreadSettings({
        agentSettings,
        config,
        cwd: normalizedWorkdir,
        hostContext
      });
      const threadStartSettings = codexAppServerThreadStartSettings({
        agentSettings,
        config,
        cwd: normalizedWorkdir,
        hostContext
      });
      return { threadSettings, threadStartSettings };
    },
    identity: {
      read: normalizedWorkdir => codexAppServerThreadIdForSession(session, normalizedWorkdir),
      get pauseGoal() { return session.metadata?.codex_changeover_pause_goal === "yes"; },
      clearPause() { return runtime.store.writeMetadataValue(session.sessionId, "codex_changeover_pause_goal", ""); },
      write({ appServerRuntime, threadId, workdir }) {
        return writeCodexAppServerIdentityMetadata({
          appServerRuntime, runtime, sessionId: session.sessionId, threadId, workdir
        });
      }
    },
    onStage(event) {
      vibe64SessionDebugLog("server.codexAppServerSessionBridge.thread.stage", {
        durationMs: event.durationMs,
        sessionId: session.sessionId,
        stage: event.stage
      });
    }
  };
}

async function ensureCodexAppServerThreadForSession(options = {}) {
  return ensureCodexAppServerThread(codexAppServerThreadPreparationForSession(options));
}

async function sendCodexAppServerPromptForSession({
  agentSettings = {},
  attachments = [],
  clientUserMessageId = "",
  outputSchema = null,
  provider,
  prompt = "",
  threadId = "",
  readOnly = false,
  workdir = ""
} = {}) {
  return sendCodexAppServerPrompt({
    attachments, clientUserMessageId, outputSchema, provider, prompt, threadId, readOnly
  }, {
    get turnSettings() { return codexAppServerTurnSettings({ agentSettings, cwd: workdir }); }
  });
}

export {
  CODEX_SESSION_AGENT_PROVIDER,
  CODEX_SESSION_APPROVAL_POLICY,
  CODEX_SESSION_MODEL,
  CODEX_SESSION_REASONING_EFFORT,
  CODEX_SESSION_REASONING_SUMMARY,
  CODEX_SESSION_SANDBOX,
  assertCodexAppServerHelperOutputWithinLimit,
  assertCodexAppServerHelperCompatibility,
  codexAppServerHelperThreadResumeSettings,
  codexAppServerHelperThreadSettings,
  codexAppServerHelperThreadStartSettings,
  codexAppServerHelperTurnSettings,
  codexAppServerIdentityMetadata,
  codexAppServerProjectHookTrustConfig,
  codexAppServerThreadIdForSession,
  codexAppServerThreadPreparationForSession,
  codexAppServerThreadStartSettings,
  codexAppServerThreadSettings,
  codexAppServerTurnSettings,
  codexAppServerHelperIsolation,
  ensureCodexAppServerThreadForSession,
  codexAppServerHelperThreadResumePreparation,
  codexAppServerHelperThreadStartPreparation,
  prepareCodexAppServerHelperThreadResumeSettings,
  prepareCodexAppServerHelperThreadStartSettings,
  prepareCodexAppServerHelperTurn,
  resumeCodexAppServerHelperThread,
  codexAppServerRenewalResumePreparation,
  codexAppServerRenewalSeedPreparation,
  resumeExactCodexAppServerThreadForSession,
  sendCodexAppServerHelperTurn,
  sendCodexAppServerPromptForSession,
  startCodexAppServerHelperThread,
  startFreshCodexAppServerThreadForSession,
  writeCodexAppServerIdentityMetadata
};
