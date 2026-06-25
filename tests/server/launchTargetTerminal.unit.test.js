import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createVibe64WebLaunchTargetTerminalSpec,
  listLaunchTargetContainers,
  removeLaunchTargetContainers
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  createLaunchRestartBaseline,
  launchRestartState,
  previewPublicOriginForLaunch
} from "../../packages/vibe64-terminals/src/server/launchTargetTerminal.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-tenant";

const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  await execFileAsync("git", args, {
    cwd
  });
}

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

test("preview public origin maps tenant Studio hosts to the app preview domain", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    publicHost: "massimo.users.vibe64.dev",
    sessionId: "2026-06-19_14-44-21",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^https:\/\/v64preview-[a-z0-9]{12}--massimo\.vibe64\.dev$/u);
  assert.equal(publicOrigin.includes(".users.vibe64.dev"), false);
});

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

test("web launch target passes resolved env to the launch container and redacts command preview", async () => {
  const fixture = await createLaunchSpecFixture();
  let spec;

  try {
    spec = await createSpec({
      preferredPort: 49000 + crypto.randomInt(1000),
      session: fixture.session,
      targetRoot: fixture.targetRoot
    });

    assert.equal(spec.ok, true);
    const agentTarget = new URL(spec.metadata.agentTargetHref);
    assert.match(agentTarget.hostname, /^vibe64-launch-[a-f0-9]{12}$/u);
    assert.equal(agentTarget.port, String(spec.metadata.port));
    assert.equal(agentTarget.pathname, "/");
    assert.deepEqual(spec.env, {
      VIBE64_LAUNCH_AGENT_HOST: agentTarget.hostname,
      VIBE64_LAUNCH_AGENT_HREF: spec.metadata.agentTargetHref
    });
    assert.equal(spec.metadata.terminalOwner.ownerScope, "app");
    assert.equal(spec.metadata.terminalOwner.ownerUserKey, "launch-target");
    assert.equal(spec.metadata.terminalGithubActor.scope, "none");
    assert.equal(spec.metadata.terminalGithubActor.reason, "launch-target");
    const args = spec.args({
      env: {
        APP_PUBLIC_URL: "http://localhost:4100",
        AUTH_SUPABASE_PUBLISHABLE_KEY: "pk_test_value",
        DB_PASSWORD: "database-password",
        VISIBLE_VALUE: "visible"
      },
      id: "terminal-1"
    });

    assert.ok(args.includes(agentTarget.hostname));
    assertDockerEnvName(args, "APP_PUBLIC_URL");
    assertDockerEnvName(args, "AUTH_SUPABASE_PUBLISHABLE_KEY");
    assertDockerEnvName(args, "DB_PASSWORD");
    assertDockerEnvName(args, "VIBE64_LAUNCH_AGENT_HOST");
    assertDockerEnvName(args, "VIBE64_LAUNCH_AGENT_HREF");
    assertDockerEnvName(args, "VISIBLE_VALUE");
    assert.equal(args.includes("APP_PUBLIC_URL=http://localhost:4100"), false);
    assert.equal(args.includes("AUTH_SUPABASE_PUBLISHABLE_KEY=pk_test_value"), false);
    assert.equal(args.includes("DB_PASSWORD=database-password"), false);
    assert.equal(args.includes(`VIBE64_LAUNCH_AGENT_HOST=${agentTarget.hostname}`), false);
    assert.equal(args.includes(`VIBE64_LAUNCH_AGENT_HREF=${spec.metadata.agentTargetHref}`), false);
    assert.equal(args.includes("VISIBLE_VALUE=visible"), false);

    const commandPreview = spec.commandPreview({
      args
    });
    assert.match(commandPreview, /-e APP_PUBLIC_URL/u);
    assert.match(commandPreview, /-e AUTH_SUPABASE_PUBLISHABLE_KEY/u);
    assert.match(commandPreview, /-e DB_PASSWORD/u);
    assert.match(commandPreview, /-e VIBE64_LAUNCH_AGENT_HOST/u);
    assert.match(commandPreview, /-e VIBE64_LAUNCH_AGENT_HREF/u);
    assert.match(commandPreview, /-e VISIBLE_VALUE/u);
    assert.doesNotMatch(commandPreview, /database-password/u);
    assert.doesNotMatch(commandPreview, /pk_test_value/u);
  } finally {
    spec?.releasePortReservation?.();
    await fixture.cleanup();
  }
});

function assertDockerEnvName(args = [], expected = "") {
  const index = args.indexOf(expected);
  assert.notEqual(index, -1, `expected docker env ${expected}`);
  assert.equal(args[index - 1], "-e");
}

test("launch restart state marks relevant server file changes stale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-restart-"));
  try {
    await runGit(root, ["init", "--initial-branch=main"]);
    await runGit(root, ["config", "user.email", "vibe64@example.test"]);
    await runGit(root, ["config", "user.name", "Vibe64 Test"]);
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await mkdir(path.join(root, "src"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");
    await writeFile(path.join(root, "src", "page.vue"), "<template>One</template>\n");
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Initial app"]);

    const baseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**", "src/**/*.server.js"],
        label: "server files"
      },
      worktreePath: root
    });

    await writeFile(path.join(root, "src", "page.vue"), "<template>Two</template>\n");
    assert.equal((await launchRestartState({
      baseline,
      worktreePath: root
    })).stale, false);

    await writeFile(path.join(root, "src", "direct.server.js"), "export const server = true;\n");
    const directServerState = await launchRestartState({
      baseline,
      worktreePath: root
    });
    assert.equal(directServerState.stale, true);
    assert.deepEqual(directServerState.changedFiles, ["src/direct.server.js"]);

    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Add direct server file"]);
    const committedDirectServerBaseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**", "src/**/*.server.js"],
        label: "server files"
      },
      worktreePath: root
    });

    await writeFile(path.join(root, "server", "app.js"), "export const value = 2;\n");
    const staleState = await launchRestartState({
      baseline: committedDirectServerBaseline,
      worktreePath: root
    });
    assert.equal(staleState.stale, true);
    assert.deepEqual(staleState.changedFiles, ["server/app.js"]);
    assert.equal(staleState.reason, "server_source_changed");
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("launch restart state ignores commits of launch-time dirty server content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-restart-dirty-"));
  try {
    await runGit(root, ["init", "--initial-branch=main"]);
    await runGit(root, ["config", "user.email", "vibe64@example.test"]);
    await runGit(root, ["config", "user.name", "Vibe64 Test"]);
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Initial app"]);

    await writeFile(path.join(root, "server", "app.js"), "export const value = 2;\n");
    const baseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**"],
        label: "server files"
      },
      worktreePath: root
    });

    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Commit launch-time content"]);
    assert.equal((await launchRestartState({
      baseline,
      worktreePath: root
    })).stale, false);

    await writeFile(path.join(root, "server", "app.js"), "export const value = 3;\n");
    const staleState = await launchRestartState({
      baseline,
      worktreePath: root
    });
    assert.equal(staleState.stale, true);
    assert.deepEqual(staleState.changedFiles, ["server/app.js"]);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("launch restart state detects first commits that change launch-time server content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-restart-unborn-"));
  try {
    await runGit(root, ["init", "--initial-branch=main"]);
    await runGit(root, ["config", "user.email", "vibe64@example.test"]);
    await runGit(root, ["config", "user.name", "Vibe64 Test"]);
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");
    const baseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**"],
        label: "server files"
      },
      worktreePath: root
    });

    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Commit launch-time content"]);
    assert.equal((await launchRestartState({
      baseline,
      worktreePath: root
    })).stale, false);

    await writeFile(path.join(root, "server", "app.js"), "export const value = 2;\n");
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "Change server content"]);
    const staleState = await launchRestartState({
      baseline,
      worktreePath: root
    });
    assert.equal(staleState.stale, true);
    assert.deepEqual(staleState.changedFiles, ["server/app.js"]);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("launch restart baseline is unavailable outside git worktrees", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-no-git-"));
  try {
    await mkdir(path.join(root, "server"), {
      recursive: true
    });
    await writeFile(path.join(root, "server", "app.js"), "export const value = 1;\n");

    assert.equal(await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**"]
      },
      worktreePath: root
    }), null);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
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
