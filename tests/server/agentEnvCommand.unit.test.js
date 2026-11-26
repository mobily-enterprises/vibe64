import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";

import {
  __testables,
  VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV,
  createAgentEnvCommandService,
  prepareAgentEnvCommand
} from "../../packages/vibe64-terminals/src/server/agentEnvCommand.js";
import { NO_STAGING_ENVIRONMENT } from "../../packages/vibe64-terminals/src/server/stagingEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS } from "../../packages/vibe64-terminals/src/server/savedEnvValueLinks.js";
import { runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { endChildInput } from "./childInputTestHelpers.js";

const {
  AGENT_ENV_COMMAND_NAME,
  VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_ENV_COMMAND_SESSION_ID_ENV
} = __testables;

function createProjectService({
  records = []
} = {}) {
  const state = {
    contexts: [],
    currentProject: {
      projectRoot: "/srv/projects/demo",
      slug: "demo"
    },
    records: [...records],
    saves: []
  };
  return {
    state,
    async readCurrentProject() {
      return state.currentProject;
    },
    async readEnv(input = {}) {
      assert.equal(input.environment, "dev");
      return {
        env: {
          records: state.records
        },
        ok: true
      };
    },
    async runInProjectContext(slug, operation) {
      state.contexts.push(slug);
      return operation();
    },
    async saveEnvUserValues(input = {}) {
      state.saves.push(input);
      for (const [key, value] of Object.entries(input.values || {})) {
        state.records = state.records.filter((record) => record.key !== key);
        if (value.remove !== true) {
          state.records.push({
            editable: true,
            key,
            owner: "user",
            requiredFor: [],
            scope: "dev",
            secret: value.secret === true,
            source: "user",
            value: value.value,
            valuePresent: String(value.value ?? "").length > 0
          });
        }
      }
      return {
        env: {
          records: state.records
        },
        ok: true
      };
    }
  };
}

function createStagingProvider({
  staging = null,
  records = []
} = {}) {
  const state = {
    stagingStatusReads: [],
    reads: [],
    records: [...records],
    removes: [],
    sets: []
  };
  return {
    state,
    isUserValueRecord(record = null) {
      return record?.source === "user_override";
    },
    async readStagingStatus(input = {}) {
      state.stagingStatusReads.push(input);
      return { staging, ok: true };
    },
    async readRecords(input = {}) {
      state.reads.push(input);
      return {
        ok: true,
        records: state.records
      };
    },
    async removeVariable(input = {}) {
      state.removes.push(input);
      state.records = state.records.filter((record) => record.key !== input.key);
      return {
        ok: true
      };
    },
    async setVariable(input = {}) {
      state.sets.push(input);
      state.records = [
        ...state.records.filter((record) => record.key !== input.key),
        {
          editable: true,
          key: input.key,
          owner: "user",
          requiredFor: [],
          scope: "staging",
          secret: input.secret === true,
          source: "user_override",
          value: input.secret ? "********" : input.value,
          valuePresent: String(input.value ?? "").length > 0
        }
      ];
      return {
        ok: true
      };
    }
  };
}

function runWithInput(command, args, {
  env = process.env,
  input = ""
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stderr,
      stdout
    }));
    endChildInput(child, input);
  });
}

test("agent Env status reports both scopes without exposing values", async () => {
  const project = createProjectService({
    records: [{
      editable: true,
      key: "PUBLIC_ORIGIN",
      owner: "user",
      requiredFor: ["server"],
      scope: "dev",
      secret: false,
      source: "user",
      value: "https://development.example.test",
      valuePresent: true
    }]
  });
  const staging = createStagingProvider({
    records: [{
      editable: true,
      key: "API_TOKEN",
      owner: "user",
      requiredFor: ["staging-publish"],
      scope: "staging",
      secret: true,
      source: "user_override",
      value: "********",
      valuePresent: true
    }]
  });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: staging,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("status-session");

  const result = await command.run({
    args: ["status", "all", "--json"],
    sessionId: "status-session"
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.ok, true);
  assert.equal(payload.scopes.development.records[0].key, "PUBLIC_ORIGIN");
  assert.equal(payload.scopes.staging.records[0].key, "API_TOKEN");
  assert.equal(payload.scopes.staging.records[0].secret, true);
  assert.equal(payload.scopes.staging.records[0].state, "configured");
  assert.equal(payload.scopes.staging.records[0].stored, true);
  assert.equal(Object.hasOwn(payload.scopes.development.records[0], "value"), false);
  assert.equal(Object.hasOwn(payload.scopes.staging.records[0], "value"), false);
  assert.doesNotMatch(result.stdout, /development\.example\.test/u);
  assert.doesNotMatch(result.stdout, /\*\*\*\*\*\*\*\*/u);
  assert.deepEqual(project.state.contexts, ["demo"]);

  const help = await command.run({ args: ["--help"], sessionId: "status-session" });
  assert.match(help.stdout, /--secret marks the value as a secret/u);
  assert.match(help.stdout, /keys\nwhose names look secret .* become secrets automatically/u);
  assert.match(help.stdout, /pipe\nit to env set <scope> <KEY> --secret\. Never write it into the generated \.env/u);
});

test("agent Env persists and reports empty development and staging values", async () => {
  const project = createProjectService();
  const staging = createStagingProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: staging,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("empty-session");

  const development = await command.run({
    args: ["set", "development", "EMPTY_SECRET", "--secret", "--json"],
    sessionId: "empty-session",
    stdin: ""
  });
  const stagingResult = await command.run({
    args: ["set", "staging", "EMPTY_PLAIN", "--json"],
    sessionId: "empty-session",
    stdin: ""
  });
  const status = await command.run({
    args: ["status", "all", "--json"],
    sessionId: "empty-session"
  });
  const removedStaging = await command.run({
    args: ["remove", "staging", "EMPTY_PLAIN", "--json"],
    sessionId: "empty-session"
  });
  const developmentPayload = JSON.parse(development.stdout);
  const stagingPayload = JSON.parse(stagingResult.stdout);
  const statusPayload = JSON.parse(status.stdout);
  const removedStagingPayload = JSON.parse(removedStaging.stdout);

  assert.equal(development.ok, true);
  assert.equal(developmentPayload.created, true);
  assert.equal(developmentPayload.empty, true);
  assert.equal(stagingResult.ok, true);
  assert.equal(stagingPayload.created, true);
  assert.equal(stagingPayload.empty, true);
  assert.deepEqual(project.state.saves[0].values, {
    EMPTY_SECRET: {
      secret: true,
      value: ""
    }
  });
  assert.deepEqual(staging.state.sets, [{
    actor: null,
    key: "EMPTY_PLAIN",
    projectSlug: "demo",
    secret: false,
    value: ""
  }]);
  assert.equal(removedStagingPayload.changed, true);
  assert.deepEqual(staging.state.removes, [{
    actor: null,
    key: "EMPTY_PLAIN",
    projectSlug: "demo"
  }]);
  assert.deepEqual(statusPayload.scopes.development.records[0], {
    configured: false,
    editable: true,
    key: "EMPTY_SECRET",
    missing: true,
    owner: "user",
    requiredFor: [],
    scope: "development",
    secret: true,
    source: "user",
    state: "empty",
    stored: true
  });
  assert.equal(statusPayload.scopes.staging.records[0].state, "empty");
  assert.equal(statusPayload.scopes.staging.records[0].stored, true);
});

test("agent Env creates development values through the project service and never echoes them", async () => {
  const project = createProjectService({
    records: [{
      editable: true,
      key: "API_TOKEN",
      owner: "user",
      requiredFor: ["server"],
      scope: "dev",
      secret: true,
      source: "genesis-stack:app:api",
      value: "",
      valuePresent: false
    }]
  });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("development-session");
  const secretValue = "private-development-value";

  const result = await command.run({
    args: ["set", "development", "API_TOKEN", "--secret"],
    sessionId: "development-session",
    stdin: secretValue
  });

  assert.equal(result.ok, true);
  assert.match(result.stdout, /Created development Env API_TOKEN/u);
  assert.match(result.stdout, /outside Git/u);
  assert.doesNotMatch(result.stdout, new RegExp(secretValue, "u"));
  assert.deepEqual(project.state.saves, [{
    environment: "dev",
    sessionId: "development-session",
    values: {
      API_TOKEN: {
        secret: true,
        value: secretValue
      }
    }
  }]);
});

test("agent Env drops one final line ending from stdin and keeps every other character", async () => {
  const project = createProjectService();
  const staging = createStagingProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: staging,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("line-ending-session");
  const setValue = (scope, key, stdin) => command.run({
    args: ["set", scope, key, "--json"],
    sessionId: "line-ending-session",
    stdin
  });
  const cases = [
    // `echo "$KEY" |`: the newline echo adds is not part of the key.
    ["ECHOED", "provider-api-key-0123456789\n", "provider-api-key-0123456789"],
    // `printf '%s' "$KEY" |`: no line ending, nothing dropped.
    ["PRINTED", "exact-value", "exact-value"],
    // A value that really ends with a line break arrives with two and keeps one.
    ["DOUBLED", "-----END KEY-----\n\n", "-----END KEY-----\n"],
    ["WINDOWS", "crlf-value\r\n", "crlf-value"],
    ["SPACED", "  inner  spaces\tand tab \n", "  inner  spaces\tand tab "],
    ["MULTILINE", "first\nsecond\n", "first\nsecond"],
    ["LONE_CR", "carriage\r", "carriage\r"]
  ];

  for (const [key, stdin, stored] of cases) {
    const result = await setValue("development", key, stdin);
    assert.equal(result.ok, true, key);
    assert.deepEqual(project.state.saves.at(-1).values, { [key]: { value: stored } }, key);
  }

  const echoedEmpty = await setValue("development", "ECHOED_EMPTY", "\n");
  assert.equal(JSON.parse(echoedEmpty.stdout).empty, true);
  assert.equal(project.state.saves.at(-1).values.ECHOED_EMPTY.value, "");

  const stagingResult = await setValue("staging", "TOGETHER_API_KEY", "together-key\n");
  assert.equal(JSON.parse(stagingResult.stdout).empty, false);
  assert.equal(staging.state.sets.at(-1).value, "together-key");
  assert.equal(staging.state.sets.at(-1).secret, true);
  await setValue("staging", "STAGING_DOUBLED", "pem\n\n");
  assert.equal(staging.state.sets.at(-1).value, "pem\n");
});

test("agent Env staging writes use only the host staging provider", async () => {
  const project = createProjectService();
  const staging = createStagingProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: staging,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  // The person whose request prepared the agent reaches the host with each change.
  const actor = { role: "member", username: "teammate" };
  await runWithProjectRequestContext({ slug: "demo", vibe64User: actor }, () => command.bindSession("staging-session"));
  const secretValue = "private-staging-value";

  const result = await command.run({
    args: ["set", "staging", "DEPLOY_TOKEN", "--json"],
    sessionId: "staging-session",
    stdin: secretValue
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.scope, "staging");
  assert.equal(payload.key, "DEPLOY_TOKEN");
  assert.equal(payload.created, true);
  assert.equal(payload.secret, true);
  assert.equal(Object.hasOwn(payload, "value"), false);
  assert.deepEqual(staging.state.sets, [{
    actor,
    key: "DEPLOY_TOKEN",
    projectSlug: "demo",
    secret: true,
    value: secretValue
  }]);
  assert.deepEqual(project.state.saves, []);
  assert.deepEqual(project.state.contexts, ["demo"]);
  assert.deepEqual(staging.state.reads, [{ projectSlug: "demo" }]);
  assert.doesNotMatch(result.stdout, new RegExp(secretValue, "u"));

  const removed = await command.run({ args: ["remove", "staging", "DEPLOY_TOKEN"], sessionId: "staging-session" });
  assert.equal(removed.exitCode, 0);
  assert.deepEqual(staging.state.removes, [{ actor, key: "DEPLOY_TOKEN", projectSlug: "demo" }]);

  // A host's refusal of that person reaches the agent as the host worded it.
  staging.setVariable = async () => ({ ok: false, code: "vibe64_owner_required", error: "Only the owner changes staging values here." });
  const refused = await command.run({
    args: ["set", "staging", "DEPLOY_TOKEN"],
    sessionId: "staging-session",
    stdin: secretValue
  });
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.code, "vibe64_owner_required");
  assert.equal(refused.stderr, "Only the owner changes staging values here.\n");
  assert.doesNotMatch(`${refused.stdout || ""}${refused.stderr}`, new RegExp(secretValue, "u"));
});

test("agent Env refuses system-managed values and unavailable staging writes", async () => {
  const project = createProjectService({
    records: [{
      editable: false,
      key: "DATABASE_URL",
      owner: "system",
      requiredFor: [],
      scope: "dev",
      secret: true,
      source: "vibe64-host:managed-resource",
      value: "********",
      valuePresent: true
    }]
  });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("guard-session");

  const managed = await command.run({
    args: ["set", "development", "DATABASE_URL"],
    sessionId: "guard-session",
    stdin: "attempted-override"
  });
  const staging = await command.run({
    args: ["set", "staging", "API_TOKEN"],
    sessionId: "guard-session",
    stdin: "attempted-staging"
  });

  assert.equal(managed.ok, false);
  assert.equal(managed.code, "vibe64_agent_env_command_managed_value");
  assert.doesNotMatch(managed.stderr, /attempted-override/u);
  assert.equal(staging.ok, false);
  assert.equal(staging.code, "vibe64_agent_env_command_staging_unavailable");
  assert.doesNotMatch(staging.stderr, /attempted-staging/u);
  // Without a host's Production Env, production writes say so; prod is no scope; production is never read back.
  const production = await command.run({ args: ["set", "production", "API_TOKEN"], sessionId: "guard-session", stdin: "attempted-production" });
  assert.equal(production.ok, false);
  assert.equal(production.code, "vibe64_agent_env_command_production_unavailable");
  assert.doesNotMatch(production.stderr, /attempted-production/u);
  const prod = await command.run({ args: ["status", "prod"], sessionId: "guard-session" });
  assert.equal(prod.exitCode, 2);
  assert.equal(prod.code, "vibe64_agent_env_command_usage");
  assert.equal(prod.stderr.split("\n")[0], "Status accepts only an optional development, staging, production or all scope.");
  const read = await command.run({ args: ["get", "production", "API_TOKEN"], sessionId: "guard-session" });
  assert.equal(read.exitCode, 2);
  assert.equal(read.code, "vibe64_agent_env_command_production_unreadable");
  assert.deepEqual(project.state.saves, []);
});

function createProductionProvider({ records = [], refuse = null } = {}) {
  const state = { reads: [], records: [...records], removes: [], sets: [] };
  return {
    state,
    async readRecords(input = {}) {
      state.reads.push(input);
      // A value a host wrongly answered is still never printed.
      return { ok: true, records: state.records.map((record) => ({ ...record, value: "host-answered-production-value" })) };
    },
    async removeVariable(input = {}) {
      if (refuse) return refuse;
      state.removes.push(input);
      state.records = state.records.filter((record) => record.key !== input.key);
      return { ok: true };
    },
    async setVariable(input = {}) {
      if (refuse) return refuse;
      state.sets.push(input);
      state.records = [...state.records.filter((record) => record.key !== input.key), {
        change: "added",
        editable: true,
        key: input.key,
        owner: "user",
        secret: input.secret === true,
        services: input.services || ["web"],
        source: "production_env",
        valuePresent: true
      }];
      return { ok: true };
    }
  };
}

test("agent Env production writes reach the host's Production Env by stdin alone, and never print a value", async () => {
  const project = createProjectService();
  const productionEnvironmentProvider = createProductionProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    productionEnvironmentProvider, project
  });
  const actor = { id: 7, role: "owner" };
  await runWithProjectRequestContext({ slug: "demo", vibe64User: actor }, () => command.bindSession("production-session"));
  const generated = "generated-production-secret-0123456789";

  const secret = await command.run({
    args: ["set", "production", "APP_KEY", "--secret"],
    sessionId: "production-session",
    stdin: `${generated}\n`
  });
  const plain = await command.run({
    args: ["set", "production", "PUBLIC_ORIGIN", "--services=web,worker", "--json"],
    sessionId: "production-session",
    stdin: "https://example.test"
  });
  const status = await command.run({ args: ["status", "production", "--json"], sessionId: "production-session" });
  const all = await command.run({ args: ["status", "all"], sessionId: "production-session" });
  const removed = await command.run({ args: ["remove", "production", "PUBLIC_ORIGIN"], sessionId: "production-session" });

  assert.equal(secret.ok, true);
  assert.match(secret.stdout, /Created production Env APP_KEY\.\nStored by Vibe64 outside Git; the value was not printed\.\n/u);
  assert.match(secret.stdout, /reaches Production only when the person deploys to production; the Deploy page's Plan lists the change/u);
  assert.equal(plain.ok, true);
  assert.deepEqual(productionEnvironmentProvider.state.sets, [
    { actor, key: "APP_KEY", projectSlug: "demo", secret: true, services: null, sessionId: "production-session", value: generated },
    { actor, key: "PUBLIC_ORIGIN", projectSlug: "demo", secret: false, services: ["web", "worker"], sessionId: "production-session",
      value: "https://example.test" }
  ]);
  const records = JSON.parse(status.stdout).scopes.production.records;
  assert.deepEqual(records.map((record) => [record.key, record.secret, record.services, record.change]), [
    ["APP_KEY", true, ["web"], "added"],
    ["PUBLIC_ORIGIN", false, ["web", "worker"], "added"]
  ]);
  assert.equal(records.some((record) => Object.hasOwn(record, "value")), false);
  assert.match(all.stdout, /Production Env:\n {2}APP_KEY — configured, secret, editable, goes to web, added since the last Deploy to production/u);
  assert.match(removed.stdout, /Removed production Env PUBLIC_ORIGIN\./u);
  assert.deepEqual(productionEnvironmentProvider.state.removes, [
    { actor, key: "PUBLIC_ORIGIN", projectSlug: "demo", sessionId: "production-session" }
  ]);
  for (const result of [secret, plain, status, all, removed]) {
    assert.doesNotMatch(`${result.stdout}${result.stderr || ""}`, /generated-production-secret|host-answered-production-value|example\.test/u);
  }
  assert.ok(productionEnvironmentProvider.state.reads.every((read) => read.actor === actor && read.projectSlug === "demo"));
});

test("agent Env never reads production back, takes values on stdin only and reports the host's refusal", async () => {
  const project = createProjectService();
  const productionEnvironmentProvider = createProductionProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    productionEnvironmentProvider, project
  });
  await command.bindSession("guard-production");
  const run = (args, stdin = "") => command.run({ args, sessionId: "guard-production", stdin });

  for (const args of [["get", "production", "APP_KEY"], ["export", "production"]]) {
    const refused = await run(args);
    assert.equal(refused.exitCode, 2);
    assert.equal(refused.code, "vibe64_agent_env_command_production_unreadable");
    assert.match(refused.stderr, /Production values are never read back/u);
  }
  // A value given as an argument is refused before anything is read or written, for every scope.
  for (const args of [["set", "production", "APP_KEY", "--secret=argument-production-value"],
    ["set", "production", "APP_KEY", "argument-production-value"],
    ["set", "development", "APP_KEY", "--value=argument-production-value"]]) {
    const refused = await run(args);
    assert.equal(refused.exitCode, 2);
    assert.equal(refused.code, "vibe64_agent_env_command_usage");
    assert.match(refused.stderr, /^A value goes in on stdin only, never as an argument/u);
    assert.doesNotMatch(refused.stderr, /argument-production-value/u);
  }
  const empty = await run(["set", "production", "APP_KEY", "--secret"], "\n");
  assert.equal(empty.code, "vibe64_agent_env_command_production_secret_empty");
  for (const [args, stdin] of [[["set", "development", "APP_KEY", "--services=web"], "value"],
    [["set", "production", "APP_KEY", "--services="], "value"], [["link", "production", "APP_KEY", "saved", "field"], ""]]) {
    const refused = await run(args, stdin);
    assert.equal(refused.exitCode, 2, args.join(" "));
    assert.equal(refused.code, "vibe64_agent_env_command_usage");
  }
  assert.deepEqual(productionEnvironmentProvider.state.sets, []);
  assert.deepEqual(project.state.saves, []);

  const owner = "Only the workspace owner can change the Production Env: the people who may deploy to production.";
  const memberCommand = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    productionEnvironmentProvider: createProductionProvider({ refuse: { ok: false, code: "vibe64_owner_required", error: owner } }),
    project
  });
  await memberCommand.bindSession("member-production");
  const refused = await memberCommand.run({ args: ["set", "production", "APP_KEY", "--secret"], sessionId: "member-production",
    stdin: "member-production-value" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "vibe64_owner_required");
  assert.equal(refused.stderr, `${owner}\n`);
});

test("every agent Env operation refuses an option, argument, stdin or request field it doesn't read, and a missing argument, through the helpers' one refusal once the session's binding is checked, naming what it takes, and changes nothing", async () => {
  const project = createProjectService({
    records: [{
      editable: true, key: "OLD_VALUE", owner: "user", requiredFor: [], scope: "dev", secret: false, source: "user",
      value: "old", valuePresent: true
    }]
  });
  const productionEnvironmentProvider = createProductionProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    productionEnvironmentProvider, project
  });
  await command.bindSession("unread-session");
  const run = (args, stdin = "") => command.run({ args, sessionId: "unread-session", stdin });
  const first = (result) => result.stderr.split("\n")[0];

  // What an operation doesn't read: a misspelt option among them, named without what follows its =, and an extra
  // argument or stdin by what it is, never its text; each through refuseUnreadFields, as every helper command.
  for (const [args, stdin, words] of [
    [["set", "development", "APP_KEY", "--secrt"], "kept-private", "env set does not read --secrt: nothing changed. It takes "
      + "<development|staging|production>, <KEY>, --secret, --services=, --json, stdin."],
    [["set", "production", "APP_KEY", "--service=web"], "kept-private", "env set does not read --service=: nothing changed."],
    [["status", "development", "--secret"], "", "env status does not read --secret: nothing changed. It takes "
      + "<development|staging|production|all>, --json."],
    [["remove", "development", "OLD_VALUE", "kept-private"], "", "env remove does not read an argument after <KEY>: nothing "
      + "changed. It takes <development|staging|production>, <KEY>, --json."],
    [["remove", "development", "OLD_VALUE"], "kept-private", "env remove does not read stdin: nothing changed."],
    [["saved", "kept-private", "kept-private"], "", "env saved does not read 2 arguments after saved: nothing changed. It "
      + "takes --json."],
    [["export", "staging", "--all"], "", "env export does not read --all: nothing changed. It takes staging, --json."]
  ]) {
    const refused = await run(args, stdin);
    assert.deepEqual([refused.ok, refused.exitCode, refused.code], [false, 2, "vibe64_command_input_unread"], args.join(" "));
    assert.ok(first(refused).startsWith(words), `${args.join(" ")}: ${first(refused)}`);
    assert.doesNotMatch(refused.stderr + refused.error + JSON.stringify(refused), /kept-private|=web/u);
  }
  // A missing or empty argument, named among what the operation takes.
  for (const [args, words] of [
    [["set", "development"], "env set needs <KEY>: nothing changed. It takes <development|staging|production>, <KEY>"],
    [["remove"], "env remove needs <development|staging|production>, <KEY>: nothing changed."],
    [["link", "development", "API_KEY", "saved-id"], "env link needs <field-id>: nothing changed."],
    [["get", "staging", ""], "env get needs <KEY>: nothing changed. It takes staging, <KEY>, --json."]
  ]) {
    const refused = await run(args, args[0] === "set" ? "value" : "");
    assert.deepEqual([refused.ok, refused.exitCode, refused.code], [false, 2, "vibe64_command_input_missing"], args.join(" "));
    assert.ok(first(refused).includes(words), `${args.join(" ")}: ${first(refused)}`);
  }
  // A request field the command doesn't read: a value sent as `value` instead of on stdin is refused, not saved empty.
  const misnamed = await command.run({ args: ["set", "development", "APP_KEY"], sessionId: "unread-session", value: "kept-private" });
  assert.deepEqual([misnamed.ok, misnamed.code], [false, "vibe64_command_input_unread"]);
  assert.equal(misnamed.error, "env does not read value: nothing changed. It takes args, stdin.");
  // Only once the session's binding is checked: a session the command isn't bound to hears that, not what it sent.
  for (const request of [{ args: ["set", "development", "APP_KEY", "--secrt"], stdin: "kept-private" },
    { args: ["set", "development", "APP_KEY"], value: "kept-private" }, { args: ["remove"] }]) {
    const unbound = await command.run({ ...request, sessionId: "never-bound-session" });
    assert.deepEqual([unbound.ok, unbound.code], [false, "vibe64_agent_env_command_project_binding_missing"],
      JSON.stringify(request.args));
  }
  assert.deepEqual(project.state.saves, [], "nothing changed");
  assert.deepEqual(productionEnvironmentProvider.state.sets, []);
  // What each operation reads still runs.
  assert.equal((await run(["status", "development", "--json"])).exitCode, 0);
  assert.equal((await run(["remove", "development", "OLD_VALUE", "--json"])).exitCode, 0);
});

test("agent Env refuses a stale session binding after the project identity changes", async () => {
  const project = createProjectService();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("stale-session");
  project.state.currentProject = {
    projectRoot: "/srv/projects/recreated-demo",
    slug: "demo"
  };

  const result = await command.run({
    args: ["status", "development"],
    sessionId: "stale-session"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_agent_env_command_project_binding_changed");
});

test("agent Env removes only stored user values", async () => {
  const project = createProjectService({
    records: [{
      editable: true,
      key: "OLD_VALUE",
      owner: "user",
      requiredFor: [],
      scope: "dev",
      secret: false,
      source: "user",
      value: "old",
      valuePresent: true
    }]
  });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("remove-session");

  const removed = await command.run({
    args: ["remove", "development", "OLD_VALUE"],
    sessionId: "remove-session"
  });
  const unchanged = await command.run({
    args: ["remove", "development", "MISSING_VALUE"],
    sessionId: "remove-session"
  });

  assert.match(removed.stdout, /Removed development Env OLD_VALUE/u);
  // A name the Env doesn't store (a misspelt one) is refused, never answered as a removal that changed nothing.
  assert.deepEqual([unchanged.ok, unchanged.exitCode, unchanged.code], [false, 1, "vibe64_agent_env_command_key_not_stored"]);
  assert.equal(unchanged.stderr, "Development Env MISSING_VALUE is not stored, so nothing changed: env remove takes a name the "
    + "development Env stores (vibe64-helper env status development lists them).\n");
  assert.equal(project.state.saves.length, 1);
  assert.deepEqual(project.state.saves[0].values, {
    OLD_VALUE: {
      remove: true
    }
  });
});

test("agent Env wrapper forwards stdin over its authenticated session socket", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-env-command-"));
  const project = createProjectService();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  const sessionId = "wrapper-session";
  const secretValue = "wrapper-private-value";
  try {
    const prepared = await prepareAgentEnvCommand({
      commandService: command,
      sessionId,
      wrapperHostDir: root
    });

    assert.equal(prepared.ok, true);
    assert.equal((await stat(path.join(root, AGENT_ENV_COMMAND_NAME))).isFile(), true);
    assert.equal(prepared.env[VIBE64_AGENT_ENV_COMMAND_SESSION_ID_ENV], sessionId);
    assert.equal(prepared.env[VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION_ENV], "1");
    assert.equal(prepared.env[VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV], prepared.hostSocketPath);
    assert.match(prepared.env[VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

    await prepareAgentHelperCommand({ env: process.env, wrapperHostDir: root });
    const executed = await runWithInput(path.join(root, "vibe64-helper"), [
      "env",
      "set",
      "development",
      "WRAPPER_TOKEN",
      "--secret"
    ], {
      env: {
        ...process.env,
        ...prepared.env
      },
      input: secretValue
    });

    assert.equal(executed.code, 0);
    assert.match(executed.stdout, /Created development Env WRAPPER_TOKEN/u);
    assert.doesNotMatch(executed.stdout, new RegExp(secretValue, "u"));
    assert.equal(executed.stderr, "");
    assert.equal(project.state.saves[0].values.WRAPPER_TOKEN.value, secretValue);

    const empty = await runWithInput(prepared.hostWrapperPath, [
      "set",
      "development",
      "EMPTY_WRAPPER_VALUE"
    ], {
      env: {
        ...process.env,
        ...prepared.env
      },
      input: ""
    });

    assert.equal(empty.code, 0);
    assert.match(empty.stdout, /Created development Env EMPTY_WRAPPER_VALUE with an empty value/u);
    assert.equal(project.state.saves[1].values.EMPTY_WRAPPER_VALUE.value, "");

    // The shell pipelines an agent writes: echo's newline is dropped, printf '%s' is kept exactly.
    const pipelineEnv = {
      ...process.env,
      ...prepared.env,
      PIPED_VALUE: "piped-value-with-trailing-space "
    };
    const echoed = await runWithInput("sh", [
      "-c",
      "echo \"$PIPED_VALUE\" | \"$0\" env set development ECHOED_VALUE",
      path.join(root, "vibe64-helper")
    ], { env: pipelineEnv });
    const printed = await runWithInput("sh", [
      "-c",
      "printf '%s' \"$PIPED_VALUE\" | \"$0\" env set development PRINTED_VALUE",
      path.join(root, "vibe64-helper")
    ], { env: pipelineEnv });

    assert.equal(echoed.code, 0, echoed.stderr);
    assert.equal(printed.code, 0, printed.stderr);
    assert.equal(project.state.saves[2].values.ECHOED_VALUE.value, "piped-value-with-trailing-space ");
    assert.equal(project.state.saves[3].values.PRINTED_VALUE.value, "piped-value-with-trailing-space ");
  } finally {
    await command.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("agent Env preparation repairs one missing cached socket and fences its old generation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-env-command-repair-"));
  const project = createProjectService();
  const command = createAgentEnvCommandService({ logger: silentLogger, stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project });
  const sessionId = "env-repair-session";
  try {
    const options = {
      commandService: command,
      sessionId,
      wrapperHostDir: root
    };
    const first = await prepareAgentEnvCommand(options);
    await rm(first.hostSocketPath, { force: true });

    const [left, right] = await Promise.all([
      prepareAgentEnvCommand(options),
      prepareAgentEnvCommand(options)
    ]);

    assert.notEqual(left.controlGenerationId, first.controlGenerationId);
    assert.equal(right.controlGenerationId, left.controlGenerationId);
    assert.equal((await stat(left.hostSocketPath)).isSocket(), true);
    const stale = await runWithInput(first.hostWrapperPath, ["status"], {
      env: {
        ...process.env,
        ...first.env
      }
    });
    assert.notEqual(stale.code, 0);
    assert.match(stale.stderr, /vibe64_agent_control_unavailable/u);
    const current = await runWithInput(left.hostWrapperPath, ["status"], {
      env: {
        ...process.env,
        ...left.env
      }
    });
    assert.equal(current.code, 0);
  } finally {
    await command.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

// What a host could hand back, including fields and values the command must never pass on.
function hostedStagingStatus() {
  return {
    addresses: [
      { label: "Vibe64 URL", url: "https://books.example.test" },
      { label: "custom domain", url: "https://books.example.com" }
    ],
    blockers: ["Secret 'Stripe' is not set for staging."],
    environmentValues: { SESSION_SECRET: "host-secret-value" },
    error: "npm ERR! host-build-output",
    latestStagingPublish: { at: "2026-11-06T09:00:05.000Z", error: "host-failure-detail", status: "failed" },
    notes: ["The project owner changes Staging Env on the project's Deploy page."],
    records: [
      { generated: true, key: "SESSION_SECRET", requiredFor: [], secret: true, source: "user_override",
        sourceLabel: "generated by Vibe64", value: "host-secret-value", valuePresent: true },
      { key: "PUBLIC_ORIGIN", requiredFor: [], secret: false, source: "user_override",
        sourceLabel: "Staging Env value", value: "https://plain-host-value.example.test", valuePresent: true },
      { key: "STRIPE_KEY", requiredFor: ["server"], secret: true, source: "user_override", valuePresent: false }
    ],
    release: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      stagingPublishedAt: "2026-11-06T09:00:00.000Z",
      environment: { values: { PUBLIC_ORIGIN: "https://plain-host-value.example.test" } },
      id: "20261106_090000z-ab12cd34",
      serveEnvironment: [{ effect: "production (the host's default for Node apps)", key: "NODE_ENV", value: "production-value" }],
      steps: [
        { command: "npm ci", label: "Install", role: "prepare" },
        { command: "npm start", label: "Start", role: "serve" },
        { command: "rm -rf /", label: "Injected", role: "restart" }
      ]
    },
    state: "on-staging"
  };
}

test("agent staging status shows the bound project's staging and never a value", async () => {
  const project = createProjectService();
  const staging = createStagingProvider({ staging: hostedStagingStatus() });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: staging,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("staging-session");

  const human = await command.run({ args: ["staging", "status"], sessionId: "staging-session" });
  const json = await command.run({ args: ["staging", "--json"], sessionId: "staging-session" });
  const payload = JSON.parse(json.stdout);

  assert.equal(human.ok, true);
  assert.equal(human.exitCode, 0);
  assert.match(human.stdout, /^Staging: published$/mu);
  assert.match(human.stdout, /^ {2}https:\/\/books\.example\.com \(custom domain\)$/mu);
  assert.match(human.stdout, /^Current release: 20261106_090000z-ab12cd34$/mu);
  assert.match(human.stdout, /^ {2}Commit: 0123456789abcdef0123456789abcdef01234567$/mu);
  assert.match(human.stdout, /^ {2}Serve \(Start\): npm start$/mu);
  assert.match(human.stdout, /^ {2}Serve NODE_ENV: production \(the host's default for Node apps\)$/mu);
  assert.match(human.stdout, /^Latest publish: failed at 2026-11-06T09:00:05\.000Z$/mu);
  assert.match(human.stdout, /^ {2}SESSION_SECRET — generated, set, secret \(generated by Vibe64\)$/mu);
  assert.match(human.stdout, /^ {2}PUBLIC_ORIGIN — set, plain \(Staging Env value\)$/mu);
  assert.match(human.stdout, /^ {2}STRIPE_KEY — not set, required for server, secret \(user_override\)$/mu);
  assert.match(human.stdout, /^Missing before the next publish:\n {2}Secret 'Stripe' is not set for staging\.$/mu);
  assert.match(human.stdout, /Deploy page\.$/mu);
  for (const output of [human.stdout, json.stdout]) {
    for (const leaked of ["host-secret-value", "plain-host-value", "host-build-output", "host-failure-detail",
      "staging-value", "rm -rf"]) {
      assert.equal(output.includes(leaked), false, `${leaked} never reaches the agent`);
    }
  }
  assert.deepEqual(Object.keys(payload).sort(),
    ["addresses", "aiAccess", "blockers", "latestStagingPublish", "notes", "ok", "records", "release", "state"]);
  // A host that says nothing about it does not let the session use staging itself.
  assert.deepEqual(payload.aiAccess, { enabled: false, reason: "" });
  assert.match(human.stdout, /^AI access to staging: off$/mu);
  assert.deepEqual(payload.records.map((record) => Object.keys(record).sort())[0],
    ["configured", "generated", "key", "requiredFor", "secret", "source", "sourceLabel"]);
  assert.deepEqual(payload.release.steps.map((step) => step.role), ["prepare", "serve"]);
  // Only the session's bound project is asked for.
  assert.deepEqual(staging.state.stagingStatusReads,
    [{ actor: null, projectSlug: "demo" }, { actor: null, projectSlug: "demo" }]);
  assert.deepEqual(project.state.contexts, ["demo", "demo"]);
  assert.deepEqual(staging.state.sets, []);
  assert.deepEqual(staging.state.removes, []);

  const help = await command.run({ args: ["staging", "--help"], sessionId: "staging-session" });
  assert.match(help.stdout, /vibe64-helper staging status \[--json\]/u);
  assert.match(help.stdout, /never shows a value and changes nothing/u);
  const wrong = await command.run({ args: ["staging", "restart"], sessionId: "staging-session" });
  assert.equal(wrong.exitCode, 2);
  assert.match(wrong.stderr, /staging accepts only status and --json/u);
});

test("agent staging status says plainly when the installation does not publish to staging", async () => {
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: NO_STAGING_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project: createProjectService()
  });
  await command.bindSession("local-session");
  const result = await command.run({ args: ["staging", "status"], sessionId: "local-session" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_agent_staging_status_unavailable");
  assert.equal(result.stderr, "This Vibe64 installation does not publish projects.\n");
});

test("vibe64-helper staging status reaches the session's Env command socket", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-staging-command-"));
  const staging = createStagingProvider({ staging: hostedStagingStatus() });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    stagingEnvironmentProvider: staging, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project: createProjectService()
  });
  const sessionId = "staging-wrapper-session";
  try {
    const prepared = await prepareAgentEnvCommand({ commandService: command, sessionId, wrapperHostDir: root });
    await prepareAgentHelperCommand({ env: process.env, wrapperHostDir: root });
    const executed = await runWithInput(path.join(root, "vibe64-helper"), ["staging", "status"], {
      env: { ...process.env, ...prepared.env }
    });
    assert.equal(executed.code, 0, executed.stderr);
    assert.match(executed.stdout, /^Staging: published$/mu);
    assert.doesNotMatch(executed.stdout, /host-secret-value/u);
    assert.deepEqual(staging.state.stagingStatusReads, [{ actor: null, projectSlug: "demo" }]);
  } finally {
    await command.closeAllForSession(sessionId);
    await rm(root, { force: true, recursive: true });
  }
});
