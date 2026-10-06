import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCodexModelCatalog } from "@jskit-ai/assistant-core/testing/native-codex";
import { codexProviderModelCatalog } from "@local/vibe64-core/server/codexProviderConnections";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";

async function fixture(t, source) {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "codex-catalog-unit-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const command = path.join(runtimeDir, "codex");
  await writeFile(command, `#!${process.execPath}\n${source}\n`);
  await chmod(command, 0o700);
  return { runtimeDir, command, additionalModels: codexProviderModelCatalog().models };
}

test("startup exports current native metadata verbatim and adds every unique curated model", async (t) => {
  const native = { slug: "gpt-future", priority: 7, context_window: 777777, apply_patch_tool_type: "function",
    model_messages: { instructions_template: "Native instructions" }, future_capability: { enabled: true } };
  const f = await fixture(t, `
    require("node:fs").writeFileSync(require("node:path").join(__dirname, "args.json"), JSON.stringify(process.argv.slice(2)));
    process.stdout.write(${JSON.stringify(JSON.stringify({ models: [native], future_catalog_field: 123 }))});
  `);
  const target = await prepareCodexModelCatalog(f);
  const catalog = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(catalog.models[0], native);
  assert.equal(catalog.future_catalog_field, 123);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.runtimeDir, "args.json"), "utf8")),
    ["debug", "models", "-c", "check_for_update_on_startup=false"]);
  const expected = new Set(CURATED_CODEX_PROVIDERS.flatMap((provider) => provider.models.map((model) => model.id)));
  assert.deepEqual(new Set(catalog.models.slice(1).map((model) => model.slug)), expected);
  assert.equal(catalog.models.length, expected.size + 1, "shared GLM IDs must not create duplicate definitions");
  for (const model of catalog.models.slice(1)) {
    assert.ok(model.priority > native.priority, "foreign metadata must not take over the native default");
    assert.equal(model.apply_patch_tool_type, "freeform");
    assert.equal(model.context_window, 1048576);
    assert.equal(model.max_context_window, 1048576);
  }
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  await assert.rejects(stat(`${target}.tmp`), { code: "ENOENT" });
});

test("a provider-only home obtains native metadata from the installed binary without needing OpenAI login", async (t) => {
  const f = await fixture(t, `
    require("node:assert/strict").ok(process.argv.includes("--bundled"));
    process.stdout.write(JSON.stringify({ models: [{ slug: "gpt-native" }, { slug: "deepseek-flash", context_window: 272000 }] }));
  `);
  const catalog = JSON.parse(await readFile(await prepareCodexModelCatalog({ ...f, bundled: true }), "utf8"));
  assert.equal(catalog.models.filter((model) => model.slug === "deepseek-flash").length, 1);
  assert.equal(catalog.models.find((model) => model.slug === "deepseek-flash").context_window, 1048576);
  assert.equal(catalog.models[0].slug, "gpt-native");
});
