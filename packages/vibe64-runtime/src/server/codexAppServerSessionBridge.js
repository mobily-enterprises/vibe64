import path from "node:path";

import { MINIMUM_CODEX_VERSION } from "./minimumCodexVersion.js";
import {
  CODEX_APP_SERVER_PROVIDER_ID,
  codexAppServerRequestIsInvalid,
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
import {
  normalizeVibe64ConversationAttachments
} from "../shared/conversationAttachments.js";

const CODEX_SESSION_AGENT_PROVIDER = "codex";
const CODEX_SESSION_MODEL = VIBE64_CODEX_DEFAULT_MODEL;
const CODEX_SESSION_REASONING_EFFORT = VIBE64_CODEX_DEFAULT_THINKING;
const CODEX_SESSION_REASONING_SUMMARY = "concise";
const CODEX_SESSION_APPROVAL_POLICY = "never";
const CODEX_SESSION_SANDBOX = "danger-full-access";
const CODEX_SESSION_READ_ONLY_SANDBOX = "read-only";
const CODEX_APP_SERVER_CONTEXT_TURN_TIMEOUT_MS = 60000;
const CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE =
  "vibe64_session_renewal_thread_unreadable";
const CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE =
  "vibe64_session_renewal_fresh_thread_required";
const CODEX_SESSION_RENEWAL_UNMATERIALIZED_THREAD_SUFFIX =
  "is not materialized yet; includeTurns is unavailable before first user message";
const CODEX_SESSION_RENEWAL_BASELINE_MAX_THREADS = 1000;
const CODEX_SESSION_RENEWAL_THREAD_ID_MAX_LENGTH = 512;
const CODEX_SESSION_RENEWAL_BASELINE_METADATA =
  "agent_renewal_seed_thread_baseline";
const CODEX_SESSION_RENEWAL_BASELINE_SCHEMA =
  "vibe64.codex-renewal-thread-baseline.v1";
const CODEX_SESSION_RENEWAL_THREAD_CLAIM_METADATA =
  "agent_renewal_seed_thread_claim";
const CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA =
  "vibe64.codex-renewal-thread-claim.v1";
const CODEX_APP_SERVER_ECONOMY_SANDBOX = "read-only";
const CODEX_APP_SERVER_ECONOMY_USER_AGENT_MAX_LENGTH = 512;
const CODEX_APP_SERVER_ECONOMY_MCP_SERVER_MAX_COUNT = 128;
const CODEX_APP_SERVER_ECONOMY_MCP_SERVER_NAME_MAX_LENGTH = 256;
const CODEX_APP_SERVER_ECONOMY_CONFIG_RESPONSE_MAX_BYTES = 256 * 1024;
const CODEX_APP_SERVER_ECONOMY_HOOK_MAX_COUNT = 256;
const CODEX_APP_SERVER_ECONOMY_HOOK_ERROR_MAX_COUNT = 256;
const CODEX_APP_SERVER_ECONOMY_HOOK_FIELD_MAX_LENGTH = 2048;
const CODEX_APP_SERVER_ECONOMY_HOOK_FINGERPRINT_MAX_LENGTH = 256 * 1024;
const CODEX_APP_SERVER_ECONOMY_HOOK_RESPONSE_MAX_BYTES = 512 * 1024;
const CODEX_APP_SERVER_ECONOMY_DEVELOPER_INSTRUCTIONS_MAX_LENGTH = 8192;
const CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_BYTES = 64 * 1024;
const CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_DEPTH = 8;
const CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_PROPERTIES = 64;
const CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_ENUM_VALUES = 64;
const CODEX_APP_SERVER_ECONOMY_THREAD_SOURCE = "vibe64-economy";
const CODEX_APP_SERVER_ECONOMY_BASE_INSTRUCTIONS = [
  "Complete only the bounded structured task in the user input.",
  "Return one response matching the supplied JSON schema.",
  "Do not use tools, environments, network access, or repository writes."
].join(" ");
const CODEX_APP_SERVER_ECONOMY_TOOL_FEATURES = Object.freeze([
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
const codexAppServerEconomyIsolationConfigs = new WeakSet();
const CODEX_CONTEXT_RECOVERY_TEMPLATE = `VIBE64_CONTEXT_RECOVERY: Codex provider thread recovery for Vibe64.

Vibe64 tried to resume the previous Codex provider thread, but Codex app-server reported that it is not available anymore.

Previous provider thread:
{{previousThreadId}}

Fresh provider thread:
{{newThreadId}}

Resume error:
{{resumeError}}

Session:
{{sessionId}}

Workdir:
{{workdir}}

The provider-side transcript for the previous thread is missing. The persisted Vibe64 UI conversation below is the authoritative user-visible history for this session.

Use this conversation as context for future routed Vibe64 turns. If details are missing, work them out from the repository files, git state, and code changes in the session source. Do not assume the provider transcript is complete.

Do not inspect files, run commands, or modify files for this recovery briefing.

Reply exactly:
Vibe64 Codex context restored.

Persisted Vibe64 UI conversation:
{{conversationLog}}`;

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

function codexAppServerTextHasControlCharacters(value = "") {
  return Array.from(String(value)).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function deepFreezeCodexAppServerEconomyConfig(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreezeCodexAppServerEconomyConfig(nested);
  }
  return Object.freeze(value);
}

function codexAppServerEconomyPolicyError(message = "", details = {}) {
  return new Vibe64AgentExecutionProfileError(
    VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
    normalizeAgentText(message) || "Codex cannot prove the economy execution policy.",
    details
  );
}

function assertCodexAppServerEconomyResponseBounded(value, maxBytes, label) {
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw codexAppServerEconomyPolicyError(
      `Codex economy execution received an invalid ${label}.`
    );
  }
  if (bytes > maxBytes) {
    throw codexAppServerEconomyPolicyError(
      `Codex economy execution received an oversized ${label}.`
    );
  }
}

function codexAppServerEconomyProfile(executionProfile = null) {
  const profile = defineVibe64AgentExecutionProfileResolution(executionProfile);
  if (
    profile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY ||
    profile.providerId !== VIBE64_AGENT_PROVIDER_IDS.CODEX
  ) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution requires a server-resolved Codex economy profile.",
      {
        profileId: profile.profileId,
        providerId: profile.providerId
      }
    );
  }
  return profile;
}

function assertCodexAppServerOutputSchemaKeys(schema = {}, allowed = [], schemaPath = "$") {
  const allowedKeys = new Set(["description", "title", "type", ...allowed]);
  if (Object.keys(schema).some((key) => !allowedKeys.has(key))) {
    throw codexAppServerEconomyPolicyError(
      `Economy output schema ${schemaPath} contains an unsupported keyword.`,
      { field: "outputSchema" }
    );
  }
}

function strictOutputSchemaMaximumCharacters(schema = null, schemaPath = "$", depth = 0) {
  if (!isPlainRecord(schema)) {
    throw codexAppServerEconomyPolicyError(
      `Economy output schema ${schemaPath} must be an object.`,
      { field: "outputSchema" }
    );
  }
  if (depth > CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_DEPTH) {
    throw codexAppServerEconomyPolicyError(
      "Economy output schema is nested too deeply.",
      { field: "outputSchema" }
    );
  }
  if (typeof schema.type !== "string") {
    throw codexAppServerEconomyPolicyError(
      `Economy output schema ${schemaPath} must declare one type.`,
      { field: "outputSchema" }
    );
  }
  if (schema.type === "object") {
    assertCodexAppServerOutputSchemaKeys(
      schema,
      ["additionalProperties", "properties", "required"],
      schemaPath
    );
    if (schema.additionalProperties !== false || !isPlainRecord(schema.properties)) {
      throw codexAppServerEconomyPolicyError(
        `Economy object schema ${schemaPath} must declare properties and reject additional properties.`,
        { field: "outputSchema" }
      );
    }
    const propertyNames = Object.keys(schema.properties);
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (
      propertyNames.length === 0 ||
      propertyNames.length > CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_PROPERTIES ||
      propertyNames.some((name) => !name || name.length > 128) ||
      required.length !== propertyNames.length ||
      new Set(required).size !== required.length ||
      propertyNames.some((name) => !required.includes(name))
    ) {
      throw codexAppServerEconomyPolicyError(
        `Economy object schema ${schemaPath} must require every declared property.`,
        { field: "outputSchema" }
      );
    }
    return propertyNames.reduce((total, name, index) => (
      total +
      (index === 0 ? 0 : 1) +
      JSON.stringify(name).length +
      1 +
      strictOutputSchemaMaximumCharacters(schema.properties[name], `${schemaPath}.${name}`, depth + 1)
    ), 2);
  }
  if (schema.type === "array") {
    assertCodexAppServerOutputSchemaKeys(schema, ["items", "maxItems", "minItems"], schemaPath);
    if (!Number.isSafeInteger(schema.maxItems) || schema.maxItems < 0) {
      throw codexAppServerEconomyPolicyError(
        `Economy array schema ${schemaPath} must have a finite maxItems value.`,
        { field: "outputSchema" }
      );
    }
    if (
      schema.minItems !== undefined &&
      (!Number.isSafeInteger(schema.minItems) || schema.minItems < 0 || schema.minItems > schema.maxItems)
    ) {
      throw codexAppServerEconomyPolicyError(
        `Economy array schema ${schemaPath} has an invalid minItems value.`,
        { field: "outputSchema" }
      );
    }
    const itemMaximum = strictOutputSchemaMaximumCharacters(schema.items, `${schemaPath}[]`, depth + 1);
    const maximum = 2 + (schema.maxItems * itemMaximum) + Math.max(0, schema.maxItems - 1);
    if (!Number.isSafeInteger(maximum)) {
      throw codexAppServerEconomyPolicyError(
        "Economy output schema exceeds its finite bound.",
        { field: "outputSchema" }
      );
    }
    return maximum;
  }
  if (schema.type === "string") {
    assertCodexAppServerOutputSchemaKeys(schema, ["enum", "maxLength", "minLength"], schemaPath);
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      if (
        schema.enum.length > CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_ENUM_VALUES ||
        schema.enum.some((value) => typeof value !== "string")
      ) {
        throw codexAppServerEconomyPolicyError(
          `Economy string schema ${schemaPath} has an invalid enum.`,
          { field: "outputSchema" }
        );
      }
      return Math.max(...schema.enum.map((value) => JSON.stringify(value).length));
    }
    if (!Number.isSafeInteger(schema.maxLength) || schema.maxLength <= 0) {
      throw codexAppServerEconomyPolicyError(
        `Economy string schema ${schemaPath} must have a finite positive maxLength.`,
        { field: "outputSchema" }
      );
    }
    if (
      schema.minLength !== undefined &&
      (!Number.isSafeInteger(schema.minLength) || schema.minLength < 0 || schema.minLength > schema.maxLength)
    ) {
      throw codexAppServerEconomyPolicyError(
        `Economy string schema ${schemaPath} has an invalid minLength value.`,
        { field: "outputSchema" }
      );
    }
    // JSON may encode each UTF-16 code unit as a six-character `\uXXXX` escape.
    // Count that worst case so the schema can never admit raw JSON beyond the
    // resolved response limit even when every string character needs escaping.
    const maximum = (schema.maxLength * 6) + 2;
    if (!Number.isSafeInteger(maximum)) {
      throw codexAppServerEconomyPolicyError(
        "Economy output schema exceeds its finite bound.",
        { field: "outputSchema" }
      );
    }
    return maximum;
  }
  if (schema.type === "boolean" || schema.type === "null") {
    assertCodexAppServerOutputSchemaKeys(schema, [], schemaPath);
    return 5;
  }
  throw codexAppServerEconomyPolicyError(
    `Economy output schema ${schemaPath} uses an unsupported type.`,
    { field: "outputSchema" }
  );
}

function codexAppServerEconomyOutputSchema(outputSchema, profile) {
  let schemaBytes = 0;
  try {
    schemaBytes = Buffer.byteLength(JSON.stringify(outputSchema), "utf8");
  } catch {
    throw codexAppServerEconomyPolicyError(
      "Economy output schema is not serializable.",
      { field: "outputSchema" }
    );
  }
  if (schemaBytes > CODEX_APP_SERVER_ECONOMY_OUTPUT_SCHEMA_MAX_BYTES) {
    throw codexAppServerEconomyPolicyError(
      "Economy output schema exceeds its request limit.",
      { field: "outputSchema" }
    );
  }
  const maximumCharacters = strictOutputSchemaMaximumCharacters(outputSchema);
  if (maximumCharacters > profile.limits.maxOutputCharacters) {
    throw codexAppServerEconomyPolicyError(
      "Economy output schema can exceed the resolved output limit.",
      {
        maximumCharacters,
        maxOutputCharacters: profile.limits.maxOutputCharacters
      }
    );
  }
  return outputSchema;
}

function assertCodexAppServerEconomyOutputWithinLimit({
  executionProfile = null,
  rawOutput = ""
} = {}) {
  const profile = codexAppServerEconomyProfile(executionProfile);
  const output = String(rawOutput ?? "");
  if (output.length > profile.limits.maxOutputCharacters) {
    throw new Vibe64AgentExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "Codex economy output exceeds the resolved output limit.",
      {
        maxOutputCharacters: profile.limits.maxOutputCharacters,
        outputCharacters: output.length
      }
    );
  }
  return output;
}

function codexAppServerEconomyConnectionGeneration(provider) {
  if (typeof provider?.currentConnectionGeneration !== "function") {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution cannot verify the app-server connection generation."
    );
  }
  const generation = provider.currentConnectionGeneration();
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution found no active app-server connection."
    );
  }
  return generation;
}

async function codexAppServerEconomyExecutionContext(provider) {
  if (typeof provider?.currentEconomyExecutionContext !== "function") {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution requires its dedicated isolated provider."
    );
  }
  const context = await provider.currentEconomyExecutionContext();
  const cwd = normalizeWorkdir(context?.cwd);
  const accountIdentitySignature = normalizeAgentText(context?.accountIdentitySignature);
  if (
    context?.executionMode !== "economy" ||
    !cwd ||
    !path.isAbsolute(cwd) ||
    !/^sha256:[a-f0-9]{64}$/u.test(accountIdentitySignature)
  ) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy runtime isolation could not be verified."
    );
  }
  return Object.freeze({
    accountIdentitySignature,
    cwd,
    executionMode: "economy"
  });
}

function codexAppServerSemanticVersionParts(value = "") {
  const match = normalizeAgentText(value).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  if (!match) {
    return null;
  }
  const parts = match.slice(1).map((part) => Number.parseInt(part, 10));
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function codexAppServerUserAgentVersionParts(value = "") {
  const userAgent = normalizeAgentText(value);
  if (
    !userAgent ||
    userAgent.length > CODEX_APP_SERVER_ECONOMY_USER_AGENT_MAX_LENGTH ||
    codexAppServerTextHasControlCharacters(userAgent)
  ) {
    return null;
  }
  const match = userAgent.match(/^vibe64\/((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:$|[ \t].*$)/u);
  return match ? codexAppServerSemanticVersionParts(match[1]) : null;
}

function assertCodexAppServerEconomyCompatibility(provider) {
  if (typeof provider?.currentServerInfo !== "function") {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution cannot verify the app-server version. Update Codex and retry.",
      { minimumVersion: MINIMUM_CODEX_VERSION }
    );
  }
  const userAgent = normalizeAgentText(provider.currentServerInfo()?.userAgent);
  const actualParts = codexAppServerUserAgentVersionParts(userAgent);
  if (!actualParts) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution received an unrecognised app-server version. Update Codex and retry.",
      {
        minimumVersion: MINIMUM_CODEX_VERSION
      }
    );
  }
  const actualVersion = actualParts.join(".");
  const minimumParts = codexAppServerSemanticVersionParts(MINIMUM_CODEX_VERSION);
  const differingPart = actualParts.findIndex((part, index) => part !== minimumParts[index]);
  if (differingPart !== -1 && actualParts[differingPart] < minimumParts[differingPart]) {
    throw codexAppServerEconomyPolicyError(
      `Codex economy execution requires app-server ${MINIMUM_CODEX_VERSION} or newer; current version is ${actualVersion}. Update Codex and retry.`,
      {
        actualVersion,
        minimumVersion: MINIMUM_CODEX_VERSION
      }
    );
  }
  return Object.freeze({
    minimumVersion: MINIMUM_CODEX_VERSION,
    version: actualVersion
  });
}

function codexAppServerEconomyMcpServerNames(configResult = null) {
  assertCodexAppServerEconomyResponseBounded(
    configResult,
    CODEX_APP_SERVER_ECONOMY_CONFIG_RESPONSE_MAX_BYTES,
    "configuration response"
  );
  if (!isPlainRecord(configResult?.config)) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution could not read the effective app-server configuration."
    );
  }
  const servers = configResult.config.mcp_servers;
  if (servers === undefined || servers === null) {
    return [];
  }
  if (!isPlainRecord(servers)) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution received an invalid MCP server configuration."
    );
  }
  const names = Object.keys(servers);
  if (
    names.length > CODEX_APP_SERVER_ECONOMY_MCP_SERVER_MAX_COUNT ||
    names.some((name) => (
      !name ||
      name.length > CODEX_APP_SERVER_ECONOMY_MCP_SERVER_NAME_MAX_LENGTH ||
      codexAppServerTextHasControlCharacters(name)
    ))
  ) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution received an oversized or invalid MCP server inventory."
    );
  }
  return names.sort();
}

function codexAppServerEconomyHookState(result = null, cwd = "") {
  assertCodexAppServerEconomyResponseBounded(
    result,
    CODEX_APP_SERVER_ECONOMY_HOOK_RESPONSE_MAX_BYTES,
    "hook inventory"
  );
  if (!Array.isArray(result?.data)) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution could not enumerate app-server hooks."
    );
  }
  if (result.data.length !== 1) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution received an unexpected hook inventory."
    );
  }
  const record = result.data[0];
  if (
    normalizeWorkdir(record?.cwd) !== cwd ||
    normalizeWorkdir(record?.cwd).length > CODEX_APP_SERVER_ECONOMY_HOOK_FIELD_MAX_LENGTH ||
    !Array.isArray(record.hooks) ||
    !Array.isArray(record.errors) ||
    record.hooks.length > CODEX_APP_SERVER_ECONOMY_HOOK_MAX_COUNT ||
    record.errors.length > CODEX_APP_SERVER_ECONOMY_HOOK_ERROR_MAX_COUNT
  ) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution received an incomplete hook inventory."
    );
  }
  if (record.errors.length > 0) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution cannot continue while hook discovery has errors.",
      { hookErrorCount: record.errors.length }
    );
  }
  const hooks = record.hooks.map((hook) => {
    const key = normalizeAgentText(hook?.key);
    const currentHash = normalizeAgentText(hook?.currentHash);
    const handlerType = normalizeAgentText(hook?.handlerType);
    const sourcePath = normalizeAgentText(hook?.sourcePath);
    if (
      !key ||
      [key, currentHash, handlerType, sourcePath].some((field) => (
        field.length > CODEX_APP_SERVER_ECONOMY_HOOK_FIELD_MAX_LENGTH ||
        codexAppServerTextHasControlCharacters(field)
      ))
    ) {
      throw codexAppServerEconomyPolicyError(
        "Codex economy execution found an invalid hook inventory entry."
      );
    }
    if (hook?.isManaged === true && hook?.enabled === true) {
      throw codexAppServerEconomyPolicyError(
        "Codex economy execution cannot disable a managed hook."
      );
    }
    return {
      currentHash,
      enabled: hook?.enabled === true,
      handlerType,
      isManaged: hook?.isManaged === true,
      key,
      sourcePath
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
  const fingerprint = JSON.stringify(hooks);
  if (fingerprint.length > CODEX_APP_SERVER_ECONOMY_HOOK_FINGERPRINT_MAX_LENGTH) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution received an oversized hook inventory."
    );
  }
  return {
    fingerprint,
    hookKeys: hooks.filter((hook) => !hook.isManaged).map((hook) => hook.key)
  };
}

function codexAppServerEconomyIsolationConfig({
  executionProfile = null,
  hookKeys = [],
  mcpServerNames = []
} = {}) {
  const profile = codexAppServerEconomyProfile(executionProfile);
  const config = {
    features: Object.fromEntries(
      CODEX_APP_SERVER_ECONOMY_TOOL_FEATURES.map((feature) => [feature, false])
    ),
    hooks: {
      state: Object.fromEntries(hookKeys.map((key) => [key, { enabled: false }]))
    },
    include_apps_instructions: false,
    include_collaboration_mode_instructions: false,
    include_environment_context: false,
    include_permissions_instructions: false,
    model_reasoning_effort: profile.thinking,
    model_reasoning_summary: "none",
    mcp_servers: Object.fromEntries(
      mcpServerNames.map((name) => [name, { enabled: false }])
    ),
    memories: {
      dedicated_tools: false,
      generate_memories: false,
      use_memories: false
    },
    notify: [],
    orchestrator: {
      mcp: {
        enabled: false
      },
      skills: {
        enabled: false
      }
    },
    project_doc_max_bytes: 0,
    shell_environment_policy: {
      inherit: "none",
      set: {}
    },
    skills: {
      include_instructions: false
    },
    tools: {
      experimental_request_user_input: {
        enabled: false
      },
      update_plan: {
        enabled: false
      }
    },
    web_search: "disabled"
  };
  const frozenConfig = deepFreezeCodexAppServerEconomyConfig(config);
  codexAppServerEconomyIsolationConfigs.add(frozenConfig);
  return frozenConfig;
}

async function codexAppServerEconomyIsolationState(provider, executionProfile = null) {
  assertCodexAppServerEconomyCompatibility(provider);
  if (
    typeof provider?.readConfig !== "function" ||
    typeof provider?.listHooks !== "function"
  ) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution cannot inventory configuration and hooks."
    );
  }
  const executionContext = await codexAppServerEconomyExecutionContext(provider);
  const generation = codexAppServerEconomyConnectionGeneration(provider);
  const configResult = await provider.readConfig({
    cwd: executionContext.cwd,
    includeLayers: false
  });
  if (codexAppServerEconomyConnectionGeneration(provider) !== generation) {
    throw codexAppServerEconomyPolicyError(
      "Codex app-server reconnected during economy policy verification."
    );
  }
  const hookResult = await provider.listHooks([executionContext.cwd]);
  if (codexAppServerEconomyConnectionGeneration(provider) !== generation) {
    throw codexAppServerEconomyPolicyError(
      "Codex app-server reconnected during economy policy verification."
    );
  }
  const mcpServerNames = codexAppServerEconomyMcpServerNames(configResult);
  const hookState = codexAppServerEconomyHookState(hookResult, executionContext.cwd);
  return Object.freeze({
    accountIdentitySignature: executionContext.accountIdentitySignature,
    config: codexAppServerEconomyIsolationConfig({
      executionProfile,
      hookKeys: hookState.hookKeys,
      mcpServerNames
    }),
    connectionGeneration: generation,
    executionCwd: executionContext.cwd,
    hookFingerprint: hookState.fingerprint,
    hookKeys: Object.freeze([...hookState.hookKeys]),
    mcpServerNames: Object.freeze([...mcpServerNames])
  });
}

function codexEffectiveAgentExecutionSettings(agentSettings = {}) {
  return effectiveVibe64AgentExecutionSettings(agentSettings);
}

function codexAppServerThreadSettings({
  agentSettings = {},
  config = null,
  cwd = "",
  developerInstructions = "",
  model = ""
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw new Error("Codex app-server thread requires a working directory.");
  }
  const effectiveSettings = codexEffectiveAgentExecutionSettings(agentSettings);
  return {
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    config: {
      ...(effectiveSettings.request.reasoning !== false
        ? { model_reasoning_effort: effectiveSettings.thinking }
        : {}),
      ...(effectiveSettings.request.summary !== false
        ? { model_reasoning_summary: CODEX_SESSION_REASONING_SUMMARY }
        : {}),
      ...(config && typeof config === "object" && !Array.isArray(config) ? config : {})
    },
    cwd: normalizedCwd,
    developerInstructions: normalizeAgentText(developerInstructions) || null,
    model: normalizeAgentText(model) || effectiveSettings.model,
    sandbox: CODEX_SESSION_SANDBOX
  };
}

function codexAppServerThreadStartSettings(options = {}) {
  return {
    ...codexAppServerThreadSettings(options),
    sessionStartSource: "startup",
    threadSource: "vibe64"
  };
}

async function codexAppServerProjectHookTrustConfig(provider, cwd = "", {
  persist = false
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd || typeof provider?.listHooks !== "function") {
    return null;
  }
  const result = await provider.listHooks([normalizedCwd]);
  const record = (Array.isArray(result?.data) ? result.data : [])
    .find((item) => normalizeWorkdir(item?.cwd) === normalizedCwd);
  const trustedHooks = (Array.isArray(record?.hooks) ? record.hooks : [])
    .filter((hook) => hook?.enabled === true && hook?.source === "project")
    .map((hook) => ({
      currentHash: normalizeAgentText(hook?.currentHash),
      key: normalizeAgentText(hook?.key),
      trustStatus: normalizeAgentText(hook?.trustStatus)
    }))
    .filter(({ currentHash, key }) => key && currentHash);
  if (trustedHooks.length === 0) {
    return null;
  }
  const state = Object.fromEntries(trustedHooks.map(({ currentHash, key }) => [
    key,
    {
      trusted_hash: currentHash
    }
  ]));
  if (
    persist &&
    trustedHooks.some(({ trustStatus }) => !["managed", "trusted"].includes(trustStatus)) &&
    typeof provider?.writeHookTrustState === "function"
  ) {
    await provider.writeHookTrustState(state);
  }
  return {
    hooks: {
      state
    }
  };
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
  const settings = {
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    cwd: normalizedCwd,
    model: normalizeAgentText(model) || effectiveSettings.model,
    sandboxPolicy: {
      networkAccess: "enabled",
      type: "externalSandbox"
    }
  };
  if (effectiveSettings.request.reasoning !== false) {
    settings.effort = normalizeAgentText(effort) || effectiveSettings.thinking;
  }
  if (effectiveSettings.request.summary !== false) {
    settings.summary = CODEX_SESSION_REASONING_SUMMARY;
  }
  return settings;
}

function codexAppServerEconomyThreadSettings({
  config = null,
  cwd = "",
  developerInstructions = "",
  executionProfile = null
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy thread requires a working directory."
    );
  }
  if (!isPlainRecord(config) || !codexAppServerEconomyIsolationConfigs.has(config)) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy thread requires verified tool-isolation configuration."
    );
  }
  const profile = codexAppServerEconomyProfile(executionProfile);
  const normalizedDeveloperInstructions = normalizeAgentText(developerInstructions);
  if (normalizedDeveloperInstructions.length > CODEX_APP_SERVER_ECONOMY_DEVELOPER_INSTRUCTIONS_MAX_LENGTH) {
    throw new Vibe64AgentExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "Codex economy developer instructions exceed their request limit.",
      {
        maxDeveloperInstructionCharacters: CODEX_APP_SERVER_ECONOMY_DEVELOPER_INSTRUCTIONS_MAX_LENGTH
      }
    );
  }
  return {
    allowProviderModelFallback: false,
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    baseInstructions: CODEX_APP_SERVER_ECONOMY_BASE_INSTRUCTIONS,
    config,
    cwd: normalizedCwd,
    developerInstructions: normalizedDeveloperInstructions || null,
    dynamicTools: [],
    environments: [],
    model: profile.model,
    runtimeWorkspaceRoots: [],
    sandbox: CODEX_APP_SERVER_ECONOMY_SANDBOX,
    selectedCapabilityRoots: []
  };
}

function codexAppServerEconomyThreadStartSettings(options = {}) {
  return {
    ...codexAppServerEconomyThreadSettings(options),
    sessionStartSource: "startup",
    threadSource: CODEX_APP_SERVER_ECONOMY_THREAD_SOURCE
  };
}

function codexAppServerEconomyThreadResumeSettings(options = {}) {
  const settings = codexAppServerEconomyThreadSettings(options);
  return {
    approvalPolicy: settings.approvalPolicy,
    baseInstructions: settings.baseInstructions,
    config: settings.config,
    cwd: settings.cwd,
    developerInstructions: settings.developerInstructions,
    model: settings.model,
    runtimeWorkspaceRoots: settings.runtimeWorkspaceRoots,
    sandbox: settings.sandbox
  };
}

function codexAppServerEconomyTurnSettings({
  cwd = "",
  executionProfile = null,
  outputSchema = null
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy turn requires a working directory."
    );
  }
  const profile = codexAppServerEconomyProfile(executionProfile);
  const settings = {
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    cwd: normalizedCwd,
    environments: [],
    model: profile.model,
    outputSchema: codexAppServerEconomyOutputSchema(outputSchema, profile),
    runtimeWorkspaceRoots: [],
    sandboxPolicy: {
      networkAccess: false,
      type: "readOnly"
    },
    summary: "none"
  };
  if (profile.request.reasoning) {
    settings.effort = profile.thinking;
  }
  return settings;
}

async function prepareCodexAppServerEconomyThreadStartSettings({
  developerInstructions = "",
  executionProfile = null,
  provider = null
} = {}) {
  const profile = codexAppServerEconomyProfile(executionProfile);
  const enforcement = await codexAppServerEconomyIsolationState(
    provider,
    profile
  );
  return Object.freeze({
    enforcement,
    executionProfile: profile,
    settings: codexAppServerEconomyThreadStartSettings({
      config: enforcement.config,
      cwd: enforcement.executionCwd,
      developerInstructions,
      executionProfile: profile
    })
  });
}

function codexAppServerEconomyIsolationMatches(left = null, right = null) {
  return left?.accountIdentitySignature === right?.accountIdentitySignature &&
    left?.connectionGeneration === right?.connectionGeneration &&
    left?.executionCwd === right?.executionCwd &&
    left?.hookFingerprint === right?.hookFingerprint &&
    JSON.stringify(left?.mcpServerNames || []) === JSON.stringify(right?.mcpServerNames || []);
}

function codexAppServerEconomyVerificationFailure(error, cleanupError, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!cleanupError) {
    error.codexAppServerEconomyThreadId = normalizedThreadId;
    error.codexAppServerEconomyThreadRetired = true;
    return error;
  }
  const failure = codexAppServerEconomyPolicyError(
    "Codex could not retire an economy thread after policy verification failed.",
    {
      cleanupFailed: true,
      threadId: normalizedThreadId
    }
  );
  failure.codexAppServerEconomyThreadCleanupRequired = true;
  failure.codexAppServerEconomyThreadId = normalizedThreadId;
  return failure;
}

async function throwAfterCodexAppServerEconomyVerificationFailure({
  error = null,
  provider = null,
  threadId = ""
} = {}) {
  let cleanupError = null;
  try {
    await provider.deleteThread(threadId);
  } catch (caught) {
    cleanupError = caught;
  }
  throw codexAppServerEconomyVerificationFailure(error, cleanupError, threadId);
}

async function startCodexAppServerEconomyThread(options = {}) {
  const provider = options.provider;
  if (
    typeof provider?.startThread !== "function" ||
    typeof provider?.deleteThread !== "function"
  ) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution cannot own and clean up its app-server thread."
    );
  }
  const prepared = await prepareCodexAppServerEconomyThreadStartSettings(options);
  const thread = await provider.startThread(prepared.settings);
  const threadId = normalizeAgentText(thread?.id);
  if (!threadId) {
    throw codexAppServerEconomyPolicyError(
      "Codex app-server did not return an economy thread id."
    );
  }
  try {
    const verified = await codexAppServerEconomyIsolationState(
      provider,
      prepared.executionProfile
    );
    if (!codexAppServerEconomyIsolationMatches(prepared.enforcement, verified)) {
      throw codexAppServerEconomyPolicyError(
        "Codex execution surfaces changed while the economy thread was starting."
      );
    }
    return Object.freeze({
      enforcement: verified,
      executionProfile: prepared.executionProfile,
      thread,
      threadId
    });
  } catch (error) {
    await throwAfterCodexAppServerEconomyVerificationFailure({
      error,
      provider,
      threadId
    });
  }
}

async function resumeCodexAppServerEconomyThread({
  developerInstructions = "",
  executionProfile = null,
  provider = null,
  threadId = ""
} = {}) {
  if (
    typeof provider?.resumeThread !== "function" ||
    typeof provider?.deleteThread !== "function"
  ) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution cannot safely resume and clean up its app-server thread."
    );
  }
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy resume requires a controller-owned thread id."
    );
  }
  const profile = codexAppServerEconomyProfile(executionProfile);
  const enforcement = await codexAppServerEconomyIsolationState(
    provider,
    profile
  );
  const thread = await provider.resumeThread(
    normalizedThreadId,
    codexAppServerEconomyThreadResumeSettings({
      config: enforcement.config,
      cwd: enforcement.executionCwd,
      developerInstructions,
      executionProfile: profile
    })
  );
  try {
    const verified = await codexAppServerEconomyIsolationState(
      provider,
      profile
    );
    if (!codexAppServerEconomyIsolationMatches(enforcement, verified)) {
      throw codexAppServerEconomyPolicyError(
        "Codex execution surfaces changed while the economy thread was resuming."
      );
    }
    return Object.freeze({
      enforcement: verified,
      executionProfile: profile,
      thread,
      threadId: normalizedThreadId
    });
  } catch (error) {
    await throwAfterCodexAppServerEconomyVerificationFailure({
      error,
      provider,
      threadId: normalizedThreadId
    });
  }
}

async function sendCodexAppServerEconomyTurn({
  executionProfile = null,
  outputSchema = null,
  prompt = "",
  provider = null,
  threadId = ""
} = {}) {
  if (typeof provider?.sendTurn !== "function") {
    throw codexAppServerEconomyPolicyError(
      "Codex economy execution cannot send an app-server turn."
    );
  }
  const profile = codexAppServerEconomyProfile(executionProfile);
  const input = String(prompt ?? "").trim();
  if (!input) {
    throw codexAppServerEconomyPolicyError("Codex economy prompt is empty.");
  }
  if (input.length > profile.limits.maxInputCharacters) {
    throw new Vibe64AgentExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "Codex economy prompt exceeds the resolved input limit.",
      {
        inputCharacters: input.length,
        maxInputCharacters: profile.limits.maxInputCharacters
      }
    );
  }
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId) {
    throw codexAppServerEconomyPolicyError(
      "Codex economy turn requires an app-server thread id."
    );
  }
  const turn = await provider.sendTurn(
    normalizedThreadId,
    input,
    codexAppServerEconomyTurnSettings({
      cwd: (await codexAppServerEconomyExecutionContext(provider)).cwd,
      executionProfile: profile,
      outputSchema
    })
  );
  return Object.freeze({
    executionProfile: profile,
    input,
    turn
  });
}

function renderCodexContextRecoveryTemplate(template = "", values = {}) {
  return String(template || "").replace(/\{\{([A-Za-z0-9_.-]+)\}\}/gu, (_match, key) => {
    return Object.hasOwn(values, key) ? String(values[key] ?? "") : "";
  });
}

function conversationMessageLines(label = "", message = null) {
  const text = normalizeAgentText(message?.text);
  if (!text) {
    return [];
  }
  const at = normalizeAgentText(message?.at);
  const attachments = normalizeVibe64ConversationAttachments(message?.attachments);
  return [
    `### ${label}${at ? ` (${at})` : ""}`,
    text,
    ...(attachments.length
      ? [[
          "Attached files:",
          ...attachments.map(({ fileName }) => `- ${fileName}`)
        ].join("\n")]
      : [])
  ];
}

function conversationActivityMessages(turn = {}) {
  const persistedOrder = Array.isArray(turn.messages)
    ? turn.messages.filter((message) => (
        ["commentary", "thinking"].includes(normalizeAgentText(message?.role))
      ))
    : [];
  if (persistedOrder.length) {
    return persistedOrder;
  }
  return [
    ...(Array.isArray(turn.thinking) ? turn.thinking : []),
    ...(Array.isArray(turn.commentary) ? turn.commentary : [])
  ].sort((left, right) => (
    normalizeAgentText(left?.at).localeCompare(normalizeAgentText(right?.at))
  ));
}

function formatCodexRecoveryConversationTurn(turn = {}, index = 0) {
  const lines = [`## Turn ${index + 1}`];
  lines.push(...conversationMessageLines("System", turn.system));
  lines.push(...conversationMessageLines("User", turn.user));
  const activityCounts = {
    commentary: 0,
    thinking: 0
  };
  for (const message of conversationActivityMessages(turn)) {
    const role = normalizeAgentText(message?.role) === "commentary" ? "commentary" : "thinking";
    activityCounts[role] += 1;
    const label = role === "commentary" ? "Assistant Commentary" : "Assistant Thinking";
    lines.push(...conversationMessageLines(`${label} ${activityCounts[role]}`, message));
  }
  lines.push(...conversationMessageLines("Assistant", turn.assistant));
  return lines.length > 1 ? lines.join("\n\n") : "";
}

function formatCodexRecoveryConversationLog(turns = []) {
  const formattedTurns = (Array.isArray(turns) ? turns : [])
    .map((turn, index) => formatCodexRecoveryConversationTurn(turn, index))
    .filter(Boolean);
  return formattedTurns.length
    ? formattedTurns.join("\n\n---\n\n")
    : "(No persisted Vibe64 UI conversation messages were available.)";
}

async function codexContextRecoveryPrompt({
  error,
  newThreadId = "",
  previousThreadId = "",
  runtime,
  sessionId = "",
  workdir = ""
} = {}) {
  const conversationLog = typeof runtime?.store?.readConversationLog === "function"
    ? await runtime.store.readConversationLog(sessionId)
    : [];
  return renderCodexContextRecoveryTemplate(CODEX_CONTEXT_RECOVERY_TEMPLATE, {
    conversationLog: formatCodexRecoveryConversationLog(conversationLog),
    newThreadId: normalizeAgentText(newThreadId),
    previousThreadId: normalizeAgentText(previousThreadId),
    resumeError: normalizeAgentText(error?.message || String(error || "")),
    sessionId: normalizeAgentText(sessionId),
    workdir: normalizeWorkdir(workdir)
  }).trim();
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
  return {
    codex_conversation_id: normalizedThreadId,
    codex_conversation_workdir: normalizedWorkdir,
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

function defineCodexSessionRenewalThreadIds(value = []) {
  if (
    !Array.isArray(value) ||
    value.length > CODEX_SESSION_RENEWAL_BASELINE_MAX_THREADS
  ) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread inventory is invalid."
    );
  }
  const threadIds = value.map((threadId) => normalizeAgentText(threadId));
  if (
    threadIds.some((threadId) => (
      !threadId ||
      threadId.length > CODEX_SESSION_RENEWAL_THREAD_ID_MAX_LENGTH ||
      codexAppServerTextHasControlCharacters(threadId)
    )) ||
    new Set(threadIds).size !== threadIds.length
  ) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread inventory contains an invalid identity."
    );
  }
  return Object.freeze([...threadIds].sort());
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
    throw codexSessionRenewalThreadError(
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
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread baseline does not belong to this exact renewal operation."
    );
  }
  return defineCodexSessionRenewalThreadIds(baseline.threadIds);
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
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The successor assistant thread claim is unreadable."
    );
  }
  const claimedThreadIds = defineCodexSessionRenewalThreadIds([claim?.threadId]);
  const claimedOperationId = normalizeAgentText(claim?.operationId);
  const claimedWorkdir = normalizeWorkdir(claim?.workdir);
  if (
    !isPlainRecord(claim) ||
    normalizeAgentText(claim.schemaVersion) !== CODEX_SESSION_RENEWAL_THREAD_CLAIM_SCHEMA ||
    claimedOperationId !== normalizeAgentText(operationId) ||
    claimedWorkdir !== normalizeWorkdir(workdir)
  ) {
    throw codexSessionRenewalThreadError(
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

async function listCodexSessionRenewalThreadIds(provider, workdir = "") {
  if (typeof provider?.listAppServerThreadsForCwd !== "function") {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The assistant provider cannot inventory the successor's exact session threads."
    );
  }
  const normalizedWorkdir = normalizeWorkdir(workdir);
  const inventory = await provider.listAppServerThreadsForCwd({
    cwd: normalizedWorkdir
  });
  if (normalizeWorkdir(inventory?.cwd) !== normalizedWorkdir) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The assistant provider returned a thread inventory for a different session source."
    );
  }
  return defineCodexSessionRenewalThreadIds(inventory?.threadIds);
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
    threadIds: defineCodexSessionRenewalThreadIds(threadIds),
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
  const [normalizedThreadId] = defineCodexSessionRenewalThreadIds([threadId]);
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

function assertCodexSessionRenewalThreadSnapshot(threadSnapshot = null, {
  threadId = "",
  workdir = ""
} = {}) {
  const expectedThreadId = normalizeAgentText(threadId);
  const expectedWorkdir = normalizeWorkdir(workdir);
  const actualThreadId = codexAppServerThreadResponseId(threadSnapshot);
  const actualWorkdir = normalizeWorkdir(
    threadSnapshot?.cwd ||
    threadSnapshot?.raw?.cwd ||
    threadSnapshot?.response?.thread?.cwd
  );
  if (actualThreadId !== expectedThreadId || actualWorkdir !== expectedWorkdir) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The assistant provider could not verify the exact successor thread and session source.",
      {
        actualThreadId,
        actualWorkdir,
        expectedThreadId,
        expectedWorkdir
      }
    );
  }
  return threadSnapshot;
}

function codexSessionRenewalThreadNeedsStatusRead(error = null, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId);
  return Boolean(
    normalizedThreadId &&
    (
      (
        codexAppServerRequestIsInvalid(error, "thread/read") &&
        normalizeAgentText(error?.message) ===
          `thread ${normalizedThreadId} ${CODEX_SESSION_RENEWAL_UNMATERIALIZED_THREAD_SUFFIX}`
      ) ||
      (
        Number(error?.code) === -32601 &&
        normalizeAgentText(error?.method) === "thread/read"
      )
    )
  );
}

async function readCodexSessionRenewalSuccessorThreadSnapshot({
  provider,
  threadId = "",
  workdir = ""
} = {}) {
  try {
    return assertCodexSessionRenewalThreadSnapshot(
      await provider.readThread(threadId),
      { threadId, workdir }
    );
  } catch (error) {
    if (
      !codexSessionRenewalThreadNeedsStatusRead(error, threadId) ||
      typeof provider?.readThreadStatus !== "function"
    ) {
      throw error;
    }
    return assertCodexSessionRenewalThreadSnapshot(
      await provider.readThreadStatus(threadId),
      { threadId, workdir }
    );
  }
}

function codexSessionRenewalThreadError(code, message, details = {}, {
  retryable = false
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = {
    ...details,
    retryable
  };
  error.retryable = retryable;
  return error;
}

function codexAppServerThreadResponseId(thread = null, fallback = "") {
  return normalizeAgentText(
    thread?.id ||
    thread?.response?.thread?.id ||
    fallback
  );
}

async function resumeExactCodexAppServerThreadForSession({
  agentSettings = {},
  developerInstructions = "",
  expectedThreadId = "",
  provider,
  session = {},
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeWorkdir(workdir);
  const persistedThreadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
  const normalizedExpectedThreadId = normalizeAgentText(expectedThreadId) || persistedThreadId;
  if (!normalizedExpectedThreadId || persistedThreadId !== normalizedExpectedThreadId) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
      "The old assistant thread is no longer the exact readable main thread for this session.",
      {
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId
      }
    );
  }
  if (
    typeof provider?.ensureRuntime !== "function" ||
    typeof provider?.resumeThread !== "function" ||
    typeof provider?.readThread !== "function"
  ) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
      "The old assistant provider cannot read its exact main thread.",
      { expectedThreadId: normalizedExpectedThreadId }
    );
  }
  const appServerRuntime = await provider.ensureRuntime();
  const config = await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir);
  const threadSettings = codexAppServerThreadSettings({
    agentSettings,
    config,
    cwd: normalizedWorkdir,
    developerInstructions
  });
  let thread = null;
  let threadSnapshot = null;
  try {
    thread = await provider.resumeThread(normalizedExpectedThreadId, threadSettings);
    const resumedThreadId = codexAppServerThreadResponseId(thread, normalizedExpectedThreadId);
    if (resumedThreadId !== normalizedExpectedThreadId) {
      throw codexSessionRenewalThreadError(
        CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
        "The old assistant provider resumed a different thread.",
        {
          expectedThreadId: normalizedExpectedThreadId,
          resumedThreadId
        }
      );
    }
    threadSnapshot = await provider.readThread(normalizedExpectedThreadId);
  } catch (error) {
    if (
      error?.code === CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE ||
      codexAppServerRequestIsInvalid(error, "thread/resume") ||
      codexAppServerRequestIsInvalid(error, "thread/read")
    ) {
      if (error?.code === CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE) {
        throw error;
      }
      throw codexSessionRenewalThreadError(
        CODEX_SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
        "The old assistant thread cannot be read. Write or edit the handover manually instead.",
        {
          expectedThreadId: normalizedExpectedThreadId,
          providerError: normalizeAgentText(error?.message)
        }
      );
    }
    throw error;
  }
  return Object.freeze({
    appServerRuntime,
    thread,
    threadId: normalizedExpectedThreadId,
    threadSnapshot,
    threadSettings
  });
}

async function startFreshCodexAppServerThreadForSession({
  additionalMetadata = {},
  agentSettings = {},
  developerInstructions = "",
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
    throw codexSessionRenewalThreadError(
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
    throw codexSessionRenewalThreadError(
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
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session already owns a different assistant thread; Vibe64 will not reuse or replace it.",
      {
        claimedThreadId,
        expectedThreadId: normalizedExpectedThreadId,
        persistedThreadId
      }
    );
  }
  const resumableThreadId = claimedThreadId;
  if (resumableThreadId && resumableThreadId === normalizedForbiddenThreadId) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The renewed session cannot reuse the old session's assistant thread.",
      { forbiddenThreadId: normalizedForbiddenThreadId }
    );
  }
  if (
    typeof provider?.ensureRuntime !== "function" ||
    typeof provider?.resumeThread !== "function" ||
    typeof provider?.readThread !== "function" ||
    typeof provider?.startThread !== "function"
  ) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      "The assistant provider cannot prove a genuinely fresh renewal thread."
    );
  }
  const appServerRuntime = await provider.ensureRuntime();
  const config = await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir);
  const ordinaryThreadSettings = codexAppServerThreadSettings({
    agentSettings,
    config,
    cwd: normalizedWorkdir,
    developerInstructions
  });
  const ordinaryThreadStartSettings = codexAppServerThreadStartSettings({
    agentSettings,
    config,
    cwd: normalizedWorkdir,
    developerInstructions
  });
  const threadSettings = readOnly
    ? { ...ordinaryThreadSettings, sandbox: CODEX_SESSION_READ_ONLY_SANDBOX }
    : ordinaryThreadSettings;
  const threadStartSettings = readOnly
    ? { ...ordinaryThreadStartSettings, sandbox: CODEX_SESSION_READ_ONLY_SANDBOX }
    : ordinaryThreadStartSettings;
  let fresh = false;
  let thread = null;
  let threadSnapshot = null;
  let baselineThreadIds = Object.freeze([]);
  if (resumableThreadId) {
    try {
      thread = await provider.resumeThread(resumableThreadId, threadSettings);
      const resumedThreadId = codexAppServerThreadResponseId(thread, resumableThreadId);
      if (resumedThreadId !== resumableThreadId) {
        throw codexSessionRenewalThreadError(
          CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
          "The assistant provider resumed a different renewal thread.",
          {
            expectedThreadId: resumableThreadId,
            resumedThreadId
          }
        );
      }
      threadSnapshot = await readCodexSessionRenewalSuccessorThreadSnapshot({
        provider,
        threadId: resumableThreadId,
        workdir: normalizedWorkdir
      });
    } catch (error) {
      if (
        error?.code === CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE ||
        codexAppServerRequestIsInvalid(error, "thread/resume") ||
        codexAppServerRequestIsInvalid(error, "thread/read")
      ) {
        if (error?.code === CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE) {
          throw error;
        }
        throw codexSessionRenewalThreadError(
          CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
          "The previously started renewal thread is no longer readable; Vibe64 will not replace it silently.",
          {
            expectedThreadId: resumableThreadId,
            providerError: normalizeAgentText(error?.message)
          }
        );
      }
      throw error;
    }
  } else {
    if (!normalizedOperationId) {
      throw codexSessionRenewalThreadError(
        CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
        "Starting a fresh successor thread requires its exact renewal operation id."
      );
    }
    baselineThreadIds = persistedCodexSessionRenewalThreadBaseline(session, {
      operationId: normalizedOperationId,
      workdir: normalizedWorkdir
    });
    if (!baselineThreadIds) {
      baselineThreadIds = await listCodexSessionRenewalThreadIds(
        provider,
        normalizedWorkdir
      );
      await writeCodexSessionRenewalThreadBaseline({
        operationId: normalizedOperationId,
        runtime,
        sessionId: session.sessionId,
        threadIds: baselineThreadIds,
        workdir: normalizedWorkdir
      });
    }
    const currentThreadIds = await listCodexSessionRenewalThreadIds(
      provider,
      normalizedWorkdir
    );
    const baseline = new Set(baselineThreadIds);
    const candidateThreadIds = currentThreadIds.filter((threadId) => !baseline.has(threadId));
    if (candidateThreadIds.length > 1) {
      throw codexSessionRenewalThreadError(
        CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
        "More than one unclaimed assistant thread appeared for this renewal; Vibe64 will not guess which one is authoritative.",
        { candidateThreadIds }
      );
    }
    if (candidateThreadIds.length === 1) {
      const [candidateThreadId] = candidateThreadIds;
      thread = await provider.resumeThread(candidateThreadId, threadSettings);
      const resumedThreadId = codexAppServerThreadResponseId(thread, candidateThreadId);
      if (resumedThreadId !== candidateThreadId) {
        throw codexSessionRenewalThreadError(
          CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
          "The assistant provider resumed a different recovered renewal thread.",
          {
            expectedThreadId: candidateThreadId,
            resumedThreadId
          }
        );
      }
      threadSnapshot = await readCodexSessionRenewalSuccessorThreadSnapshot({
        provider,
        threadId: candidateThreadId,
        workdir: normalizedWorkdir
      });
    } else {
      thread = await provider.startThread(threadStartSettings);
      fresh = true;
    }
  }
  const threadId = codexAppServerThreadResponseId(thread, resumableThreadId);
  if (
    !threadId ||
    threadId === normalizedForbiddenThreadId ||
    (fresh && baselineThreadIds.includes(threadId))
  ) {
    throw codexSessionRenewalThreadError(
      CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
      threadId
        ? "The assistant provider reused the old session's thread instead of starting a fresh one."
        : "The assistant provider did not return a fresh renewal thread id.",
      {
        forbiddenThreadId: normalizedForbiddenThreadId,
        threadId
      }
    );
  }
  if (!persistedClaim) {
    await writeCodexSessionRenewalThreadClaim({
      operationId: normalizedOperationId,
      runtime,
      sessionId: session.sessionId,
      threadId,
      workdir: normalizedWorkdir
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
    workdir: normalizedWorkdir
  });
  if (fresh) {
    try {
      threadSnapshot = await readCodexSessionRenewalSuccessorThreadSnapshot({
        provider,
        threadId,
        workdir: normalizedWorkdir
      });
    } catch (error) {
      throw codexSessionRenewalThreadError(
        CODEX_SESSION_RENEWAL_FRESH_THREAD_REQUIRED_CODE,
        "The newly started renewal thread cannot be read; Vibe64 will not replace it silently.",
        {
          providerError: normalizeAgentText(error?.message),
          threadId
        },
        { retryable: true }
      );
    }
  }
  return Object.freeze({
    appServerRuntime,
    fresh,
    thread,
    threadId,
    threadSnapshot,
    threadStartSettings,
    threadSettings
  });
}

function codexAppServerThreadIdForSession(session = {}, workdir = "") {
  const metadata = session.metadata || {};
  if (metadata.agent_identity_provider === "opencode" && metadata.codex_conversation_id && normalizeWorkdir(workdir) &&
      normalizeWorkdir(metadata.codex_conversation_workdir) === normalizeWorkdir(workdir)) {
    return normalizeAgentText(metadata.codex_conversation_id);
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

async function codexAppServerThreadHasReadableHistory(provider = null, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId || typeof provider?.readThread !== "function") {
    return false;
  }
  try {
    await provider.readThread(normalizedThreadId);
    return true;
  } catch (error) {
    if (codexAppServerRequestIsInvalid(error, "thread/read")) {
      return false;
    }
    throw error;
  }
}

function codexAppServerNotificationParams(notification = {}) {
  const params = notification?.params;
  return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}

function codexAppServerNotificationThreadId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  return normalizeAgentText(params.threadId || params.thread?.id);
}

function codexAppServerNotificationTurnId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  return normalizeAgentText(params.turnId || params.turn?.id);
}

function codexAppServerNotificationTurnStatus(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const status = params.status && typeof params.status === "object" && !Array.isArray(params.status)
    ? params.status.type
    : params.status;
  return normalizeAgentText(params.turn?.status || status);
}

function codexAppServerTurnStatusIsComplete(status = "") {
  return ["completed", "interrupted", "failed", "idle"].includes(normalizeAgentText(status));
}

function codexAppServerNotificationCompletesTurn(notification = {}) {
  const method = normalizeAgentText(notification.method);
  if (method === "turn/completed") {
    return true;
  }
  return method === "thread/status/changed" &&
    codexAppServerTurnStatusIsComplete(codexAppServerNotificationTurnStatus(notification));
}

function createCodexAppServerTurnCompletionWatcher(provider, threadId = "", {
  timeoutMs = CODEX_APP_SERVER_CONTEXT_TURN_TIMEOUT_MS
} = {}) {
  const normalizedThreadId = normalizeAgentText(threadId);
  const completedTurnIds = new Set();
  const waiters = new Map();
  const resolveWaiter = (waiter) => {
    clearTimeout(waiter.timeout);
    waiter.resolve();
  };
  const completeTurn = (turnId = "") => {
    const normalizedTurnId = normalizeAgentText(turnId);
    completedTurnIds.add(normalizedTurnId || "*");
    for (const [waiterTurnId, waiter] of waiters.entries()) {
      if (!normalizedTurnId || !waiterTurnId || normalizedTurnId === waiterTurnId) {
        waiters.delete(waiterTurnId);
        resolveWaiter(waiter);
      }
    }
  };
  const unsubscribe = typeof provider?.subscribe === "function"
    ? provider.subscribe((notification = {}) => {
        const notificationThreadId = codexAppServerNotificationThreadId(notification);
        if (notificationThreadId && notificationThreadId !== normalizedThreadId) {
          return;
        }
        if (codexAppServerNotificationCompletesTurn(notification)) {
          completeTurn(codexAppServerNotificationTurnId(notification));
        }
      })
    : null;

  return {
    dispose() {
      unsubscribe?.();
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timeout);
      }
      waiters.clear();
    },
    wait(turnId = "") {
      if (!unsubscribe) {
        return Promise.resolve();
      }
      const normalizedTurnId = normalizeAgentText(turnId);
      if (completedTurnIds.has("*") || (normalizedTurnId && completedTurnIds.has(normalizedTurnId))) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const waiterKey = normalizedTurnId || `waiter:${waiters.size + 1}`;
        const timeout = setTimeout(() => {
          waiters.delete(waiterKey);
          reject(new Error("Timed out waiting for the Codex context turn to complete."));
        }, timeoutMs);
        waiters.set(waiterKey, {
          resolve,
          timeout
        });
      });
    }
  };
}

async function sendCodexAppServerContextTurn({
  agentSettings = {},
  input = "",
  provider,
  threadId = "",
  workdir = ""
} = {}) {
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId) {
    throw new Error("Codex app-server context delivery requires a thread id.");
  }
  if (!normalizeAgentText(input)) {
    throw new Error("Codex app-server context delivery requires input.");
  }
  const watcher = createCodexAppServerTurnCompletionWatcher(provider, normalizedThreadId);
  try {
    const turn = await provider.sendTurn(
      normalizedThreadId,
      input,
      codexAppServerTurnSettings({
        agentSettings,
        cwd: workdir
      })
    );
    if (!codexAppServerTurnStatusIsComplete(turn.status)) {
      await watcher.wait(turn.id);
    }
    return {
      input,
      turn
    };
  } finally {
    watcher.dispose();
  }
}

async function sendCodexAppServerContextRecoveryTurn({
  agentSettings = {},
  error,
  previousThreadId = "",
  provider,
  runtime,
  sessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  return sendCodexAppServerContextTurn({
    agentSettings,
    input: await codexContextRecoveryPrompt({
      error,
      newThreadId: threadId,
      previousThreadId,
      runtime,
      sessionId,
      workdir
    }),
    provider,
    threadId,
    workdir
  });
}

async function writeCodexAppServerReplacementMetadata({
  error,
  runtime,
  sessionId = "",
  threadId = ""
} = {}) {
  const previousThreadId = normalizeAgentText(threadId);
  if (!previousThreadId) {
    return;
  }
  const metadata = {
    codex_app_server_replaced_thread_at: new Date().toISOString(),
    codex_app_server_replaced_thread_error: normalizeAgentText(error?.message || String(error || "")),
    codex_app_server_replaced_thread_id: previousThreadId
  };
  await runtime.store.mutateSession(sessionId, async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      runtime.store.writeMetadataValue(sessionId, name, String(value || ""))
    )));
  });
}

async function ensureCodexAppServerThreadForSession({
  agentSettings = {},
  developerInstructions = "",
  observeThread,
  provider,
  runtime,
  session = {},
  workdir = ""
} = {}) {
  if (typeof observeThread !== "function") {
    throw new TypeError("Main Codex threads require an observer before they can resume.");
  }
  const normalizedWorkdir = normalizeWorkdir(workdir);
  let stageStartedAt = Date.now();
  const availability = typeof provider.ensureAvailable === "function"
    ? await provider.ensureAvailable()
    : null;
  const appServerRuntime = availability?.runtime || await provider.ensureRuntime();
  vibe64SessionDebugLog("server.codexAppServerSessionBridge.thread.stage", {
    durationMs: Date.now() - stageStartedAt,
    sessionId: session.sessionId,
    stage: "runtime"
  });
  const existingThreadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
  stageStartedAt = Date.now();
  const config = await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir);
  vibe64SessionDebugLog("server.codexAppServerSessionBridge.thread.stage", {
    durationMs: Date.now() - stageStartedAt,
    sessionId: session.sessionId,
    stage: "hook-config"
  });
  const threadSettings = codexAppServerThreadSettings({
    agentSettings,
    config,
    cwd: normalizedWorkdir,
    developerInstructions
  });
  const threadStartSettings = codexAppServerThreadStartSettings({
    agentSettings,
    config,
    cwd: normalizedWorkdir,
    developerInstructions
  });
  let replacedThreadError = null;
  let thread = null;
  stageStartedAt = Date.now();
  if (existingThreadId) {
    if (session.metadata?.codex_changeover_pause_goal === "yes") {
      const { goal } = await provider.readGoal(existingThreadId);
      if (goal?.status === "active") await provider.setGoalStatus(existingThreadId, "paused");
    }
    // Resuming can immediately start an active goal before the RPC returns.
    await observeThread(existingThreadId);
    try {
      thread = await provider.resumeThread(existingThreadId, threadSettings);
      if (session.metadata?.codex_changeover_pause_goal === "yes") {
        await runtime.store.writeMetadataValue(session.sessionId, "codex_changeover_pause_goal", "");
      }
    } catch (error) {
      // A changeover must never run the legacy standalone recovery prompt.
      // Keep the saved conversation and let the ordinary Send fail visibly.
      if (session.metadata?.codex_changeover_pause_goal === "yes") throw error;
      if (
        !codexAppServerRequestIsInvalid(error, "thread/resume") ||
        await codexAppServerThreadHasReadableHistory(provider, existingThreadId)
      ) {
        throw error;
      }
      replacedThreadError = error;
      thread = await provider.startThread(threadStartSettings);
    }
  } else {
    thread = await provider.startThread(threadStartSettings);
  }
  vibe64SessionDebugLog("server.codexAppServerSessionBridge.thread.stage", {
    durationMs: Date.now() - stageStartedAt,
    sessionId: session.sessionId,
    stage: existingThreadId ? "resume" : "start"
  });
  const threadId = normalizeAgentText(thread.id || (replacedThreadError ? "" : existingThreadId));
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }
  const recovery = replacedThreadError
    ? await sendCodexAppServerContextRecoveryTurn({
        agentSettings,
        error: replacedThreadError,
        previousThreadId: existingThreadId,
        provider,
        runtime,
        sessionId: session.sessionId,
        threadId,
        workdir: normalizedWorkdir
    })
    : null;
  stageStartedAt = Date.now();
  await writeCodexAppServerIdentityMetadata({
    appServerRuntime,
    runtime,
    sessionId: session.sessionId,
    threadId,
    workdir: normalizedWorkdir
  });
  vibe64SessionDebugLog("server.codexAppServerSessionBridge.thread.stage", {
    durationMs: Date.now() - stageStartedAt,
    sessionId: session.sessionId,
    stage: "identity-metadata"
  });
  if (replacedThreadError) {
    await writeCodexAppServerReplacementMetadata({
      error: replacedThreadError,
      runtime,
      sessionId: session.sessionId,
      threadId: existingThreadId
    });
  }
  return {
    appServerRuntime,
    recovery,
    replacedThreadError,
    replacedThreadId: replacedThreadError ? existingThreadId : "",
    thread,
    threadId
  };
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
  const authoredInput = String(prompt ?? "");
  if (!authoredInput.trim()) {
    throw new Error("Codex app-server prompt is empty.");
  }
  const input = [authoredInput, ...attachments
    .filter((attachment) => attachment.contentType?.startsWith("image/"))
    .map((attachment) => ({ type: "localImage", path: attachment.path }))];
  const turnSettings = {
    ...codexAppServerTurnSettings({
      agentSettings,
      cwd: workdir
    }),
    ...(readOnly
      ? {
          sandboxPolicy: {
            networkAccess: false,
            type: "readOnly"
          }
        }
      : {}),
    ...(normalizeAgentText(clientUserMessageId)
      ? { clientUserMessageId: normalizeAgentText(clientUserMessageId) }
      : {})
  };
  if (outputSchema && typeof outputSchema === "object" && !Array.isArray(outputSchema)) {
    turnSettings.outputSchema = outputSchema;
  }
  const turn = await provider.sendTurn(threadId, input, turnSettings);
  return {
    input,
    turn
  };
}

export {
  CODEX_SESSION_AGENT_PROVIDER,
  CODEX_SESSION_APPROVAL_POLICY,
  CODEX_SESSION_MODEL,
  CODEX_SESSION_REASONING_EFFORT,
  CODEX_SESSION_REASONING_SUMMARY,
  CODEX_SESSION_SANDBOX,
  assertCodexAppServerEconomyOutputWithinLimit,
  assertCodexAppServerEconomyCompatibility,
  codexAppServerEconomyThreadResumeSettings,
  codexAppServerEconomyThreadSettings,
  codexAppServerEconomyThreadStartSettings,
  codexAppServerEconomyTurnSettings,
  codexAppServerIdentityMetadata,
  codexAppServerProjectHookTrustConfig,
  codexAppServerThreadHasReadableHistory,
  codexAppServerThreadIdForSession,
  codexAppServerThreadStartSettings,
  codexAppServerThreadSettings,
  codexAppServerTurnSettings,
  ensureCodexAppServerThreadForSession,
  prepareCodexAppServerEconomyThreadStartSettings,
  resumeCodexAppServerEconomyThread,
  resumeExactCodexAppServerThreadForSession,
  sendCodexAppServerEconomyTurn,
  sendCodexAppServerPromptForSession,
  startCodexAppServerEconomyThread,
  startFreshCodexAppServerThreadForSession,
  writeCodexAppServerIdentityMetadata
};
