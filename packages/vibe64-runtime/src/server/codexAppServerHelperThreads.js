import { CODEX_SESSION_APPROVAL_POLICY, codexAppServerThreadSettings, isPlainRecord, normalizeWorkdir } from "./codexAppServerSettings.js";
import { MINIMUM_CODEX_VERSION } from "./minimumCodexVersion.js";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileResolution
} from "../shared/agentExecutionProfiles.js";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "../shared/assistantSelection.js";
import { createCodexAppServerIsolation } from "@jskit-ai/assistant-core/server/codex-configuration";
import { sendPreparedCodexAppServerHelperTurn } from "@jskit-ai/assistant-core/server/codex-turn";
import { validateConversationOutputSchema } from "@jskit-ai/assistant-core/server/conversation";
import { toText } from "@local/vibe64-core/shared/toText";

// Codex helper threads: read-only threads a Vibe64 helper starts, resumes and
// sends one bounded turn to, with their isolation, settings and output limits.
// Session threads start through the same isolation.
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

function codexAppServerHelperPolicyError(message = "", details = {}) {
  return new Vibe64AgentExecutionProfileError(
    VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
    toText(message) || "Codex cannot prove the helper execution policy.",
    details
  );
}

function codexAppServerHelperProfile(executionProfile = null) {
  const profile = defineVibe64AgentExecutionProfileResolution(executionProfile);
  if (
    profile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER ||
    profile.providerId !== VIBE64_ASSISTANT_ENGINE_IDS.CODEX
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

function codexAppServerThreadStartSettings(options = {}) {
  return codexAppServerHelperIsolation.threadStartSettings(codexAppServerThreadSettings(options), "vibe64");
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
  const normalizedSystemPrompt = toText(systemPrompt);
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
        settings: {
          ...codexAppServerHelperThreadStartSettings({
            config: enforcement.config,
            cwd: enforcement.executionCwd,
            systemPrompt,
            executionProfile: profile
          }),
          ...(ephemeral ? { ephemeral: true } : {})
        }
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
  // readable-check: allow method-probe - optional operation: a provider without app-server turns refuses helper execution by policy
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
  const normalizedThreadId = toText(threadId);
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

export {
  assertCodexAppServerHelperCompatibility,
  assertCodexAppServerHelperOutputWithinLimit,
  CODEX_APP_SERVER_HELPER_BASE_INSTRUCTIONS,
  CODEX_APP_SERVER_HELPER_CONFIG_RESPONSE_MAX_BYTES,
  CODEX_APP_SERVER_HELPER_DEVELOPER_INSTRUCTIONS_MAX_LENGTH,
  CODEX_APP_SERVER_HELPER_HOOK_ERROR_MAX_COUNT,
  CODEX_APP_SERVER_HELPER_HOOK_FIELD_MAX_LENGTH,
  CODEX_APP_SERVER_HELPER_HOOK_FINGERPRINT_MAX_LENGTH,
  CODEX_APP_SERVER_HELPER_HOOK_MAX_COUNT,
  CODEX_APP_SERVER_HELPER_HOOK_RESPONSE_MAX_BYTES,
  CODEX_APP_SERVER_HELPER_MCP_SERVER_MAX_COUNT,
  CODEX_APP_SERVER_HELPER_MCP_SERVER_NAME_MAX_LENGTH,
  CODEX_APP_SERVER_HELPER_SANDBOX,
  CODEX_APP_SERVER_HELPER_THREAD_SOURCE,
  CODEX_APP_SERVER_HELPER_TOOL_FEATURES,
  CODEX_APP_SERVER_HELPER_USER_AGENT_MAX_LENGTH,
  codexAppServerHelperIsolation,
  codexAppServerHelperOutputSchema,
  codexAppServerHelperPolicyError,
  codexAppServerHelperProfile,
  codexAppServerHelperThreadResumePreparation,
  codexAppServerHelperThreadResumeSettings,
  codexAppServerHelperThreadSettings,
  codexAppServerHelperThreadStartPreparation,
  codexAppServerHelperThreadStartSettings,
  codexAppServerHelperTurnSettings,
  codexAppServerThreadStartSettings,
  prepareCodexAppServerHelperThreadResumeSettings,
  prepareCodexAppServerHelperThreadStartSettings,
  prepareCodexAppServerHelperTurn,
  resumeCodexAppServerHelperThread,
  sendCodexAppServerHelperTurn,
  startCodexAppServerHelperThread
};
