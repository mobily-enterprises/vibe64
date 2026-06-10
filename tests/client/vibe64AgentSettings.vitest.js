import { describe, expect, it } from "vitest";
import {
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  defaultVibe64AgentSettings,
  displayVibe64AgentSetting,
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
    expect(displayVibe64AgentSetting(settings.providerId, "model", settings.model)).toBe("Automatic");
    expect(effectiveVibe64AgentSettings(settings)).toEqual({
      model: VIBE64_CODEX_DEFAULT_MODEL,
      providerId: "codex",
      thinking: VIBE64_CODEX_DEFAULT_THINKING
    });
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

  it("scopes sticky settings by project and user email", () => {
    expect(agentSettingsStorageKey(
      "vibe64:agent-settings",
      "example-target-app",
      "Owner@Example.com"
    )).toBe("vibe64:agent-settings:project:example-target-app:user:owner@example.com");
  });
});
