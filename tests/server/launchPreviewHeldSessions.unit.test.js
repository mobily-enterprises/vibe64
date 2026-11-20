import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureVibe64SessionDebugLog } from "../../packages/vibe64-runtime/src/shared/sessionDebugLog.js";
import {
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  PREVIEW_WINDOW_PATH,
  PREVIEW_WINDOW_TICKET_PATH
} from "../../packages/vibe64-terminals/src/shared/launchPreviewProtocol.js";
import { createPreviewAccess } from "../../packages/vibe64-terminals/src/server/launchPreviewAccess.js";
import { createHeldCookieJar, HELD_COOKIES_MAX } from "../../packages/vibe64-terminals/src/server/launchPreviewHeldCookies.js";
import {
  createLaunchPreviewProxyRegistry,
  previewPublicSocketPath
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";

// A Preview on a domain of its own is a cross-site frame of the editor, and the browser keeps a window at the
// Preview's address apart from the pane: the pane's sign-in window would sign only itself in. So the pane of an HTTPS
// Preview, coming in with its token, is a held session, the Preview holds the app's HttpOnly cookies for it, and a
// window the pane opens gets in with a single-use ticket as the pane's held session: the pane and its window are one
// app session. Anything else that comes in keeps the app's cookies in the browser, as before.

const PREVIEW_ORIGIN = "https://v64preview-abcdef123456.merc.vibe64.app";
const HTTP_PREVIEW_ORIGIN = "http://v64preview-abcdef123456.merc.users.localhost:3000";
const ACCESS_COOKIE = "__Host-vibe64_preview_token_443";
const SESSION_COOKIE = "__Host-vibe64_preview_session_443";
const PAGE_LOAD = { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate", "sec-fetch-site": "cross-site" };
const SAME_ORIGIN_FETCH = { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" };

test("held cookies follow the app's path, expiry and SameSite, and keep only HttpOnly ones", () => {
  const jar = createHeldCookieJar();
  const now = Date.parse("2026-11-21T10:00:00Z");
  assert.equal(jar.hold("theme=dark; Path=/", "/", now), false, "a cookie the page's script reads stays the browser's");
  assert.equal(jar.hold("app_session=alice; Path=/; HttpOnly; SameSite=Lax", "/sign-in", now), true);
  assert.equal(jar.hold("area=admin; HttpOnly", "/admin/enter", now), true, "no Path: the request's directory");
  assert.equal(jar.hold("short=1; HttpOnly; Max-Age=10", "/", now), true);
  assert.equal(jar.hold("open=1; Path=/; HttpOnly; SameSite=None; Secure", "/", now), true);
  const names = (pairs) => pairs.map((cookie) => cookie.name);

  assert.deepEqual(names(jar.cookieHeaderPairs("/admin/users", {}, now + 5_000)), ["area", "app_session", "short", "open"]);
  assert.deepEqual(names(jar.cookieHeaderPairs("/administrator", {}, now)), ["app_session", "short", "open"]);
  // Another site's form post or fetch gets only SameSite=None cookies; a page load (the editor framing the pane) gets all.
  assert.deepEqual(names(jar.cookieHeaderPairs("/", { crossSite: true }, now)), ["open"]);
  assert.deepEqual(names(jar.cookieHeaderPairs("/", { crossSite: true, navigation: true }, now)), ["app_session", "short", "open"]);

  // A cookie the app ends goes from here and reaches the browser too, which may keep an older copy.
  assert.equal(jar.hold("app_session=; Path=/; HttpOnly; Max-Age=0", "/sign-out", now), false);
  assert.equal(jar.holds("app_session"), false);
  assert.equal(jar.hold("open=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT", "/", now), false);
  assert.deepEqual(names(jar.cookieHeaderPairs("/", {}, now)), ["short"]);
  assert.deepEqual(names(jar.cookieHeaderPairs("/", {}, now + 11_000)), [], "Max-Age ends it");

  for (let index = 0; index <= HELD_COOKIES_MAX; index += 1) {
    jar.hold(`c${index}=1; Path=/; HttpOnly`, "/", now);
  }
  const kept = names(jar.cookieHeaderPairs("/", {}, now));
  assert.equal(kept.length, HELD_COOKIES_MAX, "the oldest give way");
  assert.ok(!kept.includes("c0") && kept.includes(`c${HELD_COOKIES_MAX}`));
});

test("a window ticket is used up by its first use and ends after its lifetime", () => {
  const access = createPreviewAccess({ projectScope: "project:shop", publicOrigin: PREVIEW_ORIGIN, sessionId: "s1" }, {
    ticketLifetimeMs: 30_000
  });
  const session = access.newHeldSession();
  const now = Date.parse("2026-11-21T10:00:00Z");
  const ticket = access.issueWindowTicket(session, now);
  assert.equal(access.redeemWindowTicket(ticket, now + 1_000), session);
  assert.equal(access.redeemWindowTicket(ticket, now + 1_000), "", "used");
  const late = access.issueWindowTicket(session, now);
  assert.equal(access.redeemWindowTicket(late, now + 30_000), "", "expired");
  assert.equal(access.redeemWindowTicket(late, now), "", "an expired ticket is used up too");
  assert.equal(access.redeemWindowTicket("", now), "");
  const other = createPreviewAccess({ projectScope: "project:shop", publicOrigin: PREVIEW_ORIGIN, sessionId: "s2" });
  assert.equal(other.redeemWindowTicket(access.issueWindowTicket(session, now), now), "", "another Preview's");
});

test("only the editor's pane of an HTTPS Preview starts a held session", async (t) => {
  const preview = await startPreview(t);
  const comingIn = async (target, headers) => (await target.send(`/?${PREVIEW_PROXY_TOKEN_QUERY_PARAM}=${target.token}`, {
    headers
  })).headers["set-cookie"].map((header) => header.split("=", 1)[0]);
  assert.deepEqual(await comingIn(preview, PAGE_LOAD), [ACCESS_COOKIE, SESSION_COOKIE], "the pane, a frame");
  const ownTab = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" };
  assert.deepEqual(await comingIn(preview, ownTab), [ACCESS_COOKIE], "a tab of its own, the agent's browser");
  assert.deepEqual(await comingIn(preview, {}), [ACCESS_COOKIE], "a client that is no browser");
  // An HTTP Preview runs on the editor's own loopback name: its windows share the pane's cookies already.
  const local = await startPreview(t, { origin: HTTP_PREVIEW_ORIGIN, sessionId: "local-preview" });
  assert.deepEqual(await comingIn(local, PAGE_LOAD), ["vibe64_preview_token_3000"]);
});

test("a pane is a held session: its app cookies stay in the Preview and reach only it", async (t) => {
  const preview = await startPreview(t);
  const pane = await preview.pageComingIn();
  const other = await preview.pageComingIn();
  assert.notEqual(pane.session, other.session, "each pane that comes in is a held session of its own");

  const signIn = await preview.send("/sign-in", { cookies: pane.cookies, headers: SAME_ORIGIN_FETCH });
  assert.equal(signIn.statusCode, 200);
  const setCookies = signIn.headers["set-cookie"];
  assert.ok(setCookies.includes("theme=dark; Path=/; Secure; SameSite=None; Partitioned"), "a cookie the script reads reaches the browser");
  assert.ok(!setCookies.some((header) => header.startsWith("app_session=")), "the HttpOnly session stays in the Preview");

  // The app sees the held cookie on the pane's requests, without the Preview's own cookies or an older browser copy.
  const echoed = await preview.send("/echo", { cookies: [...pane.cookies, "app_session=stale", "theme=dark"] });
  assert.equal(echoed.body, "app_session=alice; theme=dark");
  assert.equal((await preview.send("/echo", { cookies: other.cookies })).body, "", "another page has its own");
  assert.equal((await preview.send("/echo", { cookies: [pane.cookies[0]] })).body, "", "a request of no held session");
  // A client that never came in as a page keeps the app's cookies itself, as before.
  const direct = await preview.send(`/sign-in?${PREVIEW_PROXY_TOKEN_QUERY_PARAM}=${preview.token}`, {});
  assert.ok(direct.headers["set-cookie"].some((header) => header.startsWith("app_session=alice;")));

  // Another site's form post to the Preview, with the person's access cookie, does not carry the app's session.
  const crossSite = await preview.send("/echo", {
    cookies: pane.cookies,
    headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "cross-site" },
    method: "POST"
  });
  assert.equal(crossSite.body, "");

  // A WebSocket upgrade carries the held cookies, and the app's HttpOnly cookie in its answer is held.
  const upgrade = await preview.upgrade("/socket", pane.cookies);
  assert.match(upgrade.head, /^HTTP\/1\.1 101 /u);
  assert.doesNotMatch(upgrade.head, /live=/u);
  assert.equal(upgrade.cookie, "app_session=alice");
  assert.equal((await preview.send("/echo", { cookies: pane.cookies })).body, "app_session=alice; live=1");

  // Signing out ends the held cookie and tells the browser to end its own copy.
  const signOut = await preview.send("/sign-out", { cookies: pane.cookies });
  assert.ok(signOut.headers["set-cookie"].includes("app_session=; Path=/; HttpOnly; Max-Age=0; Secure; SameSite=None; Partitioned"));
  assert.equal((await preview.send("/echo", { cookies: pane.cookies })).body, "live=1");
});

test("a window the pane opens gets in once with its ticket, as the pane's held session", async (t) => {
  const preview = await startPreview(t);
  const pane = await preview.pageComingIn();
  await preview.send("/sign-in", { cookies: pane.cookies, headers: SAME_ORIGIN_FETCH });
  const askTicket = async (cookies, headers = SAME_ORIGIN_FETCH, method = "POST") => {
    const answer = await preview.send(PREVIEW_WINDOW_TICKET_PATH, { cookies, headers, method });
    return { ...answer, ticket: answer.statusCode === 200 ? JSON.parse(answer.body).ticket : "" };
  };
  const enter = (ticket, destination, { cookies = [], dest = "document" } = {}) => preview.send(
    `${PREVIEW_WINDOW_PATH}?ticket=${encodeURIComponent(ticket)}&to=${encodeURIComponent(destination)}`,
    { cookies, headers: { "sec-fetch-dest": dest, "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" } }
  );

  // Only the pane's own pages ask: without its access (a page of another site framing it), as no held session (a
  // tab of its own), from another site, or not as a POST, there is no ticket.
  assert.equal((await askTicket([])).statusCode, 403);
  assert.equal((await askTicket([pane.cookies[0]])).statusCode, 403);
  assert.equal((await askTicket(pane.cookies, { ...SAME_ORIGIN_FETCH, "sec-fetch-site": "cross-site" })).statusCode, 403);
  assert.equal((await askTicket(pane.cookies, SAME_ORIGIN_FETCH, "GET")).statusCode, 403);

  // A ticket loaded in a frame (another site's page framing the Preview) is refused, and used up.
  const framed = (await askTicket(pane.cookies)).ticket;
  assert.equal((await enter(framed, "/", { dest: "iframe" })).statusCode, 403);
  assert.equal((await enter(framed, "/")).statusCode, 403);

  // The window's own page load: the Preview's access and the pane's held session, on to the page it was opening.
  const ticket = (await askTicket(pane.cookies)).ticket;
  const entered = await enter(ticket, "/oauth/start?provider=idp");
  assert.equal(entered.statusCode, 303);
  assert.equal(entered.headers.location, `${PREVIEW_ORIGIN}/oauth/start?provider=idp`);
  assert.equal(entered.headers["referrer-policy"], "no-referrer");
  const windowCookies = entered.headers["set-cookie"].map((header) => header.split(";", 1)[0]);
  assert.deepEqual(windowCookies, pane.cookies);
  assert.equal((await preview.send("/echo", { cookies: windowCookies })).body, "app_session=alice", "one app session");
  assert.equal((await enter(ticket, "/")).statusCode, 403, "used");

  // A window whose browser kept another held session before (the window of an earlier pane) becomes this pane's.
  const earlier = await preview.pageComingIn();
  const rejoined = await enter((await askTicket(pane.cookies)).ticket, "/", { cookies: earlier.cookies });
  assert.equal(rejoined.statusCode, 303);
  assert.deepEqual(rejoined.headers["set-cookie"].map((header) => header.split(";", 1)[0]), pane.cookies);

  // A window opening another site's page (a sign-in page) is sent there; anything but a web address is refused.
  const away = await enter((await askTicket(pane.cookies)).ticket, "https://idp.example/authorize?state=1");
  assert.equal(away.headers.location, "https://idp.example/authorize?state=1");
  assert.equal((await enter((await askTicket(pane.cookies)).ticket, "javascript:alert(1)")).statusCode, 403);

  // Another Preview's ticket means nothing here.
  const elsewhere = await startPreview(t, { sessionId: "another-session" });
  const elsewherePane = await elsewhere.pageComingIn();
  const foreignTicket = JSON.parse((await elsewhere.send(PREVIEW_WINDOW_TICKET_PATH, {
    cookies: elsewherePane.cookies,
    headers: SAME_ORIGIN_FETCH,
    method: "POST"
  })).body).ticket;
  assert.equal((await enter(foreignTicket, "/")).statusCode, 403);
});

test("a restart keeps a Preview's held cookies, its Stop drops them, and its token stays", async (t) => {
  const preview = await startPreview(t, { terminalSessionId: "run-1" });
  const pane = await preview.pageComingIn();
  await preview.send("/sign-in", { cookies: pane.cookies, headers: SAME_ORIGIN_FETCH });
  await preview.ensure({ terminalSessionId: "run-2" });
  assert.equal((await preview.send("/echo", { cookies: pane.cookies })).body, "app_session=alice", "an app restart keeps it");
  await preview.registry.stop({ projectScope: "project:shop", sessionId: preview.sessionId, terminalSessionId: "run-1" });
  assert.equal((await preview.send("/echo", { cookies: pane.cookies })).body, "app_session=alice", "an old run's stop does not");
  await preview.registry.stop({ projectScope: "project:shop", sessionId: preview.sessionId });
  const restarted = await preview.ensure({ terminalSessionId: "run-3" });
  assert.equal(new URL(restarted.href).searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM), preview.token);
  assert.equal((await preview.send("/echo", { cookies: pane.cookies })).body, "", "Stop signed the app out");
});

test("the Preview's gate and proxy log no query string, whatever it carries", async (t) => {
  const lines = [];
  for (const level of ["debug", "error", "info", "log", "warn"]) {
    t.mock.method(console, level, (...args) => {
      lines.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
    });
  }
  const previousDebug = process.env.VIBE64_PREVIEW_DEBUG;
  process.env.VIBE64_PREVIEW_DEBUG = "1";
  configureVibe64SessionDebugLog({ VIBE64_SESSION_DEBUG: "1" });
  t.after(() => {
    configureVibe64SessionDebugLog({});
    if (previousDebug === undefined) delete process.env.VIBE64_PREVIEW_DEBUG;
    else process.env.VIBE64_PREVIEW_DEBUG = previousDebug;
  });
  const preview = await startPreview(t);
  const pane = await preview.pageComingIn("/start?secret=query-secret-1");
  await preview.send("/echo?secret=query-secret-2", { cookies: pane.cookies });
  await preview.send(`/echo?secret=query-secret-3&${PREVIEW_PROXY_TOKEN_QUERY_PARAM}=wrong-token`, {});
  const ticket = JSON.parse((await preview.send(PREVIEW_WINDOW_TICKET_PATH, {
    cookies: pane.cookies,
    headers: SAME_ORIGIN_FETCH,
    method: "POST"
  })).body).ticket;
  await preview.send(`${PREVIEW_WINDOW_PATH}?ticket=${ticket}&to=%2Fecho%3Fsecret%3Dquery-secret-4`, {
    headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }
  });
  await preview.send(`${PREVIEW_WINDOW_PATH}?ticket=${ticket}&to=%2F`, { headers: { "sec-fetch-dest": "document" } });
  await preview.upgrade("/socket?secret=query-secret-5", pane.cookies);

  const logged = lines.join("\n");
  assert.match(logged, /server\.launchPreviewProxy\.request\.bootstrapRedirect/u, "the debug log was on");
  assert.match(logged, /windowEntered/u);
  assert.match(logged, /windowRefused/u);
  for (const secret of [preview.token, ticket, "query-secret", "wrong-token"]) {
    assert.ok(!logged.includes(secret), `the log holds no ${secret.slice(0, 12)}`);
  }
  assert.doesNotMatch(logged, /\?(?:secret|ticket|vibe64_preview_token)/u);
});

/**
 * A Preview at `origin`, on its proxy's socket as a host's ingress reaches it, of an app that signs in
 * (/sign-in: an HttpOnly session and a theme its script reads), signs out, echoes the cookies it gets, and answers a
 * WebSocket upgrade with a cookie of its own.
 */
async function startPreview(t, { origin = PREVIEW_ORIGIN, sessionId = "held-sessions", terminalSessionId = "run-1" } = {}) {
  const socketDir = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-held-"));
  t.after(() => rm(socketDir, { force: true, recursive: true }));
  const target = createServer((request, response) => {
    const pathname = new URL(request.url, "http://app").pathname;
    const setCookie = {
      "/sign-in": ["app_session=alice; Path=/; HttpOnly; SameSite=Lax", "theme=dark; Path=/"],
      "/sign-out": ["app_session=; Path=/; HttpOnly; Max-Age=0"]
    }[pathname];
    response.writeHead(200, { "Content-Type": "text/plain", ...(setCookie ? { "Set-Cookie": setCookie } : {}) });
    response.end(pathname === "/echo" ? String(request.headers.cookie || "") : "ok");
  });
  const upgradeCookies = [];
  target.on("upgrade", (request, socket) => {
    upgradeCookies.push(String(request.headers.cookie || ""));
    socket.end([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Set-Cookie: live=1; Path=/; HttpOnly",
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
  const ensure = (overrides = {}) => registry.ensure({
    previewPublicOrigin: origin,
    projectScope: "project:shop",
    sessionId,
    targetHref: `http://127.0.0.1:${target.address().port}/`,
    terminalSessionId,
    ...overrides
  });
  const descriptor = await ensure();
  const token = new URL(descriptor.href).searchParams.get(PREVIEW_PROXY_TOKEN_QUERY_PARAM);
  const socketPath = previewPublicSocketPath(origin, env);
  const host = new URL(origin).host;

  function send(requestPath, { cookies = [], headers = {}, method = "GET" }) {
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        headers: { Host: host, ...(cookies.length ? { Cookie: cookies.join("; ") } : {}), ...headers },
        method,
        path: requestPath,
        socketPath
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.once("end", () => resolve({ body, headers: response.headers, statusCode: response.statusCode }));
      });
      request.once("error", reject);
      request.end();
    });
  }

  /** The editor's pane coming in with the token: its access and held session cookies. */
  async function pageComingIn(requestPath = "/") {
    const separator = requestPath.includes("?") ? "&" : "?";
    const answer = await send(`${requestPath}${separator}${PREVIEW_PROXY_TOKEN_QUERY_PARAM}=${token}`, { headers: PAGE_LOAD });
    assert.equal(answer.statusCode, 302);
    const cookies = answer.headers["set-cookie"].map((header) => header.split(";", 1)[0]);
    assert.equal(cookies[0], `${ACCESS_COOKIE}=${token}`);
    assert.match(cookies[1], new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`, "u"));
    return { cookies, session: cookies[1] };
  }

  function upgrade(requestPath, cookies) {
    return new Promise((resolve, reject) => {
      const socket = netConnect(socketPath);
      let head = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        head += chunk;
      });
      socket.once("error", reject);
      socket.once("close", () => resolve({ cookie: upgradeCookies.at(-1) ?? null, head }));
      socket.write([
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${host}`,
        `Cookie: ${cookies.join("; ")}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "",
        ""
      ].join("\r\n"));
    });
  }

  return { ensure, pageComingIn, registry, send, sessionId, token, upgrade };
}
