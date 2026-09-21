import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationDatabaseToolEnvironment,
  normalizeDatabaseToolEnvironment,
  normalizeResourceEnvironment
} from "../../packages/vibe64-project/src/server/resourceEnvironment.js";

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
    assert.throws(() => normalizeDatabaseToolEnvironment({ ...browser, read }), { code: "vibe64_database_tool_reader_required" });
  }
  assert.throws(() => normalizeResourceEnvironment([resource], { ...provided, resourceValues: [{
    ...provided.resourceValues[0], values: { database: "/another.sqlite" }
  }] }), { code: "vibe64_database_tool_resource_mismatch" });
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

test("production mapping uses declared names and forbids database-tool credentials", () => {
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
