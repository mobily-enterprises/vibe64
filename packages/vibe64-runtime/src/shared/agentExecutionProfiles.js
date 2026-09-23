const VIBE64_AGENT_EXECUTION_PROFILE_IDS = Object.freeze({
  ECONOMY: "economy"
});

const VIBE64_AGENT_EXECUTION_WORKLOAD_IDS = Object.freeze({
  COMMIT_TITLE: "commit_title",
  CONVERSATION_SUMMARY: "conversation_summary",
  DATABASE_ASSISTANT: "database_assistant",
  PROMPT_HINT: "prompt_hint",
  REQUEST_ROUTING: "request_routing",
  SESSION_TITLE: "session_title",
  SOURCE_EXPLANATION: "source_explanation"
});

const VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS = Object.freeze({
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 512,
    timeoutMs: 120_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.CONVERSATION_SUMMARY]: Object.freeze({
    maxInputCharacters: 200_000,
    maxOutputCharacters: 16_000,
    timeoutMs: 120_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.DATABASE_ASSISTANT]: Object.freeze({
    maxInputCharacters: 500_000,
    maxOutputCharacters: 16_000,
    timeoutMs: 180_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 2_500,
    timeoutMs: 120_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.REQUEST_ROUTING]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 512,
    timeoutMs: 30_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SESSION_TITLE]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 512,
    timeoutMs: 30_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION]: Object.freeze({
    maxInputCharacters: 100_000,
    maxOutputCharacters: 32_000,
    timeoutMs: 180_000
  })
});

const VIBE64_AGENT_EXECUTION_TOOL_POLICIES = Object.freeze({
  NONE: "none"
});

const VIBE64_AGENT_EXECUTION_PROFILE_LIMIT_CEILINGS = Object.freeze({
  MAX_INPUT_CHARACTERS: 500_000,
  MAX_OUTPUT_CHARACTERS: 32_000,
  MAX_TIMEOUT_MS: 300_000
});

const VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES = Object.freeze({
  INVALID: "vibe64_agent_execution_profile_invalid",
  MODEL_UNAVAILABLE: "vibe64_agent_execution_profile_model_unavailable",
  POLICY_UNENFORCEABLE: "vibe64_agent_execution_profile_policy_unenforceable",
  PROFILE_UNKNOWN: "vibe64_agent_execution_profile_unknown",
  REASONING_UNSUPPORTED: "vibe64_agent_execution_profile_reasoning_unsupported",
  UNBOUNDED: "vibe64_agent_execution_profile_unbounded",
  UNSAFE: "vibe64_agent_execution_profile_unsafe",
  WORKLOAD_UNSUPPORTED: "vibe64_agent_execution_profile_workload_unsupported"
});

const VIBE64_AGENT_EXECUTION_PROFILE_VALUES = new Set(
  Object.values(VIBE64_AGENT_EXECUTION_PROFILE_IDS)
);
const VIBE64_AGENT_EXECUTION_WORKLOAD_VALUES = new Set(
  Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS)
);

class Vibe64AgentExecutionProfileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "Vibe64AgentExecutionProfileError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    for (const [name, value] of Object.entries(this.details)) {
      if (!["code", "details", "message", "name"].includes(name)) {
        this[name] = value;
      }
    }
  }
}

function executionProfileError(code, message, details = {}) {
  return new Vibe64AgentExecutionProfileError(code, message, details);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredRecord(value, fieldName) {
  if (!isPlainRecord(value)) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      `Execution profile ${fieldName} must be an object.`,
      { field: fieldName }
    );
  }
  return value;
}

function requireOnlyFields(value, allowedFields, fieldName) {
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(value).find((name) => !allowed.has(name));
  if (unexpected) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      `Execution profile ${fieldName} contains an unsupported field: ${unexpected}.`,
      { field: `${fieldName}.${unexpected}` }
    );
  }
}

function requiredText(value, fieldName, maximumLength = 256) {
  if (typeof value !== "string") {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      `Execution profile ${fieldName} must be text.`,
      { field: fieldName }
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      `Execution profile ${fieldName} is invalid.`,
      { field: fieldName }
    );
  }
  return normalized;
}

function requiredBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      `Execution profile ${fieldName} must be a boolean.`,
      { field: fieldName }
    );
  }
  return value;
}

function requireSafeFalse(value, fieldName) {
  if (requiredBoolean(value, fieldName) !== false) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNSAFE,
      `Execution profile ${fieldName} must be disabled.`,
      { field: fieldName }
    );
  }
  return false;
}

function boundedPositiveInteger(value, fieldName, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      `Execution profile ${fieldName} must be a positive integer no greater than ${maximum}.`,
      { field: fieldName, maximum }
    );
  }
  return value;
}

function requiredLimits(value) {
  if (!isPlainRecord(value)) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "Execution profile limits are required.",
      { field: "limits" }
    );
  }
  return value;
}

function normalizeProfileId(value) {
  const profileId = requiredText(value, "profileId", 64);
  if (!VIBE64_AGENT_EXECUTION_PROFILE_VALUES.has(profileId)) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.PROFILE_UNKNOWN,
      `Unknown execution profile: ${profileId}.`,
      { profileId }
    );
  }
  return profileId;
}

function normalizeWorkloadId(value) {
  const workloadId = requiredText(value, "workloadId", 64);
  if (!VIBE64_AGENT_EXECUTION_WORKLOAD_VALUES.has(workloadId)) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.WORKLOAD_UNSUPPORTED,
      `Unsupported execution profile workload: ${workloadId}.`,
      { workloadId }
    );
  }
  return workloadId;
}

function normalizedExecutionProfileRequest(input) {
  return Object.freeze({
    profileId: normalizeProfileId(input.profileId),
    workloadId: normalizeWorkloadId(input.workloadId)
  });
}

function defineVibe64AgentExecutionProfileRequest(value) {
  const input = requiredRecord(value, "request");
  requireOnlyFields(input, ["profileId", "workloadId"], "request");
  return normalizedExecutionProfileRequest(input);
}

function defineVibe64AgentExecutionProfileResolution(value) {
  const input = requiredRecord(value, "resolution");
  const executionProfile = normalizedExecutionProfileRequest(input);
  const request = requiredRecord(input.request, "request policy");
  const policy = requiredRecord(input.policy, "tool policy");
  const limits = requiredLimits(input.limits);
  requireOnlyFields(
    request,
    ["allowProviderModelFallback", "reasoning", "summary"],
    "request"
  );
  requireOnlyFields(
    policy,
    ["environmentAccess", "networkAccess", "repositoryWrite", "tools"],
    "policy"
  );
  requireOnlyFields(
    limits,
    ["maxInputCharacters", "maxOutputCharacters", "timeoutMs"],
    "limits"
  );
  const reasoning = requiredBoolean(request.reasoning, "request.reasoning");
  if (typeof input.thinking !== "string") {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "Execution profile thinking must be text.",
      { field: "thinking" }
    );
  }
  const thinking = input.thinking.trim();

  if ((reasoning && !thinking) || (!reasoning && thinking)) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNSAFE,
      "Execution profile thinking must agree with its reasoning request.",
      { field: "thinking" }
    );
  }
  if (thinking.length > 64) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "Execution profile thinking is invalid.",
      { field: "thinking" }
    );
  }
  if (policy.tools !== VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE) {
    throw executionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNSAFE,
      "Execution profile tools must be disabled.",
      { field: "policy.tools" }
    );
  }

  return Object.freeze({
    limits: Object.freeze({
      maxInputCharacters: boundedPositiveInteger(
        limits.maxInputCharacters,
        "limits.maxInputCharacters",
        VIBE64_AGENT_EXECUTION_PROFILE_LIMIT_CEILINGS.MAX_INPUT_CHARACTERS
      ),
      maxOutputCharacters: boundedPositiveInteger(
        limits.maxOutputCharacters,
        "limits.maxOutputCharacters",
        VIBE64_AGENT_EXECUTION_PROFILE_LIMIT_CEILINGS.MAX_OUTPUT_CHARACTERS
      ),
      timeoutMs: boundedPositiveInteger(
        limits.timeoutMs,
        "limits.timeoutMs",
        VIBE64_AGENT_EXECUTION_PROFILE_LIMIT_CEILINGS.MAX_TIMEOUT_MS
      )
    }),
    model: requiredText(input.model, "model"),
    policy: Object.freeze({
      environmentAccess: requireSafeFalse(
        policy.environmentAccess,
        "policy.environmentAccess"
      ),
      networkAccess: requireSafeFalse(policy.networkAccess, "policy.networkAccess"),
      repositoryWrite: requireSafeFalse(policy.repositoryWrite, "policy.repositoryWrite"),
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE
    }),
    profileId: executionProfile.profileId,
    providerId: requiredText(input.providerId, "providerId", 64),
    request: Object.freeze({
      allowProviderModelFallback: requireSafeFalse(
        request.allowProviderModelFallback,
        "request.allowProviderModelFallback"
      ),
      reasoning,
      summary: requireSafeFalse(request.summary, "request.summary")
    }),
    revision: requiredText(input.revision, "revision", 128),
    thinking,
    workloadId: executionProfile.workloadId
  });
}

function vibe64AgentExecutionProfileAuditSnapshot(value) {
  return defineVibe64AgentExecutionProfileResolution(value);
}

function vibe64AgentProviderSupportsExecutionProfile(provider, profileId) {
  if (!isPlainRecord(provider) || typeof profileId !== "string") {
    return false;
  }
  const normalizedProfileId = profileId.trim();
  return provider.implemented === true &&
    VIBE64_AGENT_EXECUTION_PROFILE_VALUES.has(normalizedProfileId) &&
    Array.isArray(provider.executionProfiles) &&
    provider.executionProfiles.includes(normalizedProfileId);
}

export {
  VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS,
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_PROFILE_LIMIT_CEILINGS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileRequest,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot,
  vibe64AgentProviderSupportsExecutionProfile
};
