import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUILT_IN_OPENCODE_API_KEY,
  connectionFingerprint,
  createAiConnectionStore
} from "../../packages/vibe64-accounts/src/server/aiConnectionStore.js";

const revisionA = `sha256:${"a".repeat(64)}`;
const revisionB = `sha256:${"b".repeat(64)}`;

function provider(id, {
  defaultModelId = `${id}-default`,
  label = id,
  revision = revisionA
} = {}) {
  return {
    defaultModelId,
    definitionRevision: revision,
    id,
    label,
    models: [{ id: defaultModelId, status: "available" }]
  };
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-ai-connections-"));
  const filePath = path.join(root, "private", "connections.json");
  const verificationCalls = [];
  t.after(() => rm(root, { force: true, recursive: true }));
  return {
    filePath,
    verificationCalls,
    store: createAiConnectionStore({
      filePath,
      async verifyConnection(input) {
        verificationCalls.push(input);
        return { ok: true };
      },
      ...options
    })
  };
}

test("Big Pickle is always available through the built-in public OpenCode connection", async (t) => {
  const { store, verificationCalls } = await fixture(t);
  const [included] = await store.listConnections();

  assert.equal(included.id, "opencode");
  assert.equal(included.builtIn, true);
  assert.equal(included.economyModelId, "big-pickle");
  assert.equal(included.keyHint, "Included");
  assert.equal(included.preferred, true);
  assert.equal(included.removable, false);
  assert.equal(included.modelAccess.mode, "recommended");
  assert.equal((await store.resolveConnection("opencode")).apiKey, BUILT_IN_OPENCODE_API_KEY);
  assert.equal((await store.assistantAccess("opencode", { modelId: "big-pickle" })).available, true);
  assert.equal((await store.assistantAccess("opencode", { modelId: "other-zen-model" })).available, false);
  assert.deepEqual(await store.removeConnection("opencode"), {
    connected: true,
    id: "opencode",
    ok: true,
    removed: false
  });
  assert.deepEqual(verificationCalls, []);
});

test("a real Zen key starts with Big Pickle and supports explicit all-or-Pickle access", async (t) => {
  const changes = [];
  const { store } = await fixture(t, {
    onConnectionChanged(change) {
      changes.push(change);
    }
  });
  const opencode = provider("opencode", {
    defaultModelId: "big-pickle",
    label: "OpenCode Zen"
  });

  const saved = await store.upsertConnection({
    apiKey: "real-zen-key",
    modelProviderId: "opencode",
    providerRevision: revisionA
  }, { provider: opencode });
  assert.equal(saved.builtIn, false);
  assert.equal(saved.modelAccess.mode, "recommended");
  assert.deepEqual(saved.modelAccess.enabledModelIds, ["big-pickle"]);
  assert.equal(saved.modelAccess.managementOnly, true);
  assert.equal((await store.assistantAccess("opencode", { modelId: "another-model" })).available, false);

  const all = await store.updateModelAccess("opencode", { operation: "enable-all" });
  assert.equal(all.modelAccess.mode, "all");
  assert.equal((await store.assistantAccess("opencode", { modelId: "another-model" })).available, true);

  const pickleOnly = await store.updateModelAccess("opencode", { operation: "disable-additional" });
  assert.equal(pickleOnly.modelAccess.mode, "recommended");
  assert.equal((await store.assistantAccess("opencode", { modelId: "another-model" })).available, false);

  await assert.rejects(
    store.upsertConnection({
      apiKey: "public",
      modelProviderId: "opencode",
      providerRevision: revisionA
    }, { provider: opencode }),
    (error) => error.code === "vibe64_ai_public_key_already_included"
  );

  const removed = await store.removeConnection("opencode");
  assert.equal(removed.reverted, true);
  assert.equal((await store.resolveConnection("opencode")).apiKey, "public");
  assert.equal((await store.listConnections()).find(({ id }) => id === "opencode").builtIn, true);
  assert.deepEqual(changes, [
    { modelProviderId: "opencode", reason: "created" },
    { modelProviderId: "opencode", reason: "model-access-updated" },
    { modelProviderId: "opencode", reason: "model-access-updated" },
    { modelProviderId: "opencode", reason: "reverted" }
  ]);
});

test("Zen checks models sequentially in the background and enables only confirmed models", async (t) => {
  const verificationCalls = [];
  const { store } = await fixture(t, {
    async readModelIds() {
      return ["retry-model", "big-pickle", "working-model", "rejected-model"];
    },
    async verifyConnection(input) {
      verificationCalls.push(input.modelId);
      if (input.modelId === "rejected-model") {
        throw Object.assign(new Error("rejected"), { statusCode: 422 });
      }
      if (input.modelId === "retry-model") {
        throw Object.assign(new Error("temporary"), { retryable: true, statusCode: 503 });
      }
      return { ok: true };
    },
    zenModelCheckDelayMs: 0
  });
  const opencode = provider("opencode", {
    defaultModelId: "big-pickle",
    label: "OpenCode Zen"
  });
  await store.upsertConnection({
    apiKey: "real-zen-key",
    modelProviderId: "opencode",
    providerRevision: revisionA
  }, { provider: opencode });

  const started = await store.updateModelAccess("opencode", { operation: "check-available" });
  assert.equal(started.modelAccess.check.status, "starting");

  let connection;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    connection = (await store.listConnections()).find(({ id }) => id === "opencode");
    if (connection.modelAccess.check?.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(connection.modelAccess.mode, "verified");
  assert.equal(connection.modelAccess.check.status, "complete");
  assert.deepEqual(connection.modelAccess.enabledModelIds, ["big-pickle", "working-model"]);
  assert.deepEqual({
    checked: connection.modelAccess.check.checked,
    enabled: connection.modelAccess.check.enabled,
    rejected: connection.modelAccess.check.rejected,
    retryable: connection.modelAccess.check.retryable,
    total: connection.modelAccess.check.total
  }, { checked: 3, enabled: 1, rejected: 1, retryable: 1, total: 3 });
  assert.deepEqual(verificationCalls, [
    "big-pickle",
    "rejected-model",
    "retry-model",
    "working-model"
  ]);
  assert.equal((await store.assistantAccess("opencode", { modelId: "working-model" })).available, true);
  assert.equal((await store.assistantAccess("opencode", { modelId: "rejected-model" })).available, false);
});

test("a running Zen model check reports restart interruption and can cancel before the next model", async (t) => {
  let releaseFirstModel;
  const firstModelStarted = new Promise((resolve) => {
    releaseFirstModel = resolve;
  });
  let continueFirstModel;
  const firstModelGate = new Promise((resolve) => {
    continueFirstModel = resolve;
  });
  const verificationCalls = [];
  const { store } = await fixture(t, {
    async readModelIds() {
      return ["big-pickle", "first-model", "second-model"];
    },
    async verifyConnection(input) {
      verificationCalls.push(input.modelId);
      if (input.modelId === "first-model") {
        releaseFirstModel();
        await firstModelGate;
      }
      return { ok: true };
    },
    zenModelCheckDelayMs: 0
  });
  const opencode = provider("opencode", {
    defaultModelId: "big-pickle",
    label: "OpenCode Zen"
  });
  await store.upsertConnection({
    apiKey: "real-zen-key",
    modelProviderId: "opencode",
    providerRevision: revisionA
  }, { provider: opencode });
  await store.updateModelAccess("opencode", { operation: "check-available" });
  await firstModelStarted;

  const restartedStore = createAiConnectionStore({
    filePath: store.filePath,
    async verifyConnection() {
      return { ok: true };
    }
  });
  const afterRestart = (await restartedStore.listConnections()).find(({ id }) => id === "opencode");
  assert.equal(afterRestart.modelAccess.check.status, "interrupted");
  assert.match(afterRestart.modelAccess.check.message, /stopped when Vibe64 restarted/u);

  const cancelling = await store.updateModelAccess("opencode", { operation: "cancel-check" });
  assert.equal(cancelling.modelAccess.check.status, "cancelling");
  continueFirstModel();

  let connection;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    connection = (await store.listConnections()).find(({ id }) => id === "opencode");
    if (connection.modelAccess.check?.status === "cancelled") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(connection.modelAccess.check.status, "cancelled");
  assert.equal(connection.modelAccess.check.checked, 0);
  assert.deepEqual(verificationCalls, ["big-pickle", "first-model"]);
});

test("AI connection store redacts keys and resolves native OpenCode connections server-side", async (t) => {
  const { filePath, store, verificationCalls } = await fixture(t);
  const definition = provider("deepseek", {
    defaultModelId: "deepseek-v4-flash",
    label: "DeepSeek"
  });
  const saved = await store.upsertConnection({
    apiKey: "deepseek-secret-value",
    label: "DeepSeek",
    modelProviderId: "deepseek",
    providerRevision: revisionA
  }, { provider: definition });

  assert.equal(saved.connected, true);
  assert.equal(saved.endpointCode, "opencode-native");
  assert.equal(saved.canonicalUrl, "");
  assert.equal(saved.accessLabel, "Workspace use");
  assert.equal(saved.managementUrl, "https://platform.deepseek.com/top_up");
  assert.equal(saved.keyHint, "••••alue");
  assert.equal(saved.fingerprint, connectionFingerprint("deepseek", "deepseek-secret-value"));
  assert.equal(Object.hasOwn(saved, "apiKey"), false);
  assert.deepEqual(verificationCalls, [{
    apiKey: "deepseek-secret-value",
    engineId: "opencode",
    modelId: "deepseek-v4-flash",
    modelProviderId: "deepseek"
  }]);
  assert.deepEqual(await store.resolveConnection("deepseek"), {
    apiKey: "deepseek-secret-value",
    canonicalUrl: "",
    economyModelId: "deepseek-v4-flash",
    endpointCode: "opencode-native",
    fingerprint: saved.fingerprint,
    modelProviderId: "deepseek",
    providerRevision: revisionA
  });
  assert.equal(JSON.stringify(await store.listConnections()).includes("deepseek-secret-value"), false);
  assert.equal((await stat(path.dirname(filePath))).mode & 0o777, 0o700);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});

test("unknown providers use their catalog default and ignore client routing flags", async (t) => {
  const { store, verificationCalls } = await fixture(t);
  const saved = await store.upsertConnection({
    apiKey: "acme-secret",
    canonicalUrl: "https://attacker.invalid/v1",
    endpointCode: "attacker-route",
    modelId: "attacker-model",
    modelProviderId: "acme",
    ownerOnly: false,
    providerRevision: revisionA
  }, {
    provider: provider("acme", { defaultModelId: "acme-small", label: "Acme AI" })
  });

  assert.equal(saved.productLabel, "Acme AI");
  assert.equal(saved.economyModelId, "acme-small");
  assert.equal(saved.accessLabel, "Personal use");
  assert.equal(saved.canonicalUrl, "");
  assert.deepEqual(verificationCalls[0], {
    apiKey: "acme-secret",
    engineId: "opencode",
    modelId: "acme-small",
    modelProviderId: "acme"
  });
  assert.equal(JSON.stringify(verificationCalls[0]).includes("attacker.invalid"), false);
  assert.equal(JSON.stringify(verificationCalls[0]).includes("attacker-model"), false);
});

test("GLM API and Coding Plan stay independent even when they use the same key", async (t) => {
  const changes = [];
  const { store } = await fixture(t, {
    onConnectionChanged(change) {
      changes.push(change);
    }
  });
  const zai = provider("zai", { defaultModelId: "glm-4.7-flash", label: "Z.AI" });
  const codingPlan = provider("zai-coding-plan", {
    defaultModelId: "glm-5.3-flash",
    label: "Z.AI Coding Plan",
    revision: revisionB
  });

  await store.upsertConnection({
    apiKey: "same-glm-key",
    modelProviderId: "zai",
    ownerOnly: true,
    providerRevision: revisionA
  }, { provider: zai });
  await store.upsertConnection({
    apiKey: "same-glm-key",
    modelProviderId: "zai-coding-plan",
    ownerOnly: false,
    providerRevision: revisionB
  }, { provider: codingPlan });

  const rows = await store.listConnections();
  assert.deepEqual(rows.map(({ id }) => id).sort(), ["opencode", "zai", "zai-coding-plan"]);
  const regularApi = rows.find(({ id }) => id === "zai");
  const personalPlan = rows.find(({ id }) => id === "zai-coding-plan");
  assert.equal(regularApi.productLabel, "GLM-4.7 Flash · Regular Z.AI API");
  assert.equal(regularApi.accessLabel, "Workspace use");
  assert.equal(regularApi.preferred, true);
  assert.equal(regularApi.modelAccess.mode, "recommended");
  assert.equal(personalPlan.productLabel, "GLM · Personal Coding Plan");
  assert.equal(personalPlan.accessLabel, "Personal use");
  assert.equal((await store.resolveConnection("zai")).economyModelId, "glm-4.7-flash");
  assert.equal((await store.resolveConnection("zai-coding-plan")).economyModelId, "glm-5.3-flash");
  assert.equal((await store.assistantAccess("zai", { modelId: "glm-4.7-flash" })).available, true);
  assert.equal((await store.assistantAccess("zai", { modelId: "glm-paid" })).available, false);

  const unlocked = await store.updateModelAccess("zai", { unlocked: true });
  assert.equal(unlocked.modelAccess.mode, "all");
  assert.equal((await store.assistantAccess("zai", { modelId: "glm-paid" })).available, true);

  await store.removeConnection("zai");
  assert.equal(await store.resolveConnection("zai"), null);
  assert.equal((await store.resolveConnection("zai-coding-plan")).apiKey, "same-glm-key");
  assert.equal((await store.listConnections()).find(({ id }) => id === "opencode").preferred, true);
  assert.deepEqual(changes, [
    { modelProviderId: "zai", reason: "created" },
    { modelProviderId: "zai-coding-plan", reason: "created" },
    { modelProviderId: "zai", reason: "model-access-updated" },
    { modelProviderId: "zai", reason: "removed" }
  ]);
});

test("recognized connections replace legacy display labels with current trusted policy", async (t) => {
  const { filePath, store } = await fixture(t);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({
    connections: {
      zai: {
        apiKey: "legacy-zai-key",
        economyModelId: "glm-4.7-flash",
        label: "Z.AI",
        ownerOnly: false,
        productLabel: "GLM · Multiuser API key",
        providerRevision: revisionA
      }
    },
    preferredProviderId: "zai",
    version: 3
  }));

  const zai = (await store.listConnections()).find(({ id }) => id === "zai");
  assert.equal(zai.productLabel, "GLM-4.7 Flash · Regular Z.AI API");
  assert.equal(zai.accessLabel, "Workspace use");
});

test("mutations serialize replacements without losing other providers", async (t) => {
  const { store } = await fixture(t);
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-v4-flash" });
  const anthropic = provider("anthropic", { defaultModelId: "claude-haiku-4-5" });
  await Promise.all([
    store.upsertConnection({
      apiKey: "deepseek-first",
      modelProviderId: "deepseek",
      providerRevision: revisionA
    }, { provider: deepseek }),
    store.upsertConnection({
      apiKey: "anthropic-first",
      modelProviderId: "anthropic",
      providerRevision: revisionA
    }, { provider: anthropic })
  ]);
  await store.upsertConnection({
    apiKey: "deepseek-replacement",
    modelProviderId: "deepseek",
    providerRevision: revisionB
  }, { provider: { ...deepseek, definitionRevision: revisionB } });

  assert.deepEqual((await store.listConnections()).map(({ id }) => id), ["anthropic", "deepseek", "opencode"]);
  assert.equal((await store.resolveConnection("deepseek")).apiKey, "deepseek-replacement");
  assert.equal((await store.resolveConnection("anthropic")).apiKey, "anthropic-first");
});

test("store rejects invalid input and stale provider definitions", async (t) => {
  const { store } = await fixture(t);
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-v4-flash" });

  await assert.rejects(
    store.upsertConnection({
      apiKey: "secret",
      modelProviderId: "../../bad",
      providerRevision: revisionA
    }, { provider: deepseek }),
    (error) => error.code === "vibe64_ai_provider_invalid"
  );
  await assert.rejects(
    store.upsertConnection({
      apiKey: "line\nbreak",
      modelProviderId: "deepseek",
      providerRevision: revisionA
    }, { provider: deepseek }),
    (error) => error.code === "vibe64_ai_api_key_invalid"
  );
  await assert.rejects(
    store.upsertConnection({
      apiKey: "secret",
      modelProviderId: "deepseek",
      providerRevision: "old"
    }, { provider: deepseek }),
    (error) => error.code === "vibe64_ai_provider_revision_invalid"
  );
  await assert.rejects(
    store.upsertConnection({
      apiKey: "secret",
      modelProviderId: "deepseek",
      providerRevision: revisionB
    }, { provider: deepseek }),
    (error) => error.code === "vibe64_ai_provider_revision_changed"
  );
  assert.deepEqual((await store.listConnections()).map(({ id }) => id), ["opencode"]);
});

test("failed and stale OpenCode verification never replace a working key", async (t) => {
  let result = { ok: true };
  let failure = null;
  const { store } = await fixture(t, {
    async verifyConnection() {
      if (failure) throw failure;
      return result;
    }
  });
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-v4-flash" });
  await store.upsertConnection({
    apiKey: "working-key",
    modelProviderId: "deepseek",
    providerRevision: revisionA
  }, { provider: deepseek });

  failure = Object.assign(new Error("raw provider failure must not surface"), { statusCode: 422 });
  await assert.rejects(
    store.upsertConnection({
      apiKey: "rejected-key",
      modelProviderId: "deepseek",
      providerRevision: revisionA
    }, { provider: deepseek }),
    (error) => error.code === "vibe64_ai_api_key_rejected" && error.statusCode === 422
  );
  assert.equal((await store.resolveConnection("deepseek")).apiKey, "working-key");

  failure = Object.assign(new Error("catalog changed"), {
    code: "vibe64_assistant_catalog_stale",
    statusCode: 409
  });
  await assert.rejects(
    store.upsertConnection({
      apiKey: "stale-key",
      modelProviderId: "deepseek",
      providerRevision: revisionA
    }, { provider: deepseek }),
    (error) => error.code === "vibe64_ai_provider_policy_stale" && error.statusCode === 409
  );

  failure = null;
  result = null;
  await assert.rejects(
    store.upsertConnection({
      apiKey: "incomplete-key",
      modelProviderId: "deepseek",
      providerRevision: revisionA
    }, { provider: deepseek }),
    (error) => error.code === "vibe64_ai_key_verification_unavailable" && error.statusCode === 503
  );
});

test("legacy records migrate to native routing without exposing keys", async (t) => {
  const { filePath, store } = await fixture(t);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({
    connections: {
      deepseek: {
        apiKey: "legacy-secret",
        endpointCode: "deepseek_api",
        label: "Legacy DeepSeek",
        providerRevision: revisionA
      }
    },
    version: 2
  }));

  const [legacy] = await store.listConnections();
  assert.equal(legacy.connected, true);
  assert.equal(legacy.endpointCode, "opencode-native");
  assert.equal(legacy.canonicalUrl, "");
  assert.equal(JSON.stringify(legacy).includes("legacy-secret"), false);
  assert.equal((await store.resolveConnection("deepseek")).apiKey, "legacy-secret");
});

test("reads ignore temp files and reject malformed durable state", async (t) => {
  const { filePath, store } = await fixture(t);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(`${filePath}.interrupted.tmp`, "{not-json");
  await writeFile(filePath, JSON.stringify({ connections: {}, version: 3 }));
  assert.deepEqual((await store.listConnections()).map(({ id }) => id), ["opencode"]);

  await writeFile(filePath, "{not-json");
  await assert.rejects(
    store.listConnections(),
    (error) => error.code === "vibe64_ai_connection_state_malformed"
  );
});

test("replacement and removal publish runtime invalidation facts", async (t) => {
  const changes = [];
  const { store } = await fixture(t, {
    onConnectionChanged(change) {
      changes.push(change);
    }
  });
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-v4-flash" });
  await store.upsertConnection({
    apiKey: "first-secret",
    modelProviderId: "deepseek",
    providerRevision: revisionA
  }, { provider: deepseek });
  await store.upsertConnection({
    apiKey: "second-secret",
    modelProviderId: "deepseek",
    providerRevision: revisionA
  }, { provider: deepseek });
  await store.removeConnection("deepseek");

  assert.deepEqual(changes, [
    { modelProviderId: "deepseek", reason: "created" },
    { modelProviderId: "deepseek", reason: "replaced" },
    { modelProviderId: "deepseek", reason: "removed" }
  ]);
  assert.match(await readFile(store.filePath, "utf8"), /"version": 5/u);
});

test("helper model preferences persist, respect model locks, and leave credential identity unchanged", async (t) => {
  const changes = [];
  const { store, filePath } = await fixture(t, { onConnectionChanged: (change) => changes.push(change) });
  const zai = provider("zai", { defaultModelId: "glm-4.7-flash" });
  await store.upsertConnection({ modelProviderId: "zai", apiKey: "test-key", providerRevision: revisionA }, { provider: zai });
  const before = await store.resolveConnection("zai");
  const models = [{ id: "glm-4.7-flash", status: "available" }, { id: "chosen", status: "available" }];
  await assert.rejects(store.helperModelSettings("zai", { models, modelId: "chosen" }), /available/);
  await store.updateModelAccess("zai", { unlocked: true });
  await store.helperModelSettings("zai", { models, modelId: "chosen" });
  assert.equal(changes.at(-1).reason, "helper-model-updated");
  const reopened = createAiConnectionStore({ filePath, verifyConnection: async () => ({ ok: true }) });
  assert.equal((await reopened.helperModelSettings("zai", { models })).modelId, "chosen");
  assert.equal((await reopened.assistantAccess("zai")).economyModelId, "chosen");
  assert.equal((await reopened.resolveConnection("zai")).fingerprint, before.fingerprint);
  assert.equal((await reopened.resolveConnection("zai")).economyModelId, before.economyModelId);
  assert.equal((await reopened.listConnections()).find((row) => row.id === "zai").economyModelId, before.economyModelId);
  await assert.rejects(store.helperModelSettings("zai", { models, modelId: "missing" }), /available/);
  await store.updateModelAccess("zai", { unlocked: false });
  assert.equal((await store.assistantAccess("zai")).economyModelId, "");
  assert.equal((await store.helperModelSettings("zai", { models })).modelId, "chosen");
  await store.helperModelSettings("zai", { models, modelId: "" });
  assert.equal((await store.assistantAccess("zai")).economyModelId, "glm-4.7-flash");
});
