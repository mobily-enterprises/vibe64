import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import {
  deploymentRelationalDatabaseConnection,
  relationalDatabaseAppUser,
  relationalDatabaseConnectionEnvironment,
  relationalDatabasePort
} from "../../packages/vibe64-adapters/src/server/managedDatabases/deployment.js";
import {
  deploymentPublishPlan
} from "../../packages/vibe64-adapters/src/server/deployment.js";
import {
  managedServiceRuntimeNixRecord
} from "../../packages/vibe64-adapters/src/server/managedServices/runtime.js";
import {
  managedMariaDbDatabaseGrantSql,
  managedMariaDbPort,
  managedMariaDbServicePaths,
  managedMariaDbServiceStartScript
} from "../../packages/vibe64-adapters/src/server/managedDatabases/mariadbRuntime.js";
import {
  managedPostgresDatabaseGrantSql,
  managedPostgresPort,
  managedPostgresServicePaths,
  managedPostgresServiceStartScript
} from "../../packages/vibe64-adapters/src/server/managedDatabases/postgresRuntime.js";

function assertShellScriptSyntax(script = "") {
  const result = spawnSync("bash", ["-n"], {
    encoding: "utf8",
    input: script
  });
  assert.equal(result.status, 0, result.stderr || script);
}

test("relational database deployment connections are provider-neutral and secret-backed", async () => {
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const targetRoot = "/var/lib/vibe64/unit-owner/projects/recipe-app";
  const secretCalls = [];
  const deployment = {
    async secret(input = {}) {
      secretCalls.push(input);
      return `unit-${input.key.toLowerCase()}`;
    }
  };
  const mariaDb = await deploymentRelationalDatabaseConnection({
    databaseName: "unit_recipe_app",
    deployment,
    provider: "mariadb",
    serviceDataRoot,
    targetRoot
  });
  const postgres = await deploymentRelationalDatabaseConnection({
    databaseName: "unit_recipe_app",
    deployment,
    provider: "postgres",
    serviceDataRoot,
    targetRoot
  });

  assert.equal(mariaDb.host, "127.0.0.1");
  assert.equal(mariaDb.port, managedMariaDbPort({ serviceDataRoot, targetRoot }));
  assert.match(mariaDb.url, /^mysql:\/\//u);
  assert.equal(postgres.port, managedPostgresPort({ serviceDataRoot, targetRoot }));
  assert.match(postgres.url, /^postgresql:\/\//u);
  assert.notEqual(mariaDb.port, postgres.port);
  assert.deepEqual(secretCalls.map((entry) => entry.key), [
    "VIBE64_MARIADB_DATABASE_APP_PASSWORD",
    "VIBE64_POSTGRES_DATABASE_APP_PASSWORD"
  ]);
  assert.equal(relationalDatabaseAppUser("a".repeat(100), { provider: "mariadb" }).length, 32);
  assert.equal(relationalDatabaseAppUser("a".repeat(100), { provider: "postgres" }).length, 63);
  assert.equal(relationalDatabasePort({ provider: "mariadb", serviceDataRoot, targetRoot }), mariaDb.port);
  assert.deepEqual(relationalDatabaseConnectionEnvironment(mariaDb), {
    DB_CLIENT: "mysql2",
    DB_HOST: mariaDb.host,
    DB_NAME: mariaDb.databaseName,
    DB_PASSWORD: mariaDb.password,
    DB_PORT: mariaDb.port,
    DB_USER: mariaDb.user
  });
});

test("relational database deployment connections require a non-empty generated secret", async () => {
  const input = {
    databaseName: "unit_recipe_app",
    provider: "mariadb",
    serviceDataRoot: "/var/lib/vibe64/unit-owner/services",
    targetRoot: "/var/lib/vibe64/unit-owner/projects/recipe-app"
  };
  await assert.rejects(
    deploymentRelationalDatabaseConnection(input),
    (error) => error?.code === "vibe64_relational_database_secret_provider_missing"
  );
  await assert.rejects(
    deploymentRelationalDatabaseConnection({
      ...input,
      deployment: {
        async secret() {
          return "";
        }
      }
    }),
    (error) => error?.code === "vibe64_relational_database_secret_empty"
  );
});

test("managed database service bootstraps own daemon state but not application grants", () => {
  const serviceDataRoot = "/var/lib/vibe64/unit-owner/services";
  const targetRoot = "/var/lib/vibe64/unit-owner/projects/recipe-app";
  const mariaDbScript = managedMariaDbServiceStartScript({
    serviceDataRoot,
    targetRoot
  });
  const postgresScript = managedPostgresServiceStartScript({
    serviceDataRoot,
    targetRoot
  });

  assertShellScriptSyntax(mariaDbScript);
  assertShellScriptSyntax(postgresScript);
  for (const script of [mariaDbScript, postgresScript]) {
    assert.match(script, /mv -f "\$temporary_metadata_file" "\$metadata_file"/u);
  }
  assert.match(mariaDbScript, /mariadb-install-db/u);
  assert.match(mariaDbScript, /stored_mariadb_password.*previous_bootstrap_password/u);
  assert.match(mariaDbScript, /mariadb_root_previous_bootstrap/u);
  assert.match(mariaDbScript, /mariadb_wait_for_started_process/u);
  assert.match(mariaDbScript, /recorded_pid.*started_pid/u);
  assert.match(mariaDbScript, /mv -f "\$temporary_admin_password_file" "\$admin_password_file"/u);
  assert.match(mariaDbScript, /if \[ -s "\$pid_file" \] && kill -0 .*; then\n {2}if ! mariadb_wait_until_ready; then/u);
  assert.match(mariaDbScript, /rm -f "\$pid_file" "\$socket_file"/u);
  assert.match(postgresScript, /initdb --pgdata/u);
  assert.match(postgresScript, /--auth-local=scram-sha-256 --auth-host=scram-sha-256/u);
  assert.doesNotMatch(postgresScript, /--auth-local=trust/u);
  assert.match(postgresScript, /pg_ctl --pgdata/u);
  assert.match(postgresScript, /if \[ -s "\$pid_file" \] && kill -0 .*; then\n {2}if ! postgres_wait_until_ready; then/u);
  assert.match(postgresScript, /rm -f "\$pid_file"/u);
  assert.match(postgresScript, /admin_password_file/u);
  assert.doesNotMatch(mariaDbScript, /CREATE USER|GRANT ALL PRIVILEGES/u);
  assert.doesNotMatch(postgresScript, /CREATE ROLE|CREATE DATABASE|GRANT ALL PRIVILEGES/u);
  assert.equal(managedMariaDbServicePaths({ serviceDataRoot }).runtimeRoot, path.join(serviceDataRoot, "mariadb"));
  assert.equal(managedPostgresServicePaths({ serviceDataRoot }).runtimeRoot, path.join(serviceDataRoot, "postgres"));
});

test("managed service runtime metadata requires a complete catalog entry", () => {
  assert.throws(
    () => managedServiceRuntimeNixRecord("missing-runtime"),
    (error) => error?.code === "vibe64_managed_service_runtime_catalog_invalid"
  );
});

test("deployment plans reject malformed managed-service requirements", () => {
  assert.throws(
    () => deploymentPublishPlan({
      requirements: {
        provider: "mariadb"
      }
    }),
    (error) => error?.code === "vibe64_deployment_requirements_invalid"
  );
  assert.throws(
    () => deploymentPublishPlan({
      requirements: [
        {
          id: "database",
          kind: "relational-database"
        }
      ]
    }),
    (error) => error?.code === "vibe64_deployment_requirement_identity_required"
  );
  assert.throws(
    () => deploymentPublishPlan({
      requirements: [
        {
          config: "invalid",
          id: "database",
          kind: "relational-database",
          provider: "mariadb"
        }
      ]
    }),
    (error) => error?.code === "vibe64_deployment_requirement_config_invalid"
  );
  assert.throws(
    () => deploymentPublishPlan({
      requirements: [
        {
          id: "database",
          kind: "relational-database",
          provider: "mariadb"
        },
        {
          id: "database",
          kind: "relational-database",
          provider: "postgres"
        }
      ]
    }),
    (error) => error?.code === "vibe64_deployment_requirement_duplicate"
  );
});

test("MariaDB application provisioning treats database underscores as literals", () => {
  const sql = managedMariaDbDatabaseGrantSql({
    appPassword: "unit-app-password",
    appUser: "unit_app",
    databaseName: "unit_database"
  });

  assert.equal(sql.includes("`unit\\_database`.*"), true);
  assert.equal(sql.includes("`unit_database`.*"), false);
});

test("PostgreSQL application provisioning is idempotent and validates its identifiers", () => {
  const sql = managedPostgresDatabaseGrantSql({
    appPassword: "unit-app-password",
    appUser: "unit_app",
    databaseName: "unit_database"
  });

  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM pg_roles/u);
  assert.match(sql, /ALTER ROLE "unit_app"/u);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM pg_database/u);
  assert.match(sql, /\\gexec/u);
  assert.match(sql, /ALTER DATABASE "unit_database" OWNER TO "unit_app"/u);
  assert.throws(
    () => managedPostgresDatabaseGrantSql({
      appPassword: "unit-app-password",
      appUser: "unsafe-user",
      databaseName: "unit_database"
    }),
    /application user is invalid/u
  );
});
