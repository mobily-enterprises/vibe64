import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  resolveGithubHomeForStoredActor
} from "../../packages/vibe64-execution/src/server/credentialHomes.js";
import { __testables } from "../../packages/studio-terminal-core/src/server/terminalOwnership.js";

const { terminalOwnerMetadata } = __testables;

test("a stored GitHub actor in local mode uses the daemon runner real home", async () => {
  const result = await resolveGithubHomeForStoredActor({
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    env: {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_LOCAL);
  assert.equal(result.credentialScope, "app");
  assert.equal(result.ownerUserKey.length > 0, true);
  assert.equal(result.toolHomeSource, path.resolve(os.homedir()));
});

test("a stored GitHub actor reads its account mode from env", async () => {
  const result = await resolveGithubHomeForStoredActor({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER
    },
    ownerUserKey: "grace",
    osUserResolver: async (username) => ({
      gid: 1002,
      home: `/home/${username}`,
      uid: 1002,
      username
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_USER);
  assert.equal(result.ownerUserKey, "grace");
  assert.equal(result.toolHomeSource, "/home/grace");
});

test("stored GitHub actor resolves OS facts live by username", async () => {
  const result = await resolveGithubHomeForStoredActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    env: {},
    ownerUserKey: "ada",
    osUserResolver: async (username) => ({
      gid: 1003,
      home: `/srv/homes/${username}`,
      uid: 1003,
      username
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.credentialScope, "user");
  assert.equal(result.hostGid, 1003);
  assert.equal(result.hostUid, 1003);
  assert.equal(result.ownerUserKey, "ada");
  assert.equal(result.toolHomeSource, "/srv/homes/ada");
});

test("terminal owner metadata records credential scope only", () => {
  const metadata = terminalOwnerMetadata({
    githubCredentialScope: "user",
    githubToolHomeSource: "/home/ada",
    ownerScope: "user",
    ownerUserKey: "ada"
  });

  assert.equal(metadata.terminalOwner.githubCredentialScope, "user");
  assert.equal(Object.hasOwn(metadata.terminalOwner, "githubProviderScope"), false);
  assert.equal(metadata.terminalOwner.githubToolHomeSource, "/home/ada");
  assert.equal(metadata.terminalOwner.ownerScope, "user");
  assert.equal(metadata.terminalOwner.ownerUserKey, "ada");
});
