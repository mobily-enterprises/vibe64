import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { upgradeIndependentProviderCredentials } from "../../packages/vibe64-accounts/src/server/providerCredentialsUpgrade.js";
import { createAiConnectionStore } from "../../packages/vibe64-accounts/src/server/aiConnectionStore.js";

const id = "20261009-independent-provider-credentials";
const providers = ["deepseek", "zai", "zai-coding-plan"];
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-credential-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state"), runtimeRoot = path.join(root, "runtime"), home = path.join(root, "home");
  const warnings = [];
  const options = { systemRoot, backupRoot: path.join(systemRoot, "upgrades", "backups", id),
    env: { VIBE64_AGENT_RUNTIME_DIR: runtimeRoot }, home, report: (level, message) => warnings.push([level, message]) };
  async function put(file, data) { await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, data, { mode: 0o600 }); return file; }
  const targets = [];
  for (const engine of ["codex", "claude"]) for (const provider of providers) {
    const base = path.join(systemRoot, "ai-connections", engine, provider);
    targets.push(await put(path.join(base, "connection.json"), JSON.stringify({ apiKey: `${engine}-${provider}-fixture`, claudeReady: true })));
    targets.push(await put(path.join(base, "home", ".codex", "config.toml"), 'experimental_bearer_token = "native-fixture"'));
    targets.push(await put(path.join(base, "auth", "codex", "status.json"), JSON.stringify({ connected: true, generation: "fixture" })));
    targets.push(await put(path.join(base, "auth", "codex", "auth-status.json"), JSON.stringify({ status: "reconnecting" })));
  }
  const store = await put(path.join(systemRoot, "ai-connections", "connections.json"), JSON.stringify({ version: 5,
    preferredProviderId: "zai", connections: { ...Object.fromEntries(providers.map(provider => [provider, { apiKey: `${provider}-fixture`, modelAccessUnlocked: false }])),
      unrelated: { apiKey: "unrelated-fixture", sentinel: true } }, sentinel: "retain" }));
  const native = [];
  for (const base of [runtimeRoot, path.join(home, ".cache", "vibe64", "agent-providers")]) {
    native.push(await put(path.join(base, "opencode", "private-fixture", "data", "opencode", "auth.json"), JSON.stringify({
      ...Object.fromEntries(providers.map(provider => [provider, { type: "api", key: `${provider}-native-fixture` }])),
      anthropic: { type: "oauth", refresh: "subscription-fixture" }, opencode: { type: "api", key: "public" }
    })));
  }
  const helper = await put(path.join(runtimeRoot, "codex-app-server-abcdef123456", "codex-home", "config.toml"),
    'model_provider = "deepseek"\n[model_providers.deepseek]\nexperimental_bearer_token = "helper-fixture"\n[model_providers.unrelated]\nexperimental_bearer_token = "unrelated-native-fixture"\n[projects."/project"]\ntrust_level = "trusted"\n');
  native.push(helper);
  const retained = await put(path.join(systemRoot, "ai-connections", "codex", "deepseek", "home", ".codex", "rollouts", "history.jsonl"), "conversation-fixture");
  const subscription = await put(path.join(home, ".codex", "auth.json"), "subscription-login-fixture");
  const routing = await put(path.join(systemRoot, "ai-connections", "routing.json"), 'route-to-zai-fixture');
  return { root, options, put, targets, native, retained, subscription, routing, store, warnings };
}

test("read-only preflight inventories all saved/native credentials and preserves exact files", async t => {
  const f = await fixture(t);
  const files = [...f.targets, ...f.native, f.store, f.retained, f.subscription, f.routing];
  const before = await Promise.all(files.map(async file => ({ content: await readFile(file), stats: await stat(file) })));
  await upgradeIndependentProviderCredentials({ ...f.options, apply: false });
  for (const [index, file] of files.entries()) {
    assert.deepEqual(await readFile(file), before[index].content);
    const after = await stat(file);
    assert.equal(after.ino, before[index].stats.ino);
    assert.equal(after.mtimeMs, before[index].stats.mtimeMs);
  }
  await assert.rejects(stat(f.options.backupRoot), { code: "ENOENT" });
  assert.ok(f.warnings.some(([level, message]) => level === "warning" && /ALL saved/.test(message) && /does not revoke/.test(message)));
  assert.doesNotMatch(JSON.stringify(f.warnings), /native-fixture|subscription-fixture|unrelated-fixture/);
});

test("apply clears each targeted store/native route with private backups, retaining all other state and preferred routing", async t => {
  const f = await fixture(t);
  const originals = await Promise.all([...f.targets, ...f.native, f.store].map(file => readFile(file)));
  await upgradeIndependentProviderCredentials({ ...f.options, apply: true });
  for (const file of f.targets) await assert.rejects(stat(file), { code: "ENOENT" });
  for (const file of f.native) {
    if (file.endsWith("config.toml")) {
      const config = await readFile(file, "utf8");
      assert.doesNotMatch(config, /helper-fixture/);
      assert.match(config, /unrelated-native-fixture/);
      assert.match(config, /model_provider = "deepseek"/);
      assert.match(config, /trust_level = "trusted"/);
    } else assert.deepEqual(Object.keys(JSON.parse(await readFile(file))).sort(), ["anthropic", "opencode"]);
  }
  const state = JSON.parse(await readFile(f.store));
  assert.equal(state.preferredProviderId, "zai");
  assert.equal(state.sentinel, "retain");
  assert.deepEqual(state.connections, { unrelated: { apiKey: "unrelated-fixture", sentinel: true } });
  const store = createAiConnectionStore({ filePath: f.store, verifyConnection() { assert.fail("Upgrade and reads cannot make provider calls"); } });
  assert.equal((await store.listConnections()).find(row => row.id === "opencode").preferred, false);
  assert.equal(await store.resolveConnection("zai"), null);
  assert.equal(await readFile(f.retained, "utf8"), "conversation-fixture");
  assert.equal(await readFile(f.subscription, "utf8"), "subscription-login-fixture");
  assert.equal(await readFile(f.routing, "utf8"), "route-to-zai-fixture");
  for (const [index, file] of [...f.targets, ...f.native, f.store].entries()) {
    const backup = path.join(f.options.backupRoot, "before", path.relative(path.parse(file).root, file));
    assert.deepEqual(await readFile(backup), originals[index]);
    assert.equal((await stat(backup)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(backup))).mode & 0o777, 0o700);
  }
  await upgradeIndependentProviderCredentials({ ...f.options, apply: true });
});

test("interrupted publication retries exact original backups, rejects changed files and unowned manifests", async t => {
  const f = await fixture(t);
  let interrupted = false;
  await assert.rejects(upgradeIndependentProviderCredentials({ ...f.options, apply: true, report(level, message) {
    if (!interrupted && message.startsWith("Published state:")) { interrupted = true; throw new Error("fixture publication interruption"); }
  } }), /fixture publication interruption/);
  const manifestPath = path.join(f.options.backupRoot, "manifest.json");
  const originalManifest = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(originalManifest);
  assert.equal(manifest.files.length, f.targets.length + f.native.length + 1);
  await upgradeIndependentProviderCredentials({ ...f.options, apply: false });
  await upgradeIndependentProviderCredentials({ ...f.options, apply: true });
  assert.equal(await readFile(manifestPath, "utf8"), originalManifest);
  await f.put(f.targets[0], '{"apiKey":"unexpected-new-fixture"}');
  await assert.rejects(upgradeIndependentProviderCredentials({ ...f.options, apply: true }), /differs from both upgrade copies/);
  manifest.files[0].path = path.relative(path.parse(f.retained).root, f.retained);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(upgradeIndependentProviderCredentials({ ...f.options, apply: true }), /unowned path/);
});

test("unsafe native parents and malformed stores refuse before backups or any clearing", async t => {
  const f = await fixture(t);
  const dataRoot = path.dirname(path.dirname(f.native[0]));
  await rm(dataRoot, { recursive: true });
  await symlink(path.join(f.root, "foreign"), dataRoot);
  await assert.rejects(upgradeIndependentProviderCredentials({ ...f.options, apply: true }), /regular directory/);
  assert.ok(await stat(f.targets[0]));
  await assert.rejects(stat(f.options.backupRoot), { code: "ENOENT" });
  await rm(dataRoot);
  await f.put(f.store, '{"version":999,"connections":{}}');
  await assert.rejects(upgradeIndependentProviderCredentials({ ...f.options, apply: true }), /unsupported shape/);
  assert.ok(await stat(f.targets[0]));
});


test("fresh preflight creates nothing and a damaged private backup blocks retry", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-empty-credentials-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  await upgradeIndependentProviderCredentials({ systemRoot, backupRoot: path.join(systemRoot, "upgrades/backups", id),
    apply: false, home: path.join(root, "home"), env: { VIBE64_AGENT_RUNTIME_DIR: path.join(root, "runtime") }, report() {} });
  await assert.rejects(stat(systemRoot), { code: "ENOENT" });
  const f = await fixture(t);
  await upgradeIndependentProviderCredentials({ ...f.options, apply: true });
  const manifest = JSON.parse(await readFile(path.join(f.options.backupRoot, "manifest.json")));
  const backup = path.join(f.options.backupRoot, "before", manifest.files[0].path);
  await writeFile(backup, "damaged-fixture");
  const store = await readFile(f.store);
  await assert.rejects(upgradeIndependentProviderCredentials({ ...f.options, apply: true }), /before copy is missing or changed/);
  assert.deepEqual(await readFile(f.store), store);
});

test("interrupted OpenCode verification credentials join the original preflight, private backup and retry boundary", async t => {
  const f = await fixture(t);
  const native = [];
  const unrelated = { anthropic: { type: "oauth", refresh: "retain-verifier-subscription" },
    opencode: { type: "api", key: "public" } };
  const source = JSON.stringify({ ...Object.fromEntries(providers.map(provider =>
    [provider, { type: "api", key: `${provider}-crashed-verifier-fixture` }])), ...unrelated });
  for (const base of [f.options.env.VIBE64_AGENT_RUNTIME_DIR,
    path.join(f.options.home, ".cache", "vibe64", "agent-providers")]) {
    native.push(await f.put(path.join(base, "opencode", "verify-11111111-1111-4111-8111-111111111111",
      "data", "opencode", "auth.json"), source));
  }
  const unowned = await f.put(path.join(f.options.env.VIBE64_AGENT_RUNTIME_DIR,
    "opencode", "verify-not-a-generated-uuid", "data", "opencode", "auth.json"), source);
  await upgradeIndependentProviderCredentials({ ...f.options, apply: false });
  for (const file of native) assert.equal(await readFile(file, "utf8"), source);
  await assert.rejects(stat(f.options.backupRoot), { code: "ENOENT" });
  await upgradeIndependentProviderCredentials({ ...f.options, apply: true });
  for (const file of native) {
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), unrelated);
    const backup = path.join(f.options.backupRoot, "before", path.relative(path.parse(file).root, file));
    assert.equal(await readFile(backup, "utf8"), source);
    assert.equal((await stat(backup)).mode & 0o777, 0o600);
  }
  assert.equal(await readFile(unowned, "utf8"), source, "an arbitrary verifier-like name grants no target authority");
  const manifestPath = path.join(f.options.backupRoot, "manifest.json");
  const manifest = await readFile(manifestPath, "utf8");
  await upgradeIndependentProviderCredentials({ ...f.options, apply: false });
  await upgradeIndependentProviderCredentials({ ...f.options, apply: true });
  assert.equal(await readFile(manifestPath, "utf8"), manifest);
  for (const file of native) assert.deepEqual(JSON.parse(await readFile(file, "utf8")), unrelated);
});

test("a generated verification home symlink refuses before credential clearing or backup publication", async t => {
  const f = await fixture(t);
  const foreignRoot = path.join(f.root, "foreign-verification");
  const foreign = await f.put(path.join(foreignRoot, "data", "opencode", "auth.json"),
    '{"deepseek":{"type":"api","key":"foreign-verifier-fixture"}}');
  await symlink(foreignRoot, path.join(f.options.env.VIBE64_AGENT_RUNTIME_DIR,
    "opencode", "verify-22222222-2222-4222-8222-222222222222"));
  const before = await readFile(f.targets[0]);
  const foreignBefore = await readFile(foreign);
  for (const apply of [false, true]) {
    await assert.rejects(upgradeIndependentProviderCredentials({ ...f.options, apply }), /regular directory/);
    assert.deepEqual(await readFile(f.targets[0]), before);
    assert.deepEqual(await readFile(foreign), foreignBefore);
    await assert.rejects(stat(f.options.backupRoot), { code: "ENOENT" });
  }
});
