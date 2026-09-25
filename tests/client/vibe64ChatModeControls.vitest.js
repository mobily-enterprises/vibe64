import { createRenderer, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: () => mocks.save(options.buildRawPayload().assistantRouting) })
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  ModelRoutingForm: { render: () => null },
  useModelRouting: () => ({ engines: ref([]), loadError: ref(""), resource: { isInitialLoading: ref(false) } })
}));

import Vibe64ChatModeControls from "../../src/components/studio/vibe64-session/Vibe64ChatModeControls.vue";

const override = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
  modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "low", catalogRevision: `sha256:${"a".repeat(64)}` };
let app;
function mount(savePreferences) {
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...Vibe64ChatModeControls, render: () => null }, {
      session: { sessionId: "session-1", metadata: { assistant_routing: JSON.stringify({
        mode: "code", review: false, workflowEngineId: "codex", override
      }) } }, savePreferences
    });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => { mocks.save.mockReset(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(() => { app?.unmount(); });

for (const temporary of [false, true]) {
  it(`${temporary ? "temporary" : "main"} review toggles preserve the custom coder; changing mode clears it`, async () => {
    const state = mount(temporary ? mocks.save : undefined);
    await state.save("code", true);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "code", review: true, override });
    await state.save("code", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "code", review: false, override });
    await state.save("plan", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "plan", review: false });
  });
}

it("a failed review toggle keeps the prior preference and retries the same custom coder", async () => {
  const state = mount();
  mocks.save.mockRejectedValueOnce(new Error("Connection interrupted."));
  await state.save("code", true);
  expect(state.review).toBe(false);
  expect(state.mode).toBe("code");
  expect(state.saveError).toBe("Connection interrupted.");
  await state.save("code", true);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "code", review: true, override });
});
