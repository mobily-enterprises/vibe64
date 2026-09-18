import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nextTick, ref, watch } from "vue";

import {
  VIBE64_ASSISTANT_SELECTION_ERROR_CODES,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  assertVibe64AssistantSelectionUpdate,
  defineVibe64AssistantCapabilities,
  resolveVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";

const revision = `sha256:${"a".repeat(64)}`;

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

test("the session model selector shows only available models and normalizes stale choices", async () => {
  const source = await readFile(new URL(
    "../../src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue",
    import.meta.url
  ), "utf8");

  assert.match(source, /import \{ AssistantModelControl \} from "@jskit-ai\/assistant-core\/client\/conversation"/u);
  assert.match(source, /<AssistantModelControl[\s\S]*:model-rows="modelRows"/u);
  assert.match(source, /filter\(\(model\) => model\.status === "available"\)/u);
  assert.match(source, /watch\(\[menuOpen, modelProvider, modelRows\]/u);
  assert.match(source, /model\.id === provider\.defaultModelId/u);
  assert.doesNotMatch(source, /appendIcon: mdiLockOutline/u);
  assert.doesNotMatch(source, /vibe64-session-assistant-menu__option--locked/u);
  assert.match(source, /!modelAccess\.managementOnly/u);
});

test("the session picker recovers a missing provider in its draft without changing the saved session", async () => {
  const source = await readFile(new URL(
    "../../src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue", import.meta.url
  ), "utf8");
  const start = source.indexOf("watch([menuOpen, providerRows,");
  const end = source.indexOf("watch([menuOpen, modelProvider,", start);
  assert.ok(start > 0 && end > start);
  const menuOpen = ref(true);
  const providerRows = ref([{ id: "opencode", preferred: true }]);
  const overviewLoading = ref(true);
  const providerLoading = ref(false);
  const modelProviderId = ref("zai");
  const selectedOverviewEngine = ref({ defaults: { modelProviderId: "zai" } });
  const selections = [];
  let changesDisabled = false;
  const stop = new Function(
    "watch", "menuOpen", "providerRows", "overviewLoading", "providerLoading",
    "modelProviderId", "selectedOverviewEngine", "selectProvider",
    `return ${source.slice(start, end).trim()}`
  )(watch, menuOpen, providerRows, overviewLoading, providerLoading,
    modelProviderId, selectedOverviewEngine, (id) => {
      if (changesDisabled) return;
      modelProviderId.value = id;
      selections.push(id);
    });
  try {
    assert.equal(modelProviderId.value, "zai", "wait for the connected-provider catalog");
    overviewLoading.value = false;
    await nextTick();
    assert.equal(modelProviderId.value, "opencode", "recover even when only one provider is connected");
    assert.deepEqual(selections, ["opencode"]);
    providerRows.value = [{ id: "opencode" }, { id: "another", preferred: true }];
    await nextTick();
    assert.equal(modelProviderId.value, "opencode", "preserve a still-available draft choice");
    menuOpen.value = false;
    modelProviderId.value = "zai";
    await nextTick();
    assert.equal(modelProviderId.value, "zai");
    menuOpen.value = true;
    await nextTick();
    assert.equal(modelProviderId.value, "another", "recover on reopening with a warm catalog");
    changesDisabled = true;
    providerRows.value = [{ id: "opencode" }];
    await nextTick();
    assert.equal(modelProviderId.value, "another", "respect view-only choices during a turn");
    assert.doesNotMatch(source.slice(start, end), /applySelection|updateCommand|\.run\(/u);
    assert.match(source, /Choose an available model and Apply to reconnect/u);
  } finally {
    stop();
  }
});
