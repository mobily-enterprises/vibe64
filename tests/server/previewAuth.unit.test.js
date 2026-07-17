import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_PREVIEW_AUTH_KIND,
  APPLICATION_PREVIEW_IDENTITY_ENABLED_ENV,
  APPLICATION_PREVIEW_IDENTITY_PATH,
  APPLICATION_PREVIEW_IDENTITY_SECRET_ENV,
  APPLICATION_PREVIEW_IDENTITY_SECRET_HEADER,
  JSKIT_PREVIEW_AUTH_KIND,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_USER_ID,
  createPreviewAuthSecret,
  createPreviewIdentityGrant,
  normalizePreviewIdentitySelection,
  previewAuthEnvironment,
  previewAuthIdentityExchange,
  previewAuthIdentityTypes,
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
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: " ADA@EXAMPLE.COM "
    }
  }), {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
  });
  assert.deepEqual(normalizePreviewIdentitySelection({
    operation: PREVIEW_IDENTITY_LOGOUT_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ignored@example.com"
    }
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
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
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
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
  });
});

test("preview identity grants reject tampering, expiry, and scope mismatch", () => {
  const previewAuth = previewAuthFixture();
  const grant = createPreviewIdentityGrant(previewAuth, {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
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
        operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
        selector: {
          type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
          value: "ada@example.com"
        }
      }),
      /scope is incomplete/u
    );
  }
});

test("JSKIT identity exchange owns fixed upstream paths and the private header", () => {
  const previewAuth = previewAuthFixture();
  assert.deepEqual(previewAuthIdentityExchange(previewAuth, {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
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

test("preview auth providers advertise only the identifier types they support", () => {
  assert.deepEqual(previewAuthIdentityTypes({
    kind: JSKIT_PREVIEW_AUTH_KIND
  }), [
    PREVIEW_IDENTITY_SELECTOR_EMAIL,
    PREVIEW_IDENTITY_SELECTOR_USER_ID
  ]);
  assert.deepEqual(previewAuthIdentityTypes({
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_LOGIN],
    kind: APPLICATION_PREVIEW_AUTH_KIND
  }), [PREVIEW_IDENTITY_SELECTOR_LOGIN]);
  assert.throws(() => previewAuthIdentityExchange(previewAuthFixture(), {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_LOGIN,
      value: "merc"
    }
  }), /does not support that application user identifier/u);
});

test("generic application preview auth uses a typed secret-protected exchange", () => {
  const previewAuth = previewAuthFixture({
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_LOGIN],
    kind: APPLICATION_PREVIEW_AUTH_KIND
  });
  assert.deepEqual(previewAuthEnvironment({
    kind: APPLICATION_PREVIEW_AUTH_KIND,
    secret: previewAuth.secret
  }), {
    [APPLICATION_PREVIEW_IDENTITY_ENABLED_ENV]: "true",
    [APPLICATION_PREVIEW_IDENTITY_SECRET_ENV]: previewAuth.secret
  });
  assert.deepEqual(previewAuthIdentityExchange(previewAuth, {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_LOGIN,
      value: "merc"
    }
  }), {
    before: [
      {
        body: {
          operation: PREVIEW_IDENTITY_LOGOUT_OPERATION
        },
        headers: {
          [APPLICATION_PREVIEW_IDENTITY_SECRET_HEADER]: previewAuth.secret
        },
        method: "POST",
        path: APPLICATION_PREVIEW_IDENTITY_PATH
      }
    ],
    body: {
      operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
      selector: {
        type: PREVIEW_IDENTITY_SELECTOR_LOGIN,
        value: "merc"
      }
    },
    headers: {
      [APPLICATION_PREVIEW_IDENTITY_SECRET_HEADER]: previewAuth.secret
    },
    method: "POST",
    path: APPLICATION_PREVIEW_IDENTITY_PATH
  });
});
