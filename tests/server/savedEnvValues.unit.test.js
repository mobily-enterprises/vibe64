import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { runtimeConfigViewRecord } from "../../packages/vibe64-core/src/server/runtimeConfig.js";
import { sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function projectService(targetRoot, options = {}) {
  return createService({
    env: {},
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    }),
    ...options
  });
}

// A neutral host: public must show only what the host says.
function testVault(values = [], { fail = null } = {}) {
  const calls = [];
  return {
    calls,
    label: "Test vault",
    async valuesForProject(input) {
      calls.push(input);
      if (fail) throw fail;
      return { contract: "vibe64.saved-env-values.v1", values };
    },
    async list() { return { entries: [] }; },
    async link() { return { ok: true }; },
    async unlink() { return { ok: true }; }
  };
}

const declaration = (resources = []) => () => ({
  components: [],
  environmentDefaults: [{ name: "PAYMENTS_MODE", value: "test" }],
  files: [],
  resources,
  status: "ready"
});

function record(env, key) {
  return env.records.find((candidate) => candidate.key === key);
}

test("without a provider Env is unchanged and a provider must have the full shape", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, { inspectEnvironment: declaration() });
    const state = await service.readEnv({ environment: "dev" });
    assert.equal(state.ok, true);
    assert.equal(state.env.records.some((candidate) => candidate.source === "vibe64-host:saved-value"), false);
    assert.throws(() => service.setSavedEnvValueProvider({ label: "Test vault", valuesForProject() {} }), TypeError);
    assert.throws(() => service.setSavedEnvValueProvider({ ...testVault(), label: "" }), TypeError);
    service.setSavedEnvValueProvider(testVault());
    service.setSavedEnvValueProvider(null);
  });
});

test("linked values become non-editable rows with the host's label, beat Stack defaults and stale user values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, { inspectEnvironment: declaration() });
    const saved = await service.saveEnvUserValues({ environment: "dev", values: { PAYMENTS_KEY: { value: "typed-before-linking" } } });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const vault = testVault([
      { key: "PAYMENTS_KEY", value: "sk_test_linked", secret: true, label: "From Test vault: Payments — main" },
      { key: "PAYMENTS_MODE", value: "live", secret: false, label: "From Test vault: Payments — main" },
      { key: "PUBLIC_TOKEN", value: "pk_public", secret: false },
      { key: "VIBE64_PRIVATE", value: "never" },
      { key: "NODE_OPTIONS", value: "--require evil" }
    ]);
    service.setSavedEnvValueProvider(vault);

    const { env } = await service.readEnv({ environment: "dev" });
    assert.deepEqual(record(env, "PAYMENTS_KEY"), {
      editable: false, key: "PAYMENTS_KEY", label: "From Test vault: Payments — main", missing: false, owner: "system",
      requiredFor: [], scope: "dev", secret: true, source: "vibe64-host:saved-value", value: "********", valuePresent: true
    });
    assert.equal(record(env, "PAYMENTS_MODE").value, "live", "a linked value replaces the Stack default");
    assert.equal(record(env, "PUBLIC_TOKEN").label, "Test vault", "the host's own label is the fallback provenance");
    assert.equal(record(env, "PUBLIC_TOKEN").secret, false);
    assert.equal(record(env, "VIBE64_PRIVATE"), undefined);
    assert.equal(record(env, "NODE_OPTIONS"), undefined);
    assert.equal(vault.calls.at(-1).projectContextRoot, targetRoot);

    const environment = await service.projectInspectionEnvironment({});
    assert.equal(environment.PAYMENTS_KEY, "sk_test_linked");
    assert.equal(environment.PAYMENTS_MODE, "live");
    assert.equal(environment.NODE_OPTIONS, undefined);

    const refused = await service.saveEnvUserValues({ environment: "dev", values: { PAYMENTS_KEY: { value: "typed" } } });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "vibe64_env_value_linked");
    assert.equal(refused.error, "PAYMENTS_KEY is linked to a saved value. Unlink it before entering a value here.");

    const production = await service.readEnv({ environment: "prod" });
    assert.equal(production.env.records.some((candidate) => candidate.source === "vibe64-host:saved-value"), false,
      "saved values reach Development only through this seam");
  });
});

test("secret linked values stay out of the resource configuration fingerprint values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, { inspectEnvironment: declaration() });
    service.setSavedEnvValueProvider(testVault([{ key: "API_TOKEN", value: "first", secret: true }]));
    const first = await service.projectInspectionEnvironment({ includeResourceConfiguration: true });
    service.setSavedEnvValueProvider(testVault([{ key: "API_TOKEN", value: "rotated", secret: true }]));
    const second = await service.projectInspectionEnvironment({ includeResourceConfiguration: true });
    assert.equal(second.environment.API_TOKEN, "rotated");
    assert.equal(first.resourceConfigurationFingerprint, second.resourceConfigurationFingerprint);
    service.setSavedEnvValueProvider(testVault([{ key: "API_TOKEN", value: "first", secret: false }]));
    assert.notEqual((await service.projectInspectionEnvironment({ includeResourceConfiguration: true })).resourceConfigurationFingerprint,
      first.resourceConfigurationFingerprint);
  });
});

test("a managed resource binding wins over a linked value of the same name", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "saved-collision";
    await mkdir(path.join(sourcePath(targetRoot, sessionId), ".git", "info"), { recursive: true });
    const resource = { component: "example", resource: { id: "service", kind: "example",
      environmentAlternatives: [{ preferred: true, bindings: { endpoint: "SERVICE_ENDPOINT" } }] } };
    const service = projectService(targetRoot, { inspectEnvironment: declaration([resource]) });
    const provided = () => ({ contract: "vibe64.resource-environment.v2", ok: true, prepared: true,
      resourceValues: [{ declaration: { component: "example", id: "service", kind: "example" }, values: { endpoint: "https://managed.example.test" } }] });
    service.setResourceEnvironmentProvider({ managedDevelopmentDatabase: true,
      environmentForProvisionedResources: provided, environmentForResources: provided });
    service.setSavedEnvValueProvider(testVault([{ key: "SERVICE_ENDPOINT", value: "https://linked.example.test", secret: false }]));
    const runtime = await service.createRuntime({ inspectSource: false });
    await runtime.store.createSession({ metadata: sourceMetadata(targetRoot, sessionId), runtimeKind: "genesis", sessionId });

    assert.equal((await service.projectInspectionEnvironment({ sessionId })).SERVICE_ENDPOINT, "https://managed.example.test");
    const row = record((await service.readEnv({ environment: "dev", sessionId })).env, "SERVICE_ENDPOINT");
    assert.equal(row.value, "https://managed.example.test");
    assert.match(row.source, /^vibe64-host:managed-resource/u);
  });
});

test("a failing or malformed provider fails the read instead of dropping values", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, { inspectEnvironment: declaration() });
    service.setSavedEnvValueProvider(testVault([], { fail: new Error("The vault is locked.") }));
    const failed = await service.readEnv({ environment: "dev" });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "vibe64_saved_env_values_unavailable");
    assert.equal(failed.error, "The vault is locked.");
    await assert.rejects(() => service.projectInspectionEnvironment({}), { code: "vibe64_saved_env_values_unavailable" });
    for (const values of [[{ key: "1BAD", value: "x" }], [{ key: "A", value: 3 }], [{ key: "A", value: "x" }, { key: "A", value: "y" }]]) {
      service.setSavedEnvValueProvider(testVault(values));
      assert.equal((await service.readEnv({ environment: "dev" })).code, "vibe64_saved_env_values_unavailable");
    }
    service.setSavedEnvValueProvider({ ...testVault(), valuesForProject: async () => ({ contract: "other", values: [] }) });
    assert.equal((await service.readEnv({ environment: "dev" })).code, "vibe64_saved_env_values_unavailable");
  });
});

test("records carry an optional one-line label for display only", () => {
  assert.equal(runtimeConfigViewRecord({ key: "A", value: "x", owner: "system", label: "From a host" }).label, "From a host");
  assert.equal(Object.hasOwn(runtimeConfigViewRecord({ key: "A", value: "x" }), "label"), false);
  assert.throws(() => runtimeConfigViewRecord({ key: "A", label: "two\nlines" }), { code: "vibe64_runtime_config_label_invalid" });
  assert.throws(() => runtimeConfigViewRecord({ key: "A", label: "x".repeat(201) }), { code: "vibe64_runtime_config_label_invalid" });
});

test("public names no host behind the saved-value seam", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\0")
    .filter((file) => file && file !== "package-lock.json" && !file.startsWith(".genesis/"))
    .filter((file) => existsSync(path.join(REPO_ROOT, file)) && lstatSync(path.join(REPO_ROOT, file)).isFile());
  const hostNames = /Keys (?:&|and) accounts|\/api\/vibe64\/keys|Vibe64 Online|private-online/u;
  const findings = files.filter((file) => {
    const content = readFileSync(path.join(REPO_ROOT, file));
    return !content.includes(0) && hostNames.test(content.toString("utf8"));
  });
  assert.deepEqual(findings.filter((file) => file !== "tests/server/savedEnvValues.unit.test.js"), []);
});
