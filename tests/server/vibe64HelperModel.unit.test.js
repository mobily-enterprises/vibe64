import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createNativeHelperModelStore } from "../../packages/vibe64-core/src/server/nativeHelperModel.js";
import { createService } from "../../packages/vibe64-accounts/src/server/service.js";

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-helper-model-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  const service = createService({
    systemRoot: root, targetRoot: root,
    listAssistantCapabilities: async () => ({ engines: [{ engineId: "codex", modelProviders: [{ models: [
      { id: "chosen", label: "Chosen", status: "available", variants: [{ id: "low" }] },
      { id: "unsupported", status: "available", variants: [{ id: "high" }] },
      { id: "hidden", status: "unavailable", variants: [{ id: "low" }] }
    ] }] }] }),
    publishAccountChanged: async (...event) => events.push(event),
    invalidateAgentRuntimes: async () => assert.fail("Preference changes must not restart AI work"),
    ...options
  });
  return { root, service, events };
}

test("Codex helper choice persists across service instances and Recommended clears the override", async (t) => {
  const { root, service, events } = await fixture(t);
  assert.equal((await service.readHelperModel()).modelId, "");
  const result = await service.saveHelperModel({ modelId: "chosen" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.models, [{ id: "chosen", label: "Chosen" }]);
  const store = createNativeHelperModelStore({ systemRoot: root });
  assert.equal(await store.read(), "chosen");
  assert.equal(events.length, 1);
  assert.equal((await service.saveHelperModel({ modelId: "" })).ok, true);
  assert.equal(await store.read(), "");
});

test("unavailable or incompatible models cannot overwrite a saved preference", async (t) => {
  const { service } = await fixture(t);
  await service.saveHelperModel({ modelId: "chosen" });
  for (const modelId of ["missing", "unsupported", "hidden", null]) {
    assert.equal((await service.saveHelperModel({ modelId })).ok, false);
  }
  assert.equal((await service.readHelperModel()).modelId, "chosen");
});

test("hosted account authorization applies to helper reads and writes", async (t) => {
  const denied = { ok: false, code: "owner_required", error: "Owner required" };
  const { service } = await fixture(t, { canManageCodex: () => denied,
    listAssistantCapabilities: () => assert.fail("Unauthorized catalog read") });
  assert.deepEqual(await service.readHelperModel(), denied);
  assert.deepEqual(await service.saveHelperModel({ modelId: "chosen" }), denied);
});

test("corrupt helper settings stay visible and are not overwritten", async (t) => {
  const { root, service } = await fixture(t);
  await service.saveHelperModel({ modelId: "chosen" });
  const file = path.join(root, "ai-connections", "codex-helper-model.json");
  await writeFile(file, "broken");
  assert.equal((await service.readHelperModel()).ok, false);
  assert.equal((await service.saveHelperModel({ modelId: "" })).ok, false);
  assert.equal(await readFile(file, "utf8"), "broken");
});


test("Claude owners can select an economy model independently of Codex and reset to Haiku", async (t) => {
  const { root, service, events } = await fixture(t, {
    listAssistantCapabilities: async () => ({ engines: [{ engineId: "claude", modelProviders: [{ models: [
      { id: "haiku", label: "Haiku", status: "available", variants: [] },
      { id: "sonnet", label: "Sonnet", status: "available", variants: [{ id: "low" }, { id: "high" }] },
      { id: "unsupported", status: "available", variants: [{ id: "high" }] }
    ] }] }] })
  });
  const owner = { providerId: "claude", vibe64User: { role: "owner" } };
  const member = { providerId: "claude", vibe64User: { role: "user" } };
  assert.equal((await service.readHelperModel(member)).ok, false);
  assert.equal((await service.saveHelperModel({ ...member, modelId: "sonnet" })).ok, false);
  const selected = await service.saveHelperModel({ ...owner, modelId: "sonnet" });
  assert.equal(selected.ok, true, JSON.stringify(selected));
  assert.equal(selected.recommendedModelId, "haiku");
  assert.equal(await createNativeHelperModelStore({ systemRoot: root, providerId: "claude" }).read(), "sonnet");
  assert.equal(await createNativeHelperModelStore({ systemRoot: root }).read(), "");
  assert.equal(events.at(-1)[0], "claude");
  assert.equal((await service.saveHelperModel({ ...owner, modelId: "unsupported" })).ok, false);
  assert.equal((await service.saveHelperModel({ ...owner, modelId: "" })).ok, true);
  assert.equal((await service.readHelperModel(owner)).modelId, "");
});
