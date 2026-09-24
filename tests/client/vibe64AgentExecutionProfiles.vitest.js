import { describe, expect, it } from "vitest";
import {
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
} from "../../packages/vibe64-runtime/src/shared/index.js";

function validResolution(overrides = {}) {
  const {
    limits: limitOverrides = {},
    policy: policyOverrides = {},
    request: requestOverrides = {},
    ...resolutionOverrides
  } = overrides;
  return {
    limits: {
      maxInputCharacters: 100_000,
      maxOutputCharacters: 4_000,
      timeoutMs: 120_000,
      ...limitOverrides
    },
    model: "provider-model",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE,
      ...policyOverrides
    },
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    providerId: "provider",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false,
      ...requestOverrides
    },
    revision: "economy-v1",
    thinking: "low",
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION,
    ...resolutionOverrides
  };
}

function expectProfileError(run, code, field) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Vibe64AgentExecutionProfileError);
    expect(error).toMatchObject({
      code,
      ...(field ? { field } : {})
    });
    expect(Object.isFrozen(error.details)).toBe(true);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

describe("vibe64 agent execution profiles", () => {
  it("publishes the complete bounded-background workload vocabulary", () => {
    expect(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS).toEqual({
      COMMIT_TITLE: "commit_title",
      CONVERSATION_SUMMARY: "conversation_summary",
      DATABASE_ASSISTANT: "database_assistant",
      PROMPT_HINT: "prompt_hint",
      REQUEST_ROUTING: "request_routing",
      SESSION_TITLE: "session_title",
      SOURCE_EXPLANATION: "source_explanation"
    });
    expect(Object.isFrozen(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS)).toBe(true);
  });

  it("normalizes and freezes semantic requests without provider details", () => {
    const request = defineVibe64AgentExecutionProfileRequest({
      profileId: " economy ",
      workloadId: " prompt_hint "
    });

    expect(request).toEqual({
      profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
      workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT
    });
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("does not treat a disabled provider's advertised profile as executable", () => {
    expect(vibe64AgentProviderSupportsExecutionProfile({
      executionProfiles: [VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY],
      implemented: false
    }, VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY)).toBe(false);
  });

  it("rejects malformed and unsupported semantic requests with stable codes", () => {
    expectProfileError(
      () => defineVibe64AgentExecutionProfileRequest(null),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "request"
    );
    expectProfileError(
      () => defineVibe64AgentExecutionProfileRequest({
        profileId: "interactive",
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT
      }),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.PROFILE_UNKNOWN
    );
    expectProfileError(
      () => defineVibe64AgentExecutionProfileRequest({
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
        workloadId: "implementation"
      }),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.WORKLOAD_UNSUPPORTED
    );
    expectProfileError(
      () => defineVibe64AgentExecutionProfileRequest({
        model: "consumer-selected-model",
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT
      }),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "request.model"
    );
  });

  it("validates and deeply freezes a provider resolution", () => {
    const resolution = defineVibe64AgentExecutionProfileResolution(validResolution());

    expect(resolution).toEqual(validResolution());
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(Object.isFrozen(resolution.request)).toBe(true);
    expect(Object.isFrozen(resolution.policy)).toBe(true);
    expect(Object.isFrozen(resolution.limits)).toBe(true);
  });

  it("accepts an empty thinking value only when the provider disables reasoning", () => {
    expect(defineVibe64AgentExecutionProfileResolution(validResolution({
      request: { reasoning: false },
      thinking: ""
    }))).toMatchObject({
      request: { reasoning: false },
      thinking: ""
    });
    expectProfileError(
      () => defineVibe64AgentExecutionProfileResolution(validResolution({
        request: { reasoning: false },
        thinking: null
      })),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "thinking"
    );
  });

  it.each([
    ["request.allowProviderModelFallback", { request: { allowProviderModelFallback: true } }],
    ["request.summary", { request: { summary: true } }],
    ["policy.environmentAccess", { policy: { environmentAccess: true } }],
    ["policy.networkAccess", { policy: { networkAccess: true } }],
    ["policy.repositoryWrite", { policy: { repositoryWrite: true } }],
    ["policy.tools", { policy: { tools: "read" } }],
    ["thinking", { thinking: "", request: { reasoning: true } }]
  ])("rejects unsafe economy capability at %s", (field, overrides) => {
    expectProfileError(
      () => defineVibe64AgentExecutionProfileResolution(validResolution(overrides)),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNSAFE,
      field
    );
  });

  it.each([
    ["limits.maxInputCharacters", { maxInputCharacters: undefined }],
    ["limits.maxInputCharacters", { maxInputCharacters: 0 }],
    ["limits.maxInputCharacters", {
      maxInputCharacters: VIBE64_AGENT_EXECUTION_PROFILE_LIMIT_CEILINGS.MAX_INPUT_CHARACTERS + 1
    }],
    ["limits.maxOutputCharacters", { maxOutputCharacters: Number.POSITIVE_INFINITY }],
    ["limits.timeoutMs", { timeoutMs: 1.5 }]
  ])("rejects missing or ineffective bound at %s", (field, limits) => {
    expectProfileError(
      () => defineVibe64AgentExecutionProfileResolution(validResolution({ limits })),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      field
    );
  });

  it("rejects an absent limit envelope as unbounded", () => {
    const resolution = validResolution();
    delete resolution.limits;
    expectProfileError(
      () => defineVibe64AgentExecutionProfileResolution(resolution),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED,
      "limits"
    );
  });

  it("rejects malformed resolution fields", () => {
    expectProfileError(
      () => defineVibe64AgentExecutionProfileResolution(validResolution({ model: "" })),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "model"
    );
    expectProfileError(
      () => defineVibe64AgentExecutionProfileResolution(validResolution({
        request: { reasoning: "low" }
      })),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "request.reasoning"
    );
    expectProfileError(
      () => defineVibe64AgentExecutionProfileResolution(validResolution({
        policy: { hiddenToolAccess: false }
      })),
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
      "policy.hiddenToolAccess"
    );
  });

  it("creates an allowlisted audit snapshot without provider-private enforcement data", () => {
    const resolution = validResolution({
      candidates: ["private-candidate"],
      enforcement: {
        disabledToolNames: ["private-tool"]
      }
    });
    const snapshot = vibe64AgentExecutionProfileAuditSnapshot(resolution);

    expect(snapshot).toEqual(validResolution());
    expect(snapshot).not.toHaveProperty("candidates");
    expect(snapshot).not.toHaveProperty("enforcement");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
