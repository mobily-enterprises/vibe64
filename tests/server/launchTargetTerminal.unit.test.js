import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVibe64WebLaunchTargetTerminalSpec,
  listLaunchTargetContainers,
  removeLaunchTargetContainers
} from "@local/studio-terminal-core/server/launchTargetTerminal";

async function createLaunchSpecFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-spec-"));
  const sessionId = `session-${crypto.randomUUID()}`;
  const sessionRoot = path.join(root, "sessions", "active", sessionId);
  const worktree = path.join(sessionRoot, "worktree");
  await mkdir(worktree, {
    recursive: true
  });
  return {
    cleanup: () => rm(root, {
      force: true,
      recursive: true
    }),
    session: {
      completedSteps: ["worktree_created"],
      sessionId,
      sessionRoot,
      targetRoot: worktree
    },
    targetRoot: worktree
  };
}

function createSpec({
  preferredPort,
  session,
  targetRoot
}) {
  return createVibe64WebLaunchTargetTerminalSpec({
    adapterId: "unit",
    launchTarget: {
      id: "dev",
      label: "Run app"
    },
    preferredPort,
    resolveLaunch: async () => ({
      command: "node -e \"setInterval(() => {}, 1000)\"",
      waitForReadiness: false
    }),
    session,
    targetRoot
  });
}

test("web launch target port allocation reserves ports during concurrent spec creation", async () => {
  const fixture = await createLaunchSpecFixture();
  const preferredPort = 48000 + crypto.randomInt(1000);
  let firstSpec;
  let secondSpec;
  let releasedSpec;

  try {
    [firstSpec, secondSpec] = await Promise.all([
      createSpec({
        preferredPort,
        session: fixture.session,
        targetRoot: fixture.targetRoot
      }),
      createSpec({
        preferredPort,
        session: fixture.session,
        targetRoot: fixture.targetRoot
      })
    ]);

    assert.equal(firstSpec.ok, true);
    assert.equal(secondSpec.ok, true);
    assert.notEqual(firstSpec.metadata.port, secondSpec.metadata.port);

    const firstPort = firstSpec.metadata.port;
    firstSpec.releasePortReservation();
    secondSpec.releasePortReservation();

    releasedSpec = await createSpec({
      preferredPort: firstPort,
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(releasedSpec.ok, true);
    assert.equal(releasedSpec.metadata.port, firstPort);
  } finally {
    firstSpec?.releasePortReservation?.();
    secondSpec?.releasePortReservation?.();
    releasedSpec?.releasePortReservation?.();
    await fixture.cleanup();
  }
});

test("launch target container cleanup is scoped by daemon, session, target, and preserved terminal", async () => {
  const calls = [];
  const execFileImpl = async (command, args) => {
    calls.push({
      args,
      command
    });
    if (args[0] === "ps") {
      return {
        stdout: [
          "keep-container\tkeep-terminal",
          "remove-container\tremove-terminal",
          ""
        ].join("\n")
      };
    }
    if (args[0] === "rm") {
      assert.deepEqual(args, ["rm", "-f", "remove-container"]);
      return {
        stdout: ""
      };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  const listed = await listLaunchTargetContainers({
    daemonId: "unit-daemon",
    execFileImpl,
    sessionId: "session-1",
    targetRoot: "/tmp/vibe64"
  });
  const removed = await removeLaunchTargetContainers({
    daemonId: "unit-daemon",
    exceptTerminalIds: ["keep-terminal"],
    execFileImpl,
    sessionId: "session-1",
    targetRoot: "/tmp/vibe64"
  });

  assert.deepEqual(listed, [
    {
      id: "keep-container",
      terminalId: "keep-terminal"
    },
    {
      id: "remove-container",
      terminalId: "remove-terminal"
    }
  ]);
  assert.deepEqual(removed, ["remove-container"]);
  const psArgs = calls[0].args;
  assert.ok(psArgs.includes("label=vibe64.kind=launch-target-terminal"));
  assert.ok(psArgs.includes("label=vibe64.session=session-1"));
  assert.ok(psArgs.includes("label=vibe64.target=vibe64"));
  assert.ok(psArgs.includes("label=vibe64.daemon-id=unit-daemon"));
});
