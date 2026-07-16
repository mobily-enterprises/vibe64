import assert from "node:assert/strict";
import test from "node:test";

import {
  JSKIT_PREVIEW_AUTH_KIND,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  createPreviewAuthSecret,
  createPreviewIdentityGrant,
  normalizePreviewIdentitySelection,
  previewAuthEnvironment,
  previewAuthIdentityExchange,
  verifyPreviewIdentityGrant
} from "../../packages/vibe64-core/src/server/previewAuth.js";

function previewAuthFixture(overrides = {}) {
  return {
    kind: JSKIT_PREVIEW_AUTH_KIND,
    projectScope: "project:preview-auth-test",
    secret: "b".repeat(64),
    sessionId: "session-preview-auth-test",
    targetHref: "http://127.0.0.1:4102/home",
    targetRoot: "/tmp/preview-auth-test",
    terminalSessionId: "terminal-preview-auth-test",
    ...overrides
  };
}

test("JSKIT preview auth environment contains a random private exchange secret", () => {
  const secret = createPreviewAuthSecret();
  const env = previewAuthEnvironment({
    kind: JSKIT_PREVIEW_AUTH_KIND,
    secret
  });

  assert.match(secret, /^[a-f0-9]{64}$/u);
  assert.equal(env.AUTH_DEV_BYPASS_ENABLED, "true");
  assert.equal(env.AUTH_DEV_BYPASS_SECRET, secret);
  assert.equal(env.AUTH_DEV_ACCESS_TTL_SECONDS, "3600");
  assert.equal(env.AUTH_DEV_REFRESH_TTL_SECONDS, "43200");
});

test("preview identity selections normalize login and logout operations", () => {
  assert.deepEqual(normalizePreviewIdentitySelection({
    email: " ADA@EXAMPLE.COM ",
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION
  }), {
    email: "ada@example.com",
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION
  });
  assert.deepEqual(normalizePreviewIdentitySelection({
    email: "ignored@example.com",
    operation: PREVIEW_IDENTITY_LOGOUT_OPERATION
  }), {
    operation: PREVIEW_IDENTITY_LOGOUT_OPERATION
  });
  assert.throws(
    () => normalizePreviewIdentitySelection({ operation: "arbitrary" }),
    /operation is invalid/u
  );
});

test("preview identity grants verify once scoped data remains unchanged", () => {
  const previewAuth = previewAuthFixture();
  const grant = createPreviewIdentityGrant(previewAuth, {
    email: "ada@example.com",
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION
  }, {
    nowSeconds: 100,
    ttlSeconds: 30
  });

  const verified = verifyPreviewIdentityGrant(grant, previewAuth, {
    nowSeconds: 110
  });
  assert.equal(verified.expiresAt, 130);
  assert.match(verified.nonce, /^[A-Za-z0-9_-]+$/u);
  assert.deepEqual(verified.selection, {
    email: "ada@example.com",
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION
  });
});

test("preview identity grants reject tampering, expiry, and scope mismatch", () => {
  const previewAuth = previewAuthFixture();
  const grant = createPreviewIdentityGrant(previewAuth, {
    email: "ada@example.com",
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION
  }, {
    nowSeconds: 100,
    ttlSeconds: 10
  });
  const tampered = `${grant.slice(0, -1)}${grant.endsWith("a") ? "b" : "a"}`;

  assert.throws(
    () => verifyPreviewIdentityGrant(tampered, previewAuth, { nowSeconds: 105 }),
    /grant is invalid/u
  );
  assert.throws(
    () => verifyPreviewIdentityGrant(grant, previewAuth, { nowSeconds: 110 }),
    /grant has expired/u
  );
  assert.throws(
    () => verifyPreviewIdentityGrant(grant, previewAuthFixture({
      terminalSessionId: "another-terminal"
    }), { nowSeconds: 105 }),
    /does not belong to this preview/u
  );
});

test("preview identity grants require every project, session, target, and terminal scope field", () => {
  for (const field of [
    "projectScope",
    "sessionId",
    "targetHref",
    "targetRoot",
    "terminalSessionId"
  ]) {
    assert.throws(
      () => createPreviewIdentityGrant(previewAuthFixture({ [field]: "" }), {
        email: "ada@example.com",
        operation: PREVIEW_IDENTITY_LOGIN_OPERATION
      }),
      /scope is incomplete/u
    );
  }
});

test("JSKIT identity exchange owns fixed upstream paths and the private header", () => {
  const previewAuth = previewAuthFixture();
  assert.deepEqual(previewAuthIdentityExchange(previewAuth, {
    email: "ada@example.com",
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION
  }), {
    before: [
      {
        body: {},
        method: "POST",
        path: "/api/logout"
      }
    ],
    body: {
      email: "ada@example.com"
    },
    headers: {
      "x-jskit-dev-auth-secret": previewAuth.secret
    },
    method: "POST",
    path: "/api/dev-auth/login-as"
  });
});
