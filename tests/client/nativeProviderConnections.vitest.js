import { createRenderer, createSSRApp, nextTick, ref, ssrContextKey } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connections: null, change: vi.fn(), busy: null }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useCodexProviderConnections.js", () => ({
  useCodexProviderConnections: () => ({ connections: mocks.connections, busy: mocks.busy,
    change: mocks.change, loadError: ref(""), resource: { isInitialLoading: ref(false), reload: vi.fn() } })
}));
vi.mock("../../packages/vibe64-accounts/src/client/studio/ModelRoutingForm.vue", () => ({ default: {} }));
import NativeProviderConnections from "../../packages/vibe64-accounts/src/client/studio/NativeProviderConnections.vue";

let app;
function mount(props) {
  const renderer = createRenderer({ createComment: text => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...NativeProviderConnections, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => {
  mocks.busy = ref(false);
  mocks.connections = ref([{ id: "deepseek", status: "connected", connected: false, claudeReady: true }]);
  mocks.change.mockReset().mockResolvedValue({ ok: true, routing: { ok: true } });
});
afterEach(() => app?.unmount());

it("shows each orchestrator's actual verification with warm connection data", () => {
  const state = mount({ engineId: "claude", modelValue: "deepseek" });
  expect(state.choices.map(choice => choice.label)).toEqual([
    "Claude Code - Claude · Claude subscription", "Claude Code - DeepSeek · Connected", "Claude Code - GLM · Coding Plan", "Claude Code - GLM · Pay-as-you-go API"
  ]);
  expect(state.connected).toBe(true);
  expect(state.connectedEngines).toEqual(["claude"]);
});

it("adds the missing orchestrator using its existing shared key without replacing it", async () => {
  const state = mount({ engineId: "codex", modelValue: "deepseek", adding: true, selectProvider: false });
  expect(state.useExistingKey).toBe(true);
  expect(state.connected).toBe(false);
  await state.save();
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ modelProviderId: "deepseek", engineId: "codex", apiKey: "", remove: false, useSavedKey: true });
});

it("keeps pay-as-you-go setup separate from a saved Coding Plan key", async () => {
  mocks.connections.value.push({ id: "zai-coding-plan", status: "connected", connected: true, claudeReady: true });
  const state = mount({ engineId: "claude", modelValue: "zai", adding: true, selectProvider: false });
  expect(state.useExistingKey).toBe(false);
  expect(state.provider.ownerOnly).toBe(false);
  expect(state.provider.setupNote).toContain("without a Coding Plan");
  state.apiKey = "regular-fixture";
  await state.save();
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ modelProviderId: "zai", engineId: "claude", apiKey: "regular-fixture", remove: false, useSavedKey: false });
});

it("renders Manage without a provider selector, and Add without replacement or disconnect actions", async () => {
  async function render(props) {
    const view = createSSRApp(NativeProviderConnections, props);
    view.use(createVuetify({ ssr: true }));
    return renderToString(view);
  }
  const manage = await render({ engineId: "claude", modelValue: "deepseek", selectProvider: false });
  expect(manage).toContain("Claude Code - DeepSeek");
  expect(manage).not.toContain("Use Claude Code with");
  expect(manage).toContain("Check and replace key");
  expect(manage).toContain("Disconnect");
  const add = await render({ engineId: "codex", modelValue: "deepseek", selectProvider: false, adding: true });
  expect(add).not.toContain("Use Codex with");
  expect(add).not.toContain("<input");
  expect(add).not.toContain("Check and replace key");
  expect(add).not.toContain("Disconnect");
  expect(add).toContain("Check and connect");
});

it("does not advertise a Claude-only key as connected to Codex", () => {
  const state = mount({ engineId: "codex", modelValue: "deepseek" });
  expect(state.connected).toBe(false);
  expect(state.choices.find(choice => choice.id === "deepseek").label).toBe("Codex - DeepSeek");
});

it("verifies the saved key for the selected orchestrator without copying it to the browser", async () => {
  const state = mount({ engineId: "claude", modelValue: "deepseek" });
  await state.save({ useSavedKey: true });
  expect(mocks.change).toHaveBeenCalledWith({ modelProviderId: "deepseek", engineId: "claude", apiKey: "", remove: false, useSavedKey: true });
  expect(state.routingProposal).toBe(true);
  expect(state.connectedEngines).toEqual(["claude"]);
});

it("clears unsaved credentials and proposals when selecting another provider", async () => {
  const state = mount({ engineId: "claude", modelValue: "deepseek" });
  state.apiKey = "unsaved-secret";
  state.visible = true;
  state.confirmRemove = true;
  state.routingProposal = true;
  state.providerId = "zai-coding-plan";
  await nextTick();
  expect(state.apiKey).toBe("");
  expect(state.visible).toBe(false);
  expect(state.confirmRemove).toBe(false);
  expect(state.routingProposal).toBe(false);
});

it("keeps failed input available for retry and clears it only after successful verification", async () => {
  const state = mount({ engineId: "claude", modelValue: "deepseek" });
  state.apiKey = "new-secret";
  mocks.change.mockResolvedValueOnce({ ok: false });
  await state.save();
  expect(state.apiKey).toBe("new-secret");
  expect(state.routingProposal).toBe(false);
  await state.save();
  expect(state.apiKey).toBe("");
  expect(state.routingProposal).toBe(true);
});
