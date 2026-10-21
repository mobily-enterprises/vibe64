import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  GITHUB_ACCOUNT_MODE_USER,
  codexCredentialContext,
  githubCredentialContext
} from "../../packages/vibe64-execution/src/server/credentialHomes.js";
import {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_PLAYWRIGHT_VERSION_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV
} from "../../packages/vibe64-execution/src/server/env/sharedToolEnv.js";
import {
  runtimePackBinPaths
} from "../../packages/vibe64-execution/src/server/runtime/runtimePacks.js";
import {
  codexRuntimeContext
} from "../../packages/studio-terminal-core/src/server/codexRuntimeContext.js";
import { configureVibe64Host } from "../../packages/vibe64-execution/src/server/hostProfile.js";

after(() => configureVibe64Host(null));

function usePackHost(t, runtimePackRoot, sharedCacheRoot = path.join(runtimePackRoot, "cache")) {
  configureVibe64Host({ runtimePackRoot, sharedCacheRoot });
  t.after(() => configureVibe64Host(null));
  return { runtimePackRoot, sharedCacheRoot };
}

test("Codex credential context uses the daemon runner real home", () => {
  assert.deepEqual(codexCredentialContext({
    home: "/home/owner",
    gid: 1000,
    uid: 1000,
    username: "owner"
  }), {
    gid: 1000,
    home: "/home/owner",
    ok: true,
    scope: "app",
    toolHomeSource: "/home/owner",
    uid: 1000,
    username: "owner",
    userKey: "owner"
  });
});

test("Codex runtime context keeps home, provider env, tool home, and system root together", (t) => {
  const host = usePackHost(t, "/srv/runtime-packs");
  const browsers = "/srv/runtime-packs/playwright/browsers";
  const context = codexRuntimeContext({
    env: {
      PATH: "/usr/bin",
      VIBE64_SYSTEM_ROOT: "/srv/state/system"
    },
    home: "/home/owner",
    gid: 1000,
    providerOptions: {
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: "/srv/run/codex"
      }
    },
    terminalEnv: {
      DB_CLIENT: "mysql2",
      DB_HOST: "127.0.0.1",
      DB_NAME: "tenant_app",
      DB_PASSWORD: "workspace-password",
      DB_PORT: "3307",
      DB_USER: "vibe64_dev_app"
    },
    uid: 1000,
    username: "owner"
  });

  assert.equal(context.ok, true);
  assert.equal(context.home, "/home/owner");
  assert.equal(context.toolHomeSource, "/home/owner");
  assert.equal(context.systemRoot, "/srv/state/system");
  assert.equal(context.env.HOME, "/home/owner");
  assert.equal(context.env.XDG_CONFIG_HOME, "/home/owner/.config");
  assert.equal(context.env.VIBE64_CODEX_ATTACHMENTS_ROOT, "/srv/run/codex");
  assert.equal(context.env[VIBE64_SHARED_CACHE_ROOT_ENV], host.sharedCacheRoot);
  assert.equal(context.env[PLAYWRIGHT_BROWSERS_PATH_ENV], browsers);
  assert.equal(context.terminalEnv.DB_HOST, "127.0.0.1");
  assert.equal(context.terminalProcessEnv.DB_NAME, "tenant_app");
  assert.equal(context.terminalProcessEnv.DB_PASSWORD, "workspace-password");
  assert.equal(context.terminalProcessEnv.DB_PORT, "3307");
  assert.equal(context.terminalProcessEnv.DB_USER, "vibe64_dev_app");
  assert.equal(context.terminalEnv.MYSQL_HOST, undefined);
  assert.equal(context.terminalEnv.MYSQL_DATABASE, undefined);
  assert.equal(context.terminalEnv.MYSQL_PWD, undefined);
  assert.equal(context.terminalProcessEnv.MYSQL_TCP_PORT, undefined);
  assert.equal(context.terminalProcessEnv.VIBE64_MYSQL_USER, undefined);
  assert.equal(context.terminalProcessEnv.HOME, "/home/owner");
  assert.equal(context.terminalProcessEnv[VIBE64_SHARED_CACHE_ROOT_ENV], host.sharedCacheRoot);
  assert.equal(context.terminalProcessEnv[PLAYWRIGHT_BROWSERS_PATH_ENV], browsers);
  assert.ok(context.runtimes.includes("mariadb"));
  assert.ok(context.providerOptions.runtimes.includes("mariadb"));
  assert.ok(context.terminalProcessEnv.PATH.split(":").includes(runtimePackBinPaths("mariadb")[0]));
  assert.equal(context.providerOptions.env.HOME, "/home/owner");
  assert.equal(context.providerOptions.env[VIBE64_SHARED_CACHE_ROOT_ENV], host.sharedCacheRoot);
  assert.equal(context.providerOptions.env[PLAYWRIGHT_BROWSERS_PATH_ENV], browsers);
  assert.equal(context.providerOptions.systemRoot, "/srv/state/system");
  assert.equal(context.providerOptions.toolHomeSource, "/home/owner");
});

test("Codex runtime context derives Playwright browsers path from the runtime-pack root", (t) => {
  usePackHost(t, "/srv/vibe64-runtimes", "/srv/vibe64-cache");
  const context = codexRuntimeContext({
    env: {
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/wrong"
    },
    home: "/home/owner",
    terminalEnv: {
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/also-wrong"
    },
    username: "owner"
  });

  assert.equal(context.ok, true);
  assert.equal(context.env[PLAYWRIGHT_BROWSERS_PATH_ENV], "/srv/vibe64-runtimes/playwright/browsers");
  assert.equal(context.terminalProcessEnv[PLAYWRIGHT_BROWSERS_PATH_ENV], "/srv/vibe64-runtimes/playwright/browsers");
});

test("Codex runtime context exposes the active managed Playwright version and rejects project overrides", async (t) => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-playwright-"));
  usePackHost(t, runtimeRoot);
  try {
    await mkdir(path.join(runtimeRoot, "playwright"), {
      recursive: true
    });
    await writeFile(
      path.join(runtimeRoot, "playwright/runtime.env"),
      "playwright_version=1.50.1\nchromium_revision=1155\n",
      "utf8"
    );
    const context = codexRuntimeContext({
      env: {},
      home: "/home/owner",
      terminalEnv: {
        VIBE64_PLAYWRIGHT_VERSION: "9.9.9"
      },
      username: "owner"
    });

    assert.equal(context.ok, true);
    assert.equal(context.terminalEnv[VIBE64_PLAYWRIGHT_VERSION_ENV], undefined);
    assert.equal(context.env[VIBE64_PLAYWRIGHT_VERSION_ENV], "1.50.1");
    assert.equal(context.providerOptions.env[VIBE64_PLAYWRIGHT_VERSION_ENV], "1.50.1");
    assert.equal(context.terminalProcessEnv[VIBE64_PLAYWRIGHT_VERSION_ENV], "1.50.1");
  } finally {
    await rm(runtimeRoot, {
      force: true,
      recursive: true
    });
  }
});

test("Codex runtime context rejects missing required system root", () => {
  const context = codexRuntimeContext({
    env: {},
    home: "/home/owner",
    requireSystemRoot: true
  });

  assert.equal(context.ok, false);
  assert.equal(context.code, "vibe64_codex_system_root_required");
});

test("GitHub credential context requires OS username and real home, not email mapping", () => {
  const emailOnly = githubCredentialContext({
    vibe64User: {
      email: "ada@example.com"
    }
  }, {
    accountMode: GITHUB_ACCOUNT_MODE_USER
  });

  assert.equal(emailOnly.ok, false);
  assert.equal(emailOnly.code, "vibe64_os_user_required");

  const osUser = githubCredentialContext({
    vibe64User: {
      home: "/home/ada",
      gid: 1001,
      uid: 1001,
      username: "ada"
    }
  }, {
    accountMode: GITHUB_ACCOUNT_MODE_USER
  });

  assert.equal(osUser.ok, true);
  assert.equal(osUser.gid, 1001);
  assert.equal(osUser.toolHomeSource, "/home/ada");
  assert.equal(osUser.uid, 1001);
  assert.equal(osUser.userKey, "ada");
});
