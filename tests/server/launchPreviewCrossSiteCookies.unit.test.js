import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PREVIEW_PROXY_TOKEN_QUERY_PARAM } from "../../packages/vibe64-terminals/src/shared/launchPreviewProtocol.js";
import {
  createLaunchPreviewProxyRegistry,
  previewPublicSocketPath
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";
import { previewTokenCookie } from "../../packages/vibe64-terminals/src/server/launchPreviewHeaders.js";

// A host gives Previews a domain of their own, apart from its editors' (vibe64.app beside vibe64.studio), so an
// HTTPS Preview is a cross-site frame of the editor that shows it. Its cookies, the Preview's gate cookie and the
// app's own, are made for that frame; and no app cookie reaches beyond the Preview's own host.

const HTTPS_PREVIEW = "https://v64preview-abcdef123456.merc.vibe64.app";
const HTTP_PREVIEW = "http://v64preview-abcdef123456.merc.users.localhost:3000";

// Each a Set-Cookie header the app sends, and the one the browser gets from an HTTPS Preview.
const HTTPS_APP_COOKIES = [
  ["app_session=alice; Path=/; HttpOnly; SameSite=Lax", "app_session=alice; Path=/; HttpOnly; Secure; SameSite=None; Partitioned"],
  ["theme=dark; Path=/; Domain=vibe64.app; SameSite=Strict; Secure", "theme=dark; Path=/; Secure; SameSite=None; Partitioned"],
  ["team=t1; Domain=.merc.vibe64.app; Max-Age=60", "team=t1; Max-Age=60; Secure; SameSite=None; Partitioned"],
  [
    "own=1; Domain=v64preview-abcdef123456.merc.vibe64.app; partitioned",
    "own=1; Domain=v64preview-abcdef123456.merc.vibe64.app; Secure; SameSite=None; Partitioned"
  ],
  ["elsewhere=1; Domain=example.com", "elsewhere=1; Domain=example.com; Secure; SameSite=None; Partitioned"]
];

test("an HTTPS Preview's gate cookie is a partitioned cross-site __Host- cookie; one on this computer stays Lax", () => {
  assert.equal(
    previewTokenCookie("secret", { proxyOrigin: HTTPS_PREVIEW }),
    "__Host-vibe64_preview_token_443=secret; Path=/; HttpOnly; Secure; SameSite=None; Partitioned"
  );
  // A Preview on this computer shares its editor's loopback site, and a browser need not keep Secure cookies there.
  assert.equal(
    previewTokenCookie("secret", { proxyOrigin: "http://127.0.0.1:49000" }),
    "vibe64_preview_token_49000=secret; Path=/; SameSite=Lax; HttpOnly"
  );
  assert.equal(
    previewTokenCookie("secret", { proxyOrigin: HTTP_PREVIEW }),
    "vibe64_preview_token_3000=secret; Path=/; SameSite=Lax; HttpOnly"
  );
});

test("an HTTPS Preview gives the app's cookies cross-site attributes and keeps each on the Preview's host", async (t) => {
  const warnings = captureWarnings(t);
  const preview = await startPreview(t, {
    publicOrigin: HTTPS_PREVIEW,
    setCookies: HTTPS_APP_COOKIES.map(([sent]) => sent)
  });
  const response = await preview.get("/page");
  assert.equal(response.statusCode, 200);
  const [gate, ...app] = [...response.headers["set-cookie"]].reverse();
  assert.deepEqual(app.reverse(), HTTPS_APP_COOKIES.map(([, received]) => received));
  assert.match(gate, /^__Host-vibe64_preview_token_443=[^;]+; Path=\/; HttpOnly; Secure; SameSite=None; Partitioned$/u);

  // Each widening Domain is reported once, naming the workspace and project whose app sent it.
  assert.deepEqual(warnings.map(([message]) => message), [
    "Vibe64 Preview took Domain=vibe64.app off cookie theme of project shop in workspace merc: it would have " +
      "reached every host below vibe64.app, so it stays on v64preview-abcdef123456.merc.vibe64.app.",
    "Vibe64 Preview took Domain=merc.vibe64.app off cookie team of project shop in workspace merc: it would have " +
      "reached every host below merc.vibe64.app, so it stays on v64preview-abcdef123456.merc.vibe64.app."
  ]);
  assert.deepEqual(warnings[0][1], {
    event: "vibe64.preview.cookie_domain_removed",
    cookie: "theme",
    domain: "vibe64.app",
    host: "v64preview-abcdef123456.merc.vibe64.app",
    project: "shop",
    sessionId: "cross-site-cookies",
    workspace: "merc"
  });
  await preview.get("/page");
  assert.equal(warnings.length, 2, "the same cookie and domain warn once");

  // The app's answer to a WebSocket upgrade gives its cookies the same way.
  const head = await preview.upgradeHead("/socket");
  assert.match(head, /^HTTP\/1\.1 101 /u);
  assert.match(head, /\r\nSet-Cookie: live=1; Path=\/; Secure; SameSite=None; Partitioned\r\n/u);
  assert.doesNotMatch(head, /Domain=/iu);
  assert.equal(warnings.length, 3);
  assert.match(warnings[2][0], /^Vibe64 Preview took Domain=merc\.vibe64\.app off cookie live of project shop in workspace merc:/u);
});

test("a Preview on this computer keeps the app's SameSite and takes off only a widening Domain", async (t) => {
  const warnings = captureWarnings(t);
  const preview = await startPreview(t, {
    publicOrigin: HTTP_PREVIEW,
    setCookies: ["session=1; Path=/; SameSite=Lax; Domain=users.localhost", "plain=1; SameSite=Strict"]
  });
  const response = await preview.get("/page");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.headers["set-cookie"].slice(0, 2), ["session=1; Path=/; SameSite=Lax", "plain=1; SameSite=Strict"]);
  assert.match(response.headers["set-cookie"][2], /^vibe64_preview_token_3000=[^;]+; Path=\/; SameSite=Lax; HttpOnly$/u);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /took Domain=users\.localhost off cookie session of project shop in workspace merc:/u);
});

function captureWarnings(t) {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => {
    warnings.push(args);
  });
  return warnings;
}

/**
 * The app behind a Preview at `publicOrigin`: every page sets `setCookies`, and a WebSocket upgrade answers 101
 * with a cookie for the workspace's whole domain. `get` and `upgradeHead` ask the Preview's socket with its token.
 */
async function startPreview(t, { publicOrigin, setCookies }) {
  const socketDir = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-cookies-"));
  t.after(() => rm(socketDir, { force: true, recursive: true }));
  const target = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": setCookies });
    response.end("app page");
  });
  target.on("upgrade", (request, socket) => {
    socket.end([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Set-Cookie: live=1; Path=/; Domain=merc.vibe64.app",
      "",
      ""
    ].join("\r\n"));
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  t.after(() => new Promise((resolve) => target.close(resolve)));
  const env = { VIBE64_PREVIEW_PROXY_SOCKET_DIR: socketDir };
  const registry = createLaunchPreviewProxyRegistry({ env });
  t.after(() => registry.closeAll());
  const descriptor = await registry.ensure({
    previewPublicOrigin: publicOrigin,
    projectScope: "project:shop",
    sessionId: "cross-site-cookies",
    targetHref: `http://127.0.0.1:${target.address().port}/`
  });
  const token = new URL(descriptor.href).searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM);
  const socketPath = previewPublicSocketPath(publicOrigin, env);
  const host = new URL(publicOrigin).host;
  const withToken = (requestPath) => `${requestPath}?${PREVIEW_PROXY_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`;
  return {
    get: (requestPath) => new Promise((resolve, reject) => {
      // Not a page navigation, so the token is not swapped for a cookie by a redirect first.
      const request = httpRequest({ headers: { Accept: "text/plain", Host: host }, path: withToken(requestPath), socketPath }, (response) => {
        response.resume();
        response.once("end", () => resolve({ headers: response.headers, statusCode: response.statusCode }));
      });
      request.once("error", reject);
      request.end();
    }),
    upgradeHead: (requestPath) => new Promise((resolve, reject) => {
      const socket = netConnect(socketPath);
      let received = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        received += chunk;
      });
      socket.once("error", reject);
      socket.once("close", () => resolve(received));
      socket.write([
        `GET ${withToken(requestPath)} HTTP/1.1`,
        `Host: ${host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "",
        ""
      ].join("\r\n"));
    })
  };
}
