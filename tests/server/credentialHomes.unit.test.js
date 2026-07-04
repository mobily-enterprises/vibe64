import assert from "node:assert/strict";
import test from "node:test";

import {
  GITHUB_ACCOUNT_MODE_USER,
  codexCredentialContext,
  githubCredentialContext
} from "../../packages/studio-terminal-core/src/server/credentialHomes.js";

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
