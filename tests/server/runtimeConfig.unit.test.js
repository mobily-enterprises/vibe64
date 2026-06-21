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
