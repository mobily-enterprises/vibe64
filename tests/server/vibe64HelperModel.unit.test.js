import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCodexHelperModelStore } from "../../packages/vibe64-core/src/server/codexHelperModel.js";
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
  const store = createCodexHelperModelStore({ systemRoot: root });
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
