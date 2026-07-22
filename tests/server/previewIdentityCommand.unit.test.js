import assert from "node:assert/strict";
import test from "node:test";

import {
  PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  PREVIEW_IDENTITY_SUBJECT_VIEWER
} from "../../packages/vibe64-core/src/server/previewAuth.js";
import {
  createPreviewIdentityCommandRunner,
  normalizePreviewIdentityCommandResponse,
  previewIdentityCommandRequest
} from "../../packages/vibe64-terminals/src/server/previewIdentityCommand.js";

function capability() {
  return {
    command: [".vibe64/bin/preview-identity"],
    identityTypes: ["email", "user-id"],
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
    runtimes: ["node26"],
    viewerIdentityTypes: ["email"]
  };
}

test("preview identity command request keeps the app-selected viewer subject structured", () => {
  const request = previewIdentityCommandRequest({
    operation: "login-as",
    subject: {
      displayName: "Ada",
      identifiers: [
        {
          type: "email",
          value: "ADA@EXAMPLE.COM"
        }
      ],
      kind: PREVIEW_IDENTITY_SUBJECT_VIEWER
    }
  }, {
    requestId: "request-1",
    targetHref: "http://127.0.0.1:4100/home"
  });

  assert.deepEqual(request, {
    operation: "login-as",
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
    requestId: "request-1",
    subject: {
      displayName: "Ada",
      identifiers: [
        {
          type: "email",
          value: "ada@example.com"
        }
      ],
      kind: PREVIEW_IDENTITY_SUBJECT_VIEWER
    },
    target: {
      href: "http://127.0.0.1:4100/home",
      origin: "http://127.0.0.1:4100"
    }
  });
});

test("preview identity command runner invokes the app directly with bounded managed execution", async () => {
  let invocation;
  const runner = createPreviewIdentityCommandRunner({
    allowedRoots: ["/workspace/app"],
    capability: capability(),
    env: {
      APP_DATABASE_URL: "managed-database",
      VIBE64_PREVIEW_IDENTITY_SECRET: "private-secret"
    },
    project: {
      targetRoot: "/workspace/app"
    },
    runCommand: async (input) => {
      invocation = input;
      const request = JSON.parse(input.input);
      return {
        ok: true,
        stdout: JSON.stringify({
          identity: {
            displayName: "Ada",
            email: "ada@example.com",
            userId: "42"
          },
          ok: true,
          protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
          requestId: request.requestId,
          setCookie: ["app_session=native-session; Path=/; HttpOnly; SameSite=Lax"],
          signedOut: false
        })
      };
    },
    session: {
      sessionId: "session-1"
    },
    sourceRoot: "/workspace/app",
    targetHref: "http://127.0.0.1:4100/home"
  });
  const result = await runner({
    operation: "login-as",
    selector: {
      type: "email",
      value: "ada@example.com"
    }
  });

  assert.equal(invocation.actor, "app");
  assert.equal(invocation.command, "/workspace/app/.vibe64/bin/preview-identity");
  assert.deepEqual(invocation.args, []);
  assert.equal(invocation.cwd, "/workspace/app");
  assert.equal(invocation.envPolicy, "preview");
  assert.equal(invocation.mode, "capture");
  assert.equal(invocation.purpose, "preview");
  assert.deepEqual(invocation.runtimes, ["node26"]);
  assert.equal(invocation.env.APP_DATABASE_URL, "managed-database");
  assert.equal(result.identity.userId, "42");
  assert.deepEqual(result.setCookie, [
    "app_session=native-session; Path=/; HttpOnly; SameSite=Lax"
  ]);
});

test("preview identity command response rejects cross-origin and preview-token cookies", () => {
  for (const cookie of [
    "app_session=value; Domain=example.com; Path=/",
    "vibe64_preview_token_443=forged; Path=/",
    "missing_value"
  ]) {
    assert.throws(() => normalizePreviewIdentityCommandResponse({
      identity: {
        email: "ada@example.com"
      },
      ok: true,
      protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
      requestId: "request-1",
      setCookie: [cookie]
    }, {
      operation: "login-as",
      requestId: "request-1"
    }), /invalid cookie/u);
  }
});

test("preview identity command response requires a cookie array", () => {
  assert.throws(() => normalizePreviewIdentityCommandResponse({
    identity: {
      email: "ada@example.com"
    },
    ok: true,
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
    requestId: "request-1",
    setCookie: "app_session=native-session"
  }, {
    operation: "login-as",
    requestId: "request-1"
  }), /invalid cookies/u);
});

test("preview identity command response preserves structured application failures", () => {
  assert.deepEqual(normalizePreviewIdentityCommandResponse({
    code: "user_not_found",
    error: "User not found.",
    ok: false,
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
    requestId: "request-1",
    setCookie: ["app_session=; Max-Age=0; Path=/"],
    signedOut: true,
    statusCode: 404
  }, {
    operation: "login-as",
    requestId: "request-1"
  }), {
    code: "user_not_found",
    error: "User not found.",
    ok: false,
    setCookie: ["app_session=; Max-Age=0; Path=/"],
    signedOut: true,
    statusCode: 404
  });
});
