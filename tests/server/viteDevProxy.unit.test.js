import assert from "node:assert/strict";
import test from "node:test";
import viteConfig from "../../vite.config.mjs";

test("Vite sends only the local app entry route through the backend", () => {
  const proxyEntries = viteConfig.server?.proxy || {};
  const appEntryPattern = Object.keys(proxyEntries).find((pattern) =>
    new RegExp(pattern).test("/app")
  );

  assert.ok(appEntryPattern, "Expected a Vite proxy for the local /app entry route.");
  const matchesAppEntry = new RegExp(appEntryPattern);
  assert.equal(matchesAppEntry.test("/app"), true);
  assert.equal(matchesAppEntry.test("/app/"), true);
  assert.equal(matchesAppEntry.test("/app?from=test"), true);
  assert.equal(matchesAppEntry.test("/app/project/local-target"), false);
});
