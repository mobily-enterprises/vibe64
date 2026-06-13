import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_AUTH_COOKIE_NAME,
  normalizeVibe64RuntimeNamespace,
  scopedVibe64AuthCookieName,
  vibe64AuthCookieNameForRuntime
} from "@local/vibe64-core/server/authCookies";

test("Vibe64 auth cookie naming uses the unscoped cookie by default", () => {
  assert.equal(scopedVibe64AuthCookieName(""), VIBE64_AUTH_COOKIE_NAME);
  assert.equal(vibe64AuthCookieNameForRuntime(), VIBE64_AUTH_COOKIE_NAME);
});

test("Vibe64 auth cookie naming scopes by normalized runtime namespace and resolved system root", () => {
  const systemRoot = path.join("relative", "system-root");
  const expected = scopedVibe64AuthCookieName(`tenant-a:${path.resolve(systemRoot)}`);

  assert.equal(normalizeVibe64RuntimeNamespace(" Tenant A! "), "tenant-a");
  assert.equal(vibe64AuthCookieNameForRuntime({
    runtimeNamespace: " Tenant A! ",
    systemRoot
  }), expected);
});
