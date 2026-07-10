import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "../../packages/studio-terminal-core/src/server/studioRuntimeIdentity.js";
import {
  TargetAdapter
} from "../../packages/vibe64-adapters/src/server/adapter.js";
import {
  createJskitTargetAdapter
} from "../../packages/vibe64-adapters/src/server/adapters/jskit/index.js";
import {
  JSKIT_AUTH_PROVIDER_CONFIG,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_SUPABASE_PROJECT_URL_CONFIG,
  JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG
} from "../../packages/vibe64-adapters/src/server/adapters/jskit/appAuthConfig.js";
import {
  jskitMariaDbHostPort,
  jskitMariaDbPublishedAppPassword,
  jskitMariaDbPublishedAppUser
} from "../../packages/vibe64-adapters/src/server/adapters/jskit/setupMariaDbRuntime.js";
import {
  createLaravelTargetAdapter
} from "../../packages/vibe64-adapters/src/server/adapters/laravel/index.js";
import {
  createNextjsTargetAdapter
} from "../../packages/vibe64-adapters/src/server/adapters/nextjs/index.js";
import {
  createGenericNodeWebTargetAdapter
} from "../../packages/vibe64-adapters/src/server/adapters/node-web/index.js";
import {
  createVinextTargetAdapter
} from "../../packages/vibe64-adapters/src/server/adapters/vinext/index.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapedPattern(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertNodeRuntimeCommand(command = "", innerCommand = "") {
  assert.match(command, /^bash -lc /u);
  assert.doesNotMatch(command, /\bnix --extra-experimental-features\b/u);
  assert.doesNotMatch(command, /#nodejs_22/u);
  assert.match(command, new RegExp(escapedPattern(innerCommand), "u"));
}

function assertLaravelRuntimeCommand(command = "", innerCommand = "") {
  assert.match(command, /^bash -lc /u);
  assert.doesNotMatch(command, /\bnix --extra-experimental-features\b/u);
  assert.doesNotMatch(command, /#php83/u);
  assert.doesNotMatch(command, /#php83Packages\.composer/u);
  assert.doesNotMatch(command, /#nodejs_22/u);
  assert.match(command, new RegExp(escapedPattern(innerCommand), "u"));
}

test("base adapter owns the unsupported deployment publish contract", async () => {
  const adapter = new TargetAdapter({
    id: "unit",
    label: "Unit adapter"
  });
  const plan = await adapter.createDeploymentPublishPlan();
  const environment = await adapter.getDeploymentEnvironment();

  assert.equal(plan.ok, false);
  assert.equal(plan.adapterId, "unit");
  assert.equal(plan.unsupportedReason, "adapter_publish_not_supported");
  assert.equal(environment.services[0].id, "database");
  assert.equal(environment.services[0].status, "not_required");
});

test("JSKIT adapter provides deployment publish plan and production database environment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-jskit-deploy-"));
  try {
    await writeJson(path.join(root, "package.json"), {
      scripts: {
        "db:migrate": "knex migrate:latest"
      }
    });
    const adapter = createJskitTargetAdapter();
    const config = {
      values: {
        jskit_database_runtime: "mariadb"
      }
    };
    const serviceDataRoot = path.join(root, "services");
    const deployment = {
      databaseName: "v64_prod_jskit_test",
      secret: async () => "unit-local-auth-session-secret"
    };
    const plan = await adapter.createDeploymentPublishPlan({
      config,
      context: {
        serviceDataRoot
      },
      deployment,
      targetRoot: root
    });
    const environment = await adapter.getDeploymentEnvironment({
      config,
      context: {
        serviceDataRoot
      },
      deployment,
      targetRoot: root
    });
    const managedPort = jskitMariaDbHostPort(root, {
      serviceDataRoot
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.adapterId, "jskit");
    assert.match(plan.prepare.command, /Preparing JSKIT production database/u);
    assertNodeRuntimeCommand(plan.prepare.command, "npm install --foreground-scripts --no-audit --no-fund");
    assertNodeRuntimeCommand(plan.build.command, "npm run build");
    assertNodeRuntimeCommand(plan.migrate.command, "npm run db:migrate");
    assertNodeRuntimeCommand(plan.serve.command, "npm run server");
    assert.deepEqual(plan.prepare.runtimes, ["node22", "mariadb"]);
    assert.deepEqual(plan.build.runtimes, ["node22"]);
    assert.deepEqual(plan.migrate.runtimes, ["node22"]);
    assert.deepEqual(plan.serve.runtimes, ["node22"]);
    assert.equal(plan.runtimeServices, undefined);
    assert.equal(environment.appEntries.find((entry) => entry.name === "DB_NAME").value, "v64_prod_jskit_test");
    assert.equal(environment.appEntries.find((entry) => entry.name === "DB_PORT").value, managedPort);
    assert.equal(environment.appEntries.find((entry) => entry.name === "DB_USER").value, jskitMariaDbPublishedAppUser("v64_prod_jskit_test"));
    const dbPasswordEntry = environment.appEntries.find((entry) => entry.name === "DB_PASSWORD");
    assert.equal(dbPasswordEntry.value, jskitMariaDbPublishedAppPassword("v64_prod_jskit_test", {
      targetRoot: root
    }));
    assert.equal(dbPasswordEntry.owner, "vibe64");
    assert.equal(environment.appEntries.find((entry) => entry.name === "AUTH_PROVIDER").owner, "adapter");
    assert.equal(environment.appEntries.find((entry) => entry.name === "AUTH_LOCAL_SESSION_SECRET").value, "unit-local-auth-session-secret");
    assert.equal(environment.appEntries.some((entry) => entry.name === "MYSQL_DATABASE"), false);
    assert.equal(environment.toolingEnv.MYSQL_DATABASE, "v64_prod_jskit_test");
    assert.equal(environment.toolingEnv.MYSQL_TCP_PORT, managedPort);
    assert.equal(environment.toolingEnv.VIBE64_MYSQL_USER, "root");
    assert.equal(environment.services[0].status, "ready");
    assert.equal(environment.services.find((service) => service.id === "app_auth").status, "ready");
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("JSKIT adapter marks deployment Supabase auth values as user-owned", async () => {
  const adapter = createJskitTargetAdapter();
  const environment = await adapter.getDeploymentEnvironment({
    config: {
      values: {
        [JSKIT_AUTH_PROVIDER_CONFIG]: JSKIT_AUTH_PROVIDER_SUPABASE,
        [JSKIT_SUPABASE_PROJECT_URL_CONFIG]: "https://prodref.supabase.co",
        [JSKIT_SUPABASE_PUBLISHABLE_KEY_CONFIG]: "pk_prod",
        jskit_database_runtime: "none"
      }
    },
    deployment: {},
    targetRoot: "/tmp/v64-jskit-supabase-auth"
  });
  const supabaseUrl = environment.appEntries.find((entry) => entry.name === "AUTH_SUPABASE_URL");
  const supabaseKey = environment.appEntries.find((entry) => entry.name === "AUTH_SUPABASE_PUBLISHABLE_KEY");

  assert.equal(environment.services.find((service) => service.id === "database").status, "not_required");
  assert.equal(environment.services.find((service) => service.id === "app_auth").status, "ready");
  assert.equal(supabaseUrl.owner, "user");
  assert.equal(supabaseKey.owner, "user");
  assert.equal(supabaseKey.sensitive, true);
});

test("Laravel adapter provides deployment publish plan and managed DB env", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-laravel-deploy-"));
  try {
    await writeJson(path.join(root, "composer.json"), {
      require: {
        "laravel/framework": "^12.0"
      }
    });
    await writeJson(path.join(root, "package.json"), {
      scripts: {
        build: "vite build"
      }
    });
    const adapter = createLaravelTargetAdapter();
    const config = {
      values: {
        laravel_database_runtime: "mariadb"
      }
    };
    const deployment = {
      databaseName: "v64_prod_laravel_test"
    };
    const plan = await adapter.createDeploymentPublishPlan({
      config,
      deployment,
      targetRoot: root
    });
    const environment = await adapter.getDeploymentEnvironment({
      config,
      deployment,
      targetRoot: root
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.adapterId, "laravel");
    assertNodeRuntimeCommand(plan.prepare.command, "npm install --foreground-scripts --no-audit --no-fund");
    assertNodeRuntimeCommand(plan.build.command, "npm run build");
    assertLaravelRuntimeCommand(plan.migrate.command, "php artisan migrate --force --no-interaction --no-ansi");
    assertLaravelRuntimeCommand(plan.serve.command, "php artisan serve --host=0.0.0.0 --port");
    assert.equal(plan.runtimeServices, undefined);
    assert.equal(environment.appEntries.find((entry) => entry.name === "DB_CONNECTION").value, "mariadb");
    assert.equal(environment.appEntries.find((entry) => entry.name === "DB_DATABASE").value, "v64_prod_laravel_test");
    assert.equal(environment.services[0].status, "ready");
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("Node launch adapters provide deployment publish plans from their launch descriptors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-node-adapter-deploy-"));
  try {
    const nextRoot = path.join(root, "next");
    const nodeRoot = path.join(root, "node");
    const vinextRoot = path.join(root, "vinext");
    await writeJson(path.join(nextRoot, "package.json"), {
      scripts: {
        build: "next build",
        start: "next start"
      }
    });
    await writeJson(path.join(nodeRoot, "package.json"), {
      scripts: {
        build: "vite build",
        start: "vite preview"
      }
    });
    await writeJson(path.join(vinextRoot, "package.json"), {
      dependencies: {
        vinext: "^0.1.0"
      }
    });

    const nextAdapter = createNextjsTargetAdapter();
    const nextDeployment = {
      databaseName: "v64_prod_nextjs_test"
    };
    const nextConfig = {
      values: {
        nextjs_database_runtime: "postgres"
      }
    };
    const nextPlan = await nextAdapter.createDeploymentPublishPlan({
      config: nextConfig,
      deployment: nextDeployment,
      targetRoot: nextRoot
    });
    const nextEnvironment = await nextAdapter.getDeploymentEnvironment({
      config: nextConfig,
      deployment: nextDeployment,
      targetRoot: nextRoot
    });
    const nodePlan = await createGenericNodeWebTargetAdapter().createDeploymentPublishPlan({
      targetRoot: nodeRoot
    });
    const vinextPlan = await createVinextTargetAdapter().createDeploymentPublishPlan({
      targetRoot: vinextRoot
    });

    assert.equal(nextPlan.ok, true);
    assert.equal(nextPlan.adapterId, "nextjs");
    assertNodeRuntimeCommand(nextPlan.prepare.command, "npm install --foreground-scripts --no-audit --no-fund");
    assertNodeRuntimeCommand(nextPlan.build.command, "npm run build");
    assertNodeRuntimeCommand(nextPlan.serve.command, "npm run start -- -H 0.0.0.0 -p");
    assert.equal(nextPlan.runtimeServices, undefined);
    assert.match(nextEnvironment.appEntries.find((entry) => entry.name === "DATABASE_URL").value, /\/v64_prod_nextjs_test$/u);
    assert.equal(nodePlan.ok, true);
    assert.equal(nodePlan.adapterId, "node-web");
    assertNodeRuntimeCommand(nodePlan.prepare.command, "npm install --foreground-scripts --no-audit --no-fund");
    assertNodeRuntimeCommand(nodePlan.build.command, "npm run build");
    assertNodeRuntimeCommand(nodePlan.serve.command, "npm run start -- --host 0.0.0.0 --port");
    assert.equal(vinextPlan.ok, true);
    assert.equal(vinextPlan.adapterId, "vinext");
    assertNodeRuntimeCommand(vinextPlan.prepare.command, "npm install --foreground-scripts --no-audit --no-fund");
    assert.match(vinextPlan.build.command, /vinext build/u);
    assert.match(vinextPlan.serve.command, /vinext start --hostname 0\.0\.0\.0 --port/u);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
