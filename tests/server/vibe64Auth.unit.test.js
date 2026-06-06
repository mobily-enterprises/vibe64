import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVibe64Auth
} from "../../server/lib/auth/index.js";

test("Vibe64 auth binds the first Supabase identity as owner", async () => {
  await withAuth(async (auth) => {
    const state = await auth.stateForRequest({});
    assert.equal(state.ownerInvitePending, false);
    assert.equal(state.setupRequired, true);
    assert.equal(state.supabase.configured, true);

    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    assert.equal(owner.email, "owner@example.com");
    assert.equal(owner.role, "owner");
    assert.equal(owner.status, "active");
    assert.equal(owner.supabaseUserId, "supabase-owner");

    const source = await readFile(path.join(auth.dataRoot, "users", "owner@example.com.json"), "utf8");
    assert.match(source, /owner@example\.com/u);
    assert.match(source, /supabase-owner/u);
    assert.doesNotMatch(source, /passwordHash|owner-password|scrypt/u);

    const session = await auth.sessions.createSession(owner);
    const requestState = await auth.stateForRequest({
      headers: {
        cookie: `vibe64_session=${encodeURIComponent(session.cookieValue)}`
      }
    });
    assert.equal(requestState.authenticated, true);
    assert.equal(requestState.setupRequired, false);
    assert.equal(requestState.user.email, "owner@example.com");
    assert.equal(requestState.user.identityLinked, true);
    assert.match(requestState.user.gravatarUrl, /^https:\/\/www\.gravatar\.com\/avatar\//u);

    const legacySession = await auth.sessions.createSession({
      email: "owner@example.com"
    });
    const legacyState = await auth.stateForRequest({
      headers: {
        cookie: `vibe64_session=${encodeURIComponent(legacySession.cookieValue)}`
      }
    });
    assert.equal(legacyState.authenticated, false);
  });
});

test("Vibe64 auth reports pending owner invite setup separately", async () => {
  await withAuth(async (auth) => {
    await writeUserRecord(auth, {
      createdAt: "2026-06-06T00:00:00.000Z",
      email: "owner@example.com",
      invitedAt: "2026-06-06T00:00:00.000Z",
      role: "owner",
      status: "invited",
      updatedAt: "2026-06-06T00:00:00.000Z",
      version: 2
    });

    const state = await auth.stateForRequest({});
    assert.equal(state.setupRequired, false);
    assert.equal(state.ownerInvitePending, true);

    await assert.rejects(
      () => auth.authenticateSupabaseSession({
        accessToken: "friend-token"
      }),
      /not invited/u
    );

    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    assert.equal(owner.email, "owner@example.com");
    assert.equal(owner.role, "owner");
    assert.equal(owner.status, "active");
    assert.equal(owner.supabaseUserId, "supabase-owner");

    const acceptedState = await auth.stateForRequest({});
    assert.equal(acceptedState.ownerInvitePending, false);
  });
});

test("Vibe64 auth invite acceptance keeps identity fixed", async () => {
  await withAuth(async (auth) => {
    await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });

    const invited = await auth.users.inviteUser({
      email: "Friend@Example.com"
    });
    assert.equal(invited.email, "friend@example.com");
    assert.equal(invited.status, "invited");
    assert.equal(invited.supabaseUserId, "");

    await assert.rejects(
      () => auth.authenticateSupabaseSession({
        accessToken: "other-token"
      }),
      /not invited/u
    );

    const accepted = await auth.authenticateSupabaseSession({
      accessToken: "friend-token"
    });
    assert.equal(accepted.email, "friend@example.com");
    assert.equal(accepted.status, "active");
    assert.equal(accepted.supabaseUserId, "supabase-friend");

    await assert.rejects(
      () => auth.authenticateSupabaseSession({
        accessToken: "friend-mismatch-token"
      }),
      /already linked/u
    );
  });
});

test("Vibe64 auth supports canceling invites and revoking active users", async () => {
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });

    await auth.users.inviteUser({
      email: "friend@example.com"
    });
    const canceledInvite = await auth.users.cancelInvite({
      email: "friend@example.com"
    });
    assert.equal(canceledInvite.status, "canceled");
    assert.notEqual(canceledInvite.canceledAt, "");
    await assert.rejects(
      () => auth.authenticateSupabaseSession({
        accessToken: "friend-token"
      }),
      /canceled/u
    );

    const reinvited = await auth.users.inviteUser({
      email: "friend@example.com"
    });
    assert.equal(reinvited.status, "invited");
    assert.equal(reinvited.canceledAt, "");
    assert.equal(reinvited.supabaseUserId, "");
    const activeFriend = await auth.authenticateSupabaseSession({
      accessToken: "friend-token"
    });
    const friendSession = await auth.sessions.createSession(activeFriend);

    await auth.users.revokeUser({
      email: "friend@example.com"
    }, owner);
    await auth.sessions.destroySessionsForUser({
      email: activeFriend.email,
      supabaseUserId: activeFriend.supabaseUserId
    });

    const requestState = await auth.stateForRequest({
      headers: {
        cookie: `vibe64_session=${encodeURIComponent(friendSession.cookieValue)}`
      }
    });
    assert.equal(requestState.authenticated, false);
    await assert.rejects(
      () => auth.authenticateSupabaseSession({
        accessToken: "friend-token"
      }),
      /removed/u
    );

    const reinvitedRevokedUser = await auth.users.inviteUser({
      email: "friend@example.com"
    });
    assert.equal(reinvitedRevokedUser.status, "invited");
    assert.equal(reinvitedRevokedUser.acceptedAt, "");
    assert.equal(reinvitedRevokedUser.revokedAt, "");
    assert.equal(reinvitedRevokedUser.supabaseUserId, "");

    const reacceptedFriend = await auth.authenticateSupabaseSession({
      accessToken: "friend-token"
    });
    assert.equal(reacceptedFriend.status, "active");
    assert.equal(reacceptedFriend.supabaseUserId, "supabase-friend");
  });
});

async function withAuth(callback) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-auth-"));
  try {
    return await callback(createVibe64Auth({
      dataRoot,
      verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
    }));
  } finally {
    await rm(dataRoot, {
      force: true,
      recursive: true
    });
  }
}

async function writeUserRecord(auth, record = {}) {
  const usersRoot = path.join(auth.dataRoot, "users");
  await mkdir(usersRoot, {
    recursive: true
  });
  await writeFile(
    path.join(usersRoot, `${String(record.email || "").trim().toLowerCase()}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
}

async function fakeVerifySupabaseAccessToken(token = "") {
  const identities = {
    "friend-mismatch-token": {
      email: "friend@example.com",
      id: "supabase-other-friend"
    },
    "friend-token": {
      email: "friend@example.com",
      id: "supabase-friend"
    },
    "other-token": {
      email: "other@example.com",
      id: "supabase-other"
    },
    "owner-token": {
      email: "owner@example.com",
      id: "supabase-owner"
    }
  };
  const identity = identities[token];
  if (!identity) {
    const error = new Error("Unknown token.");
    error.code = "vibe64_supabase_user_verification_failed";
    throw error;
  }
  return identity;
}
