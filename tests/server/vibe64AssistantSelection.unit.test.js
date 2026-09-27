import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_ASSISTANT_SELECTION_ERROR_CODES,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  assertVibe64AssistantSelectionUpdate,
  defineVibe64AssistantCapabilities,
  resolveVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  vibe64AssistantSelectionLabel,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";

const revision = `sha256:${"a".repeat(64)}`;

test("assistant names share orchestrator, model and saved effort formatting", () => {
  for (const [engineId, modelId, variantId, expected] of [
    ["opencode", "glm-5.3-flash", "high", "OpenCode (glm-5.3-flash high)"],
    ["codex", "gpt-6-astra", "xhigh", "Codex (gpt-6-astra xhigh)"],
    ["claude", "opus", "", "Claude Code (opus default)"],
    ["codex", "gpt-6-astra", undefined, "Codex (gpt-6-astra not recorded)"]
  ]) assert.equal(vibe64AssistantSelectionLabel({ engineId, modelId, variantId }), expected);
});

function capabilities(overrides = {}) {
  return {
    agents: [{ id: "build", label: "Build", mode: "primary" }],
    authentication: { management: "account-owner", modes: ["api-key"] },
    defaults: {
      agentId: "build",
      modelId: "deepseek-chat",
      modelProviderId: "deepseek",
      variantId: "high"
    },
    engineId: "opencode",
    health: { status: "ready" },
    label: "OpenCode",
    modelProviders: [{
      apiKeyCompatible: true,
      connected: true,
      defaultModelId: "deepseek-chat",
      id: "deepseek",
      label: "DeepSeek",
      models: [{
        id: "deepseek-chat",
        label: "DeepSeek Chat",
        status: "available",
        variants: [{ id: "high", label: "High" }]
      }]
    }],
    revision,
    transportId: "opencode_server",
    ...overrides
  };
}

test("assistant capabilities preserve each provider's native default model", () => {
  const defined = defineVibe64AssistantCapabilities(capabilities());

  assert.equal(defined.modelProviders[0].defaultModelId, "deepseek-chat");
  assert.equal(defined.modelProviders[0].apiKeyCompatible, true);
});

test("assistant capabilities preserve preferred-provider and locked-model guidance", () => {
  const value = capabilities();
  value.modelProviders[0] = {
    ...value.modelProviders[0],
    builtIn: true,
    modelAccess: {
      configurable: true,
      enabledModelIds: ["deepseek-chat"],
      label: "Unlock all models",
      managementOnly: true,
      mode: "verified",
      recommendedModelId: "deepseek-chat",
      warning: "Paid credit is required."
    },
    preferred: true,
    models: [
      ...value.modelProviders[0].models,
      {
        id: "deepseek-paid",
        label: "DeepSeek Paid",
        lockMessage: "Unlock paid models first.",
        status: "locked"
      }
    ]
  };
  const defined = defineVibe64AssistantCapabilities(value);

  assert.equal(defined.modelProviders[0].builtIn, true);
  assert.equal(defined.modelProviders[0].preferred, true);
  assert.deepEqual(defined.modelProviders[0].modelAccess.enabledModelIds, ["deepseek-chat"]);
  assert.equal(defined.modelProviders[0].modelAccess.managementOnly, true);
  assert.equal(defined.modelProviders[0].modelAccess.mode, "verified");
  assert.equal(defined.modelProviders[0].models[1].lockMessage, "Unlock paid models first.");
  assert.throws(
    () => resolveVibe64AssistantSelection(value, {
      engineId: "opencode",
      modelId: "deepseek-paid",
      variantId: ""
    }),
    (error) => error.code === VIBE64_ASSISTANT_SELECTION_ERROR_CODES.UNAVAILABLE
  );
});

test("assistant selection resolves omitted fields from one live catalog revision", () => {
  const resolved = resolveVibe64AssistantSelection(capabilities(), {
    engineId: "opencode"
  });

  assert.deepEqual(resolved, {
    agentId: "build",
    catalogRevision: revision,
    engineId: "opencode",
    modelId: "deepseek-chat",
    modelProviderId: "deepseek",
    schema: "vibe64.assistant-selection.v1",
    variantId: "high"
  });
  assert.equal(Object.isFrozen(resolved), true);
});

test("assistant selection rejects stale and unsupported explicit choices", () => {
  assert.throws(
    () => resolveVibe64AssistantSelection(capabilities(), {
      catalogRevision: `sha256:${"b".repeat(64)}`,
      engineId: "opencode"
    }),
    (error) => error.code === VIBE64_ASSISTANT_SELECTION_ERROR_CODES.CATALOG_STALE
  );
  assert.throws(
    () => resolveVibe64AssistantSelection(capabilities(), {
      engineId: "opencode",
      modelId: "invented-model"
    }),
    (error) => (
      error.code === VIBE64_ASSISTANT_SELECTION_ERROR_CODES.UNAVAILABLE &&
      error.details.field === "modelId"
    )
  );
});

test("assistant selection rejects providers that are not connected", () => {
  const disconnected = capabilities({
    modelProviders: [{
      connected: false,
      id: "deepseek",
      label: "DeepSeek",
      models: [{ id: "deepseek-chat", label: "DeepSeek Chat" }]
    }]
  });

  assert.throws(
    () => resolveVibe64AssistantSelection(disconnected, { engineId: "opencode" }),
    (error) => error.code === VIBE64_ASSISTANT_SELECTION_ERROR_CODES.CONNECTION_REQUIRED
  );
});

test("assistant selection round-trips through one durable metadata value", () => {
  const resolved = resolveVibe64AssistantSelection(capabilities(), {});
  const metadata = {
    [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(resolved)
  };

  assert.deepEqual(vibe64AssistantSelectionFromMetadata(metadata), resolved);
  assert.equal(vibe64AssistantSelectionFromMetadata({}, { required: false }), null);
});

test("assistant selection permits between-turn model and engine changes", () => {
  const current = resolveVibe64AssistantSelection(capabilities(), {});
  const changedModel = {
    ...current,
    modelId: "deepseek-reasoner",
    variantId: ""
  };

  assert.deepEqual(assertVibe64AssistantSelectionUpdate(current, changedModel), changedModel);
  assert.equal(
    assertVibe64AssistantSelectionUpdate(current, {
      ...current,
      engineId: "codex"
    }).engineId,
    "codex"
  );
  assert.throws(
    () => assertVibe64AssistantSelectionUpdate(current, changedModel, { turnActive: true }),
    (error) => error.code === VIBE64_ASSISTANT_SELECTION_ERROR_CODES.TURN_ACTIVE
  );
});

test("assistant capability documents reject duplicate upstream ids", () => {
  assert.throws(
    () => defineVibe64AssistantCapabilities(capabilities({
      agents: [
        { id: "build", mode: "primary" },
        { id: "build", mode: "all" }
      ]
    })),
    /Duplicate assistant agent/u
  );
});
