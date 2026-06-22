import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  VIBE64_GENERATED_ENV_HEADER,
  dotenvText,
  materializeRuntimeConfig,
  resolveRuntimeConfig
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readRuntimeConfigUserValues,
  saveRuntimeConfigUserValues
} from "@local/vibe64-core/server/runtimeConfigUserValues";
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
    assert.match(await readFile(path.join(targetRoot, ".env"), "utf8"), /NEW_VALUE=fresh/u);
    await assert.rejects(readFile(path.join(targetRoot, ".env.vibe64-backup-2026-06-21T00-00-00-000Z"), "utf8"));
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
        source: "project-runtime-config",
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
        source: "project-runtime-config",
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
        source: "project-runtime-config",
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
        source: "project-runtime-config",
        value: "user-password"
      },
      {
        key: "OPENAI_API_KEY",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "project-runtime-config",
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
  assert.equal(apiRecord.source, "project-runtime-config");
});

test("runtime config user value store writes 0600 state and preserves empty required records", async () => {
  await withTemporaryRoot(async (projectLocalRoot) => {
    const saved = await saveRuntimeConfigUserValues({
      projectLocalRoot,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      values: {
        OPENAI_API_KEY: {
          requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
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
    assert.deepEqual(apiKeyRecord.requiredFor, [RUNTIME_CONFIG_PHASES.PREVIEW]);
    assert.equal(publicRecord.secret, false);
    assert.equal((await stat(saved.filePath)).mode & 0o777, 0o600);

    await saveRuntimeConfigUserValues({
      projectLocalRoot,
      values: {
        PUBLIC_FLAG: {
          remove: true
        }
      }
    });

    const current = await readRuntimeConfigUserValues({
      projectLocalRoot
    });
    assert.equal(current.records.some((record) => record.key === "PUBLIC_FLAG"), false);
    assert.equal(current.records.some((record) => record.key === "OPENAI_API_KEY"), true);
  });
});
