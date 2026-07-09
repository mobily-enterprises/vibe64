import assert from "node:assert/strict";
import test from "node:test";

import {
  shellQuote,
  stableHash
} from "../../packages/vibe64-execution/src/server/shellText.js";

test("shellQuote preserves shell-safe values and quotes unsafe text", () => {
  assert.equal(shellQuote("npm"), "npm");
  assert.equal(shellQuote("node:22/bin"), "node:22/bin");
  assert.equal(shellQuote("hello world"), "'hello world'");
  assert.equal(shellQuote("don't"), "'don'\\''t'");
});

test("stableHash returns a deterministic short hash", () => {
  assert.equal(stableHash("alpha"), stableHash("alpha"));
  assert.notEqual(stableHash("alpha"), stableHash("beta"));
  assert.match(stableHash("alpha"), /^[a-f0-9]{12}$/u);
});
