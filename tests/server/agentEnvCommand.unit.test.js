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
import { NO_PRODUCTION_ENVIRONMENT } from "../../packages/vibe64-terminals/src/server/productionEnvironment.js";
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

function createProductionProvider({
  deployment = null,
  records = []
} = {}) {
  const state = {
    deploymentReads: [],
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
    async readDeployment(input = {}) {
      state.deploymentReads.push(input);
      return { deployment, ok: true };
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
          scope: "prod",
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
  const production = createProductionProvider({
    records: [{
      editable: true,
      key: "API_TOKEN",
      owner: "user",
      requiredFor: ["deploy"],
      scope: "prod",
      secret: true,
      source: "user_override",
      value: "********",
      valuePresent: true
    }]
  });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    productionEnvironmentProvider: production,
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
  assert.equal(payload.scopes.production.records[0].key, "API_TOKEN");
  assert.equal(payload.scopes.production.records[0].secret, true);
  assert.equal(payload.scopes.production.records[0].state, "configured");
  assert.equal(payload.scopes.production.records[0].stored, true);
  assert.equal(Object.hasOwn(payload.scopes.development.records[0], "value"), false);
  assert.equal(Object.hasOwn(payload.scopes.production.records[0], "value"), false);
  assert.doesNotMatch(result.stdout, /development\.example\.test/u);
  assert.doesNotMatch(result.stdout, /\*\*\*\*\*\*\*\*/u);
  assert.deepEqual(project.state.contexts, ["demo"]);

  const help = await command.run({ args: ["--help"], sessionId: "status-session" });
  assert.match(help.stdout, /--secret marks the value as a secret/u);
  assert.match(help.stdout, /keys\nwhose names look secret .* become secrets automatically/u);
  assert.match(help.stdout, /pipe\nit to env set <scope> <KEY> --secret\. Never write it into the generated \.env/u);
});

test("agent Env persists and reports empty development and production values", async () => {
  const project = createProjectService();
  const production = createProductionProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    productionEnvironmentProvider: production,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("empty-session");

  const development = await command.run({
    args: ["set", "development", "EMPTY_SECRET", "--secret", "--json"],
    sessionId: "empty-session",
    stdin: ""
  });
  const productionResult = await command.run({
    args: ["set", "production", "EMPTY_PLAIN", "--json"],
    sessionId: "empty-session",
    stdin: ""
  });
  const status = await command.run({
    args: ["status", "all", "--json"],
    sessionId: "empty-session"
  });
  const removedProduction = await command.run({
    args: ["remove", "production", "EMPTY_PLAIN", "--json"],
    sessionId: "empty-session"
  });
  const developmentPayload = JSON.parse(development.stdout);
  const productionPayload = JSON.parse(productionResult.stdout);
  const statusPayload = JSON.parse(status.stdout);
  const removedProductionPayload = JSON.parse(removedProduction.stdout);

  assert.equal(development.ok, true);
  assert.equal(developmentPayload.created, true);
  assert.equal(developmentPayload.empty, true);
  assert.equal(productionResult.ok, true);
  assert.equal(productionPayload.created, true);
  assert.equal(productionPayload.empty, true);
  assert.deepEqual(project.state.saves[0].values, {
    EMPTY_SECRET: {
      secret: true,
      value: ""
    }
  });
  assert.deepEqual(production.state.sets, [{
    actor: null,
    key: "EMPTY_PLAIN",
    projectSlug: "demo",
    secret: false,
    value: ""
  }]);
  assert.equal(removedProductionPayload.changed, true);
  assert.deepEqual(production.state.removes, [{
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
  assert.equal(statusPayload.scopes.production.records[0].state, "empty");
  assert.equal(statusPayload.scopes.production.records[0].stored, true);
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
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
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

test("agent Env production writes use only the host production provider", async () => {
  const project = createProjectService();
  const production = createProductionProvider();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    productionEnvironmentProvider: production,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  // The person whose request prepared the agent reaches the host with each change.
  const actor = { role: "member", username: "teammate" };
  await runWithProjectRequestContext({ slug: "demo", vibe64User: actor }, () => command.bindSession("production-session"));
  const secretValue = "private-production-value";

  const result = await command.run({
    args: ["set", "production", "DEPLOY_TOKEN", "--json"],
    sessionId: "production-session",
    stdin: secretValue
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.scope, "production");
  assert.equal(payload.key, "DEPLOY_TOKEN");
  assert.equal(payload.created, true);
  assert.equal(payload.secret, true);
  assert.equal(Object.hasOwn(payload, "value"), false);
  assert.deepEqual(production.state.sets, [{
    actor,
    key: "DEPLOY_TOKEN",
    projectSlug: "demo",
    secret: true,
    value: secretValue
  }]);
  assert.deepEqual(project.state.saves, []);
  assert.deepEqual(project.state.contexts, ["demo"]);
  assert.deepEqual(production.state.reads, [{ projectSlug: "demo" }]);
  assert.doesNotMatch(result.stdout, new RegExp(secretValue, "u"));

  const removed = await command.run({ args: ["remove", "production", "DEPLOY_TOKEN"], sessionId: "production-session" });
  assert.equal(removed.exitCode, 0);
  assert.deepEqual(production.state.removes, [{ actor, key: "DEPLOY_TOKEN", projectSlug: "demo" }]);

  // A host's refusal of that person reaches the agent as the host worded it.
  production.setVariable = async () => ({ ok: false, code: "vibe64_owner_required", error: "Only the owner changes production values here." });
  const refused = await command.run({
    args: ["set", "production", "DEPLOY_TOKEN"],
    sessionId: "production-session",
    stdin: secretValue
  });
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.code, "vibe64_owner_required");
  assert.equal(refused.stderr, "Only the owner changes production values here.\n");
  assert.doesNotMatch(`${refused.stdout || ""}${refused.stderr}`, new RegExp(secretValue, "u"));
});

test("agent Env refuses system-managed values and unavailable production writes", async () => {
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
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("guard-session");

  const managed = await command.run({
    args: ["set", "development", "DATABASE_URL"],
    sessionId: "guard-session",
    stdin: "attempted-override"
  });
  const production = await command.run({
    args: ["set", "production", "API_TOKEN"],
    sessionId: "guard-session",
    stdin: "attempted-production"
  });

  assert.equal(managed.ok, false);
  assert.equal(managed.code, "vibe64_agent_env_command_managed_value");
  assert.doesNotMatch(managed.stderr, /attempted-override/u);
  assert.equal(production.ok, false);
  assert.equal(production.code, "vibe64_agent_env_command_production_unavailable");
  assert.doesNotMatch(production.stderr, /attempted-production/u);
  assert.deepEqual(project.state.saves, []);
});

test("agent Env refuses a stale session binding after the project identity changes", async () => {
  const project = createProjectService();
  const command = createAgentEnvCommandService({ logger: silentLogger,
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
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
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
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
  assert.match(unchanged.stdout, /was not stored; no change/u);
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
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
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
  const command = createAgentEnvCommandService({ logger: silentLogger, productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
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
function hostedDeployment() {
  return {
    addresses: [
      { label: "Vibe64 URL", url: "https://books.example.test" },
      { label: "custom domain", url: "https://books.example.com" }
    ],
    blockers: ["Secret 'Stripe' is not set for production."],
    environmentValues: { SESSION_SECRET: "host-secret-value" },
    error: "npm ERR! host-build-output",
    latestDeploy: { at: "2026-11-06T09:00:05.000Z", error: "host-failure-detail", status: "failed" },
    notes: ["The project owner changes Production Env on the project's Deploy page."],
    records: [
      { generated: true, key: "SESSION_SECRET", requiredFor: [], secret: true, source: "user_override",
        sourceLabel: "generated by Vibe64", value: "host-secret-value", valuePresent: true },
      { key: "PUBLIC_ORIGIN", requiredFor: [], secret: false, source: "user_override",
        sourceLabel: "Production Env value", value: "https://plain-host-value.example.test", valuePresent: true },
      { key: "STRIPE_KEY", requiredFor: ["server"], secret: true, source: "user_override", valuePresent: false }
    ],
    release: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      deployedAt: "2026-11-06T09:00:00.000Z",
      environment: { values: { PUBLIC_ORIGIN: "https://plain-host-value.example.test" } },
      id: "20261106_090000z-ab12cd34",
      serveEnvironment: [{ effect: "production (the host's default for Node apps)", key: "NODE_ENV", value: "production-value" }],
      steps: [
        { command: "npm ci", label: "Install", role: "prepare" },
        { command: "npm start", label: "Start", role: "serve" },
        { command: "rm -rf /", label: "Injected", role: "restart" }
      ]
    },
    state: "deployed"
  };
}

test("agent deployment status shows the bound project's deployment and never a value", async () => {
  const project = createProjectService();
  const production = createProductionProvider({ deployment: hostedDeployment() });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    productionEnvironmentProvider: production,
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project
  });
  await command.bindSession("deployment-session");

  const human = await command.run({ args: ["deployment", "status"], sessionId: "deployment-session" });
  const json = await command.run({ args: ["deployment", "--json"], sessionId: "deployment-session" });
  const payload = JSON.parse(json.stdout);

  assert.equal(human.ok, true);
  assert.equal(human.exitCode, 0);
  assert.match(human.stdout, /^Deployment: deployed$/mu);
  assert.match(human.stdout, /^ {2}https:\/\/books\.example\.com \(custom domain\)$/mu);
  assert.match(human.stdout, /^Current release: 20261106_090000z-ab12cd34$/mu);
  assert.match(human.stdout, /^ {2}Commit: 0123456789abcdef0123456789abcdef01234567$/mu);
  assert.match(human.stdout, /^ {2}Serve \(Start\): npm start$/mu);
  assert.match(human.stdout, /^ {2}Serve NODE_ENV: production \(the host's default for Node apps\)$/mu);
  assert.match(human.stdout, /^Latest deploy: failed at 2026-11-06T09:00:05\.000Z$/mu);
  assert.match(human.stdout, /^ {2}SESSION_SECRET — generated, set, secret \(generated by Vibe64\)$/mu);
  assert.match(human.stdout, /^ {2}PUBLIC_ORIGIN — set, plain \(Production Env value\)$/mu);
  assert.match(human.stdout, /^ {2}STRIPE_KEY — not set, required for server, secret \(user_override\)$/mu);
  assert.match(human.stdout, /^Missing before the next deploy:\n {2}Secret 'Stripe' is not set for production\.$/mu);
  assert.match(human.stdout, /Deploy page\.$/mu);
  for (const output of [human.stdout, json.stdout]) {
    for (const leaked of ["host-secret-value", "plain-host-value", "host-build-output", "host-failure-detail",
      "production-value", "rm -rf"]) {
      assert.equal(output.includes(leaked), false, `${leaked} never reaches the agent`);
    }
  }
  assert.deepEqual(Object.keys(payload).sort(), ["addresses", "blockers", "latestDeploy", "notes", "ok", "records", "release", "state"]);
  assert.deepEqual(payload.records.map((record) => Object.keys(record).sort())[0],
    ["configured", "generated", "key", "requiredFor", "secret", "source", "sourceLabel"]);
  assert.deepEqual(payload.release.steps.map((step) => step.role), ["prepare", "serve"]);
  // Only the session's bound project is asked for.
  assert.deepEqual(production.state.deploymentReads, [{ projectSlug: "demo" }, { projectSlug: "demo" }]);
  assert.deepEqual(project.state.contexts, ["demo", "demo"]);
  assert.deepEqual(production.state.sets, []);
  assert.deepEqual(production.state.removes, []);

  const help = await command.run({ args: ["deployment", "--help"], sessionId: "deployment-session" });
  assert.match(help.stdout, /vibe64-helper deployment status \[--json\]/u);
  assert.match(help.stdout, /never shows a value and changes nothing/u);
  const wrong = await command.run({ args: ["deployment", "restart"], sessionId: "deployment-session" });
  assert.equal(wrong.exitCode, 2);
  assert.match(wrong.stderr, /deployment accepts only status and --json/u);
});

test("agent deployment status says plainly when the installation does not deploy projects", async () => {
  const command = createAgentEnvCommandService({ logger: silentLogger,
    productionEnvironmentProvider: NO_PRODUCTION_ENVIRONMENT, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project: createProjectService()
  });
  await command.bindSession("local-session");
  const result = await command.run({ args: ["deployment", "status"], sessionId: "local-session" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_agent_deployment_unavailable");
  assert.equal(result.stderr, "This Vibe64 installation does not deploy projects.\n");
});

test("vibe64-helper deployment status reaches the session's Env command socket", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-deployment-command-"));
  const production = createProductionProvider({ deployment: hostedDeployment() });
  const command = createAgentEnvCommandService({ logger: silentLogger,
    productionEnvironmentProvider: production, savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS,
    project: createProjectService()
  });
  const sessionId = "deployment-wrapper-session";
  try {
    const prepared = await prepareAgentEnvCommand({ commandService: command, sessionId, wrapperHostDir: root });
    await prepareAgentHelperCommand({ env: process.env, wrapperHostDir: root });
    const executed = await runWithInput(path.join(root, "vibe64-helper"), ["deployment", "status"], {
      env: { ...process.env, ...prepared.env }
    });
    assert.equal(executed.code, 0, executed.stderr);
    assert.match(executed.stdout, /^Deployment: deployed$/mu);
    assert.doesNotMatch(executed.stdout, /host-secret-value/u);
    assert.deepEqual(production.state.deploymentReads, [{ projectSlug: "demo" }]);
  } finally {
    await command.closeAllForSession(sessionId);
    await rm(root, { force: true, recursive: true });
  }
});
