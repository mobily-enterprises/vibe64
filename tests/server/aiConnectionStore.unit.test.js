import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  connectionFingerprint,
  createAiConnectionStore
} from "../../packages/vibe64-accounts/src/server/aiConnectionStore.js";
import { verifyZaiConnection } from "../../packages/vibe64-accounts/src/server/zaiConnectionVerifier.js";
import { assertCanUseVibe64Assistant } from "../../packages/vibe64-runtime/src/shared/assistantAccess.js";

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

test("Vibe64 includes no AI: OpenCode Zen is connected only by a saved key", async (t) => {
  const { store, verificationCalls } = await fixture(t);
  assert.deepEqual(await store.listConnections(), []);
  assert.equal(await store.resolveConnection("opencode"), null);
  assert.equal((await store.assistantAccess("opencode", { modelId: "big-pickle" })).available, false);
  assert.deepEqual(await store.removeConnection("opencode"), { id: "opencode", ok: true, removed: false });
  assert.deepEqual(verificationCalls, []);
});

test("OpenCode access retains connection scope for disabled models and identifies credential replacement", async (t) => {
  const { store } = await fixture(t);
  await store.upsertConnection({ apiKey: "first-secret", modelProviderId: "opencode", providerRevision: revisionA }, {
    provider: provider("opencode")
  });
  const before = await store.assistantAccess("opencode", { modelId: "claude-haiku-4-5" });
  const disabled = await store.assistantAccess("opencode", { modelId: "other-model" });
  assert.equal(before.available, true);
  assert.equal(before.ownerOnly, false);
  assert.equal(disabled.ownerOnly, false);
  assert.equal(disabled.available, false);
  assert.equal(disabled.connectionIdentity, before.connectionIdentity);
  assert.ok(before.connectionIdentity);
  await store.upsertConnection({ apiKey: "replacement-secret", modelProviderId: "opencode", providerRevision: revisionA }, {
    provider: provider("opencode")
  });
  const after = await store.assistantAccess("opencode", { modelId: "claude-haiku-4-5" });
  assert.notEqual(after.connectionIdentity, before.connectionIdentity);
  assert.doesNotMatch(JSON.stringify(after), /replacement-secret/);
  assert.equal((await store.assistantAccess("missing")).connectionIdentity, undefined);
});

test("an OpenCode selection whose connection is gone is refused naming that connection as AI Accounts does", async (t) => {
  const { store } = await fixture(t);
  await store.upsertConnection({ apiKey: "openai-secret", modelProviderId: "openai", providerRevision: revisionA }, {
    provider: provider("openai", { label: "OpenAI" })
  });
  await store.removeConnection("openai");
  const gone = await store.assistantAccess("openai", { modelId: "gpt-5-mini" });
  assert.equal(gone.missingAccountLabel, "OpenAI");
  assert.throws(() => assertCanUseVibe64Assistant(gone), {
    code: "vibe64_assistant_connection_unavailable",
    message: "OpenAI isn't connected. Reconnect it in AI Accounts or choose another model."
  });
  // A provider Vibe64 does not know by name, and a connected key whose model is
  // not enabled, keep the generic refusal rather than a wrong name.
  const unknown = await store.assistantAccess("acme");
  await store.upsertConnection({ apiKey: "zen-secret", modelProviderId: "opencode", providerRevision: revisionA }, {
    provider: provider("opencode")
  });
  const locked = await store.assistantAccess("opencode", { modelId: "other-model" });
  for (const access of [unknown, locked]) {
    assert.equal(access.available, false);
    assert.throws(() => assertCanUseVibe64Assistant(access), { message: "The selected AI connection is unavailable." });
  }
});

test("a real Zen key starts with the recommended Zen model, never Big Pickle, and supports all-or-recommended access", async (t) => {
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
  assert.equal(saved.defaultModelId, "claude-haiku-4-5");
  assert.equal(saved.removable, true);
  assert.equal(saved.modelAccess.mode, "recommended");
  assert.deepEqual(saved.modelAccess.enabledModelIds, ["claude-haiku-4-5"]);
  assert.equal(saved.modelAccess.managementOnly, true);
  assert.equal((await store.assistantAccess("opencode", { modelId: "big-pickle" })).available, false);
  assert.equal((await store.assistantAccess("opencode", { modelId: "another-model" })).available, false);

  const all = await store.updateModelAccess("opencode", { operation: "enable-all" });
  assert.equal(all.modelAccess.mode, "all");
  assert.equal((await store.assistantAccess("opencode", { modelId: "another-model" })).available, true);

  const recommendedOnly = await store.updateModelAccess("opencode", { operation: "disable-additional" });
  assert.equal(recommendedOnly.modelAccess.mode, "recommended");
  assert.equal((await store.assistantAccess("opencode", { modelId: "another-model" })).available, false);

  await assert.rejects(
    store.upsertConnection({
      apiKey: "public",
      modelProviderId: "opencode",
      providerRevision: revisionA
    }, { provider: opencode }),
    (error) => error.code === "vibe64_ai_public_key_unsupported"
  );

  assert.deepEqual(await store.removeConnection("opencode"), { id: "opencode", ok: true, removed: true });
  assert.equal(await store.resolveConnection("opencode"), null);
  assert.deepEqual(await store.listConnections(), []);
  assert.deepEqual(changes, [
    { modelProviderId: "opencode", reason: "created" },
    { modelProviderId: "opencode", reason: "model-access-updated" },
    { modelProviderId: "opencode", reason: "model-access-updated" },
    { modelProviderId: "opencode", reason: "removed" }
  ]);
});

test("Zen checks models sequentially in the background and enables only confirmed models", async (t) => {
  const verificationCalls = [];
  const { store } = await fixture(t, {
    async readModelIds() {
      return ["retry-model", "big-pickle", "claude-haiku-4-5", "working-model", "rejected-model"];
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
  assert.deepEqual(connection.modelAccess.enabledModelIds, ["claude-haiku-4-5", "working-model"]);
  assert.deepEqual({
    checked: connection.modelAccess.check.checked,
    enabled: connection.modelAccess.check.enabled,
    rejected: connection.modelAccess.check.rejected,
    retryable: connection.modelAccess.check.retryable,
    total: connection.modelAccess.check.total
  }, { checked: 3, enabled: 1, rejected: 1, retryable: 1, total: 3 });
  assert.deepEqual(verificationCalls, [
    "claude-haiku-4-5",
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
  assert.deepEqual(verificationCalls, ["claude-haiku-4-5", "first-model"]);
});

test("AI connection store redacts keys and resolves native OpenCode connections server-side", async (t) => {
  const { filePath, store, verificationCalls } = await fixture(t);
  const definition = provider("deepseek", {
    defaultModelId: "deepseek-flash",
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
    modelId: "deepseek-flash",
    modelProviderId: "deepseek"
  }]);
  assert.deepEqual(await store.resolveConnection("deepseek"), {
    apiKey: "deepseek-secret-value",
    canonicalUrl: "",
    defaultModelId: "deepseek-flash",
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
  assert.equal(saved.defaultModelId, "acme-small");
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
  assert.deepEqual(rows.map(({ id }) => id).sort(), ["zai", "zai-coding-plan"]);
  const regularApi = rows.find(({ id }) => id === "zai");
  const personalPlan = rows.find(({ id }) => id === "zai-coding-plan");
  assert.equal(regularApi.productLabel, "GLM-4.7 Flash · Regular Z.AI API");
  assert.equal(regularApi.accessLabel, "Workspace use");
  assert.equal(regularApi.preferred, true);
  assert.equal(regularApi.modelAccess.mode, "recommended");
  assert.equal(personalPlan.productLabel, "GLM · Personal Coding Plan");
  assert.equal(personalPlan.accessLabel, "Personal use");
  assert.equal((await store.resolveConnection("zai")).defaultModelId, "glm-4.7-flash");
  assert.equal((await store.resolveConnection("zai-coding-plan")).defaultModelId, "glm-5.3-flash");
  assert.equal((await store.assistantAccess("zai", { modelId: "glm-4.7-flash" })).available, true);
  assert.equal((await store.assistantAccess("zai", { modelId: "glm-paid" })).available, false);

  const unlocked = await store.updateModelAccess("zai", { unlocked: true });
  assert.equal(unlocked.modelAccess.mode, "all");
  assert.equal((await store.assistantAccess("zai", { modelId: "glm-paid" })).available, true);

  await store.removeConnection("zai");
  assert.equal(await store.resolveConnection("zai"), null);
  assert.equal((await store.resolveConnection("zai-coding-plan")).apiKey, "same-glm-key");
  assert.equal((await store.listConnections()).some(({ preferred }) => preferred), false,
    "removing the preferred connection leaves no built-in fallback preferred");
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
        defaultModelId: "glm-4.7-flash",
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
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-flash" });
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

  assert.deepEqual((await store.listConnections()).map(({ id }) => id), ["anthropic", "deepseek"]);
  assert.equal((await store.resolveConnection("deepseek")).apiKey, "deepseek-replacement");
  assert.equal((await store.resolveConnection("anthropic")).apiKey, "anthropic-first");
});

test("store rejects invalid input and stale provider definitions", async (t) => {
  const { store } = await fixture(t);
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-flash" });

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
  assert.deepEqual((await store.listConnections()).map(({ id }) => id), []);
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
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-flash" });
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

test("regular Z.AI verification explains overload and balance without replacing keys or exposing provider text", async (t) => {
  let providerErrorCode = "";
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, "glm-4.7-flash");
    return providerErrorCode
      ? Response.json({ error: { code: providerErrorCode, message: "raw provider text with rejected-secret" } }, { status: 429 })
      : Response.json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] });
  });
  const { store } = await fixture(t, { verifyConnection: verifyZaiConnection });
  const zai = provider("zai", { defaultModelId: "glm-4.7-flash" });
  await store.upsertConnection({
    apiKey: "working-key", modelProviderId: "zai", providerRevision: revisionA
  }, { provider: zai });

  for (const [code, expectedCode, status, reason] of [
    ["1305", "vibe64_ai_key_verification_unavailable", 503, /temporarily overloaded/],
    ["1113", "vibe64_ai_api_key_rejected", 422, /insufficient balance or no resource package/],
    ["1308", "vibe64_ai_api_key_rejected", 422, /Check the key, billing, and quota/]
  ]) {
    providerErrorCode = code;
    await assert.rejects(store.upsertConnection({
      apiKey: "rejected-secret", modelProviderId: "zai", providerRevision: revisionA
    }, { provider: zai }), (error) => {
      assert.equal(error.code, expectedCode);
      assert.equal(error.statusCode, status);
      assert.match(error.message, reason);
      if (code === "1305") assert.equal(error.fieldErrors.apiKey, error.message);
      assert.doesNotMatch(JSON.stringify({ message: error.message, fields: error.fieldErrors }), /raw provider text|rejected-secret/);
      return true;
    });
    assert.equal((await store.resolveConnection("zai")).apiKey, "working-key");
  }
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
  assert.deepEqual((await store.listConnections()).map(({ id }) => id), []);

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
  const deepseek = provider("deepseek", { defaultModelId: "deepseek-flash" });
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

test("retired helper settings never select a runtime model or disappear through ordinary connection writes", async (t) => {
  const { store, filePath } = await fixture(t);
  const zai = provider("zai", { defaultModelId: "glm-4.7-flash" });
  await store.upsertConnection({ modelProviderId: "zai", apiKey: "test-key", providerRevision: revisionA }, { provider: zai });
  const before = await store.resolveConnection("zai");
  const state = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(Object.hasOwn(state.connections.zai, "helperModelId"), false);
  state.connections.zai.helperModelId = "legacy-helper";
  await writeFile(filePath, JSON.stringify(state));
  const original = await readFile(filePath, "utf8");
  assert.equal((await store.listConnections()).find(({ id }) => id === "zai").helperModelId, undefined);
  assert.equal((await store.assistantAccess("zai", { modelId: "glm-4.7-flash" })).available, true);
  assert.equal((await store.assistantAccess("zai")).defaultModelId, undefined);
  assert.equal((await store.resolveConnection("zai")).fingerprint, before.fingerprint);
  for (const operation of [() => store.updateModelAccess("zai", { unlocked: true }),
    () => store.removeConnection("zai"),
    () => store.upsertConnection({ modelProviderId: "zai", apiKey: "replacement-key", providerRevision: revisionA }, { provider: zai })]) {
    await assert.rejects(operation(), { code: "vibe64_ai_routing_upgrade_required" });
    assert.equal(await readFile(filePath, "utf8"), original);
  }
});

test("credential publication runs after selected validation and preserves prior saved keys when native retirement refuses", async t => {
  const calls = [];
  let refuse = false;
  const { store, filePath } = await fixture(t, {
    async verifyConnection(input) { calls.push(`verify:${input.modelProviderId}`); return { ok: true }; },
    async withConnectionChange(change, publish) {
      calls.push(`barrier:${change.modelProviderId}`);
      if (refuse) throw new Error("Close other OpenCode chats, then retry.");
      await publish();
    },
    onConnectionChanged(change) { calls.push(`changed:${change.modelProviderId}`); }
  });
  const save = (id, key) => store.upsertConnection({ modelProviderId: id, apiKey: key, providerRevision: revisionA }, { provider: provider(id) });
  await save("deepseek", "fixture-old");
  await save("zai", "fixture-peer");
  const before = await readFile(filePath, "utf8");
  calls.length = 0; refuse = true;
  await assert.rejects(save("deepseek", "fixture-new"), /Close other/);
  assert.deepEqual(calls, ["verify:deepseek", "barrier:deepseek"]);
  assert.equal(await readFile(filePath, "utf8"), before);
  await assert.rejects(store.removeConnection("deepseek"), /Close other/);
  assert.equal(await readFile(filePath, "utf8"), before);
  refuse = false; calls.length = 0;
  await save("deepseek", "fixture-new");
  assert.deepEqual(calls, ["verify:deepseek", "barrier:deepseek", "changed:deepseek"]);
  assert.equal((await store.resolveConnection("deepseek")).apiKey, "fixture-new");
  assert.equal((await store.resolveConnection("zai")).apiKey, "fixture-peer");
});
