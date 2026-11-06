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
import CustomEndpointForm from "../../packages/vibe64-accounts/src/client/studio/CustomEndpointForm.vue";

let app;
function mount(props, component = NativeProviderConnections) {
  const renderer = createRenderer({ createComment: text => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...component, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => {
  mocks.busy = ref(false);
  mocks.connections = ref([{ id: "deepseek", status: "not_connected", connected: false, claudeReady: true, engineStates: { codex: { status: "not_connected" }, claude: { status: "connected" } } }]);
  mocks.change.mockReset().mockResolvedValue({ ok: true, routing: { ok: true } });
});
afterEach(() => app?.unmount());

it("shows each orchestrator's actual verification with warm connection data", () => {
  const state = mount({ engineId: "claude", modelValue: "deepseek" });
  expect(state.choices.map(choice => choice.label)).toEqual([
    "Claude Code - Claude · Claude subscription", "Claude Code - DeepSeek · Connected", "Claude Code - GLM · Coding Plan", "Claude Code - GLM · Pay-as-you-go API",
    "Claude Code - Custom endpoint"
  ]);
  expect(state.connected).toBe(true);
  expect(state.connectionStatus).toBe("connected");
  expect(state.engineLabel).toBe("Claude Code");
});

it("requires independently entered credentials when adding another orchestrator", async () => {
  const state = mount({ engineId: "codex", modelValue: "deepseek", adding: true, selectProvider: false });
  expect(state.useExistingKey).toBe(false);
  expect(state.connected).toBe(false);
  await state.save();
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ modelProviderId: "deepseek", engineId: "codex", apiKey: "", remove: false, useSavedKey: false });
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
  expect(add).toContain("<input");
  expect(add).not.toContain("Check and replace key");
  expect(add).not.toContain("Disconnect");
  expect(add).toContain("Check and connect");
});

it("does not advertise a Claude-only key as connected to Codex", () => {
  const state = mount({ engineId: "codex", modelValue: "deepseek" });
  expect(state.connected).toBe(false);
  expect(state.choices.find(choice => choice.id === "deepseek").label).toBe("Codex - DeepSeek");
});

it("names Codex's own sign-in's provider OpenAI", () => {
  const state = mount({ engineId: "codex", modelValue: "deepseek" });
  expect(state.choices[0]).toEqual({ id: "openai", label: "Codex - OpenAI · ChatGPT or OpenAI API key" });
});

it("verifies the saved key for the selected orchestrator without copying it to the browser", async () => {
  const state = mount({ engineId: "claude", modelValue: "deepseek" });
  await state.save({ useSavedKey: true });
  expect(mocks.change).toHaveBeenCalledWith({ modelProviderId: "deepseek", engineId: "claude", apiKey: "", remove: false, useSavedKey: true });
  expect(state.routingProposal).toBe(true);
  expect(state.connectionStatus).toBe("connected");
  expect(state.engineLabel).toBe("Claude Code");
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


it("disconnect confirmation and requests identify only the chosen orchestrator", async () => {
  const state = mount({ engineId: "claude", modelValue: "deepseek" });
  await state.save({ remove: true });
  expect(mocks.change).toHaveBeenCalledWith({ modelProviderId: "deepseek", engineId: "claude", apiKey: "", remove: true, useSavedKey: false });
  const view = createSSRApp(NativeProviderConnections, { engineId: "claude", modelValue: "deepseek" });
  view.use(createVuetify({ ssr: true }));
  const html = await renderToString(view);
  expect(html).toContain("Checks Claude Code only");
  expect(html).not.toContain("then the other orchestrator");
});

const endpoint = Object.freeze({ baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3.5:4b", contextWindow: 65536 });
function customConnection(saved) {
  const state = saved ? { status: "connected", connected: true, endpoint: { ...endpoint, keySaved: false } } : { status: "not_connected", connected: false };
  return { id: "custom", status: saved ? "connected" : "not_connected", connected: saved, claudeReady: false,
    engineStates: { codex: saved ? state : { status: "not_connected", connected: false }, claude: { status: "not_connected", connected: false }, opencode: state } };
}

it("connects OpenCode to a custom endpoint with the entered address, model and context, and no key", async () => {
  mocks.connections.value.push(customConnection(false));
  const state = mount({ engineId: "opencode", modelValue: "custom", adding: true, selectProvider: false });
  expect(state.engineLabel).toBe("OpenCode");
  expect(state.connected).toBe(false);
  expect(state.models).toEqual([]);
  expect(state.waitLabel).toBe("Checking your model server. Loading the model can take up to 2 minutes.");
  await state.save({ endpoint, key: "", useSavedKey: false });
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ modelProviderId: "custom", engineId: "opencode", apiKey: "", remove: false, useSavedKey: false, endpoint });
});

it("shows a saved custom endpoint's model and its own form with Check and save and Disconnect", async () => {
  mocks.connections.value.push(customConnection(true));
  const state = mount({ engineId: "codex", modelValue: "custom", selectProvider: false });
  expect(state.connected).toBe(true);
  expect(state.models).toEqual([{ id: "qwen3.5:4b", label: "qwen3.5:4b" }]);
  const view = createSSRApp(NativeProviderConnections, { engineId: "codex", modelValue: "custom", selectProvider: false });
  view.use(createVuetify({ ssr: true }));
  const html = await renderToString(view);
  expect(html).toContain("Codex - Custom endpoint");
  expect(html).toContain("Check and save");
  expect(html).toContain("OLLAMA_CONTEXT_LENGTH=65536");
  expect(html).toContain("only the workspace owner can use this custom endpoint");
  expect(html).toContain("Disconnect");
  expect(html).not.toContain("Check and replace key");
});

it("keeps a saved custom endpoint key unless a new one is typed, and refuses a context below 32,768", () => {
  const submitted = [];
  const state = mount({ engineId: "claude", endpoint: { ...endpoint, baseUrl: "http://127.0.0.1:11434", keySaved: true },
    onSubmit: (value) => submitted.push(value) }, CustomEndpointForm);
  expect(state.baseUrl).toBe("http://127.0.0.1:11434");
  expect(state.address.example).toBe("http://127.0.0.1:11434");
  state.submit();
  state.apiKey = " typed-fixture ";
  state.submit();
  expect(submitted).toEqual([
    { apiKey: "", useSavedKey: true, endpoint: { ...endpoint, baseUrl: "http://127.0.0.1:11434" } },
    { apiKey: "typed-fixture", useSavedKey: false, endpoint: { ...endpoint, baseUrl: "http://127.0.0.1:11434" } }
  ]);
  expect(state.canSubmit).toBe(true);
  state.contextWindow = 4096;
  expect(state.contextValid).toBe(false);
  expect(state.canSubmit).toBe(false);
});
