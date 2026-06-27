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

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-tenant";

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
        jskit_database_runtime: "mysql"
      }
    };
    const deployment = {
      databaseName: "v64_prod_jskit_test"
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
    assert.equal(plan.adapterId, "jskit");
    assert.equal(plan.build.command, "npm run build");
    assert.equal(plan.migrate.command, "npm run db:migrate");
    assert.equal(plan.serve.command, "npm run server");
    assert.equal(plan.runtimeServices.length, 1);
    assert.equal(environment.entries.find((entry) => entry.name === "MYSQL_DATABASE").value, "v64_prod_jskit_test");
    assert.equal(environment.services[0].status, "ready");
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
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
    assert.equal(plan.build.command, "npm run build");
    assert.equal(plan.migrate.command, "php artisan migrate --force --no-interaction --no-ansi");
    assert.match(plan.serve.command, /^php artisan serve --host=0\.0\.0\.0 --port/u);
    assert.equal(plan.runtimeServices[0].env.MARIADB_DATABASE, "v64_prod_laravel_test");
    assert.equal(environment.entries.find((entry) => entry.name === "DB_CONNECTION").value, "mariadb");
    assert.equal(environment.entries.find((entry) => entry.name === "DB_DATABASE").value, "v64_prod_laravel_test");
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
    assert.equal(nextPlan.build.command, "npm run build");
    assert.match(nextPlan.serve.command, /^npm run start -- -H 0\.0\.0\.0 -p/u);
    assert.equal(nextPlan.runtimeServices[0].env.POSTGRES_DB, "v64_prod_nextjs_test");
    assert.match(nextEnvironment.entries.find((entry) => entry.name === "DATABASE_URL").value, /\/v64_prod_nextjs_test$/u);
    assert.equal(nodePlan.ok, true);
    assert.equal(nodePlan.adapterId, "node-web");
    assert.equal(nodePlan.build.command, "npm run build");
    assert.match(nodePlan.serve.command, /^npm run start -- --host 0\.0\.0\.0 --port/u);
    assert.equal(vinextPlan.ok, true);
    assert.equal(vinextPlan.adapterId, "vinext");
    assert.match(vinextPlan.build.command, /vinext build/u);
    assert.match(vinextPlan.serve.command, /vinext start --hostname 0\.0\.0\.0 --port/u);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
