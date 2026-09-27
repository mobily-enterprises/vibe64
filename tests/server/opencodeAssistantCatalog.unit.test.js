import assert from "node:assert/strict";
import test from "node:test";

import {
  openCodeAssistantCapabilities,
  openCodeConfiguredAssistantCapabilities
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js";

function provider(id, {
  apiKeyCompatible = true,
  modelCount = 2,
  name = id
} = {}) {
  return {
    apiKeyCompatible,
    id,
    models: Object.fromEntries(Array.from({ length: modelCount }, (_, index) => {
      const modelId = `${id}-model-${String(index + 1).padStart(2, "0")}`;
      return [modelId, {
        capabilities: {
          attachment: index === 0,
          reasoning: true,
          toolcall: true
        },
        family: `${id} family`,
        id: modelId,
        limit: { context: 200_000, output: 32_000 },
        name: `${name} Model ${index + 1}`,
        status: index === modelCount - 1 && modelCount > 2 ? "deprecated" : "active",
        variants: {
          high: {},
          low: {}
        }
      }];
    })),
    name,
    source: "env"
  };
}

const agents = [
  {
    description: "Make changes",
    hidden: false,
    mode: "primary",
    name: "build"
  },
  {
    description: "Provider-specific agent",
    hidden: false,
    mode: "all",
    model: {
      modelID: "deepseek-model-01",
      providerID: "deepseek"
    },
    name: "deepseek-build",
    variant: "high"
  },
  {
    hidden: true,
    mode: "primary",
    name: "vibe64-helper"
  },
  {
    hidden: false,
    mode: "subagent",
    name: "explore"
  }
];

test("configured OpenCode choices come only from saved Vibe64 connections", () => {
  const result = openCodeConfiguredAssistantCapabilities({
    connections: [{
      accessLabel: "Workspace use",
      billingLabel: "Usage-based API billing",
      connected: true,
      defaultModelId: "deepseek-v4-flash",
      fingerprint: `sha256:${"1".repeat(64)}`,
      modelProviderId: "deepseek",
      productLabel: "DeepSeek",
      providerRevision: `sha256:${"2".repeat(64)}`
    }, {
      accessLabel: "Personal use",
      billingLabel: "Coding Plan quota",
      connected: true,
      defaultModelId: "glm-5.3-flash",
      fingerprint: `sha256:${"3".repeat(64)}`,
      modelProviderId: "zai-coding-plan",
      productLabel: "GLM · Personal Coding Plan",
      providerRevision: `sha256:${"4".repeat(64)}`
    }]
  });

  assert.equal(result.health.status, "ready");
  assert.deepEqual(result.modelProviders.map(({ id }) => id), [
    "deepseek",
    "zai-coding-plan"
  ]);
  assert.deepEqual(result.modelProviders[1], {
    apiKeyCompatible: true,
    builtIn: false,
    connected: true,
    connectionMessage: "",
    connectionStatus: "connected",
    defaultModelId: "glm-5.3-flash",
    definitionRevision: `sha256:${"4".repeat(64)}`,
    description: "Coding Plan quota · Personal use",
    id: "zai-coding-plan",
    label: "GLM · Personal Coding Plan",
    modelAccess: {},
    models: [{
      capabilities: {},
      description: "Saved default model",
      id: "glm-5.3-flash",
      label: "glm-5.3-flash",
      status: "available",
      variants: []
    }],
    preferred: false
  });
  assert.deepEqual(result.defaults, {
    agentId: "build",
    modelId: "deepseek-v4-flash",
    modelProviderId: "deepseek",
    variantId: ""
  });
  assert.match(result.revision, /^sha256:[a-f0-9]{64}$/u);
});

test("configured OpenCode choices put the host-preferred free provider first", () => {
  const result = openCodeConfiguredAssistantCapabilities({
    connections: [{
      connected: true,
      defaultModelId: "big-pickle",
      modelProviderId: "opencode",
      preferred: false,
      productLabel: "OpenCode Zen"
    }, {
      connected: true,
      defaultModelId: "glm-4.7-flash",
      modelProviderId: "zai",
      preferred: true,
      productLabel: "Z.AI"
    }]
  });

  assert.deepEqual(result.modelProviders.map(({ id }) => id), ["zai", "opencode"]);
  assert.equal(result.defaults.modelProviderId, "zai");
  assert.equal(result.defaults.modelId, "glm-4.7-flash");
});

test("Zen exposes only current live models and a real key unlocks all of them", () => {
  const zen = provider("opencode", { name: "OpenCode Zen" });
  zen.models["removed-model"] = {
    capabilities: { reasoning: true, toolcall: true },
    family: "retired",
    id: "removed-model",
    name: "Removed model",
    status: "active"
  };
  zen.models["big-pickle"] = {
    capabilities: { reasoning: true, toolcall: true },
    family: "GLM",
    id: "big-pickle",
    name: "Big Pickle",
    status: "active"
  };
  const disconnected = openCodeAssistantCapabilities({
    agents,
    providers: {
      all: [zen],
      default: { opencode: "opencode-model-01" }
    },
    zenModelIds: ["big-pickle", "live-model-without-native-metadata", "opencode-model-01", "opencode-model-02"]
  });
  const connected = openCodeAssistantCapabilities({
    agents,
    connections: [{
      builtIn: true,
      connected: true,
      defaultModelId: "big-pickle",
      fingerprint: "sha256:public",
      modelAccess: {
        configurable: false,
        mode: "recommended",
        recommendedModelId: "big-pickle",
        warning: "Add a Zen key."
      },
      modelProviderId: "opencode",
      preferred: true,
      providerRevision: ""
    }],
    providers: {
      all: [zen],
      default: { opencode: "opencode-model-01" }
    },
    zenModelIds: ["big-pickle", "live-model-without-native-metadata", "opencode-model-01", "opencode-model-02"]
  });
  const row = connected.modelProviders[0];

  assert.equal(disconnected.modelProviders[0].connected, false);
  assert.equal(row.connected, true);
  assert.equal(row.connectionStatus, "connected");
  assert.equal(row.definitionRevision, disconnected.modelProviders[0].definitionRevision);
  assert.equal(row.defaultModelId, "big-pickle");
  assert.equal(row.preferred, true);
  assert.equal(row.models.find(({ id }) => id === "big-pickle").status, "available");
  assert.equal(row.models.find(({ id }) => id === "opencode-model-01").status, "locked");
  assert.equal(row.models.find(({ id }) => id === "opencode-model-01").lockMessage, "Add a Zen key.");
  assert.equal(row.models.find(({ id }) => id === "live-model-without-native-metadata").status, "locked");
  assert.equal(row.models.some(({ id }) => id === "removed-model"), false);
  assert.equal(connected.defaults.modelProviderId, "opencode");
  assert.equal(connected.defaults.modelId, "big-pickle");

  const checked = openCodeAssistantCapabilities({
    agents,
    connections: [{
      connected: true,
      defaultModelId: "big-pickle",
      fingerprint: "sha256:real-key",
      modelAccess: {
        configurable: true,
        enabledModelIds: ["big-pickle", "opencode-model-01"],
        managementOnly: true,
        mode: "verified",
        recommendedModelId: "big-pickle"
      },
      modelProviderId: "opencode",
      providerRevision: disconnected.modelProviders[0].definitionRevision
    }],
    providers: {
      all: [zen],
      default: { opencode: "opencode-model-01" }
    },
    zenModelIds: ["big-pickle", "live-model-without-native-metadata", "opencode-model-01", "opencode-model-02"]
  });
  assert.equal(checked.modelProviders[0].models.find(({ id }) => id === "opencode-model-01").status, "available");
  assert.equal(checked.modelProviders[0].models.find(({ id }) => id === "opencode-model-02").status, "locked");
  assert.equal(checked.modelProviders[0].models.find(({ id }) => id === "live-model-without-native-metadata").status, "locked");

  const unlocked = openCodeAssistantCapabilities({
    agents,
    connections: [{
      connected: true,
      defaultModelId: "big-pickle",
      fingerprint: "sha256:real-key",
      modelAccess: {
        configurable: true,
        mode: "all",
        recommendedModelId: "big-pickle"
      },
      modelProviderId: "opencode",
      providerRevision: disconnected.modelProviders[0].definitionRevision
    }],
    providers: {
      all: [zen],
      default: { opencode: "opencode-model-01" }
    },
    zenModelIds: ["big-pickle", "live-model-without-native-metadata", "opencode-model-01", "opencode-model-02"]
  });
  assert.equal(unlocked.modelProviders[0].models.every(({ status }) => status === "available"), true);
});

test("OpenCode catalog searches and pages providers without exposing hidden agents", () => {
  const all = Array.from({ length: 31 }, (_, index) => provider(
    `provider-${String(index + 1).padStart(2, "0")}`,
    { name: `Provider ${String(index + 1).padStart(2, "0")}` }
  ));
  const first = openCodeAssistantCapabilities({
    agents,
    input: { limit: 10 },
    providers: { all, default: {} }
  });
  assert.equal(first.page.total, 31);
  assert.equal(first.modelProviders.length, 10);
  assert.equal(first.page.hasMore, true);
  assert.ok(first.page.nextCursor);
  assert.deepEqual(first.agents.map(({ id }) => id), ["build", "deepseek-build"]);

  const second = openCodeAssistantCapabilities({
    agents,
    input: { cursor: first.page.nextCursor, limit: 10 },
    providers: { all, default: {} }
  });
  assert.equal(second.modelProviders[0].id, "provider-11");

  const searched = openCodeAssistantCapabilities({
    agents,
    input: { search: "provider 29" },
    providers: { all, default: {} }
  });
  assert.deepEqual(searched.modelProviders.map(({ id }) => id), ["provider-29"]);
  assert.throws(
    () => openCodeAssistantCapabilities({
      agents,
      input: { cursor: first.page.nextCursor, modelProviderId: "provider-01" },
      providers: { all, default: {} }
    }),
    (error) => error?.code === "vibe64_assistant_catalog_cursor_invalid"
  );
});

test("OpenCode catalog can page only providers with current connections", () => {
  const all = Array.from({ length: 31 }, (_, index) => provider(
    `provider-${String(index + 1).padStart(2, "0")}`,
    { name: `Provider ${String(index + 1).padStart(2, "0")}` }
  ));
  const definitions = openCodeAssistantCapabilities({
    agents,
    input: { limit: 100 },
    providers: { all, default: {} }
  });
  const connectedIds = ["provider-02", "provider-31"];
  const connections = connectedIds.map((id) => ({
    modelProviderId: id,
    providerRevision: definitions.modelProviders.find((candidate) => candidate.id === id).definitionRevision
  }));

  const connected = openCodeAssistantCapabilities({
    agents,
    connections,
    input: { connectedOnly: "true", limit: 1 },
    providers: { all, default: {} }
  });
  const next = openCodeAssistantCapabilities({
    agents,
    connections,
    input: {
      connectedOnly: "true",
      cursor: connected.page.nextCursor,
      limit: 1
    },
    providers: { all, default: {} }
  });

  assert.equal(connected.page.total, 2);
  assert.deepEqual(connected.modelProviders.map(({ id }) => id), ["provider-02"]);
  assert.deepEqual(next.modelProviders.map(({ id }) => id), ["provider-31"]);
});

test("OpenCode catalog requires reconfirmation when a live provider definition changes", () => {
  const deepseek = provider("deepseek", { modelCount: 3, name: "DeepSeek" });
  const providerResult = {
    all: [deepseek],
    default: { deepseek: "deepseek-model-01" }
  };
  const disconnected = openCodeAssistantCapabilities({
    agents,
    providers: providerResult
  });
  const definitionRevision = disconnected.modelProviders[0].definitionRevision;
  const connected = openCodeAssistantCapabilities({
    agents,
    connections: [{
      fingerprint: "sha256:key-a",
      modelProviderId: "deepseek",
      providerRevision: definitionRevision
    }],
    providers: providerResult
  });
  assert.equal(connected.health.status, "ready");
  assert.equal(connected.modelProviders[0].apiKeyCompatible, true);
  assert.equal(connected.modelProviders[0].connected, true);
  assert.equal(connected.modelProviders[0].defaultModelId, "deepseek-model-01");
  assert.equal(connected.modelProviders[0].models[0].capabilities.contextWindow, 200_000);
  assert.equal(connected.modelProviders[0].models[0].capabilities.maxOutputTokens, 32_000);
  assert.deepEqual(connected.defaults, {
    agentId: "build",
    modelId: "deepseek-model-01",
    modelProviderId: "deepseek",
    variantId: ""
  });

  const changedProviderResult = {
    all: [provider("deepseek", { modelCount: 4, name: "DeepSeek" })],
    default: { deepseek: "deepseek-model-01" }
  };
  const stale = openCodeAssistantCapabilities({
    agents,
    connections: [{
      fingerprint: "sha256:key-a",
      modelProviderId: "deepseek",
      providerRevision: definitionRevision
    }],
    providers: changedProviderResult
  });
  assert.equal(stale.health.status, "unavailable");
  assert.equal(stale.modelProviders[0].connected, false);
  assert.equal(stale.modelProviders[0].connectionStatus, "reconfirmation-required");
  assert.notEqual(stale.modelProviders[0].definitionRevision, definitionRevision);
  assert.notEqual(stale.revision, connected.revision);
});

test("Zen model rotation does not disconnect its saved key or Big Pickle", () => {
  const zen = provider("opencode", { modelCount: 3, name: "OpenCode Zen" });
  zen.models["big-pickle"] = {
    capabilities: { reasoning: true, toolcall: true },
    family: "GLM",
    id: "big-pickle",
    name: "Big Pickle",
    status: "active"
  };
  const result = openCodeAssistantCapabilities({
    agents,
    connections: [{
      defaultModelId: "big-pickle",
      fingerprint: "sha256:key-a",
      modelAccess: {
        enabledModelIds: ["big-pickle"],
        mode: "verified",
        recommendedModelId: "big-pickle"
      },
      modelProviderId: "opencode",
      providerRevision: `sha256:${"0".repeat(64)}`
    }],
    input: { connectedOnly: "true" },
    providers: {
      all: [zen],
      default: { opencode: "big-pickle" }
    },
    zenModelIds: ["big-pickle", "opencode-model-01", "opencode-model-02"]
  });

  assert.equal(result.modelProviders.length, 1);
  assert.equal(result.modelProviders[0].connected, true);
  assert.equal(result.modelProviders[0].connectionStatus, "connected");
  assert.equal(result.modelProviders[0].defaultModelId, "big-pickle");
  assert.equal(result.modelProviders[0].models.find(({ id }) => id === "big-pickle").status, "available");
});

test("OpenCode includes API-key compatibility in provider definition revisions", () => {
  const compatible = openCodeAssistantCapabilities({
    agents,
    providers: {
      all: [provider("ordinary")],
      default: { ordinary: "ordinary-model-01" }
    }
  });
  const incompatible = openCodeAssistantCapabilities({
    agents,
    providers: {
      all: [provider("ordinary", { apiKeyCompatible: false })],
      default: { ordinary: "ordinary-model-01" }
    }
  });

  assert.equal(compatible.modelProviders[0].apiKeyCompatible, true);
  assert.equal(incompatible.modelProviders[0].apiKeyCompatible, false);
  assert.notEqual(
    compatible.modelProviders[0].definitionRevision,
    incompatible.modelProviders[0].definitionRevision
  );
  assert.notEqual(compatible.revision, incompatible.revision);
});

test("OpenCode exposes only valid native defaults for arbitrary disconnected providers", () => {
  const arbitrary = provider("community-provider", {
    modelCount: 3,
    name: "Community Provider"
  });
  const valid = openCodeAssistantCapabilities({
    agents,
    providers: {
      all: [arbitrary],
      default: { "community-provider": "community-provider-model-01" }
    }
  });
  const foreign = openCodeAssistantCapabilities({
    agents,
    providers: {
      all: [arbitrary],
      default: { "community-provider": "another-provider-model-01" }
    }
  });
  const unavailable = openCodeAssistantCapabilities({
    agents,
    providers: {
      all: [arbitrary],
      default: { "community-provider": "community-provider-model-03" }
    }
  });

  assert.equal(valid.modelProviders[0].connectionStatus, "disconnected");
  assert.equal(valid.modelProviders[0].defaultModelId, "community-provider-model-01");
  assert.equal(foreign.modelProviders[0].defaultModelId, "");
  assert.equal(unavailable.modelProviders[0].defaultModelId, "");
});

test("OpenCode catalog pages and searches one provider's live model list", () => {
  const deepseek = provider("deepseek", { modelCount: 30, name: "DeepSeek" });
  const initial = openCodeAssistantCapabilities({
    agents,
    input: { modelProviderId: "deepseek", limit: 7 },
    providers: { all: [deepseek], default: {} }
  });
  assert.equal(initial.page.kind, "models");
  assert.equal(initial.page.total, 30);
  assert.equal(initial.modelProviders[0].models.length, 7);
  assert.equal(initial.page.hasMore, true);

  const searched = openCodeAssistantCapabilities({
    agents,
    input: {
      modelProviderId: "deepseek",
      search: "model 24"
    },
    providers: { all: [deepseek], default: {} }
  });
  assert.deepEqual(
    searched.modelProviders[0].models.map(({ id }) => id),
    ["deepseek-model-24"]
  );
});
