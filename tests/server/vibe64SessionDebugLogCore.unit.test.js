import assert from "node:assert/strict";
import test from "node:test";
import {
  vibe64SessionDebugError
} from "../../packages/vibe64-runtime/src/server/sessionDebugLogCore.js";

test("Vibe64 session debug errors preserve stack and cause details", () => {
  const cause = new Error("Inner failure");
  cause.code = "inner_code";
  cause.status = 409;

  const error = new Error("Outer failure", { cause });
  error.code = "outer_code";
  error.statusCode = 500;

  const summary = vibe64SessionDebugError(error);

  assert.equal(summary.code, "outer_code");
  assert.equal(summary.message, "Outer failure");
  assert.equal(summary.status, 500);
  assert.match(summary.stack, /Outer failure/u);
  assert.equal(summary.cause.code, "inner_code");
  assert.equal(summary.cause.message, "Inner failure");
  assert.equal(summary.cause.status, 409);
  assert.match(summary.cause.stack, /Inner failure/u);
});
