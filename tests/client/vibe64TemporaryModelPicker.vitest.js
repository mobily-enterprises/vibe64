import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import { createRenderer, defineComponent, h, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({ attrs: null, catalog: null, options: null }));
vi.mock("@/composables/useVibe64AssistantCatalog.js", () => ({
  useVibe64AssistantCatalog(options) {
    picker.options = options;
    return picker.catalog;
  }
}));
vi.mock("@jskit-ai/assistant-core/client/conversation", () => ({
  AssistantModelControl: defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      picker.attrs = attrs;
      return () => h("div");
    }
  })
}));

import Menu from "../../src/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import { normalizeVibe64AgentSettings } from "@local/vibe64-runtime/shared";

const filename = path.resolve("src/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue");
const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
const script = compileScript(descriptor, { id: "temporary-model-picker" });
Menu.render = new Function("Vue", compile(descriptor.template.content, {
  bindingMetadata: script.bindings, mode: "function", prefixIdentifiers: true
}).code)(VueRuntime);

let app;
afterEach(() => app?.unmount());

function mountPicker(engineId = "codex", { loading = false } = {}) {
  const modelProviderId = engineId === "opencode" ? "deepseek" : "openai";
  const nextModel = engineId === "opencode" ? "deepseek-reasoner" : "gpt-6-astra";
  const modelEngine = ref({ engineId, modelProviders: [{
    id: modelProviderId, label: modelProviderId, connected: true, models: [
      { id: "main-model", label: "Main model", status: "available", variants: [{ id: "high", label: "High" }] },
      { id: nextModel, label: nextModel, status: "available", variants: [{ id: "ultra", label: "Ultra" }] },
      { id: "disabled-model", status: "unavailable", variants: [] }
    ]
  }] });
  picker.catalog = {
    modelEngine, modelPage: { isInitialLoading: ref(loading), loadError: ref("") },
    reload: vi.fn()
  };
  const agentSettings = ref({ providerId: engineId, model: "main-model", thinking: "high" });
  const apply = vi.fn((key, value) => {
    agentSettings.value = normalizeVibe64AgentSettings({ ...agentSettings.value, [key]: value });
  });
  app = createRenderer({
    createElement: () => ({}), createComment: () => ({}), insert() {}, remove() {},
    patchProp() {}, parentNode: () => null, nextSibling: () => null
  }).createApp({
    setup: () => () => h(Menu, {
      agentSettings: agentSettings.value,
      assistantSelection: { engineId, modelProviderId, modelId: "main-model", variantId: "high" },
      "onUpdate-setting": apply
    })
  });
  app.component("VBtn", defineComponent({ render: () => null }));
  app.provide(ssrContextKey, {});
  app.mount({});
  return { agentSettings, apply, nextModel, modelProviderId };
}

it.each(["codex", "opencode"])("loads live %s models and applies the chosen model and effort only on Apply", async (engineId) => {
  const { agentSettings, apply, nextModel, modelProviderId } = mountPicker(engineId);
  expect(picker.options.active.value).toBe(false);
  picker.attrs["onUpdate:modelValue"](true);
  await nextTick();
  expect(picker.options.active.value).toBe(true);
  expect(picker.options.engineId.value).toBe(engineId);
  expect(picker.options.modelProviderId.value).toBe(modelProviderId);
  expect(picker.attrs["model-rows"].map(row => row.id)).toEqual(["", "main-model", nextModel]);
  picker.attrs.onSelectModel(nextModel);
  await nextTick();
  expect(picker.attrs["variant-rows"].map(row => row.id)).toEqual(["", "ultra"]);
  expect(picker.attrs["variant-id"]).toBe("");
  picker.attrs.onSelectVariant("ultra");
  await nextTick();
  expect(apply).not.toHaveBeenCalled();
  expect(picker.attrs["can-save"]).toBe(true);
  picker.attrs.onApply();
  await nextTick();
  expect(agentSettings.value).toEqual({ providerId: engineId, model: nextModel, thinking: "ultra" });
  picker.attrs["onUpdate:modelValue"](true);
  await nextTick();
  expect(picker.attrs["model-id"]).toBe(nextModel);
  expect(picker.attrs["variant-id"]).toBe("ultra");
});

it("discards unapplied changes and restores the saved choice with a warm catalogue", async () => {
  const { apply, nextModel } = mountPicker();
  picker.attrs["onUpdate:modelValue"](true);
  await nextTick();
  picker.attrs.onSelectModel(nextModel);
  await nextTick();
  picker.attrs["onUpdate:modelValue"](false);
  await nextTick();
  picker.attrs["onUpdate:modelValue"](true);
  await nextTick();
  expect(picker.attrs["model-id"]).toBe("main-model");
  expect(picker.attrs["variant-id"]).toBe("high");
  expect(apply).not.toHaveBeenCalled();
});

it("shows catalogue loading and failure, permits retry, and blocks removed models", async () => {
  const { apply, nextModel } = mountPicker("codex", { loading: true });
  picker.attrs["onUpdate:modelValue"](true);
  await nextTick();
  expect(picker.attrs["catalog-loading"]).toBe(true);
  expect(picker.attrs["can-save"]).toBe(false);
  picker.catalog.modelPage.isInitialLoading.value = false;
  picker.catalog.modelPage.loadError.value = "Provider unavailable";
  await nextTick();
  expect(picker.attrs["catalog-error"]).toBe("Provider unavailable");
  picker.attrs.onReload();
  expect(picker.catalog.reload).toHaveBeenCalledOnce();
  picker.catalog.modelPage.loadError.value = "";
  await nextTick();
  picker.attrs.onSelectModel(nextModel);
  await nextTick();
  expect(picker.attrs["can-save"]).toBe(true);
  picker.catalog.modelEngine.value.modelProviders[0].models = [];
  await nextTick();
  expect(picker.attrs["can-save"]).toBe(false);
  picker.attrs.onApply();
  expect(apply).not.toHaveBeenCalled();
});
