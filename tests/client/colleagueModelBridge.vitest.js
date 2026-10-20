import { describe, expect, it, vi } from "vitest";
import { registerVibe64ColleagueModel, useVibe64ColleagueModel } from "../../src/lib/vibe64ColleagueModelBridge.js";
import { selectionLabels } from "../../packages/vibe64-colleague/src/client/colleagueSelectionLabels.js";

describe("Colleague model bridge", () => {
  it("reaches the newest mounted Colleague and removes only the unmounted one", async () => {
    const bridge = useVibe64ColleagueModel();
    const target = { engineId: "codex", modelProviderId: "deepseek" };
    expect(bridge.available.value).toBe(false);
    await expect(bridge.current()).resolves.toBeNull();
    await expect(bridge.selectForWorkflow(target)).resolves.toEqual({ ok: false, error: "Colleague is not open in this browser view." });

    const first = { current: async () => ({ selection: { engineId: "codex" } }), selectForWorkflow: vi.fn(async () => ({ ok: true, from: "first" })) };
    const second = { current: async () => null, selectForWorkflow: vi.fn(async () => ({ ok: true, from: "second" })) };
    const unregisterFirst = registerVibe64ColleagueModel(first);
    expect(bridge.available.value).toBe(true);
    await expect(bridge.current()).resolves.toEqual({ selection: { engineId: "codex" } });
    const unregisterSecond = registerVibe64ColleagueModel(second);
    await expect(bridge.current()).resolves.toBeNull();
    await expect(bridge.selectForWorkflow(target)).resolves.toEqual({ ok: true, from: "second" });
    expect(second.selectForWorkflow).toHaveBeenCalledWith(target);

    unregisterFirst();
    await expect(bridge.selectForWorkflow(target)).resolves.toMatchObject({ from: "second" });
    unregisterSecond();
    expect(bridge.available.value).toBe(false);
    expect(first.selectForWorkflow).not.toHaveBeenCalled();
  });
});

describe("selectionLabels", () => {
  const selection = { engineId: "claude", modelProviderId: "anthropic", modelId: "opus" };

  it("names the selection's workflow and model from Colleague's catalogue", () => {
    const catalog = { engines: [{ engineId: "codex", label: "Codex" }, { engineId: "claude", label: "Claude Code", modelProviders: [
      { id: "openrouter", models: [{ id: "opus", label: "Wrong provider" }] },
      { id: "anthropic", models: [{ id: "sonnet", label: "Claude Sonnet" }, { id: "opus", label: "Claude Opus 4.6" }] }
    ] }] };
    expect(selectionLabels(catalog, selection)).toEqual({ engineLabel: "Claude Code", modelLabel: "Claude Opus 4.6" });
  });

  it("falls back to ids when the catalogue is missing or does not list the selection", () => {
    expect(selectionLabels(null, selection)).toEqual({ engineLabel: "claude", modelLabel: "opus" });
    expect(selectionLabels({ engines: [{ engineId: "claude", label: "Claude Code", modelProviders: [] }] }, selection))
      .toEqual({ engineLabel: "Claude Code", modelLabel: "opus" });
  });
});
