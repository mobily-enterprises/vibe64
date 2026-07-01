import assert from "node:assert/strict";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  VIBE64_GENERATED_ENV_HEADER,
  dotenvText,
  generatedRuntimeConfigDotenvUserValues,
  materializeRuntimeConfig,
  resolveRuntimeConfig,
  runtimeConfigEnvViewModel
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readEnvUserValues,
  saveEnvUserValues
} from "@local/vibe64-core/server/envUserValues";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("runtime config dotenv materializer backs up unmanaged files and writes deterministic generated output", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, ".env"), "STALE=value\n", "utf8");
    const config = await resolveRuntimeConfig({
      id: "test",
      materializers: [
        {
          format: "dotenv",
          path: ".env"
        }
      ],
      definitions: [
        {
          key: "Z_PUBLIC",
          owner: RUNTIME_CONFIG_OWNERS.VIBE64,
          scope: RUNTIME_CONFIG_SCOPES.DEV,
          source: "test",
          value: "public"
        },
        {
          key: "A_PASSWORD",
          owner: RUNTIME_CONFIG_OWNERS.VIBE64,
          requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
          scope: RUNTIME_CONFIG_SCOPES.DEV,
          source: "test",
          value: "secret value"
        }
      ]
    });

    const results = await materializeRuntimeConfig(config, {
      now: new Date("2026-06-21T00:00:00.000Z"),
      roots: [targetRoot]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].backupPath, path.join(targetRoot, ".env.vibe64-backup-2026-06-21T00-00-00-000Z"));
    assert.equal(results[0].changed, true);
    assert.equal(await readFile(results[0].backupPath, "utf8"), "STALE=value\n");
    assert.equal(await readFile(path.join(targetRoot, ".env"), "utf8"), [
      VIBE64_GENERATED_ENV_HEADER.trimEnd(),
      "",
      "A_PASSWORD=\"secret value\"",
      "Z_PUBLIC=public",
      ""
    ].join("\n"));
    assert.equal((await stat(path.join(targetRoot, ".env"))).mode & 0o777, 0o600);
  });
});

test("runtime config overwrites generated dotenv files without creating another backup", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(targetRoot, {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".env"), `${VIBE64_GENERATED_ENV_HEADER}\nOLD=value\n`, "utf8");
    const config = await resolveRuntimeConfig({
      id: "test",
      materializers: [
        {
          format: "dotenv",
          path: ".env"
        }
      ],
      definitions: [
        {
          key: "NEW_VALUE",
          owner: RUNTIME_CONFIG_OWNERS.ADAPTER,
          scope: RUNTIME_CONFIG_SCOPES.DEV,
          source: "test",
          value: "fresh"
        }
      ]
    });

    const results = await materializeRuntimeConfig(config, {
      roots: [targetRoot]
    });

    assert.equal(results[0].backupPath, "");
    assert.equal(results[0].changed, true);
    assert.match(await readFile(path.join(targetRoot, ".env"), "utf8"), /NEW_VALUE=fresh/u);
    await assert.rejects(readFile(path.join(targetRoot, ".env.vibe64-backup-2026-06-21T00-00-00-000Z"), "utf8"));
  });
});

test("runtime config does not rewrite unchanged generated dotenv files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const config = await resolveRuntimeConfig({
      id: "test",
      materializers: [
        {
          format: "dotenv",
          path: ".env"
        }
      ],
      definitions: [
        {
          key: "APP_PUBLIC_URL",
          owner: RUNTIME_CONFIG_OWNERS.VIBE64,
          scope: RUNTIME_CONFIG_SCOPES.DEV,
          source: "test",
          value: "http://localhost:3000"
        }
      ]
    });
    const filePath = path.join(targetRoot, ".env");
    await writeFile(filePath, dotenvText(config.records, {
      scope: config.scope
    }), "utf8");
    await chmod(filePath, 0o644);
    const before = await stat(filePath);

    const results = await materializeRuntimeConfig(config, {
      roots: [targetRoot]
    });
    const after = await stat(filePath);

    assert.equal(results[0].backupPath, "");
    assert.equal(results[0].changed, false);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("runtime config dotenv rendering uses the requested scope explicitly", () => {
  const text = dotenvText([
    {
      key: "PROD_ONLY",
      owner: RUNTIME_CONFIG_OWNERS.VIBE64,
      scope: RUNTIME_CONFIG_SCOPES.PROD,
      source: "test",
      value: "prod"
    },
    {
      key: "DEV_ONLY",
      owner: RUNTIME_CONFIG_OWNERS.VIBE64,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "test",
      value: "dev"
    }
  ], {
    scope: RUNTIME_CONFIG_SCOPES.DEV
  });

  assert.match(text, /DEV_ONLY=dev/u);
  assert.doesNotMatch(text, /PROD_ONLY=prod/u);
});

test("runtime config imports user values from generated dotenv without shadowing managed records", () => {
  const values = generatedRuntimeConfigDotenvUserValues([
    VIBE64_GENERATED_ENV_HEADER.trimEnd(),
    "",
    "APP_PUBLIC_URL=http://localhost:3000",
    "DB_HOST=evil.example",
    "HOME_ASSISTANT_AI_API_KEY=secret",
    "JSKIT_AUTH_SUPABASE_URL=https://stale.supabase.co",
    "PUBLIC_TEXT=\"hello world\"",
    "VIBE64_INTERNAL=skip",
    "VITE_PUBLIC_FLAG=yes",
    ""
  ].join("\n"), [
    {
      key: "APP_PUBLIC_URL",
      owner: RUNTIME_CONFIG_OWNERS.VIBE64,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "adapter",
      value: "http://localhost:3000"
    },
    {
      key: "DB_HOST",
      owner: RUNTIME_CONFIG_OWNERS.VIBE64,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "managed-database",
      value: "vibe64-mariadb"
    }
  ], {
    publicEnvPrefixes: ["VITE_"],
    scope: RUNTIME_CONFIG_SCOPES.DEV,
    userValueReservedKeys: ["JSKIT_AUTH_SUPABASE_URL"]
  });

  assert.deepEqual(values, {
    HOME_ASSISTANT_AI_API_KEY: {
      secret: true,
      value: "secret"
    },
    PUBLIC_TEXT: {
      secret: false,
      value: "hello world"
    },
    VITE_PUBLIC_FLAG: {
      secret: false,
      value: "yes"
    }
  });
});

test("runtime config resolver merges explicit user records", async () => {
  const config = await resolveRuntimeConfig({
    id: "test",
    definitions: [
      {
        key: "MANAGED_VALUE",
        owner: RUNTIME_CONFIG_OWNERS.VIBE64,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "test",
        value: "managed"
      }
    ]
  }, {
    records: [
      {
        key: "OPENAI_API_KEY",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "user",
        value: ""
      }
    ],
    phase: RUNTIME_CONFIG_PHASES.PREVIEW
  });

  const userRecord = config.view.records.find((record) => record.key === "OPENAI_API_KEY");
  assert.equal(userRecord.owner, RUNTIME_CONFIG_OWNERS.USER);
  assert.equal(userRecord.editable, true);
  assert.equal(userRecord.missing, true);
  assert.equal(userRecord.value, "********");
  assert.deepEqual(config.missing.map((record) => record.key), ["OPENAI_API_KEY"]);
});

test("runtime config resolver does not block missing required values when no phase is requested", async () => {
  const config = await resolveRuntimeConfig({
    id: "test",
    definitions: [
      {
        key: "OPENAI_API_KEY",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "user",
        value: ""
      }
    ]
  });

  assert.equal(config.ok, true);
  assert.deepEqual(config.missing, []);
  assert.equal(config.view.records[0].missing, false);
});

test("runtime config treats withheld known secrets as present", async () => {
  const config = await resolveRuntimeConfig({
    id: "test",
    definitions: [
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
    ]
  }, {
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

test("runtime config user records cannot shadow managed records", async () => {
  const config = await resolveRuntimeConfig({
    id: "test",
    definitions: [
      {
        key: "DB_PASSWORD",
        owner: RUNTIME_CONFIG_OWNERS.VIBE64,
        requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        secret: true,
        source: "managed_database",
        value: "managed-password"
      },
      {
        key: "OPENAI_API_KEY",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        secret: true,
        source: "adapter",
        value: ""
      }
    ]
  }, {
    records: [
      {
        key: "DB_PASSWORD",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "user",
        value: "user-password"
      },
      {
        key: "OPENAI_API_KEY",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "user",
        value: "user-api-key"
      }
    ],
    phase: RUNTIME_CONFIG_PHASES.SERVER
  });

  const dbRecord = config.records.find((record) => record.key === "DB_PASSWORD");
  const apiRecord = config.records.find((record) => record.key === "OPENAI_API_KEY");
  assert.equal(config.values.DB_PASSWORD, "managed-password");
  assert.equal(dbRecord.owner, RUNTIME_CONFIG_OWNERS.VIBE64);
  assert.equal(dbRecord.source, "managed_database");
  assert.equal(config.values.OPENAI_API_KEY, "user-api-key");
  assert.equal(apiRecord.owner, RUNTIME_CONFIG_OWNERS.USER);
  assert.equal(apiRecord.source, "user");
});

test("runtime config user records cannot shadow read-only provider user records", async () => {
  const config = await resolveRuntimeConfig({
    id: "test",
    definitions: [
      {
        editable: false,
        key: "AUTH_SUPABASE_URL",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "project-config",
        value: "https://configured.supabase.co"
      }
    ]
  }, {
    records: [
      {
        key: "AUTH_SUPABASE_URL",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "user",
        value: "https://stale-user-value.supabase.co"
      }
    ],
    phase: RUNTIME_CONFIG_PHASES.SERVER
  });

  const authRecord = config.records.find((record) => record.key === "AUTH_SUPABASE_URL");
  assert.equal(config.values.AUTH_SUPABASE_URL, "https://configured.supabase.co");
  assert.equal(authRecord.editable, false);
  assert.equal(authRecord.source, "project-config");
});

test("runtime config Env view model exposes provider editability", () => {
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
});

test("Env user value store writes 0600 state and preserves empty records", async () => {
  await withTemporaryRoot(async (projectLocalRoot) => {
    const saved = await saveEnvUserValues({
      environment: RUNTIME_CONFIG_SCOPES.DEV,
      projectLocalRoot,
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
      projectLocalRoot,
      values: {
        PUBLIC_FLAG: {
          remove: true
        }
      }
    });

    const current = await readEnvUserValues({
      projectLocalRoot
    });
    assert.equal(current.records.some((record) => record.key === "PUBLIC_FLAG"), false);
    assert.equal(current.records.some((record) => record.key === "OPENAI_API_KEY"), true);
  });
});
