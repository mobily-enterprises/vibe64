import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupStaleStudioTerminals,
  isStudioToolchainDockerRun,
  parseProcessRows,
  selectStaleStudioToolchainProcessIds
} from "../../server/lib/studioTerminalCleanup.js";

test("Studio terminal cleanup selects only Studio toolchain process trees", () => {
  const processes = parseProcessRows(`
       10     1 docker run --rm -it jskit-ai-studio-toolchain:0.1.0 bash -lc codex
       11    10 bash -lc codex
       12    11 node /usr/local/bin/codex
       13    12 /usr/local/lib/node_modules/@openai/codex/vendor/codex
       20     1 node /home/merc/.nvm/versions/node/v20.19.0/bin/codex resume
       21    20 /home/merc/.nvm/versions/node/v20.19.0/lib/node_modules/@openai/codex/vendor/codex
       30     1 docker run --rm mysql:8.4
  `);

  assert.equal(isStudioToolchainDockerRun(processes[0].command), true);
  assert.equal(isStudioToolchainDockerRun(processes[4].command), false);
  assert.deepEqual(selectStaleStudioToolchainProcessIds(processes, 99999), [13, 12, 11, 10]);
});

test("Studio terminal cleanup removes labeled containers and stale toolchain processes", async () => {
  const calls = [];
  const killed = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, args]);
    if (command === "docker" && args[0] === "ps") {
      if (String(args[3] || "").includes("app-test-terminal")) {
        return {
          stdout: "container-c\n"
        };
      }
      return {
        stdout: "container-a\ncontainer-b\n"
      };
    }
    if (command === "docker" && args[0] === "rm") {
      return {
        stdout: ""
      };
    }
    if (command === "ps") {
      return {
        stdout: [
          "100 1 docker run --rm -it jskit-ai-studio-toolchain:0.1.0 bash -lc codex",
          "101 100 bash -lc codex",
          "102 101 node /usr/local/bin/codex",
          "200 1 node /home/merc/.nvm/versions/node/v20.19.0/bin/codex resume"
        ].join("\n")
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const result = await cleanupStaleStudioTerminals({
    execFileImpl,
    graceMs: 0,
    killImpl(pid, signal) {
      if (signal === 0) {
        throw new Error("already exited");
      }
      killed.push([pid, signal]);
    },
    logger: {
      debug() {},
      warn() {}
    }
  });

  assert.deepEqual(result.removedContainers, ["container-a", "container-b", "container-c"]);
  assert.deepEqual(result.terminatedProcesses, [102, 101, 100]);
  assert.deepEqual(killed, [
    [102, "SIGTERM"],
    [101, "SIGTERM"],
    [100, "SIGTERM"]
  ]);
  assert.deepEqual(calls[0], [
    "docker",
    ["ps", "-aq", "--filter", "label=jskit-ai-studio.kind=codex-terminal"]
  ]);
  assert.deepEqual(calls[1], [
    "docker",
    ["ps", "-aq", "--filter", "label=jskit-ai-studio.kind=app-test-terminal"]
  ]);
  assert.deepEqual(calls[2], ["docker", ["rm", "-f", "container-a", "container-b", "container-c"]]);
});
