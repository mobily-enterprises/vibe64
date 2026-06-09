import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVibe64Auth,
  registerVibe64AuthGate,
  registerVibe64AuthRoutes,
  resolveSupabaseConfig
} from "../../server/lib/auth/index.js";
import {
  testReply
} from "./vibe64RouteTestHelpers.js";

const FAKE_SUPABASE_ENV = Object.freeze({
  VIBE64_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  VIBE64_SUPABASE_SECRET_KEY: "sb_secret_test",
  VIBE64_SUPABASE_URL: "https://example.supabase.co"
});

test("Vibe64 auth binds the first Supabase identity as owner", async () => {
  await withAuth(async (auth) => {
    const state = await auth.stateForRequest({});
    assert.equal(state.firstLoginCodexSetupPending, true);
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

    const source = await readFile(path.join(auth.dataRoot, "users", "supabase-owner.json"), "utf8");
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
    assert.equal(requestState.firstLoginCodexSetupPending, true);
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

test("Vibe64 auth tracks first-login Codex setup in tenant-local state", async () => {
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    const session = await auth.sessions.createSession(owner);
    const request = {
      headers: {
        cookie: `vibe64_session=${encodeURIComponent(session.cookieValue)}`
      }
    };

    const before = await auth.stateForRequest(request);
    assert.equal(before.firstLoginCodexSetupPending, true);

    const setupState = await auth.setup.markFirstLoginCodexSetupComplete();
    assert.notEqual(setupState.firstLoginCodexCompletedAt, "");

    const after = await auth.stateForRequest(request);
    assert.equal(after.firstLoginCodexSetupPending, false);
  });
});

test("Vibe64 auth route only completes first-login Codex setup after Codex is connected", async () => {
  let codexConnected = false;
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    const session = await auth.sessions.createSession(owner);
    const routes = [];
    const app = {
      get(pathname, handler) {
        routes.push({
          handler,
          method: "GET",
          pathname
        });
      },
      post(pathname, handler) {
        routes.push({
          handler,
          method: "POST",
          pathname
        });
      }
    };
    registerVibe64AuthRoutes(app, auth);

    const route = routes.find((candidate) => (
      candidate.method === "POST" &&
      candidate.pathname === "/api/auth/setup/codex-complete"
    ));
    assert.ok(route);
    const request = {
      headers: {
        cookie: `vibe64_session=${encodeURIComponent(session.cookieValue)}`
      }
    };

    const blockedReply = testReply();
    await route.handler(request, blockedReply);
    assert.equal(blockedReply.statusCode, 409);
    assert.equal(blockedReply.payload.code, "vibe64_codex_setup_incomplete");

    codexConnected = true;
    const successReply = testReply();
    const returned = await route.handler(request, successReply);
    const response = successReply.payload || returned;
    assert.equal(response.ok, true);
    assert.equal(response.firstLoginCodexSetupPending, false);
    const after = await auth.stateForRequest(request);
    assert.equal(after.firstLoginCodexSetupPending, false);
  }, {
    codexConnectedVerifier: async () => ({
      connected: codexConnected,
      ok: true
    })
  });
});

test("Vibe64 auth has no hardcoded Supabase fallback", () => {
  const missing = resolveSupabaseConfig({
    env: {}
  });
  assert.equal(missing.configured, false);
  assert.equal(missing.adminConfigured, false);
  assert.equal(missing.url, "");
  assert.equal(missing.publishableKey, "");
  assert.equal(missing.secretKey, "");

  const configured = resolveSupabaseConfig({
    env: FAKE_SUPABASE_ENV
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.adminConfigured, true);
  assert.equal(configured.url, "https://example.supabase.co");
  assert.equal(configured.publishableKey, "sb_publishable_test");
  assert.equal(configured.secretKey, "sb_secret_test");
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
      () => readFile(path.join(auth.dataRoot, "users", "friend@example.com.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
    const acceptedSource = await readFile(path.join(auth.dataRoot, "users", "supabase-friend.json"), "utf8");
    assert.match(acceptedSource, /friend@example\.com/u);

    await assert.rejects(
      () => auth.authenticateSupabaseSession({
        accessToken: "friend-mismatch-token"
      }),
      /already linked/u
    );
  });
});

test("Vibe64 auth ignores accepted users stored under email filenames", async () => {
  await withAuth(async (auth) => {
    await writeUserRecord(auth, {
      acceptedAt: "2026-06-06T00:00:00.000Z",
      createdAt: "2026-06-06T00:00:00.000Z",
      email: "owner@example.com",
      role: "owner",
      status: "active",
      supabaseUserId: "supabase-owner",
      updatedAt: "2026-06-06T00:00:00.000Z",
      version: 2
    });

    const users = await auth.users.listUsers();
    assert.deepEqual(users, []);

    const state = await auth.stateForRequest({});
    assert.equal(state.setupRequired, true);

    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    assert.equal(owner.role, "owner");
    assert.equal(owner.supabaseUserId, "supabase-owner");
    const source = await readFile(path.join(auth.dataRoot, "users", "supabase-owner.json"), "utf8");
    assert.match(source, /owner@example\.com/u);
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
    assert.equal(await auth.users.readUser("friend@example.com"), null);
    await assert.rejects(
      () => auth.authenticateSupabaseSession({
        accessToken: "friend-token"
      }),
      /not invited/u
    );

    const reinvited = await auth.users.inviteUser({
      email: "friend@example.com"
    });
    assert.equal(reinvited.status, "invited");
    assert.equal(reinvited.supabaseUserId, "");
    const activeFriend = await auth.authenticateSupabaseSession({
      accessToken: "friend-token"
    });
    const friendSession = await auth.sessions.createSession(activeFriend);

    await auth.users.revokeUser({
      email: "friend@example.com"
    }, owner);
    assert.equal(await auth.users.readUser("friend@example.com"), null);
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
      /not invited/u
    );

    const reinvitedRevokedUser = await auth.users.inviteUser({
      email: "friend@example.com"
    });
    assert.equal(reinvitedRevokedUser.status, "invited");
    assert.equal(reinvitedRevokedUser.supabaseUserId, "");

    const reacceptedFriend = await auth.authenticateSupabaseSession({
      accessToken: "friend-token"
    });
    assert.equal(reacceptedFriend.status, "active");
    assert.equal(reacceptedFriend.supabaseUserId, "supabase-friend");
  });
});

test("Vibe64 auth enforces tenant user capacity and stores GitHub identity", async () => {
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    const linkedOwner = await auth.users.updateGithubIdentity({
      email: owner.email
    }, {
      avatarUrl: "https://github.com/octocat.png",
      id: 123,
      login: "octocat"
    });
    assert.equal(linkedOwner.github.login, "octocat");
    assert.equal(auth.users.publicUser(linkedOwner).github.login, "octocat");

    for (let index = 1; index < auth.users.userLimit; index += 1) {
      await auth.users.inviteUser({
        email: `user-${index}@example.com`
      });
    }

    await assert.rejects(
      () => auth.users.inviteUser({
        email: "overflow@example.com"
      }),
      {
        code: "vibe64_tenant_user_limit_reached"
      }
    );
  });
});

test("Vibe64 auth gate blocks protected APIs until GitHub is connected", async () => {
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    const session = await auth.sessions.createSession(owner);
    const hook = registerAuthGateTestHook(auth, {
      accountService: {
        async getStatus(input = {}) {
          assert.equal(input.vibe64User.email, "owner@example.com");
          return {
            accounts: [
              {
                connected: false,
                id: "github",
                message: "Reconnect GitHub to continue.",
                required: true
              }
            ],
            ok: true,
            ready: false
          };
        }
      }
    });

    const reply = testReply();
    await hook({
      headers: sessionCookieHeader(session),
      method: "GET",
      url: "/api/app/beepollen/session"
    }, reply);

    assert.equal(reply.statusCode, 403);
    assert.equal(reply.payload.ok, false);
    assert.equal(reply.payload.code, "vibe64_github_required");
    assert.equal(reply.payload.error, "Reconnect GitHub to continue.");
  });
});

test("Vibe64 auth gate allows account setup APIs before GitHub is connected", async () => {
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    const session = await auth.sessions.createSession(owner);
    const hook = registerAuthGateTestHook(auth, {
      accountService: {
        async getStatus() {
          throw new Error("GitHub gate should not run for account setup routes.");
        }
      }
    });

    const request = {
      headers: sessionCookieHeader(session),
      method: "GET",
      url: "/api/vibe64/accounts"
    };
    const reply = testReply();
    await hook(request, reply);

    assert.equal(reply.statusCode, null);
    assert.equal(reply.payload, null);
    assert.equal(request.vibe64User.email, "owner@example.com");
  });
});

test("Vibe64 auth gate applies GitHub readiness to tenant management APIs", async () => {
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    const session = await auth.sessions.createSession(owner);
    const hook = registerAuthGateTestHook(auth, {
      accountService: {
        async getStatus() {
          return {
            accounts: [
              {
                connected: false,
                id: "github",
                message: "Connect GitHub before using Vibe64.",
                required: true
              }
            ],
            ok: true,
            ready: false
          };
        }
      }
    });

    const reply = testReply();
    await hook({
      headers: sessionCookieHeader(session),
      method: "POST",
      url: "/api/auth/invite"
    }, reply);

    assert.equal(reply.statusCode, 403);
    assert.equal(reply.payload.code, "vibe64_github_required");
  });
});

test("Vibe64 auth gate allows protected APIs after GitHub is connected", async () => {
  await withAuth(async (auth) => {
    const owner = await auth.authenticateSupabaseSession({
      accessToken: "owner-token"
    });
    const session = await auth.sessions.createSession(owner);
    const hook = registerAuthGateTestHook(auth, {
      accountService: {
        async getStatus() {
          return {
            accounts: [
              {
                connected: true,
                id: "github",
                required: true
              }
            ],
            ok: true,
            ready: true
          };
        }
      }
    });

    const request = {
      headers: sessionCookieHeader(session),
      method: "GET",
      url: "/api/app/beepollen/session"
    };
    const reply = testReply();
    await hook(request, reply);

    assert.equal(reply.statusCode, null);
    assert.equal(reply.payload, null);
    assert.equal(request.vibe64User.email, "owner@example.com");
  });
});

async function withAuth(callback, options = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-auth-"));
  try {
    return await callback(createVibe64Auth({
      codexConnectedVerifier: options.codexConnectedVerifier,
      dataRoot,
      env: FAKE_SUPABASE_ENV,
      verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
    }));
  } finally {
    await rm(dataRoot, {
      force: true,
      recursive: true
    });
  }
}

function registerAuthGateTestHook(auth, options = {}) {
  const hooks = [];
  registerVibe64AuthGate({
    addHook(name, handler) {
      assert.equal(name, "preHandler");
      hooks.push(handler);
    }
  }, auth, options);
  assert.equal(hooks.length, 1);
  return hooks[0];
}

function sessionCookieHeader(session = {}) {
  return {
    cookie: `vibe64_session=${encodeURIComponent(session.cookieValue)}`
  };
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
