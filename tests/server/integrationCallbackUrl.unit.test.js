import test from "node:test";
import assert from "node:assert/strict";
import { integrationCallbackUrl } from "../../src/lib/integrationCallbackUrl.js";

test("callback suggestion uses the assigned app origin and declared callback path", () => {
  assert.equal(integrationCallbackUrl("https://sas-dogandgroom.hosting.vibe64.dev", "/integrations/google/callback"),
    "https://sas-dogandgroom.hosting.vibe64.dev/integrations/google/callback");
  assert.equal(integrationCallbackUrl("http://localhost:8080", "/integrations/google/callback"),
    "http://localhost:8080/integrations/google/callback");
});

test("missing or unsafe origins and paths never produce guessed callback URLs", () => {
  for (const origin of [undefined, "", "dogandgroom", "https://editor.example/app/project/dog", "https://app.example/?key=private",
    "https://user:password@app.example", "http://remote.example", "javascript:alert(1)"]) {
    assert.equal(integrationCallbackUrl(origin, "/integrations/google/callback"), "");
  }
  for (const callback of [undefined, "https://other.example", "//other.example", "/../other", "/callback?token=secret"]) {
    assert.equal(integrationCallbackUrl("https://app.example", callback), "");
  }
});
