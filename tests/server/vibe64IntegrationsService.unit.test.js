import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server";
import { initializeGenesisProject } from "@local/vibe64-genesis/server";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { createService, runApplicationIntegrationSetup } from "../../packages/vibe64-source-editor/src/server/service.js";
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

async function fixture(t, { locked = false, setup = false, prepareEnvironment, executeCommand = false, conversation = false, authorize, commandResult, duringCommand, integrationDiscoveryFetch, envRecords = [], saveRegistrationEnv } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-integrations-"));
  const source = path.join(root, "sessions", "active", "one", "source");
  await mkdir(source, { recursive: true });
  const store = conversation ? createVibe64SessionStore({
    projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime")
  }) : null;
  if (store) await store.createSession({ runtimeKind: "genesis", sessionId: "one" });
  const notifications = [];
  const calls = [];
  const environmentCalls = [];
  if (setup) {
    await promisify(execFile)("git", ["init", "--quiet"], { cwd: source });
    await initializeGenesisProject({ projectRoot: source });
    const stack = path.join(source, "genesis/stack.md");
    await writeFile(stack, `${await readFile(stack, "utf8")}
## Integration setup

- Command with \`nodejs\` in \`.\`: \`node\` \`scripts/integrations.js\`
`);
  }
  const service = createService({
    integrationDiscoveryFetch,
    publishSessionChanged: async (...args) => { notifications.push(args); },
    terminalService: authorize ? { requireAssistantAccess: authorize } : undefined,
    integrationCommandRunner: async (command) => {
      calls.push(command);
      if (executeCommand) return runVibe64Command(command);
      await duringCommand?.(store);
      const request = JSON.parse(command.input);
      return { ok: true, stdout: JSON.stringify({ protocol: request.protocol, requestId: request.requestId,
        status: request.operation === "cancel" ? "cancelled" : "disconnected", ...commandResult }) };
    },
    temporaryRoot: path.join(root, "temporary"),
    projectService: {
      readEnv: async () => ({ ok: true, env: { records: envRecords } }),
      saveEnvUserValues: async (input) => saveRegistrationEnv ? saveRegistrationEnv(input) : { ok: false },
      projectExecutionEnvironment: async (input) => {
        environmentCalls.push(input);
        await prepareEnvironment?.(source);
        assert.deepEqual(input, { sessionId: "one", reusePrepared: true });
        return { GOOGLE_CLIENT_SECRET: "fixture-private", GOOGLE_CALLBACK_URL: "https://app.example/integrations/google/callback" };
      },
      readCurrentProject: async () => ({ slug: "example" }),
      createRuntime: async () => ({
      stateRoot: path.join(root, "state"),
      store: store || { runSessionExclusive: async (_id, lock, work) => {
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
  return { root, source, service, calls, environmentCalls, store, notifications };
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


test("application setup uses saved declaration, project Env and exact session source without changing configuration", async (t) => {
  const { service, source, calls } = await fixture(t, { setup: true });
  const file = path.join(source, "integrations.json");
  const saved = JSON.stringify(configuration());
  await writeFile(file, saved);
  const input = { sessionId: "one", environment: "development", integrationId: "calendar", operation: "status" };
  const response = await service.runIntegrationSetup(input);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.status, "disconnected");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "node");
  assert.deepEqual(calls[0].args, ["scripts/integrations.js"]);
  assert.equal(calls[0].cwd, source);
  assert.deepEqual(calls[0].allowedRoots, [source]);
  assert.deepEqual(calls[0].runtimes, ["node26"]);
  assert.equal(calls[0].env.GOOGLE_CLIENT_SECRET, "fixture-private");
  assert.equal(JSON.stringify(response).includes("fixture-private"), false);
  assert.equal(await readFile(file, "utf8"), saved);
});

test("saved setup declaration executes through the service and real application process", async (t) => {
  const { service, source, calls, environmentCalls } = await fixture(t, { setup: true, executeCommand: true });
  const file = path.join(source, "integrations.json");
  const saved = JSON.stringify(configuration());
  await writeFile(file, saved);
  await mkdir(path.join(source, "scripts"));
  await writeFile(path.join(source, "scripts/integrations.js"), `
    const fs = require("node:fs");
    const request = JSON.parse(fs.readFileSync(0, "utf8"));
    const configuration = JSON.parse(fs.readFileSync("integrations.json", "utf8"));
    if (request.integrationId !== "calendar" ||
        configuration.integrations.calendar.accountMode !== "shared" ||
        process.env.GOOGLE_CLIENT_SECRET !== "fixture-private") process.exit(2);
    process.stdout.write(JSON.stringify({ protocol: request.protocol,
      requestId: request.requestId, status: "disconnected",
      callbackUrl: process.env.GOOGLE_CALLBACK_URL }) + "\\n");
  `);
  const response = await service.runIntegrationSetup({
    sessionId: "one", environment: "development", integrationId: "calendar", operation: "status"
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.status, "disconnected");
  assert.equal(response.callbackUrl, "https://app.example/integrations/google/callback");
  assert.equal(calls.length, 1);
  assert.equal(environmentCalls.length, 1);
  assert.equal(calls[0].session.sessionId, "one");
  assert.equal(calls[0].project.slug, "example");
  assert.equal(await readFile(file, "utf8"), saved);
  assert.equal(JSON.stringify(response).includes("fixture-private"), false);
});

test("setup refuses production, missing integrations and personal account connections before command execution", async (t) => {
  const { service, source, calls, environmentCalls } = await fixture(t, { setup: true });
  const config = configuration();
  config.integrations.calendar.accountMode = "per-user";
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(config));
  const input = { sessionId: "one", environment: "development", integrationId: "calendar", operation: "connect" };
  assert.equal((await service.runIntegrationSetup({ ...input, environment: "production" })).statusCode, 422);
  assert.equal((await service.runIntegrationSetup({ ...input, integrationId: "absent" })).statusCode, 404);
  assert.equal((await service.runIntegrationSetup(input)).statusCode, 422);
  assert.equal((await service.runIntegrationSetup({ ...input, operation: "invalid" })).statusCode, 422);
  assert.equal((await service.runIntegrationSetup({ ...input, operation: "cancel" })).statusCode, 422);
  assert.equal(calls.length, 0);
  assert.equal(environmentCalls.length, 0);
});

test("setup requires an available source lock and never infers a missing application command", async (t) => {
  const input = { sessionId: "one", environment: "development", integrationId: "calendar", operation: "status" };
  const locked = await fixture(t, { locked: true, setup: true });
  await writeFile(path.join(locked.source, "integrations.json"), JSON.stringify(configuration()));
  assert.equal((await locked.service.runIntegrationSetup(input)).statusCode, 409);
  assert.equal(locked.calls.length, 0);
  assert.equal(locked.environmentCalls.length, 0);
  const missing = await fixture(t, { setup: true });
  await writeFile(path.join(missing.source, "integrations.json"), JSON.stringify(configuration()));
  const stack = path.join(missing.source, "genesis/stack.md");
  await writeFile(stack, (await readFile(stack, "utf8")).split("## Integration setup")[0]);
  const response = await missing.service.runIntegrationSetup(input);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.status, "unconfigured");
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.environmentCalls.length, 0);
});


test("setup rechecks application ownership after Env preparation", async (t) => {
  const { service, source, calls, environmentCalls } = await fixture(t, {
    setup: true,
    prepareEnvironment: async (root) => {
      const config = configuration();
      config.integrations.calendar.accountMode = "per-user";
      await writeFile(path.join(root, "integrations.json"), JSON.stringify(config));
    }
  });
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(configuration()));
  const response = await service.runIntegrationSetup({
    sessionId: "one", environment: "development", integrationId: "calendar", operation: "connect"
  });
  assert.equal(response.statusCode, 422);
  assert.equal(environmentCalls.length, 1);
  assert.equal(calls.length, 0);
});


test("release setup uses its saved declaration and Env reference without a session", async (t) => {
  const { source } = await fixture(t, { setup: true });
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(configuration()));
  const environmentFile = path.join(source, "../service/environment");
  let called = false;
  const result = await runApplicationIntegrationSetup({
    sourceRoot: source, releaseEnvironmentFile: environmentFile,
    project: { slug: "example" },
    selection: { operation: "status", integrationId: "calendar" },
    runCommand: async (command) => {
      called = true;
      assert.equal(command.cwd, source);
      assert.deepEqual(command.args, ["scripts/integrations.js"]);
      assert.equal(command.releaseEnvironmentFile, environmentFile);
      assert.equal(command.envPolicy, "deployment");
      assert.equal(command.env, undefined);
      assert.equal(command.session, undefined);
      const request = JSON.parse(command.input);
      return { ok: true, stdout: JSON.stringify({ protocol: request.protocol, requestId: request.requestId, status: "connected" }) };
    }
  });
  assert.equal(result.status, "connected");
  assert.equal(called, true);
  await assert.rejects(runApplicationIntegrationSetup({
    sourceRoot: source, releaseEnvironmentFile: environmentFile,
    selection: { operation: "connect", integrationId: "missing" },
    runCommand: async () => assert.fail("Missing slot cannot execute")
  }), { code: "vibe64_integration_missing" });
});


test("setup rejects results when configuration changes during the application command", async (t) => {
  const { source } = await fixture(t, { setup: true });
  const configPath = path.join(source, "integrations.json");
  const original = JSON.stringify(configuration());
  for (const change of ["registration", "removed"]) {
    await writeFile(configPath, original);
    let calls = 0;
    await assert.rejects(runApplicationIntegrationSetup({
      sourceRoot: source,
      selection: { operation: "connect", integrationId: "calendar" },
      runCommand: async (command) => {
        calls += 1;
        if (change === "removed") await rm(configPath);
        else {
          const changed = configuration();
          changed.registrations.google.clientId = "replacement.apps.googleusercontent.com";
          await writeFile(configPath, JSON.stringify(changed));
        }
        const request = JSON.parse(command.input);
        return { ok: true, stdout: JSON.stringify({
          protocol: request.protocol, requestId: request.requestId,
          status: "connected", verifiedAt: "2026-09-11T08:00:00.000Z"
        }) };
      }
    }), { code: "vibe64_integration_configuration_changed", statusCode: 409 });
    assert.equal(calls, 1, "a changed configuration must not automatically repeat connection side effects");
  }
});


test("chat Connect recovers pending consent instead of creating a replacement attempt", async (t) => {
  const commandResult = { status: "disconnected" };
  let executions = 0;
  const { source, store, service, calls } = await fixture(t, {
    setup: true, conversation: true, authorize: async () => {}, commandResult,
    duringCommand: async () => {
      if (++executions === 2) Object.assign(commandResult, {
        status: "pending", authorizationUrl: "https://accounts.example/consent?state=attempt-one",
        attemptId: "attempt-one", expiresAt: "2030-01-01T00:00:00Z"
      });
    }
  });
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(configuration()));
  await store.writeConversationUserMessage("one", { text: "Configure calendar." });
  const turn = await store.writeConversationAssistantMessage("one", {
    text: '```vibe64-integration\n{"integrationId":"calendar"}\n```'
  });
  const { baseHash } = await service.readIntegrations({ sessionId: "one" });
  const input = { sessionId: "one", environment: "development", integrationId: "calendar", operation: "connect",
    setupRequest: { turnId: turn.turnId, requestId: turn.integrationSetup.requestId, configurationHash: baseHash } };
  const initial = await service.runIntegrationSetup(input);
  assert.equal(initial.status, "pending", JSON.stringify(initial));
  const repeated = await service.runIntegrationSetup(input);
  assert.equal(repeated.attemptId, initial.attemptId);
  assert.equal(repeated.authorizationUrl, initial.authorizationUrl);
  assert.deepEqual(calls.map((command) => JSON.parse(command.input).operation), ["status", "connect", "status"]);
  assert.equal((await store.readIntegrationSetupRequest("one", turn.turnId)).outcome, "pending");
});

test("setup completes a member's saved request without access to the main personal AI", async (t) => {
  const actor = { username: "member", role: "member" };
  const { source, store, service, calls, notifications } = await fixture(t, {
    setup: true, conversation: true,
    authorize: async () => { throw new Error("No access to the main personal AI."); },
    commandResult: { status: "connected", verifiedAt: "2026-09-11T08:00:00.000Z" }
  });
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(configuration()));
  await store.writeConversationUserMessage("one", { text: "Configure calendar." });
  const turn = await store.writeConversationAssistantMessage("one", {
    text: 'Configure calendar.\n\n```vibe64-integration\n{"integrationId":"calendar"}\n```'
  });
  const { baseHash } = await service.readIntegrations({ sessionId: "one" });
  const input = { sessionId: "one", environment: "development", integrationId: "calendar", operation: "status",
    vibe64User: actor, setupRequest: { turnId: turn.turnId, requestId: turn.integrationSetup.requestId, configurationHash: baseHash } };
  const result = await service.runIntegrationSetup(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.integrationSetup.outcome, "completed");
  assert.equal(result.integrationSetup.configurationHash, baseHash);
  assert.deepEqual(await store.readIntegrationSetupRequest("one", turn.turnId), result.integrationSetup);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].input).setupRequest, undefined, "editor request metadata stays out of the application protocol");
  assert.equal((await service.runIntegrationSetup({ ...input, operation: "connect" })).code, "vibe64_integration_setup_request_decided");
  assert.equal(calls.length, 1, "a decided request cannot trigger another connection operation");
  const restored = await service.runIntegrationSetup(input);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.deepEqual(restored.integrationSetup, result.integrationSetup);
  assert.equal(calls.length, 2, "status may check live connection state while restoring the prior decision");
  assert.deepEqual(notifications, [["one", { reason: "integration-setup-completed", session: null }]],
    "restoration must not rebroadcast completion or include provider metadata");
});

test("setup refuses untrusted request association before application execution", async (t) => {
  const { source, store, service, calls, environmentCalls } = await fixture(t, {
    setup: true, conversation: true
  });
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(configuration()));
  await store.writeConversationUserMessage("one", { text: "Configure calendar." });
  const turn = await store.writeConversationAssistantMessage("one", {
    text: '```vibe64-integration\n{"integrationId":"calendar"}\n```'
  });
  const { baseHash } = await service.readIntegrations({ sessionId: "one" });
  const setupRequest = { turnId: turn.turnId, requestId: turn.integrationSetup.requestId, configurationHash: baseHash };
  const input = { sessionId: "one", environment: "development", integrationId: "calendar", operation: "connect",
    vibe64User: { username: "owner" }, setupRequest };
  for (const [patch, code] of [
    [{ integrationId: "another-slot" }, "vibe64_integration_setup_request_changed"],
    [{ setupRequest: { ...setupRequest, configurationHash: "a".repeat(64) } }, "vibe64_integration_configuration_changed"],
    [{ setupRequest: { ...setupRequest, requestId: "b".repeat(64) } }, "vibe64_integration_setup_request_changed"],
    [{ setupRequest: { ...setupRequest, status: "connected" } }, "vibe64_invalid_integration_setup_request"]
  ]) assert.equal((await service.runIntegrationSetup({ ...input, ...patch })).code, code);
  assert.equal(calls.length, 0);
  assert.equal(environmentCalls.length, 0);
  assert.equal((await store.readIntegrationSetupRequest("one", turn.turnId)).outcome, "pending");
});


test("setup does not complete unverified results or overwrite Skip during command execution", async (t) => {
  for (const skipDuringCommand of [false, true]) {
    let setupRequest;
    const { source, store, service } = await fixture(t, {
      setup: true, conversation: true, authorize: async () => {},
      commandResult: { status: "connected", ...(skipDuringCommand ? { verifiedAt: "2026-09-11T08:00:00.000Z" } : {}) },
      duringCommand: async (activeStore) => {
        if (skipDuringCommand) await activeStore.skipIntegrationSetupRequest("one", setupRequest);
      }
    });
    await writeFile(path.join(source, "integrations.json"), JSON.stringify(configuration()));
    await store.writeConversationUserMessage("one", { text: "Configure calendar." });
    const turn = await store.writeConversationAssistantMessage("one", {
      text: '```vibe64-integration\n{"integrationId":"calendar"}\n```'
    });
    const { baseHash } = await service.readIntegrations({ sessionId: "one" });
    setupRequest = { turnId: turn.turnId, requestId: turn.integrationSetup.requestId, configurationHash: baseHash };
    const result = await service.runIntegrationSetup({ sessionId: "one", environment: "development",
      integrationId: "calendar", operation: "status", setupRequest });
    if (skipDuringCommand) {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.integrationSetup.outcome, "skipped");
    } else assert.equal(result.code, "vibe64_integration_setup_unverified");
    assert.equal((await store.readIntegrationSetupRequest("one", turn.turnId)).outcome,
      skipDuringCommand ? "skipped" : "pending");
  }
});

test("concurrent chat connects share consent while separate requests retain their decisions", async (t) => {
  const commandResult = { status: "disconnected" };
  let executions = 0;
  const { source, store, service, calls } = await fixture(t, {
    setup: true, conversation: true, authorize: async () => {}, commandResult,
    duringCommand: async () => {
      if (++executions === 2) Object.assign(commandResult, {
        status: "pending", authorizationUrl: "https://accounts.example/consent?state=shared-attempt",
        attemptId: "shared-attempt", expiresAt: "2030-01-01T00:00:00Z"
      });
    }
  });
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(configuration()));
  await store.writeConversationUserMessage("one", { text: "Configure calendar." });
  const first = await store.writeConversationAssistantMessage("one", {
    text: '```vibe64-integration\n{"integrationId":"calendar"}\n```'
  });
  await store.writeConversationUserMessage("one", { text: "Use that calendar for another task." });
  const second = await store.writeConversationAssistantMessage("one", {
    text: 'Another task.\n\n```vibe64-integration\n{"integrationId":"calendar"}\n```'
  });
  const { baseHash } = await service.readIntegrations({ sessionId: "one" });
  const input = (turn) => ({ sessionId: "one", environment: "development", integrationId: "calendar", operation: "connect",
    setupRequest: { turnId: turn.turnId, requestId: turn.integrationSetup.requestId, configurationHash: baseHash } });
  await Promise.all([service.runIntegrationSetup(input(first)), service.runIntegrationSetup(input(first))]);
  // A lock contender may be refused; a subsequent explicit retry must recover
  // the existing application attempt instead of creating another one.
  assert.equal((await service.runIntegrationSetup(input(first))).attemptId, "shared-attempt");
  assert.equal((await service.runIntegrationSetup(input(second))).attemptId, "shared-attempt");
  assert.equal(calls.filter((command) => JSON.parse(command.input).operation === "connect").length, 1);
  await store.skipIntegrationSetupRequest("one", input(first).setupRequest);
  assert.equal((await store.readIntegrationSetupRequest("one", first.turnId)).outcome, "skipped");
  assert.equal((await store.readIntegrationSetupRequest("one", second.turnId)).outcome, "pending");
  assert.equal(calls.some((command) => ["cancel", "disconnect"].includes(JSON.parse(command.input).operation)), false);
});


for (const integration of [
  { provider: "mapbox", accountMode: "shared", scopes: [], authentication: { method: "none" }, settings: { usage: "browser", publicTokenRef: "env:MAPBOX_PUBLIC_TOKEN" } },
  { provider: "google-analytics", accountMode: "shared", scopes: [], authentication: { method: "none" }, settings: { measurementId: "G-ABC1234567" } },
  { provider: "logo-dev", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:LOGO_DEV_PUBLISHABLE_KEY" } }
]) test(`Public configuration ${integration.provider} refuses setup before Env preparation or command execution`, async (t) => {
  const { service, source, calls, environmentCalls } = await fixture(t, { setup: true });
  await writeFile(path.join(source, "integrations.json"), JSON.stringify({
    schemaVersion: 1, registrations: {}, integrations: { analytics: integration }
  }));
  for (const operation of ["status", "connect", "disconnect"]) {
    const result = await service.runIntegrationSetup({ sessionId: "one", environment: "development", integrationId: "analytics", operation });
    assert.equal(result.statusCode, 422);
    assert.match(JSON.stringify(result), /vibe64_integration_configuration_only/);
  }
  assert.equal(calls.length, 0);
  assert.equal(environmentCalls.length, 0);
});


test("n8n OAuth discovery reads only public metadata and leaves project source and Env untouched", async (t) => {
  const resource = "https://tools.example/mcp-server/http";
  const issuer = "https://auth.example/n8n";
  const calls = [];
  const { service, environmentCalls } = await fixture(t, { integrationDiscoveryFetch: async (url, options) => {
    calls.push(String(url));
    assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    assert.equal(new Headers(options.headers).has("authorization"), false);
    return Response.json(calls.length === 1 ? { resource, authorization_servers: [issuer], scopes_supported: ["workflow:read"] } : {
      issuer, authorization_endpoint: `${issuer}/mcp-oauth/authorize`, token_endpoint: `${issuer}/mcp-oauth/token`,
      registration_endpoint: `${issuer}/mcp-oauth/register`, scopes_supported: ["workflow:read"],
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_post"]
    });
  } });
  const before = await service.readIntegrations({ sessionId: "one" });
  const result = await service.discoverN8nIntegration({ sessionId: "one", serverUrl: resource });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.discovery.oauth.issuer, issuer);
  assert.deepEqual(result.discovery.scopes, ["workflow:read"]);
  assert.equal(calls.length, 2); assert.equal(environmentCalls.length, 0);
  assert.deepEqual(await service.readIntegrations({ sessionId: "one" }), before);
  assert.equal((await service.discoverN8nIntegration({ sessionId: "one", serverUrl: "http://bad.example" })).ok, false);
  assert.equal((await service.discoverN8nIntegration({ sessionId: "", serverUrl: resource })).ok, false);
  assert.equal(calls.length, 2);
});


test("n8n client registration saves private Env before public source and rejects replay", async (t) => {
  const resource = "https://tools.example/mcp-server/http";
  const issuer = "https://auth.example/n8n";
  const oauth = { issuer, authorization_endpoint: `${issuer}/mcp-oauth/authorize`, token_endpoint: `${issuer}/mcp-oauth/token`,
    registration_endpoint: `${issuer}/mcp-oauth/register`, scopes_supported: ["workflow:read"], response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"] };
  const posts = [];
  const envWrites = [];
  const fetchImpl = async (url, options) => {
    if (options.method === "POST") {
      posts.push({ url: String(url), body: JSON.parse(options.body) });
      return Response.json({ ...JSON.parse(options.body), client_id: "created-client", client_secret: "private-created-secret" });
    }
    return Response.json(String(url).includes("oauth-protected-resource") ? {
      resource, authorization_servers: [issuer], scopes_supported: ["workflow:read"]
    } : oauth);
  };
  const draft = { schemaVersion: 1, registrations: { n8n: { source: "own", clientId: "",
    clientSecretRef: "env:N8N_CLIENT_SECRET", callbackUrlRef: "env:N8N_CALLBACK_URL" } }, integrations: {
    n8n: { provider: "n8n", accountMode: "assistant", scopes: ["workflow:read"], authentication: { method: "oauth2", registrationRef: "n8n" },
      settings: { serverUrl: resource, oauthDiscovery: { resource, oauth, scopes: ["workflow:read"] } } }
  } };
  const { service, source } = await fixture(t, { integrationDiscoveryFetch: fetchImpl, saveRegistrationEnv: async (input) => {
    envWrites.push(input); return { ok: true };
  } });
  const input = { sessionId: "one", integrationId: "n8n", baseHash: null, configuration: draft,
    callbackUrl: "https://app.example/integrations/n8n/callback", vibe64User: { role: "owner" } };
  const result = await service.registerOAuthIntegration(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(posts.length, 1); assert.equal(posts[0].url, oauth.registration_endpoint);
  assert.equal(envWrites.length, 1); assert.equal(envWrites[0].environment, "dev");
  assert.deepEqual(envWrites[0].values.N8N_CLIENT_SECRET, { value: "private-created-secret", secret: true });
  assert.equal(envWrites[0].values.N8N_CLIENT_ID.value, "created-client");
  assert.equal(envWrites[0].values.N8N_CALLBACK_URL.value, input.callbackUrl);
  const text = await readFile(path.join(source, "integrations.json"), "utf8");
  assert.equal(JSON.parse(text).registrations.n8n.clientId, "created-client");
  assert.equal(text.includes("private-created-secret"), false);
  assert.equal(JSON.stringify(result).includes("private-created-secret"), false);
  assert.equal((await service.registerOAuthIntegration(input)).ok, false);
  assert.equal(posts.length, 1);
  const denied = await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } });
  assert.equal(denied.code, "vibe64_owner_required"); assert.equal(posts.length, 1);
  const existing = await fixture(t, { integrationDiscoveryFetch: fetchImpl, envRecords: [{ key: "N8N_CLIENT_SECRET", valuePresent: true }] });
  assert.equal((await existing.service.registerOAuthIntegration(input)).code, "vibe64_integration_registration_exists");
  assert.equal(posts.length, 1);
  const failed = await fixture(t, { integrationDiscoveryFetch: fetchImpl, saveRegistrationEnv: async () => ({ ok: false, error: "private-created-secret" }) });
  const incomplete = await failed.service.registerOAuthIntegration(input);
  assert.equal(incomplete.code, "vibe64_integration_registration_incomplete");
  assert.equal(JSON.stringify(incomplete).includes("private-created-secret"), false);
  assert.match(incomplete.error, /Recover that client/);
  assert.equal(posts.length, 2);
});

test("n8n registration uses real project Env and nested session locking", { timeout: 15000 }, async (t) => {
  const { createService: createProjectService } = await import("../../packages/vibe64-project/src/server/service.js");
  const { createStudioProjectContext } = await import("../../packages/vibe64-core/src/server/studioProjectContext.js");
  const root = await mkdtemp(path.join(tmpdir(), "n8n-real-env-"));
  const target = path.join(root, "project");
  const source = path.join(root, "managed-source", "project", "sessions", "active", "one", "source");
  await mkdir(target, { recursive: true }); await mkdir(source, { recursive: true });
  await promisify(execFile)("git", ["init", "--quiet"], { cwd: source });
  const project = createProjectService({ env: {},
    projectContext: createStudioProjectContext({ explicitManagedSourceRoot: path.join(root, "managed-source"),
      explicitSystemRoot: path.join(root, "system"), explicitTargetRoot: target, home: root }),
    inspectEnvironment: async () => ({ status: "ready", components: [], resources: [], environmentDefaults: [],
      files: [{ format: "dotenv", path: ".env" }] })
  });
  const store = await project.createSessionStore();
  await store.createSession({ sessionId: "one", runtimeKind: "genesis", metadata: {
    source_kind: "session_clone", source_path: source, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
  } });
  const resource = "https://tools.example/mcp-server/http";
  const issuer = "https://auth.example";
  let posts = 0;
  const service = createService({ projectService: project, temporaryRoot: path.join(root, "temporary"),
    integrationDiscoveryFetch: async (url, options) => {
      if (options.method === "POST") {
        posts++;
        return Response.json({ ...JSON.parse(options.body), client_id: "real-env-client", client_secret: "private-real-env-secret" });
      }
      return Response.json(String(url).includes("oauth-protected-resource") ? {
        resource, authorization_servers: [issuer], scopes_supported: ["workflow:read"]
      } : { issuer, authorization_endpoint: `${issuer}/mcp-oauth/authorize`, token_endpoint: `${issuer}/mcp-oauth/token`,
        registration_endpoint: `${issuer}/mcp-oauth/register`, scopes_supported: ["workflow:read"], response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["client_secret_post"],
        code_challenge_methods_supported: ["S256"] });
    }
  });
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  const discovered = await service.discoverN8nIntegration({ sessionId: "one", serverUrl: resource });
  assert.equal(discovered.ok, true, JSON.stringify(discovered));
  const result = await service.registerOAuthIntegration({ sessionId: "one", integrationId: "n8n", baseHash: null,
    callbackUrl: "https://app.example/integrations/n8n/callback", configuration: {
      schemaVersion: 1, registrations: { n8n: { source: "own", clientId: "", clientSecretRef: "env:N8N_CLIENT_SECRET", callbackUrlRef: "env:N8N_CALLBACK_URL" } },
      integrations: { n8n: { provider: "n8n", accountMode: "assistant", scopes: ["workflow:read"],
        authentication: { method: "oauth2", registrationRef: "n8n" }, settings: { serverUrl: resource, oauthDiscovery: discovered.discovery } } }
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(posts, 1);
  const env = await project.readEnv({ sessionId: "one", environment: "dev" });
  assert.equal(env.ok, true);
  assert.equal(env.env.records.find((record) => record.key === "N8N_CLIENT_SECRET").value, "********");
  assert.equal(JSON.stringify(env).includes("private-real-env-secret"), false);
  const secret = await project.revealEnvSecret({ sessionId: "one", environment: "dev", key: "N8N_CLIENT_SECRET" });
  assert.equal(secret.value, "private-real-env-secret");
  assert.match(await readFile(path.join(source, ".env"), "utf8"), /N8N_CLIENT_SECRET=private-real-env-secret/);
  assert.equal((await readFile(path.join(source, "integrations.json"), "utf8")).includes("private-real-env-secret"), false);
  assert.equal(JSON.stringify(result).includes("private-real-env-secret"), false);
});

test("payment management binds saved merchant configuration and refuses non-owner execution", async (t) => {
  const commandResult = { status: "payments", paymentEnvironment: "sandbox", providerAccountId: "acct_fixture",
    review: { reviewId: "a".repeat(64), changes: [], drift: [], removed: [], pending: false } };
  const { service, source, calls, environmentCalls } = await fixture(t, { setup: true, commandResult });
  const config = configuration();
  config.integrations.billing = { provider: "stripe", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:STRIPE_KEY" } };
  config.extensions.payments = { version: 1,
    environments: { sandbox: { integrationId: "billing", providerAccountId: "acct_fixture", webhookSecretRef: "env:SIGNING_SECRET", returnUrlRef: "env:RETURN_URL" } },
    plans: { pro: { name: "Pro", amount: 1200, currency: "USD", interval: "month", features: [], renewalCredits: 0 } } };
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(config));
  const input = { sessionId: "one", environment: "development", integrationId: "billing", operation: "payments-preview", paymentEnvironment: "sandbox", vibe64User: { role: "owner" } };
  for (const selection of [
    {},
    { operation: "payments-readiness" },
    { operation: "payments-history", subjectId: "tenant-a", collection: "transactions" },
    { operation: "payments-publish", reviewId: "a".repeat(64) },
    { operation: "payments-recover", reviewId: "a".repeat(64), providerId: "price_recovered" }
  ]) {
    const denied = await service.runIntegrationSetup({ ...input, ...selection, vibe64User: { role: "member" } });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.code, "vibe64_owner_required");
  }
  assert.equal(environmentCalls.length, 0);
  assert.equal(calls.length, 0);
  assert.equal((await service.runIntegrationSetup({ ...input, paymentEnvironment: "live" })).statusCode, 422);
  assert.equal(calls.length, 0);
  const result = await service.runIntegrationSetup(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.providerAccountId, "acct_fixture");
  assert.equal(calls.length, 1);
  const recovery = { ...input, operation: "payments-recover", reviewId: "a".repeat(64), providerId: "price_recovered" };
  assert.equal((await service.runIntegrationSetup({ ...recovery, vibe64User: { role: "member" } })).statusCode, 403);
  assert.equal(calls.length, 1);
  assert.equal((await service.runIntegrationSetup(recovery)).ok, true);
  const recoveryRequest = JSON.parse(calls.at(-1).input);
  assert.equal(recoveryRequest.operation, "payments-recover");
  assert.equal(recoveryRequest.reviewId, recovery.reviewId);
  assert.equal(recoveryRequest.providerId, recovery.providerId);
  assert.equal(recoveryRequest.paymentEnvironment, "sandbox");
  commandResult.providerAccountId = "acct_elsewhere";
  assert.equal((await service.runIntegrationSetup(recovery)).statusCode, 409);
  assert.equal((await service.runIntegrationSetup(input)).statusCode, 409);
});


test("Amplitude registration uses the selected regional authority and saves secrets only to development Env", async t => {
  for (const region of ["us", "eu"]) {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-amplitude", client_secret: "amplitude-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { amplitude: {
      source: "own", clientId: "", clientSecretRef: "env:AMPLITUDE_CLIENT_SECRET", callbackUrlRef: "env:AMPLITUDE_CALLBACK_URL"
    } }, integrations: { amplitude: { provider: "amplitude", accountMode: "assistant", scopes: ["mcp:read", "offline_access"],
      authentication: { method: "oauth2", registrationRef: "amplitude" }, settings: { region } } } };
    const input = { sessionId: "one", integrationId: "amplitude", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/amplitude/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, region === "eu" ? "https://mcp.eu.amplitude.com/register" : "https://mcp.amplitude.com/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.AMPLITUDE_CLIENT_SECRET, { value: "amplitude-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("amplitude-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("amplitude-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations.amplitude.clientId, "registered-amplitude");
    assert.deepEqual(JSON.parse(saved).integrations.amplitude.settings, { region });
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
  }
});

test("Atlassian registration uses its fixed v2 authority and saves secrets only to development Env", async t => {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-atlassian", client_secret: "atlassian-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { atlassian: {
      source: "own", clientId: "", clientSecretRef: "env:ATLASSIAN_CLIENT_SECRET", callbackUrlRef: "env:ATLASSIAN_CALLBACK_URL"
    } }, integrations: { atlassian: { provider: "atlassian", accountMode: "assistant", scopes: ["read:me", "read:jira:agent-interface", "offline_access"],
      authentication: { method: "oauth2", registrationRef: "atlassian" }, settings: {} } } };
    const input = { sessionId: "one", integrationId: "atlassian", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/atlassian/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.ATLASSIAN_CLIENT_SECRET, { value: "atlassian-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("atlassian-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("atlassian-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations.atlassian.clientId, "registered-atlassian");
    assert.deepEqual(JSON.parse(saved).integrations.atlassian.settings, {});
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
});

test("Confidence Exp registration uses its fixed MCP authority and saves secrets only to development Env", async t => {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-confidence", client_secret: "confidence-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { "confidence-exp": {
      source: "own", clientId: "", clientSecretRef: "env:CONFIDENCE_EXP_CLIENT_SECRET", callbackUrlRef: "env:CONFIDENCE_EXP_CALLBACK_URL"
    } }, integrations: { "confidence-exp": { provider: "confidence-exp", accountMode: "assistant", scopes: ["openid", "profile", "offline_access"],
      authentication: { method: "oauth2", registrationRef: "confidence-exp" }, settings: {} } } };
    const input = { sessionId: "one", integrationId: "confidence-exp", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/confidence-exp/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://mcp.confidence.dev/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.CONFIDENCE_EXP_CLIENT_SECRET, { value: "confidence-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("confidence-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("confidence-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations["confidence-exp"].clientId, "registered-confidence");
    assert.deepEqual(JSON.parse(saved).integrations["confidence-exp"].settings, {});
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
});

test("Sanity registration uses its fixed MCP authority and saves secrets only to development Env", async t => {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-sanity", client_secret: "sanity-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { "sanity": {
      source: "own", clientId: "", clientSecretRef: "env:SANITY_CLIENT_SECRET", callbackUrlRef: "env:SANITY_CALLBACK_URL"
    } }, integrations: { "sanity": { provider: "sanity", accountMode: "assistant", scopes: ["global"],
      authentication: { method: "oauth2", registrationRef: "sanity" }, settings: {} } } };
    const input = { sessionId: "one", integrationId: "sanity", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/sanity/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://mcp.sanity.io/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.SANITY_CLIENT_SECRET, { value: "sanity-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("sanity-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("sanity-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations["sanity"].clientId, "registered-sanity");
    assert.deepEqual(JSON.parse(saved).integrations["sanity"].settings, {});
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
});

test("Sentry registration uses its fixed MCP authority and saves secrets only to development Env", async t => {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-sentry", client_secret: "sentry-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { "sentry": {
      source: "own", clientId: "", clientSecretRef: "env:SENTRY_CLIENT_SECRET", callbackUrlRef: "env:SENTRY_CALLBACK_URL"
    } }, integrations: { "sentry": { provider: "sentry", accountMode: "assistant", scopes: ["org:read"],
      authentication: { method: "oauth2", registrationRef: "sentry" }, settings: { organizationSlug: "example", projectSlug: "web" } } } };
    const input = { sessionId: "one", integrationId: "sentry", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/sentry/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://mcp.sentry.dev/oauth/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.SENTRY_CLIENT_SECRET, { value: "sentry-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("sentry-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("sentry-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations["sentry"].clientId, "registered-sentry");
    assert.deepEqual(JSON.parse(saved).integrations["sentry"].settings, { organizationSlug: "example", projectSlug: "web" });
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
});

test("Confidence Flags registration uses its fixed MCP authority and saves secrets only to development Env", async t => {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-confidence", client_secret: "confidence-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { "confidence-flags": {
      source: "own", clientId: "", clientSecretRef: "env:CONFIDENCE_FLAGS_CLIENT_SECRET", callbackUrlRef: "env:CONFIDENCE_FLAGS_CALLBACK_URL"
    } }, integrations: { "confidence-flags": { provider: "confidence-flags", accountMode: "assistant", scopes: ["openid", "profile", "offline_access"],
      authentication: { method: "oauth2", registrationRef: "confidence-flags" }, settings: {} } } };
    const input = { sessionId: "one", integrationId: "confidence-flags", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/confidence-flags/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://mcp.confidence.dev/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.CONFIDENCE_FLAGS_CLIENT_SECRET, { value: "confidence-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("confidence-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("confidence-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations["confidence-flags"].clientId, "registered-confidence");
    assert.deepEqual(JSON.parse(saved).integrations["confidence-flags"].settings, {});
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
});

test("Granola registration uses its fixed MCP authority and saves secrets only to development Env", async t => {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-granola", client_secret: "granola-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { granola: {
      source: "own", clientId: "", clientSecretRef: "env:GRANOLA_CLIENT_SECRET", callbackUrlRef: "env:GRANOLA_CALLBACK_URL"
    } }, integrations: { granola: { provider: "granola", accountMode: "assistant", scopes: ["openid", "profile", "email", "offline_access"],
      authentication: { method: "oauth2", registrationRef: "granola" }, settings: {} } } };
    const input = { sessionId: "one", integrationId: "granola", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/granola/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://mcp-auth.granola.ai/oauth2/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.GRANOLA_CLIENT_SECRET, { value: "granola-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("granola-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("granola-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations.granola.clientId, "registered-granola");
    assert.deepEqual(JSON.parse(saved).integrations.granola.settings, {});
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
});


test("HeyGen registration uses its fixed MCP authority and saves secrets only to development Env", async t => {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-heygen", client_secret: "heygen-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { heygen: {
      source: "own", clientId: "", clientSecretRef: "env:HEYGEN_CLIENT_SECRET", callbackUrlRef: "env:HEYGEN_CALLBACK_URL"
    } }, integrations: { heygen: { provider: "heygen", accountMode: "assistant", scopes: ["openid", "profile", "email"],
      authentication: { method: "oauth2", registrationRef: "heygen" }, settings: {} } } };
    const input = { sessionId: "one", integrationId: "heygen", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/heygen/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://api2.heygen.com/v1/oauth/register");
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.HEYGEN_CLIENT_SECRET, { value: "heygen-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("heygen-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("heygen-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations.heygen.clientId, "registered-heygen");
    assert.deepEqual(JSON.parse(saved).integrations.heygen.settings, {});
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
});


test("Hex registration preserves each endpoint and saves secrets only to development Env", async t => {
  for (const [endpoint, host] of [["standard", "app.hex.tech"], ["eu", "eu.hex.tech"], ["hipaa", "hc.hex.tech"]]) {
    const posts = [];
    const writes = [];
    const { service, source } = await fixture(t, {
      integrationDiscoveryFetch: async (url, options) => {
        posts.push({ url: String(url), options });
        return Response.json({ ...JSON.parse(options.body), client_id: "registered-hex", client_secret: "hex-private-fixture" });
      }, saveRegistrationEnv: async request => { writes.push(request); return { ok: true }; }
    });
    const configuration = { schemaVersion: 1, registrations: { hex: {
      source: "own", clientId: "", clientSecretRef: "env:HEX_CLIENT_SECRET", callbackUrlRef: "env:HEX_CALLBACK_URL"
    } }, integrations: { hex: { provider: "hex", accountMode: "assistant", scopes: ["openid", "profile", "offline_access"],
      authentication: { method: "oauth2", registrationRef: "hex" }, settings: { endpoint } } } };
    const input = { sessionId: "one", integrationId: "hex", baseHash: null, configuration,
      callbackUrl: "https://app.example/integrations/hex/callback", vibe64User: { role: "owner" } };
    assert.equal((await service.registerOAuthIntegration({ ...input, vibe64User: { role: "member" } })).code, "vibe64_owner_required");
    assert.equal(posts.length, 0);
    const result = await service.registerOAuthIntegration(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, `https://auth.${host}/oauth2/register`);
    assert.equal(posts[0].options.redirect, "error");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].environment, "dev");
    assert.deepEqual(writes[0].values.HEX_CLIENT_SECRET, { value: "hex-private-fixture", secret: true });
    const saved = await readFile(path.join(source, "integrations.json"), "utf8");
    assert.equal(saved.includes("hex-private-fixture"), false);
    assert.equal(JSON.stringify(result).includes("hex-private-fixture"), false);
    assert.equal(JSON.parse(saved).registrations.hex.clientId, "registered-hex");
    assert.deepEqual(JSON.parse(saved).integrations.hex.settings, { endpoint });
    assert.equal((await service.registerOAuthIntegration(input)).ok, false);
    assert.equal(posts.length, 1);
  }
});

test("Google Ads management requires a shared Google binding and owner before Env or command execution", async t => {
  const commandResult = { status: "ads", operation: "ads-discover", data: { accounts: ["customers/1234567890"] } };
  const { service, source, calls, environmentCalls } = await fixture(t, { setup: true, commandResult });
  const config = configuration();
  config.integrations.ads = { provider: "google-ads", accountMode: "shared", scopes: ["https://www.googleapis.com/auth/adwords"],
    authentication: { method: "oauth2", registrationRef: "google" } };
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(config));
  const input = { sessionId: "one", environment: "development", integrationId: "ads", operation: "ads-discover", ads: {}, vibe64User: { role: "owner" } };
  assert.equal((await service.runIntegrationSetup({ ...input, vibe64User: { role: "member" } })).statusCode, 403);
  assert.equal((await service.runIntegrationSetup({ ...input, integrationId: "calendar" })).statusCode, 422);
  assert.equal(environmentCalls.length, 0); assert.equal(calls.length, 0);
  config.integrations.ads.accountMode = "per-user";
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(config));
  assert.equal((await service.runIntegrationSetup(input)).statusCode, 422);
  config.integrations.ads.accountMode = "shared";
  await writeFile(path.join(source, "integrations.json"), JSON.stringify(config));
  const result = await service.runIntegrationSetup(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data.accounts, ["customers/1234567890"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].input).ads, {});
  assert.equal(calls[0].env.GOOGLE_CLIENT_SECRET, "fixture-private");
  assert.equal(JSON.stringify(result).includes("fixture-private"), false);
});
