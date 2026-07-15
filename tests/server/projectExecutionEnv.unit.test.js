import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  JskitTargetAdapter
} from "@local/vibe64-adapters/server/adapters/jskit/adapter";
import {
  RUNTIME_CONFIG_PHASES
} from "@local/vibe64-core/server/runtimeConfig";
import {
  resolveCommandEnv
} from "@local/vibe64-execution/server";
import {
  loadProjectExecutionEnv
} from "../../packages/vibe64-terminals/src/server/projectExecutionEnv.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    reject,
    resolve
  };
}

function managedMariaDbRuntime() {
  return {
    adapter: new JskitTargetAdapter(),
    projectConfig: {
      values: {
        jskit_database_runtime: "mariadb"
      }
    },
    targetRoot: "/runtime/source"
  };
}

test("JSKIT prepares and probes managed MariaDB before exposing an empty seed environment", async () => {
  await withTemporaryRoot(async (root) => {
    const inheritedPolicyEnv = Object.fromEntries([
      "DB_HOST",
      "DB_NAME",
      "DB_PASSWORD",
      "DB_PORT",
      "DB_USER",
      "PATH"
    ].map((key) => [key, process.env[key]]));
    const projectTargetRoot = path.join(root, "project");
    const serviceDataRoot = path.join(root, "services");
    const sourcePath = path.join(root, "sessions", "empty-seed", "source");
    const databaseName = "empty_seed_database";
    await Promise.all([
      mkdir(projectTargetRoot, {
        recursive: true
      }),
      mkdir(serviceDataRoot, {
        recursive: true
      }),
      mkdir(sourcePath, {
        recursive: true
      })
    ]);
    const preparation = deferred();
    const events = [];
    let commandRequest = null;
    const environmentPromise = loadProjectExecutionEnv({
      projectService: {
        currentServiceDataRoot() {
          return serviceDataRoot;
        },
        currentTargetRoot() {
          return projectTargetRoot;
        },
        async projectRuntimeConfigEnvironment() {
          events.push("runtime-config-resolved");
          return {
            DB_CLIENT: "mysql2",
            DB_HOST: "127.0.0.1",
            DB_NAME: databaseName,
            DB_PASSWORD: "unit-password",
            DB_PORT: "33306",
            DB_USER: "vibe64_dev_app"
          };
        }
      },
      runCommand(request) {
        events.push("database-preparation-started");
        commandRequest = request;
        return preparation.promise;
      },
      runtime: managedMariaDbRuntime(),
      session: {
        sessionId: "empty-seed",
        metadata: {
          source_path: sourcePath
        }
      },
      target: "codex",
      targetRoot: sourcePath
    }).then((env) => {
      events.push("environment-exposed");
      return env;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, [
      "runtime-config-resolved",
      "database-preparation-started"
    ]);
    assert.equal(commandRequest.actor, "app");
    assert.equal(commandRequest.command, "bash");
    assert.equal(commandRequest.cwd, projectTargetRoot);
    assert.equal(commandRequest.envPolicy, "project");
    assert.equal(commandRequest.baseEnv, undefined);
    assert.equal(commandRequest.env, undefined);
    assert.equal(commandRequest.mode, "capture");
    assert.equal(commandRequest.purpose, "setup");
    assert.deepEqual(commandRequest.runtimes, ["mariadb"]);
    assert.ok(commandRequest.allowedRoots.includes(projectTargetRoot));
    assert.ok(commandRequest.allowedRoots.includes(serviceDataRoot));
    assert.equal(commandRequest.project.targetRoot, projectTargetRoot);
    assert.equal(commandRequest.project.configEnv, undefined);
    assert.equal(commandRequest.project.databaseEnv, undefined);
    assert.equal(commandRequest.project.runtimeConfigEnv, undefined);
    const preparationEnv = resolveCommandEnv({
      baseEnv: {
        ...process.env,
        DB_CLIENT: "mysql2",
        DB_PASSWORD: "ambient-app-password",
        MYSQL_PWD: "ambient-native-password"
      },
      request: commandRequest
    });
    assert.equal(preparationEnv.DB_PASSWORD, undefined);
    assert.equal(preparationEnv.MYSQL_PWD, undefined);
    assert.match(commandRequest.args.at(-1), new RegExp(`development_database=${databaseName}`, "u"));
    assert.match(commandRequest.args.at(-1), /mariadbd/u);
    assert.match(commandRequest.args.at(-1), /--execute="SELECT 1"/u);

    preparation.resolve({
      ok: true,
      stdout: "ready"
    });
    const env = await environmentPromise;
    assert.equal(env.DB_NAME, databaseName);
    assert.deepEqual(events, [
      "runtime-config-resolved",
      "database-preparation-started",
      "environment-exposed"
    ]);
    assert.deepEqual(Object.fromEntries(Object.keys(inheritedPolicyEnv).map((key) => [
      key,
      process.env[key]
    ])), inheritedPolicyEnv);
  });
});

test("JSKIT managed MariaDB preparation follows runtime phases and project configuration", async () => {
  await withTemporaryRoot(async (root) => {
    const serviceDataRoot = path.join(root, "services");
    await mkdir(serviceDataRoot, {
      recursive: true
    });
    let preparationCount = 0;
    const projectService = {
      currentServiceDataRoot() {
        return serviceDataRoot;
      },
      currentTargetRoot() {
        return root;
      },
      async projectRuntimeConfigEnvironment() {
        return {
          DB_NAME: "phase_database"
        };
      }
    };
    const runCommand = async () => {
      preparationCount += 1;
      return {
        ok: true
      };
    };

    await loadProjectExecutionEnv({
      projectService,
      runCommand,
      runtime: managedMariaDbRuntime(),
      spec: {
        runtimeConfigPhases: [RUNTIME_CONFIG_PHASES.INSTALL]
      },
      target: "command",
      targetRoot: root
    });
    await loadProjectExecutionEnv({
      projectService,
      runCommand,
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {
          values: {
            jskit_database_runtime: "none"
          }
        },
        targetRoot: root
      },
      target: "codex",
      targetRoot: root
    });

    assert.equal(preparationCount, 0);
  });
});

test("execution-environment preparation coalesces only concurrent work and reruns afterwards", async () => {
  const gate = deferred();
  const coalesceKey = `unit-coalesce-${crypto.randomUUID()}`;
  let preparationCount = 0;
  let descriptorCount = 0;
  const runtime = {
    adapter: {
      async listExecutionEnvironmentPreparations() {
        descriptorCount += 1;
        return [{
          allowedRoots: ["/tmp"],
          args: [String(descriptorCount)],
          coalesceKey,
          command: "unit-prepare",
          cwd: "/tmp",
          id: "unit-preparation",
          runtimes: []
        }];
      }
    },
    projectConfig: {},
    targetRoot: "/tmp"
  };
  const projectService = {
    async projectRuntimeConfigEnvironment() {
      return {};
    }
  };
  const runCommand = async () => {
    preparationCount += 1;
    if (preparationCount === 1) {
      return gate.promise;
    }
    return {
      ok: true
    };
  };
  const input = {
    projectService,
    runCommand,
    runtime,
    target: "codex",
    targetRoot: "/tmp"
  };

  const first = loadProjectExecutionEnv(input);
  const second = loadProjectExecutionEnv(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(descriptorCount, 2);
  assert.equal(preparationCount, 1);
  gate.resolve({
    ok: true
  });
  await Promise.all([first, second]);

  await loadProjectExecutionEnv(input);
  assert.equal(preparationCount, 2);
});

test("failed execution-environment preparation is a retryable platform error and can be retried", async () => {
  const coalesceKey = `unit-failure-${crypto.randomUUID()}`;
  let preparationCount = 0;
  const runtime = {
    adapter: {
      async listExecutionEnvironmentPreparations() {
        return [{
          allowedRoots: ["/tmp"],
          coalesceKey,
          command: "unit-prepare",
          cwd: "/tmp",
          id: "unit-preparation",
          label: "prepare the unit service",
          runtimes: []
        }];
      }
    },
    projectConfig: {},
    targetRoot: "/tmp"
  };
  const input = {
    projectService: {
      async projectRuntimeConfigEnvironment() {
        return {
          UNIT_ENV: "must-not-be-exposed-on-failure"
        };
      }
    },
    runCommand: async () => {
      preparationCount += 1;
      return preparationCount === 1
        ? {
            code: "unit_connection_refused",
            ok: false,
            stderr: "Managed service refused the readiness probe."
          }
        : {
            ok: true
          };
    },
    runtime,
    target: "codex",
    targetRoot: "/tmp"
  };

  await assert.rejects(
    () => loadProjectExecutionEnv(input),
    (error) => {
      assert.equal(error.code, "vibe64_execution_environment_preparation_failed");
      assert.equal(error.preparationId, "unit-preparation");
      assert.equal(error.resultCode, "unit_connection_refused");
      assert.equal(error.retryable, true);
      assert.match(error.message, /^Vibe64 could not prepare the unit service\. Your work is safe\./u);
      assert.match(error.message, /refused the readiness probe/u);
      return true;
    }
  );
  const env = await loadProjectExecutionEnv(input);
  assert.equal(env.UNIT_ENV, "must-not-be-exposed-on-failure");
  assert.equal(preparationCount, 2);
});
