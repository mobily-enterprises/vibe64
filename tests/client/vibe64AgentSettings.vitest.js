import { describe, expect, it } from "vitest";
import {
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  VIBE64_CODEX_GPT_5_5_MODEL,
  VIBE64_CODEX_SOL_MODEL,
  VIBE64_CODEX_SOURCE_EXPLANATION_MODEL,
  VIBE64_CODEX_SOURCE_EXPLANATION_THINKING,
  VIBE64_CODEX_SPARK_MODEL,
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE,
  VIBE64_AGENT_PROVIDER_UNKNOWN_CODE,
  defaultVibe64AgentSettings,
  defaultVibe64SourceExplanationAgentSettings,
  displayVibe64AgentSetting,
  effectiveVibe64AgentExecutionSettings,
  effectiveVibe64AgentSettings,
  normalizeVibe64AgentSettings
} from "../../packages/vibe64-runtime/src/shared/agentSettings.js";
import {
  agentSettingsStorageKey
} from "../../src/composables/useVibe64AgentSettings.js";

describe("vibe64AgentSettings", () => {
  it("keeps Automatic as the stored setting and resolves concrete Codex defaults at runtime", () => {
    const settings = defaultVibe64AgentSettings();

    expect(settings).toEqual({
      model: "",
      providerId: "codex",
      thinking: ""
    });
    expect(displayVibe64AgentSetting(settings.providerId, "model", settings.model)).toBe(
      "Automatic (GPT-5.6 Sol)"
    );
    expect(effectiveVibe64AgentSettings(settings)).toEqual({
      model: VIBE64_CODEX_SOL_MODEL,
      providerId: "codex",
      thinking: VIBE64_CODEX_DEFAULT_THINKING
    });
    expect(VIBE64_CODEX_DEFAULT_MODEL).toBe(VIBE64_CODEX_SOL_MODEL);
    expect(displayVibe64AgentSetting("codex", "model", VIBE64_CODEX_SOL_MODEL)).toBe("GPT-5.6 Sol");
    expect(displayVibe64AgentSetting("codex", "model", VIBE64_CODEX_GPT_5_5_MODEL)).toBe("GPT-5.5");
  });

  it("normalizes unsupported values before they reach an AI provider adapter", () => {
    expect(normalizeVibe64AgentSettings({
      model: "unsupported-model",
      providerId: "codex",
      thinking: "unsupported-thinking"
    })).toEqual({
      model: VIBE64_CODEX_DEFAULT_MODEL,
      providerId: "codex",
      thinking: VIBE64_CODEX_DEFAULT_THINKING
    });
  });

  it("exposes Codex Spark and uses Spark/Medium for source explanations", () => {
    expect(displayVibe64AgentSetting("codex", "model", VIBE64_CODEX_SPARK_MODEL)).toBe("Codex Spark");
    expect(defaultVibe64SourceExplanationAgentSettings()).toEqual({
      model: VIBE64_CODEX_SOURCE_EXPLANATION_MODEL,
      providerId: "codex",
      thinking: VIBE64_CODEX_SOURCE_EXPLANATION_THINKING
    });
    expect(effectiveVibe64AgentSettings(defaultVibe64SourceExplanationAgentSettings())).toEqual({
      model: VIBE64_CODEX_SPARK_MODEL,
      providerId: "codex",
      thinking: "medium"
    });
    expect(effectiveVibe64AgentExecutionSettings(defaultVibe64SourceExplanationAgentSettings())).toEqual({
      model: VIBE64_CODEX_SPARK_MODEL,
      providerId: "codex",
      request: {
        reasoning: false
      },
      thinking: "medium"
    });
  });

  it("retains known future providers without allowing them to execute", () => {
    expect(normalizeVibe64AgentSettings({
      providerId: "opencode"
    })).toEqual({
      model: "",
      providerId: "opencode",
      thinking: ""
    });
    expect(() => effectiveVibe64AgentExecutionSettings({
      providerId: "opencode"
    })).toThrow(expect.objectContaining({
      code: VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
    }));
  });

  it("rejects unknown providers instead of silently executing Codex", () => {
    expect(() => normalizeVibe64AgentSettings({
      providerId: "not-a-provider"
    })).toThrow(expect.objectContaining({
      code: VIBE64_AGENT_PROVIDER_UNKNOWN_CODE
    }));
  });

  it("scopes sticky settings by project and user email", () => {
    expect(agentSettingsStorageKey(
      "vibe64:agent-settings",
      "example-target-app",
      "Owner@Example.com"
    )).toBe("vibe64:agent-settings:project:example-target-app:user:owner@example.com");
  });
});
