import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";

import {
  PREVIEW_BRIDGE_MESSAGE_TYPE,
  PREVIEW_QUERY_MESSAGE_TYPE,
  PREVIEW_READY_MESSAGE_TYPE
} from "../../packages/vibe64-terminals/src/server/launchPreviewBridge.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  PREVIEW_PROXY_PORT_END_ENV,
  PREVIEW_PROXY_PORT_START_ENV
} from "../../packages/vibe64-core/src/server/launchPreviewProxyEnv.js";
import {
  COOKIE_PROFILE_PREVIEW_AUTH_KIND
} from "../../packages/vibe64-core/src/server/previewAuth.js";
import {
  PREVIEW_PROXY_PORT_END,
  PREVIEW_PROXY_PORT_START,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  appendPreviewTokenQueryParam,
  createLaunchPreviewProxyRegistry,
  injectLaunchPreviewBridge,
  normalizePreviewTargetHref,
  previewPublicSocketPath,
  previewTokenCookieName,
  proxiedLocation,
  stripPreviewTokenQueryParam
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";

test("launch preview bridge injects once and reports target URLs", () => {
  const html = "<!doctype html><html><head><title>App</title></head><body></body></html>";
  const injected = injectLaunchPreviewBridge(html, {
    targetOrigin: "http://127.0.0.1:4103"
  });

  assert.match(injected, /data-vibe64-preview-bridge="1"/u);
  assert.match(injected, new RegExp(PREVIEW_BRIDGE_MESSAGE_TYPE, "u"));
  assert.match(injected, new RegExp(PREVIEW_QUERY_MESSAGE_TYPE, "u"));
  assert.match(injected, new RegExp(PREVIEW_READY_MESSAGE_TYPE, "u"));
  assert.match(injected, /MutationObserver/u);
  assert.match(injected, /force: true/u);
  assert.match(injected, /http:\/\/127\.0\.0\.1:4103/u);
  assert.equal(injectLaunchPreviewBridge(injected), injected);
});

test("launch preview target URLs are constrained to loopback HTTP origins", () => {
  assert.equal(
    normalizePreviewTargetHref("http://127.0.0.1:4103/home").toString(),
    "http://127.0.0.1:4103/home"
  );
  assert.equal(
    normalizePreviewTargetHref("http://vibe64-launch-abcdef123456:4103/home").toString(),
    "http://vibe64-launch-abcdef123456:4103/home"
  );
  assert.throws(() => normalizePreviewTargetHref("file:///tmp/index.html"), /must use HTTP/u);
  assert.throws(() => normalizePreviewTargetHref("https://example.com"), /must be loopback/u);
  assert.throws(() => normalizePreviewTargetHref("http://vibe64-launch-notvalid:4103/home"), /must be loopback/u);
});

test("launch preview proxy injects HTML and proxies app-relative requests", async () => {
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure("session-1", `${target.origin}/home?mode=dev`);

      assert.equal(preview.available, true);
      assert.equal(preview.targetHref, `${target.origin}/home?mode=dev`);
      const previewUrl = new URL(preview.href);
      assert.equal(previewUrl.hostname, "127.0.0.1");
      assert.ok(Number(previewUrl.port) >= PREVIEW_PROXY_PORT_START);
      assert.ok(Number(previewUrl.port) <= PREVIEW_PROXY_PORT_END);
      assert.equal(previewUrl.pathname, "/home");
      assert.equal(previewUrl.searchParams.get("mode"), "dev");
      assert.ok(previewUrl.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM));

      const missingToken = new URL(preview.href);
      missingToken.searchParams.delete(PREVIEW_PROXY_TOKEN_QUERY_PARAM);
      const missingTokenResponse = await fetch(missingToken);
      assert.equal(missingTokenResponse.status, 403);

      const wrongToken = new URL(preview.href);
      wrongToken.searchParams.set(PREVIEW_PROXY_TOKEN_QUERY_PARAM, "wrong-token");
      const wrongTokenResponse = await fetch(wrongToken);
      assert.equal(wrongTokenResponse.status, 403);

      const htmlResponse = await fetch(preview.href);
      const html = await htmlResponse.text();
      assert.equal(htmlResponse.status, 200);
      assert.match(html, /Target home/u);
      assert.match(html, /data-vibe64-preview-bridge="1"/u);
      assert.match(html, new RegExp(target.origin.replaceAll(".", "\\."), "u"));
      const previewCookieName = previewTokenCookieName(previewUrl.origin);
      const previewCookie = htmlResponse.headers.get("set-cookie");
      assert.match(previewCookie, /target_cookie=target/u);
      assert.match(previewCookie, new RegExp(`${previewCookieName}=`, "u"));

      const apiResponse = await fetch(previewPath(preview.href, "/api/ping"));
      assert.equal(apiResponse.status, 200);
      assert.deepEqual(await apiResponse.json(), {
        ok: true
      });

      const cookieOnlyResponse = await fetch(new URL("/api/ping", previewUrl.origin), {
        headers: {
          Cookie: previewCookiePair(previewCookie, previewCookieName)
        }
      });
      assert.equal(cookieOnlyResponse.status, 200);
      assert.deepEqual(await cookieOnlyResponse.json(), {
        ok: true
      });

      const cookieEchoResponse = await fetch(new URL("/echo-cookie", previewUrl.origin), {
        headers: {
          Cookie: `${previewCookiePair(previewCookie, previewCookieName)}; target_cookie=target`
        }
      });
      assert.equal(cookieEchoResponse.status, 200);
      assert.deepEqual(await cookieEchoResponse.json(), {
        cookie: "target_cookie=target"
      });

      const secondPreview = await registry.ensure("session-2", `${target.origin}/home`);
      assert.notEqual(
        previewTokenCookieName(new URL(secondPreview.href).origin),
        previewCookieName
      );

      const again = await registry.ensure("session-1", `${target.origin}/home?mode=dev`);
      assert.equal(again.href, preview.href);
    } finally {
      await registry.closeAll();
    }
  });
});

test("launch preview proxy uses the configured local port range", async () => {
  const port = await unusedLocalPort();
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry({
      env: {
        [PREVIEW_PROXY_PORT_END_ENV]: String(port),
        [PREVIEW_PROXY_PORT_START_ENV]: String(port)
      }
    });
    try {
      const preview = await registry.ensure("session-range", `${target.origin}/home`);
      const previewUrl = new URL(preview.href);

      assert.equal(previewUrl.port, String(port));
      assert.equal((await fetch(preview.href)).status, 200);
    } finally {
      await registry.closeAll();
    }
  });
});

test("launch preview proxy preserves the canonical target host when using an alternate connect URL", async () => {
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    const canonicalHref = "http://127.0.0.1:4101/home?mode=dev";
    try {
      const preview = await registry.ensure({
        sessionId: "session-alternate-connect",
        targetHref: canonicalHref,
        terminalSessionId: "terminal-alternate-connect"
      }, `${target.origin}/home?mode=dev`);

      assert.equal(preview.available, true);
      assert.equal(preview.targetHref, canonicalHref);

      const response = await fetch(preview.href);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Target home/u);
      assert.equal(target.requests.at(-1)?.host, "127.0.0.1:4101");
    } finally {
      await registry.closeAll();
    }
  });
});

test("launch preview proxy can expose previews through a Caddy-compatible Unix socket origin", async () => {
  const socketDir = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-sockets-"));
  await withTargetServer(async (target) => {
    const publicOrigin = "https://v64preview-abcd1234--tenant.vibe64.dev";
    const registry = createLaunchPreviewProxyRegistry({
      env: {
        VIBE64_PREVIEW_PROXY_SOCKET_DIR: socketDir
      }
    });
    try {
      const preview = await registry.ensure({
        previewPublicOrigin: publicOrigin,
        sessionId: "session-public",
        targetHref: `${target.origin}/home?mode=dev`,
        terminalSessionId: "terminal-public"
      });

      assert.equal(preview.available, true);
      assert.equal(new URL(preview.href).origin, publicOrigin);
      assert.equal(
        previewPublicSocketPath(publicOrigin, {
          VIBE64_PREVIEW_PROXY_SOCKET_DIR: socketDir
        }),
        path.join(socketDir, "v64preview-abcd1234--tenant.sock")
      );

      const response = await requestUnixSocket({
        headers: {
          Host: "v64preview-abcd1234--tenant.vibe64.dev"
        },
        path: `${new URL(preview.href).pathname}${new URL(preview.href).search}`,
        socketPath: path.join(socketDir, "v64preview-abcd1234--tenant.sock")
      });
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /Target home/u);
      assert.match(response.body, /data-vibe64-preview-bridge="1"/u);
    } finally {
      await registry.closeAll();
      await rm(socketDir, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy scopes tokens by project, session, and terminal", async () => {
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const alpha = await runWithProjectRequestContext({
        slug: "alpha_1",
        targetRoot: "/tmp/vibe64/alpha_1"
      }, () => registry.ensure({
        sessionId: "same-session",
        targetHref: `${target.origin}/alpha`,
        terminalSessionId: "same-terminal"
      }));
      const beta = await runWithProjectRequestContext({
        slug: "beta_2",
        targetRoot: "/tmp/vibe64/beta_2"
      }, () => registry.ensure({
        sessionId: "same-session",
        targetHref: `${target.origin}/beta`,
        terminalSessionId: "same-terminal"
      }));

      assert.notEqual(new URL(alpha.href).origin, new URL(beta.href).origin);

      const alphaToken = new URL(alpha.href).searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM);
      const betaWithAlphaToken = new URL(beta.href);
      betaWithAlphaToken.searchParams.set(PREVIEW_PROXY_TOKEN_QUERY_PARAM, alphaToken);

      const wrongScopeResponse = await fetch(betaWithAlphaToken);
      assert.equal(wrongScopeResponse.status, 403);

      const betaResponse = await fetch(beta.href);
      assert.equal(betaResponse.status, 200);
    } finally {
      await registry.closeAll();
    }
  });
});

test("launch preview proxy injects JSKIT preview auth cookies after token validation", async () => {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-auth-profile-"));
  const profilePath = path.join(profileRoot, "profile.json");
  await writeFile(profilePath, JSON.stringify({
    authProvider: "vibe64-preview",
    authProviderUserSid: "vibe64-preview",
    displayName: "Preview Tester",
    email: "preview-tester@example.test",
    id: "42",
    username: "preview-tester"
  }), "utf8");
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        previewAuth: {
          kind: "jskit-dev",
          profilePath,
          sessionId: "session-auth-probe",
          targetHref: `${target.origin}/home`,
          targetRoot: "/tmp/vibe64-preview-project",
          terminalSessionId: "terminal-auth-probe"
        },
        sessionId: "session-auth-probe",
        targetHref: `${target.origin}/home`,
        terminalSessionId: "terminal-auth-probe"
      });

      const response = await fetch(previewPath(preview.href, "/echo-cookie"), {
        headers: {
          Cookie: `${previewTokenCookieName(new URL(preview.href).origin)}=should-be-stripped; target_cookie=target`
        }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.match(payload.cookie, /target_cookie=target/u);
      assert.match(payload.cookie, /sb_access_token=jskit-dev\./u);
      assert.match(payload.cookie, /sb_refresh_token=jskit-dev\./u);
      assert.doesNotMatch(payload.cookie, /vibe64_preview_token/u);
      assert.deepEqual(jskitDevCookiePayload(payload.cookie), {
        aud: "authenticated",
        authProvider: "vibe64-preview",
        authProviderUserSid: "vibe64-preview",
        displayName: "Preview Tester",
        email: "preview-tester@example.test",
        iss: "jskit:dev-auth",
        kind: "access",
        sub: "42",
        username: "preview-tester"
      });
    } finally {
      await registry.closeAll();
      await rm(profileRoot, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy replaces existing JSKIT auth cookies", async () => {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-auth-profile-"));
  const profilePath = path.join(profileRoot, "profile.json");
  await writeFile(profilePath, JSON.stringify({
    authProvider: "vibe64-preview",
    authProviderUserSid: "vibe64-preview",
    displayName: "Preview Tester",
    email: "preview-tester@example.test",
    id: "42",
    username: "preview-tester"
  }), "utf8");
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        previewAuth: {
          kind: "jskit-dev",
          profilePath,
          sessionId: "session-existing-auth",
          targetHref: `${target.origin}/home`,
          targetRoot: "/tmp/vibe64-preview-project",
          terminalSessionId: "terminal-existing-auth"
        },
        sessionId: "session-existing-auth",
        targetHref: `${target.origin}/home`,
        terminalSessionId: "terminal-existing-auth"
      });

      const response = await fetch(previewPath(preview.href, "/echo-cookie"), {
        headers: {
          Cookie: [
            `${previewTokenCookieName(new URL(preview.href).origin)}=should-be-stripped`,
            "target_cookie=target",
            "sb_access_token=real-access",
            "sb_refresh_token=real-refresh"
          ].join("; ")
        }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.match(payload.cookie, /target_cookie=target/u);
      assert.match(payload.cookie, /sb_access_token=jskit-dev\./u);
      assert.match(payload.cookie, /sb_refresh_token=jskit-dev\./u);
      assert.doesNotMatch(payload.cookie, /real-access/u);
      assert.doesNotMatch(payload.cookie, /real-refresh/u);
      assert.doesNotMatch(payload.cookie, /vibe64_preview_token/u);
    } finally {
      await registry.closeAll();
      await rm(profileRoot, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy injects Vibe64 self preview auth cookies", async () => {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-self-preview-auth-profile-"));
  const profilePath = path.join(profileRoot, "profile.json");
  await writeFile(profilePath, JSON.stringify({
    cookieName: "vibe64_session_self",
    cookieValue: "session-id.session-token"
  }), "utf8");
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        previewAuth: {
          kind: "vibe64-self",
          profilePath,
          sessionId: "session-vibe64-self-auth",
          targetHref: `${target.origin}/home`,
          targetRoot: "/tmp/vibe64-preview-self",
          terminalSessionId: "terminal-vibe64-self-auth"
        },
        sessionId: "session-vibe64-self-auth",
        targetHref: `${target.origin}/home`,
        terminalSessionId: "terminal-vibe64-self-auth"
      });

      const response = await fetch(previewPath(preview.href, "/echo-cookie"), {
        headers: {
          Cookie: [
            `${previewTokenCookieName(new URL(preview.href).origin)}=should-be-stripped`,
            "target_cookie=target",
            "vibe64_session_self=stale-session"
          ].join("; ")
        }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.match(payload.cookie, /target_cookie=target/u);
      assert.match(payload.cookie, /vibe64_session_self=session-id\.session-token/u);
      assert.doesNotMatch(payload.cookie, /stale-session/u);
      assert.doesNotMatch(payload.cookie, /vibe64_preview_token/u);
    } finally {
      await registry.closeAll();
      await rm(profileRoot, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy injects adapter cookie-profile preview auth cookies", async () => {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-cookie-preview-auth-profile-"));
  const profilePath = path.join(profileRoot, "profile.json");
  await writeFile(profilePath, JSON.stringify({
    cookies: [
      {
        name: "adapter_session",
        value: "adapter-token"
      },
      {
        name: "adapter_refresh",
        value: "adapter-refresh"
      }
    ]
  }), "utf8");
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        previewAuth: {
          kind: COOKIE_PROFILE_PREVIEW_AUTH_KIND,
          profilePath,
          sessionId: "session-cookie-profile-auth",
          targetHref: `${target.origin}/home`,
          targetRoot: "/tmp/vibe64-preview-cookie-profile",
          terminalSessionId: "terminal-cookie-profile-auth"
        },
        sessionId: "session-cookie-profile-auth",
        targetHref: `${target.origin}/home`,
        terminalSessionId: "terminal-cookie-profile-auth"
      });

      const response = await fetch(previewPath(preview.href, "/echo-cookie"), {
        headers: {
          Cookie: [
            `${previewTokenCookieName(new URL(preview.href).origin)}=should-be-stripped`,
            "target_cookie=target",
            "adapter_session=stale-session"
          ].join("; ")
        }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.match(payload.cookie, /target_cookie=target/u);
      assert.match(payload.cookie, /adapter_session=adapter-token/u);
      assert.match(payload.cookie, /adapter_refresh=adapter-refresh/u);
      assert.doesNotMatch(payload.cookie, /stale-session/u);
      assert.doesNotMatch(payload.cookie, /vibe64_preview_token/u);
    } finally {
      await registry.closeAll();
      await rm(profileRoot, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy replaces existing synthetic JSKIT preview auth cookies", async () => {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-auth-profile-"));
  const profilePath = path.join(profileRoot, "profile.json");
  await writeFile(profilePath, JSON.stringify({
    authProvider: "vibe64-preview",
    authProviderUserSid: "vibe64-preview",
    displayName: "Preview Tester",
    email: "preview-tester@example.test",
    id: "42",
    username: "preview-tester"
  }), "utf8");
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        previewAuth: {
          kind: "jskit-dev",
          profilePath,
          sessionId: "session-replace-preview-auth",
          targetHref: `${target.origin}/home`,
          targetRoot: "/tmp/vibe64-preview-project",
          terminalSessionId: "terminal-replace-preview-auth"
        },
        sessionId: "session-replace-preview-auth",
        targetHref: `${target.origin}/home`,
        terminalSessionId: "terminal-replace-preview-auth"
      });

      const response = await fetch(previewPath(preview.href, "/echo-cookie"), {
        headers: {
          Cookie: [
            `${previewTokenCookieName(new URL(preview.href).origin)}=should-be-stripped`,
            "target_cookie=target",
            "sb_access_token=jskit-dev.stale-access",
            "sb_refresh_token=jskit-dev.stale-refresh"
          ].join("; ")
        }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.match(payload.cookie, /target_cookie=target/u);
      assert.match(payload.cookie, /sb_access_token=jskit-dev\./u);
      assert.match(payload.cookie, /sb_refresh_token=jskit-dev\./u);
      assert.doesNotMatch(payload.cookie, /stale-access/u);
      assert.doesNotMatch(payload.cookie, /stale-refresh/u);
      assert.equal(jskitDevCookiePayload(payload.cookie).email, "preview-tester@example.test");
    } finally {
      await registry.closeAll();
      await rm(profileRoot, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy blocks target JSKIT auth cookies from leaking to the browser", async () => {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-auth-profile-"));
  const profilePath = path.join(profileRoot, "profile.json");
  await writeFile(profilePath, JSON.stringify({
    authProvider: "vibe64-preview",
    authProviderUserSid: "vibe64-preview",
    displayName: "Preview Tester",
    email: "preview-tester@example.test",
    id: "42",
    username: "preview-tester"
  }), "utf8");
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        previewAuth: {
          kind: "jskit-dev",
          profilePath,
          sessionId: "session-filter-set-cookie",
          targetHref: `${target.origin}/home`,
          targetRoot: "/tmp/vibe64-preview-project",
          terminalSessionId: "terminal-filter-set-cookie"
        },
        sessionId: "session-filter-set-cookie",
        targetHref: `${target.origin}/home`,
        terminalSessionId: "terminal-filter-set-cookie"
      });

      const response = await fetch(previewPath(preview.href, "/set-auth-cookies"));
      assert.equal(response.status, 200);
      const setCookie = response.headers.get("set-cookie") || "";
      assert.match(setCookie, /target_cookie=target/u);
      assert.match(setCookie, new RegExp(`${previewTokenCookieName(new URL(preview.href).origin)}=`, "u"));
      assert.doesNotMatch(setCookie, /sb_access_token/u);
      assert.doesNotMatch(setCookie, /sb_refresh_token/u);
    } finally {
      await registry.closeAll();
      await rm(profileRoot, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy blocks target cookie-profile auth cookies from leaking to the browser", async () => {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-cookie-preview-auth-profile-"));
  const profilePath = path.join(profileRoot, "profile.json");
  await writeFile(profilePath, JSON.stringify({
    cookies: [
      {
        name: "adapter_session",
        value: "adapter-token"
      },
      {
        name: "adapter_refresh",
        value: "adapter-refresh"
      }
    ]
  }), "utf8");
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        previewAuth: {
          kind: COOKIE_PROFILE_PREVIEW_AUTH_KIND,
          profilePath,
          sessionId: "session-filter-cookie-profile",
          targetHref: `${target.origin}/home`,
          targetRoot: "/tmp/vibe64-preview-cookie-profile",
          terminalSessionId: "terminal-filter-cookie-profile"
        },
        sessionId: "session-filter-cookie-profile",
        targetHref: `${target.origin}/home`,
        terminalSessionId: "terminal-filter-cookie-profile"
      });

      const response = await fetch(previewPath(preview.href, "/set-cookie-profile-cookies"));
      assert.equal(response.status, 200);
      const setCookie = response.headers.get("set-cookie") || "";
      assert.match(setCookie, /target_cookie=target/u);
      assert.match(setCookie, new RegExp(`${previewTokenCookieName(new URL(preview.href).origin)}=`, "u"));
      assert.doesNotMatch(setCookie, /adapter_session/u);
      assert.doesNotMatch(setCookie, /adapter_refresh/u);
    } finally {
      await registry.closeAll();
      await rm(profileRoot, {
        force: true,
        recursive: true
      });
    }
  });
});

test("launch preview proxy forwards tokenized WebSocket upgrades without leaking token material", async () => {
  await withWebSocketTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure({
        sessionId: "session-websocket",
        targetHref: `${target.origin}/hmr?definePage&vue&lang.tsx`,
        terminalSessionId: "terminal-websocket"
      });
      assert.match(preview.href, /\?definePage&vue&lang\.tsx&vibe64_preview_token=/u);

      const accepted = await connectWebSocket(previewWebSocketHref(preview.href));
      assert.equal(accepted.ok, true);
      const reply = await sendWebSocketMessage(accepted.socket, "ping");
      assert.equal(reply, "echo:ping");
      accepted.socket.close();

      assert.equal(target.upgradeRequests.length, 1);
      assert.equal(target.upgradeRequests[0].url, "/hmr?definePage&vue&lang.tsx");
      assert.equal(target.upgradeRequests[0].cookie, "target_cookie=target");

      const missingTokenHref = previewWebSocketHref(preview.href, {
        token: ""
      });
      const missing = await connectWebSocket(missingTokenHref);
      assert.equal(missing.ok, false);
      assert.equal(missing.statusCode, 403);

      const wrongTokenHref = previewWebSocketHref(preview.href, {
        token: "wrong-token"
      });
      const wrong = await connectWebSocket(wrongTokenHref);
      assert.equal(wrong.ok, false);
      assert.equal(wrong.statusCode, 403);
    } finally {
      await registry.closeAll();
    }
  });
});

test("launch preview proxy close resolves while a browser WebSocket is still open", async () => {
  await withWebSocketTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    const preview = await registry.ensure({
      sessionId: "session-websocket-close",
      targetHref: `${target.origin}/hmr`,
      terminalSessionId: "terminal-websocket-close"
    });
    const accepted = await connectWebSocket(previewWebSocketHref(preview.href));
    assert.equal(accepted.ok, true);

    await withTimeout(
      registry.closeAll(),
      1000,
      "Preview proxy close should not wait for browser WebSocket clients to disconnect."
    );
    await waitForWebSocketClose(accepted.socket);
  });
});

test("launch preview proxy rewrites same-origin redirects to the proxy origin", () => {
  assert.equal(
    proxiedLocation("/home", {
      proxyOrigin: "http://127.0.0.1:4200",
      targetOrigin: "http://127.0.0.1:4103"
    }),
    "http://127.0.0.1:4200/home"
  );
  assert.equal(
    proxiedLocation("http://example.com/home", {
      proxyOrigin: "http://127.0.0.1:4200",
      targetOrigin: "http://127.0.0.1:4103"
    }),
    "http://example.com/home"
  );
});

test("launch preview proxy preserves its token across target redirects", () => {
  assert.equal(
    proxiedLocation("/auth/login?returnTo=/home%3Fmode%3Ddev", {
      proxyOrigin: "https://v64preview-abcd--tenant.vibe64.dev",
      targetOrigin: "http://127.0.0.1:4100",
      token: "preview-token"
    }),
    "https://v64preview-abcd--tenant.vibe64.dev/auth/login?returnTo=/home%3Fmode%3Ddev&vibe64_preview_token=preview-token"
  );
});

test("launch preview proxy strips only its token while preserving app query flags", async () => {
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure("session-query-flags", `${target.origin}/home`);
      const previewUrl = new URL(preview.href);
      const token = previewUrl.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM);
      const proxiedModuleUrl = `${previewUrl.origin}/echo-url?definePage&vue&lang.tsx&${PREVIEW_PROXY_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`;

      const response = await fetch(proxiedModuleUrl);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        url: "/echo-url?definePage&vue&lang.tsx"
      });
    } finally {
      await registry.closeAll();
    }
  });
});

test("launch preview token stripping preserves valueless query parameters", () => {
  assert.equal(
    stripPreviewTokenQueryParam("?definePage&vue&lang.tsx&vibe64_preview_token=abc"),
    "?definePage&vue&lang.tsx"
  );
  assert.equal(
    stripPreviewTokenQueryParam("?vibe64_preview_token=abc&definePage&vue&lang.tsx"),
    "?definePage&vue&lang.tsx"
  );
  assert.equal(
    stripPreviewTokenQueryParam("?definePage=&vue=&lang.tsx=&vibe64_preview_token=abc"),
    "?definePage=&vue=&lang.tsx="
  );
});

test("launch preview token appending preserves valueless query parameters", () => {
  assert.equal(
    appendPreviewTokenQueryParam("?definePage&vue&lang.tsx", "abc"),
    "?definePage&vue&lang.tsx&vibe64_preview_token=abc"
  );
  assert.equal(
    appendPreviewTokenQueryParam("", "abc"),
    "?vibe64_preview_token=abc"
  );
});

test("launch preview proxy serves stable starting HTML while the target is unavailable", async () => {
  const registry = createLaunchPreviewProxyRegistry();
  try {
    const preview = await registry.ensure("session-unavailable", "http://127.0.0.1:9/home");

    const htmlResponse = await fetch(preview.href, {
      headers: {
        Accept: "text/html"
      }
    });
    const html = await htmlResponse.text();
    assert.equal(htmlResponse.status, 503);
    assert.match(html, /Starting preview\./u);
    assert.doesNotMatch(html, /http-equiv="refresh"/u);

    const apiResponse = await fetch(previewPath(preview.href, "/api/ping"), {
      headers: {
        Accept: "application/json"
      }
    });
    assert.equal(apiResponse.status, 502);
    assert.match(await apiResponse.text(), /Launch preview proxy failed:/u);
  } finally {
    await registry.closeAll();
  }
});

test("launch preview proxy handles aborted upstream response bodies", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/octet-stream"
    });
    response.write("partial");
    response.socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const registry = createLaunchPreviewProxyRegistry();
  try {
    const address = server.address();
    const preview = await registry.ensure("session-aborted-body", `http://127.0.0.1:${address.port}/stream`);
    await fetch(preview.href).then(async (response) => {
      await response.arrayBuffer();
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(true);
  } finally {
    await registry.closeAll();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
});

async function withTargetServer(callback) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      host: request.headers.host || "",
      url: request.url || ""
    });
    if (request.url === "/api/ping") {
      response.writeHead(200, {
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({
        ok: true
      }));
      return;
    }
    if (String(request.url || "").startsWith("/echo-url")) {
      response.writeHead(200, {
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({
        url: request.url
      }));
      return;
    }
    if (request.url === "/echo-cookie") {
      response.writeHead(200, {
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({
        cookie: request.headers.cookie || ""
      }));
      return;
    }
    if (request.url === "/set-auth-cookies") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": [
          "target_cookie=target; Path=/",
          "sb_access_token=target-access; Path=/",
          "sb_refresh_token=target-refresh; Path=/"
        ]
      });
      response.end(JSON.stringify({
        ok: true
      }));
      return;
    }
    if (request.url === "/set-cookie-profile-cookies") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": [
          "target_cookie=target; Path=/",
          "adapter_session=target-session; Path=/",
          "adapter_refresh=target-refresh; Path=/"
        ]
      });
      response.end(JSON.stringify({
        ok: true
      }));
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": "target_cookie=target; Path=/"
    });
    response.end("<!doctype html><html><head><title>Target</title></head><body>Target home</body></html>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  try {
    await callback({
      origin: `http://127.0.0.1:${address.port}`,
      requests
    });
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

async function withWebSocketTargetServer(callback) {
  const upgradeRequests = [];
  const server = createServer((request, response) => {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  });
  const websocketServer = new WebSocketServer({
    noServer: true
  });
  websocketServer.on("connection", (socket) => {
    socket.on("message", (message) => {
      socket.send(`echo:${message.toString()}`);
    });
  });
  server.on("upgrade", (request, socket, head) => {
    upgradeRequests.push({
      cookie: request.headers.cookie || "",
      url: request.url
    });
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  try {
    await callback({
      origin: `http://127.0.0.1:${address.port}`,
      upgradeRequests
    });
  } finally {
    websocketServer.close();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

function previewPath(previewHref = "", pathname = "/") {
  const previewUrl = new URL(previewHref);
  const nextUrl = new URL(pathname, previewUrl.origin);
  nextUrl.searchParams.set(
    PREVIEW_PROXY_TOKEN_QUERY_PARAM,
    previewUrl.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM)
  );
  return nextUrl;
}

function previewWebSocketHref(previewHref = "", {
  token = undefined
} = {}) {
  const previewUrl = new URL(previewHref);
  const targetToken = token === undefined
    ? previewUrl.searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM)
    : token;
  const search = stripPreviewTokenQueryParam(previewUrl.search);
  previewUrl.protocol = "ws:";
  previewUrl.search = targetToken
    ? appendPreviewTokenQueryParam(search, targetToken)
    : search;
  return previewUrl.toString();
}

function unusedLocalPort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function previewCookiePair(setCookieHeader = "", cookieName = "") {
  const match = new RegExp(`(?:^|,\\s*)(${cookieName}=[^;,]+)`, "u").exec(String(setCookieHeader || ""));
  assert.ok(match, `Expected preview cookie ${cookieName}.`);
  return match[1];
}

function cookieValue(cookieHeader = "", cookieName = "") {
  const match = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`, "u").exec(String(cookieHeader || ""));
  assert.ok(match, `Expected cookie ${cookieName}.`);
  return decodeURIComponent(match[1]);
}

function jskitDevCookiePayload(cookieHeader = "") {
  const token = cookieValue(cookieHeader, "sb_access_token").replace(/^jskit-dev\./u, "");
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  delete payload.exp;
  delete payload.iat;
  return payload;
}

function connectWebSocket(href = "", options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(href, {
      headers: {
        Cookie: "target_cookie=target",
        ...options.headers
      }
    });
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    socket.once("open", () => finish({
      ok: true,
      socket
    }));
    socket.once("unexpected-response", (_request, response) => finish({
      ok: false,
      statusCode: response.statusCode
    }));
    socket.once("error", (error) => finish({
      error,
      ok: false
    }));
  });
}

function waitForWebSocketClose(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
  });
}

function withTimeout(promise, timeoutMs, message = "Timed out.") {
  let timeout = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      clearTimeout(timeout);
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function requestUnixSocket({
  headers = {},
  path: requestPath = "/",
  socketPath = ""
} = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      headers,
      method: "GET",
      path: requestPath,
      socketPath
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          body,
          headers: response.headers,
          statusCode: response.statusCode
        });
      });
    });
    request.once("error", reject);
    request.end();
  });
}

function sendWebSocketMessage(socket, message = "") {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(data.toString()));
    socket.once("error", reject);
    socket.send(message);
  });
}
