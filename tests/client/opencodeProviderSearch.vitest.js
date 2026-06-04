import { describe, expect, it } from "vitest";

import {
  isOpenCodeTrialProvider,
  searchOpenCodeProviders
} from "../../src/lib/opencodeProviderSearch.js";

const providers = [
  {
    connected: false,
    defaultModelId: "claude-sonnet-4-6",
    id: "anthropic",
    label: "Anthropic",
    models: [
      {
        id: "claude-opus-4-8",
        label: "Claude Opus 4.8"
      },
      {
        id: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6"
      }
    ]
  },
  {
    connected: true,
    defaultModelId: "deepseek-v4-pro",
    id: "deepseek",
    label: "DeepSeek",
    models: [
      {
        id: "deepseek-chat",
        label: "DeepSeek Chat"
      },
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro"
      }
    ]
  },
  {
    connected: true,
    defaultModelId: "openrouter/auto",
    id: "openrouter",
    label: "OpenRouter",
    models: [
      {
        id: "anthropic/claude-sonnet-4-6",
        label: "Claude Sonnet 4.6"
      },
      {
        id: "openai/gpt-5",
        label: "GPT-5"
      }
    ]
  },
  {
    connected: true,
    defaultModelId: "big-pickle",
    id: "opencode",
    label: "OpenCode Zen",
    models: [
      {
        id: "claude-sonnet-4",
        label: "Claude Sonnet 4"
      },
      {
        id: "big-pickle",
        label: "Big Pickle"
      }
    ]
  }
];

describe("OpenCode provider search", () => {
  it("shows connected providers first without a query", () => {
    const rows = searchOpenCodeProviders(providers, "");

    expect(rows.map((provider) => provider.id)).toEqual([
      "deepseek",
      "openrouter",
      "opencode",
      "anthropic"
    ]);
    expect(rows[0].matchedModels).toEqual([]);
  });

  it("matches model ids and labels while keeping the free try-out provider behind real providers", () => {
    const rows = searchOpenCodeProviders(providers, "sonnet");

    expect(rows.map((provider) => provider.id)).toEqual([
      "openrouter",
      "anthropic",
      "opencode"
    ]);
    expect(rows[0].matchedModels).toEqual([
      {
        id: "anthropic/claude-sonnet-4-6",
        label: "Claude Sonnet 4.6"
      }
    ]);
    expect(rows[1].matchingModelCount).toBe(1);
  });

  it("identifies OpenCode Zen as the free try-out provider", () => {
    expect(isOpenCodeTrialProvider({
      id: "opencode"
    })).toBe(true);
    expect(isOpenCodeTrialProvider({
      id: "openrouter"
    })).toBe(false);
  });

  it("still matches provider names", () => {
    const rows = searchOpenCodeProviders(providers, "deep");

    expect(rows.map((provider) => provider.id)).toEqual([
      "deepseek"
    ]);
    expect(rows[0].matchedModels.map((model) => model.id)).toEqual([
      "deepseek-chat",
      "deepseek-v4-pro"
    ]);
  });
});
