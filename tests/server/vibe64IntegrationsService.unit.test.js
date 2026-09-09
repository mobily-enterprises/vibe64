import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createService } from "../../packages/vibe64-source-editor/src/server/service.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";

const configuration = () => ({
  schemaVersion: 1,
  integrations: { calendar: {
    provider: "google-calendar", displayName: "Team calendar", accountMode: "shared",
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    authentication: { method: "oauth2", registrationRef: "google" },
    extensions: { application: { color: "blue" } }
  } },
  registrations: { google: { source: "own", clientId: "fixture.apps.googleusercontent.com",
    clientSecretRef: "env:GOOGLE_CLIENT_SECRET", callbackUrlRef: "env:GOOGLE_CALLBACK_URL" } },
  extensions: { unrelated: { keep: true } }
});

async function fixture(t, { locked = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-integrations-"));
  const source = path.join(root, "sessions", "active", "one", "source");
  await mkdir(source, { recursive: true });
  const service = createService({
    temporaryRoot: path.join(root, "temporary"),
    projectService: { createRuntime: async () => ({
      stateRoot: path.join(root, "state"),
      store: { runSessionExclusive: async (_id, lock, work) => {
        assert.equal(lock, "agent-write-mode");
        return locked ? { acquired: false } : { acquired: true, value: await work() };
      } },
      getSession: async (sessionId) => ({ sessionId, metadata: {
        source_kind: "session_clone", source_path: source,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      } })
    }) }
  });
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, source, service };
}

test("UI configuration writes the CLI file and preserves extensions through later CLI changes", async (t) => {
  const { source, service } = await fixture(t);
  const input = { sessionId: "one", projectSlug: "example", originId: "tab-one" };
  const initial = await service.readIntegrations(input);
  assert.deepEqual(initial, { ok: true, baseHash: null, configuration: { schemaVersion: 1, integrations: {}, registrations: {} } });
  const saved = await service.saveIntegrations({ ...input, configuration: configuration(), baseHash: null });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.fileChange.path, "integrations.json");
  assert.equal(saved.fileChange.originId, "tab-one");
  assert.deepEqual(JSON.parse(await readFile(path.join(source, "integrations.json"), "utf8")), configuration());
  const cli = configuration();
  cli.integrations.calendar.displayName = "Changed in CLI";
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(cli));
  const reread = await service.readIntegrations(input);
  assert.equal(reread.configuration.integrations.calendar.displayName, "Changed in CLI");
  assert.notEqual(reread.baseHash, saved.baseHash);
  reread.configuration.integrations.calendar.accountMode = "per-user";
  const updated = await service.saveIntegrations({ ...input, ...reread });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.configuration.extensions, cli.extensions);
  assert.deepEqual(updated.configuration.integrations.calendar.extensions, cli.integrations.calendar.extensions);
});

test("conflicting creates, stale saves, and missing versions preserve the existing file", async (t) => {
  const { service, source } = await fixture(t);
  const input = { sessionId: "one", configuration: configuration() };
  const first = await service.saveIntegrations({ ...input, baseHash: null });
  assert.equal(first.ok, true);
  const original = await readFile(path.join(source, "integrations.json"), "utf8");
  for (const baseHash of [null, "a".repeat(64), "", undefined]) {
    const response = await service.saveIntegrations({ ...input, baseHash });
    assert.equal(response.ok, false);
    assert.equal(response.statusCode, 409);
    assert.equal(await readFile(path.join(source, "integrations.json"), "utf8"), original);
  }
});

test("invalid values and raw credentials never create a file; malformed files are not replaced", async (t) => {
  const { service, source } = await fixture(t);
  const invalid = configuration();
  invalid.registrations.google.clientSecret = "never-store-me";
  const response = await service.saveIntegrations({ sessionId: "one", baseHash: null, configuration: invalid });
  assert.equal(response.statusCode, 422);
  assert.ok(response.fieldErrors);
  await assert.rejects(readFile(path.join(source, "integrations.json")), { code: "ENOENT" });
  await writeFile(path.join(source, "integrations.json"), "{invalid");
  const read = await service.readIntegrations({ sessionId: "one" });
  assert.equal(read.ok, false);
  assert.equal(read.statusCode, 422);
  assert.equal(await readFile(path.join(source, "integrations.json"), "utf8"), "{invalid");
});

test("source locks and symlink protections also cover integration configuration", async (t) => {
  const locked = await fixture(t, { locked: true });
  const response = await locked.service.saveIntegrations({ sessionId: "one", baseHash: null, configuration: configuration() });
  assert.equal(response.statusCode, 409);
  await assert.rejects(readFile(path.join(locked.source, "integrations.json")), { code: "ENOENT" });
  const open = await fixture(t);
  const outside = path.join(open.root, "outside.json");
  await writeFile(outside, JSON.stringify(configuration()));
  await symlink(outside, path.join(open.source, "integrations.json"));
  const read = await open.service.readIntegrations({ sessionId: "one" });
  assert.equal(read.ok, false);
  const save = await open.service.saveIntegrations({ sessionId: "one", baseHash: null, configuration: configuration() });
  assert.equal(save.ok, false);
  assert.deepEqual(JSON.parse(await readFile(outside, "utf8")), configuration());
});

test("provider settings are validated on save while unknown provider records remain portable", async (t) => {
  const { service, source } = await fixture(t);
  const config = configuration();
  config.integrations.mail = {
    provider: "mailgun", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:MAILGUN_KEY" }, settings: { region: "elsewhere" }
  };
  config.integrations.custom = {
    provider: "application-provider", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:CUSTOM_KEY" }, settings: { resource: "keep-this" }
  };
  const rejected = await service.saveIntegrations({ sessionId: "one", baseHash: null, configuration: config });
  assert.equal(rejected.statusCode, 422);
  assert.ok(rejected.fieldErrors["integrations.mail.settings.region"]);
  await assert.rejects(readFile(path.join(source, "integrations.json")), { code: "ENOENT" });
  config.integrations.mail.settings = {};
  const saved = await service.saveIntegrations({ sessionId: "one", baseHash: null, configuration: config });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(saved.configuration.integrations.mail.settings, { region: "us" });
  assert.deepEqual(saved.configuration.integrations.custom, config.integrations.custom);
  const file = JSON.parse(await readFile(path.join(source, "integrations.json"), "utf8"));
  assert.deepEqual(file, saved.configuration);
});
