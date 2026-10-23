import { createRenderer, ssrContextKey } from "vue";
import { afterEach, expect, it } from "vitest";
import AiPersonalUse, { personalUsePlan } from "../../packages/vibe64-accounts/src/client/studio/AiPersonalUse.vue";

let app;
function mount(props) {
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...AiPersonalUse, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
afterEach(() => { app?.unmount(); });

it("names the provider whose terms make each personal plan personal", () => {
  expect(personalUsePlan("anthropic")).toEqual({ provider: "Anthropic", plan: "Claude subscription (Pro or Max)" });
  expect(personalUsePlan("openai")).toEqual({ provider: "OpenAI", plan: "ChatGPT subscription" });
  expect(personalUsePlan("zai-coding-plan")).toEqual({ provider: "Z.AI", plan: "GLM Coding Plan" });
  expect(personalUsePlan("unknown")).toEqual({ provider: "the provider", plan: "plan" });
});

it("opens its explanation for the given provider", () => {
  const state = mount({ providerId: "zai-coding-plan" });
  expect(state.open).toBe(false);
  expect(state.plan.provider).toBe("Z.AI");
  state.open = true;
  expect(state.open).toBe(true);
});
