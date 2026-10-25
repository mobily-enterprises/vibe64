import assert from "node:assert/strict";
import test from "node:test";

import { boundedReviewDiff, isGitObjectId } from "../../packages/vibe64-terminals/src/server/sessionWorkGit.js";

test("session work accepts only full SHA-1 or SHA-256 object ids", () => {
  assert.equal(isGitObjectId("a".repeat(40)), true);
  assert.equal(isGitObjectId("b".repeat(64)), true);
  for (const length of [39, 41, 52, 63, 65]) assert.equal(isGitObjectId("c".repeat(length)), false, String(length));
  assert.equal(isGitObjectId("A".repeat(40)), false);
  assert.equal(isGitObjectId(undefined), false);
});

test("review diffs share one character bound", () => {
  assert.deepEqual(boundedReviewDiff("small"), { content: "small", truncated: false });
  const large = boundedReviewDiff("x".repeat(100_001));
  assert.equal(large.content.length, 100_000);
  assert.equal(large.truncated, true);
});
