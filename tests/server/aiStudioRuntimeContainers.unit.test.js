import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createRuntimeContainerCheck,
  runtimeContainerCommandPreview,
  runtimeContainerName,
  runtimeContainerNetworkDockerArgs,
  runtimeContainerStartScript,
  runtimeNetworkName
} from "../../server/lib/aiStudio/runtimeContainers.js";
import {
  JSKIT_MARIADB_HOST,
  createJskitMariaDbRuntimeContainer,
  jskitDatabaseDockerArgsForTarget,
  managedMariaDbAccessInstructions,
  startJskitMariaDbRepair
} from "../../server/lib/aiStudio/adapters/jskit/setupMariaDbRuntime.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

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

    assert.equal(repair.actionId, "start-runtime-container-jskit-mariadb");
    assert.match(repair.commandPreview, /mariadb:12\.0\.2/u);
    assert.match(repair.commandPreview, /MARIADB_ROOT_PASSWORD=\*\*\*\*\*/u);
    assert.doesNotMatch(repair.commandPreview, /ai_studio_jskit_root/u);
    assert.doesNotMatch(repair.commandPreview, /127\.0\.0\.1:13306:3306/u);
    assert.doesNotMatch(
      managedMariaDbAccessInstructions("app_db", targetRoot),
      /Host:/u
    );
    assert.deepEqual(
      jskitDatabaseDockerArgsForTarget(JSKIT_MARIADB_HOST, targetRoot),
      runtimeContainerNetworkDockerArgs(targetRoot)
    );
    assert.equal(
      runtimeContainerNetworkDockerArgs(targetRoot)[1],
      runtimeNetworkName(targetRoot)
    );
  });
});

test("runtime container start script safely displays shell-quoted commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const script = runtimeContainerStartScript(createJskitMariaDbRuntimeContainer(), {
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
  });
});
