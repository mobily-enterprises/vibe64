import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { mkdir } from "node:fs/promises";

import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { localDatabaseServerDeclarations } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { checkDatabaseServer, describeFailure } from "../../packages/vibe64-database-tools/src/server/serverCheck.js";
import { databaseServerGuide, isAdminUser, testDatabaseNames } from "../../packages/vibe64-database-tools/src/shared/serverGuide.js";
import { sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

const DJANGO_MYSQL = {
  component: "django-mysql",
  resource: {
    id: "database",
    kind: "mysql",
    environmentAlternatives: [
      { preferred: true, allowEmpty: ["password"], bindings: { database: "DB_NAME", host: "DB_HOST", password: "DB_PASSWORD", port: "DB_PORT", username: "DB_USER" } },
      { bindings: { url: "DATABASE_URL" } }
    ],
    optionalBindings: { testDatabase: "TEST_DB_NAME" }
  }
};

test("declarations list the Stack's own names in a fixed order and never carry a secret value", () => {
  const [database] = localDatabaseServerDeclarations([DJANGO_MYSQL, { component: "x", resource: { id: "files", kind: "sqlite" } }], {
    environment: { DB_HOST: "127.0.0.1", DB_PORT: "3306", DB_NAME: "django", DB_USER: "django", DB_PASSWORD: "hunter2" }
  });
  assert.deepEqual(database.fields.map((field) => field.name), ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]);
  const password = database.fields.find((field) => field.secret);
  assert.equal(password.set, true);
  assert.equal(Object.hasOwn(password, "value"), false);
  assert.equal(password.optional, true);
  assert.equal(database.connectsWith, "fields");
  assert.deepEqual(database.endpoint, { database: "django", host: "127.0.0.1", password: "hunter2", port: 3306, username: "django" });
  assert.deepEqual(database.testDatabase, { name: "TEST_DB_NAME", value: "" });
  assert.deepEqual(database.missing, []);

  const [incomplete] = localDatabaseServerDeclarations([DJANGO_MYSQL], { environment: { DB_HOST: "127.0.0.1" } });
  assert.equal(incomplete.endpoint, null);
  assert.deepEqual(incomplete.missing, ["DB_PORT", "DB_NAME", "DB_USER"]);

  const [url] = localDatabaseServerDeclarations([DJANGO_MYSQL], { environment: { DATABASE_URL: "mysql://u:p@db:3306/app" } });
  assert.equal(url.connectsWith, "url");
  assert.deepEqual(url.endpoint, { url: "mysql://u:p@db:3306/app" });
});

test("the project answers with Env over Stack defaults, ignores the shell, and stays out of a host's managed databases", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      // A shell export must not count: Workspace setup never receives it.
      env: { DB_PASSWORD: "from-the-shell", DATABASE_URL: "mysql://shell@nowhere/x" },
      projectContext: createStudioProjectContext({ explicitTargetRoot: targetRoot, home: path.dirname(targetRoot) }),
      inspectEnvironment: () => ({
        components: [],
        environmentDefaults: [
          { name: "DB_HOST", value: "127.0.0.1" }, { name: "DB_PORT", value: "3306" },
          { name: "DB_NAME", value: "django" }, { name: "DB_USER", value: "root" }
        ],
        files: [],
        resources: [DJANGO_MYSQL]
      })
    });
    const runtime = await service.createRuntime({ inspectSource: true });
    const sessionId = "database-server";
    await mkdir(path.join(sourcePath(targetRoot, sessionId), ".git", "info"), { recursive: true });
    await runtime.store.createSession({ sessionId, runtimeKind: "genesis", metadata: sourceMetadata(targetRoot, sessionId) });
    const session = await runtime.getSession(sessionId, { inspectSource: false });

    let answer = await service.localDatabaseServers({ sessionId, session });
    assert.equal(answer.managed, false);
    assert.equal(answer.databases[0].endpoint.username, "root");
    assert.equal(answer.databases[0].endpoint.password, "", "The shell's password is not the project's.");
    assert.equal(answer.databases[0].connectsWith, "fields", "The shell's DATABASE_URL is not the project's.");

    await service.saveEnvUserValues({ environment: "dev", sessionId, session,
      values: { DB_USER: { value: "django" }, DB_PASSWORD: { secret: true, value: "s3cret" } } });
    answer = await service.localDatabaseServers({ sessionId, session });
    assert.equal(answer.databases[0].endpoint.username, "django");
    assert.equal(answer.databases[0].endpoint.password, "s3cret");
    assert.equal(answer.databases[0].fields.find((field) => field.name === "DB_USER").value, "django");

    service.setResourceEnvironmentProvider({ environmentForResources() { return {}; } });
    assert.deepEqual(await service.localDatabaseServers({ sessionId, session }), { managed: true, databases: [] });
  });
});

test("project status counts only values the project's processes get", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      env: { DB_HOST: "127.0.0.1", DB_PORT: "5432", DB_DATABASE: "rails", DB_USERNAME: "rails" },
      projectContext: createStudioProjectContext({ explicitTargetRoot: targetRoot, home: path.dirname(targetRoot) }),
      inspectEnvironment: () => ({ components: [], environmentDefaults: [], files: [], resources: [{ component: "rails-postgresql",
        resource: { id: "database", kind: "postgresql", environmentAlternatives: [{ preferred: true, allowEmpty: ["password"],
          bindings: { database: "DB_DATABASE", host: "DB_HOST", password: "DB_PASSWORD", port: "DB_PORT", username: "DB_USERNAME" } }] } }] })
    });
    const runtime = await service.createRuntime({ inspectSource: true });
    const sessionId = "status";
    await mkdir(path.join(sourcePath(targetRoot, sessionId), ".git", "info"), { recursive: true });
    await runtime.store.createSession({ sessionId, runtimeKind: "genesis", metadata: sourceMetadata(targetRoot, sessionId) });
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    assert.equal((await service.projectEnvironmentStatus({ sessionId, session })).status, "missing-configuration");
  });
});

test("driver failures read as one plain sentence each", () => {
  const mysql = { kind: "mysql", endpoint: { host: "127.0.0.1", port: 3306, database: "django", username: "root", password: "" } };
  const pg = { kind: "postgresql", endpoint: { host: "127.0.0.1", port: 5432, database: "rails", username: "rails", password: "x" } };
  const cases = [
    [{ code: "ECONNREFUSED" }, mysql, "not-running", /Nothing is answering at 127\.0\.0\.1:3306/u],
    [{ code: "ENOTFOUND" }, mysql, "unreachable", /can't find a computer/u],
    [{ errno: 1698, message: "Access denied for user 'root'@'localhost'" }, mysql, "login-method", /administrator account/u],
    [{ errno: 1251, message: "Client does not support authentication protocol" }, mysql, "login-method", /sign in a way/u],
    [{ errno: 1045 }, mysql, "wrong-login", /didn't accept the user “root”/u],
    [{ errno: 1049 }, mysql, "database-missing", /no database called django/u],
    [{ errno: 1044 }, mysql, "no-access", /isn't allowed to use the database django/u],
    [{ code: "28P01" }, pg, "wrong-login", /didn't accept the user “rails”/u],
    [{ code: "3D000" }, pg, "database-missing", /no database called rails/u],
    [{ code: "28000", message: "Peer authentication failed for user \"rails\"" }, pg, "login-method", /computer's own account/u],
    [{ code: "28000", message: "role \"rails\" does not exist" }, pg, "wrong-login", /no user called “rails”/u],
    [{ message: "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string" }, pg, "wrong-login", /wants a password/u]
  ];
  for (const [error, context, state, message] of cases) {
    const failure = describeFailure(error, context);
    assert.equal(failure.state, state, JSON.stringify(error));
    assert.match(failure.message, message);
  }
});

test("a port nobody listens on is reported as not running, quickly", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  for (const kind of ["mysql", "postgresql"]) {
    const started = Date.now();
    const result = await checkDatabaseServer({ kind, timeoutMs: 2_000,
      endpoint: { host: "127.0.0.1", port, database: "app", username: "app", password: "x" } });
    assert.equal(result.state, "not-running", kind);
    assert.ok(Date.now() - started < 2_500);
  }
  assert.equal((await checkDatabaseServer({ kind: "mysql", endpoint: null })).state, "incomplete");
});

test("commands: per computer, never for an administrator, quoted safely", () => {
  const apt = databaseServerGuide({ kind: "postgresql", family: "apt" });
  assert.equal(apt.install.command, "sudo apt install postgresql");
  assert.match(apt.install.note, /computer password/u);
  assert.equal(apt.create, null);
  const brew = databaseServerGuide({ kind: "mysql", family: "brew", database: "shop", username: "shop", password: "pw" });
  assert.equal(brew.install.command, "brew install mariadb && brew services start mariadb");
  assert.match(brew.create.command, /^mariadb <<'SQL'\n/u);
  assert.equal(brew.create.note, "");
  const other = databaseServerGuide({ kind: "mysql", family: "" });
  assert.equal(other.install, null);
  assert.ok(other.guideUrl);

  assert.equal(isAdminUser("root"), true);
  assert.equal(databaseServerGuide({ kind: "mysql", family: "apt", database: "d", username: "root", password: "p" }).create, null);
  assert.deepEqual(testDatabaseNames("django"), ["test_django", "django_test"]);
  assert.deepEqual(testDatabaseNames("django", "django_ci"), ["django_ci"]);

  const mysql = databaseServerGuide({ kind: "mysql", family: "apt", database: "we`ird", username: "o'neil", password: "a'b\\c" }).create.command;
  assert.match(mysql, /^sudo mariadb <<'SQL'\n/u);
  assert.match(mysql, /CREATE DATABASE IF NOT EXISTS `we``ird`/u);
  assert.match(mysql, /'o''neil'@'%' IDENTIFIED BY 'a''b\\\\c'/u);
  assert.match(mysql, /\nSQL$/u);
  const pg = databaseServerGuide({ kind: "postgresql", family: "apt", database: "app", username: "app", password: "it's" }).create.command;
  assert.match(pg, /^sudo -u postgres psql <<'SQL'\n/u);
  assert.match(pg, /ALTER ROLE "app" LOGIN CREATEDB PASSWORD 'it''s';/u);
  assert.match(pg, /\\gexec\nSQL$/u);
});
