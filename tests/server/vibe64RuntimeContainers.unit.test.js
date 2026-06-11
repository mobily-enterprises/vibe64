import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import {
  createRuntimeContainerCheck,
  ensureRuntimeContainers,
  ensureTargetRuntimeNetwork,
  runtimeContainerCommandPreview,
  runtimeContainerManagedServicesPromptFacts,
  runtimeContainerName,
  runtimeContainerNetworkDockerArgs,
  runtimeContainerPromptFacts,
  runtimeContainerStartScript,
  runtimeContainerTerminalEnv,
  runtimeContainersTerminalEnv,
  runtimeNetworkName,
  targetRuntimeNetworkDockerArgs,
  targetRuntimeNetworkEnsureCommand
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  createJskitMariaDbRuntimeContainer,
  createJskitTenantMariaDbRuntimeContainer,
  jskitMariaDbContainerName,
  jskitMariaDbVolumeName,
  managedMariaDbAccessInstructions,
  mariaDbCapabilitySql,
  startJskitMariaDbRepair
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";
import {
  createManagedDatabaseRuntimeContainer
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  targetRuntimeProjectSlug
} from "@local/vibe64-core/server/projectRuntimeIdentity";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("managed project runtime identity follows the slug instead of the absolute path", async () => {
  await withTemporaryRoot(async (root) => {
    const oldProjectsRoot = path.join(root, "old-root");
    const newProjectsRoot = path.join(root, "new-root");
    const oldTargetRoot = path.join(oldProjectsRoot, "beepollen");
    const newTargetRoot = path.join(newProjectsRoot, "beepollen");

    const oldRuntime = await runWithProjectRequestContext({
      projectsRoot: oldProjectsRoot,
      slug: "beepollen",
      targetRoot: oldTargetRoot
    }, () => ({
      containerName: runtimeContainerName({
        adapterId: "jskit",
        containerId: "jskit-mariadb",
        targetRoot: oldTargetRoot
      }),
      networkName: runtimeNetworkName(oldTargetRoot)
    }));
    const newRuntime = await runWithProjectRequestContext({
      projectsRoot: newProjectsRoot,
      slug: "beepollen",
      targetRoot: newTargetRoot
    }, () => ({
      containerName: runtimeContainerName({
        adapterId: "jskit",
        containerId: "jskit-mariadb",
        targetRoot: newTargetRoot
      }),
      networkName: runtimeNetworkName(newTargetRoot)
    }));

    assert.deepEqual(newRuntime, oldRuntime);
    assert.deepEqual(oldRuntime, {
      containerName: "vibe64-beepollen-jskit-mariadb",
      networkName: "vibe64-beepollen-network"
    });
  });
});

test("unmanaged project runtime identity slugifies local folder names", async () => {
  await withTemporaryRoot(async (root) => {
    assert.equal(
      targetRuntimeProjectSlug(path.join(root, "Example Target App")),
      "example-target-app"
    );
    assert.equal(
      targetRuntimeProjectSlug(path.join(root, "vibe64-attachment-test-A1B2C3")),
      "vibe64-attachment-test-a1b2c3"
    );
  });
});

test("runtime container descriptors describe arbitrary containers without service catalog coupling", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const preview = runtimeContainerCommandPreview({
      aliases: [
        "mail"
      ],
      env: {
        SMTP_PASSWORD: "secret"
      },
      health: {
        command: [
          "mailpit",
          "ready"
        ]
      },
      id: "mailpit",
      image: "axllent/mailpit:latest",
      ports: [
        {
          container: 8025,
          hostPort: 18025
        }
      ],
      volumes: [
        {
          id: "data",
          target: "/data"
        }
      ]
    }, {
      adapterId: "laravel",
      targetRoot
    });

    assert.match(preview, /axllent\/mailpit:latest/u);
    assert.match(preview, /--network-alias mail/u);
    assert.match(preview, /SMTP_PASSWORD=\*\*\*\*\*/u);
    assert.doesNotMatch(preview, /secret/u);
    assert.doesNotMatch(preview, /mariadb|postgres|redis/u);
  });
});

test("runtime container checks run generic inspect, health, and ready commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const calls = [];
    const toolkit = {
      async runDocker(args) {
        calls.push(args);
        if (args.includes("{{.State.Running}}")) {
          return {
            ok: true,
            output: "true",
            stdout: "true"
          };
        }
        if (args.includes("{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}")) {
          return {
            ok: true,
            output: "healthy",
            stdout: "healthy"
          };
        }
        if (args[0] === "exec") {
          return {
            ok: true,
            output: "ready",
            stdout: "ready"
          };
        }
        return {
          ok: false,
          output: "unexpected docker call",
          stdout: ""
        };
      }
    };
    const check = createRuntimeContainerCheck(toolkit, {
      health: {
        command: [
          "service",
          "health"
        ]
      },
      id: "sidecar",
      image: "example/sidecar:1",
      label: "Sidecar",
      readyCheck: {
        command: [
          "service",
          "ready"
        ],
        observed: "ready"
      }
    }, {
      adapterId: "example",
      targetRoot
    });

    const result = await check.run({
      targetRoot
    });

    assert.equal(result.status, "pass");
    assert.match(result.observed, /ready/u);
    assert.deepEqual(calls.at(-1), [
      "exec",
      runtimeContainerName({
        adapterId: "example",
        containerId: "sidecar",
        targetRoot
      }),
      "service",
      "ready"
    ]);
  });
});

test("jskit declares MariaDB through the generic runtime container layer", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const repair = startJskitMariaDbRepair(targetRoot);
    const terminalEnv = await runtimeContainerTerminalEnv(createJskitMariaDbRuntimeContainer(), {
      adapterId: "jskit",
      targetRoot
    });

    assert.equal(repair.actionId, "start-runtime-container-jskit-mariadb");
    assert.match(repair.commandPreview, /mariadb:12\.0\.2/u);
    assert.doesNotMatch(repair.commandPreview, /MARIADB_DATABASE=/u);
    assert.match(repair.commandPreview, /MARIADB_ROOT_PASSWORD=\*\*\*\*\*/u);
    assert.doesNotMatch(repair.commandPreview, /vibe64_jskit_root/u);
    assert.doesNotMatch(repair.commandPreview, /127\.0\.0\.1:13306:3306/u);
    assert.doesNotMatch(
      managedMariaDbAccessInstructions("app_db", targetRoot),
      /Host:/u
    );
    assert.deepEqual(
      targetRuntimeNetworkDockerArgs(targetRoot),
      runtimeContainerNetworkDockerArgs(targetRoot)
    );
    assert.equal(
      runtimeContainerNetworkDockerArgs(targetRoot)[1],
      runtimeNetworkName(targetRoot)
    );
    assert.deepEqual(terminalEnv, {
      VIBE64_MYSQL_USER: "root",
      MYSQL_DATABASE: path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"),
      MYSQL_HOST: "vibe64-mariadb",
      MYSQL_PWD: "vibe64_jskit_root",
      MYSQL_TCP_PORT: "3306"
    });
  });
});

test("jskit MariaDB runtime is shared while databases remain project-scoped", async () => {
  await withTemporaryRoot(async (root) => {
    const beepollenRoot = path.join(root, "beepollen");
    const dogandgroomRoot = path.join(root, "dogandgroom");
    const beepollenDescriptor = createJskitMariaDbRuntimeContainer({
      targetRoot: beepollenRoot
    });
    const dogandgroomDescriptor = createJskitMariaDbRuntimeContainer({
      targetRoot: dogandgroomRoot
    });
    const beepollenEnv = await runtimeContainerTerminalEnv(beepollenDescriptor, {
      adapterId: "jskit",
      targetRoot: beepollenRoot
    });
    const dogandgroomEnv = await runtimeContainerTerminalEnv(dogandgroomDescriptor, {
      adapterId: "jskit",
      targetRoot: dogandgroomRoot
    });
    const script = runtimeContainerStartScript(beepollenDescriptor, {
      adapterId: "jskit",
      targetRoot: beepollenRoot
    });

    assert.equal(
      jskitMariaDbContainerName(beepollenRoot),
      jskitMariaDbContainerName(dogandgroomRoot)
    );
    assert.equal(jskitMariaDbVolumeName(), "vibe64_jskit_mariadb_data");
    assert.match(script, /--name vibe64-jskit-mariadb/u);
    assert.match(script, /-v vibe64_jskit_mariadb_data:\/var\/lib\/mysql/u);
    assert.equal(beepollenEnv.MYSQL_DATABASE, "beepollen");
    assert.equal(dogandgroomEnv.MYSQL_DATABASE, "dogandgroom");
  });
});

test("shared jskit MariaDB runtime probes without creating a project database", async () => {
  await withTemporaryRoot(async (root) => {
    const descriptor = createJskitTenantMariaDbRuntimeContainer({
      targetRoot: root
    });
    const script = runtimeContainerStartScript(descriptor, {
      adapterId: "jskit",
      targetRoot: root
    });
    const terminalEnv = await runtimeContainerTerminalEnv(descriptor, {
      adapterId: "jskit",
      targetRoot: root
    });

    assert.match(script, /--name vibe64-jskit-mariadb/u);
    assert.match(script, /-v vibe64_jskit_mariadb_data:\/var\/lib\/mysql/u);
    assert.doesNotMatch(script, /MARIADB_DATABASE=/u);
    assert.doesNotMatch(script, /CREATE DATABASE IF NOT EXISTS/u);
    assert.equal(Object.hasOwn(terminalEnv, "MYSQL_DATABASE"), false);
  });
});

test("runtime container terminal env is emitted only for required descriptors", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const terminalEnv = await runtimeContainersTerminalEnv([
      {
        id: "required-db",
        image: "example/db:1",
        required: true,
        terminalEnv: {
          DB_HOST: "required-db"
        }
      },
      {
        id: "unused-db",
        image: "example/db:1",
        required: false,
        terminalEnv: {
          DB_HOST: "unused-db"
        }
      }
    ], {
      adapterId: "unit",
      targetRoot
    });

    assert.deepEqual(terminalEnv, {
      DB_HOST: "required-db"
    });
  });
});

test("required runtime containers are started before managed-service terminals launch", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const calls = [];
    const results = await ensureRuntimeContainers([
      {
        aliases: ["required-db"],
        health: {
          command: ["db", "ready"]
        },
        id: "required-db",
        image: "example/db:1",
        required: true
      },
      {
        id: "unused-db",
        image: "example/db:1",
        required: false
      }
    ], {
      adapterId: "unit",
      runCommand: async (command, args, options) => {
        calls.push({
          args,
          command,
          options
        });
        return {
          ok: true,
          output: "started"
        };
      },
      targetRoot
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, "required-db");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "bash");
    assert.deepEqual(calls[0].args.slice(0, 1), ["-lc"]);
    assert.equal(calls[0].options.cwd, targetRoot);
    assert.match(calls[0].args[1], /docker network create/u);
    assert.match(calls[0].args[1], /--network-alias required-db/u);
    assert.doesNotMatch(calls[0].args[1], /unused-db/u);
  });
});

test("runtime container startup failures block terminal launch with context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await assert.rejects(
      ensureRuntimeContainers([
        {
          id: "required-db",
          image: "example/db:1",
          label: "Required DB"
        }
      ], {
        adapterId: "unit",
        runCommand: async () => ({
          ok: false,
          output: "docker failed"
        }),
        targetRoot
      }),
      /Required DB could not start before launching the terminal: docker failed/u
    );
  });
});

test("runtime container prompt facts expose connection details with secrets masked", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const [facts] = await runtimeContainerPromptFacts([
      createManagedDatabaseRuntimeContainer({
        adapterId: "nextjs",
        host: "nextjs-postgres",
        password: "nextjs_password",
        runtime: "postgres",
        targetRoot,
        username: "nextjs"
      })
    ], {
      adapterId: "nextjs",
      targetRoot
    });

    assert.equal(facts.id, "nextjs-postgres");
    assert.equal(facts.label, "nextjs PostgreSQL");
    assert.equal(facts.aliases.includes("nextjs-postgres"), true);
    assert.match(facts.expected, /Managed PostgreSQL is running/u);
    assert.equal(facts.required, true);
    assert.match(facts.readyExplanation, /managed PostgreSQL runtime is ready/u);
    assert.equal(facts.terminalEnv.PGHOST, "nextjs-postgres");
    assert.equal(facts.terminalEnv.PGPASSWORD, "*****");
    assert.equal(facts.env.POSTGRES_PASSWORD, "*****");
    assert.notEqual(facts.terminalEnv.PGPASSWORD, "nextjs_password");
  });
});

test("managed service prompt facts expose database client commands without container internals", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const [mysqlFacts, postgresFacts] = await runtimeContainerManagedServicesPromptFacts([
      createManagedDatabaseRuntimeContainer({
        adapterId: "nextjs",
        host: "nextjs-mysql",
        rootPassword: "nextjs_root_password",
        runtime: "mysql",
        targetRoot
      }),
      createManagedDatabaseRuntimeContainer({
        adapterId: "laravel",
        host: "laravel-postgres",
        password: "laravel_password",
        runtime: "postgres",
        targetRoot,
        username: "laravel"
      })
    ], {
      adapterId: "unit",
      targetRoot
    });

    assert.equal(mysqlFacts.kind, "database");
    assert.equal(mysqlFacts.client, "mysql");
    assert.equal(mysqlFacts.alternateClient, "mariadb");
    assert.match(mysqlFacts.command, /^mysql /u);
    assert.match(mysqlFacts.command, /--execute="<SQL>"/u);
    assert.match(mysqlFacts.checkCommand, /--execute="SELECT 1"/u);
    assert.match(mysqlFacts.interactiveCommand, /^mysql /u);
    assert.doesNotMatch(mysqlFacts.interactiveCommand, /--execute/u);
    assert.match(mysqlFacts.environment.MYSQL_HOST, /host/u);
    assert.match(mysqlFacts.environment.MYSQL_PWD, /password/u);
    assert.equal(mysqlFacts.generatorTokenHints.host, "$MYSQL_HOST");
    assert.equal(mysqlFacts.generatorTokenHints.password, "$MYSQL_PWD");
    assert.equal(mysqlFacts.generatorTokenHints.database, "$MYSQL_DATABASE");
    assert.equal(postgresFacts.client, "psql");
    assert.match(postgresFacts.command, /^psql /u);
    assert.match(postgresFacts.command, /--command="<SQL>"/u);
    assert.match(postgresFacts.checkCommand, /--command="SELECT 1"/u);
    assert.match(postgresFacts.interactiveCommand, /^psql /u);
    assert.doesNotMatch(postgresFacts.interactiveCommand, /--command/u);
    assert.match(postgresFacts.environment.PGHOST, /host/u);
    assert.match(postgresFacts.environment.PGPASSWORD, /password/u);
    assert.equal(postgresFacts.generatorTokenHints.host, "$PGHOST");
    assert.equal(postgresFacts.generatorTokenHints.password, "$PGPASSWORD");
    for (const service of [mysqlFacts, postgresFacts]) {
      assert.equal(Object.hasOwn(service, "containerName"), false);
      assert.equal(Object.hasOwn(service, "network"), false);
      assert.equal(Object.hasOwn(service, "image"), false);
      assert.equal(Object.hasOwn(service, "readyCheck"), false);
    }
  });
});

test("managed service prompt facts only include services whose env is injected", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const facts = await runtimeContainerManagedServicesPromptFacts([
      createManagedDatabaseRuntimeContainer({
        adapterId: "nextjs",
        host: "nextjs-mysql",
        rootPassword: "nextjs_root_password",
        runtime: "mysql",
        targetRoot
      }),
      {
        ...createManagedDatabaseRuntimeContainer({
          adapterId: "nextjs",
          host: "nextjs-postgres",
          password: "nextjs_password",
          runtime: "postgres",
          targetRoot,
          username: "nextjs"
        }),
        required: false
      }
    ], {
      adapterId: "nextjs",
      targetRoot
    });

    assert.deepEqual(facts.map((fact) => fact.runtime), ["mysql"]);
  });
});

test("runtime container prompt facts mask database URLs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const [facts] = await runtimeContainerPromptFacts([
      {
        id: "app-db",
        image: "example/db:1",
        terminalEnv: {
          DATABASE_URL: "postgresql://user:secret@app-db:5432/app"
        }
      }
    ], {
      adapterId: "unit",
      targetRoot
    });

    assert.equal(facts.terminalEnv.DATABASE_URL, "*****");
  });
});

test("managed database descriptors expose client terminal environment", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const mysqlEnv = await runtimeContainerTerminalEnv(createManagedDatabaseRuntimeContainer({
      adapterId: "nextjs",
      host: "nextjs-mysql",
      rootPassword: "nextjs_root_password",
      runtime: "mysql",
      targetRoot
    }), {
      adapterId: "nextjs",
      targetRoot
    });
    const postgresEnv = await runtimeContainerTerminalEnv(createManagedDatabaseRuntimeContainer({
      adapterId: "laravel",
      host: "laravel-postgres",
      password: "laravel_password",
      runtime: "postgres",
      targetRoot,
      username: "laravel"
    }), {
      adapterId: "laravel",
      targetRoot
    });

    assert.deepEqual(mysqlEnv, {
      VIBE64_MYSQL_USER: "root",
      MYSQL_DATABASE: path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"),
      MYSQL_HOST: "nextjs-mysql",
      MYSQL_PWD: "nextjs_root_password",
      MYSQL_TCP_PORT: "3306"
    });
    assert.deepEqual(postgresEnv, {
      PGDATABASE: path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"),
      PGHOST: "laravel-postgres",
      PGPASSWORD: "laravel_password",
      PGPORT: "5432",
      PGUSER: "laravel"
    });
  });
});

test("target runtime network preparation creates the shared network only when missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const networkName = runtimeNetworkName(targetRoot);
    const calls = [];
    const result = await ensureTargetRuntimeNetwork(targetRoot, {
      async runCommand(command, args) {
        calls.push([command, args]);
        if (args[1] === "inspect") {
          return {
            ok: false,
            output: "network not found"
          };
        }
        return {
          ok: true,
          output: networkName
        };
      }
    });

    const targetLabel = `vibe64.target=${targetRuntimeProjectSlug(targetRoot)}`;
    assert.equal(result, networkName);
    assert.deepEqual(calls, [
      ["docker", ["network", "inspect", networkName]],
      [
        "docker",
        [
          "network",
          "create",
          "--label",
          "vibe64.kind=runtime-network",
          "--label",
          `vibe64.daemon-pid=${process.pid}`,
          "--label",
          targetLabel,
          networkName
        ]
      ]
    ]);

    calls.length = 0;
    assert.equal(await ensureTargetRuntimeNetwork(targetRoot, {
      async runCommand(command, args) {
        calls.push([command, args]);
        return {
          ok: true,
          output: networkName
        };
      }
    }), networkName);
    assert.deepEqual(calls, [
      ["docker", ["network", "inspect", networkName]]
    ]);
  });
});

test("target runtime network shell command tolerates concurrent network creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const command = targetRuntimeNetworkEnsureCommand(targetRoot);
    const networkName = runtimeNetworkName(targetRoot);
    const inspectCommand = `docker network inspect ${networkName} >/dev/null 2>&1`;
    const targetLabel = `vibe64.target=${targetRuntimeProjectSlug(targetRoot)}`;

    assert.equal(command.split(" || ").filter((part) => part === inspectCommand).length, 2);
    assert.ok(command.includes(`docker network create --label vibe64.kind=runtime-network`));
    assert.ok(command.includes(`--label ${targetLabel}`));
    assert.ok(command.includes(`${networkName} >/dev/null`));
  });
});

test("runtime container start script safely displays shell-quoted commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const script = runtimeContainerStartScript(createJskitMariaDbRuntimeContainer({
      targetRoot
    }), {
      adapterId: "jskit",
      targetRoot
    });
    const syntax = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: script
    });

    assert.equal(syntax.status, 0, syntax.stderr);
    assert.match(script, /printf '%s\\n'/u);
    assert.doesNotMatch(script, /echo '\\$ docker run/u);
    assert.doesNotMatch(script, /127\.0\.0\.1:13306:3306/u);
    assert.doesNotMatch(script, /MARIADB_DATABASE=/u);
    assert.doesNotMatch(script, /CREATE DATABASE IF NOT EXISTS/u);
    assert.match(script, /timeout 15s docker exec vibe64-jskit-mariadb/u);
    assert.match(script, /if ! docker start vibe64-jskit-mariadb/u);
    assert.match(script, /container could not start\. Recreating the container while keeping managed volumes\./u);
    assert.match(script, /docker rm -f vibe64-jskit-mariadb/u);
  });
});

test("JSKIT MariaDB readiness probe uses isolated temporary schema names", () => {
  const sql = mariaDbCapabilitySql({
    appDatabaseName: "dogandgroom"
  });

  assert.match(sql, /CREATE DATABASE IF NOT EXISTS `dogandgroom`/u);
  assert.match(sql, /CONCAT\('vibe64_jskit_probe_', REPLACE\(UUID\(\), '-', ''\)\)/u);
  assert.match(sql, /CREATE TABLE `', @vibe64_jskit_probe_identifier, '`\.`capability_probe`/u);
  assert.match(sql, /DROP TABLE IF EXISTS `', @vibe64_jskit_probe_identifier, '`\.`capability_probe`/u);
  assert.match(sql, /DROP DATABASE IF EXISTS `', @vibe64_jskit_probe_identifier, '`/u);
  assert.doesNotMatch(sql, /DROP TABLE `vibe64_jskit_probe`\.`capability_probe`/u);
  assert.doesNotMatch(sql, /DROP DATABASE `vibe64_jskit_probe`/u);
});
