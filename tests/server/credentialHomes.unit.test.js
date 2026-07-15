import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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

test("Codex runtime context keeps home, provider env, tool home, and system root together", () => {
  const context = codexRuntimeContext({
    env: {
      PATH: "/usr/bin",
      VIBE64_SYSTEM_ROOT: "/var/lib/vibe64/tenant/system"
    },
    home: "/home/v64d_tenant",
    gid: 1000,
    providerOptions: {
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: "/run/vibe64/codex"
      }
    },
    terminalEnv: {
      DB_CLIENT: "mysql2",
      DB_HOST: "127.0.0.1",
      DB_NAME: "tenant_app",
      DB_PASSWORD: "tenant-password",
      DB_PORT: "3307",
      DB_USER: "vibe64_dev_app"
    },
    uid: 1000,
    username: "v64d_tenant"
  });

  assert.equal(context.ok, true);
  assert.equal(context.home, "/home/v64d_tenant");
  assert.equal(context.toolHomeSource, "/home/v64d_tenant");
  assert.equal(context.systemRoot, "/var/lib/vibe64/tenant/system");
  assert.equal(context.env.HOME, "/home/v64d_tenant");
  assert.equal(context.env.XDG_CONFIG_HOME, "/home/v64d_tenant/.config");
  assert.equal(context.env.VIBE64_CODEX_ATTACHMENTS_ROOT, "/run/vibe64/codex");
  assert.equal(context.env[VIBE64_SHARED_CACHE_ROOT_ENV], "/var/cache/vibe64");
  assert.equal(context.env[PLAYWRIGHT_BROWSERS_PATH_ENV], "/opt/vibe64/runtime-packs/playwright/browsers");
  assert.equal(context.terminalEnv.DB_HOST, "127.0.0.1");
  assert.equal(context.terminalProcessEnv.DB_NAME, "tenant_app");
  assert.equal(context.terminalEnv.MYSQL_HOST, "127.0.0.1");
  assert.equal(context.terminalEnv.MYSQL_DATABASE, "tenant_app");
  assert.equal(context.terminalEnv.MYSQL_PWD, "tenant-password");
  assert.equal(context.terminalProcessEnv.MYSQL_TCP_PORT, "3307");
  assert.equal(context.terminalProcessEnv.VIBE64_MYSQL_USER, "vibe64_dev_app");
  assert.equal(context.terminalProcessEnv.HOME, "/home/v64d_tenant");
  assert.equal(context.terminalProcessEnv[VIBE64_SHARED_CACHE_ROOT_ENV], "/var/cache/vibe64");
  assert.equal(context.terminalProcessEnv[PLAYWRIGHT_BROWSERS_PATH_ENV], "/opt/vibe64/runtime-packs/playwright/browsers");
  assert.ok(context.runtimes.includes("mariadb"));
  assert.ok(context.providerOptions.runtimes.includes("mariadb"));
  assert.ok(context.terminalProcessEnv.PATH.split(":").includes(runtimePackBinPaths("mariadb")[0]));
  assert.equal(context.providerOptions.env.HOME, "/home/v64d_tenant");
  assert.equal(context.providerOptions.env[VIBE64_SHARED_CACHE_ROOT_ENV], "/var/cache/vibe64");
  assert.equal(context.providerOptions.env[PLAYWRIGHT_BROWSERS_PATH_ENV], "/opt/vibe64/runtime-packs/playwright/browsers");
  assert.equal(context.providerOptions.systemRoot, "/var/lib/vibe64/tenant/system");
  assert.equal(context.providerOptions.toolHomeSource, "/home/v64d_tenant");
});

test("Codex runtime context derives Playwright browsers path from the runtime-pack root", () => {
  const context = codexRuntimeContext({
    env: {
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/wrong",
      VIBE64_RUNTIME_PACK_ROOT: "/srv/vibe64-runtimes",
      VIBE64_SHARED_CACHE_ROOT: "/srv/vibe64-cache"
    },
    home: "/home/v64d_tenant",
    terminalEnv: {
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/also-wrong"
    },
    username: "v64d_tenant"
  });

  assert.equal(context.ok, true);
  assert.equal(context.env[PLAYWRIGHT_BROWSERS_PATH_ENV], "/srv/vibe64-runtimes/playwright/browsers");
  assert.equal(context.terminalProcessEnv[PLAYWRIGHT_BROWSERS_PATH_ENV], "/srv/vibe64-runtimes/playwright/browsers");
});

test("Codex runtime context exposes the active managed Playwright version and rejects project overrides", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-playwright-"));
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
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      home: "/home/v64d_tenant",
      terminalEnv: {
        VIBE64_PLAYWRIGHT_VERSION: "9.9.9"
      },
      username: "v64d_tenant"
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
    home: "/home/v64d_tenant",
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
