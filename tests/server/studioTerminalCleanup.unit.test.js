import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupStaleStudioTerminals,
  isStudioToolchainDockerRun,
  parseDockerNetworkRows,
  parseDockerContainerRows,
  parseProcessRows,
  removeUnusedStudioRuntimeNetworks,
  selectStaleStudioContainerIds,
  selectStaleStudioToolchainProcessIds
} from "@local/studio-terminal-core/server/studioTerminalCleanup";

function aliveDaemonKill(pid, signal) {
  if (signal === 0 && pid === 123) {
    return;
  }
  if (signal === 0) {
    const error = new Error("process missing");
    error.code = "ESRCH";
    throw error;
  }
}

test("Studio terminal cleanup only selects toolchain process trees owned by dead daemons", () => {
  const processes = parseProcessRows(`
       10     1 docker run --rm -it vibe64-base-toolchain:0.1.0 bash -lc codex
       11    10 bash -lc codex
       12    11 node /usr/local/bin/codex
       20     1 docker run --rm -it --label vibe64.kind=toolchain --label vibe64.daemon-pid=999 vibe64-base-toolchain:0.1.0 bash -lc codex
       21    20 bash -lc codex
       22    21 node /usr/local/bin/codex
       30     1 docker run --rm -it --label vibe64.kind=toolchain --label vibe64.daemon-pid=123 vibe64-base-toolchain:0.1.0 bash -lc codex
       31    30 bash -lc codex
       40     1 node /home/merc/.nvm/versions/node/v20.19.0/bin/codex resume
       41    40 /home/merc/.nvm/versions/node/v20.19.0/lib/node_modules/@openai/codex/vendor/codex
       50     1 docker run --rm mysql:8.4
  `);

  assert.equal(isStudioToolchainDockerRun(processes[0].command), false);
  assert.equal(isStudioToolchainDockerRun(processes[3].command), true);
  assert.equal(isStudioToolchainDockerRun(processes[8].command), false);
  assert.deepEqual(selectStaleStudioToolchainProcessIds(processes, {
    currentPid: 777,
    killImpl: aliveDaemonKill
  }), [22, 21, 20]);
});

test("Studio terminal cleanup only selects containers owned by dead daemons", () => {
  const containers = parseDockerContainerRows([
    "container-unknown\t",
    "container-missing-label\t<no value>",
    "container-active\t123",
    "container-dead\t999"
  ].join("\n"));

  assert.deepEqual(selectStaleStudioContainerIds(containers, {
    currentPid: 777,
    killImpl: aliveDaemonKill
  }), ["container-dead"]);
});

test("Studio runtime network cleanup removes only unused Studio networks", async () => {
  const calls = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, args]);
    if (command === "docker" && args[0] === "network" && args[1] === "ls") {
      return {
        stdout: [
          "network-unused\tvibe64-alpha-network\truntime-network\t999",
          "network-active\tvibe64-beta-network\truntime-network\t999",
          "network-current\tvibe64-current-network\truntime-network\t123",
          "network-other\tordinary-network\t<no value>\t<no value>"
        ].join("\n")
      };
    }
    if (command === "docker" && args[0] === "network" && args[1] === "inspect") {
      return {
        stdout: args[2] === "network-active"
          ? "{\"container-id\":{}}"
          : "{}"
      };
    }
    if (command === "docker" && args[0] === "network" && args[1] === "rm") {
      return {
        stdout: ""
      };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  assert.deepEqual(parseDockerNetworkRows([
    "network-id\tvibe64-alpha-network\truntime-network\t999",
    "ordinary-id\tordinary-network\t<no value>\t<no value>"
  ].join("\n")), [
    {
      daemonPid: 999,
      id: "network-id",
      kind: "runtime-network",
      name: "vibe64-alpha-network"
    },
    {
      daemonPid: 0,
      id: "ordinary-id",
      kind: "",
      name: "ordinary-network"
    }
  ]);

  const removed = await removeUnusedStudioRuntimeNetworks({
    execFileImpl,
    killImpl: aliveDaemonKill,
    logger: {
      debug() {}
    }
  });

  assert.deepEqual(removed, [
    "vibe64-alpha-network"
  ]);
  assert.deepEqual(calls.filter(([, args]) => args[0] === "network" && args[1] === "rm"), [
    ["docker", ["network", "rm", "network-unused"]]
  ]);
});

test("Studio terminal cleanup removes only dead-daemon containers and processes", async () => {
  const calls = [];
  const killed = [];
  const execFileImpl = async (command, args) => {
    calls.push([command, args]);
    if (command === "docker" && args[0] === "ps") {
      if (args.some((arg) => String(arg).includes("target-script-terminal"))) {
        return {
          stdout: "container-target-script-dead\t998\n"
        };
      }
      return {
        stdout: [
          "container-active\t123",
          "container-dead\t999",
          "container-unknown\t<no value>"
        ].join("\n")
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
          "100 1 docker run --rm -it --label vibe64.kind=toolchain --label vibe64.daemon-pid=999 vibe64-base-toolchain:0.1.0 bash -lc codex",
          "101 100 bash -lc codex",
          "102 101 node /usr/local/bin/codex",
          "110 1 docker run --rm -it vibe64-base-toolchain:0.1.0 bash -lc codex",
          "111 110 bash -lc codex",
          "120 1 docker run --rm -it --label vibe64.kind=toolchain --label vibe64.daemon-pid=123 vibe64-base-toolchain:0.1.0 bash -lc codex",
          "121 120 bash -lc codex",
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
      if (signal === 0 && pid === 123) {
        return;
      }
      if (signal === 0) {
        const error = new Error("already exited");
        error.code = "ESRCH";
        throw error;
      }
      killed.push([pid, signal]);
    },
    logger: {
      debug() {},
      warn() {}
    }
  });

  assert.deepEqual(result.removedContainers, ["container-dead", "container-target-script-dead"]);
  assert.deepEqual(result.terminatedProcesses, [102, 101, 100]);
  assert.deepEqual(killed, [
    [102, "SIGTERM"],
    [101, "SIGTERM"],
    [100, "SIGTERM"]
  ]);
  assert.deepEqual(calls[0], [
    "docker",
    [
      "ps",
      "-a",
      "--filter",
      "label=vibe64.kind=codex-terminal",
      "--format",
      "{{.ID}}\t{{.Label \"vibe64.daemon-pid\"}}"
    ]
  ]);
  assert.deepEqual(calls[1], [
    "docker",
    [
      "ps",
      "-a",
      "--filter",
      "label=vibe64.kind=target-script-terminal",
      "--format",
      "{{.ID}}\t{{.Label \"vibe64.daemon-pid\"}}"
    ]
  ]);
  assert.deepEqual(calls[2], [
    "docker",
    [
      "ps",
      "-a",
      "--filter",
      "label=vibe64.kind=toolchain",
      "--format",
      "{{.ID}}\t{{.Label \"vibe64.daemon-pid\"}}"
    ]
  ]);
  assert.deepEqual(calls[3], ["docker", ["rm", "-f", "container-dead", "container-target-script-dead"]]);
});
