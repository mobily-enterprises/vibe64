import assert from "node:assert/strict";
import test from "node:test";

import {
  GITHUB_ACCOUNT_MODE_USER,
  codexCredentialContext,
  githubCredentialContext
} from "../../packages/studio-terminal-core/src/server/credentialHomes.js";
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
  assert.equal(context.providerOptions.env.HOME, "/home/v64d_tenant");
  assert.equal(context.providerOptions.systemRoot, "/var/lib/vibe64/tenant/system");
  assert.equal(context.providerOptions.toolHomeSource, "/home/v64d_tenant");
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
