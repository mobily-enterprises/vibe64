import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createVibe64WebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  createLaunchRestartBaseline,
  launchRestartState,
  previewPublicOriginForLaunch
} from "../../packages/vibe64-terminals/src/server/launchTargetTerminal.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  await execFileAsync("git", args, {
    cwd
  });
}

async function createLaunchSpecFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-launch-spec-"));
  const sessionId = `session-${crypto.randomUUID()}`;
  const sessionRoot = path.join(root, "state", "sessions", "active", sessionId);
  const worktree = path.join(root, "managed-source", "sessions", "active", sessionId, "source");
  await mkdir(worktree, {
    recursive: true
  });
  return {
    cleanup: () => rm(root, {
      force: true,
      recursive: true
    }),
    session: {
      completedSteps: ["source_created"],
      metadata: {
        source_kind: "session_clone",
        source_path: worktree,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
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
      env: {
        APP_PUBLIC_URL: "http://localhost:4100",
        AUTH_SUPABASE_PUBLISHABLE_KEY: "pk_test_value",
        DB_PASSWORD: "database-password",
        VISIBLE_VALUE: "visible"
      },
      waitForReadiness: false
    }),
    session,
    targetRoot
  });
}

test("preview public origin maps user Studio hosts to the app preview domain", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    publicHost: "massimo.users.vibe64.dev",
    sessionId: "2026-06-19_14-44-21",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^http:\/\/v64preview-[a-z0-9]{12}--massimo\.vibe64\.dev$/u);
  assert.equal(publicOrigin.includes(".users.vibe64.dev"), false);
});

test("preview public origin does not inherit the Studio HTTPS protocol", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {
      VIBE64_PREVIEW_PUBLIC_DOMAIN: "vibe64.dev",
      VIBE64_PUBLIC_PROTOCOL: "https",
      VIBE64_PUBLIC_USER_DOMAIN: "users.vibe64.dev"
    },
    publicHost: "pass.users.vibe64.dev",
    sessionId: "2026-07-10_05-25-34",
    targetHref: "http://127.0.0.1:4102/",
    terminalSessionId: "preview-terminal"
  });

  assert.match(publicOrigin, /^http:\/\/v64preview-[a-z0-9]{12}--pass\.vibe64\.dev$/u);
});

test("preview public origin supports an explicit preview protocol override", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {
      VIBE64_PREVIEW_PUBLIC_DOMAIN: "vibe64.dev",
      VIBE64_PREVIEW_PUBLIC_PROTOCOL: "https",
      VIBE64_PUBLIC_PROTOCOL: "https",
      VIBE64_PUBLIC_USER_DOMAIN: "users.vibe64.dev"
    },
    publicHost: "massimo.users.vibe64.dev",
    sessionId: "2026-06-19_14-44-21",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^https:\/\/v64preview-[a-z0-9]{12}--massimo\.vibe64\.dev$/u);
});

test("preview public origin supports explicit localhost hosted routing config", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    previewPublicDomain: "localhost:3000",
    publicHost: "merc.users.localhost:3000",
    publicProtocol: "http",
    publicUserDomain: "users.localhost:3000",
    sessionId: "2026-07-07_12-20-30",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^http:\/\/v64preview-[a-z0-9]{12}--merc\.localhost:3000$/u);
  assert.equal(publicOrigin.includes(".users.localhost"), false);
});

test("preview public origin supports env-driven localhost hosted routing config", () => {
  const publicOrigin = previewPublicOriginForLaunch({
    env: {
      VIBE64_PREVIEW_PUBLIC_DOMAIN: "localhost:3000",
      VIBE64_PUBLIC_PROTOCOL: "http",
      VIBE64_PUBLIC_USER_DOMAIN: "users.localhost:3000"
    },
    publicHost: "merc.users.localhost:3000",
    sessionId: "2026-07-07_12-21-30",
    targetHref: "http://127.0.0.1:4100/home",
    terminalSessionId: "38a93bff-7956-47f7-a2df-fd2906498869"
  });

  assert.match(publicOrigin, /^http:\/\/v64preview-[a-z0-9]{12}--merc\.localhost:3000$/u);
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

test("web launch target passes resolved env to the host launch command and redacts command preview", async () => {
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
    assert.equal(agentTarget.hostname, "127.0.0.1");
    assert.equal(agentTarget.port, String(spec.metadata.port));
    assert.equal(agentTarget.pathname, "/");
    assert.equal(spec.command, "bash");
    assert.equal(spec.metadata.terminalOwner.ownerScope, "app");
    assert.equal(spec.metadata.terminalOwner.ownerUserKey, "launch-target");
    assert.equal(spec.metadata.terminalGithubActor.scope, "none");
    assert.equal(spec.metadata.terminalGithubActor.reason, "launch-target");
    const env = spec.env({
      id: "terminal-1"
    });
    assert.equal(env.VIBE64_LAUNCH_AGENT_HOST, "127.0.0.1");
    assert.equal(env.VIBE64_LAUNCH_AGENT_HREF, spec.metadata.agentTargetHref);
    assert.equal(env.APP_PUBLIC_URL, "http://localhost:4100");
    assert.equal(env.AUTH_SUPABASE_PUBLISHABLE_KEY, "pk_test_value");
    assert.equal(env.DB_PASSWORD, "database-password");
    assert.equal(env.VISIBLE_VALUE, "visible");
    const args = spec.args({
      id: "terminal-1"
    });

    assert.ok(args.join("\n").includes("HOST=127.0.0.1"));
    assert.ok(args.join("\n").includes(`PORT=${spec.metadata.port}`));
    assert.equal(args.includes("APP_PUBLIC_URL=http://localhost:4100"), false);
    assert.equal(args.includes("AUTH_SUPABASE_PUBLISHABLE_KEY=pk_test_value"), false);
    assert.equal(args.includes("DB_PASSWORD=database-password"), false);
    assert.equal(args.includes(`VIBE64_LAUNCH_AGENT_HREF=${spec.metadata.agentTargetHref}`), false);
    assert.equal(args.includes("VISIBLE_VALUE=visible"), false);

    const commandPreview = spec.commandPreview;
    assert.match(commandPreview, /node -e/u);
    assert.doesNotMatch(commandPreview, /database-password/u);
    assert.doesNotMatch(commandPreview, /pk_test_value/u);
  } finally {
    spec?.releasePortReservation?.();
    await fixture.cleanup();
  }
});

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
