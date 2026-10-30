import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { parseEnv } from "node:util";

import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  RUNTIME_CONFIG_TARGETS,
  mergeRuntimeConfigRecords,
  normalizeRuntimeConfigKey,
  normalizeRuntimeConfigOwner,
  normalizeRuntimeConfigRecord,
  resolveRuntimeConfig,
  runtimeConfigDotenvFile,
  runtimeConfigDotenvValue,
  runtimeConfigEnv,
  runtimeConfigEnvViewModel,
  runtimeConfigKeyIsVibe64Reserved,
  runtimeConfigKeyLooksSecret
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readEnvUserValues,
  saveEnvUserValues
} from "@local/vibe64-core/server/envUserValues";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("runtime config records normalize technology-neutral metadata", () => {
  const record = normalizeRuntimeConfigRecord({
    key: "SERVICE_API_TOKEN",
    owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
    requiredFor: [RUNTIME_CONFIG_PHASES.SERVER, RUNTIME_CONFIG_PHASES.PREVIEW, RUNTIME_CONFIG_PHASES.SERVER],
    scope: RUNTIME_CONFIG_SCOPES.PROD,
    source: "genesis-stack",
    targets: [RUNTIME_CONFIG_TARGETS.SERVER, RUNTIME_CONFIG_TARGETS.COMMAND],
    value: 42
  });

  assert.deepEqual(record, {
    editable: false,
    key: "SERVICE_API_TOKEN",
    owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
    requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW, RUNTIME_CONFIG_PHASES.SERVER],
    scope: RUNTIME_CONFIG_SCOPES.PROD,
    secret: true,
    source: "genesis-stack",
    targets: [RUNTIME_CONFIG_TARGETS.COMMAND, RUNTIME_CONFIG_TARGETS.SERVER],
    value: "42",
    valuePresent: true
  });
  assert.equal(Object.hasOwn(record, "materialize"), false);
});

test("runtime config validates keys, owners, and reserved keys", () => {
  assert.equal(normalizeRuntimeConfigKey("VALID_NAME_2"), "VALID_NAME_2");
  assert.equal(normalizeRuntimeConfigOwner(), RUNTIME_CONFIG_OWNERS.USER);
  assert.equal(runtimeConfigKeyIsVibe64Reserved("VIBE64_INTERNAL"), true);
  assert.equal(runtimeConfigKeyIsVibe64Reserved("APP_VIBE64_VALUE"), false);
  assert.throws(
    () => normalizeRuntimeConfigKey("INVALID-NAME"),
    { code: "vibe64_runtime_config_key_invalid" }
  );
  assert.throws(
    () => normalizeRuntimeConfigOwner("adapter"),
    { code: "vibe64_runtime_config_owner_invalid" }
  );
});

test("runtime config secret detection treats key names as segments", () => {
  assert.equal(runtimeConfigKeyLooksSecret("AUTH_DEV_BYPASS_ENABLED"), false);
  assert.equal(runtimeConfigKeyLooksSecret("VIBE64_BYPASS_LOCALHOST_CHECK"), false);
  assert.equal(runtimeConfigKeyLooksSecret("AUTH_DEV_BYPASS_SECRET"), true);
  assert.equal(runtimeConfigKeyLooksSecret("DB_PASSWORD"), true);
  assert.equal(runtimeConfigKeyLooksSecret("DATABASE_URL"), true);
  assert.equal(runtimeConfigKeyLooksSecret("OPENAI_API_KEY"), true);
});

test("runtime config resolver accepts records directly and rejects removed profiles", () => {
  const config = resolveRuntimeConfig([
    {
      key: "MANAGED_VALUE",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "system",
      value: "managed"
    },
    {
      key: "OPENAI_API_KEY",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: ""
    }
  ], {
    phase: RUNTIME_CONFIG_PHASES.PREVIEW
  });

  const userRecord = config.view.records.find((record) => record.key === "OPENAI_API_KEY");
  assert.equal(userRecord.owner, RUNTIME_CONFIG_OWNERS.USER);
  assert.equal(userRecord.editable, true);
  assert.equal(userRecord.missing, true);
  assert.equal(userRecord.value, "********");
  assert.deepEqual(config.missing.map((record) => record.key), ["OPENAI_API_KEY"]);
  assert.throws(
    () => resolveRuntimeConfig({
      definitions: []
    }),
    { code: "vibe64_runtime_config_records_invalid" }
  );
});

test("runtime config scopes and targets filter values and missing records", () => {
  const records = [
    {
      key: "ALL_TARGETS",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "system",
      value: "all"
    },
    {
      key: "SERVER_ONLY",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "system",
      targets: [RUNTIME_CONFIG_TARGETS.SERVER],
      value: "server"
    },
    {
      key: "CHECK_SECRET",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      targets: [RUNTIME_CONFIG_TARGETS.CHECKS],
      value: ""
    },
    {
      key: "PROD_ONLY",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      scope: RUNTIME_CONFIG_SCOPES.PROD,
      source: "system",
      value: "prod"
    }
  ];
  const serverConfig = resolveRuntimeConfig(records, {
    phase: RUNTIME_CONFIG_PHASES.SERVER,
    target: RUNTIME_CONFIG_TARGETS.SERVER
  });
  const checksConfig = resolveRuntimeConfig(records, {
    phase: RUNTIME_CONFIG_PHASES.SERVER,
    target: RUNTIME_CONFIG_TARGETS.CHECKS
  });

  assert.deepEqual(Object.keys(serverConfig.values).sort(), ["ALL_TARGETS", "SERVER_ONLY"]);
  assert.deepEqual(serverConfig.missing, []);
  assert.deepEqual(Object.keys(checksConfig.values).sort(), ["ALL_TARGETS", "CHECK_SECRET"]);
  assert.deepEqual(checksConfig.missing.map((record) => record.key), ["CHECK_SECRET"]);
  assert.deepEqual(runtimeConfigEnv(records, {
    scope: RUNTIME_CONFIG_SCOPES.PROD
  }), {
    PROD_ONLY: "prod"
  });
});

test("runtime config does not require values when no phase is requested", () => {
  const config = resolveRuntimeConfig([
    {
      key: "OPENAI_API_KEY",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: ""
    }
  ]);

  assert.equal(config.ok, true);
  assert.deepEqual(config.missing, []);
  assert.equal(config.view.records[0].missing, false);
});

test("runtime config treats withheld known secrets as present", () => {
  const config = resolveRuntimeConfig([
    {
      key: "PAYMENT_API_TOKEN",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.PROD,
      secret: true,
      source: "user",
      value: "",
      valuePresent: true
    }
  ], {
    phase: RUNTIME_CONFIG_PHASES.SERVER,
    scope: RUNTIME_CONFIG_SCOPES.PROD
  });

  const tokenRecord = config.view.records.find((record) => record.key === "PAYMENT_API_TOKEN");
  assert.equal(config.ok, true);
  assert.deepEqual(config.missing, []);
  assert.equal(tokenRecord.value, "********");
  assert.equal(tokenRecord.valuePresent, true);
  assert.equal(config.values.PAYMENT_API_TOKEN, "");
});

test("runtime config user records cannot shadow system records", () => {
  const records = mergeRuntimeConfigRecords([
    {
      key: "DB_PASSWORD",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "managed-database",
      value: "managed-password"
    },
    {
      key: "DB_PASSWORD",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: "user-password"
    }
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].owner, RUNTIME_CONFIG_OWNERS.SYSTEM);
  assert.equal(records[0].source, "managed-database");
  assert.equal(records[0].value, "managed-password");
});

test("runtime config user records cannot shadow read-only user records", () => {
  const config = resolveRuntimeConfig([
    {
      editable: false,
      key: "AUTH_SUPABASE_URL",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "project-config",
      value: "https://configured.supabase.co"
    },
    {
      key: "AUTH_SUPABASE_URL",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: "https://stale-user-value.supabase.co"
    }
  ]);

  assert.equal(config.values.AUTH_SUPABASE_URL, "https://configured.supabase.co");
  assert.equal(config.records[0].editable, false);
  assert.equal(config.records[0].source, "project-config");
});

test("runtime config Env view exposes only current record concepts", () => {
  const view = runtimeConfigEnvViewModel({
    records: [
      {
        editable: false,
        key: "AUTH_SUPABASE_URL",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "project-config",
        value: "https://example.supabase.co"
      },
      {
        key: "OPENAI_API_KEY",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "user",
        value: "secret"
      }
    ],
    scope: RUNTIME_CONFIG_SCOPES.DEV
  });

  const supabaseRecord = view.records.find((record) => record.key === "AUTH_SUPABASE_URL");
  const apiKeyRecord = view.records.find((record) => record.key === "OPENAI_API_KEY");
  assert.equal(supabaseRecord.editable, false);
  assert.equal(apiKeyRecord.editable, true);
  assert.equal(apiKeyRecord.value, "********");
  assert.equal(Object.hasOwn(view, "publicEnvPrefixes"), false);
  assert.equal(Object.hasOwn(view, "adapterId"), false);
  assert.equal(Object.hasOwn(view, "generatedTargets"), false);
  assert.equal(Object.hasOwn(apiKeyRecord, "materialize"), false);
});

test("runtime config writes every record as one plain .env file in the Env panel's groups", () => {
  const content = runtimeConfigDotenvFile({
    downloadedAt: new Date("2026-10-30T09:15:00.000Z"),
    environment: "development",
    isUserRecord: (record) => record.editable === true || record.source === "linked",
    project: "books\nshop",
    records: [
      { editable: false, key: "DATABASE_URL", secret: true, source: "managed", valuePresent: true },
      { editable: true, key: "API_KEY", secret: true, source: "user", valuePresent: true },
      { editable: true, key: "EMPTY_SETTING", source: "user", valuePresent: false },
      { editable: false, key: "STRIPE_SECRET_KEY", secret: true, source: "linked", valuePresent: true },
      { editable: true, key: "GREETING", source: "user", valuePresent: true }
    ],
    values: {
      API_KEY: "sk_test_123",
      DATABASE_URL: "postgres://app:p@ss#1@127.0.0.1:5432/app",
      EMPTY_SETTING: "ignored when not present",
      GREETING: "Hello \"world\"",
      STRIPE_SECRET_KEY: "rk_test_456"
    }
  });

  assert.equal(content, [
    "# Project: books shop",
    "# Environment: development",
    "# Downloaded: 2026-10-30T09:15:00.000Z",
    "",
    "# User values",
    "API_KEY=sk_test_123",
    "EMPTY_SETTING=",
    "STRIPE_SECRET_KEY=rk_test_456",
    "GREETING='Hello \"world\"'",
    "",
    "# System values",
    "DATABASE_URL='postgres://app:p@ss#1@127.0.0.1:5432/app'",
    ""
  ].join("\n"));
  assert.equal(runtimeConfigDotenvFile({ downloadedAt: 0, environment: "production", project: "empty" }),
    "# Project: empty\n# Environment: production\n# Downloaded: 1970-01-01T00:00:00.000Z\n");
  assert.throws(() => runtimeConfigDotenvFile({ records: [{ key: "NOT VALID", valuePresent: false }] }),
    { code: "vibe64_runtime_config_key_invalid" });
});

test("runtime config .env values read back exactly with Node's parseEnv", () => {
  assert.equal(runtimeConfigDotenvValue("plain-value_1.2:3/4@5%6+7=8,9"), "plain-value_1.2:3/4@5%6+7=8,9");
  assert.equal(runtimeConfigDotenvValue(""), "");
  assert.equal(runtimeConfigDotenvValue(undefined), "");
  assert.equal(runtimeConfigDotenvValue("a b"), "'a b'");
  assert.equal(runtimeConfigDotenvValue("C:\\new $HOME \"x\""), "'C:\\new $HOME \"x\"'", "single quotes keep $, \" and \\ literal");
  assert.equal(runtimeConfigDotenvValue("it's"), "\"it's\"");
  assert.equal(runtimeConfigDotenvValue("one\ntwo"), "\"one\\ntwo\"");

  const tricky = {
    APOSTROPHE: "it's $5 \\ C:\\temp",
    BACKSLASH_N: "C:\\new\\table",
    BACKTICKS: "`uname`",
    COMMENT_LOOKALIKE: "#not-a-comment",
    DOLLARS: "$HOME ${PATH} $$ price$5 \\$",
    EMPTY: "",
    EQUALS: "=leading=and=trailing=",
    INLINE_HASH: "value # not a comment",
    JSON: "{\"a\":[1,2],\"b\":\"c d\"}",
    MULTILINE: "line one\nline two\n\nline four\n",
    PADDED: "  padded  ",
    PEM: "-----BEGIN KEY-----\nMIIB+abc/def==\n-----END KEY-----",
    PLAIN: "plain-value_1.2:3/4@5%6+7=8,9",
    QUOTES: "say \"hi\"",
    TAB: "tab\there",
    TRAILING_BACKSLASH: "ends with \\",
    UNICODE: "ünïcödé ✓ 日本",
    URL: "postgres://user:p%40ss@db.example.test:5432/app?sslmode=require&x=1"
  };
  const keys = Object.keys(tricky);
  const content = runtimeConfigDotenvFile({
    environment: "development",
    project: "tricky",
    records: keys.map((key) => ({ editable: true, key, valuePresent: true })),
    values: tricky
  });

  assert.deepEqual({ ...parseEnv(content) }, tricky);
  assert.equal(content.split("\n").filter((line) => line && !line.startsWith("#")).length, keys.length,
    "every value, including multi-line ones, is on one line");
  assert.match(content, /^PLAIN=plain-value_1\.2:3\/4@5%6\+7=8,9$/mu);
  assert.match(content, /^DOLLARS='\$HOME \$\{PATH\} \$\$ price\$5 \\\$'$/mu, "Compose keeps single-quoted $ literal");
  assert.match(content, /^EMPTY=$/mu);
});

test("Env user value store writes 0600 state and preserves empty records", async () => {
  await withTemporaryRoot(async (projectRuntimeRoot) => {
    const saved = await saveEnvUserValues({
      environment: RUNTIME_CONFIG_SCOPES.DEV,
      projectRuntimeRoot,
      values: {
        OPENAI_API_KEY: {
          secret: true,
          value: ""
        },
        PUBLIC_FLAG: {
          secret: false,
          value: "enabled"
        }
      }
    });

    const apiKeyRecord = saved.records.find((record) => record.key === "OPENAI_API_KEY");
    const publicRecord = saved.records.find((record) => record.key === "PUBLIC_FLAG");
    assert.equal(apiKeyRecord.value, "");
    assert.equal(apiKeyRecord.owner, RUNTIME_CONFIG_OWNERS.USER);
    assert.equal(apiKeyRecord.source, "user");
    assert.deepEqual(apiKeyRecord.requiredFor, []);
    assert.equal(Object.hasOwn(apiKeyRecord, "materialize"), false);
    assert.equal(publicRecord.secret, false);
    assert.equal((await stat(saved.filePath)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(saved.filePath, "utf8")), {
      environments: {
        dev: {
          OPENAI_API_KEY: {
            secret: true,
            value: ""
          },
          PUBLIC_FLAG: {
            secret: false,
            value: "enabled"
          }
        }
      },
      version: 1
    });

    await saveEnvUserValues({
      projectRuntimeRoot,
      values: {
        PUBLIC_FLAG: {
          remove: true
        }
      }
    });

    const current = await readEnvUserValues({
      projectRuntimeRoot
    });
    assert.equal(current.records.some((record) => record.key === "PUBLIC_FLAG"), false);
    assert.equal(current.records.some((record) => record.key === "OPENAI_API_KEY"), true);
  });
});
