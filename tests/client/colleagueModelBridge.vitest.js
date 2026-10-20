import { describe, expect, it, vi } from "vitest";
import { registerVibe64ColleagueModel, useVibe64ColleagueModel, workflowModelSelection } from "../../packages/vibe64-colleague/src/client/colleagueModelBridge.js";

describe("Colleague model bridge", () => {
  it("reaches the newest mounted Colleague and removes only the unmounted one", async () => {
    const bridge = useVibe64ColleagueModel();
    expect(bridge.available.value).toBe(false);
    expect(bridge.current()).toBeNull();
    await expect(bridge.selectForWorkflow("claude")).resolves.toEqual({ ok: false, error: "Colleague is not open in this browser view." });

    const first = { current: () => ({ engineId: "codex" }), selectForWorkflow: vi.fn(async () => ({ ok: true, from: "first" })) };
    const second = { current: () => null, selectForWorkflow: vi.fn(async () => ({ ok: true, from: "second" })) };
    const unregisterFirst = registerVibe64ColleagueModel(first);
    expect(bridge.available.value).toBe(true);
    expect(bridge.current()).toEqual({ engineId: "codex" });
    const unregisterSecond = registerVibe64ColleagueModel(second);
    expect(bridge.current()).toBeNull();
    await expect(bridge.selectForWorkflow("claude")).resolves.toEqual({ ok: true, from: "second" });
    expect(second.selectForWorkflow).toHaveBeenCalledWith("claude");

    unregisterFirst();
    await expect(bridge.selectForWorkflow("claude")).resolves.toMatchObject({ from: "second" });
    unregisterSecond();
    expect(bridge.available.value).toBe(false);
    expect(first.selectForWorkflow).not.toHaveBeenCalled();
  });
});

describe("workflowModelSelection", () => {
  const engine = (overrides = {}) => ({
    engineId: "claude", revision: "rev-1", health: { status: "ready" },
    defaults: { agentId: "claude", modelProviderId: "anthropic", modelId: "default", variantId: "high" },
    agents: [{ id: "claude", mode: "primary" }],
    modelProviders: [{ id: "anthropic", connected: true, models: [
      { id: "default", status: "available", variants: [{ id: "high" }] },
      { id: "haiku", status: "available", variants: [] }
    ] }],
    ...overrides
  });

  it("chooses the workflow's default model, as Colleague's model menu does", () => {
    expect(workflowModelSelection({ engines: [engine({ engineId: "codex" }), engine()] }, "claude")).toEqual({
      engineId: "claude", modelProviderId: "anthropic", modelId: "default", agentId: "claude", variantId: "high", catalogRevision: "rev-1"
    });
  });

  it("falls back to the first connected, available model and drops a missing variant", () => {
    const selection = workflowModelSelection({ engines: [engine({
      defaults: { agentId: "codex", modelProviderId: "openai", modelId: "gpt", variantId: "high" },
      agents: [{ id: "codex", mode: "primary" }],
      engineId: "codex",
      modelProviders: [
        { id: "openai", connected: false, models: [{ id: "gpt", status: "available", variants: [{ id: "high" }] }] },
        { id: "deepseek", connected: true, models: [{ id: "old", status: "unavailable" }, { id: "deepseek-chat", status: "available" }] }
      ]
    })] }, "codex");
    expect(selection).toEqual({ engineId: "codex", modelProviderId: "deepseek", modelId: "deepseek-chat", agentId: "codex", variantId: "", catalogRevision: "rev-1" });
  });

  it("returns nothing for a workflow that is absent, not ready, unconnected or without a compatible agent", () => {
    expect(workflowModelSelection({ engines: [engine()] }, "codex")).toBeNull();
    expect(workflowModelSelection(null, "claude")).toBeNull();
    expect(workflowModelSelection({ engines: [engine({ health: { status: "unavailable" } })] }, "claude")).toBeNull();
    expect(workflowModelSelection({ engines: [engine({ modelProviders: [{ id: "anthropic", connected: false, models: [] }] })] }, "claude")).toBeNull();
    expect(workflowModelSelection({ engines: [engine({ agents: [{ id: "plan", mode: "subagent" }] })] }, "claude")).toBeNull();
  });

  it("omits the catalogue revision when the catalogue has none, so the server does not report it stale", () => {
    expect(workflowModelSelection({ engines: [engine({ revision: "" })] }, "claude")).not.toHaveProperty("catalogRevision");
  });
});
