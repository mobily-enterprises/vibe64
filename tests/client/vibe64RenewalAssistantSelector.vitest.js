import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ref,
  ssrContextKey
} from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectorHarness = vi.hoisted(() => ({
  calls: [],
  details: null,
  manageAis: vi.fn(),
  overview: null,
  useCatalog: vi.fn()
}));

vi.mock("@/composables/useVibe64AssistantCatalog.js", () => ({
  useVibe64AssistantCatalog: selectorHarness.useCatalog
}));

vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({
  requestVibe64AccountConnectionsDialog: selectorHarness.manageAis
}));

vi.mock("vuetify/components/VAlert", () => ({
  VAlert: passthroughComponent("aside")
}));
vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));
vi.mock("vuetify/components/VSelect", () => ({
  VSelect: passthroughComponent("select")
}));
vi.mock("vuetify/components/VSkeletonLoader", () => ({
  VSkeletonLoader: passthroughComponent("div")
}));
// SelectField's own template is compiled for SSR here, like every SFC this file does not recompile; the fields'
// bindings, loading included, are what this component owns.
vi.mock("@jskit-ai/http-web/client/components/SelectField", () => ({
  default: passthroughComponent("select")
}));

import Vibe64RenewalAssistantSelector from "../../src/components/studio/vibe64-session/Vibe64RenewalAssistantSelector.vue";

const componentPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64RenewalAssistantSelector.vue"
);
const componentSource = fs.readFileSync(componentPath, "utf8");
const { descriptor } = parse(componentSource, { filename: componentPath });
const componentScript = compileScript(descriptor, {
  id: "vibe64-renewal-assistant-selector-test"
});
const componentTemplate = compile(descriptor.template.content, {
  bindingMetadata: componentScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64RenewalAssistantSelector.render = new Function(
  "Vue",
  componentTemplate.code
)(VueRuntime);

const CODEX_REVISION = `sha256:${"a".repeat(64)}`;
const OPENCODE_REVISION = `sha256:${"b".repeat(64)}`;

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function resource({ loading = false } = {}) {
  return {
    isInitialLoading: ref(loading),
    isLoading: ref(loading),
    loadError: ref(""),
    reload: vi.fn(async () => null)
  };
}

function codexEngine() {
  return {
    agents: [{ id: "codex", label: "Codex", mode: "primary" }],
    defaults: {
      agentId: "codex",
      modelId: "gpt-5.6",
      modelProviderId: "openai",
      variantId: "high"
    },
    engineId: "codex",
    health: { status: "ready" },
    label: "Codex",
    modelProviders: [{
      connected: true,
      defaultModelId: "gpt-5.6",
      id: "openai",
      label: "OpenAI",
      preferred: true,
      models: [{
        id: "gpt-5.6",
        label: "GPT-5.6",
        status: "available",
        variants: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" }
        ]
      }]
    }],
    revision: CODEX_REVISION
  };
}

function openCodeEngine({ providerId = "zai" } = {}) {
  const providers = [{
    connected: true,
    defaultModelId: "glm-4.7-flash",
    id: "zai",
    label: "Z.AI",
    preferred: true,
    models: [{
      id: "glm-4.7-flash",
      label: "GLM-4.7 Flash",
      status: "available",
      variants: []
    }]
  }, {
    connected: true,
    defaultModelId: "deepseek-chat",
    id: "deepseek",
    label: "DeepSeek",
    models: [{
      id: "deepseek-chat",
      label: "DeepSeek Chat",
      status: "available",
      variants: [{ id: "high", label: "High" }]
    }, {
      id: "deepseek-reasoner",
      label: "DeepSeek Reasoner",
      status: "available",
      variants: [{ id: "high", label: "High" }]
    }]
  }];
  return {
    agents: [{ id: "build", label: "Build", mode: "primary" }],
    defaults: {
      agentId: "build",
      modelId: "glm-4.7-flash",
      modelProviderId: "zai",
      variantId: ""
    },
    engineId: "opencode",
    health: { status: "ready" },
    label: "OpenCode",
    modelProviders: providers.filter((provider) => (
      providerId === "all" || provider.id === providerId
    )),
    revision: OPENCODE_REVISION
  };
}

function createCatalogs({ loading = false } = {}) {
  const overviewResource = resource({ loading });
  const detailsOverviewResource = resource({ loading });
  const providerPage = resource({ loading });
  const modelPage = resource({ loading });
  return {
    details: {
      modelEngine: ref(null),
      modelPage,
      overview: detailsOverviewResource,
      providerEngine: ref(null),
      providerPage,
      reload: vi.fn(async () => null),
      selectedOverviewEngine: ref(null)
    },
    overview: {
      engines: ref([]),
      overview: overviewResource,
      reload: vi.fn(async () => null)
    }
  };
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ children: [], props: {}, text, type: "comment" }),
    createElement: (type) => ({ children: [], parent: null, props: {}, type }),
    createText: (text) => ({ children: [], props: {}, text, type: "text" }),
    insert(child, parent, anchor = null) {
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) {
        parent.children.push(child);
      } else {
        parent.children.splice(index, 0, child);
      }
    },
    nextSibling(node) {
      const index = node.parent?.children?.indexOf(node) ?? -1;
      return index >= 0 ? node.parent.children[index + 1] || null : null;
    },
    parentNode: (node) => node.parent,
    patchProp(element, key, _previous, value) {
      element.props[key] = value;
    },
    remove(child) {
      const index = child.parent?.children?.indexOf(child) ?? -1;
      if (index >= 0) {
        child.parent.children.splice(index, 1);
      }
    },
    setElementText(element, text) {
      element.text = text;
    },
    setText(node, text) {
      node.text = text;
    }
  });
}

function findNode(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function findField(root, label) {
  return findNode(root, (node) => node.type === "select" && node.props?.label === label);
}

function mountSelector(initialSelection) {
  const container = { children: [], parent: null, props: {}, type: "root" };
  const readiness = [];
  const selections = [];
  const app = testRenderer().createApp(Vibe64RenewalAssistantSelector, {
    active: true,
    initialSelection,
    "onUpdate:ready": (value) => readiness.push(value),
    "onUpdate:selection": (value) => selections.push(value)
  });
  app.component("VAlert", passthroughComponent("aside"));
  app.component("VBtn", passthroughComponent("button"));
  app.component("VSelect", passthroughComponent("select"));
  app.component("VSkeletonLoader", passthroughComponent("div"));
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return { app, container, readiness, selections };
}

async function settle() {
  await nextTick();
  await nextTick();
  await nextTick();
}

beforeEach(() => {
  selectorHarness.calls = [];
  selectorHarness.manageAis.mockReset();
  const catalogs = createCatalogs({ loading: true });
  selectorHarness.details = catalogs.details;
  selectorHarness.overview = catalogs.overview;
  selectorHarness.useCatalog.mockReset();
  selectorHarness.useCatalog.mockImplementation((options) => {
    selectorHarness.calls.push(options);
    return options.configuredOnly === true
      ? selectorHarness.overview
      : selectorHarness.details;
  });
});

describe("Vibe64RenewalAssistantSelector", () => {
  it("keeps the current assistant while the live catalogs load, then refreshes its revision", async () => {
    const initialSelection = {
      agentId: "codex",
      catalogRevision: `sha256:${"f".repeat(64)}`,
      engineId: "codex",
      modelId: "gpt-5.6",
      modelProviderId: "openai",
      variantId: "high"
    };
    const mounted = mountSelector(initialSelection);

    expect(selectorHarness.calls[1].engineId.value).toBe("codex");
    expect(selectorHarness.calls[1].modelProviderId.value).toBe("openai");
    expect(mounted.readiness.at(-1)).toBe(false);

    const codex = codexEngine();
    selectorHarness.overview.engines.value = [codex, openCodeEngine({ providerId: "all" })];
    selectorHarness.details.selectedOverviewEngine.value = codex;
    selectorHarness.details.modelEngine.value = codex;
    selectorHarness.overview.overview.isInitialLoading.value = false;
    selectorHarness.overview.overview.isLoading.value = false;
    selectorHarness.details.overview.isInitialLoading.value = false;
    selectorHarness.details.overview.isLoading.value = false;
    selectorHarness.details.providerPage.isInitialLoading.value = false;
    selectorHarness.details.providerPage.isLoading.value = false;
    selectorHarness.details.modelPage.isInitialLoading.value = false;
    selectorHarness.details.modelPage.isLoading.value = false;
    await settle();

    expect(findField(mounted.container, "AI").props["model-value"]).toBe("codex");
    expect(findField(mounted.container, "Model").props["model-value"]).toBe("gpt-5.6");
    expect(findField(mounted.container, "Model").props.loading).toBe(false);
    expect(mounted.selections.at(-1)).toEqual({
      ...initialSelection,
      catalogRevision: CODEX_REVISION
    });
    expect(mounted.readiness.at(-1)).toBe(true);
    mounted.app.unmount();
  });

  it("ignores an inactive OpenCode catalogue error when Codex is selected", async () => {
    const codex = codexEngine();
    selectorHarness.overview.engines.value = [codex, openCodeEngine({ providerId: "all" })];
    selectorHarness.details.selectedOverviewEngine.value = codex;
    selectorHarness.details.modelEngine.value = codex;
    selectorHarness.details.providerPage.loadError.value = "OpenCode did not become ready.";
    for (const item of [
      selectorHarness.overview.overview,
      selectorHarness.details.overview,
      selectorHarness.details.providerPage,
      selectorHarness.details.modelPage
    ]) {
      item.isInitialLoading.value = false;
      item.isLoading.value = false;
    }
    const mounted = mountSelector({
      agentId: "codex",
      catalogRevision: CODEX_REVISION,
      engineId: "codex",
      modelId: "gpt-5.6",
      modelProviderId: "openai",
      variantId: "high"
    });
    await settle();

    expect(findField(mounted.container, "Model").props["model-value"]).toBe("gpt-5.6");
    expect(mounted.readiness.at(-1)).toBe(true);
    mounted.app.unmount();
  });

  it("emits the exact engine, provider, model, and thinking chosen for the successor", async () => {
    const codex = codexEngine();
    const openCodeProviders = openCodeEngine({ providerId: "all" });
    selectorHarness.overview.engines.value = [codex, openCodeProviders];
    selectorHarness.details.selectedOverviewEngine.value = codex;
    selectorHarness.details.modelEngine.value = codex;
    for (const item of [
      selectorHarness.overview.overview,
      selectorHarness.details.overview,
      selectorHarness.details.providerPage,
      selectorHarness.details.modelPage
    ]) {
      item.isInitialLoading.value = false;
      item.isLoading.value = false;
    }
    const mounted = mountSelector({
      agentId: "codex",
      catalogRevision: CODEX_REVISION,
      engineId: "codex",
      modelId: "gpt-5.6",
      modelProviderId: "openai",
      variantId: "medium"
    });
    await settle();

    selectorHarness.details.overview.isLoading.value = true;
    selectorHarness.details.providerPage.isLoading.value = true;
    selectorHarness.details.modelPage.isLoading.value = true;
    findField(mounted.container, "AI").props["onUpdate:modelValue"]("opencode");
    await settle();

    selectorHarness.details.selectedOverviewEngine.value = openCodeProviders;
    selectorHarness.details.providerEngine.value = openCodeProviders;
    selectorHarness.details.overview.isLoading.value = false;
    selectorHarness.details.providerPage.isLoading.value = false;
    await settle();
    expect(selectorHarness.calls[1].modelProviderId.value).toBe("zai");

    selectorHarness.details.modelEngine.value = openCodeEngine({ providerId: "zai" });
    selectorHarness.details.modelPage.isLoading.value = false;
    await settle();
    expect(mounted.selections.at(-1)).toMatchObject({
      agentId: "build",
      engineId: "opencode",
      modelId: "glm-4.7-flash",
      modelProviderId: "zai",
      variantId: ""
    });

    selectorHarness.details.modelPage.isLoading.value = true;
    findField(mounted.container, "Provider").props["onUpdate:modelValue"]("deepseek");
    await settle();
    expect(findField(mounted.container, "Model").props.loading).toBe(true);
    selectorHarness.details.modelEngine.value = openCodeEngine({ providerId: "deepseek" });
    selectorHarness.details.modelPage.isLoading.value = false;
    await settle();
    expect(findField(mounted.container, "Model").props.loading).toBe(false);
    findField(mounted.container, "Model").props["onUpdate:modelValue"]("deepseek-reasoner");
    await settle();
    findField(mounted.container, "Thinking").props["onUpdate:modelValue"]("high");
    await settle();

    expect(mounted.selections.at(-1)).toEqual({
      agentId: "build",
      catalogRevision: OPENCODE_REVISION,
      engineId: "opencode",
      modelId: "deepseek-reasoner",
      modelProviderId: "deepseek",
      variantId: "high"
    });
    expect(mounted.readiness.at(-1)).toBe(true);
    mounted.app.unmount();
  });
});
