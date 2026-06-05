import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVibe64Auth
} from "../../server/lib/auth/index.js";

test("Vibe64 auth creates first owner with a salted hash and session", async () => {
  await withAuth(async (auth) => {
    const state = await auth.stateForRequest({});
    assert.equal(state.setupRequired, true);

    const owner = await auth.users.setupOwner({
      email: "Owner@Example.com",
      password: "correct-password",
      passwordConfirmation: "correct-password"
    });
    assert.equal(owner.email, "owner@example.com");
    assert.equal(owner.role, "owner");
    assert.match(owner.passwordHash, /^scrypt:v1:/u);
    assert.doesNotMatch(owner.passwordHash, /correct-password/u);

    const source = await readFile(path.join(auth.dataRoot, "users", "owner@example.com.json"), "utf8");
    assert.match(source, /owner@example\.com/u);
    assert.doesNotMatch(source, /correct-password/u);

    const login = await auth.users.authenticate({
      email: "owner@example.com",
      password: "correct-password"
    });
    assert.equal(login.ok, true);

    const session = await auth.sessions.createSession(login.user);
    const requestState = await auth.stateForRequest({
      headers: {
        cookie: `vibe64_session=${encodeURIComponent(session.cookieValue)}`
      }
    });
    assert.equal(requestState.authenticated, true);
    assert.equal(requestState.user.email, "owner@example.com");
    assert.match(requestState.user.gravatarUrl, /^https:\/\/www\.gravatar\.com\/avatar\//u);
  });
});

test("Vibe64 auth invite claim keeps identity fixed", async () => {
  await withAuth(async (auth) => {
    await auth.users.setupOwner({
      email: "owner@example.com",
      password: "owner-password",
      passwordConfirmation: "owner-password"
    });

    const invited = await auth.users.inviteUser({
      email: "Friend@Example.com"
    });
    assert.equal(invited.email, "friend@example.com");
    assert.equal(invited.passwordHash, "");

    const pendingLogin = await auth.users.authenticate({
      email: "friend@example.com",
      password: "anything"
    });
    assert.equal(pendingLogin.ok, false);
    assert.equal(pendingLogin.claimRequired, true);
    assert.equal(pendingLogin.email, "friend@example.com");

    await assert.rejects(
      () => auth.users.claimInvite({
        email: "other@example.com",
        password: "friend-password",
        passwordConfirmation: "friend-password"
      }),
      /Invited user was not found/u
    );

    const claimed = await auth.users.claimInvite({
      email: "friend@example.com",
      password: "friend-password",
      passwordConfirmation: "friend-password"
    });
    assert.equal(claimed.email, "friend@example.com");
    assert.match(claimed.passwordHash, /^scrypt:v1:/u);

    const login = await auth.users.authenticate({
      email: "friend@example.com",
      password: "friend-password"
    });
    assert.equal(login.ok, true);
  });
});

test("Vibe64 auth password change requires the old password", async () => {
  await withAuth(async (auth) => {
    await auth.users.setupOwner({
      email: "owner@example.com",
      password: "owner-password",
      passwordConfirmation: "owner-password"
    });

    await assert.rejects(
      () => auth.users.changePassword("owner@example.com", {
        oldPassword: "wrong-password",
        password: "new-password",
        passwordConfirmation: "new-password"
      }),
      /Old password is incorrect/u
    );

    await auth.users.changePassword("owner@example.com", {
      oldPassword: "owner-password",
      password: "new-password",
      passwordConfirmation: "new-password"
    });

    assert.equal((await auth.users.authenticate({
      email: "owner@example.com",
      password: "owner-password"
    })).ok, false);
    assert.equal((await auth.users.authenticate({
      email: "owner@example.com",
      password: "new-password"
    })).ok, true);
  });
});

async function withAuth(callback) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-auth-"));
  try {
    return await callback(createVibe64Auth({
      dataRoot
    }));
  } finally {
    await rm(dataRoot, {
      force: true,
      recursive: true
    });
  }
}
