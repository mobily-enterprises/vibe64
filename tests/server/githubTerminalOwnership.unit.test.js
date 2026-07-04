import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  resolveGithubHomeForActor,
  resolveGithubHomeForStoredActor
} from "../../packages/studio-terminal-core/src/server/credentialHomes.js";
import {
  resolveRequestGithubTerminalToolHome,
  terminalOwnerForGithubActor,
  terminalOwnerFromMetadata,
  terminalOwnerMatchesRequest,
  terminalOwnerMetadata
} from "../../packages/studio-terminal-core/src/server/terminalOwnership.js";

test("GitHub local actor uses the daemon runner real home", () => {
  const result = resolveGithubHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    env: {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_LOCAL);
  assert.equal(result.credentialScope, "app");
  assert.equal(result.ownerUserKey.length > 0, true);
  assert.equal(result.toolHomeSource, path.resolve(os.homedir()));
});

test("GitHub user actor uses OS username and real home, not email", () => {
  const result = resolveGithubHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    vibe64User: {
      home: "/home/ada",
      gid: 1001,
      uid: 1001,
      username: "ada"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_USER);
  assert.equal(result.credentialScope, "user");
  assert.equal(result.ownerUserKey, "ada");
  assert.equal(result.hostGid, 1001);
  assert.equal(result.hostUid, 1001);
  assert.equal(result.toolHomeSource, "/home/ada");
});

test("GitHub user actor fails without OS username and home", () => {
  const result = resolveGithubHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    vibe64User: {
      email: "ada@example.com"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_os_user_required");
});

test("GitHub actor mode reads from env", () => {
  const result = resolveGithubHomeForActor({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER
    },
    vibe64User: {
      home: "/home/grace",
      gid: 1002,
      uid: 1002,
      username: "grace"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_USER);
  assert.equal(result.ownerUserKey, "grace");
  assert.equal(result.toolHomeSource, "/home/grace");
});

test("stored GitHub actor resolves OS facts live by username", async () => {
  const result = await resolveGithubHomeForStoredActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
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
  const owner = terminalOwnerForGithubActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    vibe64User: {
      home: "/home/ada",
      gid: 1001,
      uid: 1001,
      username: "ada"
    }
  });
  const metadata = terminalOwnerMetadata(owner);

  assert.equal(metadata.terminalOwner.githubCredentialScope, "user");
  assert.equal(Object.hasOwn(metadata.terminalOwner, "githubProviderScope"), false);
  assert.equal(metadata.terminalOwner.githubToolHomeSource, "/home/ada");
  assert.equal(metadata.terminalOwner.ownerScope, "user");
  assert.equal(metadata.terminalOwner.ownerUserKey, "ada");

  const parsed = terminalOwnerFromMetadata(metadata);
  assert.equal(parsed.githubCredentialScope, "user");
  assert.equal(parsed.ownerScope, "user");
  assert.equal(parsed.ownerUserKey, "ada");

  const match = terminalOwnerMatchesRequest(metadata);
  assert.equal(match.ok, true);
  assert.equal(match.ownerScope, "user");
  assert.equal(match.ownerUserKey, "ada");
});

test("request GitHub terminal home checks that the real home exists", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-real-github-home-"));
  try {
    const result = await resolveRequestGithubTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER
      },
      input: {
        vibe64User: {
          home,
          gid: 1001,
          uid: 1001,
          username: "ada"
        }
      },
      operation: "unit-test",
      terminalKind: "unit"
    });

    assert.equal(result.ok, true);
    assert.equal(result.credentialScope, "user");
    assert.equal(result.githubToolHomeSource, home);
    assert.equal(result.hostGid, 1001);
    assert.equal(result.hostUid, 1001);
    assert.equal(result.toolHomeSource, home);
    assert.equal(result.owner.githubCredentialScope, "user");
    assert.equal(result.owner.ownerUserKey, "ada");
  } finally {
    await rm(home, {
      force: true,
      recursive: true
    });
  }
});

test("request GitHub terminal home fails when the real home is missing", async () => {
  const result = await resolveRequestGithubTerminalToolHome({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER
    },
    input: {
      vibe64User: {
        home: "/definitely/missing/vibe64/home",
        gid: 1001,
        uid: 1001,
        username: "ada"
      }
    },
    notReadyMessage: "GitHub real home is not ready.",
    operation: "unit-test",
    terminalKind: "unit"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_credential_home_not_ready");
  assert.equal(result.error, "GitHub real home is not ready.");
});
