import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

import {
  createLaunchPreviewProxyRegistry,
  previewPublicSocketPath
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";

// A host that gives Previews a domain of their own (vibe64.app beside the editors' vibe64.studio) makes each Preview
// a cross-site frame of the editor that shows it. In Chromium, an editor page on one site frames, as the editor's
// Preview pane does, a Preview on another, served over HTTPS by the Preview proxy behind a front that routes each
// name by Host as a host's ingress does: the frame's page and the requests it makes after its first one pass the
// Preview's gate with its cookie, signing in to the app inside the frame keeps the app's session, a page of a third
// site that frames the Preview gets no application page, and the Preview opened in its own tab works too. Each runs
// with Chromium's third-party cookies allowed, as they are by default, and blocked, as Safari blocks them and
// Chromium can: a browser that blocks them still keeps partitioned ones.

const execFileAsync = promisify(execFile);
const EDITOR_HOST = "merc.studio.test";
const PREVIEW_HOST = "v64preview-abcdef123456.merc.app.test";
const OTHER_SITE_HOST = "pages.other.test";

/** A key and a certificate for the test's names, made for this run. */
async function testCertificate(root) {
  const key = path.join(root, "key.pem");
  const certificate = path.join(root, "certificate.pem");
  await execFileAsync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
    "-subj", `/CN=${EDITOR_HOST}`,
    "-addext", `subjectAltName=DNS:${EDITOR_HOST},DNS:${PREVIEW_HOST},DNS:${OTHER_SITE_HOST}`,
    "-keyout", key, "-out", certificate
  ]);
  return { cert: await readFile(certificate), key: await readFile(key) };
}

/**
 * The app: its page loads a script and reads who is signed in; its sign-in sets a session cookie, as a JSKIT app's
 * does (SameSite=Lax), which the Preview gives cross-site attributes.
 */
async function startApp(t) {
  const app = createHttpServer((request, response) => {
    const url = new URL(request.url, "http://app");
    const session = /(?:^|;\s*)app_session=([^;]+)/u.exec(String(request.headers.cookie || ""))?.[1] || "";
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>App</title><script src="/app.js"></script></head>` +
        `<body><main id="app">loading</main><output id="who"></output></body></html>`);
    } else if (url.pathname === "/app.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(`
        window.whoIsSignedIn = () => fetch("/api/me").then((answer) => answer.text())
          .then((who) => { document.getElementById("who").textContent = who; return who; });
        window.signIn = () => fetch("/api/sign-in", { method: "POST" }).then(() => window.whoIsSignedIn());
        addEventListener("DOMContentLoaded", () => {
          document.getElementById("app").textContent = "app page";
          window.whoIsSignedIn();
        });`);
    } else if (url.pathname === "/api/me") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(session || "guest");
    } else if (url.pathname === "/api/sign-in" && request.method === "POST") {
      response.writeHead(204, { "Set-Cookie": "app_session=alice; Path=/; HttpOnly; SameSite=Lax" });
      response.end();
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
 * (Vibe64OutputControls), a page of another site that frames the Preview without its token, and the Preview itself,
 * sent on to its proxy's socket as a host's ingress sends it. `routes` gets the Preview's address and socket once
 * its proxy listens, as the Preview's public origin names the front's port.
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
    const pathname = new URL(request.url, "https://front").pathname;
    if (host === OTHER_SITE_HOST && pathname === "/unpartitioned-cookie") {
      response.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "unpartitioned=1; Path=/; Secure; SameSite=None" });
      response.end("<!doctype html><title>Probe</title>probe");
      return;
    }
    if (host === EDITOR_HOST && pathname === "/third-party-probe") {
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

test("an editor's Preview pane shows a cross-site Preview whose gate cookie and app sign-in work", {
  timeout: 90_000
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-cross-site-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const certificate = await testCertificate(root);
  const targetHref = await startApp(t);
  const routes = { previewHref: "", socketPath: "" };
  const port = await startFront(t, certificate, routes);
  const env = { VIBE64_PREVIEW_PROXY_SOCKET_DIR: path.join(root, "sockets") };
  const registry = createLaunchPreviewProxyRegistry({ env });
  t.after(() => registry.closeAll());
  const publicOrigin = `https://${PREVIEW_HOST}:${port}`;
  const preview = await registry.ensure({
    editorOrigin: `https://${EDITOR_HOST}:${port}`,
    previewPublicOrigin: publicOrigin,
    projectScope: "project:shop",
    sessionId: "cross-site-frame",
    targetHref
  });
  routes.previewHref = preview.href;
  routes.socketPath = previewPublicSocketPath(publicOrigin, env);

  for (const blockThirdPartyCookies of [false, true]) {
    await t.test(blockThirdPartyCookies ? "third-party cookies blocked" : "third-party cookies allowed", async (st) => {
      const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP *.test 127.0.0.1"] });
      st.after(() => browser.close());
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      // Chromium's own setting that blocks third-party cookies, as its CDP sets it for a page (its command-line
      // switches for it change nothing in Playwright's Chromium 149).
      const newPage = async () => {
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
      // The browser is in the mode it says: it keeps a third-party cookie without Partitioned only when allowed.
      const probe = await newPage();
      await probe.goto(`https://${EDITOR_HOST}:${port}/third-party-probe`);
      await probe.frameLocator('iframe[title="Probe"]').locator("body").filter({ hasText: "probe" }).waitFor({ timeout: 15_000 });
      const kept = (await context.cookies(`https://${OTHER_SITE_HOST}:${port}/`)).some((cookie) => cookie.name === "unpartitioned");
      assert.equal(kept, !blockThirdPartyCookies);
      const page = await newPage();
      await page.goto(`https://${EDITOR_HOST}:${port}/`);
      const pane = page.frameLocator('iframe[title="App preview"]');
      // The first page came with the token; its script and its read of who is signed in came with the cookie.
      await pane.locator("#who").filter({ hasText: "guest" }).waitFor({ timeout: 15_000 });
      assert.equal(await pane.locator("#app").textContent(), "app page");
      const frame = page.frames().find((candidate) => candidate.url().startsWith(publicOrigin));
      assert.ok(frame, "the pane holds the Preview");
      assert.equal(new URL(frame.url()).search, "", "the Preview's address loses its token");
      assert.equal(await frame.evaluate(() => window.signIn()), "alice", "the app's session stays in the pane");
      await frame.evaluate(() => location.reload());
      await pane.locator("#who").filter({ hasText: "alice" }).waitFor({ timeout: 15_000 });

      // Another site's page that frames the Preview has none of the pane's cookies, so no application page.
      const other = await newPage();
      await other.goto(`https://${OTHER_SITE_HOST}:${port}/`);
      await other.frameLocator('iframe[title="Framed preview"]').locator("body")
        .filter({ hasText: "Launch preview token is missing or invalid." }).waitFor({ timeout: 15_000 });

      // The Preview opened in its own tab gets its token from its address, as the pane does.
      const tab = await newPage();
      await tab.goto(preview.href);
      await tab.locator("#who").filter({ hasText: "guest" }).waitFor({ timeout: 15_000 });
      assert.equal(await tab.evaluate(() => window.signIn()), "alice");
      await tab.reload();
      await tab.locator("#who").filter({ hasText: "alice" }).waitFor({ timeout: 15_000 });
      await context.close();
    });
  }
});
