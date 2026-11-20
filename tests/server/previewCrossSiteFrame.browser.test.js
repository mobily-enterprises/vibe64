import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { build } from "esbuild";

import {
  createLaunchPreviewProxyRegistry,
  previewPublicSocketPath
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";

// A host that gives Previews a domain of their own (vibe64.app beside the editors' vibe64.studio) makes each Preview
// a cross-site frame of the editor that shows it. In Chromium, an editor page on one site frames, as the editor's
// Preview pane does, a Preview on another, served over HTTPS by the Preview proxy behind a front that routes each
// name by Host as a host's ingress does: the frame's page and the requests it makes after its first one pass the
// Preview's gate with its cookie, signing in to the app inside the frame keeps the app's session, a page of a third
// site that frames the Preview gets no application page, and the Preview opened in its own tab works too, as a
// session of its own. A sign-in window the pane opens with JSKIT's own popup client, through an identity provider on
// a third site, signs the pane in; with a provider that cuts the window off from the pane (COOP), a reload of the
// pane does. Each runs with Chromium's third-party cookies allowed, as they are by default, and blocked, as Safari
// blocks them and Chromium can: a browser that blocks them still keeps partitioned ones.

const execFileAsync = promisify(execFile);
const EDITOR_HOST = "merc.studio.test";
const PREVIEW_HOST = "v64preview-abcdef123456.merc.app.test";
const OTHER_SITE_HOST = "pages.other.test";
const IDENTITY_PROVIDER_HOST = "login.idp.test";
const WINDOW_REFUSED = "This Preview window's ticket is missing, used, expired or not this page's.";
// The Preview's own paths for a window the pane opens, as its bridge uses them.
const PREVIEW_WINDOW_PATH = "/__vibe64/preview-window";
const PREVIEW_WINDOW_TICKET_PATH = "/__vibe64/preview-window-ticket";

/** A key and a certificate for the test's names, made for this run. */
async function testCertificate(root) {
  const key = path.join(root, "key.pem");
  const certificate = path.join(root, "certificate.pem");
  const names = [EDITOR_HOST, PREVIEW_HOST, OTHER_SITE_HOST, IDENTITY_PROVIDER_HOST];
  await execFileAsync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
    "-subj", `/CN=${EDITOR_HOST}`,
    "-addext", `subjectAltName=${names.map((name) => `DNS:${name}`).join(",")}`,
    "-keyout", key, "-out", certificate
  ]);
  return { cert: await readFile(certificate), key: await readFile(key) };
}

/**
 * JSKIT's own client for a framed app's OAuth sign-in window (@jskit-ai/auth-web, the release this checkout pins):
 * createPopupOAuthLaunchClient opens the window and reloads the page when the window says it finished, and
 * completeOAuthPopupSignIn, on the callback page, tells the page that opened it and closes the window.
 */
async function jskitPopupClientScript() {
  const clientDirectory = path.dirname(fileURLToPath(import.meta.resolve("@jskit-ai/auth-web/client")));
  const result = await build({
    bundle: true,
    define: { "process.env.NODE_ENV": "\"production\"" },
    format: "iife",
    logLevel: "silent",
    platform: "browser",
    stdin: {
      contents: `import { completeOAuthPopupSignIn, createPopupOAuthLaunchClient } from ` +
        `${JSON.stringify(path.join(clientDirectory, "runtime", "popupOAuthLaunchClient.js"))};\n` +
        "window.jskitAuthWeb = { completeOAuthPopupSignIn, createPopupOAuthLaunchClient };",
      resolveDir: clientDirectory
    },
    write: false
  });
  return result.outputFiles[0].text;
}

/**
 * The app: its page loads JSKIT's popup client and a script, and reads who is signed in. Its own sign-in sets a
 * session cookie, as a JSKIT app's does (HttpOnly, SameSite=Lax); its OAuth sign-in keeps the provider's state in a
 * transaction cookie, as JSKIT's OIDC provider does, and its callback refuses a state it did not keep. `site` names
 * the Preview's and the identity provider's origins once they listen.
 */
async function startApp(t, site) {
  const popupClient = await jskitPopupClientScript();
  const app = createHttpServer((request, response) => {
    const url = new URL(request.url, "http://app");
    const cookies = Object.fromEntries(String(request.headers.cookie || "").split(/;\s*/u).filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>App</title><script src="/jskit-popup.js"></script>` +
        `<script src="/app.js"></script></head><body><main id="app">loading</main><output id="who"></output>` +
        `<button id="sign-in-window" onclick="signInWithWindow('plain')">Sign in</button>` +
        `<button id="sign-in-window-coop" onclick="signInWithWindow('coop')">Sign in (COOP)</button></body></html>`);
    } else if (url.pathname === "/jskit-popup.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(popupClient);
    } else if (url.pathname === "/app.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(`
        window.whoIsSignedIn = () => fetch("/api/me").then((answer) => answer.text())
          .then((who) => { document.getElementById("who").textContent = who; return who; });
        window.signIn = () => fetch("/api/sign-in", { method: "POST" }).then(() => window.whoIsSignedIn());
        window.signInWithWindow = (provider) => window.jskitAuthWeb.createPopupOAuthLaunchClient()
          .open({ url: "/oauth/start?provider=" + provider });
        addEventListener("DOMContentLoaded", () => {
          document.getElementById("app").textContent = "app page";
          window.whoIsSignedIn();
        });`);
    } else if (url.pathname === "/api/me") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(cookies.app_session || "guest");
    } else if (url.pathname === "/api/sign-in" && request.method === "POST") {
      response.writeHead(204, { "Set-Cookie": "app_session=alice; Path=/; HttpOnly; SameSite=Lax" });
      response.end();
    } else if (url.pathname === "/oauth/start") {
      const state = `state-${Math.random().toString(36).slice(2)}`;
      const authorize = new URL("/authorize", site.identityProvider);
      authorize.searchParams.set("coop", url.searchParams.get("provider") === "coop" ? "1" : "0");
      authorize.searchParams.set("redirect_uri", `${site.preview}/oauth/callback`);
      authorize.searchParams.set("state", state);
      response.writeHead(302, {
        "Location": authorize.toString(),
        "Set-Cookie": `oauth_transaction=${state}; Path=/; HttpOnly; SameSite=Lax`
      });
      response.end();
    } else if (url.pathname === "/oauth/callback") {
      if (!cookies.oauth_transaction || cookies.oauth_transaction !== url.searchParams.get("state")) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("The sign-in's transaction cookie is missing.");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": [
          `app_session=${url.searchParams.get("code")}; Path=/; HttpOnly; SameSite=Lax`,
          "oauth_transaction=; Path=/; HttpOnly; Max-Age=0"
        ]
      });
      response.end(`<!doctype html><title>Signed in</title><script src="/jskit-popup.js"></script>` +
        `<p id="callback">callback</p><script>document.getElementById("callback").textContent = ` +
        `window.jskitAuthWeb.completeOAuthPopupSignIn() ? "told the pane" : "signed in in this window";</script>`);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(() => new Promise((resolve) => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}/`;
}

/**
 * The front, on one port for every name: the editor's page, whose pane frames the Preview as the editor's does
 * (Vibe64OutputControls), a page of another site that frames the Preview without its token (or its window path),
 * an identity provider on a third site that sends the window back to the app at once, with
 * Cross-Origin-Opener-Policy when asked, and the Preview itself, sent on to its proxy's socket as a host's ingress
 * sends it. `routes` gets the Preview's address and socket once its proxy listens, as the Preview's public origin
 * names the front's port.
 */
async function startFront(t, certificate, routes) {
  const front = createHttpsServer(certificate, (request, response) => {
    const host = String(request.headers.host || "").replace(/:\d+$/u, "");
    if (host === PREVIEW_HOST) {
      const upstream = httpRequest({
        headers: request.headers,
        method: request.method,
        path: request.url,
        socketPath: routes.socketPath
      }, (answer) => {
        response.writeHead(answer.statusCode, answer.headers);
        answer.pipe(response);
      });
      upstream.once("error", () => response.destroy());
      request.pipe(upstream);
      return;
    }
    const port = front.address().port;
    const url = new URL(request.url, "https://front");
    if (host === IDENTITY_PROVIDER_HOST && url.pathname === "/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "alice");
      back.searchParams.set("state", url.searchParams.get("state"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        ...(url.searchParams.get("coop") === "1" ? { "Cross-Origin-Opener-Policy": "same-origin" } : {})
      });
      response.end(`<!doctype html><title>Identity provider</title><script>location.replace(${JSON.stringify(back)});</script>`);
      return;
    }
    if (host === OTHER_SITE_HOST && url.pathname === "/unpartitioned-cookie") {
      response.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "unpartitioned=1; Path=/; Secure; SameSite=None" });
      response.end("<!doctype html><title>Probe</title><script>localStorage.setItem(\"probe\", \"framed\")</script>probe");
      return;
    }
    if (host === OTHER_SITE_HOST && url.pathname === "/storage-read") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>Probe</title><script>document.title = String(localStorage.getItem(\"probe\"))</script>");
      return;
    }
    if (host === OTHER_SITE_HOST && url.pathname === "/framed-window") {
      const framed = `https://${PREVIEW_HOST}:${port}${PREVIEW_WINDOW_PATH}?ticket=` +
        `${encodeURIComponent(url.searchParams.get("ticket"))}&to=%2F`;
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><title>Other site</title><iframe title="Framed window" src="${framed.replaceAll("&", "&amp;")}"></iframe>`);
      return;
    }
    if (host === EDITOR_HOST && url.pathname === "/third-party-probe") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><title>Probe</title><iframe title="Probe" src="https://${OTHER_SITE_HOST}:${port}/unpartitioned-cookie"></iframe>`);
      return;
    }
    const pages = {
      [EDITOR_HOST]: `<!doctype html><title>Editor</title><iframe allow="clipboard-write; microphone; autoplay" ` +
        `title="App preview" src="${routes.previewHref.replaceAll("&", "&amp;")}"></iframe>`,
      [OTHER_SITE_HOST]: `<!doctype html><title>Other site</title>` +
        `<iframe title="Framed preview" src="https://${PREVIEW_HOST}:${port}/"></iframe>`
    };
    response.writeHead(pages[host] ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(pages[host] || "");
  });
  front.listen(0, "127.0.0.1");
  await once(front, "listening");
  t.after(() => new Promise((resolve) => {
    front.closeAllConnections();
    front.close(resolve);
  }));
  return front.address().port;
}

/** The app behind the real Preview proxy at its public origin, the front, and the editor's address of the Preview. */
async function startPreviewWorld(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-cross-site-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const certificate = await testCertificate(root);
  const site = { identityProvider: "", preview: "" };
  const targetHref = await startApp(t, site);
  const routes = { previewHref: "", socketPath: "" };
  const port = await startFront(t, certificate, routes);
  const env = { VIBE64_PREVIEW_PROXY_SOCKET_DIR: path.join(root, "sockets") };
  const registry = createLaunchPreviewProxyRegistry({ env });
  t.after(() => registry.closeAll());
  const publicOrigin = `https://${PREVIEW_HOST}:${port}`;
  site.preview = publicOrigin;
  site.identityProvider = `https://${IDENTITY_PROVIDER_HOST}:${port}`;
  const preview = await registry.ensure({
    editorOrigin: `https://${EDITOR_HOST}:${port}`,
    previewPublicOrigin: publicOrigin,
    projectScope: "project:shop",
    sessionId: "cross-site-frame",
    targetHref
  });
  routes.previewHref = preview.href;
  routes.socketPath = previewPublicSocketPath(publicOrigin, env);
  return { port, preview, publicOrigin };
}

/**
 * Runs `check` in a fresh Chromium for each third-party cookie mode: `newPage(context)` opens a page in that mode
 * (Chromium's own setting that blocks third-party cookies, as its CDP sets it for a page: its command-line switches
 * for it change nothing in Playwright's Chromium 149), and a probe frame first checks the browser is in that mode.
 * Playwright's Chromium also turns off what every current browser does, keeping a frame's storage (localStorage,
 * BroadcastChannel) apart from the same origin's top-level pages: there a sign-in window a provider cut off from the
 * pane still reaches it through JSKIT's channel, which no person's browser allows. A --disable-features of the
 * test's own replaces Playwright's list, so Chromium partitions storage again, and the probe checks it does.
 */
async function inEachCookieMode(t, port, check) {
  for (const blockThirdPartyCookies of [false, true]) {
    await t.test(blockThirdPartyCookies ? "third-party cookies blocked" : "third-party cookies allowed", async (st) => {
      const browser = await chromium.launch({
        args: ["--host-resolver-rules=MAP *.test 127.0.0.1", "--disable-features=HttpsUpgrades"]
      });
      st.after(() => browser.close());
      const newContext = () => browser.newContext({ ignoreHTTPSErrors: true });
      const newPage = async (context) => {
        const created = await context.newPage();
        if (blockThirdPartyCookies) {
          const session = await context.newCDPSession(created);
          await session.send("Network.enable");
          await session.send("Network.setCookieControls", {
            disableThirdPartyCookieHeuristics: true,
            disableThirdPartyCookieMetadata: true,
            enableThirdPartyCookieRestriction: true
          });
        }
        return created;
      };
      const probeContext = await newContext();
      const probe = await newPage(probeContext);
      await probe.goto(`https://${EDITOR_HOST}:${port}/third-party-probe`);
      await probe.frameLocator('iframe[title="Probe"]').locator("body").filter({ hasText: "probe" }).waitFor({ timeout: 15_000 });
      const kept = (await probeContext.cookies(`https://${OTHER_SITE_HOST}:${port}/`)).some((cookie) => cookie.name === "unpartitioned");
      assert.equal(kept, !blockThirdPartyCookies);
      const topLevel = await newPage(probeContext);
      await topLevel.goto(`https://${OTHER_SITE_HOST}:${port}/storage-read`);
      assert.equal(await topLevel.title(), "null", "a frame's storage is kept apart from the top-level page's");
      await probeContext.close();
      await check({ newContext, newPage });
    });
  }
}

/** The editor's page with its pane, the pane's frame once it shows the app, and a wait for who is signed in. */
async function openEditor(newPage, context, { port, publicOrigin }) {
  const page = await newPage(context);
  await page.goto(`https://${EDITOR_HOST}:${port}/`);
  const pane = page.frameLocator('iframe[title="App preview"]');
  await pane.locator("#app").filter({ hasText: "app page" }).waitFor({ timeout: 15_000 });
  const frame = () => page.frames().find((candidate) => candidate.url().startsWith(publicOrigin));
  const signedIn = (who) => pane.locator("#who").filter({ hasText: who }).waitFor({ timeout: 15_000 });
  return { frame, page, pane, signedIn };
}

test("an editor's Preview pane shows a cross-site Preview whose gate cookie and app sign-in work", {
  timeout: 90_000
}, async (t) => {
  const world = await startPreviewWorld(t);
  const { port, preview } = world;
  await inEachCookieMode(t, port, async ({ newContext, newPage }) => {
    const context = await newContext();
    const editor = await openEditor(newPage, context, world);
    // The first page came with the token; its script and its read of who is signed in came with the cookie.
    await editor.signedIn("guest");
    assert.equal(new URL(editor.frame().url()).search, "", "the Preview's address loses its token");
    assert.equal(await editor.frame().evaluate(() => window.signIn()), "alice", "the app's session stays in the pane");
    await editor.frame().evaluate(() => location.reload());
    await editor.signedIn("alice");

    // Another site's page that frames the Preview has none of the pane's cookies, so no application page.
    const other = await newPage(context);
    await other.goto(`https://${OTHER_SITE_HOST}:${port}/`);
    await other.frameLocator('iframe[title="Framed preview"]').locator("body")
      .filter({ hasText: "Launch preview token is missing or invalid." }).waitFor({ timeout: 15_000 });

    // The Preview opened in its own tab gets its token from its address, as the pane does, and is a session of its own.
    const tab = await newPage(context);
    await tab.goto(preview.href);
    await tab.locator("#who").filter({ hasText: "guest" }).waitFor({ timeout: 15_000 });
    assert.equal(await tab.evaluate(() => window.signIn()), "alice");
    await tab.reload();
    await tab.locator("#who").filter({ hasText: "alice" }).waitFor({ timeout: 15_000 });
    await context.close();
  });
});

test("a sign-in window the pane opens with JSKIT's popup client signs the pane in, even when the provider cuts it off", {
  timeout: 150_000
}, async (t) => {
  const world = await startPreviewWorld(t);
  const { port, preview, publicOrigin } = world;
  await inEachCookieMode(t, port, async ({ newContext, newPage }) => {
    // The window goes through the provider on a third site and back to the app's callback, which finds the
    // transaction cookie its start kept, tells the pane and closes; the pane reloads signed in, and stays so. The
    // person had opened the Preview in its own tab first, which the window's sign-in then signs in too: the window
    // was a page of the Preview's own site, as the tab is.
    const context = await newContext();
    const ownTab = await newPage(context);
    await ownTab.goto(preview.href);
    await ownTab.locator("#who").filter({ hasText: "guest" }).waitFor({ timeout: 15_000 });
    const editor = await openEditor(newPage, context, world);
    await editor.signedIn("guest");
    const opening = context.waitForEvent("page");
    await editor.pane.locator("#sign-in-window").click();
    const signInWindow = await opening;
    await signInWindow.waitForEvent("close", { timeout: 15_000 });
    await editor.signedIn("alice");
    await editor.page.reload();
    await editor.signedIn("alice");
    await ownTab.reload();
    await ownTab.locator("#who").filter({ hasText: "alice" }).waitFor({ timeout: 15_000 });

    // The pane's ticket is the pane's: loaded in another site's frame it is refused, and that use spends it.
    const askTicket = (page) => page.evaluate((ticketPath) => fetch(ticketPath, { method: "POST" })
      .then((answer) => (answer.ok ? answer.json() : { status: answer.status })), PREVIEW_WINDOW_TICKET_PATH);
    const framedTicket = (await askTicket(editor.frame())).ticket;
    const other = await newPage(context);
    await other.goto(`https://${OTHER_SITE_HOST}:${port}/framed-window?ticket=${encodeURIComponent(framedTicket)}`);
    await other.frameLocator('iframe[title="Framed window"]').locator("body").filter({ hasText: WINDOW_REFUSED })
      .waitFor({ timeout: 15_000 });
    const windowPath = (ticket) => `${publicOrigin}${PREVIEW_WINDOW_PATH}?ticket=${encodeURIComponent(ticket)}&to=%2F`;
    const spent = await other.goto(windowPath(framedTicket));
    assert.equal(spent.status(), 403, "used up");

    // Another person's browser gets no ticket for this pane: its tab of the Preview is no pane, so it gets none,
    // and its own pane's ticket lets its window in as its own pane, a guest, not as this one.
    const someoneElse = await newContext();
    const theirTab = await newPage(someoneElse);
    await theirTab.goto(preview.href);
    await theirTab.locator("#who").filter({ hasText: "guest" }).waitFor({ timeout: 15_000 });
    assert.deepEqual(await askTicket(theirTab), { status: 403 });
    const theirEditor = await openEditor(newPage, someoneElse, world);
    await theirEditor.signedIn("guest");
    await theirTab.goto(windowPath((await askTicket(theirEditor.frame())).ticket));
    await theirTab.locator("#who").filter({ hasText: "guest" }).waitFor({ timeout: 15_000 });
    await someoneElse.close();
    await context.close();

    // A provider whose page cuts the window off from the pane (Cross-Origin-Opener-Policy) leaves the window
    // signed in on its own and the pane not told; a reload of the pane shows it signed in, as the window is.
    const coopContext = await newContext();
    const coopEditor = await openEditor(newPage, coopContext, world);
    await coopEditor.signedIn("guest");
    const coopOpening = coopContext.waitForEvent("page");
    await coopEditor.pane.locator("#sign-in-window-coop").click();
    const coopWindow = await coopOpening;
    await coopWindow.locator("#callback").filter({ hasText: "signed in in this window" }).waitFor({ timeout: 15_000 });
    assert.equal(await coopWindow.evaluate(() => window.opener), null, "the provider cut the window off");
    assert.equal(await coopEditor.pane.locator("#who").textContent(), "guest", "the pane was not told");
    await coopEditor.frame().evaluate(() => location.reload());
    await coopEditor.signedIn("alice");
    await coopContext.close();
  });
});
