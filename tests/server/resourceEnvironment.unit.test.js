import assert from "node:assert/strict";
import test from "node:test";

import {
  __testables,
  applicationDatabaseToolEnvironment,
  normalizeResourceEnvironment,
  resourceSemanticIsSecret
} from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { browserSuiteDatabaseEnvironment } from "../../packages/vibe64-project/src/server/browserSuiteDatabaseEnvironment.js";

const { normalizeDatabaseToolEnvironment } = __testables;

test("secret resource semantics: fixed connection secrets and camelCase secret suffixes", () => {
  const secret = [
    "password", "url", "accessTokenFile",
    "clientSecret", "registrationToken", "refreshToken", "apiKey", "adminPassword", "signingKey"
  ];
  const plain = [
    "host", "port", "database", "username", "issuer", "clientId", "region",
    "secret", "token", "key", "Secret", "keyName", "tokenEndpoint", "", undefined, null, 42
  ];
  for (const semantic of secret) {
    assert.equal(resourceSemanticIsSecret(semantic), true, String(semantic));
  }
  for (const semantic of plain) {
    assert.equal(resourceSemanticIsSecret(semantic), false, String(semantic));
  }
});

test("SQLite maps a declared filename and keeps browser reads enforced on the same file", () => {
  const resource = databaseResource({ kind: "sqlite", preferredBindings: { database: "DB_DATABASE" } });
  resource.resource.environmentAlternatives.length = 1;
  const browser = applicationDatabaseToolEnvironment([resource], { DB_DATABASE: "database/app.sqlite" }, "/workspace/source");
  assert.deepEqual(browser, {
    contract: "vibe64.database-tool-environment.v1", kind: "sqlite",
    read: { database: "/workspace/source/database/app.sqlite", readOnly: true },
    write: { database: "/workspace/source/database/app.sqlite", readOnly: false }
  });
  const provided = {
    contract: "vibe64.resource-environment.v2", databaseToolEnvironment: browser,
    resourceValues: [{ declaration: { component: "application", id: "database", kind: "sqlite" }, values: { database: browser.write.database } }]
  };
  assert.deepEqual(normalizeResourceEnvironment([resource], provided).environment, { DB_DATABASE: browser.write.database });
  for (const read of [{ ...browser.read, readOnly: false }, { ...browser.read, database: "/other.sqlite" }]) {
    assert.throws(() => normalizeDatabaseToolEnvironment({ ...browser, read }), { code: "vibe64_database_tool_sqlite_reader_required" });
  }
  assert.throws(() => normalizeResourceEnvironment([resource], { ...provided, resourceValues: [{
    ...provided.resourceValues[0], values: { database: "/another.sqlite" }
  }] }), { code: "vibe64_database_tool_writer_mismatch" });
  for (const filename of [":memory:", "relative.sqlite", ""]) {
    assert.throws(() => applicationDatabaseToolEnvironment([resource], { DB_DATABASE: filename }));
  }
  assert.throws(() => normalizeDatabaseToolEnvironment({ ...browser, read: { ...browser.read, host: "localhost" } }));
  assert.deepEqual(normalizeResourceEnvironment([resource], {
    ...provided, databaseToolEnvironment: undefined
  }, { requireDatabaseTool: false }).environment, { DB_DATABASE: browser.write.database });
});

function databaseResource({
  component = "application",
  kind = "postgresql",
  preferredBindings = {
    database: "APP_DATABASE",
    host: "APP_DATABASE_HOST",
    password: "APP_DATABASE_PASSWORD",
    port: "APP_DATABASE_PORT",
    username: "APP_DATABASE_USERNAME"
  }
} = {}) {
  return {
    component,
    resource: {
      environmentAlternatives: [{
        allowEmpty: ["password"],
        bindings: preferredBindings,
        preferred: true
      }, {
        allowEmpty: [],
        bindings: { url: "APP_DATABASE_URL" },
        preferred: false
      }],
      id: "database",
      kind,
      optionalBindings: {}
    }
  };
}

test("resource preparation evidence must be an explicit boolean", () => {
  const provided = { contract: "vibe64.resource-environment.v2", resourceValues: [] };
  for (const prepared of [true, false]) {
    assert.deepEqual(normalizeResourceEnvironment([], { ...provided, prepared }).environment, {});
  }
  assert.throws(() => normalizeResourceEnvironment([], { ...provided, prepared: "yes" }), {
    code: "vibe64_resource_environment_contract_invalid"
  });
});

test("resource identity and preservation evidence remain optional and strictly validated", () => {
  const resources = [databaseResource()];
  const pending = { contract: "vibe64.resource-environment.v2", prepared: false, resourceValues: [] };
  const options = { allowUnprepared: true };
  assert.equal(Object.hasOwn(normalizeResourceEnvironment(resources, pending, options), "resourcePreparation"), false);
  for (const preserved of [true, false]) {
    const resourcePreparation = { identity: "a".repeat(64), preserved };
    assert.deepEqual(normalizeResourceEnvironment(resources, { ...pending, resourcePreparation }, options).resourcePreparation,
      resourcePreparation);
  }
  for (const resourcePreparation of [null, {}, { identity: ["a".repeat(64)], preserved: true },
    { identity: "a".repeat(64), preserved: "yes" },
    { identity: "not-an-identity", preserved: true }, { identity: "a".repeat(64), preserved: true, password: "secret" }]) {
    assert.throws(() => normalizeResourceEnvironment(resources, { ...pending, resourcePreparation }, options),
      { code: "vibe64_resource_environment_evidence_invalid" });
  }
});

test("only read-only inspection accepts explicitly unprepared managed resources", () => {
  const resources = [databaseResource()];
  const pending = { contract: "vibe64.resource-environment.v2", prepared: false, resourceValues: [] };
  const inspected = normalizeResourceEnvironment(resources, pending, { allowUnprepared: true });
  assert.deepEqual(inspected.environment, {});
  assert.equal(inspected.databaseToolEnvironment, null);
  assert.throws(() => normalizeResourceEnvironment(resources, pending), {
    code: "vibe64_managed_database_resource_missing"
  });
  for (const prepared of [true, undefined]) {
    assert.throws(() => normalizeResourceEnvironment(resources, { ...pending, prepared }, { allowUnprepared: true }), {
      code: "vibe64_managed_database_resource_missing"
    });
  }
  assert.throws(() => normalizeResourceEnvironment(resources, {
    ...pending,
    resourceValues: [{
      declaration: { component: "application", id: "database", kind: "postgresql" },
      values: { database: "incomplete" }
    }]
  }, { allowUnprepared: true }), { code: "vibe64_resource_environment_value_missing" });
});

test("standalone database tools invert an explicitly satisfied URL binding", () => {
  const resource = databaseResource();
  const databaseToolEnvironment = applicationDatabaseToolEnvironment([resource], {
    APP_DATABASE_URL: "postgresql://app:secret@example.test:5432/catalogue"
  });

  assert.deepEqual(databaseToolEnvironment, {
    contract: "vibe64.database-tool-environment.v1",
    kind: "postgresql",
    read: {
      url: "postgresql://app:secret@example.test:5432/catalogue"
    },
    write: {
      url: "postgresql://app:secret@example.test:5432/catalogue"
    }
  });
});

test("deployment mapping uses declared names and forbids database-tool credentials", () => {
  const resource = databaseResource({
    kind: "mysql",
    preferredBindings: {
      database: "DB_DATABASE",
      host: "DB_HOST",
      password: "DB_PASSWORD",
      port: "DB_PORT",
      username: "DB_USERNAME"
    }
  });
  const provided = {
    contract: "vibe64.resource-environment.v2",
    resourceValues: [{
      declaration: {
        component: "application",
        id: "database",
        kind: "mysql"
      },
      values: {
        database: "catalogue",
        host: "127.0.0.1",
        password: "private",
        port: 3306,
        url: "mysql://app:private@127.0.0.1:3306/catalogue",
        username: "app"
      }
    }]
  };

  const normalized = normalizeResourceEnvironment([resource], provided, {
    requireDatabaseTool: false
  });
  assert.deepEqual(normalized.environment, {
    DB_DATABASE: "catalogue",
    DB_HOST: "127.0.0.1",
    DB_PASSWORD: "private",
    DB_PORT: "3306",
    DB_USERNAME: "app"
  });
  assert.deepEqual([...normalized.secretKeys], ["DB_PASSWORD"]);

  assert.throws(
    () => normalizeResourceEnvironment([resource], {
      ...provided,
      databaseToolEnvironment: {
        contract: "vibe64.database-tool-environment.v1",
        kind: "mysql",
        read: { url: "mysql://reader:secret@127.0.0.1:3306/catalogue" },
        write: { url: "mysql://app:private@127.0.0.1:3306/catalogue" }
      }
    }, {
      requireDatabaseTool: false
    }),
    { code: "vibe64_database_tool_environment_forbidden" }
  );
});

test("managed mapping rejects undeclared semantics and a shared reader credential", () => {
  const resource = databaseResource({ kind: "mysql" });
  const values = {
    database: "catalogue",
    host: "127.0.0.1",
    password: "private",
    port: 3306,
    username: "app"
  };
  const provided = {
    contract: "vibe64.resource-environment.v2",
    databaseToolEnvironment: {
      contract: "vibe64.database-tool-environment.v1",
      kind: "mysql",
      read: {
        database: "catalogue",
        host: "127.0.0.1",
        password: "private",
        port: 3306,
        username: "app"
      },
      write: {
        database: "catalogue",
        host: "127.0.0.1",
        password: "private",
        port: 3306,
        username: "app"
      }
    },
    resourceValues: [{
      declaration: {
        component: "application",
        id: "database",
        kind: "mysql"
      },
      values
    }]
  };

  assert.throws(
    () => normalizeResourceEnvironment([resource], provided),
    { code: "vibe64_database_tool_reader_required" }
  );
  assert.throws(
    () => normalizeResourceEnvironment([resource], {
      ...provided,
      databaseToolEnvironment: {
        ...provided.databaseToolEnvironment,
        read: {
          ...provided.databaseToolEnvironment.read,
          password: "reader-private"
        }
      }
    }),
    { code: "vibe64_database_tool_reader_required" }
  );
  assert.throws(
    () => normalizeResourceEnvironment([resource], {
      ...provided,
      databaseToolEnvironment: {
        ...provided.databaseToolEnvironment,
        read: {
          ...provided.databaseToolEnvironment.read,
          username: "reader"
        }
      }
    }),
    { code: "vibe64_database_tool_reader_required" }
  );
  assert.throws(
    () => normalizeResourceEnvironment([resource], {
      ...provided,
      resourceValues: [{
        ...provided.resourceValues[0],
        values: {
          ...values,
          administratorPassword: "must-not-cross-the-boundary"
        }
      }]
    }),
    { code: "vibe64_resource_environment_semantic_undeclared" }
  );
});

test("speech resources map explicit endpoint and credential-file semantics and redact the credential path", () => {
  const declaration = { component: "speech", resource: { id: "voice", kind: "voice", optionalBindings: {}, environmentAlternatives: [
    { preferred: true, bindings: { endpoint: "SPEECH_ENDPOINT", accessTokenFile: "SPEECH_TOKEN_FILE" }, allowEmpty: [] }
  ] } };
  const values = { endpoint: "wss://voice.example/v1/voice", accessTokenFile: "/run/app/voice.token" };
  const provided = (value = values) => ({ contract: "vibe64.resource-environment.v2", resourceValues: [
    { declaration: { component: "speech", id: "voice", kind: "voice" }, values: value }
  ] });
  const normalized = normalizeResourceEnvironment([declaration], provided());
  assert.deepEqual(normalized.environment, { SPEECH_ENDPOINT: values.endpoint, SPEECH_TOKEN_FILE: values.accessTokenFile });
  assert.deepEqual([...normalized.secretKeys], ["SPEECH_TOKEN_FILE"]);
  assert.equal(normalized.databaseToolEnvironment, null);
  for (const bad of [
    { endpoint: "https://voice.example/v1/voice" }, { endpoint: "wss://user:secret@voice.example" },
    { accessTokenFile: "relative.token" }, { accessTokenFile: "inline-secret" }, { accessTokenFile: "/run/app/one\ntwo" }
  ]) assert.throws(() => normalizeResourceEnvironment([declaration], provided({ ...values, ...bad })), { code: "vibe64_voice_resource_values_invalid" });
  declaration.resource.environmentAlternatives[0].bindings = { endpoint: "SPEECH_ENDPOINT", token: "INLINE_SECRET" };
  assert.throws(() => normalizeResourceEnvironment([declaration], provided({ endpoint: values.endpoint, token: "secret" })), { code: "vibe64_voice_resource_bindings_invalid" });
});

test("a browser suite's process reaches only its test-data target's test database, and no database anywhere else", () => {
  const resource = databaseResource({ kind: "mysql" });
  resource.resource.optionalBindings = { browserTestDatabase: "BROWSER_TEST_DB_NAME", testDatabase: "TEST_DB_NAME" };
  const development = {
    APP_DATABASE: "session_dev", APP_DATABASE_HOST: "127.0.0.1", APP_DATABASE_PASSWORD: "pw-session",
    APP_DATABASE_PORT: "3306", APP_DATABASE_USERNAME: "session",
    APP_DATABASE_URL: "mysql://session:pw-session@127.0.0.1:3306/session_dev?charset=utf8mb4",
    BROWSER_TEST_DB_NAME: "session_browser", TEST_DB_NAME: "session_test", UNRELATED: "kept"
  };
  // The first app server's copy, on the session's own server with its credentials: every database name and the URL.
  assert.deepEqual(browserSuiteDatabaseEnvironment([resource], development, { testData: true }), {
    APP_DATABASE: "session_browser", APP_DATABASE_HOST: "127.0.0.1", APP_DATABASE_PASSWORD: "pw-session",
    APP_DATABASE_PORT: "3306", APP_DATABASE_USERNAME: "session",
    APP_DATABASE_URL: "mysql://session:pw-session@127.0.0.1:3306/session_browser?charset=utf8mb4",
    BROWSER_TEST_DB_NAME: "session_browser", TEST_DB_NAME: "session_browser"
  });
  const none = {
    APP_DATABASE: "vibe64_no_database_in_browser_runs", APP_DATABASE_HOST: "vibe64-no-database-in-browser-runs.invalid",
    APP_DATABASE_PASSWORD: "vibe64_no_database_in_browser_runs", APP_DATABASE_PORT: "1",
    APP_DATABASE_USERNAME: "vibe64_no_database_in_browser_runs",
    APP_DATABASE_URL: "mysql://vibe64_no_database_in_browser_runs@vibe64-no-database-in-browser-runs.invalid:1/vibe64_no_database_in_browser_runs",
    BROWSER_TEST_DB_NAME: "vibe64_no_database_in_browser_runs", TEST_DB_NAME: "vibe64_no_database_in_browser_runs"
  };
  // A suite against development data, a database without its own browser-test database, and one whose browser-test
  // database is the development one open nothing.
  assert.deepEqual(browserSuiteDatabaseEnvironment([resource], development, { testData: false }), none);
  assert.deepEqual(browserSuiteDatabaseEnvironment([resource], { ...development, BROWSER_TEST_DB_NAME: "" }, { testData: true }), none);
  assert.deepEqual(browserSuiteDatabaseEnvironment([resource], { ...development, BROWSER_TEST_DB_NAME: "session_dev" }, { testData: true }), none);
  // A name the Env leaves out is not reached either; an empty password is the session's own.
  const { APP_DATABASE_URL: _url, ...withoutUrl } = development;
  const onTest = browserSuiteDatabaseEnvironment([resource], { ...withoutUrl, APP_DATABASE_PASSWORD: "" }, { testData: true });
  assert.equal(onTest.APP_DATABASE_URL, none.APP_DATABASE_URL);
  assert.equal(onTest.APP_DATABASE_PASSWORD, "");
  // PostgreSQL's URL names its own scheme; SQLite's file cannot be made; other resources are not databases.
  assert.equal(browserSuiteDatabaseEnvironment([databaseResource()], development).APP_DATABASE_URL,
    "postgres://vibe64_no_database_in_browser_runs@vibe64-no-database-in-browser-runs.invalid:1/vibe64_no_database_in_browser_runs");
  assert.deepEqual(browserSuiteDatabaseEnvironment([databaseResource({ kind: "sqlite", preferredBindings: { database: "DB_DATABASE" } })], {}), {
    DB_DATABASE: "/nonexistent/vibe64_no_database_in_browser_runs.sqlite",
    APP_DATABASE_URL: "file:/nonexistent/vibe64_no_database_in_browser_runs.sqlite"
  });
  assert.deepEqual(browserSuiteDatabaseEnvironment([{ component: "cache", resource: { id: "cache", kind: "redis",
    environmentAlternatives: [{ preferred: true, bindings: { url: "REDIS_URL" } }] } }], { REDIS_URL: "redis://127.0.0.1" }), {});
});
