import { createRenderer, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ run: () => mocks.save(options.buildRawPayload().assistantRouting) })
}));
vi.mock("@local/vibe64-accounts/client", () => ({
  ModelRoutingForm: { render: () => null },
  useModelRouting: () => ({ engines: ref([]), loadError: ref(""), resource: { isInitialLoading: ref(false), data: ref({}) } })
}));

import Vibe64ChatModeControls from "../../src/components/studio/vibe64-session/Vibe64ChatModeControls.vue";

const override = { schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex",
  modelProviderId: "deepseek", modelId: "deepseek-flash", variantId: "low", catalogRevision: `sha256:${"a".repeat(64)}` };
let app;
function mount(savePreferences, temporary = false) {
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...Vibe64ChatModeControls, render: () => null }, {
      session: { sessionId: "session-1", metadata: { assistant_routing: JSON.stringify({
        mode: "junior", review: false, workflowEngineId: "codex", override
      }) } }, savePreferences, temporary
    });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
beforeEach(() => { mocks.save.mockReset(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(() => { app?.unmount(); });

for (const temporary of [false, true]) {
  it(`${temporary ? "temporary" : "main"} direct roles retain their custom model; only Auto offers review`, async () => {
    const state = mount(temporary ? mocks.save : undefined, temporary);
    expect(state.modeLabel).toBe("Junior");
    expect(state.reviewAvailable).toBe(false);
    await state.save("junior", true);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "junior", review: !temporary, override });
    await state.save("junior", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "junior", review: false, override });
    await state.save("senior", false);
    expect(mocks.save).toHaveBeenLastCalledWith({ mode: "senior", review: false });
    expect(state.modeLabel).toBe("Senior");
    expect(state.reviewAvailable).toBe(false);
    await state.save("intern", false);
    expect(state.modeLabel).toBe("Intern");
    expect(state.reviewAvailable).toBe(false);
    await state.save("auto", true);
    expect(state.reviewAvailable).toBe(!temporary);
    expect(mocks.save).toHaveBeenLastCalledWith(temporary ? { mode: "intern", review: false } : { mode: "auto", review: true });
    expect(state.modes.map(({ id }) => id)).toEqual(temporary ? ["senior", "junior", "intern"] : ["senior", "junior", "intern", "auto"]);
  });
}

it("a failed switch to Auto keeps the direct role and custom model", async () => {
  const state = mount();
  mocks.save.mockRejectedValueOnce(new Error("Connection interrupted."));
  await state.save("auto", true);
  expect(state.review).toBe(false);
  expect(state.mode).toBe("junior");
  expect(state.saveError).toBe("Connection interrupted.");
  await state.save("auto", true);
  expect(mocks.save).toHaveBeenLastCalledWith({ mode: "auto", review: true });
});
