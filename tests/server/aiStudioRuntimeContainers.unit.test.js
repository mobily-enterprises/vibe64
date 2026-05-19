import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createRuntimeContainerCheck,
  ensureTargetRuntimeNetwork,
  runtimeContainerCommandPreview,
  runtimeContainerName,
  runtimeContainerNetworkDockerArgs,
  runtimeContainerStartScript,
  runtimeNetworkName,
  targetRuntimeNetworkDockerArgs,
  targetRuntimeNetworkEnsureCommand
} from "../../server/lib/aiStudio/runtimeContainers.js";
import {
  createJskitMariaDbRuntimeContainer,
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
      targetRuntimeNetworkDockerArgs(targetRoot),
      runtimeContainerNetworkDockerArgs(targetRoot)
    );
    assert.equal(
      runtimeContainerNetworkDockerArgs(targetRoot)[1],
      runtimeNetworkName(targetRoot)
    );
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

    assert.equal(result, networkName);
    assert.deepEqual(calls, [
      ["docker", ["network", "inspect", networkName]],
      ["docker", ["network", "create", networkName]]
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

    assert.equal(command.split(" || ").filter((part) => part === inspectCommand).length, 2);
    assert.ok(command.includes(`docker network create ${networkName} >/dev/null`));
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
    assert.match(script, /if ! docker start ai-studio-jskit-jskit-mariadb-/u);
    assert.match(script, /container could not start\. Recreating the container while keeping managed volumes\./u);
    assert.match(script, /docker rm -f ai-studio-jskit-jskit-mariadb-/u);
  });
});
