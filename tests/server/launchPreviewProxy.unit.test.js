import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  PREVIEW_BRIDGE_MESSAGE_TYPE
} from "../../packages/vibe64-terminals/src/server/launchPreviewBridge.js";
import {
  createLaunchPreviewProxyRegistry,
  injectLaunchPreviewBridge,
  normalizePreviewTargetHref,
  proxiedLocation
} from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";

test("launch preview bridge injects once and reports target URLs", () => {
  const html = "<!doctype html><html><head><title>App</title></head><body></body></html>";
  const injected = injectLaunchPreviewBridge(html, {
    targetOrigin: "http://127.0.0.1:4103"
  });

  assert.match(injected, /data-vibe64-preview-bridge="1"/u);
  assert.match(injected, new RegExp(PREVIEW_BRIDGE_MESSAGE_TYPE, "u"));
  assert.match(injected, /http:\/\/127\.0\.0\.1:4103/u);
  assert.equal(injectLaunchPreviewBridge(injected), injected);
});

test("launch preview target URLs are constrained to loopback HTTP origins", () => {
  assert.equal(
    normalizePreviewTargetHref("http://127.0.0.1:4103/home").toString(),
    "http://127.0.0.1:4103/home"
  );
  assert.throws(() => normalizePreviewTargetHref("file:///tmp/index.html"), /must use HTTP/u);
  assert.throws(() => normalizePreviewTargetHref("https://example.com"), /must be loopback/u);
});

test("launch preview proxy injects HTML and proxies app-relative requests", async () => {
  await withTargetServer(async (target) => {
    const registry = createLaunchPreviewProxyRegistry();
    try {
      const preview = await registry.ensure("session-1", `${target.origin}/home?mode=dev`);

      assert.equal(preview.available, true);
      assert.equal(preview.targetHref, `${target.origin}/home?mode=dev`);
      assert.match(preview.href, /^http:\/\/127\.0\.0\.1:\d+\/home\?mode=dev$/u);

      const htmlResponse = await fetch(preview.href);
      const html = await htmlResponse.text();
      assert.equal(htmlResponse.status, 200);
      assert.match(html, /Target home/u);
      assert.match(html, /data-vibe64-preview-bridge="1"/u);
      assert.match(html, new RegExp(target.origin.replaceAll(".", "\\."), "u"));

      const apiResponse = await fetch(new URL("/api/ping", preview.href));
      assert.equal(apiResponse.status, 200);
      assert.deepEqual(await apiResponse.json(), {
        ok: true
      });

      const again = await registry.ensure("session-1", `${target.origin}/home?mode=dev`);
      assert.equal(again.href, preview.href);
    } finally {
      await registry.closeAll();
    }
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

test("launch preview proxy keeps HTML previews retrying while the target is unavailable", async () => {
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
    assert.match(html, /http-equiv="refresh"/u);

    const apiResponse = await fetch(new URL("/api/ping", preview.href), {
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

async function withTargetServer(callback) {
  const server = createServer((request, response) => {
    if (request.url === "/api/ping") {
      response.writeHead(200, {
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({
        ok: true
      }));
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
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
      origin: `http://127.0.0.1:${address.port}`
    });
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}
